using System.Diagnostics;
using System.Runtime.InteropServices;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using WinRT;

namespace PhoneBox.Agent;

/// <summary>
/// Federano mirroring: captures the window of the app playing media (Windows.Graphics.Capture, no driver) and keeps
/// the latest frame as a JPEG. The tablet pulls frames with GET /api/mirror/frame. For a browser video, the Chrome
/// extension's on-screen rectangle crops the frame to just the video. Capture runs only while the tablet asks for
/// frames: it stops by itself a few seconds after the last request. Video and sound keep playing on the PC.
/// </summary>
public sealed class MirrorCapture(ILogger<MirrorCapture> log, MediaMonitor media, YouTubeTracker browser) : IDisposable
{
    public const int MaxWidth = 1600;
    public const double Quality = 0.72;
    private static readonly TimeSpan Idle = TimeSpan.FromSeconds(4);

    private readonly object _gate = new();
    private IDirect3DDevice? _device;
    private GraphicsCaptureItem? _item;
    private Direct3D11CaptureFramePool? _pool;
    private GraphicsCaptureSession? _session;
    private IntPtr _hwnd;
    private string _title = "";
    private bool _browserWindow;
    private int? _browserTab;      // browser mode: the tab whose video the extension sends
    private long _lastAsk;
    private int _encoding;
    private byte[]? _jpeg;
    private long _seq;
    private readonly SemaphoreSlim _frameReady = new(0, int.MaxValue);
    private System.Threading.Timer? _idleTimer;

    private int _openOnTablet;

    /// <summary>True once after mirroring was started from the PC (Federano icon in Chrome): the tablet opens it.</summary>
    public bool TakeOpenRequest() => Interlocked.Exchange(ref _openOnTablet, 0) == 1 && Active;

    public bool Active { get { lock (_gate) return _session is not null || _browserTab is not null; } }

    /// <summary>True when the extension in <paramref name="tab"/> should send its video's frames.</summary>
    public bool WantsTab(int tab) { lock (_gate) return _browserTab == tab; }

    /// <summary>A frame of the locked tab's video, sent by the extension.</summary>
    public bool PushFrame(int tab, byte[] jpeg)
    {
        lock (_gate)
        {
            if (_browserTab != tab || jpeg.Length < 4 || jpeg[0] != 0xFF || jpeg[1] != 0xD8) return false;
            _jpeg = jpeg; _seq++;
        }
        _frameReady.Release();
        return true;
    }
    public string Title { get { lock (_gate) return _title; } }

    public static bool Supported => GraphicsCaptureSession.IsSupported();

    /// <summary>
    /// Starts mirroring. A video playing in the browser (reported by the Federano extension) is sent by the extension
    /// itself, locked to that tab: other tabs or windows in front on the PC do not change it. Otherwise the media app's
    /// own window is captured (never whatever window is in front). Returns an error or null.
    /// </summary>
    public string? Start(int? requestedTab = null)
    {
        if ((requestedTab ?? browser.PlayingTab()) is { } tab)
        {
            lock (_gate)
            {
                _lastAsk = Stopwatch.GetTimestamp();
                if (_browserTab == tab) return null;
                StopLocked();
                _browserTab = tab;
                _title = media.Snapshot()?.Title ?? "";
                _idleTimer ??= new System.Threading.Timer(_ => StopWhenIdle(), null, 1000, 1000);
            }
            log.LogInformation("mirror: browser tab {Tab} (video only)", tab);
            if (requestedTab is not null) Interlocked.Exchange(ref _openOnTablet, 1);
            return null;
        }
        if (!Supported) return "Este Windows não suporta captura de janela.";
        var (hwnd, title) = FindMediaWindow(media.SourceAppId);
        if (hwnd == IntPtr.Zero) return "Não achei a janela do player no PC.";
        lock (_gate)
        {
            _lastAsk = Stopwatch.GetTimestamp();
            if (_session is not null && hwnd == _hwnd) return null;
            StopLocked();
            try
            {
                _device ??= CreateDevice();
                _item = CreateItemForWindow(hwnd);
                _pool = Direct3D11CaptureFramePool.CreateFreeThreaded(_device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, _item.Size);
                _pool.FrameArrived += OnFrame;
                _session = _pool.CreateCaptureSession(_item);
                try { _session.IsCursorCaptureEnabled = false; } catch { }
                _session.StartCapture();
                _hwnd = hwnd; _title = title;
                _browserWindow = IsBrowser(ExeName(media.SourceAppId));
                _idleTimer ??= new System.Threading.Timer(_ => StopWhenIdle(), null, 1000, 1000);
                log.LogInformation("mirror: capturing \"{Title}\"", title);
                return null;
            }
            catch (Exception ex)
            {
                log.LogWarning("mirror: capture failed: {Error}", ex.Message);
                StopLocked();
                return "Não consegui capturar a janela do player.";
            }
        }
    }

    public void Stop() { lock (_gate) StopLocked(); }

