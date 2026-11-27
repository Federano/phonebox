using System.Net;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using PhoneBox.Agent;
using Xunit;

namespace PhoneBox.Agent.Tests;

public class VideoLyricsTests
{
    private sealed class Clock : TimeProvider
    {
        private DateTimeOffset _now = DateTimeOffset.Parse("2026-11-27T12:00:00Z");
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan amount) => _now += amount;
    }

    private sealed class Handler(Func<Uri, HttpResponseMessage> answer) : HttpMessageHandler
    {
        public readonly List<Uri> Requests = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            Requests.Add(request.RequestUri!);
            return Task.FromResult(answer(request.RequestUri!));
        }
    }

    private static HttpResponseMessage Json(params JsonObject[] hits) => new(HttpStatusCode.OK)
    {
        Content = new StringContent(new JsonArray(hits.Select(h => (JsonNode)h).ToArray()).ToJsonString())
    };

    private static JsonObject Hit(string song, string artist, double seconds = 200, string plain = "Linha fictícia\nOutra linha",
        string synced = "[00:01.00] Linha fictícia\n[00:10.00] Outra linha") => new()
    {
        ["trackName"] = song, ["artistName"] = artist, ["duration"] = seconds,
        ["plainLyrics"] = plain, ["syncedLyrics"] = synced, ["instrumental"] = false
    };

    private static LyricsService Service(Handler handler, TimeProvider? clock = null) => new(
        NullLogger<LyricsService>.Instance, new HttpClient(handler) { BaseAddress = new("https://lyrics.test/api/") },
        _ => Task.FromResult<(IReadOnlyList<string>?, string)>((null, "pt")), clock);

    [Fact]
    public async Task CoverUsesTheNamedOriginalArtistWithoutBorrowingItsTimestamps()
    {
        var handler = new Handler(uri => Uri.UnescapeDataString(uri.Query).Contains("artist_name=Medulla")
            ? Json(Hit("Abraço", "Medulla", 217)) : Json());
        var words = await Service(handler).GetVideoAsync("Abraço (Medulla) - Supercombo | ELEFANTE SESSIONS", "Elefante Sessions", 240000);
        Assert.True(words.Found);
        Assert.Empty(words.Lines);
        Assert.Equal("Linha fictícia\nOutra linha", words.Plain);
        Assert.Equal(2, handler.Requests.Count);
        Assert.Contains("track_name=Abraço&artist_name=Supercombo", Uri.UnescapeDataString(handler.Requests[0].Query));
        Assert.Contains("track_name=Abraço&artist_name=Medulla", Uri.UnescapeDataString(handler.Requests[1].Query));
    }

    [Fact]
    public async Task ReversedTitleCanBeFoundEvenWhenTheChannelIsNotTheArtist()
    {
        var handler = new Handler(uri => Uri.UnescapeDataString(uri.Query).Contains("track_name=Abraço&artist_name=Supercombo")
            ? Json(Hit("Abraço", "Supercombo")) : Json());
        var words = await Service(handler).GetVideoAsync("Abraço - Supercombo | ELEFANTE SESSIONS", "Elefante Sessions", 200000);
        Assert.True(words.Found);
        Assert.Equal(2, words.Lines.Count);
    }

    [Fact]
    public async Task ChoosesTheVideoRecordingInsteadOfTheShorterAlbumVersion()
    {
        var handler = new Handler(_ => Json(Hit("Todo Dia É Dia de Comemorar", "Supercombo", 213),
            Hit("Todo Dia É Dia de Comemorar", "Supercombo", 235, synced: "[00:20.00] Linha fictícia")));
        var words = await Service(handler).GetVideoAsync("Supercombo - Todo Dia é Dia de Comemorar", "Supercombo", 235021);
        Assert.True(words.Found);
        Assert.Equal(235, words.Seconds);
        Assert.Equal(20000, Assert.Single(words.Lines).T);
    }

    [Fact]
    public async Task ARecordingOfDifferentLengthStillProvidesWordsWithoutFalseTiming()
    {
        var handler = new Handler(_ => Json(Hit("Song", "Artist", 213)));
        var words = await Service(handler).GetVideoAsync("Artist - Song", "Artist", 235000);
        Assert.True(words.Found);
        Assert.Empty(words.Lines);
        Assert.NotEmpty(words.Plain);
    }

    [Fact]
    public async Task ExactVideoEntryWinsOverAlbumLyricsCopiedWithTheVideoDuration()
    {
        var handler = new Handler(_ => Json(Hit("Todo Dia É Dia de Comemorar", "Supercombo", 213),
            Hit("Todo Dia É Dia de Comemorar", "Supercombo", 235, synced: "[00:00.02] Linha fictícia"),
            Hit("Supercombo - Todo Dia é Dia de Comemorar", "Supercombo", 235, synced: "[00:20.18] Linha fictícia")));
        var words = await Service(handler).GetVideoAsync("Supercombo - Todo Dia é Dia de Comemorar", "Supercombo", 235021);
        Assert.True(words.Found);
        Assert.Equal(20180, Assert.Single(words.Lines).T);
    }

    [Fact]
    public async Task DurationArrivingAfterTheFirstPollSelectsTheMatchingRecording()
    {
        var handler = new Handler(_ => Json(Hit("Song", "Artist", 200),
            Hit("Song", "Artist", 235, synced: "[00:30.00] Linha fictícia")));
        var service = Service(handler);
        Assert.Equal(200, (await service.GetVideoAsync("Artist - Song", "Artist", 0)).Seconds);
        var words = await service.GetVideoAsync("Artist - Song", "Artist", 235000);
        Assert.Equal(235, words.Seconds);
        Assert.Equal(30000, Assert.Single(words.Lines).T);
    }

    [Fact]
    public async Task OzymandiasKeepsWordsWithoutUsingTheTimingOfTheShorterRecording()
    {
        var handler = new Handler(_ => Json(Hit("Ozymandias", "Cauê Moura", 254), Hit("Ozymandias", "Cauê Moura", 225)));
        var words = await Service(handler).GetVideoAsync("Caue Moura - Ozymandias ♫ (prod. Marcus Maia)", "Caue Moura", 263241);
        Assert.True(words.Found);
        Assert.Empty(words.Lines);
        Assert.NotEmpty(words.Plain);
        Assert.Equal(254, words.Seconds);
        Assert.Contains("track_name=Ozymandias&artist_name=Caue%20Moura", handler.Requests[0].Query);
    }

    [Theory]
    [InlineData("Another Song", "Artist")]
    [InlineData("Song", "Another Artist")]
    [InlineData("Song (Remix)", "Artist")]
    public async Task SearchDoesNotAcceptAnUnrelatedSongOrArtist(string song, string artist)
    {
        var handler = new Handler(_ => Json(Hit(song, artist)));
        Assert.False((await Service(handler).GetVideoAsync("Artist - Song", "Artist", 200000)).Found);
    }

    [Fact]
    public async Task CacheDoesNotMixAStudioRecordingAndACoverOfTheSameSong()
    {
        var handler = new Handler(_ => Json(Hit("Song", "Artist")));
        var service = Service(handler);
        var studio = await service.GetVideoAsync("Artist - Song", "Artist", 200000);
        var cover = await service.GetVideoAsync("Song (Artist) - Cover Band", "Sessions", 240000);
        Assert.NotEmpty(studio.Lines);
        Assert.Empty(cover.Lines);
        Assert.NotEqual(studio.Key, cover.Key);
    }

    [Fact]
    public async Task AFailedLookupCanRecoverAndDoesNotSpamTheProviderWhileCached()
    {
        var clock = new Clock();
        var available = false;
        var handler = new Handler(_ => available ? Json(Hit("Song", "Artist")) : Json());
        var service = Service(handler, clock);
        Assert.False((await service.GetVideoAsync("Artist - Song", "Artist", 200000)).Found);
        var attempts = handler.Requests.Count;
        available = true;
        Assert.False((await service.GetVideoAsync("Artist - Song", "Artist", 200000)).Found);
        Assert.Equal(attempts, handler.Requests.Count);
        clock.Advance(TimeSpan.FromMinutes(5));
        Assert.True((await service.GetVideoAsync("Artist - Song", "Artist", 200000)).Found);
        Assert.Equal(attempts + 1, handler.Requests.Count);
    }

    [Fact]
    public async Task ATemporaryErrorCanRecoverAfterThirtySeconds()
    {
        var clock = new Clock();
        var unavailable = true;
        var handler = new Handler(_ => unavailable ? throw new HttpRequestException("offline") : Json(Hit("Song", "Artist")));
        var service = Service(handler, clock);
        Assert.False((await service.GetVideoAsync("Artist - Song", "Artist", 200000)).Found);
        unavailable = false;
        clock.Advance(TimeSpan.FromSeconds(30));
        Assert.True((await service.GetVideoAsync("Artist - Song", "Artist", 200000)).Found);
    }

    [Fact]
    public async Task RetryAfterIsRespectedAcrossDifferentVideos()
    {
        var clock = new Clock();
        var throttled = true;
        var handler = new Handler(_ =>
        {
            if (!throttled) return Json(Hit("Song", "Artist"));
            var response = new HttpResponseMessage(HttpStatusCode.TooManyRequests);
            response.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromMinutes(2));
            return response;
        });
        var service = Service(handler, clock);
        Assert.False((await service.GetVideoAsync("Artist - Song", "Artist", 200000)).Found);
        Assert.False((await service.GetVideoAsync("Artist - Other Song", "Artist", 200000)).Found);
        Assert.Single(handler.Requests);
        throttled = false;
        clock.Advance(TimeSpan.FromMinutes(2));
        Assert.True((await service.GetVideoAsync("Artist - Song", "Artist", 200000)).Found);
    }

    [Fact]
    public async Task SuccessfulLookupIsReusedOnTheNextPoll()
    {
        var handler = new Handler(_ => Json(Hit("Song", "Artist")));
        var service = Service(handler);
        var answers = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => service.GetVideoAsync("Artist - Song", "Artist", 200000)));
        Assert.All(answers, words => Assert.True(words.Found));
        Assert.Single(handler.Requests);
    }
}
