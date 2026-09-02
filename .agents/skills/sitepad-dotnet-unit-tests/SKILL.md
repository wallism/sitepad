---
name: sitepad-dotnet-unit-tests
description: Write or review isolated C# unit tests for Sitepad domain logic and small services using NUnit and NSubstitute. Use for pure behavior, validation, state transitions, retry classification, merge rules, and deterministic collaborators. Excludes hosted API, SQLite, filesystem, network, and end-to-end tests.
---

# Sitepad C# Unit Tests

Create fast, isolated, repeatable tests that document behavior and fail under plausible regressions.

## Before writing tests

- Use NUnit for every C# unit test and NSubstitute whenever mocking or substituting a collaborator. Do not introduce xUnit, MSTest, Moq, FakeItEasy, or another test or mocking framework.
- Inspect the installed NUnit and NSubstitute versions, naming, project layout, nullable settings, package-version management, and shared fixtures. Follow compatible repository conventions.
- Do not change production behavior merely to make a mistaken test pass. Resolve mismatches against the requirement and implementation evidence.
- If no C# test project exists and the task authorizes test setup, create the smallest NUnit project and add NSubstitute without hard-coding versions that conflict with central package management.
- If the target test project uses another framework, do not silently mix frameworks or expand the task into a migration. Stop and ask whether to migrate it or create a separate NUnit test project.

## Practices

- Unit-test code under the team's control without database, filesystem, HTTP, hosted server, or real clock dependencies.
- Focus on observable behavior: exact result values, state transitions, classifications, and meaningful collaborator calls.
- Use NUnit attributes and constraint assertions: `[Test]`, `[TestCase]` or `[TestCaseSource]`, and `Assert.That(...)`. Use Arrange, Act, Assert when it improves readability. Name tests as behavior, commonly `Member_Scenario_ExpectedOutcome`, while preserving established style.
- Cover the happy path, boundaries, and domain-significant failure paths. Do not chase a coverage percentage or test language/runtime behavior.
- Use parameterized tests for the same behavior over meaningful inputs. Include property intersections where independent conditions can interact.
- Prefer real values for simple collaborators. When a test double is needed, create it with `Substitute.For<T>()`, configure only behavior the test requires, and use `Received(1)` or `DidNotReceive()` only when the interaction is part of the contract.
- Do not substitute concrete non-virtual behavior. Introduce or use an existing explicit interface seam, or test the pure behavior directly. A purposeful stateful fake is acceptable when it models behavior more clearly; it is not a reason to add another mocking framework.
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
- [NUnit documentation](https://docs.nunit.org/)
- [NSubstitute documentation](https://nsubstitute.github.io/)
