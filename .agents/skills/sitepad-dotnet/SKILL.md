---
name: sitepad-dotnet
description: Write or review Sitepad C# and .NET 10 code using modern language, async, dependency injection, API, error-handling, and maintainability practices. Use for the .NET API and shared C# code. Do not use for frontend code, deployment, or test-only tasks.
---

# Sitepad C# and .NET

Build a small, explicit .NET 10 backend that preserves the offline client's idempotency and conflict contract.

## Before changing code

- Inspect the solution, target frameworks, nullable settings, analyzers, formatting rules, and established conventions.
- Read the minimal API contract and response classification in `docs/work/20260903-initial-work.md` before changing API behavior.
- Use APIs supported by the pinned SDK. Verify current Microsoft documentation before introducing a version-sensitive feature.

## Practices

- Enable nullable reference types and model absence explicitly. Validate data at the boundary rather than spreading defensive null checks through the domain.
- Prefer small cohesive types, clear names, and explicit dependencies. Do not add abstraction until there is a real second implementation or a test seam with behavioral value.
- Use asynchronous APIs for I/O end to end. Return `Task` or `ValueTask` as appropriate, avoid `async void`, propagate `CancellationToken`, and do not block with `.Result` or `.Wait()`.
- Do not use exceptions for expected domain outcomes. Model acknowledged, conflict, rejected, and retryable results explicitly and translate them once at the HTTP boundary.
- Use built-in dependency injection, configuration/options, logging, Problem Details, and framework features before adding packages.
- Keep request models separate from durable domain or persistence models where their evolution differs. Avoid binding persistence entities directly to HTTP input.
- Keep time, ID generation, and transport effects injectable where deterministic behavior matters.
- Dispose owned resources deterministically. Do not dispose services owned by the DI container.
- Use structured logging with stable event meaning; do not log inspection content or secrets by default.

## Sitepad API invariants

- The operation ledger enforces a unique `operationId`; a duplicate returns the original completed response without reapplying the mutation.
- SQLite updates that establish idempotency and the resulting server version must be atomic.
- A base-version mismatch returns the current server snapshot needed for a three-way merge; do not silently use last-write-wins.
- Classify timeouts, transport failures, `408`, `429`, and `5xx` as retryable. Treat documented validation or authorization outcomes as definite rejections without deleting client evidence.
- Keep the first API narrow. Do not grow production architecture around the learning slice.

## Validation

- Run formatting or analyzers already configured, then the smallest relevant build and tests.
- Use `sitepad-dotnet-unit-tests` for pure C# behavior. The HTTP contract, SQLite ledger, and duplicate-request proof require integration tests.
- Report local build/test evidence separately from deployment or live proof.

## Primary sources

- [C# coding conventions](https://learn.microsoft.com/dotnet/csharp/fundamentals/coding-style/coding-conventions)
- [Asynchronous programming scenarios](https://learn.microsoft.com/dotnet/csharp/asynchronous-programming/async-scenarios)
- [ASP.NET Core Minimal APIs](https://learn.microsoft.com/aspnet/core/fundamentals/minimal-apis)
