using PhoneBox.Agent;
using Xunit;

namespace PhoneBox.Agent.Tests;

/// <summary>Federano "Reuniões": Meet links from the calendar, the Meet tab's buttons and which addresses may be opened.</summary>
public class MeetTests
{
    [Theory]
    [InlineData("https://meet.google.com/abc-defg-hij", "https://meet.google.com/abc-defg-hij")]
    [InlineData("Entre pelo Google Meet: meet.google.com/xyz-abcd-efg\nOu ligue para ...", "https://meet.google.com/xyz-abcd-efg")]
    [InlineData("Sala 3", null)]
    [InlineData("https://meet.google.com/lookup/abc", null)]
    public void FindsTheMeetLink(string text, string? expected) => Assert.Equal(expected, Ics.MeetLink(text));

    [Theory]
    [InlineData("https://meet.google.com/abc-defg-hij", true)]
    [InlineData("https://meet.google.com/abc-defg-hij?authuser=1", false)]
    [InlineData("https://evil.example/meet.google.com/abc-defg-hij", false)]
    [InlineData("file:///C:/Windows/System32/calc.exe", false)]
    [InlineData(null, false)]
    public void OpensOnlyMeetRooms(string? url, bool ok) => Assert.Equal(ok, MeetHub.ValidRoom(url));

    [Fact]
    public void AButtonPressedOnTheTabletReachesTheMeetTabOnce()
    {
        var hub = new MeetHub();
        Assert.False(hub.Press("mic"));                       // no call open
        Assert.Null(hub.Report(new(7, true, true, false, false, "abc-defg-hij", 0)));
        Assert.True(hub.Press("mic"));
        Assert.False(hub.Press("rm -rf"));
        Assert.Equal("mic", hub.Report(new(7, true, true, false, false, "abc-defg-hij", 0)));
        Assert.Null(hub.Report(new(7, true, false, false, false, "abc-defg-hij", 0)));
        Assert.Equal(7, hub.Current?.Tab);
    }
}
