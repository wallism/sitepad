import {
  configureStore,
  createListenerMiddleware,
  isAction,
  isAnyOf,
  type Middleware,
  type TypedStartListening,
} from '@reduxjs/toolkit'
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux'
import { noopLogger, type AppLogger } from '../diagnostics/logger'
import { cloneInspection } from '../features/inspection/fixture'
import {
  inspectionActions,
  inspectionReducer,
  type InspectionState,
} from '../features/inspection/inspectionSlice'
import type {
  InspectionSnapshot,
  InspectionStorage,
  StorageResult,
} from '../features/inspection/inspectionTypes'
import {
  unavailableTransport,
  type SyncTransport,
} from '../sync/syncTransport'
import { retryDelayMilliseconds } from '../sync/retryPolicy'

export type RootState = { inspection: InspectionState }

export interface TimerScheduler {
  set(callback: () => void, milliseconds: number): ReturnType<typeof globalThis.setTimeout>
  clear(handle: ReturnType<typeof globalThis.setTimeout>): void
}

const browserScheduler: TimerScheduler = {
  set: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clear: (handle) => globalThis.clearTimeout(handle),
}

export interface Clock {
  now(): number
}

const browserClock: Clock = { now: () => Date.now() }

export interface ReduxActionTrace {
  sequence: number
  type: string
  revision?: number
}

interface WriterWaiter {
  revision: number
  resolve: (result: StorageResult) => void
}

interface WriterState {
  timer?: ReturnType<typeof globalThis.setTimeout>
  activeRevision?: number
  pending?: InspectionSnapshot
  waiters: WriterWaiter[]
}

export interface AppStoreOptions {
  storage: InspectionStorage
  transport?: SyncTransport
  scheduler?: TimerScheduler
  clock?: Clock
  idFactory?: () => string
  debounceMilliseconds?: number
  leaseMilliseconds?: number
  logger?: AppLogger
}

