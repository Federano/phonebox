using System.Text.Json;
using System.Text.Json.Nodes;
using PhoneBox.Agent;
using Xunit;

namespace PhoneBox.Agent.Tests;

/// <summary>Federano: the tablet's page editor saves positions, sizes and simple options; PC-only settings stay PC-only.</summary>
public class PanelEditTests
{
    const string Settings = """
    { "pages": [ { "id": "home", "title": "Início", "widgets": [
        { "id": "c1", "type": "clock", "x": 0, "y": 0, "w": 6, "h": 4, "options": { "weather": true } },
        { "id": "k1", "type": "command", "x": 6, "y": 0, "w": 4, "h": 2, "options": { "command": "Get-Date", "title": "Hora" } } ] } ],
      "lan": { "token": "segredo" } }
    """;

    static PanelEdit.WidgetEdit W(string? id, string type, int x, int y, int w, int h, object? opts = null) =>
        new(id, type, x, y, w, h, opts is null ? null : JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(JsonSerializer.Serialize(opts)));

    static JsonNode Widgets(string json) => JsonNode.Parse(json)!["pages"]![0]!["widgets"]!;

    [Fact]
    public void MovesAndResizesAndKeepsEverythingElse()
    {
        var (json, err) = PanelEdit.Apply(Settings, "home", new([W("c1", "clock", 0, 2, 6, 4), W("k1", "command", 8, 0, 4, 2)]));
        Assert.Null(err);
        var ws = Widgets(json!);
        Assert.Equal(2, ws[0]!["y"]!.GetValue<int>());
        Assert.Equal(8, ws[1]!["x"]!.GetValue<int>());
        Assert.Equal("Get-Date", ws[1]!["options"]!["command"]!.GetValue<string>());
        Assert.Equal("segredo", JsonNode.Parse(json!)!["lan"]!["token"]!.GetValue<string>());
    }

    [Fact]
    public void RemovingAWidgetIsLeavingItOut()
    {
        var (json, err) = PanelEdit.Apply(Settings, "home", new([W("c1", "clock", 0, 0, 6, 4)]));
        Assert.Null(err);
        Assert.Single(Widgets(json!).AsArray());
    }

    [Fact]
    public void AddsASimpleWidgetButNotAPcOnlyOne()
    {
        var (json, err) = PanelEdit.Apply(Settings, "home", new([W("c1", "clock", 0, 0, 6, 4), W(null, "analog", 6, 2, 3, 4, new { seconds = false })]));
        Assert.Null(err);
        var added = Widgets(json!)[1]!;
        Assert.Equal("analog", added["type"]!.GetValue<string>());
        Assert.False(added["options"]!["seconds"]!.GetValue<bool>());
        Assert.StartsWith("t", added["id"]!.GetValue<string>());

        var (_, refused) = PanelEdit.Apply(Settings, "home", new([W(null, "command", 6, 2, 4, 2, new { command = "rm -rf /" })]));
        Assert.NotNull(refused);
    }

    [Fact]
    public void NeverTakesOptionsForAPcOnlyWidget()
    {
        var (json, err) = PanelEdit.Apply(Settings, "home", new([W("k1", "command", 6, 0, 4, 2, new { command = "Remove-Item C:\\ -Recurse", title = "x" })]));
        Assert.Null(err);
        Assert.Equal("Get-Date", Widgets(json!)[0]!["options"]!["command"]!.GetValue<string>());
        Assert.True(PanelEdit.PcOnly("command"));
        Assert.Empty(PanelEdit.EditableKeys("command"));
    }

    [Theory]
    [InlineData(10, 0, 6, 4)]   // past the right edge
    [InlineData(0, 0, 1, 1)]    // smaller than the clock's minimum
    public void RefusesBadPlaces(int x, int y, int w, int h) =>
        Assert.NotNull(PanelEdit.Apply(Settings, "home", new([W("c1", "clock", x, y, w, h)])).Error);

    [Fact]
    public void RefusesOverlapsUnknownTypesTypeChangesAndBadValues()
    {
        Assert.NotNull(PanelEdit.Apply(Settings, "home", new([W("c1", "clock", 0, 0, 6, 4), W("k1", "command", 4, 0, 4, 2)])).Error);
        Assert.NotNull(PanelEdit.Apply(Settings, "home", new([W(null, "nao-existe", 0, 0, 2, 2)])).Error);
        Assert.NotNull(PanelEdit.Apply(Settings, "home", new([W("c1", "analog", 0, 0, 6, 4)])).Error);
        Assert.NotNull(PanelEdit.Apply(Settings, "home", new([W("c1", "clock", 0, 0, 6, 4, new { weather = "sim" })])).Error);
        Assert.NotNull(PanelEdit.Apply(Settings, "outra", new([])).Error);
    }

