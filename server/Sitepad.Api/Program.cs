using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Net.Http.Headers;
using Sitepad.Api;

var builder = WebApplication.CreateBuilder(args);

builder.WebHost.ConfigureKestrel(options =>
{
    options.Limits.MaxRequestBodySize = 32 * 1024;
});
builder.Services.AddCors(options =>
{
    options.AddPolicy("sitepad-client", policy =>
        policy.WithOrigins("http://127.0.0.1:4173")
            .WithMethods("POST")
            .WithHeaders("Content-Type", "X-Sitepad-Fault"));
});
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.SerializerOptions.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow;
});
builder.Services.AddSingleton<OperationLedger>();

var app = builder.Build();
if (string.IsNullOrWhiteSpace(builder.Configuration["urls"])
    && string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
    app.Urls.Add("http://127.0.0.1:5079");
}

app.UseCors("sitepad-client");

app.MapPost("/api/sync", async (
    HttpContext context,
    OperationLedger ledger,
    IHostEnvironment environment,
    ILogger<Program> logger,
    CancellationToken cancellationToken) =>
{
    if (!MediaTypeHeaderValue.TryParse(context.Request.ContentType, out var contentType)
        || !string.Equals(contentType.MediaType, "application/json", StringComparison.OrdinalIgnoreCase))
    {
        return Results.Json(
            new { code = "unsupported_content_type", message = "Use application/json." },
            statusCode: StatusCodes.Status415UnsupportedMediaType);
    }

    if (context.Request.ContentLength is > 32 * 1024)
    {
        return Results.Json(
            new { code = "request_too_large", message = "The request exceeds 32 KiB." },
            statusCode: StatusCodes.Status413PayloadTooLarge);
    }

    using var reader = new StreamReader(
        context.Request.Body,
        Encoding.UTF8,
        detectEncodingFromByteOrderMarks: false,
        bufferSize: 4096,
        leaveOpen: true);
    var json = await reader.ReadToEndAsync(cancellationToken);
    if (Encoding.UTF8.GetByteCount(json) > 32 * 1024)
    {
        return Results.Json(
            new { code = "request_too_large", message = "The request exceeds 32 KiB." },
            statusCode: StatusCodes.Status413PayloadTooLarge);
    }

    SyncRequestDto? request;
    try
    {
        request = JsonSerializer.Deserialize(json, SitepadJsonContext.Default.SyncRequestDto);
    }
    catch (JsonException)
    {
        return Results.Json(
            new { code = "invalid_json", message = "The JSON body does not match the closed request schema." },
            statusCode: StatusCodes.Status400BadRequest);
    }

    if (!SyncRequestValidator.TryValidate(request, out var validated, out var code, out var message))
    {
        logger.LogWarning("Sync request rejected with code {Code}", code);
        return Results.Json(new { code, message }, statusCode: StatusCodes.Status400BadRequest);
    }

    var rejectForDevelopment =
        environment.IsDevelopment()
        && string.Equals(
            context.Request.Headers["X-Sitepad-Fault"].ToString(),
            "reject",
            StringComparison.Ordinal);
    var result = ledger.Apply(validated!, rejectForDevelopment);
    logger.LogInformation(
        "Sync operation {OperationId} for inspection {InspectionId} finished as {Outcome}; replayed {Replayed}",
        validated!.OperationId,
        validated.InspectionId,
        result.Outcome,
        result.Replayed);
    return Results.Text(result.Json, "application/json", statusCode: result.StatusCode);
}).RequireCors("sitepad-client");

if (app.Environment.IsDevelopment())
{
    app.MapPost("/api/dev/reset", (
        HttpContext context,
        OperationLedger ledger) =>
    {
        if (!string.Equals(
                context.Request.Headers["X-Sitepad-Confirm"].ToString(),
                "reset synthetic data",
                StringComparison.Ordinal))
        {
            return Results.BadRequest(new { code = "confirmation_required" });
        }

        ledger.Reset();
        return Results.NoContent();
    });
}

app.Run();

public partial class Program;
