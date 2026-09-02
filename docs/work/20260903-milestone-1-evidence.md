# Sitepad Milestone 1 Evidence

Date: 2026-09-03  
Scope: local durability only  
Status: PASS

Milestone 1 implements one synthetic inspection with three checklist items inside `client/`. No `server/`, networking, completion flow, outbox delivery, conflict UI, photo handling, service worker, or later-milestone product screen was added.

## Successful edit proof

The persistent-profile Chromium scenario selected **Fail** for `3.2 Smoke alarm — hallway`, held the adapter boundary for 450 ms, flushed a synthetic failure note immediately, closed the page, and reopened the same URL in the same Playwright persistent context.

Observed Redux action sequence:

```text
inspection/hydrationStarted
inspection/inspectionHydrated                         r0
inspection/itemResultChanged
inspection/persistenceScheduled                      r1
inspection/persistenceStarted                        r1
inspection/persistenceCommitted                      r1
inspection/itemNoteChanged
inspection/flushRequested
inspection/persistenceScheduled                      r2
inspection/persistenceStarted                        r2
inspection/persistenceCommitted                      r2
```

Matching IndexedDB results:

```text
transactionCommitted  inspection-trafalgar-2-88  r1
transactionCommitted  inspection-trafalgar-2-88  r2
```

Visible and reload assertions:

- The result rendered optimistically as **Fail** while the status remained **Saving**.
- **On this device** appeared only after the adapter observed the transaction `complete` event and the listener dispatched `persistenceCommitted`.
- Closing and reopening the page restored result `fail` and note `Synthetic check: alarm is not interconnected.` from IndexedDB.

## Injected failed edit proof

The failed-write Chromium scenario began from committed revision 0, injected an abort into the next real IndexedDB `readwrite` transaction, selected **Fail**, and used **Flush now**.

Observed Redux action sequence through failure:

```text
inspection/hydrationStarted
inspection/inspectionHydrated                         r0
inspection/itemResultChanged
inspection/flushRequested
inspection/persistenceScheduled                      r1
inspection/persistenceStarted                        r1
inspection/persistenceFailed                         r1
```

Matching IndexedDB result:

```text
transactionAborted  inspection-trafalgar-2-88  r1  transaction_aborted
```

Visible and committed-record assertions:

- The UI showed **Not saved — your last change needs attention** and did not contain **On this device**.
- A direct IndexedDB read still returned revision 0 with result `unanswered`; the aborted optimistic edit did not replace the last committed record.
- **Retry** queued the current Redux revision, produced one committed write, and only then restored **On this device**.

## Milestone 1 gate map

| Gate | Proof |
|---|---|
| Reload | Persistent Chromium profile restores exact result and note |
| Delayed write | 450 ms injected adapter delay keeps the visible state at **Saving** |
| Immediate flush | **Flush now** cancels the note debounce and queues the current revision |
| Double flush | Listener test proves one write for two flush intents at the same revision |
| Hydration error | Existing committed note survives an injected open failure and non-destructive Retry |
| Write retry | Aborted write keeps revision 0; Retry commits the newest Redux snapshot |
| Stale result | Reducer test proves a revision 1 success/failure cannot replace revision 2 status or values |
| Render isolation | React Profiler test shows only the changed checklist row commits |
| Secondary-tab takeover | Second tab is read-only; it edits only after the writer closes and the second tab reloads and rehydrates |
| Unsupported lock | Missing Web Locks capability shows the unsupported-browser state and no edit controls |
| Blocked upgrade | The app connection closes on `versionchange`; a deliberately stubborn second connection produces read-only close-other-tabs guidance |
| Close before commit | Closing during a 5,000 ms pre-transaction delay reopens at the prior committed result without a false durability claim |

## Verification commands

Run from the repository root:

```powershell
npm --prefix client test -- --run
npm --prefix client run test:e2e
npm --prefix client run build
```

Results from 2026-09-03:

```text
Vitest 3.2.7
Test Files  4 passed (4)
Tests       11 passed (11)

Playwright / Chromium 151.0.7922.34
Tests       7 passed (8.5s)

Vite 7.3.6 production build
50 modules transformed
dist/index.html                  0.53 kB (gzip 0.32 kB)
dist/assets/index-27khB7KK.css   4.72 kB (gzip 1.70 kB)
dist/assets/index-Bc3kNrOe.js  236.12 kB (gzip 75.67 kB)
```

The production bundle was also searched for `Fail next write`, `__SITEPAD_TEST__`, `injectNextWriteFailure`, `failNextWrite`, and `Learning trace`; no development fault control or learning-trace marker was present.

Milestone 2 remains gated and was not started.
