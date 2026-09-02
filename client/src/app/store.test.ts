import { act } from '@testing-library/react'
import { createAppStore } from './store'
import { cloneInspection, fixtureInspection } from '../features/inspection/fixture'
import { inspectionActions, selectDurabilityStatus } from '../features/inspection/inspectionSlice'
import type { InspectionSnapshot, StorageResult } from '../features/inspection/inspectionTypes'
import { FakeStorage } from '../test/fakes'

class ControlledStorage extends FakeStorage {
  writes: Array<{
    snapshot: InspectionSnapshot
    finish: (result: StorageResult) => void
  }> = []

  override persist(snapshot: InspectionSnapshot) {
    return new Promise<StorageResult>((resolve) => {
      this.writes.push({ snapshot: cloneInspection(snapshot), finish: resolve })
    })
  }
}

function readyStore(storage: ControlledStorage) {
  const app = createAppStore({ storage })
  app.store.dispatch(inspectionActions.inspectionHydrated(cloneInspection(fixtureInspection)))
  return app
}

describe('persistence listener', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('keeps one active write and one coalesced latest snapshot', async () => {
    const storage = new ControlledStorage()
    const app = readyStore(storage)

    app.store.dispatch(inspectionActions.itemNoteChanged({ itemId: 'smoke-hallway', note: 'a' }))
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(storage.writes).toHaveLength(1)

    app.store.dispatch(inspectionActions.itemNoteChanged({ itemId: 'smoke-hallway', note: 'ab' }))
    app.store.dispatch(inspectionActions.itemNoteChanged({ itemId: 'smoke-hallway', note: 'final note' }))
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(storage.writes).toHaveLength(1)

    await act(async () => {
      storage.writes[0].finish({
        kind: 'committed',
        inspectionId: fixtureInspection.inspectionId,
        revision: 1,
      })
      await Promise.resolve()
    })

    expect(storage.writes).toHaveLength(2)
    expect(storage.writes[1].snapshot.localRevision).toBe(3)
    expect(storage.writes[1].snapshot.items[0].note).toBe('final note')
    storage.writes[1].finish({
      kind: 'committed',
      inspectionId: fixtureInspection.inspectionId,
      revision: 3,
    })
    app.dispose()
  })

  it('flushes immediately and ignores a duplicate flush for the same revision', () => {
    const storage = new ControlledStorage()
    const app = readyStore(storage)
    app.store.dispatch(inspectionActions.itemResultChanged({ itemId: 'smoke-hallway', result: 'fail' }))

    app.store.dispatch(inspectionActions.flushRequested())
    app.store.dispatch(inspectionActions.flushRequested())

    expect(storage.writes).toHaveLength(1)
    expect(storage.writes[0].snapshot.localRevision).toBe(1)
    app.dispose()
  })

  it('retries the newest Redux snapshot after an aborted write', async () => {
    const storage = new ControlledStorage()
    const app = readyStore(storage)
    app.store.dispatch(inspectionActions.itemNoteChanged({ itemId: 'smoke-hallway', note: 'failed draft' }))
    app.store.dispatch(inspectionActions.flushRequested())
    storage.writes[0].finish({
      kind: 'failed',
      inspectionId: fixtureInspection.inspectionId,
      revision: 1,
      code: 'transaction_aborted',
    })
    await act(() => Promise.resolve())
    expect(selectDurabilityStatus(app.store.getState())).toContain('Not saved')

    app.store.dispatch(inspectionActions.itemNoteChanged({ itemId: 'smoke-hallway', note: 'newest draft' }))
    app.store.dispatch(inspectionActions.storageRetryRequested())

    expect(storage.writes).toHaveLength(2)
    expect(storage.writes[1].snapshot.items[0].note).toBe('newest draft')
    expect(storage.writes[1].snapshot.localRevision).toBe(2)
    app.dispose()
  })
})
