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
