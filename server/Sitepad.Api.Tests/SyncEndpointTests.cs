using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;

namespace Sitepad.Api.Tests;

public sealed class SyncEndpointTests
{
    [Test]
    public async Task PostSync_LostResponseRetry_ReturnsStoredAcknowledgement()
    {
        await using var factory = new SitepadFactory();
        var client = factory.CreateClient();
        var request = Request("op-idempotent", note: "synthetic marker");

        var first = await Post(client, request);
        var second = await Post(client, request);

        Assert.That(first.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        Assert.That(
            await second.Content.ReadAsStringAsync(),
            Is.EqualTo(await first.Content.ReadAsStringAsync()));
        Assert.That(await Kind(first), Is.EqualTo("acknowledged"));
    }

    [Test]
    public async Task PostSync_OperationIdReuseWithDifferentPayload_IsRejected()
    {
        await using var factory = new SitepadFactory();
        var client = factory.CreateClient();

        Assert.That(
            (await Post(client, Request("op-reused", note: "one"))).StatusCode,
            Is.EqualTo(HttpStatusCode.OK));
        var reused = await Post(client, Request("op-reused", note: "two"));

        Assert.That(reused.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(await reused.Content.ReadAsStringAsync(), Does.Contain("operation_id_reused"));
    }

    [Test]
    public async Task PostSync_DifferentOperationsAtSameBase_ProducesOneAckAndOneConflict()
    {
        await using var factory = new SitepadFactory();
        var client = factory.CreateClient();

        var responses = await Task.WhenAll(
            Post(client, Request("op-a", note: "first")),
            Post(client, Request("op-b", note: "second")));
        var kinds = await Task.WhenAll(responses.Select(Kind));

        Assert.That(kinds, Does.Contain("acknowledged"));
        Assert.That(kinds, Does.Contain("conflict"));
    }

    [Test]
    public async Task PostSync_ConcurrentSameIdSamePayload_IsDeterministic()
    {
        await using var factory = new SitepadFactory();
        var client = factory.CreateClient();
        var responses = await Task.WhenAll(
            Enumerable.Range(0, 8).Select(_ => Post(client, Request("op-race", note: "same"))));
        var bodies = await Task.WhenAll(responses.Select(response => response.Content.ReadAsStringAsync()));

        Assert.That(responses.Select(response => response.StatusCode), Is.All.EqualTo(HttpStatusCode.OK));
        Assert.That(bodies.Distinct(StringComparer.Ordinal).Count(), Is.EqualTo(1));
    }

    [Test]
    public async Task PostSync_ConcurrentSameIdDifferentPayload_HasOneWinner()
    {
        await using var factory = new SitepadFactory();
        var client = factory.CreateClient();

        var responses = await Task.WhenAll(
            Post(client, Request("op-different-race", note: "left")),
            Post(client, Request("op-different-race", note: "right")));
        var bodies = await Task.WhenAll(
            responses.Select(response => response.Content.ReadAsStringAsync()));

        Assert.That(responses.Count(response => response.StatusCode == HttpStatusCode.OK), Is.EqualTo(1));
        Assert.That(
            responses.Count(response => response.StatusCode == HttpStatusCode.UnprocessableEntity),
            Is.EqualTo(1));
        Assert.That(
            bodies.Any(body => body.Contains("operation_id_reused", StringComparison.Ordinal)),
            Is.True);
    }

    [Test]
    public async Task PostSync_DevelopmentRejection_IsStoredAndReplayed()
    {
        await using var factory = new SitepadFactory();
        var client = factory.CreateClient();
        using var firstRequest = new HttpRequestMessage(HttpMethod.Post, "/api/sync")
        {
            Content = JsonContent.Create(Request("op-rejected", note: "kept locally")),
        };
        firstRequest.Headers.Add("X-Sitepad-Fault", "reject");

        var first = await client.SendAsync(firstRequest);
        var replay = await Post(client, Request("op-rejected", note: "kept locally"));

        Assert.That(first.StatusCode, Is.EqualTo(HttpStatusCode.UnprocessableEntity));
        Assert.That(
            await replay.Content.ReadAsStringAsync(),
            Is.EqualTo(await first.Content.ReadAsStringAsync()));
        Assert.That(await Kind(replay), Is.EqualTo("rejected"));
    }

    [TestCase("""{"operationId":"op-open","inspectionId":"inspection-trafalgar-2-88","baseVersion":1,"base":{"result":"unanswered","note":""},"mine":{"result":"fail","note":""},"unexpected":true}""")]
    [TestCase("""{"operationId":"op-unknown","inspectionId":"unknown-fixture","baseVersion":1,"base":{"result":"unanswered","note":""},"mine":{"result":"fail","note":""}}""")]
    [TestCase("""{"operationId":"op-enum","inspectionId":"inspection-trafalgar-2-88","baseVersion":1,"base":{"result":"unanswered","note":""},"mine":{"result":"invented","note":""}}""")]
    public async Task PostSync_InvalidOrOpenRequest_IsRejected(string json)
    {
        await using var factory = new SitepadFactory();
        var response = await factory.CreateClient().PostAsync(
            "/api/sync",
            new StringContent(json, Encoding.UTF8, "application/json"));

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.BadRequest));
    }