    /// <summary>The next frame newer than <paramref name="after"/> (waits up to <paramref name="wait"/>), or null.</summary>
    public async Task<(byte[] Jpeg, long Seq)?> NextFrameAsync(long after, TimeSpan wait, CancellationToken ct)
    {
        var until = Stopwatch.GetTimestamp() + (long)(wait.TotalSeconds * Stopwatch.Frequency);
        while (true)
        {
            lock (_gate)
            {
                _lastAsk = Stopwatch.GetTimestamp();
                if (_jpeg is not null && _seq > after) return (_jpeg, _seq);
                if (_session is null && _browserTab is null) return null;
            }
            var left = TimeSpan.FromSeconds((until - Stopwatch.GetTimestamp()) / (double)Stopwatch.Frequency);
            if (left <= TimeSpan.Zero) return null;
            await _frameReady.WaitAsync(left, ct);
        }
    }

    private void StopWhenIdle()
    {
        lock (_gate)
        {
            if ((_session is not null || _browserTab is not null) && Stopwatch.GetElapsedTime(_lastAsk) > Idle) { log.LogInformation("mirror: stopped (tablet idle)"); StopLocked(); }
        }
    }

    private void StopLocked()
    {
        try { if (_pool is not null) _pool.FrameArrived -= OnFrame; } catch { }
        try { _session?.Dispose(); } catch { }
        try { _pool?.Dispose(); } catch { }
        _session = null; _pool = null; _item = null; _hwnd = IntPtr.Zero; _jpeg = null; _browserTab = null;
    }

