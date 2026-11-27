using System.Collections.Concurrent;
using System.Globalization;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace PhoneBox.Agent;

public sealed partial class LyricsService
{
    private sealed record VideoSong(string Song, string Artist, bool Original = false);
    private sealed record VideoCache(Result Words, DateTimeOffset Expires);
    private readonly ConcurrentDictionary<string, Lazy<Task<VideoCache>>> _videoCache = new();
    private readonly HttpClient _videoHttp = Http;
    private readonly TimeProvider _videoClock = TimeProvider.System;
    private readonly Func<IReadOnlyList<string>, Task<(IReadOnlyList<string>? Trans, string Lang)>>? _videoTranslate;
    private long _videoPauseUntil;

    // Tests use synthetic lyrics and a local handler; production keeps the existing LRCLIB and translation clients.
    internal LyricsService(ILogger<LyricsService> log, HttpClient http,
        Func<IReadOnlyList<string>, Task<(IReadOnlyList<string>? Trans, string Lang)>> translate, TimeProvider? clock = null) : this(log)
    {
        _videoHttp = http;
        _videoTranslate = translate;
        _videoClock = clock ?? TimeProvider.System;
    }

    private static string VideoArtist(string text) => Regex.Split(
        Regex.Replace(text, @"\s*-\s*Topic$|VEVO$|\s+Oficial$|\s+Official$", "", RegexOptions.IgnoreCase),
        @"\s+(?:ft\.?|feat\.?|part\.?|x|&)\s+|[,;]\s*", RegexOptions.IgnoreCase)[0].Trim(' ', '"', '\'', '“', '”');

    private static string VideoDecorations(string text)
    {
        var clean = Regex.Replace(text,
            @"\s+[\(\[]\s*(?:official|oficial|clipe|v[ií]deo|lyric|letra|prod\.?|ao vivo|live|hd\b|4k\b)[^\)\]]*[\)\]]",
            "", RegexOptions.IgnoreCase).Trim(' ', '"', '\'', '“', '”');
        return Regex.Replace(clean, @"\s*[♪♫♬♩]+\s*$", "").Trim();
    }

