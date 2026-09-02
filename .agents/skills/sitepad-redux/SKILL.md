---
name: sitepad-redux
description: Write or review Sitepad Redux Toolkit state, selectors, actions, listener middleware, and typed React-Redux usage. Use for client state ownership and asynchronous orchestration. Do not use for IndexedDB schema mechanics, component-only concerns, or server-owned API architecture.
---

# Sitepad Redux Toolkit

Make domain transitions explicit and serializable while keeping reducers pure and persistence observable.

## Before changing code

- Inspect the installed Redux Toolkit and React-Redux versions and follow established feature layout and typed hooks.
- Read the relevant state transitions in `docs/work/20260903-initial-work.md`; do not collapse inspection lifecycle, local durability, and outbox delivery into one status.

## State and actions

- Use `configureStore`, `createSlice`, and typed `useAppDispatch` and `useAppSelector` hooks.
- Organize logic by feature. Keep normalized collections when records are updated independently; use `createEntityAdapter` when it reduces hand-written update logic.
- Model actions as domain events or user intents, not component setters. Keep payloads minimal, serializable, and sufficient to reproduce the transition.
- Keep reducers deterministic and free of I/O, clocks, random IDs, browser APIs, and dispatches. Immer-style mutation is allowed only inside Redux Toolkit reducer callbacks.
- Put state calculations in reducers and derived projections in selectors. Do not store values that are cheaply and reliably derived.
- Encapsulate state shape behind selectors. Memoize only selectors whose work or reference stability matters.

## Side effects

- Use RTK listener middleware for IndexedDB persistence, debouncing, outbox orchestration, and long-running reactions to actions.
- Use thunks for explicit bounded commands such as a manual retry. Use RTK Query later for server-owned cached reads if that need appears.
- Never let a component write to IndexedDB or coordinate the outbox.
- Serialize draft writes per inspection and carry a monotonic local revision so an older write cannot overwrite a newer one.
- Dispatch separate started, committed, and failed outcomes. `On this device` follows the committed IndexedDB transaction, not the optimistic reducer update.
- Route every sync trigger through one `syncRequested` entry point. Preserve ordering per inspection rather than blocking the entire queue.

## Testing and validation

- Unit-test non-trivial reducers and selectors as pure functions.
- For connected UI, prefer a fresh real store per test and do not mock React-Redux hooks or selectors.
- Persistence listeners and outbox flows are integration tests and require the real adapter boundary; do not label a reducer test as durability proof.
- Confirm Redux DevTools show serializable actions matching the documented lifecycle.

## Primary sources

- [Redux Style Guide](https://redux.js.org/style-guide/)
- [Redux side-effects approaches](https://redux.js.org/usage/side-effects-approaches)
- [Redux testing guidance](https://redux.js.org/usage/writing-tests)