    [Test]
    public async Task PostSync_OversizedRequest_IsRejected()
    {
        await using var factory = new SitepadFactory();
        var json = JsonSerializer.Serialize(Request("op-large", note: new string('x', 33 * 1024)));
        var response = await factory.CreateClient().PostAsync(
            "/api/sync",
            new StringContent(json, Encoding.UTF8, "application/json"));

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.RequestEntityTooLarge));
    }

    [Test]
    public async Task PostSync_UnexpectedContentType_IsRejected()
    {
        await using var factory = new SitepadFactory();
        var response = await factory.CreateClient().PostAsync(
            "/api/sync",
            new StringContent("{}", Encoding.UTF8, "application/jsonp"));

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.UnsupportedMediaType));
    }

    [Test]
    public async Task Cors_GrantsOnlyTheExactViteOrigin()
    {
        await using var factory = new SitepadFactory();
        var client = factory.CreateClient();
        using var allowed = new HttpRequestMessage(HttpMethod.Options, "/api/sync");
        allowed.Headers.Add("Origin", "http://127.0.0.1:4173");
        allowed.Headers.Add("Access-Control-Request-Method", "POST");
        using var denied = new HttpRequestMessage(HttpMethod.Options, "/api/sync");
        denied.Headers.Add("Origin", "http://localhost:4173");
        denied.Headers.Add("Access-Control-Request-Method", "POST");

        var allowedResponse = await client.SendAsync(allowed);
        var deniedResponse = await client.SendAsync(denied);

        Assert.That(
            allowedResponse.Headers.GetValues("Access-Control-Allow-Origin").Single(),
            Is.EqualTo("http://127.0.0.1:4173"));
        Assert.That(deniedResponse.Headers.Contains("Access-Control-Allow-Origin"), Is.False);
    }

    [Test]
    public async Task Serilog_WritesPayloadSafeEventsToConfiguredFilePath()
    {
        const string marker = "SECRET-FILE-SINK-NOTE";
        var factory = new SitepadFactory();
        var logDirectory = factory.LogDirectory;

        await using (factory)
        {
            var response = await Post(
                factory.CreateClient(),
                Request("op-file-log", note: marker));

            Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.OK));
        }

        var logFile = Directory.GetFiles(logDirectory, "sitepad-*.log").Single();
        var log = await File.ReadAllTextAsync(logFile);
        Assert.That(log, Does.Contain("op-file-log"));
        Assert.That(log, Does.Not.Contain(marker));
    }

    [Test]
    public async Task ProductionBuild_DoesNotExposeResetControl()
    {
        await using var factory = new SitepadFactory(environment: "Production");
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/dev/reset");
        request.Headers.Add("X-Sitepad-Confirm", "reset synthetic data");

        var response = await factory.CreateClient().SendAsync(request);

        Assert.That(response.StatusCode, Is.EqualTo(HttpStatusCode.NotFound));
    }

    private static object Request(string operationId, string note) => new
    {
        operationId,
        inspectionId = "inspection-trafalgar-2-88",
        baseVersion = 1,
        @base = new { result = "unanswered", note = "" },
        mine = new { result = "fail", note },
    };

    private static Task<HttpResponseMessage> Post(HttpClient client, object body) =>
        client.PostAsJsonAsync("/api/sync", body);

    private static async Task<string> Kind(HttpResponseMessage response)
    {
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return json.RootElement.GetProperty("kind").GetString()!;
    }
}

internal sealed class SitepadFactory : WebApplicationFactory<Program>
{
    private readonly string directory =
        Path.Combine(Path.GetTempPath(), "sitepad-tests", Guid.NewGuid().ToString("N"));
    private readonly string environment;

    public SitepadFactory(string environment = "Development")
    {
        this.environment = environment;
        Directory.CreateDirectory(directory);
    }

    public string LogDirectory => Path.Combine(directory, "logs");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(environment);
        builder.ConfigureAppConfiguration((_, configuration) =>
            configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Sitepad:DatabasePath"] = Path.Combine(directory, "test.db"),
                ["Sitepad:LogFilePath"] = Path.Combine(LogDirectory, "sitepad-.log"),
            }));
    }
}
