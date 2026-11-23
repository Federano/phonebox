using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PhoneBox.Agent;

/// <summary>
/// Federano "Reuniões": reads today's meetings from Google Calendar with the user's own sign-in (OAuth for an installed
/// app, PKCE, read-only calendar scope), for work accounts whose calendar cannot be shared by an iCal address. The
/// client id/secret the user created in Google Cloud and the refresh token stay in a file next to the settings, on this
/// computer only; nothing is sent anywhere but Google.
/// </summary>
public sealed class GoogleCalendar
{
    private sealed record Creds(string ClientId, string ClientSecret, string Refresh, string Email);
    private sealed record Pending(string State, string Verifier, string ClientId, string ClientSecret, long Expires);
    public const string Scope = "https://www.googleapis.com/auth/calendar.events.readonly";

    private readonly ConfigStore _config;
    private readonly AgentEndpoint _endpoint;
    private readonly ILogger<GoogleCalendar> _log;
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(15) };
    private readonly Lock _gate = new();
    private Pending? _pending;
    private (string Token, long Expires)? _access;
    private (long At, List<CalendarEvent> Events, string? Error)? _cache;

    public GoogleCalendar(ConfigStore config, AgentEndpoint endpoint, ILogger<GoogleCalendar> log) { _config = config; _endpoint = endpoint; _log = log; }
    private string CredPath => _config.Path + ".google.json";
    public string RedirectUri => $"http://127.0.0.1:{_endpoint.Port}/api/google/callback";
    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    private static string B64(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private Creds? Load()
    {
        try { return File.Exists(CredPath) ? JsonSerializer.Deserialize<Creds>(File.ReadAllText(CredPath)) : null; } catch { return null; }
    }
    private void Store(Creds? c)
    {
        if (c is null) { try { File.Delete(CredPath); } catch { } return; }
        var tmp = CredPath + ".tmp";
        AppPaths.WriteAllTextPrivate(tmp, JsonSerializer.Serialize(c));
        File.Move(tmp, CredPath, overwrite: true);
    }

    public bool Connected => Load() is { Refresh.Length: > 0 };
    public string? Email => Load()?.Email is { Length: > 0 } e ? e : null;

    /// <summary>Starts the sign-in: the Google page to open in the browser.</summary>
    public string Begin(string clientId, string clientSecret)
    {
        clientId = clientId.Trim(); clientSecret = clientSecret.Trim();
        if (!clientId.EndsWith(".apps.googleusercontent.com", StringComparison.Ordinal) || clientId.Length > 200) throw new InvalidOperationException("Client ID inválido: ele termina com .apps.googleusercontent.com");
        if (clientSecret.Length is 0 or > 200) throw new InvalidOperationException("Cole também o Client secret");
        var p = new Pending(B64(RandomNumberGenerator.GetBytes(24)), B64(RandomNumberGenerator.GetBytes(48)), clientId, clientSecret, Now + 600_000);
        lock (_gate) _pending = p;
        var q = new Dictionary<string, string>
        {
            ["client_id"] = clientId, ["redirect_uri"] = RedirectUri, ["response_type"] = "code", ["scope"] = "openid email " + Scope,
            ["access_type"] = "offline", ["prompt"] = "consent", ["state"] = p.State,
            ["code_challenge"] = B64(SHA256.HashData(Encoding.ASCII.GetBytes(p.Verifier))), ["code_challenge_method"] = "S256",
        };
        return "https://accounts.google.com/o/oauth2/v2/auth?" + string.Join('&', q.Select(kv => Uri.EscapeDataString(kv.Key) + "=" + Uri.EscapeDataString(kv.Value)));
    }

    public bool HasPendingState(string? state)
    {
        lock (_gate) return !string.IsNullOrEmpty(state) && _pending is { } p && p.Expires > Now
            && CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(state), Encoding.UTF8.GetBytes(p.State));
    }

    /// <summary>Google sent the user back with a code: trade it for the refresh token and keep it.</summary>
    public async Task<string?> Complete(string state, string code, CancellationToken ct)
    {
        Pending p;
        lock (_gate) { if (!HasPendingState(state) || code.Length is 0 or > 4096) return "O login expirou. Comece de novo pelas configurações."; p = _pending!; _pending = null; }
        var j = await Token(new() { ["client_id"] = p.ClientId, ["client_secret"] = p.ClientSecret, ["code"] = code, ["code_verifier"] = p.Verifier,
            ["grant_type"] = "authorization_code", ["redirect_uri"] = RedirectUri }, ct);
        if (j?["refresh_token"]?.GetValue<string>() is not { Length: > 0 } refresh) return "O Google não devolveu a autorização. Tente de novo.";
        var email = "";
        if (j["id_token"]?.GetValue<string>() is { } idt && idt.Split('.') is { Length: 3 } parts)
            try { email = JsonNode.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(Pad(parts[1]))))?["email"]?.GetValue<string>() ?? ""; } catch { }
        Store(new(p.ClientId, p.ClientSecret, refresh, email));
        lock (_gate) { _access = j["access_token"]?.GetValue<string>() is { } a ? (a, Now + 3_300_000) : null; _cache = null; }
        _log.LogInformation("google calendar connected");
        return null;
    }
    private static string Pad(string s) { s = s.Replace('-', '+').Replace('_', '/'); return s + new string('=', (4 - s.Length % 4) % 4); }

    public void Disconnect() { lock (_gate) { _access = null; _cache = null; _pending = null; } Store(null); }

    private async Task<JsonNode?> Token(Dictionary<string, string> form, CancellationToken ct)
    {
        using var r = await _http.PostAsync("https://oauth2.googleapis.com/token", new FormUrlEncodedContent(form), ct);
        var text = await r.Content.ReadAsStringAsync(ct);
        if (!r.IsSuccessStatusCode) { _log.LogWarning("google token: HTTP {Code}", (int)r.StatusCode); return null; }
        return JsonNode.Parse(text);
    }

    private async Task<string?> Access(CancellationToken ct)
    {
        lock (_gate) if (_access is { } a && a.Expires > Now) return a.Token;
        var c = Load();
        if (c is not { Refresh.Length: > 0 }) return null;
        var j = await Token(new() { ["client_id"] = c.ClientId, ["client_secret"] = c.ClientSecret, ["refresh_token"] = c.Refresh, ["grant_type"] = "refresh_token" }, ct);
        if (j?["access_token"]?.GetValue<string>() is not { Length: > 0 } token) return null;
        var secs = j["expires_in"]?.GetValue<int>() ?? 3600;
        lock (_gate) _access = (token, Now + Math.Max(60, secs - 60) * 1000L);
        return token;
    }

    /// <summary>Today's events of the signed-in account's main calendar (read at most every 2 minutes).</summary>
    public async Task<(List<CalendarEvent> Events, string? Error)> Today(CancellationToken ct)
    {
        lock (_gate) if (_cache is { } c && Now - c.At < 120_000) return (c.Events, c.Error);
        var list = new List<CalendarEvent>();
        string? error = null;
        try
        {
            var token = await Access(ct);
            if (token is null) error = Connected ? "O Google recusou a autorização. Conecte de novo nas configurações do PC." : null;
            else
            {
                var now = DateTimeOffset.Now;
                var start = new DateTimeOffset(now.Date, now.Offset);
                var url = "https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50"
                    + "&timeMin=" + Uri.EscapeDataString(start.ToString("o")) + "&timeMax=" + Uri.EscapeDataString(start.AddDays(1).ToString("o"));
                using var req = new HttpRequestMessage(HttpMethod.Get, url);
                req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
                using var r = await _http.SendAsync(req, ct);
                if (!r.IsSuccessStatusCode) error = (int)r.StatusCode == 403 ? "O Google bloqueou a leitura da agenda (permissão da empresa?)." : $"O Google respondeu {(int)r.StatusCode}.";
                else
                {
                    var j = JsonNode.Parse(await r.Content.ReadAsStringAsync(ct));
                    foreach (var e in j?["items"] as JsonArray ?? [])
                    {
                        if (e?["status"]?.GetValue<string>() == "cancelled") continue;
                        // declined by me: not a meeting to join
                        if ((e?["attendees"] as JsonArray)?.FirstOrDefault(a => a?["self"]?.GetValue<bool>() == true)?["responseStatus"]?.GetValue<string>() == "declined") continue;
                        var s = e?["start"]?["dateTime"]?.GetValue<string>(); var f = e?["end"]?["dateTime"]?.GetValue<string>();
                        if (s is null || f is null || !DateTimeOffset.TryParse(s, out var ds) || !DateTimeOffset.TryParse(f, out var df)) continue;   // all-day
                        var meet = e?["hangoutLink"]?.GetValue<string>()
                            ?? (e?["conferenceData"]?["entryPoints"] as JsonArray)?.FirstOrDefault(p => p?["entryPointType"]?.GetValue<string>() == "video")?["uri"]?.GetValue<string>();
                        meet = Ics.MeetLink(meet) ?? Ics.MeetLink(e?["description"]?.GetValue<string>()) ?? Ics.MeetLink(e?["location"]?.GetValue<string>());
                        list.Add(new CalendarEvent(e?["summary"]?.GetValue<string>() ?? "(sem título)", ds.ToUnixTimeMilliseconds(), df.ToUnixTimeMilliseconds(), false,
                            e?["location"]?.GetValue<string>(), "Trabalho", "#ff2a4f", meet, (e?["attendees"] as JsonArray)?.Count ?? 0));
                    }
                }
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException) { error = "Sem conexão com o Google."; }
        lock (_gate) _cache = (Now, list, error);
        return (list, error);
    }
}
