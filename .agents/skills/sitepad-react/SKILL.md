---
name: sitepad-react
description: Write or review Sitepad React components and hooks using the repository's offline-first boundaries. Use for React rendering, component state, effects, events, composition, accessibility, and render performance. Do not use for Redux orchestration, IndexedDB mechanics, or end-to-end tests.
---

# Sitepad React

Build predictable, accessible React UI that captures intent and renders state. Keep persistence and delivery mechanics outside components.

## Before changing code

- Inspect the installed React version and existing component conventions; do not assume an API is available.
- Read the relevant product state and copy in `docs/design-v0.1.md`. For durability or sync behavior, also read the matching section of `docs/work/20260903-initial-work.md`.

## Practices

- Keep render pure. Do not mutate props, state, hook inputs, Redux values, or module globals during render.
- Derive display values while rendering. Do not mirror props or store data into local state with an effect.
- Use effects only to synchronize with systems outside React. Put user-triggered work in event handlers and always clean up subscriptions, timers, and object URLs.
- Keep transient view state local. Dispatch domain intent when an action affects shared application state, local durability, or delivery.
- Prefer composition and small explicit props over boolean-prop matrices. Preserve semantic HTML and accessible names.
- Treat loading, empty, error, and disabled states as product behavior. Sitepad must not enable editing before local hydration completes.
- Measure before adding memoization. For checklist rows, verify that one item change does not needlessly re-render every row, but do not scatter `memo`, `useMemo`, or `useCallback` without evidence.
- Use stable domain identifiers as keys. Never use an array index for reorderable inspection data.
- Keep browser APIs behind adapters or focused hooks. Revoke every `URL.createObjectURL` value when it is replaced or no longer rendered.
- Preserve Sitepad's one-handed, outdoor-use constraints: semantic controls, visible focus, at least 48 px targets, and no hover-only behavior.

## Boundaries

- Components dispatch intents and render selectors; they do not call IndexedDB directly.
- A rendered optimistic value is not proof of persistence. UI safety copy comes from the durability state owned by Redux.
- Do not introduce Server Components, framework-specific Actions, or a data-fetching library unless the chosen client framework and task require them.

## Validation

- Run the smallest relevant typecheck, lint, and test commands defined by the implemented frontend.
- For render-performance claims, use React Profiler or an equivalent observable render count.
- Use `sitepad-react-unit-tests` for component-level tests; use broader integration or browser tests for Redux-to-IndexedDB behavior.

## Primary sources

- [Rules of React](https://react.dev/reference/rules)
- [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- [Responding to Events](https://react.dev/learn/responding-to-events)
