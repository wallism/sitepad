---
name: sitepad-indexeddb
description: Design, implement, or review Sitepad IndexedDB adapters, schemas, indexes, migrations, transactions, quota handling, and local durability. Use for offline storage and outbox persistence. Do not use for Redux state design, server databases, or generic browser caching.
---

# Sitepad IndexedDB

Protect field work with explicit transaction boundaries and honest durability signals. Use raw IndexedDB behind a small typed adapter for the first milestone.

## Before changing code

- Read the IndexedDB schema, transaction boundaries, and failure matrix in `docs/work/20260903-initial-work.md`.
- Inspect the current database version and every caller before changing stores, indexes, key paths, or record meaning.
- Add an index only for a concrete query. Document the query and ordering it supports.

## Transactions and data

- Keep transactions short. Gather or compute data before opening one; do not await unrelated work while a transaction is active.
- Treat the transaction's `complete` event as the application commit boundary and `abort` or `error` as failure. Individual request success is not a committed transaction.
- Put records that must change together in one transaction. Sitepad completion must update the inspection and create exactly one outbox operation atomically.
- Store self-contained, stable operation IDs for idempotent delivery. Persist base, mine, and base version for conflict handling.
- Keep photo `Blob`s in the `photos` store and reference their IDs from inspection records so ordinary reads do not load image bytes.
- Use explicit, versioned upgrade steps in `upgradeneeded`. Make each migration safe for every supported prior version and test it with representative old data.
- Close a connection on `versionchange`; surface blocked upgrades rather than silently hanging.
- Open a fresh transaction for each retry. Never reuse a finished or aborted transaction.

## Durability and failure behavior

- Request persistent storage and inspect `navigator.storage.persist()` without assuming it will be granted.
- Use `navigator.storage.estimate()` as an estimate, not an accounting guarantee. Handle missing or imprecise results.
- Catch and classify `QuotaExceededError`, transaction aborts, blocked upgrades, and unavailable storage. Preserve the last committed revision and never show failed work as safe.
- Choose transaction durability intentionally when supported. `strict` is still a browser hint and costs latency and battery; do not claim protection beyond the observable commit.
- Do not depend on unload, `beforeunload`, or background sync to finish writes. `visibilitychange` may request an immediate flush but is not a rescue guarantee.
- Do not delete rejected or exhausted outbox work. Keep it recoverable until an explicit product workflow resolves or exports it.

## Validation

- Use a real browser for transaction lifecycle, upgrades, multi-connection blocking, quota injection, close/reopen recovery, and `Blob` behavior.
- Pure adapter helpers may have unit tests, but mocked IndexedDB is not proof of durability.
- Verify both the successful commit path and an injected abort or quota failure; the visible safety copy must differ.

## Primary sources

- [Indexed Database API 3.0](https://www.w3.org/TR/IndexedDB/)
- [Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
