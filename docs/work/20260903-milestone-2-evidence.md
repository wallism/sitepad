# Milestone 2 Evidence - Durable delivery

Date: 2026-09-03
Scope: local synthetic learning build
Result: PASS - milestone 2 complete; milestone 3 not started

## Delivered boundary

The first **Complete & queue to send** intent synchronously enters `completing`, captures the current revision, and freezes later edits. The listener flushes that exact revision before one IndexedDB transaction changes the inspection to `completed` and inserts one self-contained outbox operation.

Every delivery trigger reaches the same `syncRequested` listener. The coordinator uses a runtime mutex and an atomic IndexedDB claim with a 30-second lease. Each retry sends the operation's stored `requestJson` unchanged. A response changes visible state only after IndexedDB verifies both operation and claim IDs and commits the response with its inspection projection.

The loopback .NET 10 API validates a closed request before ledger access. One immediate SQLite transaction performs the operation lookup, canonical SHA-256 fingerprint comparison, server-version comparison, inspection mutation, and terminal-response insert. Duplicate same-fingerprint operations replay the stored response; different-fingerprint reuse is rejected.

## Gate evidence

| Gate | Proof |
|---|---|
| Duplicate Complete and duplicate sync triggers | Chromium double-click creates one outbox operation; concurrent `syncRequested` intents produce one request |
| Atomic completion failure | Injected write abort restores `in_progress`, leaves editing available, and creates no operation |
| Stale and expired claims | Chromium replaces an expired claim; the earlier claim's response returns `stale` and cannot update the operation |
| Lost local response | Injected response-transaction failure leaves `sending`; lease recovery sends the identical stored JSON and commits the replayed acknowledgement |
| Retry classification | Unit and browser tests cover network/protocol retry, capped scheduling inputs, definite rejection, and retained attempt history |
| Malformed response | Unknown response kind becomes durable `retryable/protocol_error`, never a terminal rejection |
| Oversized, open, enum, and fixture validation | Hosted API tests reject payloads over 32 KiB, unexpected JSON members, unknown result values, and unknown inspection IDs |
| Idempotent retry | SQLite test sends the same operation twice and receives the exact stored acknowledgement |
| Concurrent SQLite behavior | Tests cover same-ID/same-payload, same-ID/different-payload, and different-ID/same-base races |
| Canonical fingerprint | CRLF and LF equivalents validate to identical canonical UTF-8 bytes |
| Definite rejection | Development rejection is stored, replayed unchanged, retained in IndexedDB, and not retried |
| Exact-origin CORS | Only `http://127.0.0.1:4173` receives the allow-origin header |
| Log redaction | Captured client and server logs contain lifecycle metadata but exclude marker note values |
| Production fault-control exclusion | Production client assets contain no fault-control labels; production API returns 404 for the reset route |
| Outbox reload recovery | Chromium closes and reopens a persistent profile and restores the same durable operation ID and request |

## Commands and results

```text
npm --prefix client test -- --run
9 files passed; 40 tests passed

npm --prefix client run test:e2e
15 tests passed

npm --prefix client run build
TypeScript build and Vite production build passed

dotnet test server\Sitepad.Api.Tests\Sitepad.Api.Tests.csproj --no-restore
17 tests passed

dotnet build server\Sitepad.Api\Sitepad.Api.csproj
Build succeeded with 0 warnings and 0 errors

dotnet list server\Sitepad.Api\Sitepad.Api.csproj package --vulnerable --include-transitive
No vulnerable packages reported by the configured sources

dotnet list server\Sitepad.Api.Tests\Sitepad.Api.Tests.csproj package --vulnerable --include-transitive
No vulnerable packages reported by the configured sources

rg -n "Fail next write|Fail next send|Fail next response write|api/dev/reset" client\dist
No matches
```

The dependency audit was run after pinning `Microsoft.Data.Sqlite` 10.0.11, which selects the patched SQLitePCLRaw native bundle line.

## Evidence limits

- Browser API responses in the client lifecycle tests use Playwright route fixtures so transport and local recovery timing are deterministic.
- The .NET tests independently exercise the hosted HTTP endpoint and real temporary SQLite databases, including concurrent requests.
- This is local validation only. No deployment, remote environment, authentication, or live-production proof occurred.
- Conflict responses are retained and surfaced, but merge and resolution behavior is milestone 3 and remains unimplemented.
