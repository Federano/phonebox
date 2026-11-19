namespace PhoneBox.Agent;

/// <summary>Federano mirroring is Windows-only for now (Windows.Graphics.Capture).</summary>
public sealed class MirrorCapture(ILogger<MirrorCapture> log, MediaMonitor media, YouTubeTracker browser) : IDisposable
{
    public bool Active => false;
    public string Title => "";
    public static bool Supported => false;
    public string? Start() { _ = (log, media, browser); return "Espelhamento só funciona no Windows por enquanto."; }
    public void Stop() { }
    public bool WantsTab(int tab) => false;
    public bool PushFrame(int tab, byte[] jpeg) => false;
    public Task<(byte[] Jpeg, long Seq)?> NextFrameAsync(long after, TimeSpan wait, CancellationToken ct) => Task.FromResult<(byte[], long)?>(null);
    public void Dispose() { }
}
