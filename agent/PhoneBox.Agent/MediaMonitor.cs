using Windows.Media.Control;

namespace PhoneBox.Agent;

/// <summary>Watches and controls the current Windows media session (Spotify, browsers, ...).</summary>
public sealed class MediaMonitor(ILogger<MediaMonitor> log) : BackgroundService
{
    private GlobalSystemMediaTransportControlsSessionManager? _mgr;
    private volatile MediaSnapshot? _snap;
    private readonly MediaArtworkCache _art = new();
    private readonly SemaphoreSlim _pollGate = new(1, 1);
    private GlobalSystemMediaTransportControlsSession? _observed;
    private long _revision;

    public AlbumArt? Art => _art.Current;
    public MediaSnapshot? Snapshot() => _snap;
    /// <summary>Federano: the media app's id (e.g. "chrome.exe", "Spotify.exe"), to find its window for mirroring.</summary>
    public string? SourceAppId { get { try { return _observed?.SourceAppUserModelId; } catch { return null; } } }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    if (_mgr is null)
                    {
                        _mgr = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
                        _mgr.CurrentSessionChanged += SessionChanged;
                    }
                    await Poll(ct);
                }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                catch (Exception ex)
                {
                    log.LogDebug("media: {Msg}", ex.Message);
                    _snap = null;
                }
                await Task.Delay(1000, ct);
            }
        }
        finally
        {
            if (_mgr is not null) _mgr.CurrentSessionChanged -= SessionChanged;
            Observe(null);
            _art.Clear();
        }
    }

    private void SessionChanged(GlobalSystemMediaTransportControlsSessionManager sender, CurrentSessionChangedEventArgs args) { Interlocked.Increment(ref _revision); PollSoon(); }
    private void PropertiesChanged(GlobalSystemMediaTransportControlsSession sender, MediaPropertiesChangedEventArgs args) { Interlocked.Increment(ref _revision); PollSoon(); }
    // Federano: a pause, a seek or a new song reaches the tablet the moment Windows reports it, not at the next 1 s poll
    private void PlaybackChanged(GlobalSystemMediaTransportControlsSession sender, PlaybackInfoChangedEventArgs args) => PollSoon();
    private void TimelineChanged(GlobalSystemMediaTransportControlsSession sender, TimelinePropertiesChangedEventArgs args) => PollSoon();
    private int _pollSoon;
    private void PollSoon()
    {
        if (_mgr is null || Interlocked.Exchange(ref _pollSoon, 1) == 1) return;
        _ = Task.Run(async () =>
        {
            try { await Task.Delay(60); Interlocked.Exchange(ref _pollSoon, 0); await Poll(); }
            catch (Exception ex) { Interlocked.Exchange(ref _pollSoon, 0); log.LogDebug("media: {Msg}", ex.Message); }
        });
    }
    private void Observe(GlobalSystemMediaTransportControlsSession? session)
    {
        if (ReferenceEquals(session, _observed)) return;
        if (_observed is not null)
        {
            _observed.MediaPropertiesChanged -= PropertiesChanged;
            try { _observed.PlaybackInfoChanged -= PlaybackChanged; _observed.TimelinePropertiesChanged -= TimelineChanged; } catch { }
        }
        _observed = session;
        if (_observed is not null)
        {
            _observed.MediaPropertiesChanged += PropertiesChanged;
            try { _observed.PlaybackInfoChanged += PlaybackChanged; _observed.TimelinePropertiesChanged += TimelineChanged; } catch { }
        }
    }

    private async Task Poll(CancellationToken ct = default)
    {
        await _pollGate.WaitAsync(ct);
        var before = _snap;
        try { await PollCore(ct); }
        finally
        {
            _pollGate.Release();
            // a new track, a pause or a seek reaches the phone now, not at its next whole-second state
            if (StateSignal.MediaChanged(before, _snap)) StateSignal.Poke();
        }
    }

    private async Task PollCore(CancellationToken ct)
    {
        var s = Pick();
        Observe(s);
        if (s is null) { _snap = null; _art.Clear(); return; }
        var revision = Interlocked.Read(ref _revision);

        var props = await s.TryGetMediaPropertiesAsync();
        var pb = s.GetPlaybackInfo();
        var tl = s.GetTimelineProperties();
        var playing = pb.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;

        var key = $"{s.SourceAppUserModelId}|{props.Title}|{props.Artist}";
        // Refresh after metadata events and while a new track's thumbnail is still settling.
        try
        {
            await _art.UpdateAsync(key, revision, props.Thumbnail is { } thumb ? async token =>
            {
                using var stream = await thumb.OpenReadAsync();
                if (stream.Size > 8 * 1024 * 1024) return null;
                using var ms = new MemoryStream();
                await stream.AsStreamForRead().CopyToAsync(ms, token);
                return ms.Length > 0 ? new AlbumArt(ms.ToArray(), string.IsNullOrEmpty(stream.ContentType) ? "image/png" : stream.ContentType) : null;
            } : null, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) { log.LogDebug("cover art: {Msg}", ex.Message); }

        var sampledAt = System.Diagnostics.Stopwatch.GetTimestamp();
        var pos = tl.Position;
        if (playing && tl.LastUpdatedTime.Year > 2000)
            pos += DateTimeOffset.Now - tl.LastUpdatedTime;
        var dur = tl.EndTime - tl.StartTime;
        if (dur > TimeSpan.Zero && pos > dur) pos = dur;
        if (pos < TimeSpan.Zero) pos = TimeSpan.Zero;

        _snap = new MediaSnapshot(
            App: FriendlyApp(s.SourceAppUserModelId),
            Title: props.Title ?? "",
            Artist: props.Artist ?? "",
            Album: props.AlbumTitle ?? "",
            Playing: playing,
            PosMs: (long)pos.TotalMilliseconds,
            DurMs: (long)Math.Max(0, dur.TotalMilliseconds),
            ArtId: Art is null ? 0 : _art.Id,
            CanSeek: pb.Controls.IsPlaybackPositionEnabled) { SampledAt = sampledAt };
    }

    public async Task<bool> Control(string action, long? ms)
    {
        var s = Pick();
        if (s is null)
        {
            // No session: send the media key instead (wakes up Spotify, for example).
            if (action == "playpause") { Keys.Tap(Keys.VK_MEDIA_PLAY_PAUSE); return true; }
            return false;
        }
        var ok = action switch
        {
            "playpause" => await s.TryTogglePlayPauseAsync(),
            "next" => await s.TrySkipNextAsync(),
            "prev" => await s.TrySkipPreviousAsync(),
            "seek" when ms is { } m => await s.TryChangePlaybackPositionAsync(TimeSpan.FromMilliseconds(m).Ticks),
            // Federano: relative seek (e.g. -10000 / +10000) from where the player is now
            "seekby" when ms is { } d && SeekTarget(_snap, d) is { } to => await s.TryChangePlaybackPositionAsync(TimeSpan.FromMilliseconds(to).Ticks),
            "pause" => s.GetPlaybackInfo().PlaybackStatus != GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing || await s.TryPauseAsync(),
            "play" => s.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing || await s.TryPlayAsync(),
            _ => false,
        };
        try { await Poll(); } catch { }
        return ok;
    }

    /// <summary>Where a relative seek lands: the position now (a playing track moved on since it was read) plus
    /// <paramref name="deltaMs"/>, kept inside the track. Null when the player cannot seek.</summary>
    internal static long? SeekTarget(MediaSnapshot? m, long deltaMs)
    {
        if (m is null || !m.CanSeek) return null;
        var now = m.PosMs + (m.Playing ? m.AgeMs : 0);
        var to = Math.Max(0, now + deltaMs);
        if (m.DurMs > 0) to = Math.Min(to, Math.Max(0, m.DurMs - 1000));
        return to;
    }

    /// <summary>Federano: true while a browser video is mirrored to the tablet. The browser's media session is then
    /// the one shown and controlled, even when Windows still calls another app (e.g. a paused Spotify) the current one.</summary>
    public volatile bool PreferBrowser;

    static readonly string[] Browsers = ["chrome", "msedge", "brave", "opera", "vivaldi", "firefox", "308046b0af4a39cb"];
    internal static bool IsBrowserApp(string? id) =>
        id is not null && Browsers.Any(b => id.Contains(b, StringComparison.OrdinalIgnoreCase));

    private GlobalSystemMediaTransportControlsSession? Pick()
    {
        var current = _mgr?.GetCurrentSession();
        if (!PreferBrowser || _mgr is null) return PreferPlaying(current);
        try
        {
            if (current is not null && IsBrowserApp(current.SourceAppUserModelId)) return current;
            var browsers = _mgr.GetSessions().Where(x => IsBrowserApp(x.SourceAppUserModelId)).ToList();
            return browsers.FirstOrDefault(x => x.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                ?? browsers.FirstOrDefault() ?? current;
        }
        catch { return current; }
    }

    /// <summary>Federano: Windows' "current" session can stay on a paused browser tab while Spotify plays; then the one
    /// actually playing wins, Spotify first.</summary>
    private GlobalSystemMediaTransportControlsSession? PreferPlaying(GlobalSystemMediaTransportControlsSession? current)
    {
        try
        {
            static bool Playing(GlobalSystemMediaTransportControlsSession x) =>
                x.GetPlaybackInfo().PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            static bool IsSpotify(GlobalSystemMediaTransportControlsSession x) =>
                x.SourceAppUserModelId?.Contains("spotify", StringComparison.OrdinalIgnoreCase) == true;
            var playing = (_mgr?.GetSessions() ?? []).Where(Playing).ToList();
            if (playing.Count == 0) return current;
            return playing.FirstOrDefault(IsSpotify) ?? (current is not null && Playing(current) ? current : playing[0]);
        }
        catch { return current; }
    }

    public async Task<bool> PauseAsync()
    {
        var s = Pick();
        if (s is null || s.GetPlaybackInfo().PlaybackStatus != GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
            return false;
        var ok = await s.TryPauseAsync();
        try { await Poll(); } catch { }
        return ok;
    }

    private static string FriendlyApp(string id)
    {
        var l = id.ToLowerInvariant();
        if (l.Contains("spotify")) return "Spotify";
        if (l.Contains("chrome")) return "Chrome";
        if (l.Contains("firefox") || l.Contains("308046b0af4a39cb")) return "Firefox";
        if (l.Contains("msedge")) return "Edge";
        if (l.Contains("zune") || l.Contains("media")) return "Media Player";
        if (l.Contains("vlc")) return "VLC";
        return Path.GetFileNameWithoutExtension(id.Split('!')[0]);
    }
}
