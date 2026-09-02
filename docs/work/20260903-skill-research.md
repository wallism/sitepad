# Sitepad repository skill research

**Date:** 3 September 2026

**Decision:** Add six small repo-local skills under `.agents/skills`; adapt useful ideas from public skills, but do not vendor a public collection wholesale.

## What the repository needs

Sitepad is pre-build and currently pins React, Redux Toolkit, IndexedDB, and .NET 10. Its first milestone is specifically a React → Redux → IndexedDB durability proof. That makes generic framework advice insufficient: the skills must preserve the repository's separate inspection, local-durability, and delivery states and must not call mocked IndexedDB a durability test.

The chosen split keeps automatic loading narrow:

| Skill | Owns | Explicitly leaves out |
|---|---|---|
| `sitepad-react` | Components, hooks, effects, accessibility, render behavior | Redux orchestration and persistence |
| `sitepad-redux` | State, selectors, reducers, listener middleware | Database mechanics and server architecture |
| `sitepad-indexeddb` | Schema, transactions, upgrades, quota, durability | UI and server databases |
| `sitepad-dotnet` | C# and the small .NET 10 API | Frontend, deployment, test-only work |
| `sitepad-react-unit-tests` | Pure frontend and component tests | Browser storage, API, E2E |
| `sitepad-dotnet-unit-tests` | Isolated C# behavior | Hosted API, SQLite, network, E2E |

## Public skills assessed

### Useful sources, too broad to install unchanged

- [Vercel React Best Practices](https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices) is MIT-licensed and well structured around progressive rule loading, but its 70 rules emphasize React/Next.js performance, server rendering, caching, and bundling. Most of that is not part of Sitepad's first offline client slice.
- [PyModel React frontend skills](https://github.com/PyModel/react-frontend-skills) is MIT-licensed and separates React, Vitest, TDD, and other topics. Its React entrypoint still spans 40 rules, including Server Components and Actions that may not apply to Sitepad's eventual client scaffold. Its Vitest skill spans 44 rules and includes CI and pool tuning beyond a unit-test skill.
- [dotnet-artisan](https://github.com/novotnyllc/dotnet-artisan) is MIT-licensed and has strong progressive disclosure. The `dotnet-csharp` skill routes across 25 topics and asks agents to load five baseline references for every C# path; `dotnet-testing` covers 13 areas from unit tests through Aspire, Playwright, benchmarking, coverage, mutation testing, and WASM. Both are more context than Sitepad currently needs.
- [dotnet/skills](https://github.com/dotnet/skills) is MIT-licensed and maintained by the .NET organization. Its testing collection is a valuable source, but the main code-testing agent coordinates a multi-stage pipeline and its generation prompt uses a generic 80% coverage target. Sitepad benefits more from small behavior-led unit-test guidance and an explicit unit/integration boundary.
- [OpenAI's curated ASP.NET Core skill](https://github.com/openai/skills/tree/main/skills/.curated/aspnet-core) is current and uses good progressive disclosure. It covers every major ASP.NET Core app model and many operational concerns, whereas Sitepad currently needs one minimal endpoint and a SQLite idempotency ledger. It is a good future install when the backend grows.

### Not suitable as a base

- [Mindrally Redux Toolkit](https://github.com/Mindrally/skills/tree/main/redux-toolkit) is Apache-2.0 licensed and compact, but it mixes Redux guidance with generic naming, React memoization, Zod, Jest, and categorical style advice. Some rules are not aligned with current official Redux guidance or Sitepad's listener-middleware design.
- Public IndexedDB searches mainly found application-specific or registry-mirrored skills. One example, `indexeddb-mechanic`, is tied to another product, written around Dexie and financial records, and has no repository license declared. Sitepad intentionally starts with raw IndexedDB and has different durability semantics, so no IndexedDB skill was reused.

## Source hierarchy used

The local skills synthesize repository decisions with primary documentation rather than copying public skill prose:

- React: [Rules of React](https://react.dev/reference/rules) and [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- Redux Toolkit: [Redux Style Guide](https://redux.js.org/style-guide/), [side-effects approaches](https://redux.js.org/usage/side-effects-approaches), and [testing guidance](https://redux.js.org/usage/writing-tests)
- IndexedDB: [Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/) and [MDN Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- React UI tests: [Testing Library query priority](https://testing-library.com/docs/queries/about/) and [user-event](https://testing-library.com/docs/user-event/intro/)
- .NET: [Microsoft's unit-testing best practices](https://learn.microsoft.com/dotnet/core/testing/unit-testing-best-practices), [testing overview](https://learn.microsoft.com/dotnet/core/testing/), and current C#/ASP.NET Core documentation

## Deliberate follow-up boundary

Do not add an integration-testing skill until the implementation establishes its actual test runners and harnesses. When it does, add separate focused skills for:

1. React/Redux/IndexedDB browser integration using real IndexedDB.
2. ASP.NET Core/SQLite contract and idempotency integration.
3. A very small Playwright acceptance suite for visible end-to-end proofs.

Keeping those separate prevents a unit-testing request from loading browser, database, and deployment guidance.
