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
import type { InspectionSnapshot, InspectionStorage } from '../features/inspection/inspectionTypes'

export type RootState = { inspection: InspectionState }

export interface TimerScheduler {
  set(callback: () => void, milliseconds: number): ReturnType<typeof globalThis.setTimeout>
  clear(handle: ReturnType<typeof globalThis.setTimeout>): void
}

const browserScheduler: TimerScheduler = {
  set: (callback, milliseconds) => globalThis.setTimeout(callback, milliseconds),
  clear: (handle) => globalThis.clearTimeout(handle),
}

export interface ReduxActionTrace {
  sequence: number
  type: string
  revision?: number
}

interface WriterState {
  timer?: ReturnType<typeof globalThis.setTimeout>
  activeRevision?: number
  pending?: InspectionSnapshot
}

export interface AppStoreOptions {
  storage: InspectionStorage
  scheduler?: TimerScheduler
  debounceMilliseconds?: number
  logger?: AppLogger
}

export function createAppStore({
  storage,
  scheduler = browserScheduler,
  debounceMilliseconds = 300,
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

  const writerFor = (inspectionId: string) => {
    let writer = writers.get(inspectionId)
    if (!writer) {
      writer = {}
      writers.set(inspectionId, writer)
    }
    return writer
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
    writer.activeRevision = undefined
    const pending = writer.pending
    writer.pending = undefined
    if (pending) {
      logger.debug('persistence.coalesced_write_started', {
        inspectionId: pending.inspectionId,
        revision: pending.localRevision,
      })
      await runWrite(pending, api)
    }
  }

  const enqueue = (snapshot: InspectionSnapshot, api: ListenerApi) => {
    const state = api.getState().inspection
    if (snapshot.localRevision <= state.durableRevision) {
      logger.debug('persistence.write_skipped', {
        inspectionId: snapshot.inspectionId,
        revision: snapshot.localRevision,
        durableRevision: state.durableRevision,
        reason: 'already_durable',
      })
      return
    }
    const writer = writerFor(snapshot.inspectionId)
    if (writer.activeRevision === snapshot.localRevision || writer.pending?.localRevision === snapshot.localRevision) {
      logger.debug('persistence.write_skipped', {
        inspectionId: snapshot.inspectionId,
        revision: snapshot.localRevision,
        reason: 'already_queued',
      })
      return
    }
    api.dispatch(inspectionActions.persistenceScheduled({
      inspectionId: snapshot.inspectionId,
      revision: snapshot.localRevision,
    }))
    if (writer.activeRevision !== undefined) {
      if (!writer.pending || snapshot.localRevision > writer.pending.localRevision) {
        writer.pending = snapshot
        logger.debug('persistence.write_coalesced', {
          inspectionId: snapshot.inspectionId,
          revision: writer.activeRevision,
          pendingRevision: snapshot.localRevision,
        })
      }
      return
    }
    void runWrite(snapshot, api)
  }

  const captureCurrent = (state: RootState) => {
    const inspection = state.inspection.inspection
    return inspection ? cloneInspection(inspection) : null
  }

  startListening({
    matcher: isAnyOf(inspectionActions.itemResultChanged, inspectionActions.itemNoteChanged),
    effect: (_, api) => {
      const snapshot = captureCurrent(api.getState())
      if (!snapshot) return
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
        if (latest) enqueue(latest, api)
      }, debounceMilliseconds)
    },
  })

  startListening({
    matcher: isAnyOf(inspectionActions.flushRequested, inspectionActions.storageRetryRequested),
    effect: (action, api) => {
      const snapshot = captureCurrent(api.getState())
      if (!snapshot) return
      logger.info('persistence.flush_requested', {
        inspectionId: snapshot.inspectionId,
        revision: snapshot.localRevision,
        reason: action.type === inspectionActions.storageRetryRequested.type ? 'retry' : 'manual',
      })
      const writer = writerFor(snapshot.inspectionId)
      if (writer.timer) {
        scheduler.clear(writer.timer)
        writer.timer = undefined
      }
      enqueue(snapshot, api)
    },
  })

  startListening({
    actionCreator: inspectionActions.hydrationRetryRequested,
    effect: async (_, api) => {
      logger.info('hydration.retry_started')
      const result = await storage.hydrate()
      if (result.kind === 'hydrated') {
        logger.info('hydration.retry_succeeded', {
          inspectionId: result.inspection.inspectionId,
          revision: result.inspection.localRevision,
        })
        api.dispatch(inspectionActions.inspectionHydrated(result.inspection))
      } else {
        logger.error('hydration.retry_failed', { code: result.code })
        api.dispatch(inspectionActions.hydrationFailed(result.code))
      }
    },
  })

  return {
    store,
    actionTrace,
    dispose: () => {
      logger.debug('persistence.listener_disposed')
      for (const writer of writers.values()) if (writer.timer) scheduler.clear(writer.timer)
      listener.clearListeners()
    },
  }
}

export type AppStore = ReturnType<typeof createAppStore>['store']
export type AppDispatch = AppStore['dispatch']
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector
