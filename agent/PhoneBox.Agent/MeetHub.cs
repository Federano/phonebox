namespace PhoneBox.Agent;

/// <summary>
/// Federano "Reuniões": what the Google Meet tab in Chrome is doing (reported every second by the Federano extension:
/// in a call or not, microphone, camera, raised hand) and the buttons pressed on the tablet, which the extension
/// carries out by clicking Meet's own buttons on its next report. Nothing about the call itself (video, people, chat)
/// passes through here.
/// </summary>
public sealed class MeetHub
{
    public sealed record State(int Tab, bool InCall, bool? Mic, bool? Cam, bool? Hand, string Code, long At);

    private readonly Lock _gate = new();
    private State? _state;
    private string? _pending;
    private long _pendingAt;

    public static readonly string[] Commands = ["mic", "cam", "hand", "leave", "captions"];

    /// <summary>The Meet tab's last report, if it is fresh (the tab is open and the extension running).</summary>
    public State? Current
    {
        get { lock (_gate) return _state is { } s && Environment.TickCount64 - s.At < 5000 ? s : null; }
    }

    /// <summary>From the extension: the tab's state. Returns the button the tablet pressed since, if any (once).</summary>
    public string? Report(State s)
    {
        lock (_gate)
        {
            _state = s with { At = Environment.TickCount64 };
            if (_pending is null || Environment.TickCount64 - _pendingAt > 10_000) { _pending = null; return null; }
            var cmd = _pending; _pending = null;
            return cmd;
        }
    }

    /// <summary>From the tablet: press a Meet button. False when no Meet call is open in Chrome.</summary>
    public bool Press(string cmd)
    {
        if (!Commands.Contains(cmd)) return false;
        lock (_gate)
        {
            if (_state is null || Environment.TickCount64 - _state.At > 5000 || !_state.InCall) return false;
            _pending = cmd; _pendingAt = Environment.TickCount64;
            return true;
        }
    }

    /// <summary>An e-mail address for Meet's authuser (which of the browser's Google accounts joins).</summary>
    public static bool ValidAccount(string? s) =>
        s is not null && s.Trim().Length <= 120 && System.Text.RegularExpressions.Regex.IsMatch(s.Trim(), @"\A[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\z");

    /// <summary>Only a real Meet room address (https://meet.google.com/abc-defg-hij) is opened on the PC.</summary>
    public static bool ValidRoom(string? url) =>
        url is not null && System.Text.RegularExpressions.Regex.IsMatch(url, @"\Ahttps://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}\z");
}
