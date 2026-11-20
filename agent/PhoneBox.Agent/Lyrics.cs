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
    public sealed record Result(string Key, IReadOnlyList<Line> Lines, string Plain, bool Instrumental, bool Found);

    static readonly HttpClient Http = MakeClient();
    static HttpClient MakeClient()
    {
        var h = new HttpClient { Timeout = TimeSpan.FromSeconds(8), BaseAddress = new Uri("https://lrclib.net/api/") };
        h.DefaultRequestHeaders.UserAgent.ParseAdd("Federano-Panel/1.0 (lyrics page)");
        return h;
    }
    private readonly ConcurrentDictionary<string, Task<Result>> _cache = new();

    public static string KeyOf(string title, string artist) => (title.Trim() + "\u0001" + artist.Trim()).ToLowerInvariant();

    public Task<Result> GetAsync(string title, string artist, string album, long durationMs)
    {
        var key = KeyOf(title, artist);
        if (_cache.Count > 300) _cache.Clear();
        return _cache.GetOrAdd(key, _ => FetchAsync(key, title, artist, album, durationMs));
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
                    .ThenBy(x => Math.Abs((x!["duration"]?.GetValue<double>() ?? 0) * 1000 - durationMs))
                    .FirstOrDefault();
            }
            if (hit is null) return new(key, [], "", false, false);
            var synced = hit["syncedLyrics"]?.GetValue<string>() ?? "";
            var plain = hit["plainLyrics"]?.GetValue<string>() ?? "";
            var instrumental = hit["instrumental"]?.GetValue<bool>() == true;
            return new(key, ParseLrc(synced), plain, instrumental, true);
        }
        catch (Exception ex)
        {
            log.LogInformation("lyrics: {Error}", ex.Message);
            _ = Task.Delay(TimeSpan.FromMinutes(1)).ContinueWith(_ => _cache.TryRemove(key, out var _));
            return new(key, [], "", false, false);
        }
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