    static string Revision(string json) => PanelEdit.Revision(JsonNode.Parse(json)!["pages"]![0]!
        .Deserialize<PageConfig>(new JsonSerializerOptions(JsonSerializerDefaults.Web))!);

    [Fact]
    public void OfflineEditRefusesANewerPageButAllowsAnExplicitResolution()
    {
        var baseRevision = Revision(Settings);
        var changed = JsonNode.Parse(Settings)!;
        changed["pages"]![0]!["widgets"]![0]!["options"]!["weather"] = false;
        var current = changed.ToJsonString();
        var widgets = new List<PanelEdit.WidgetEdit> { W("c1", "clock", 0, 0, 6, 4, new { weather = true }) };
        Assert.Equal(PanelEdit.Conflict, PanelEdit.Apply(current, "home", new(widgets, baseRevision, Guid.NewGuid().ToString())).Error);
        var resolved = PanelEdit.Apply(current, "home", new(widgets, Revision(current), Guid.NewGuid().ToString()));
        Assert.Null(resolved.Error);
        Assert.True(Widgets(resolved.Json!)[0]!["options"]!["weather"]!.GetValue<bool>());
    }

    [Fact]
    public void OfflineWidgetIdAndAcknowledgementSurviveALostReply()
    {
        var widgetId = "t" + Guid.NewGuid().ToString("N");
        var editId = Guid.NewGuid().ToString("N");
        var edit = new PanelEdit.PageEdit([W(widgetId, "note", 0, 0, 4, 3, new { text = "offline" })], Revision(Settings), editId);
        var first = PanelEdit.Apply(Settings, "home", edit);
        Assert.Null(first.Error);
        Assert.Equal(widgetId, Widgets(first.Json!)[0]!["id"]!.GetValue<string>());
        var page = JsonNode.Parse(first.Json!)!["pages"]![0]!;
        Assert.Equal(editId, page["tabletEditId"]!.GetValue<string>());
        Assert.Equal(Revision(first.Json!), page["tabletEditRevision"]!.GetValue<string>());
        var retry = PanelEdit.Apply(first.Json!, "home", edit);
        Assert.Null(retry.Error);
        Assert.Equal(first.Json, retry.Json);
        Assert.Single(Widgets(retry.Json!).AsArray());
    }

    [Fact]
    public void ReplayingAnAcknowledgedEditDoesNotUndoASubsequentPcChange()
    {
        var edit = new PanelEdit.PageEdit([W("c1", "clock", 0, 0, 6, 4)], Revision(Settings), Guid.NewGuid().ToString());
        var first = PanelEdit.Apply(Settings, "home", edit).Json!;
        var pc = JsonNode.Parse(first)!;
        pc["pages"]![0]!["widgets"]![0]!["options"]!["weather"] = false;
        var current = pc.ToJsonString();
        var retry = PanelEdit.Apply(current, "home", edit);
        Assert.Equal(current, retry.Json);
        Assert.False(Widgets(retry.Json!)[0]!["options"]!["weather"]!.GetValue<bool>());
        Assert.NotEqual(Revision(current), pc["pages"]![0]!["tabletEditRevision"]!.GetValue<string>());
    }

    [Fact]
    public void RepeatedWidgetIdsAreRejectedBeforeTheyCanBeNormalizedIntoNewWidgets()
    {
        var edit = new PanelEdit.PageEdit([W("n", "note", 0, 0, 3, 2), W("n", "note", 3, 0, 3, 2)]);
        Assert.NotNull(PanelEdit.Apply(Settings, "home", edit).Error);
    }

    [Fact]
    public void PrivateCommandChangesDoNotExposeSecretsOrConflictWithLayoutEdits()
    {
        var pc = JsonNode.Parse(Settings)!;
        pc["pages"]![0]!["widgets"]![1]!["options"]!["command"] = "another private command";
        Assert.Equal(Revision(Settings), Revision(pc.ToJsonString()));
        pc["pages"]![0]!["widgets"]![1]!["options"]!["title"] = "Outro título";
        Assert.NotEqual(Revision(Settings), Revision(pc.ToJsonString()));
    }
}
