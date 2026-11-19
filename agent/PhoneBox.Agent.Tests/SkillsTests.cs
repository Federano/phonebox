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
