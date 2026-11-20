using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PhoneBox.Agent;

/// <summary>
/// Federano "Letra" page: the lyrics of the song playing on the PC, timed to the music, from LRCLIB (lrclib.net, a free
/// open lyrics database). Only the song's title, artist, album and length are sent there; answers are kept in memory
/// (one lookup per song).
/// </summary>
public sealed partial class LyricsService(ILogger<LyricsService> log)
{
    public sealed record Line(long T, string Text);
    /// <param name="Lines">Timed lines (empty when only plain text or nothing was found).</param>
    /// <param name="Trans">Portuguese translation, one per line (the timed lines, else the plain text's lines); null when
    /// the song is already in Portuguese or the translation failed.</param>
    /// <param name="Seconds">Length of the recording the lyrics belong to (0 = unknown).</param>
    public sealed record Result(string Key, IReadOnlyList<Line> Lines, string Plain, bool Instrumental, bool Found,
        IReadOnlyList<string>? Trans = null, string Lang = "", double Seconds = 0);

    static readonly HttpClient Http = MakeClient();
    static HttpClient MakeClient()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromSeconds(8), BaseAddress = new Uri("https://lrclib.net/api/") };
        h.DefaultRequestHeaders.UserAgent.ParseAdd("Federano-Panel/1.0 (lyrics page)");
        return h;
    }
    private readonly ConcurrentDictionary<string, Task<Result>> _cache = new();

    /// <summary>The song the lyrics page asked about last (a new one makes the Spotify queue be read again).</summary>
    public string LastKey { get; set; } = "";

    // ---- how far Windows' position runs behind the player's own (Spotify reports ~0.5 s late); the median of the last
    // readings, so one slow answer does not make the lyrics jump
    private readonly Queue<long> _offsets = new();
    private readonly object _offGate = new();
    public long Offset(string key, long? sample)
    {
        lock (_offGate)
        {
            if (key != _offKey) { _offKey = key; }
            if (sample is { } s && Math.Abs(s) < 3000) { _offsets.Enqueue(s); while (_offsets.Count > 7) _offsets.Dequeue(); }
            if (_offsets.Count == 0) return 0;
            var sorted = _offsets.Order().ToArray();
            return sorted[sorted.Length / 2];
        }
    }
    private string _offKey = "";

    public static string KeyOf(string title, string artist) => (title.Trim() + "\u0001" + artist.Trim()).ToLowerInvariant();

    public Task<Result> GetAsync(string title, string artist, string album, long durationMs)
    {
        var key = KeyOf(title, artist);
        if (_cache.Count > 300) _cache.Clear();
        var task = _cache.GetOrAdd(key, _ => FetchAsync(key, title, artist, album, durationMs));
        // fetched ahead without the length (next song of the queue) and it belongs to another recording: look again
        if (durationMs > 0 && task.IsCompletedSuccessfully && task.Result is { Found: true, Seconds: > 0 } r && Math.Abs(r.Seconds * 1000 - durationMs) > 4000)
        {
            task = FetchAsync(key, title, artist, album, durationMs);
            _cache[key] = task;
        }
        return task;
    }

    private async Task<Result> FetchAsync(string key, string title, string artist, string album, long durationMs)
    {
        try
        {
            var q = $"get?track_name={Uri.EscapeDataString(title)}&artist_name={Uri.EscapeDataString(artist)}";
            if (album.Length > 0) q += $"&album_name={Uri.EscapeDataString(album)}";
            if (durationMs > 0) q += $"&duration={Math.Round(durationMs / 1000.0)}";
            using var res = await Http.GetAsync(q);
            JsonNode? hit = null;
            if (res.IsSuccessStatusCode) hit = JsonNode.Parse(await res.Content.ReadAsStringAsync());
            if (hit is null)
            {
                // no exact match (another album or a slightly different length): the best search result instead
                var search = JsonNode.Parse(await Http.GetStringAsync($"search?track_name={Uri.EscapeDataString(title)}&artist_name={Uri.EscapeDataString(artist)}")) as JsonArray;
                hit = search?.Where(x => x is not null)
                    .OrderByDescending(x => !string.IsNullOrEmpty(x!["syncedLyrics"]?.GetValue<string>()))
                    .ThenBy(x => durationMs > 0 ? Math.Abs((x!["duration"]?.GetValue<double>() ?? 0) * 1000 - durationMs) : 0)
                    .FirstOrDefault();
            }
            if (hit is null) return new(key, [], "", false, false);
            var synced = hit["syncedLyrics"]?.GetValue<string>() ?? "";
            var plain = hit["plainLyrics"]?.GetValue<string>() ?? "";
            var instrumental = hit["instrumental"]?.GetValue<bool>() == true;
            var lines = ParseLrc(synced);
            var texts = lines.Count > 0 ? lines.Select(l => l.Text).ToList() : plain.Split('\n').Select(t => t.Trim()).ToList();
            var (trans, lang) = instrumental ? (null, "") : await TranslateAsync(texts);
            return new(key, lines, plain, instrumental, true, trans, lang, hit["duration"]?.GetValue<double>() ?? 0);
        }
        catch (Exception ex)
        {
            log.LogInformation("lyrics: {Error}", ex.Message);
            _ = Task.Delay(TimeSpan.FromMinutes(1)).ContinueWith(_ => _cache.TryRemove(key, out var _));
            return new(key, [], "", false, false);
        }
    }

    // ---- translation into Portuguese (Google Translate's free web endpoint, no account): the song's lines, once per song
    static readonly HttpClient Gt = MakeGt();
    static HttpClient MakeGt()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        h.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0");
        return h;
    }

    /// <summary>The lines in Portuguese, one per line (empty lines stay empty), and the detected language. Null when
    /// the lyrics are already Portuguese or the service did not answer as expected.</summary>
    internal async Task<(IReadOnlyList<string>? Trans, string Lang)> TranslateAsync(IReadOnlyList<string> texts)
    {
        try
        {
            var unique = texts.Where(t => t.Length > 0).Distinct().ToList();
            if (unique.Count == 0) return (null, "");
            var map = new Dictionary<string, string>();
            var lang = "";
            // a few lines per request, joined by new lines; a chunk whose lines do not come back one-to-one goes line by line
            foreach (var chunk in Chunks(unique, 3500))
            {
                var (out1, l1) = await TranslateText(string.Join('\n', chunk));
                if (lang.Length == 0) lang = l1;
                if (lang.StartsWith("pt", StringComparison.OrdinalIgnoreCase)) return (null, lang);
                var parts = out1.Split('\n');
                if (parts.Length == chunk.Count) { for (var i = 0; i < chunk.Count; i++) map[chunk[i]] = parts[i].Trim(); continue; }
                foreach (var line in chunk) map[line] = (await TranslateText(line)).Text.Trim();
            }
            return (texts.Select(t => t.Length == 0 ? "" : map.GetValueOrDefault(t, "")).ToList(), lang);
        }
        catch (Exception ex) { log.LogInformation("lyrics translation: {Error}", ex.Message); return (null, ""); }
    }

    static IEnumerable<List<string>> Chunks(List<string> lines, int maxChars)
    {
        var cur = new List<string>(); var size = 0;
        foreach (var l in lines)
        {
            if (cur.Count > 0 && size + l.Length + 1 > maxChars) { yield return cur; cur = []; size = 0; }
            cur.Add(l); size += l.Length + 1;
        }
        if (cur.Count > 0) yield return cur;
    }

    static async Task<(string Text, string Lang)> TranslateText(string text)
    {
        using var body = new FormUrlEncodedContent([new("q", text)]);
        using var res = await Gt.PostAsync("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=pt&dt=t&ie=UTF-8&oe=UTF-8", body);
        res.EnsureSuccessStatusCode();
        return ParseGoogle(await res.Content.ReadAsStringAsync());
    }

    /// <summary>[[["tradução","original",…],…],null,"en",…] → ("tradução…", "en").</summary>
    internal static (string Text, string Lang) ParseGoogle(string json)
    {
        var root = JsonNode.Parse(json) as JsonArray ?? throw new FormatException("not an array");
        var sb = new System.Text.StringBuilder();
        foreach (var seg in root[0] as JsonArray ?? []) if (seg is JsonArray a && a.Count > 0 && a[0] is JsonValue v && v.TryGetValue<string>(out var t)) sb.Append(t);
        var lang = root.Count > 2 && root[2] is JsonValue lv && lv.TryGetValue<string>(out var l) ? l : "";
        return (sb.ToString(), lang);
    }

    [GeneratedRegex(@"\[(\d+):(\d+(?:\.\d+)?)\]")]
    private static partial Regex Stamp();

    /// <summary>"[01:02.50] text" lines → (ms, text), in order. Lines with several stamps appear at each time.</summary>
    internal static IReadOnlyList<Line> ParseLrc(string lrc)
    {
        var lines = new List<Line>();
        foreach (var raw in lrc.Split('\n'))
        {
            var stamps = Stamp().Matches(raw);
            if (stamps.Count == 0) continue;
            var text = Stamp().Replace(raw, "").Trim();
            foreach (Match m in stamps)
            {
                var ms = (long)(int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) * 60_000
                    + double.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture) * 1000);
                lines.Add(new(ms, text));
            }
        }
        return lines.OrderBy(l => l.T).ToList();
    }
}
