namespace PhoneBox.Agent;

/// <summary>
/// Federano: when a video starts on the PC, the tablet shows a pop-up "Ver no tablet?" that closes by itself after a
/// few seconds (Settings › Federano; default 5 s). Each video is offered once: after "Agora não" or no answer it is not
/// asked again. Videos: a browser tab playing a video (Federano extension) or a known video player (VLC, MPC,
/// PotPlayer, mpv, Filmes e TV).
/// </summary>
public sealed class MirrorOffers(MediaMonitor media, YouTubeTracker browser, MirrorCapture mirror, ConfigStore config)
{
    static readonly string[] VideoPlayers = ["vlc", "mpc-hc64", "mpc-hc", "mpc-be64", "mpc-be", "potplayermini64", "potplayermini", "mpv", "kmplayer"];

    /// <param name="Seconds">How long the pop-up stays without an answer.</param>
    public sealed record Offer(string Id, string Title, string App, int Seconds, int ArtId);

    private readonly object _gate = new();
    private readonly LinkedList<string> _asked = new();   // the last videos offered (each is asked once)

    /// <summary>The video to offer now, or null.</summary>
    public Offer? Current()
    {
        var cfg = config.Get().Federano;
        if (!cfg.MirrorOffer || mirror.Active) return null;
        var snap = media.Snapshot();
        string? id = null;
        if (browser.PlayingTab() is { } tab)
            id = $"tab{tab}|{snap?.Title}";
        else if (snap is { Playing: true } && IsVideoPlayer(media.SourceAppId))
            id = $"{media.SourceAppId}|{snap.Title}";
        if (id is null) return null;
        lock (_gate) if (_asked.Contains(id)) return null;
        return new(id, snap?.Title is { Length: > 0 } t ? t : "Vídeo no PC", snap?.App ?? "",
            Math.Clamp(cfg.MirrorOfferSeconds, 2, 600), snap?.ArtId ?? 0);
    }

    /// <summary>The tablet's answer ("Sim" starts mirroring; the tablet then opens it). Returns an error or null.</summary>
    public string? Answer(string id, bool yes)
    {
        lock (_gate)
        {
            if (!_asked.Contains(id)) _asked.AddLast(id);
            while (_asked.Count > 50) _asked.RemoveFirst();
        }
        return yes ? mirror.Start() : null;
    }

    internal static bool IsVideoPlayer(string? sourceAppId)
    {
        if (string.IsNullOrWhiteSpace(sourceAppId)) return false;
        if (sourceAppId.Contains("ZuneVideo", StringComparison.OrdinalIgnoreCase)) return true;   // Filmes e TV
        var exe = Path.GetFileName(sourceAppId.Trim());
        if (exe.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) exe = exe[..^4];
        return VideoPlayers.Contains(exe.ToLowerInvariant());
    }
}
