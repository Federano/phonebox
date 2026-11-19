namespace PhoneBox.Agent;

/// <summary>Federano mirroring: running averages of how old a frame is at each stage (ms).</summary>
public sealed class MirrorLatency
{
    private readonly object _gate = new();
    private readonly Dictionary<string, (double Sum, int Count, long Max)> _stages = [];
    private DateTime _since = DateTime.UtcNow;

    public void Add(string stage, long ms)
    {
        if (ms < 0 || ms > 120_000) return;
        lock (_gate)
        {
            _stages.TryGetValue(stage, out var s);
            _stages[stage] = (s.Sum + ms, s.Count + 1, Math.Max(s.Max, ms));
        }
    }

    /// <summary>"chegada 40 ms (máx 80, 25/s) · saida ..." for the last few seconds, then starts over; null if nothing.</summary>
    public string? TakeSummary(TimeSpan every)
    {
        lock (_gate)
        {
            var secs = (DateTime.UtcNow - _since).TotalSeconds;
            if (secs < every.TotalSeconds || _stages.Count == 0) return null;
            var text = string.Join(" · ", _stages.Select(kv =>
                $"{kv.Key} {kv.Value.Sum / kv.Value.Count:0} ms (máx {kv.Value.Max}, {kv.Value.Count / secs:0.0}/s)"));
            _stages.Clear();
            _since = DateTime.UtcNow;
            return text;
        }
    }
}
