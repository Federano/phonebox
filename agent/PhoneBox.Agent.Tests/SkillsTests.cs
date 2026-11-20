using PhoneBox.Agent;
using Xunit;

public class SkillsTests
{
    static readonly SkillDef NowPlaying = new()
    {
        Id = "o-que-esta-tocando",
        Triggers = ["o que esta tocando", "que musica e essa"],
        Action = "media.now",
        Reply = "Está {state} \"{title}\" de {artist}, no {app}.",
    };
    static readonly SkillDef Hello = new() { Id = "oi", Triggers = ["oi"], Reply = "Olá!" };

    [Theory]
    [InlineData("Federano, o que está tocando?")]
    [InlineData("o que ESTÁ tocando")]
    [InlineData("federano que música é essa")]
    public void MatchesIgnoringWakeWordAccentsAndPunctuation(string said) =>
        Assert.Equal("o-que-esta-tocando", SkillEngine.Match([Hello, NowPlaying], said)?.Id);

    [Fact]
    public void NoMatchReturnsNull() => Assert.Null(SkillEngine.Match([NowPlaying], "abre o navegador"));

    [Fact]
    public void TriggerMustBeWholeWords() => Assert.Null(SkillEngine.Match([Hello], "boiada"));

    [Fact]
    public void FillsMediaPlaceholders()
    {
        var m = new MediaSnapshot("Chrome", "Vídeo X", "Canal Y", "", true, 0, 0, 0, false);
        Assert.Equal("Está tocando \"Vídeo X\" de Canal Y, no Chrome.", SkillEngine.Answer(NowPlaying, m).Reply);
    }

    [Fact]
    public void NothingPlaying() => Assert.Equal("Nada tocando no PC agora.", SkillEngine.Answer(NowPlaying, null).Reply);
}

public class SkillsFillTests
{
    [Fact]
    public void OptionalPartDroppedWhenEmpty()
    {
        var skill = new SkillDef { Id = "x", Action = "media.now", Reply = "Está {state} \"{title}\"[ de {artist}], no {app}." };
        var m = new MediaSnapshot("Chrome", "Instagram", "", "", false, 0, 0, 0, false);
        Assert.Equal("Está pausado \"Instagram\", no Chrome.", SkillEngine.Answer(skill, m).Reply);
    }
}

public class YouTubeToTabletTests
{
    static readonly SkillDef Skill = new() { Id = "levar", Action = "video.toTablet", Reply = "Abrindo \"{title}\" no tablet em {time}." };

    [Fact]
    public void NoVideoGivesHint() => Assert.Null(SkillEngine.ToTablet(Skill, new YouTubeTracker()).Open);

    [Fact]
    public void OpensSameVideoAtSameTimeAndPausesPc()
    {
        var yt = new YouTubeTracker();
        Assert.False(yt.Update("dQw4w9WgXcQ", 125.4, false, "Vídeo"));
        var r = SkillEngine.ToTablet(Skill, yt);
        Assert.Equal("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=125s", r.Open);
        Assert.Equal("Abrindo \"Vídeo\" no tablet em 2:05.", r.Reply);
        Assert.True(yt.Update("dQw4w9WgXcQ", 126, true, "Vídeo"));   // the next report is told to pause
        Assert.False(yt.Update("dQw4w9WgXcQ", 127, true, "Vídeo"));  // once
    }

    [Theory]
    [InlineData("short")]
    [InlineData("dQw4w9WgXc?")]
    [InlineData(null)]
    public void RejectsBadIds(string? id) => Assert.False(YouTubeTracker.ValidId(id));

    [Fact]
    public void MatchesTriggers() =>
        Assert.NotNull(SkillEngine.Match([Skill with { Triggers = ["joga pro tablet"] }], "Federano, joga pro tablet!"));
}

/// <summary>The skills that ship with the agent: what a short voice command runs.</summary>
public class ShippedSkillsTests
{
    static readonly IReadOnlyList<SkillDef> Shipped = Directory
        .EnumerateFiles(Path.Combine(AppContext.BaseDirectory, "skills"), "*.json")
        .Select(f => System.Text.Json.JsonSerializer.Deserialize<SkillDef>(File.ReadAllText(f), new System.Text.Json.JsonSerializerOptions
            { PropertyNameCaseInsensitive = true, ReadCommentHandling = System.Text.Json.JsonCommentHandling.Skip, AllowTrailingCommas = true })!
            with { Id = Path.GetFileNameWithoutExtension(f) })
        .ToList();

