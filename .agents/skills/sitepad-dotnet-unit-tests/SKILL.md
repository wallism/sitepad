---
name: sitepad-dotnet-unit-tests
description: Write or review isolated C# unit tests for Sitepad domain logic and small services. Use for pure behavior, validation, state transitions, retry classification, merge rules, and deterministic collaborators. Excludes hosted API, SQLite, filesystem, network, and end-to-end tests.
---

# Sitepad C# Unit Tests

Create fast, isolated, repeatable tests that document behavior and fail under plausible regressions.

## Before writing tests

- Inspect the solution's framework, assertion library, mocking library, naming, project layout, nullable settings, and shared fixtures. Follow existing conventions.
- Do not change production behavior merely to make a mistaken test pass. Resolve mismatches against the requirement and implementation evidence.
- If no test framework exists, present the smallest framework choice separately; do not add packages without authorization.

## Practices

- Unit-test code under the team's control without database, filesystem, HTTP, hosted server, or real clock dependencies.
- Focus on observable behavior: exact result values, state transitions, classifications, and meaningful collaborator calls.
- Use Arrange, Act, Assert when it improves readability. Name tests as behavior, commonly `Member_Scenario_ExpectedOutcome`, while preserving established style.
- Cover the happy path, boundaries, and domain-significant failure paths. Do not chase a coverage percentage or test language/runtime behavior.
- Use parameterized tests for the same behavior over meaningful inputs. Include property intersections where independent conditions can interact.
- Prefer simple fakes or stubs for state and returned values. Verify interactions only when the interaction itself is the contract, such as one ledger apply call for a new operation.
- Avoid loose `NotNull`-only assertions, broad snapshots, tautological round trips, sleeps, random values, shared mutable fixtures, and over-specified call sequences.
- Make async tests return `Task`; await the operation and assert cancellation or exceptions precisely.

## Sitepad unit seams

- Good unit seams: Base/Mine/Server merge rules, retryable-versus-rejected classification, sync-bar priority, validation, revision ordering decisions, and pure operation-result mapping.
- Not unit seams: SQLite uniqueness and atomicity, duplicate HTTP requests, ASP.NET serialization, middleware, browser-to-server sync, or database recovery. Use integration tests for those.

## Verification

- Run the narrow test project or filter first, then the configured unit-test suite.
- Confirm tests pass alone and in the suite, with no order or environment dependence.
- Map each requested behavior to at least one named test. Ask whether a plausible condition reversal, dropped branch, or off-by-one would make the assertion fail.

## Primary sources

- [.NET unit testing best practices](https://learn.microsoft.com/dotnet/core/testing/unit-testing-best-practices)
- [Testing in .NET](https://learn.microsoft.com/dotnet/core/testing/)
