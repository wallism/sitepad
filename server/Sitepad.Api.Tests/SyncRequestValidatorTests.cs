using System.Text;
using Sitepad.Api;

namespace Sitepad.Api.Tests;

public sealed class SyncRequestValidatorTests
{
    [Test]
    public void CanonicalBytes_EquivalentNormalizedRequests_AreIdentical()
    {
        var first = Validate(Request("op-1", "line one\r\nline two"));
        var second = Validate(Request("op-1", "line one\nline two"));

        Assert.That(
            Convert.ToHexString(OperationLedger.CanonicalBytes(second)),
            Is.EqualTo(Convert.ToHexString(OperationLedger.CanonicalBytes(first))));
        Assert.That(
            Encoding.UTF8.GetString(OperationLedger.CanonicalBytes(first)),
            Is.EqualTo("""{"operationId":"op-1","inspectionId":"inspection-trafalgar-2-88","baseVersion":1,"base":{"result":"unanswered","note":""},"mine":{"result":"fail","note":"line one\nline two"}}"""));
    }

    [TestCase("")]
    [TestCase("not-a-result")]
    public void TryValidate_UnknownResult_IsRejected(string result)
    {
        var request = Request("op-1", "note") with
        {
            Mine = new DeliverySnapshotDto(result, "note"),
        };

        Assert.That(SyncRequestValidator.TryValidate(
            request,
            out _,
            out var code,
            out _), Is.False);
        Assert.That(code, Is.EqualTo("invalid_mutation"));
    }

    private static SyncRequestDto Request(string operationId, string note) =>
        new(
            operationId,
            SyncRequestValidator.KnownInspectionId,
            1,
            new("unanswered", string.Empty),
            new("fail", note));

    private static ValidatedSyncRequest Validate(SyncRequestDto request)
    {
        Assert.That(SyncRequestValidator.TryValidate(
            request,
            out var validated,
            out _,
            out _), Is.True);
        return validated!;
    }
}