    [Theory]
    [InlineData("pausa", "pausar")]
    [InlineData("Federano, pausa o vídeo", "pausar")]
    [InlineData("continua", "continuar")]
    [InlineData("próximo", "proximo")]
    [InlineData("próximo vídeo", "proximo")]
    [InlineData("volta 10 segundos", "voltar-10-segundos")]
    [InlineData("volta dez segundos", "voltar-10-segundos")]
    [InlineData("avança 10 segundos", "avancar-10-segundos")]
    [InlineData("pula 10 segundos", "avancar-10-segundos")]
    [InlineData("aumenta o volume", "aumentar-volume")]
    [InlineData("abaixa o volume", "diminuir-volume")]
    [InlineData("o que está tocando?", "o-que-esta-tocando")]
    [InlineData("continua no tablet", "abrir-no-youtube-do-tablet")]
    public void VoiceCommands(string said, string skill) => Assert.Equal(skill, SkillEngine.Match(Shipped, said)?.Id);

    [Fact]
    public void SeekSkillsCarryTheirSeconds()
    {
        Assert.Equal(-10, Shipped.Single(s => s.Id == "voltar-10-segundos").Seconds);
        Assert.Equal(10, Shipped.Single(s => s.Id == "avancar-10-segundos").Seconds);
        Assert.Equal(10, Shipped.Single(s => s.Id == "aumentar-volume").Step);
    }
}

public class SpotifyVoiceTests
{
    static readonly IReadOnlyList<SkillDef> Shipped = Directory
        .EnumerateFiles(Path.Combine(AppContext.BaseDirectory, "skills"), "*.json")
        .Select(f => System.Text.Json.JsonSerializer.Deserialize<SkillDef>(File.ReadAllText(f), new System.Text.Json.JsonSerializerOptions
            { PropertyNameCaseInsensitive = true, ReadCommentHandling = System.Text.Json.JsonCommentHandling.Skip, AllowTrailingCommas = true })!
            with { Id = Path.GetFileNameWithoutExtension(f) })
        .ToList();

    [Theory]
    [InlineData("Federano, toca Evidências de Chitãozinho e Xororó", "Evidências de Chitãozinho e Xororó")]
    [InlineData("toca aí Garota de Ipanema", "Garota de Ipanema")]
    [InlineData("quero ouvir Djavan", "Djavan")]
    public void QueryKeepsWhatWasSaid(string said, string query)
    {
        Assert.Null(SkillEngine.Exact(Shipped, said));
        var m = SkillEngine.MatchQuery(Shipped, said);
        Assert.Equal("tocar-no-spotify", m?.Skill.Id);
        Assert.Equal(query, m?.Query);
    }

    [Theory]
    [InlineData("toca")]
    [InlineData("Federano, toca")]
    [InlineData("toca de novo")]
    [InlineData("play")]
    public void TriggerAloneContinues(string said) => Assert.Equal("continuar", SkillEngine.Exact(Shipped, said)?.Id);

    [Fact]
    public void OtherCommandsAreNotQueries()
    {
        Assert.Null(SkillEngine.MatchQuery(Shipped, "volta 10 segundos"));
        Assert.Equal("pausar", SkillEngine.Match(Shipped, "pausa")?.Id);
        Assert.Equal("o-que-esta-tocando", SkillEngine.Match(Shipped, "o que está tocando")?.Id);
    }

    [Theory]
    [InlineData("Evidências de Chitãozinho e Xororó", "track", "Evidências Chitãozinho e Xororó")]
    [InlineData("a música Garota de Ipanema de Tom Jobim", "track", "Garota de Ipanema Tom Jobim")]
    [InlineData("a playlist Rock Nacional no Spotify", "playlist", "Rock Nacional")]
    [InlineData("o álbum Acústico MTV", "album", "Acústico MTV")]
    [InlineData("músicas do Djavan", "artist", "Djavan")]
    [InlineData("Djavan", "track", "Djavan")]
    public void ParsesKindAndWhat(string query, string kind, string what) =>
        Assert.Equal((kind, what), SkillEngine.ParseMusic(query));
}
