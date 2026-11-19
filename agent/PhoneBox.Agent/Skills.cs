using System.Globalization;
using System.Text;
using System.Text.Json;

namespace PhoneBox.Agent;

/// <summary>
/// Federano skill: one JSON file in a "skills" folder. Triggers are phrases; the first skill whose trigger appears in
/// what was said (button, typed text or dictation) runs its action and answers with <see cref="Reply"/>.
/// </summary>
public sealed record SkillDef
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string[] Triggers { get; init; } = [];
    /// <summary>Built-in action: media.now, media.playpause, media.next, media.prev, video.mirror, video.toTablet, reply.</summary>
    public string Action { get; init; } = "reply";
    /// <summary>Answer; {title}, {artist}, {album}, {app}, {state} are filled from the media playing on the PC.</summary>
    public string Reply { get; init; } = "";
    /// <summary>Answer when nothing is playing (media actions only).</summary>
    public string ReplyEmpty { get; init; } = "";
    public bool Enabled { get; init; } = true;
}

/// <param name="Open">A link the tablet opens (e.g. the YouTube video taken from the PC).</param>
/// <param name="Mirror">True: the tablet shows the PC's video live (GET /api/mirror/frame).</param>
public sealed record SkillResult(bool Ok, string? Skill, string Reply, string? Open = null, bool Mirror = false);

public sealed class SkillEngine(ILogger<SkillEngine> log, MediaMonitor media, YouTubeTracker youtube, MirrorCapture mirror)
{
    public static readonly string[] WakeWords = ["federano"];
    static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true, ReadCommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true };

    /// <summary>Built-in skills ship next to the agent; the user's folder (next to config.json) adds to and overrides them by file name.</summary>
    public static IEnumerable<string> Folders() =>
        [Path.Combine(AppContext.BaseDirectory, "skills"), Path.Combine(AppPaths.ConfigDir, "skills")];

    public IReadOnlyList<SkillDef> Load()
    {
        var byId = new Dictionary<string, SkillDef>(StringComparer.OrdinalIgnoreCase);
        foreach (var dir in Folders().Where(Directory.Exists))
            foreach (var file in Directory.EnumerateFiles(dir, "*.json").Order(StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    var s = JsonSerializer.Deserialize<SkillDef>(File.ReadAllText(file), Json);
                    if (s is null) continue;
                    var id = Path.GetFileNameWithoutExtension(file);
                    byId[id] = s with { Id = id, Name = s.Name.Length > 0 ? s.Name : id };
                }
                catch (Exception ex) { log.LogWarning("skill {File} ignored: {Error}", file, ex.Message); }
            }
        return byId.Values.Where(s => s.Enabled).ToList();
    }

    public async Task<SkillResult> RunAsync(string text)
    {
        var skill = Match(Load(), text);
        if (skill is null) return new(false, null, "Não entendi. Ainda não tenho uma skill para isso.");
        log.LogInformation("skill: {Skill}", skill.Id);
        switch (skill.Action)
        {
            case "media.now":
                return Answer(skill, media.Snapshot());
            case "media.playpause" or "media.next" or "media.prev":
                var ok = await media.Control(skill.Action["media.".Length..], null);
                return Answer(skill, media.Snapshot()) with { Ok = ok };
            case "video.toTablet":
                return ToTablet(skill, youtube);
            case "video.mirror":
                if (mirror.Start() is { } error) return new(false, skill.Id, error);
                var m = media.Snapshot();
                var values = new Dictionary<string, string>
                {
                    ["title"] = m?.Title is { Length: > 0 } t ? t : mirror.Title, ["artist"] = m?.Artist ?? "", ["app"] = m?.App ?? "",
                    ["state"] = m?.Playing == true ? "tocando" : "pausado",
                };
                return new(true, skill.Id, skill.Reply.Length > 0 ? Fill(skill.Reply, values) : "Espelhando no tablet.", Mirror: true);
            default:
                return new(true, skill.Id, skill.Reply);
        }
    }

    /// <summary>The YouTube video open on the PC: the tablet opens it at the same time; the PC's copy is paused.</summary>
    internal static SkillResult ToTablet(SkillDef skill, YouTubeTracker youtube)
    {
        if (youtube.Current() is not { } v)
            return new(false, skill.Id, skill.ReplyEmpty.Length > 0 ? skill.ReplyEmpty
                : "Não achei um vídeo do YouTube aberto no PC. A extensão do Federano está instalada no Chrome?");
        youtube.RequestPause(v.VideoId);
        var values = new Dictionary<string, string>
        {
            ["title"] = v.Title, ["time"] = YouTubeTracker.Clock(v.Seconds), ["app"] = "YouTube",
            ["state"] = v.Playing ? "tocando" : "pausado",
        };
        var reply = skill.Reply.Length > 0 ? Fill(skill.Reply, values) : $"Abrindo \"{v.Title}\" no tablet em {values["time"]}.";
        return new(true, skill.Id, reply, YouTubeTracker.WatchUrl(v.VideoId, v.Seconds));
    }

    internal static SkillResult Answer(SkillDef skill, MediaSnapshot? m)
    {
        if (m is null || (m.Title.Length == 0 && m.Artist.Length == 0))
            return new(true, skill.Id, skill.ReplyEmpty.Length > 0 ? skill.ReplyEmpty : "Nada tocando no PC agora.");
        var values = new Dictionary<string, string>
        {
            ["title"] = m.Title, ["artist"] = m.Artist, ["album"] = m.Album, ["app"] = m.App,
            ["state"] = m.Playing ? "tocando" : "pausado",
        };
        return new(true, skill.Id, Fill(skill.Reply, values));
    }

    /// <summary>Fills {name} placeholders. A part in [brackets] is left out when a placeholder inside it is empty,
    /// e.g. "[ de {artist}]".</summary>
    internal static string Fill(string template, IReadOnlyDictionary<string, string> values)
    {
        string Sub(string s) => System.Text.RegularExpressions.Regex.Replace(s, @"\{(\w+)\}",
            x => values.TryGetValue(x.Groups[1].Value, out var v) ? v : x.Value);
        var withOptional = System.Text.RegularExpressions.Regex.Replace(template, @"\[([^\[\]]*)\]", x =>
        {
            var inner = x.Groups[1].Value;
            var empty = System.Text.RegularExpressions.Regex.Matches(inner, @"\{(\w+)\}")
                .Any(p => !values.TryGetValue(p.Groups[1].Value, out var v) || string.IsNullOrWhiteSpace(v));
            return empty ? "" : inner;
        });
        return Sub(withOptional);
    }

    /// <summary>The skill with the longest trigger contained in the text (ignoring case, accents, punctuation and the wake word).</summary>
    internal static SkillDef? Match(IEnumerable<SkillDef> skills, string text)
    {
        var said = Normalize(text);
        foreach (var w in WakeWords) said = said.Replace(w, " ");
        said = " " + string.Join(' ', said.Split(' ', StringSplitOptions.RemoveEmptyEntries)) + " ";
        return skills
            .SelectMany(s => s.Triggers.Select(t => (Skill: s, Trigger: Normalize(t).Trim())))
            .Where(x => x.Trigger.Length > 0 && said.Contains(" " + x.Trigger + " "))
            .OrderByDescending(x => x.Trigger.Length)
            .Select(x => x.Skill)
            .FirstOrDefault();
    }

    internal static string Normalize(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var c in s.Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            sb.Append(char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : ' ');
        }
        return string.Join(' ', sb.ToString().Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }
}
