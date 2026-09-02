# Sitepad

Sitepad is an offline-first inspection application for field work where connectivity is unreliable. The project is also a focused learning build for React, Redux Toolkit, and browser storage, with each milestone proving a durability or delivery boundary before adding more product scope.

## Current scope

Milestone 1 is a client-only local-durability slice built around one synthetic inspection. An edit appears immediately, receives a monotonically increasing Redux revision, and is written to IndexedDB. The UI reports **On this device** only after the corresponding transaction commits.

The current build also covers reload recovery, debounced and serialized writes, write retries, database upgrade handling, and a single-writer tab lock. It intentionally has no server, networking, authentication, photo capture, or production data. A .NET 10 delivery API is planned for a later milestone.

## Architecture

```text
React interaction
    -> Redux Toolkit reducer and revision
    -> RTK listener middleware
    -> IndexedDB transaction
    -> committed revision reflected in the UI
```

React components own rendering and user intent. Redux owns the working inspection and durability state. Listener middleware debounces and coalesces persistence work, while the IndexedDB adapter owns schema and transaction details. The Web Locks API prevents two tabs from editing the same local database concurrently.

## Technology

| Area | Technology |
|---|---|
| UI | React 19, React DOM, TypeScript in strict mode |
| State | Redux Toolkit, React Redux, listener middleware |
| Local durability | Raw IndexedDB and the Web Locks API |
| Development and builds | Vite 7, ES modules, ES2022 |
| Unit and component tests | Vitest, React Testing Library, jsdom |
| Browser acceptance tests | Playwright with Chromium |

## Getting started

Prerequisites: Node.js `^20.19.0` or `>=22.12.0`, npm, and a current Chrome or Edge browser.

```powershell
npm --prefix client ci
npm --prefix client run dev
```

The development server runs at `http://127.0.0.1:4173`.

## Verification

```powershell
npm --prefix client test -- --run
npm --prefix client run test:e2e
npm --prefix client run build
```

## Repository layout

- `client/src/features/inspection/` contains the inspection UI, types, and Redux slice.
- `client/src/app/` contains application bootstrap and persistence orchestration.
- `client/src/storage/` contains the IndexedDB adapter, edit lock, and development fault boundaries.
- `client/tests/e2e/` contains browser-level durability and lifecycle proofs.
- `docs/` contains the product design, wireframes, milestone plan, and evidence packets.

For more detail, see the [initial implementation plan](docs/work/20260903-initial-work.md), [UI/UX design](docs/design-v0.1.md), and [Milestone 1 evidence](docs/work/20260903-milestone-1-evidence.md).
