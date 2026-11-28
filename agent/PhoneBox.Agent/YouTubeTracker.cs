using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

namespace PhoneBox.Agent;

/// <summary>
/// The YouTube video open in the PC's browser, as reported every couple of seconds by the Federano Chrome extension
/// (extras/chrome-federano). Used by the "video.toTablet" skill: the tablet opens the same video at the same time and
/// the extension pauses it on the PC (the pause travels back in the answer to its next report).
/// </summary>
public sealed partial class YouTubeTracker
{
    /// <summary>A report older than this means the tab was closed or the extension stopped.</summary>
    public static readonly TimeSpan Fresh = TimeSpan.FromSeconds(10);

    public sealed record Report(string VideoId, double Time, bool Playing, string Title, long At,
        double PlaybackRate = 1, bool Advancing = true, bool IsAd = false);

    private readonly TimeProvider _clock;
    public YouTubeTracker(TimeProvider? timeProvider = null) => _clock = timeProvider ?? TimeProvider.System;

    private readonly object _gate = new();
    private Report? _last;
    private string? _pauseFor;

    [GeneratedRegex("^[A-Za-z0-9_-]{11}$")]
    private static partial Regex VideoIdRx();

    public static bool ValidId(string? id) => id is not null && VideoIdRx().IsMatch(id);

    /// <summary>Stores a report; returns true when the extension should pause this video now.</summary>
    public bool Update(string videoId, double time, bool playing, string? title,
        double? rate = null, bool? advancing = null, bool isAd = false)
    {
        if (!ValidId(videoId) || !double.IsFinite(time) || time < 0) return false;
        lock (_gate)
        {
            var stamp = _clock.GetTimestamp();
            // An ad has its own currentTime. Keep the song's last position until its video resumes.
            var position = isAd
                ? _last is { } previous && previous.VideoId == videoId && _clock.GetElapsedTime(previous.At, stamp) <= Fresh
                    ? PositionAt(previous, _clock.GetElapsedTime(previous.At, stamp)) : 0
                : Math.Min(time, 86_400 * 7);
            var playbackRate = rate is > 0 and <= 16 && double.IsFinite(rate.Value) ? rate.Value : 1;
            _last = new(videoId, position, playing, (title ?? "").Trim()[..Math.Min((title ?? "").Trim().Length, 200)],
                stamp, playbackRate, playing && (advancing ?? true) && !isAd, isAd);
            if (_pauseFor != videoId) return false;
            _pauseFor = null;
            return playing;
        }
    }

    private static double PositionAt(Report report, TimeSpan age) =>
        report.Time + (report.Advancing ? age.TotalSeconds * report.PlaybackRate : 0);

    /// <summary>The video with its current content position, or null when the extension stopped reporting.</summary>
    public (string VideoId, int Seconds, string Title, bool Playing)? Current()
    {
        lock (_gate)
        {
            if (_last is null) return null;
            var age = _clock.GetElapsedTime(_last.At);
            if (age > Fresh) return null;
            return (_last.VideoId, (int)Math.Floor(PositionAt(_last, age)), _last.Title, _last.Playing);
        }
    }

    public void RequestPause(string videoId) { lock (_gate) _pauseFor = videoId; }

    // ---- Federano "Só ouvir": the YouTube playlist (mix) that follows the playing video, and a pick from it on the tablet
    public sealed record QueueItem(string Id, string Title, string Channel);
    private (IReadOnlyList<QueueItem> Items, long At)? _queue;
    private string? _playNext;

    public void UpdateQueue(IReadOnlyList<QueueItem> items) { lock (_gate) _queue = (items, Stopwatch.GetTimestamp()); }

    /// <summary>The next videos of the YouTube playlist, as the extension last saw them (empty when not reported lately).</summary>
    public IReadOnlyList<QueueItem> Queue()
    {
        lock (_gate) return _queue is { } q && Stopwatch.GetElapsedTime(q.At) < Fresh ? q.Items : [];
    }

    public void RequestPlay(string videoId) { lock (_gate) _playNext = videoId; }
    public string? TakePlay() { lock (_gate) { var v = _playNext; _playNext = null; return v; } }

    /// <summary>The extension's "queue" parameter: [{"v","t","c"}, …], at most 10 valid items.</summary>
    public static IReadOnlyList<QueueItem> ParseQueue(string? json)
    {
        if (string.IsNullOrEmpty(json) || json.Length > 8000) return [];
        try
        {
            return (System.Text.Json.Nodes.JsonNode.Parse(json) as System.Text.Json.Nodes.JsonArray ?? [])
                .OfType<System.Text.Json.Nodes.JsonObject>().Select(n => new QueueItem(n?["v"]?.GetValue<string>() ?? "", (n?["t"]?.GetValue<string>() ?? "").Trim(), (n?["c"]?.GetValue<string>() ?? "").Trim()))
                .Where(q => ValidId(q.Id) && q.Title.Length > 0)
                .Select(q => q with { Title = q.Title[..Math.Min(q.Title.Length, 150)], Channel = q.Channel[..Math.Min(q.Channel.Length, 80)] })
                .Take(10).ToList();
        }
        catch (System.Text.Json.JsonException) { return []; }
        catch (InvalidOperationException) { return []; }
    }