    private static string VideoName(string text)
    {
        var clean = new StringBuilder();
        foreach (var c in text.Normalize(NormalizationForm.FormD))
            if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark && char.IsLetterOrDigit(c))
                clean.Append(char.ToLowerInvariant(c));
        return clean.ToString();
    }

    private static string VideoTrackName(string name, string artist)
    {
        var dash = Regex.Match(name, @"\s+[-–—]\s+");
        if (dash.Success && VideoName(VideoArtist(name[..dash.Index])) == VideoName(artist))
            name = name[(dash.Index + dash.Length)..];
        return VideoName(VideoDecorations(name));
    }

    private static List<VideoSong> VideoCandidates(string title, string channel)
    {
        var text = WebUtility.HtmlDecode(title).Trim();
        text = Regex.Replace(text, @"\s+-\s+YouTube$", "", RegexOptions.IgnoreCase);
        // A session/channel name after a pipe is branding, not part of the song or performer.
        var parts = Regex.Split(text, @"\s+\|\s+");
        if (parts.Length > 1 && Regex.IsMatch(parts[0], @"\s+[-–—]\s+")) text = parts[0];
        var dash = Regex.Match(text, @"\s+[-–—|]\s+");
        var candidates = new List<VideoSong>();
        void Add(string song, string artist, bool original = false)
        {
            song = VideoDecorations(song); artist = VideoArtist(artist);
            if (song.Length > 0 && artist.Length > 0 && !candidates.Any(c =>
                VideoName(c.Song) == VideoName(song) && VideoName(c.Artist) == VideoName(artist)))
                candidates.Add(new(song, artist, original));
        }
        if (dash.Success)
        {
            var left = VideoDecorations(text[..dash.Index]);
            var right = VideoDecorations(text[(dash.Index + dash.Length)..]);
            // "Abraço (Medulla) - Supercombo": the parenthesis identifies the original artist of a cover.
            var original = Regex.Match(left, @"\s+\(([^()]+)\)$");
            if (original.Success)
            {
                var song = left[..original.Index].Trim();
                Add(song, right);
                Add(song, original.Groups[1].Value, original: true);
                Add(right, left);
            }
            else
            {
                var reverse = VideoName(VideoArtist(channel)) == VideoName(VideoArtist(right));
                if (reverse) Add(left, right);
                Add(right, left);
                if (!reverse) Add(left, right);
            }
        }
        else Add(VideoDecorations(text), channel);
        // Empty artist metadata is allowed, but never guess a random artist from a common song title.
        if (candidates.Count == 0) candidates.Add(new(VideoDecorations(text), VideoArtist(channel)));
        return candidates;
    }

    /// <summary>Music-video titles can put the performer last or name a cover's original artist. The Spotify lookup
    /// remains separate; a cover may use the original words, but never its unrelated timestamps.</summary>
    public async Task<Result> GetVideoAsync(string title, string channel, long durationMs)
    {
        var key = "video\u0001" + KeyOf(title, channel) + "\u0001" + (durationMs + 500) / 1000;
        if (_videoCache.Count > 300) _videoCache.Clear();
        while (true)
        {
            var lookup = _videoCache.GetOrAdd(key, _ => new(() => FetchVideoAsync(key, title, channel, durationMs)));
            var cached = await lookup.Value;
            if (cached.Expires <= _videoClock.GetUtcNow())
            {
                _videoCache.TryRemove(new KeyValuePair<string, Lazy<Task<VideoCache>>>(key, lookup));
                continue;
            }
            var words = cached.Words;
            return durationMs > 0 && words.Seconds > 0 && Math.Abs(words.Seconds * 1000 - durationMs) > 4000
                ? VideoPlain(words) : words;
        }
    }

    private static Result VideoPlain(Result words) => words with
    {
        Plain = words.Lines.Count > 0 ? string.Join('\n', words.Lines.Select(l => l.Text)) : words.Plain,
        Lines = []
    };

    private async Task<VideoCache> FetchVideoAsync(string key, string title, string channel, long durationMs)
    {
        VideoCache Missing(TimeSpan retry) => new(new(key, [], "", false, false), _videoClock.GetUtcNow() + retry);
        var paused = Interlocked.Read(ref _videoPauseUntil) - _videoClock.GetUtcNow().ToUnixTimeMilliseconds();
        if (paused > 0) return Missing(TimeSpan.FromMilliseconds(paused));
        try
        {
            foreach (var candidate in VideoCandidates(title, channel))
            {
                if (candidate.Song.Length == 0 || candidate.Artist.Length == 0) continue;
                using var response = await _videoHttp.GetAsync($"search?track_name={Uri.EscapeDataString(candidate.Song)}&artist_name={Uri.EscapeDataString(candidate.Artist)}");
                if (response.StatusCode is HttpStatusCode.TooManyRequests or HttpStatusCode.ServiceUnavailable)
                {
                    var retry = response.Headers.RetryAfter?.Delta ??
                        (response.Headers.RetryAfter?.Date - _videoClock.GetUtcNow()) ?? TimeSpan.FromMinutes(1);
                    if (retry < TimeSpan.FromSeconds(1)) retry = TimeSpan.FromSeconds(1);
                    Interlocked.Exchange(ref _videoPauseUntil, (_videoClock.GetUtcNow() + retry).ToUnixTimeMilliseconds());
                    return Missing(retry);
                }
                response.EnsureSuccessStatusCode();
                var hits = JsonNode.Parse(await response.Content.ReadAsStringAsync()) as JsonArray;
                var hit = hits?.Where(x => x is not null &&
                    VideoTrackName(x["trackName"]?.GetValue<string>() ?? "", candidate.Artist) == VideoName(candidate.Song) &&
                    VideoName(VideoArtist(x["artistName"]?.GetValue<string>() ?? "")) == VideoName(candidate.Artist) &&
                    (!string.IsNullOrWhiteSpace(x["plainLyrics"]?.GetValue<string>()) ||
                     !string.IsNullOrWhiteSpace(x["syncedLyrics"]?.GetValue<string>()) || x["instrumental"]?.GetValue<bool>() == true))
                    .OrderBy(x => !candidate.Original && durationMs > 0 ? Math.Abs((x!["duration"]?.GetValue<double>() ?? 0) * 1000 - durationMs) : 0)
                    // Some video-specific entries include the performer in trackName. Prefer that exact video title
                    // over an album LRC copied to a record with the video's duration but without its introduction.
                    .ThenByDescending(x => VideoName(x!["trackName"]?.GetValue<string>() ?? "") == VideoName(title))
                    .ThenByDescending(x => !string.IsNullOrWhiteSpace(x!["syncedLyrics"]?.GetValue<string>()))
                    .FirstOrDefault();
                if (hit is null) continue;
                var lines = ParseLrc(hit["syncedLyrics"]?.GetValue<string>() ?? "");
                var plain = hit["plainLyrics"]?.GetValue<string>() ?? "";
                var instrumental = hit["instrumental"]?.GetValue<bool>() == true;
                var texts = lines.Count > 0 ? lines.Select(l => l.Text).ToList() : plain.Split('\n').Select(t => t.Trim()).ToList();
                var (trans, lang) = instrumental ? (null, "") : await (_videoTranslate?.Invoke(texts) ?? TranslateAsync(texts));
                var words = new Result(key, lines, plain, instrumental, true, trans, lang, hit["duration"]?.GetValue<double>() ?? 0);
                return new(candidate.Original ? VideoPlain(words) : words, _videoClock.GetUtcNow() + TimeSpan.FromHours(6));
            }
            return Missing(TimeSpan.FromMinutes(5));
        }
        catch (Exception ex)
        {
            log.LogInformation("video lyrics: {Error}", ex.Message);
            return Missing(TimeSpan.FromSeconds(30));
        }
    }
}
