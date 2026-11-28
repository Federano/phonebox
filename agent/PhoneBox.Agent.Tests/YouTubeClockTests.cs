using PhoneBox.Agent;
using Xunit;

namespace PhoneBox.Agent.Tests;

public class YouTubeClockTests
{
    private sealed class Clock : TimeProvider
    {
        private long _ticks;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => _ticks;
        public void Advance(double seconds) => _ticks += TimeSpan.FromSeconds(seconds).Ticks;
    }

    [Fact]
    public void BrowserPlaybackRateControlsBothClocksWithoutLosingMilliseconds()
    {
        var clock = new Clock();
        var yt = new YouTubeTracker(clock);
        yt.Update("abcdefghijk", 25.125, true, "Artist - Song", rate: 2.5);
        clock.Advance(2);
        var position = yt.PositionFor("Artist - Song")!.Value;
        Assert.Equal(30125, position.PosMs);
        Assert.Equal(2.5, position.PlaybackRate);
        Assert.True(position.Advancing);
        Assert.Equal(30, yt.Current()!.Value.Seconds);
    }

    [Fact]
    public void BufferingFreezesTheSongWithoutTurningAPlayingVideoIntoAPause()
    {
        var clock = new Clock();
        var yt = new YouTubeTracker(clock);
        yt.Update("abcdefghijk", 25.125, true, "Artist - Song", rate: 2, advancing: false);
        clock.Advance(3);
        var position = yt.PositionFor("Artist - Song")!.Value;
        Assert.Equal(25125, position.PosMs);
        Assert.True(position.Playing);
        Assert.False(position.Advancing);
        yt.Update("abcdefghijk", 25.125, true, "Artist - Song", rate: 2, advancing: true);
        clock.Advance(2);
        Assert.Equal(29125, yt.PositionFor("Artist - Song")!.Value.PosMs);
    }

    [Fact]
    public void AdsKeepTheLastContentPositionAndNeverUseTheAdsOwnTime()
    {
        var clock = new Clock();
        var yt = new YouTubeTracker(clock);
        yt.Update("abcdefghijk", 20.5, true, "Artist - Song");
        clock.Advance(2);
        yt.Update("abcdefghijk", 1, true, "Artist - Song", isAd: true);
        clock.Advance(3);
        yt.Update("abcdefghijk", 4, true, "Artist - Song", isAd: true);
        var ad = yt.PositionFor("Artist - Song")!.Value;
        Assert.Equal(22500, ad.PosMs);
        Assert.True(ad.IsAd);
        Assert.True(ad.Playing);
        Assert.False(ad.Advancing);
        yt.Update("abcdefghijk", 24.75, true, "Artist - Song");
        Assert.Equal(24750, yt.PositionFor("Artist - Song")!.Value.PosMs);
        Assert.False(yt.PositionFor("Artist - Song")!.Value.IsAd);
    }

    [Fact]
    public void AnAdBeforeAnyContentReportDoesNotSupplyItsClock()
    {
        var yt = new YouTubeTracker(new Clock());
        yt.Update("abcdefghijk", 47, true, "Artist - Song", isAd: true);
        Assert.Equal(0, yt.PositionFor("Artist - Song")!.Value.PosMs);
    }

    [Fact]
    public void SeekAndPauseApplyImmediatelyAndExpiredReportsCannotDriveLyrics()
    {
        var clock = new Clock();
        var yt = new YouTubeTracker(clock);
        yt.Update("abcdefghijk", 80, true, "Artist - Song", rate: 2);
        clock.Advance(2);
        yt.Update("abcdefghijk", 12.125, true, "Artist - Song", rate: 0.5);
        clock.Advance(2);
        Assert.Equal(13125, yt.PositionFor("Artist - Song")!.Value.PosMs);
        yt.Update("abcdefghijk", 13.125, false, "Artist - Song", advancing: true);
        clock.Advance(3);
        Assert.Equal(13125, yt.PositionFor("Artist - Song")!.Value.PosMs);
        Assert.False(yt.PositionFor("Artist - Song")!.Value.Advancing);
        clock.Advance(8);
        Assert.Null(yt.PositionFor("Artist - Song"));
        Assert.Null(yt.Current());
    }

    [Theory]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NaN)]
    [InlineData(-1)]
    public void InvalidReportsDoNotReplaceTheLastGoodClock(double time)
    {
        var yt = new YouTubeTracker(new Clock());
        yt.Update("abcdefghijk", 12.125, false, "Artist - Song");
        yt.Update("abcdefghijk", time, true, "Other song");
        Assert.Equal(12125, yt.PositionFor("Artist - Song")!.Value.PosMs);
        Assert.Null(yt.PositionFor("Other song"));
    }
}