    private void OnFrame(Direct3D11CaptureFramePool sender, object args)
    {
        using var frame = sender.TryGetNextFrame();
        if (frame is null) return;
        // one encode at a time: frames that arrive meanwhile are dropped (the tablet only needs the newest)
        if (Interlocked.Exchange(ref _encoding, 1) == 1) return;
        try
        {
            var size = frame.ContentSize;
            lock (_gate)
            {
                if (_pool is null || _item is null) return;
                if (size.Width != _item.Size.Width || size.Height != _item.Size.Height)
                    _pool.Recreate(_device, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, size);
            }
            var bitmap = SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface, BitmapAlphaMode.Ignore).AsTask().GetAwaiter().GetResult();
            _ = EncodeAsync(bitmap);
        }
        catch (Exception ex) { log.LogDebug("mirror frame: {Error}", ex.Message); Interlocked.Exchange(ref _encoding, 0); }
    }

    private async Task EncodeAsync(SoftwareBitmap bitmap)
    {
        try
        {
            using (bitmap)
            {
                var crop = CropRect(bitmap.PixelWidth, bitmap.PixelHeight);
                var scale = Math.Min(1.0, MaxWidth / (double)crop.Width);
                using var ms = new InMemoryRandomAccessStream();
                var options = new BitmapPropertySet { ["ImageQuality"] = new BitmapTypedValue(Quality, Windows.Foundation.PropertyType.Single) };
                var enc = await BitmapEncoder.CreateAsync(BitmapEncoder.JpegEncoderId, ms, options);
                enc.SetSoftwareBitmap(bitmap);
                enc.BitmapTransform.ScaledWidth = (uint)Math.Max(2, Math.Round(bitmap.PixelWidth * scale));
                enc.BitmapTransform.ScaledHeight = (uint)Math.Max(2, Math.Round(bitmap.PixelHeight * scale));
                enc.BitmapTransform.InterpolationMode = BitmapInterpolationMode.Linear;
                enc.BitmapTransform.Bounds = new BitmapBounds
                {
                    X = (uint)(crop.X * scale), Y = (uint)(crop.Y * scale),
                    Width = (uint)Math.Max(2, crop.Width * scale), Height = (uint)Math.Max(2, crop.Height * scale),
                };
                await enc.FlushAsync();
                var bytes = new byte[ms.Size];
                ms.Seek(0);
                using (var reader = new DataReader(ms.GetInputStreamAt(0)))
                {
                    await reader.LoadAsync((uint)ms.Size);
                    reader.ReadBytes(bytes);
                }
                lock (_gate) { if (_session is null) return; _jpeg = bytes; _seq++; }
                _frameReady.Release();
            }
        }
        catch (Exception ex) { log.LogDebug("mirror encode: {Error}", ex.Message); }
        finally { Interlocked.Exchange(ref _encoding, 0); }
    }

    /// <summary>The video's rectangle inside the window frame (from the browser extension), else the whole frame.</summary>
    private (int X, int Y, int Width, int Height) CropRect(int w, int h)
    {
        var whole = (0, 0, w, h);
        bool crop;
        lock (_gate) crop = _browserWindow;
        if (!crop || browser.VideoRect() is not { } r) return whole;
        int x = Math.Clamp(r.X, 0, w - 2), y = Math.Clamp(r.Y, 0, h - 2);
        int cw = Math.Clamp(r.Width, 2, w - x), ch = Math.Clamp(r.Height, 2, h - y);
        // a rectangle that is most of the frame, or tiny, is not worth cropping to
        if (cw * ch < 0.04 * w * h) return whole;
        return (x, y, cw, ch);
    }

    // ------------------------------------------------------------------ finding the player's window

    internal static (IntPtr Hwnd, string Title) FindMediaWindow(string? sourceAppId)
    {
        var exe = ExeName(sourceAppId);
        if (exe is not null)
        {
            var best = (Hwnd: IntPtr.Zero, Title: "", Area: 0L);
            var pids = Process.GetProcessesByName(exe).Select(p => (uint)p.Id).ToHashSet();
            if (pids.Count > 0)
            {
                EnumWindows((h, _) =>
                {
                    if (!IsWindowVisible(h) || IsIconic(h)) return true;
                    GetWindowThreadProcessId(h, out var pid);
                    if (!pids.Contains(pid)) return true;
                    var title = WindowTitle(h);
                    if (title.Length == 0 || !GetWindowRect(h, out var rc)) return true;
                    long area = (long)(rc.Right - rc.Left) * (rc.Bottom - rc.Top);
                    if (area > best.Area) best = (h, title, area);
                    return true;
                }, IntPtr.Zero);
                if (best.Hwnd != IntPtr.Zero) return (best.Hwnd, best.Title);
            }
        }
        return (IntPtr.Zero, "");
    }

    internal static bool IsBrowser(string? exe) =>
        exe is not null && new[] { "chrome", "msedge", "brave", "opera", "vivaldi", "firefox" }.Contains(exe.ToLowerInvariant());

    /// <summary>"chrome.exe" → "chrome"; "Microsoft.ZuneVideo_8wekyb3d8bbwe!Microsoft.ZuneVideo" → null.</summary>
    internal static string? ExeName(string? id)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Contains('!')) return null;
        var name = Path.GetFileName(id.Trim());
        return name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? name[..^4] : name;
    }

    private static string WindowTitle(IntPtr h)
    {
        var len = GetWindowTextLength(h);
        if (len <= 0) return "";
        var buf = new char[len + 1];
        var n = GetWindowText(h, buf, buf.Length);
        return new string(buf, 0, n);
    }

    // ------------------------------------------------------------------ Direct3D / WinRT interop

    private static IDirect3DDevice CreateDevice()
    {
        const uint D3D11_CREATE_DEVICE_BGRA_SUPPORT = 0x20;
        var hr = D3D11CreateDevice(IntPtr.Zero, 1 /* hardware */, IntPtr.Zero, D3D11_CREATE_DEVICE_BGRA_SUPPORT, IntPtr.Zero, 0, 7 /* SDK */,
            out var d3d, out _, out var ctx);
        if (hr < 0) hr = D3D11CreateDevice(IntPtr.Zero, 5 /* WARP */, IntPtr.Zero, D3D11_CREATE_DEVICE_BGRA_SUPPORT, IntPtr.Zero, 0, 7, out d3d, out _, out ctx);
        Marshal.ThrowExceptionForHR(hr);
        try
        {
            var dxgiGuid = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(d3d, in dxgiGuid, out var dxgi));
            try
            {
                Marshal.ThrowExceptionForHR(CreateDirect3D11DeviceFromDXGIDevice(dxgi, out var inspectable));
                try { return MarshalInterface<IDirect3DDevice>.FromAbi(inspectable); }
                finally { Marshal.Release(inspectable); }
            }
            finally { Marshal.Release(dxgi); }
        }
        finally { Marshal.Release(d3d); if (ctx != IntPtr.Zero) Marshal.Release(ctx); }
    }

    [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IGraphicsCaptureItemInterop
    {
        IntPtr CreateForWindow([In] IntPtr window, [In] ref Guid iid);
        IntPtr CreateForMonitor([In] IntPtr monitor, [In] ref Guid iid);
    }

    private static GraphicsCaptureItem CreateItemForWindow(IntPtr hwnd)
    {
        var factory = WinRT.ActivationFactory.Get("Windows.Graphics.Capture.GraphicsCaptureItem");
        var interop = factory.AsInterface<IGraphicsCaptureItemInterop>();
        var iid = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760"); // IGraphicsCaptureItem
        var ptr = interop.CreateForWindow(hwnd, ref iid);
        try { return GraphicsCaptureItem.FromAbi(ptr); }
        finally { Marshal.Release(ptr); }
    }

    [DllImport("d3d11.dll")]
    private static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr software, uint flags, IntPtr featureLevels,
        uint featureLevelsCount, uint sdkVersion, out IntPtr device, out int featureLevel, out IntPtr context);

    [DllImport("d3d11.dll")]
    private static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice, out IntPtr graphicsDevice);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr h, [Out] char[] buf, int max);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr h, out RECT r);
    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }

    public void Dispose() { _idleTimer?.Dispose(); Stop(); }
}
