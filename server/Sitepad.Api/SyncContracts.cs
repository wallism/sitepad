using System.Text.Json.Serialization;

namespace Sitepad.Api;

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record DeliverySnapshotDto(string Result, string Note);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record SyncRequestDto(
    string OperationId,
    string InspectionId,
    long BaseVersion,
    DeliverySnapshotDto Base,
    DeliverySnapshotDto Mine);

public sealed record ValidatedSyncRequest(
    string OperationId,
    string InspectionId,
    long BaseVersion,
    DeliverySnapshotDto Base,
    DeliverySnapshotDto Mine);

public static class SyncRequestValidator
{
    private static readonly HashSet<string> Results =
        new(StringComparer.Ordinal) { "unanswered", "pass", "fail", "not_applicable" };

    public const string KnownInspectionId = "inspection-trafalgar-2-88";

    public static bool TryValidate(
        SyncRequestDto? request,
        out ValidatedSyncRequest? validated,
        out string code,
        out string message)
    {
        validated = null;
        if (request is null)
        {
            code = "invalid_request";
            message = "A request body is required.";
            return false;
        }

        if (!ValidIdentifier(request.OperationId) || !ValidIdentifier(request.InspectionId))
        {
            code = "invalid_identifier";
            message = "Identifiers must be 1 to 128 safe characters.";
            return false;
        }

        if (!string.Equals(request.InspectionId, KnownInspectionId, StringComparison.Ordinal))
        {
            code = "unknown_inspection";
            message = "The synthetic inspection fixture is not known.";
            return false;
        }

        if (request.BaseVersion < 1
            || !ValidSnapshot(request.Base)
            || !ValidSnapshot(request.Mine))
        {
            code = "invalid_mutation";
            message = "The version, result, or note is invalid.";
            return false;
        }

        validated = new(
            request.OperationId,
            request.InspectionId,
            request.BaseVersion,
            Normalize(request.Base),
            Normalize(request.Mine));
        code = string.Empty;
        message = string.Empty;
        return true;
    }

    private static bool ValidIdentifier(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128)
        {
            return false;
        }

        return value.All(character =>
            char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.');
    }

    private static bool ValidSnapshot(DeliverySnapshotDto? snapshot) =>
        snapshot is not null
        && Results.Contains(snapshot.Result)
        && snapshot.Note is not null
        && snapshot.Note.Length <= 2_000;

    private static DeliverySnapshotDto Normalize(DeliverySnapshotDto snapshot) =>
        new(
            snapshot.Result,
            snapshot.Note
                .Replace("\r\n", "\n", StringComparison.Ordinal)
                .Replace('\r', '\n')
                .Normalize());
}
