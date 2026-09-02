import { waitFor } from '@testing-library/react'
import { createAppStore } from './store'
import { cloneInspection, fixtureInspection } from '../features/inspection/fixture'
import { inspectionActions, selectDurabilityStatus } from '../features/inspection/inspectionSlice'
import { FakeStorage } from '../test/fakes'
import type { CompletionResult, InspectionSnapshot } from '../features/inspection/inspectionTypes'
import type { SyncTransport } from '../sync/syncTransport'

function answerAll(app: ReturnType<typeof createAppStore>) {
  for (const item of fixtureInspection.items) {
    app.store.dispatch(inspectionActions.itemResultChanged({ itemId: item.itemId, result: 'pass' }))
  }
}

describe('milestone 2 delivery listener', () => {
  it('freezes on the first Complete and creates and sends exactly one operation', async () => {
    const storage = new FakeStorage()
    let sends = 0
    const transport: SyncTransport = {
      send: async (operation) => {
        sends += 1
        return {
          kind: 'terminal',
          response: {
            kind: 'acknowledged',
            operationId: operation.operationId,
            serverVersion: 2,
            server: operation.request.mine,
          },
        }
      },
    }
    let id = 0
    const app = createAppStore({
      storage,
      transport,
      clock: { now: () => 1_000 },
      idFactory: () => `id-${++id}`,
    })
    app.store.dispatch(inspectionActions.inspectionHydrated(cloneInspection(fixtureInspection)))
    answerAll(app)

    app.store.dispatch(inspectionActions.completionRequested())
    app.store.dispatch(inspectionActions.completionRequested())

    expect(app.store.getState().inspection.inspection?.lifecycle).toBe('completing')
    app.store.dispatch(inspectionActions.itemNoteChanged({ itemId: 'smoke-hallway', note: 'too late' }))
    expect(app.store.getState().inspection.inspection?.items[0].note).toBe('')

    await waitFor(() => expect(selectDurabilityStatus(app.store.getState())).toBe('Sent'))
    expect(storage.operation?.operationId).toBe('id-1')
    expect(sends).toBe(1)
    app.dispose()
  })

  it('returns to in progress without an operation when atomic completion fails', async () => {
    class FailingCompletionStorage extends FakeStorage {
      override async complete(snapshot: InspectionSnapshot): Promise<CompletionResult> {
        return {
          kind: 'failed',
          inspectionId: snapshot.inspectionId,
          revision: snapshot.localRevision,
          code: 'transaction_aborted',
        }
      }
    }
    const storage = new FailingCompletionStorage()
    const app = createAppStore({ storage, idFactory: () => 'op-fail' })
    app.store.dispatch(inspectionActions.inspectionHydrated(cloneInspection(fixtureInspection)))
    answerAll(app)
    app.store.dispatch(inspectionActions.completionRequested())

    await waitFor(() =>
      expect(app.store.getState().inspection.inspection?.lifecycle).toBe('in_progress'))
    expect(app.store.getState().inspection.outbox).toBeNull()
    expect(selectDurabilityStatus(app.store.getState())).toContain('Not completed')
    app.dispose()
  })

  it('classifies a transport failure as retryable and preserves attempt history', async () => {
    const storage = new FakeStorage()
    const app = createAppStore({
      storage,
      transport: { send: async () => ({ kind: 'retryable', code: 'network_error' }) },
      clock: { now: () => 5_000 },
      idFactory: (() => {
        let value = 0
        return () => `id-${++value}`
      })(),
    })
    app.store.dispatch(inspectionActions.inspectionHydrated(cloneInspection(fixtureInspection)))
    answerAll(app)
    app.store.dispatch(inspectionActions.completionRequested())

    await waitFor(() => expect(app.store.getState().inspection.outbox?.status).toBe('retryable'))
    expect(app.store.getState().inspection.outbox).toMatchObject({
      attemptCount: 1,
      nextAttemptAt: 6_000,
      lastError: { code: 'network_error', at: 5_000 },
    })
    expect(selectDurabilityStatus(app.store.getState())).toContain('will retry')
    app.dispose()
  })
})
