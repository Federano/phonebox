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
