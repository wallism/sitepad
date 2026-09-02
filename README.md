# Sitepad

Sitepad is an offline-first inspection application for field work where connectivity is unreliable. It is also a focused learning build for React, Redux Toolkit, IndexedDB, idempotent delivery, and SQLite. Each milestone proves one durability or delivery boundary before adding more product scope.

## Current scope

Milestone 2 delivers one synthetic inspection from local editing through durable foreground delivery:

1. React dispatches checklist intent.
2. Redux immediately projects the new revision.
3. An RTK listener commits the revision to IndexedDB.
4. The first **Complete & queue to send** freezes editing, flushes the captured revision, and atomically creates one self-contained outbox operation.
5. The foreground coordinator claims that operation with a 30-second lease and sends its exact stored JSON representation.
6. The .NET API applies the operation once through a SQLite idempotency ledger.
7. The client commits the claim-correlated response to IndexedDB before showing a terminal delivery state.

The UI can show **On this device**, **Finishing on this device**, **Waiting to send**, **Sending**, **Couldn't send - will retry**, **Sent**, **Needs your call**, or **Couldn't be accepted - kept on this device**. Manual retry preserves attempt history. Conflicted and rejected evidence is retained.

This remains a synthetic, loopback-only learning build. It has no authentication, production authorization, real field data, deployment, photo capture, service worker, background delivery guarantee, or milestone 3 conflict-resolution UI.

## Architecture

```text
React intent
    -> Redux projection
    -> RTK listener
    -> IndexedDB inspection + outbox transactions
    -> foreground claim / lease coordinator
    -> exact JSON transport
    -> .NET 10 validation
    -> SQLite inspection + idempotency ledger transaction
    -> claim-correlated IndexedDB response transaction
    -> Redux delivery projection
```

React components render selectors and dispatch intent. Redux owns only the current in-memory projection. IndexedDB is the authoritative committed local snapshot and durable outbox. The sync coordinator owns orchestration, not durable state. SQLite owns the acknowledged server version and operation ledger.

## Technology

| Area | Technology |
|---|---|
| UI | React 19, React DOM, strict TypeScript |
| Client state and effects | Redux Toolkit, React Redux, listener middleware |
| Local durability | Raw IndexedDB and Web Locks |
| Client development | Vite 7 |
| Client tests | Vitest, React Testing Library, Playwright Chromium |
| API | .NET 10 minimal API |
| Server durability | Microsoft.Data.Sqlite and SQLite WAL |
| Server tests | NUnit, NSubstitute, and ASP.NET Core in-memory hosting |

## Run locally

Prerequisites: Node.js `^20.19.0` or `>=22.12.0`, npm, the .NET 10 SDK, and current Chrome or Edge.

Start the API:

```powershell
dotnet run --project server/Sitepad.Api/Sitepad.Api.csproj
```

Start the client in another terminal:

```powershell
npm --prefix client ci
npm --prefix client run dev
```

The client runs at `http://127.0.0.1:4173`; the API binds to `http://127.0.0.1:5079`. The API grants CORS only to that exact Vite origin. Override the client endpoint at build time with `VITE_SITEPAD_API_URL`.

## Verification

```powershell
npm --prefix client test -- --run
npm --prefix client run test:e2e
npm --prefix client run build
dotnet test server/Sitepad.Api.Tests/Sitepad.Api.Tests.csproj
dotnet list server/Sitepad.Api/Sitepad.Api.csproj package --vulnerable --include-transitive
```

## Development diagnostics

Development builds expose a **Learning trace** with payload-safe completion, claim, send, retry, acknowledgement, conflict, rejection, stale-response, and recovery events. Fault controls can fail the next draft write, send, or local response transaction. They are removed from the production client bundle.

The development API accepts the synthetic `X-Sitepad-Fault: reject` control and exposes an explicitly confirmed synthetic-database reset. Neither control is mapped in a production environment. Application logs contain operation metadata, timings, outcomes, and stable codes; they do not contain notes, snapshots, request or response bodies, or binary content.

## Repository layout

- `client/src/features/inspection/` - inspection UI, domain types, Redux slice, and selectors.
- `client/src/app/` - bootstrap, persistence listener, completion orchestration, and sync coordinator.
- `client/src/storage/` - IndexedDB transactions, edit lock, and development fault boundaries.
- `client/src/sync/` - transport and strict terminal-response validation.
- `client/tests/e2e/` - real-browser durability, completion, claim, retry, and recovery proofs.
- `server/Sitepad.Api/` - validated sync endpoint and SQLite ledger.
- `server/Sitepad.Api.Tests/` - validation, HTTP, idempotency, CORS, logging, and concurrency proofs.
- `docs/work/` - reviewed plan and milestone evidence packets.

See the [initial implementation plan](docs/work/20260903-initial-work.md), [UI/UX design](docs/design-v0.1.md), [Milestone 1 evidence](docs/work/20260903-milestone-1-evidence.md), and [Milestone 2 evidence](docs/work/20260903-milestone-2-evidence.md).
