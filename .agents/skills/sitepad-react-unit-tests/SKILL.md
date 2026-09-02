---
name: sitepad-react-unit-tests
description: Write or review fast unit and component tests for Sitepad React UI and pure frontend logic. Use for components, hooks, reducers, selectors, and small utilities. Excludes Redux-to-IndexedDB integration, real browser storage, API integration, Playwright, and end-to-end scenarios.
---

# Sitepad React UI Unit Tests

Write small tests that pin down user-visible behavior or non-trivial pure logic without pretending to prove browser durability.

## Before writing tests

- Inspect the implemented test runner, DOM environment, setup files, custom render helpers, naming, and file placement. Preserve those choices.
- If the frontend has no test stack yet, recommend Vitest with React Testing Library and `user-event`; do not add dependencies unless the task authorizes setup.
- Identify the behavior and a plausible bug that each assertion should catch.

## Test selection

- Test pure functions directly: restricted three-way merge rules, non-trivial reducers, selectors, validation, retry calculations, and status priority.
- Test React UI through rendered output and user interaction. Prefer accessible roles, names, labels, and visible text over class names, DOM shape, implementation state, or test IDs.
- Use `userEvent.setup()` inside the test and await interactions. Use `findBy...` for elements that appear asynchronously and `queryBy...` for absence.
- Give every test fresh props, stores, timers, and mocks. Restore global or browser mocks after each test.
- Use a real Redux store for a connected component only when the requested scope permits a component integration test. Do not mock selectors or React-Redux hooks.
- Parameterize equivalent boundary cases, but keep failures readable. Prefer exact observable outcomes over snapshots; use small snapshots only when their review value is clear.
- Mock at owned boundaries. Do not mock React internals, the unit under test, or every collaborator by default.

## Scope boundary

- A unit test may prove that `storageCommitted` renders `On this device`; it cannot prove IndexedDB committed.
- IndexedDB transactions, hydration, schema upgrades, close/reopen recovery, and listener orchestration are integration tests in a real browser.
- API delivery and complete user journeys belong to integration or Playwright suites.

## Verification

- Run the narrow changed test file first, then the configured frontend unit suite.
- Ensure tests pass independently and do not rely on order, wall-clock sleeps, network, or shared mutable state.
- Before finishing, confirm each explicit requirement maps to a named test and that emptying or plausibly mutating the implementation would make it fail.

## Primary sources

- [Testing Library query priority](https://testing-library.com/docs/queries/about/)
- [Testing Library user-event](https://testing-library.com/docs/user-event/intro/)
- [Redux testing guidance](https://redux.js.org/usage/writing-tests)
- [Vitest guide](https://vitest.dev/guide/)
