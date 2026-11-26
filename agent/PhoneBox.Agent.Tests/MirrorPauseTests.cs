using PhoneBox.Agent;
using Xunit;

namespace PhoneBox.Agent.Tests;

/// <summary>Federano: a video starting in another tab pauses the one shown on the tablet, once.</summary>
public class MirrorPauseTests
{
    [Fact]
    public void OnlyANewStartCountsAndThePauseIsTakenOnce()
    {
        var yt = new YouTubeTracker();
        Assert.True(yt.ReportTab(1, true));     // the mirrored tab starts
        Assert.False(yt.ReportTab(1, true));    // still playing: not a new start
        Assert.True(yt.ReportTab(2, true));     // another tab starts
        yt.RequestPauseTab(1);
        Assert.False(yt.TakePauseTab(2));
        Assert.True(yt.TakePauseTab(1));
        Assert.False(yt.TakePauseTab(1));
        Assert.False(yt.ReportTab(2, true));
        yt.ReportTab(2, false);
        Assert.True(yt.ReportTab(2, true));     // played again after a pause
    }
}

/// <summary>Federano "Só ouvir": the song inside a music video's title, for its lyrics.</summary>
public class VideoSongTests
{
    [Theory]
    [InlineData("Yago Oproprio - Antes do Baile (prod. Patricio Sid)", "Yago Oproprio", "Antes do Baile", "Yago Oproprio")]
    [InlineData("Fabio Brazza ft. Victoria Brito - Prazeres artificiais (Prod. Paiva)", "Fabio Brazza", "Prazeres artificiais", "Fabio Brazza")]
    [InlineData("Rashid - Se o Mundo Acabar", "Rashid", "Se o Mundo Acabar", "Rashid")]
    [InlineData("Fabio Brazza - FIC(ALI)GADO (Prod. NoShugah)", "Fabio Brazza", "FIC(ALI)GADO", "Fabio Brazza")]
    [InlineData("Helipa [Official Video]", "Yago Oproprio - Topic", "Helipa", "Yago Oproprio")]
    [InlineData("Yago Oproprio – La Noche (Clipe Oficial)", "Canal", "La Noche", "Yago Oproprio")]
    public void FindsSongAndArtist(string title, string channel, string song, string artist) =>
        Assert.Equal((song, artist), LyricsService.FromVideo(title, channel));
}
