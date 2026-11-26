using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using System.Text;

namespace PhoneBox.Agent;

/// <summary>
/// Federano: the tablet's own page editor (overview › Editar). The tablet sends a page's widgets (position, size and the
/// simple options); this applies them to the settings file. Anything that runs or fetches something on the PC
/// (commands, scripts, addresses, shortcuts, cameras, Home Assistant) stays a PC-only setting: such a widget can be
/// moved, resized or removed from the tablet, but not added, and its options are never taken from the tablet.
/// </summary>
public static partial class PanelEdit
{
    public sealed record WidgetEdit(string? Id, string Type, int X, int Y, int W, int H, Dictionary<string, JsonElement>? Options);
    public sealed record PageEdit(List<WidgetEdit> Widgets, string? BaseRevision = null, string? EditId = null, string? PcId = null);

    public const string Conflict = "Esta página também mudou no PC. A edição do tablet foi preservada; abra o editor para escolher qual usar.";
    private static readonly JsonSerializerOptions PublicJson = new(JsonSerializerDefaults.Web);

    // A stable scope, not an authentication key: drafts from one computer must never be sent to another.
    public static string ComputerId(string configPath) => Hash(Environment.MachineName + "\0" + System.IO.Path.GetFullPath(configPath));
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    public static string Revision(PageConfig page) => Hash(JsonSerializer.Serialize((page.Widgets ?? []).Select(w => new
    {
        w.Id, w.Type, w.X, w.Y, w.W, w.H, w.Appearance, options = StackWidgets.PublicOptions(w),
    }), PublicJson));

    private static string Revision(JsonNode page) => Revision(page.Deserialize<PageConfig>(PublicJson)!);

    private sealed record OptDef(string Key, string Type, JsonElement? Choices, double? Min, double? Max);
    private sealed record WidgetDef(string Type, List<OptDef> Options);

    private static readonly Dictionary<string, WidgetDef> Defs = LoadDefs();

    // option types the tablet may set; the others (control targets, shortcuts, cameras, stacks...) are PC-only
    private static readonly HashSet<string> SimpleTypes = ["bool", "number", "select", "text", "textarea", "lines", "multi", "color"];
    private static readonly HashSet<string> PcOnlyTypes = ["command", "html", "web", "button", "shortcuts", "image", "stack", "camera", "ha", "app-console"];

    [GeneratedRegex("url|command|cmd|script|html|path|token|key|secret|password|host|src|args|cwd", RegexOptions.IgnoreCase)]
    private static partial Regex SensitiveKey();

    private static Dictionary<string, WidgetDef> LoadDefs()
    {
        var map = new Dictionary<string, WidgetDef>(StringComparer.Ordinal);
        try
        {
            foreach (var w in JsonNode.Parse(Catalog.WidgetsJson)!.AsArray())
            {
                var type = w?["type"]?.GetValue<string>();
                if (type is null) continue;
                var opts = (w!["options"] as JsonArray ?? []).Select(o => new OptDef(
                    o?["key"]?.GetValue<string>() ?? "", o?["type"]?.GetValue<string>() ?? "",
                    o?["choices"] is { } c ? JsonSerializer.SerializeToElement(c) : null,
                    o?["min"]?.GetValue<double>(), o?["max"]?.GetValue<double>())).ToList();
                map[type] = new(type, opts);
            }
        }
        catch { }
        return map;
    }

    /// <summary>A widget the tablet may only move, resize or remove.</summary>
    public static bool PcOnly(string type) =>
        PcOnlyTypes.Contains(type) || !Defs.TryGetValue(type, out var d) || d.Options.Any(o => !SimpleTypes.Contains(o.Type) || SensitiveKey().IsMatch(o.Key));

    /// <summary>The option keys the tablet may change for this widget type.</summary>
    public static IEnumerable<string> EditableKeys(string type) =>
        PcOnly(type) ? [] : Defs[type].Options.Where(o => SimpleTypes.Contains(o.Type) && !SensitiveKey().IsMatch(o.Key)).Select(o => o.Key);