export function createAppStore({
  storage,
  transport = unavailableTransport,
  scheduler = browserScheduler,
  clock = browserClock,
  idFactory = () => globalThis.crypto.randomUUID(),
  debounceMilliseconds = 300,
  leaseMilliseconds = 30_000,
  logger = noopLogger,
}: AppStoreOptions) {
  const listener = createListenerMiddleware<RootState>()
  const actionTrace: ReduxActionTrace[] = []
  const traceMiddleware: Middleware<object, RootState> = ({ getState }) => (next) => (action) => {
    if (isAction(action) && action.type.startsWith('inspection/')) {
      const payload = 'payload' in action
        ? action.payload as { revision?: number } | undefined
        : undefined
      actionTrace.push({ sequence: actionTrace.length + 1, type: action.type, revision: payload?.revision })
    }
    const result = next(action)
    if (isAction(action) && action.type.startsWith('inspection/')) {
      const payload = 'payload' in action
        ? action.payload as { revision?: number } | undefined
        : undefined
      const inspectionState = getState().inspection
      logger.debug('redux.action', {
        actionType: action.type,
        revision: payload?.revision,
        currentRevision: inspectionState.currentRevision,
        durableRevision: inspectionState.durableRevision,
        operationId: inspectionState.outbox?.operationId,
        deliveryStatus: inspectionState.outbox?.status,
      })
    }
    return result
  }

  const store = configureStore({
    reducer: { inspection: inspectionReducer },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware().prepend(listener.middleware).concat(traceMiddleware),
    devTools: import.meta.env.DEV,
  })

  type Store = typeof store
  type StartListening = TypedStartListening<RootState, Store['dispatch']>
  type ListenerApi = Parameters<Parameters<StartListening>[0]['effect']>[1]
  const startListening = listener.startListening as StartListening
  const writers = new Map<string, WriterState>()
  const completions = new Set<string>()
  let syncRunning = false
  let syncTimer: ReturnType<typeof globalThis.setTimeout> | undefined

  const writerFor = (inspectionId: string) => {
    let writer = writers.get(inspectionId)
    if (!writer) {
      writer = { waiters: [] }
      writers.set(inspectionId, writer)
    }
    return writer
  }

  const resolveWaiters = (writer: WriterState, result: StorageResult) => {
    const matched = writer.waiters.filter((waiter) =>
      result.kind === 'committed' ? waiter.revision <= result.revision : waiter.revision === result.revision)
    writer.waiters = writer.waiters.filter((waiter) => !matched.includes(waiter))
    for (const waiter of matched) waiter.resolve(result)
  }

  const runWrite = async (snapshot: InspectionSnapshot, api: ListenerApi) => {
    const writer = writerFor(snapshot.inspectionId)
    writer.activeRevision = snapshot.localRevision
    logger.info('persistence.write_started', {
      inspectionId: snapshot.inspectionId,
      revision: snapshot.localRevision,
    })
    api.dispatch(inspectionActions.persistenceStarted({
      inspectionId: snapshot.inspectionId,
      revision: snapshot.localRevision,
    }))
    const result = await storage.persist(snapshot)
    if (result.kind === 'committed') {
      logger.info('persistence.write_committed', {
        inspectionId: result.inspectionId,
        revision: result.revision,
      })
      api.dispatch(inspectionActions.persistenceCommitted(result))
    } else {
      logger.error('persistence.write_failed', {
        inspectionId: result.inspectionId,
        revision: result.revision,
        code: result.code,
      })
      api.dispatch(inspectionActions.persistenceFailed(result))
    }
    resolveWaiters(writer, result)
    writer.activeRevision = undefined
    const pending = writer.pending
    writer.pending = undefined
    if (pending) await runWrite(pending, api)
  }

  const enqueue = (snapshot: InspectionSnapshot, api: ListenerApi): Promise<StorageResult> => {
    const state = api.getState().inspection
    if (snapshot.localRevision <= state.durableRevision) {
      return Promise.resolve({
        kind: 'committed',
        inspectionId: snapshot.inspectionId,
        revision: snapshot.localRevision,
      })
    }
    const writer = writerFor(snapshot.inspectionId)
    const promise = new Promise<StorageResult>((resolve) => {
      writer.waiters.push({ revision: snapshot.localRevision, resolve })
    })
    const alreadyQueued =
      writer.activeRevision === snapshot.localRevision
      || writer.pending?.localRevision === snapshot.localRevision
    if (alreadyQueued) return promise

    api.dispatch(inspectionActions.persistenceScheduled({
      inspectionId: snapshot.inspectionId,
      revision: snapshot.localRevision,
    }))
    if (writer.activeRevision !== undefined) {
      if (!writer.pending || snapshot.localRevision > writer.pending.localRevision) writer.pending = snapshot
      return promise
    }
    void runWrite(snapshot, api)
    return promise
  }

  const captureCurrent = (state: RootState) => {
    const inspection = state.inspection.inspection
    return inspection ? cloneInspection(inspection) : null
  }

  const cancelDebounce = (inspectionId: string) => {
    const writer = writerFor(inspectionId)
    if (writer.timer) {
      scheduler.clear(writer.timer)
      writer.timer = undefined
    }
  }

  const scheduleSync = (nextAttemptAt: number | null, api: ListenerApi) => {
    if (syncTimer) scheduler.clear(syncTimer)
    syncTimer = undefined
    if (nextAttemptAt === null) return
    const delay = Math.max(0, nextAttemptAt - clock.now())
    syncTimer = scheduler.set(() => {
      syncTimer = undefined
      api.dispatch(inspectionActions.syncRequested())
    }, delay)
  }

  const runSync = async (api: ListenerApi) => {
    if (syncRunning) return
    syncRunning = true
    try {
      while (true) {
        const now = clock.now()
        const claim = await storage.claimNext(now, idFactory(), leaseMilliseconds)
        if (claim.kind === 'failed') {
          logger.error('sync.claim_failed', { code: claim.code })
          return
        }
        if (claim.kind === 'none') {
          scheduleSync(claim.nextAttemptAt, api)
          return
        }

        const operation = claim.operation
        api.dispatch(inspectionActions.operationClaimed(operation))
        logger.info('sync.send_started', {
          inspectionId: operation.inspectionId,
          operationId: operation.operationId,
          claimId: operation.claimId,
          attemptCount: operation.attemptCount,
        })
        const outcome = await transport.send(operation)
        if (outcome.kind === 'terminal') {
          const update = await storage.recordTerminal(
            operation.operationId,
            operation.claimId!,
            outcome.response,
          )
          if (update.kind === 'committed') {
            api.dispatch(inspectionActions.operationUpdated(update))
            logger.info('sync.terminal_committed', {
              inspectionId: operation.inspectionId,
              operationId: operation.operationId,
              claimId: operation.claimId,
              outcome: outcome.response.kind,
            })
            continue
          }
          if (update.kind === 'stale') {
            api.dispatch(inspectionActions.staleResponseIgnored({ operationId: operation.operationId }))
            logger.warn('sync.stale_response_ignored', {
              operationId: operation.operationId,
              claimId: operation.claimId,
            })
            continue
          }
          logger.error('sync.terminal_persist_failed', {
            operationId: operation.operationId,
            code: update.code,
          })
          scheduleSync(operation.leaseExpiresAt, api)
          return
        }

        const delay = retryDelayMilliseconds(operation.attemptCount)
        const retryAt = clock.now() + delay
        const update = await storage.recordRetryable(
          operation.operationId,
          operation.claimId!,
          outcome.code,
          retryAt,
          clock.now(),
        )
        if (update.kind === 'committed') {
          api.dispatch(inspectionActions.operationUpdated(update))
          logger.warn('sync.retry_scheduled', {
            inspectionId: operation.inspectionId,
            operationId: operation.operationId,
            attemptCount: operation.attemptCount,
            nextAttemptAt: retryAt,
            code: outcome.code,
          })
          scheduleSync(retryAt, api)
        } else if (update.kind === 'stale') {
          api.dispatch(inspectionActions.staleResponseIgnored({ operationId: operation.operationId }))
        }
        return
      }
    } finally {
      syncRunning = false
    }
  }

  startListening({
    matcher: isAnyOf(inspectionActions.itemResultChanged, inspectionActions.itemNoteChanged),
    effect: (_, api) => {
      const snapshot = captureCurrent(api.getState())
      if (!snapshot || snapshot.lifecycle !== 'in_progress') return
      const writer = writerFor(snapshot.inspectionId)
      if (writer.timer) scheduler.clear(writer.timer)
      logger.debug('persistence.debounce_scheduled', {
        inspectionId: snapshot.inspectionId,
        revision: snapshot.localRevision,
        debounceMilliseconds,
      })
      writer.timer = scheduler.set(() => {
        writer.timer = undefined
        const latest = captureCurrent(api.getState())
        if (latest?.lifecycle === 'in_progress') void enqueue(latest, api)
      }, debounceMilliseconds)
    },
  })

  startListening({
    matcher: isAnyOf(inspectionActions.flushRequested, inspectionActions.storageRetryRequested),
    effect: (_, api) => {
      const snapshot = captureCurrent(api.getState())
      if (!snapshot || snapshot.lifecycle !== 'in_progress') return
      logger.info('persistence.flush_requested', {
        inspectionId: snapshot.inspectionId,
        revision: snapshot.localRevision,
      })
      cancelDebounce(snapshot.inspectionId)
      void enqueue(snapshot, api)
    },
  })

  startListening({
    actionCreator: inspectionActions.completionRequested,
    effect: async (_, api) => {
      const snapshot = captureCurrent(api.getState())
      const targetRevision = api.getState().inspection.completionTargetRevision
      if (!snapshot || snapshot.lifecycle !== 'completing' || targetRevision === null) return
      if (completions.has(snapshot.inspectionId)) return
      completions.add(snapshot.inspectionId)
      try {
        cancelDebounce(snapshot.inspectionId)
        const draft = { ...snapshot, lifecycle: 'in_progress' as const }
        const flush = await enqueue(draft, api)
        if (flush.kind === 'failed') {
          api.dispatch(inspectionActions.completionFailed(flush))
          return
        }
        const completion = await storage.complete(draft, idFactory(), clock.now())
        if (completion.kind === 'failed') {
          api.dispatch(inspectionActions.completionFailed(completion))
          return
        }
        api.dispatch(inspectionActions.completionCommitted(completion))
        api.dispatch(inspectionActions.syncRequested())
      } finally {
        completions.delete(snapshot.inspectionId)
      }
    },
  })

  startListening({
    actionCreator: inspectionActions.syncRequested,
    effect: (_, api) => void runSync(api),
  })

  startListening({
    actionCreator: inspectionActions.manualRetryRequested,
    effect: async (_, api) => {
      const operation = api.getState().inspection.outbox
      if (!operation || (operation.status !== 'retryable' && operation.status !== 'pending')) return
      const update = await storage.retryNow(operation.operationId, clock.now())
      if (update.kind === 'committed') {
        api.dispatch(inspectionActions.operationUpdated(update))
        api.dispatch(inspectionActions.syncRequested())
      }
    },
  })

  startListening({
    actionCreator: inspectionActions.hydrationRetryRequested,
    effect: async (_, api) => {
      const result = await storage.hydrate()
      if (result.kind === 'hydrated') {
        api.dispatch(inspectionActions.inspectionHydrated(result))
        if (result.outbox && ['pending', 'retryable', 'sending'].includes(result.outbox.status)) {
          api.dispatch(inspectionActions.syncRequested())
        }
      } else {
        api.dispatch(inspectionActions.hydrationFailed(result.code))
      }
    },
  })

  return {
    store,
    actionTrace,
    dispose: () => {
      for (const writer of writers.values()) if (writer.timer) scheduler.clear(writer.timer)
      if (syncTimer) scheduler.clear(syncTimer)
      listener.clearListeners()
    },
  }
}

export type AppStore = ReturnType<typeof createAppStore>['store']
export type AppDispatch = AppStore['dispatch']
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
