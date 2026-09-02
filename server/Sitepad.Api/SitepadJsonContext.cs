using System.Text.Json.Serialization;

namespace Sitepad.Api;

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(SyncRequestDto))]
[JsonSerializable(typeof(object))]
internal partial class SitepadJsonContext : JsonSerializerContext;