    /// <summary>Applies <paramref name="edit"/> to page <paramref name="pageId"/> of the settings JSON. Returns the new JSON or an error.</summary>
    public static (string? Json, string? Error) Apply(string settingsJson, string pageId, PageEdit edit)
    {
        JsonNode root;
        try { root = JsonNode.Parse(settingsJson, documentOptions: new() { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true })!; }
        catch (JsonException) { return (null, "The settings file could not be read"); }
        var pages = Prop(root, "pages") as JsonArray;
        var page = pages?.FirstOrDefault(p => string.Equals(Prop(p!, "id")?.GetValue<string>(), pageId, StringComparison.Ordinal));
        if (page is null) return (null, "Página não encontrada");
        if (edit.EditId is not null && !Guid.TryParse(edit.EditId, out _)) return (null, "Identificador de edição inválido");
        // An acknowledgement can be lost after the write. Retrying that exact edit must not add widgets twice
        // or undo a later desktop change to the same page.
        if (edit.EditId is not null && Prop(page, "tabletEditId")?.GetValue<string>() == edit.EditId) return (settingsJson, null);
        if (edit.BaseRevision is not null && Revision(page) != edit.BaseRevision) return (null, Conflict);
        if (edit.Widgets is null || edit.Widgets.Count > 48) return (null, "Widgets demais nesta página");
        var old = (Prop(page, "widgets") as JsonArray ?? []).Where(w => w is not null)
            .ToDictionary(w => Prop(w!, "id")?.GetValue<string>() ?? "", w => w!, StringComparer.Ordinal);

        var result = new JsonArray();
        var taken = new bool[Catalog.Cols, Catalog.Rows];
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in edit.Widgets)
        {
            if (e is null || string.IsNullOrEmpty(e.Type) || !Catalog.IsWidget(e.Type)) return (null, $"Tipo de widget desconhecido: {e?.Type}");
            if (e.Id is { Length: > 0 } provided && !ids.Add(provided)) return (null, "Identificador de widget repetido");
            var (minW, minH) = Catalog.MinSize(e.Type);
            if (e.W < minW || e.H < minH || e.X < 0 || e.Y < 0 || e.X + e.W > Catalog.Cols || e.Y + e.H > Catalog.Rows)
                return (null, $"Posição ou tamanho fora da página ({e.Type})");
            for (var x = e.X; x < e.X + e.W; x++)
                for (var y = e.Y; y < e.Y + e.H; y++)
                {
                    if (taken[x, y]) return (null, "Dois widgets no mesmo lugar");
                    taken[x, y] = true;
                }

            JsonObject node;
            if (e.Id is { Length: > 0 } id && old.TryGetValue(id, out var before))
            {
                if (Prop(before, "type")?.GetValue<string>() != e.Type) return (null, "Um widget não pode mudar de tipo");
                node = (JsonObject)before.DeepClone();
            }
            else
            {
                if (PcOnly(e.Type)) return (null, "Este widget só pode ser adicionado pelo PC");
                var newId = e.Id is { Length: 33 } proposed && proposed[0] == 't' && Guid.TryParseExact(proposed[1..], "N", out _)
                    ? proposed : "t" + Guid.NewGuid().ToString("N")[..10];
                node = new JsonObject { ["id"] = newId, ["type"] = e.Type };
            }
            Set(node, "x", e.X); Set(node, "y", e.Y); Set(node, "w", e.W); Set(node, "h", e.H);

            // simple options: only the ones the tablet may set, each checked against its definition
            if (!PcOnly(e.Type) && e.Options is { Count: > 0 })
            {
                var opts = Prop(node, "options") as JsonObject;
                if (opts is null) { opts = []; Set(node, "options", opts); }
                foreach (var (k, v) in e.Options)
                {
                    var def = Defs[e.Type].Options.FirstOrDefault(o => o.Key == k);
                    if (def is null || !EditableKeys(e.Type).Contains(k)) continue;
                    if (Check(def, v) is not { } ok) return (null, $"Valor inválido em \"{k}\"");
                    opts[k] = ok;
                }
            }
            result.Add(node);
        }
        SetProp(page, "widgets", result);
        if (edit.EditId is not null)
        {
            SetProp(page, "tabletEditId", JsonValue.Create(edit.EditId)!);
            SetProp(page, "tabletEditRevision", JsonValue.Create(Revision(page))!);
        }
        return (root.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }), null);
    }

    private static JsonNode? Check(OptDef d, JsonElement v)
    {
        switch (d.Type)
        {
            case "bool": return v.ValueKind is JsonValueKind.True or JsonValueKind.False ? JsonValue.Create(v.GetBoolean()) : null;
            case "number":
                if (v.ValueKind != JsonValueKind.Number || !v.TryGetDouble(out var n) || double.IsNaN(n)) return null;
                if (d.Min is { } lo && n < lo || d.Max is { } hi && n > hi) return null;
                return JsonValue.Create(n);
            case "text" or "textarea" or "lines":
                return v.ValueKind == JsonValueKind.String && v.GetString()!.Length <= 4000 ? JsonValue.Create(v.GetString()) : null;
            case "color":
                return v.ValueKind == JsonValueKind.String && (v.GetString()!.Length == 0 || ColorRx().IsMatch(v.GetString()!)) ? JsonValue.Create(v.GetString()) : null;
            case "select":
                return v.ValueKind == JsonValueKind.String && Choices(d).Contains(v.GetString()!) ? JsonValue.Create(v.GetString()) : null;
            case "multi":
                if (v.ValueKind != JsonValueKind.Array) return null;
                var allowed = Choices(d); var arr = new JsonArray();
                foreach (var x in v.EnumerateArray()) { if (x.ValueKind != JsonValueKind.String || !allowed.Contains(x.GetString()!)) return null; arr.Add(x.GetString()); }
                return arr;
            default: return null;
        }
    }

    // choices are ["value", "Label"] pairs (or plain values)
    private static HashSet<string> Choices(OptDef d)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        if (d.Choices is { ValueKind: JsonValueKind.Array } c)
            foreach (var x in c.EnumerateArray())
                if (x.ValueKind == JsonValueKind.Array && x.GetArrayLength() > 0 && x[0].ValueKind == JsonValueKind.String) set.Add(x[0].GetString()!);
                else if (x.ValueKind == JsonValueKind.String) set.Add(x.GetString()!);
        return set;
    }

    [GeneratedRegex("^#[0-9a-fA-F]{6}$")]
    private static partial Regex ColorRx();

    // the settings file is written in camelCase, but read case-insensitively: find a property in any case
    private static JsonNode? Prop(JsonNode node, string name) =>
        node is JsonObject o ? o.FirstOrDefault(p => string.Equals(p.Key, name, StringComparison.OrdinalIgnoreCase)).Value : null;
    private static void SetProp(JsonNode node, string name, JsonNode value)
    {
        var o = (JsonObject)node;
        var key = o.FirstOrDefault(p => string.Equals(p.Key, name, StringComparison.OrdinalIgnoreCase)).Key ?? name;
        o[key] = value;
    }
    private static void Set(JsonObject o, string name, JsonNode value) => SetProp(o, name, value);
    private static void Set(JsonObject o, string name, int value) => SetProp(o, name, JsonValue.Create(value));
}