    /// <summary>The extension's millisecond clock for this exact video; never borrow another tab's position.</summary>
    public (string VideoId, long PosMs, bool Playing, double PlaybackRate, bool Advancing, bool IsAd)? PositionFor(string title)
    {
        lock (_gate)
        {
            if (_last is null || string.IsNullOrWhiteSpace(title) || !string.Equals(
                _last.Title.Normalize(NormalizationForm.FormC), title.Trim().Normalize(NormalizationForm.FormC),
                StringComparison.OrdinalIgnoreCase)) return null;
            var age = _clock.GetElapsedTime(_last.At);
            if (age > Fresh) return null;
            return (_last.VideoId, (long)Math.Round(PositionAt(_last, age) * 1000), _last.Playing,
                _last.PlaybackRate, _last.Advancing, _last.IsAd);
        }
    }

    // ---- Federano mirroring: where the playing <video> is inside the browser window (physical pixels)
    private (int X, int Y, int Width, int Height, long At)? _rect;

    public void UpdateRect(int x, int y, int width, int height)
    {
        lock (_gate) _rect = width > 0 && height > 0 ? (x, y, width, height, Stopwatch.GetTimestamp()) : null;
    }

    /// <summary>The playing video's rectangle, if the extension reported one in the last few seconds.</summary>
    public (int X, int Y, int Width, int Height)? VideoRect()
    {
        lock (_gate)
            return _rect is { } r && Stopwatch.GetElapsedTime(r.At) < TimeSpan.FromSeconds(4) ? (r.X, r.Y, r.Width, r.Height) : null;
    }

    // ---- Federano mirroring: the browser tab playing a video (the extension sends that tab's frames)
    private (int Tab, long At)? _playingTab;

    private readonly Dictionary<int, bool> _tabPlaying = [];
    private int? _pauseTab;

    /// <summary>Stores a tab's report; returns true when this tab's video has just started playing.</summary>
    public bool ReportTab(int tab, bool playing)
    {
        lock (_gate)
        {
            if (playing && tab >= 0) _playingTab = (tab, Stopwatch.GetTimestamp());
            var started = playing && !_tabPlaying.GetValueOrDefault(tab);
            if (_tabPlaying.Count > 50) _tabPlaying.Clear();
            _tabPlaying[tab] = playing;
            return started;
        }
    }

    /// <summary>Federano: pause this tab's video at its next report (the mirrored video when another one starts on the PC).</summary>
    public void RequestPauseTab(int tab) { lock (_gate) _pauseTab = tab; }

    public bool TakePauseTab(int tab)
    {
        lock (_gate)
        {
            if (_pauseTab != tab) return false;
            _pauseTab = null;
            return true;
        }
    }

    /// <summary>The tab that reported a playing video in the last few seconds.</summary>
    public int? PlayingTab()
    {
        lock (_gate)
            return _playingTab is { } t && Stopwatch.GetElapsedTime(t.At) < TimeSpan.FromSeconds(4) ? t.Tab : null;
    }

    // ---- the video's rectangle in each tab, as fractions of the page (fx, fy, fw, fh) and the page's shape (ar)
    public sealed record PageRect(double Fx, double Fy, double Fw, double Fh, double Ar);
    private readonly Dictionary<int, PageRect> _pageRects = [];

    public void UpdatePageRect(int tab, PageRect r)
    {
        if (r.Fw <= 0 || r.Fh <= 0 || r.Fw > 1.01 || r.Fh > 1.01 || r.Ar <= 0) return;
        lock (_gate)
        {
            if (_pageRects.Count > 50 && !_pageRects.ContainsKey(tab)) _pageRects.Clear();
            _pageRects[tab] = r;
        }
    }

    public PageRect? PageRectOf(int tab) { lock (_gate) return _pageRects.GetValueOrDefault(tab); }

    public static string WatchUrl(string videoId, int seconds) =>
        $"https://www.youtube.com/watch?v={videoId}" + (seconds > 0 ? $"&t={seconds}s" : "");

    public static string Clock(int seconds) =>
        seconds >= 3600 ? $"{seconds / 3600}:{seconds / 60 % 60:00}:{seconds % 60:00}" : $"{seconds / 60}:{seconds % 60:00}";
}
