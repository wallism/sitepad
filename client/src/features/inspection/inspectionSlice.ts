import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type {
  InspectionResult,
  InspectionSnapshot,
  OutboxOperation,
  StorageErrorCode,
} from './inspectionTypes'

export type HydrationState =
  | 'hydrating'
  | 'ready'
  | 'hydration_error'
  | 'read_only'
  | 'unsupported_browser'
  | 'upgrade_blocked'

export interface LearningEvent {
  sequence: number
  source: 'react' | 'redux' | 'indexeddb' | 'network'
  event: string
  revision?: number
  operationId?: string
  code?: string
}

export interface InspectionState {
  inspection: InspectionSnapshot | null
  outbox: OutboxOperation | null
  hydration: HydrationState
  hydrationErrorCode: StorageErrorCode | null
  currentRevision: number
  scheduledRevision: number
  durableRevision: number
  completionTargetRevision: number | null
  completionError: boolean
  storageError: { revision: number; code: StorageErrorCode } | null
  events: LearningEvent[]
  nextEventSequence: number
}

export const initialInspectionState: InspectionState = {
  inspection: null,
  outbox: null,
  hydration: 'hydrating',
  hydrationErrorCode: null,
  currentRevision: 0,
  scheduledRevision: 0,
  durableRevision: 0,
  completionTargetRevision: null,
  completionError: false,
  storageError: null,
  events: [],
  nextEventSequence: 1,
}

function addEvent(state: InspectionState, event: Omit<LearningEvent, 'sequence'>) {
  state.events.push({ sequence: state.nextEventSequence, ...event })
  state.nextEventSequence += 1
  if (state.events.length > 60) state.events.shift()
}

type HydratedPayload =
  | InspectionSnapshot
  | { inspection: InspectionSnapshot; outbox?: OutboxOperation | null }

export const inspectionSlice = createSlice({
  name: 'inspection',
  initialState: initialInspectionState,
  reducers: {
    hydrationStarted(state) {
      state.hydration = 'hydrating'
      state.hydrationErrorCode = null
      addEvent(state, { source: 'redux', event: 'hydrationStarted' })
    },
    inspectionHydrated(state, action: PayloadAction<HydratedPayload>) {
      const payload = 'inspection' in action.payload
        ? action.payload
        : { inspection: action.payload, outbox: null }
      state.inspection = payload.inspection
      state.outbox = payload.outbox ?? null
      state.hydration = 'ready'
      state.hydrationErrorCode = null
      state.currentRevision = payload.inspection.localRevision
      state.scheduledRevision = payload.inspection.localRevision
      state.durableRevision = payload.inspection.localRevision
      state.completionTargetRevision = null
      state.completionError = false
      state.storageError = null
      addEvent(state, {
        source: 'redux',
        event: 'inspectionHydrated',
        revision: payload.inspection.localRevision,
        operationId: payload.outbox?.operationId,
      })
    },
    hydrationFailed(state, action: PayloadAction<StorageErrorCode>) {
      state.hydration = action.payload === 'upgrade_blocked' ? 'upgrade_blocked' : 'hydration_error'
      state.hydrationErrorCode = action.payload
      addEvent(state, { source: 'redux', event: 'hydrationFailed', code: action.payload })
    },
    hydrationRetryRequested(state) {
      if (state.hydration !== 'hydration_error') return
      state.hydration = 'hydrating'
      state.hydrationErrorCode = null
      addEvent(state, { source: 'redux', event: 'hydrationRetryRequested' })
    },
    editLockContended(state) {
      state.hydration = 'read_only'
      addEvent(state, { source: 'redux', event: 'editLockContended' })
    },
    editLockUnsupported(state) {
      state.hydration = 'unsupported_browser'
      addEvent(state, { source: 'redux', event: 'editLockUnsupported' })
    },
    upgradeBlocked(state) {
      state.hydration = 'upgrade_blocked'
      state.hydrationErrorCode = 'upgrade_blocked'
      addEvent(state, { source: 'indexeddb', event: 'upgradeBlocked', code: 'upgrade_blocked' })
    },
    itemResultChanged(state, action: PayloadAction<{ itemId: string; result: InspectionResult }>) {
      if (state.hydration !== 'ready' || !state.inspection || state.inspection.lifecycle !== 'in_progress') return
      const item = state.inspection.items.find((candidate) => candidate.itemId === action.payload.itemId)
      if (!item || item.result === action.payload.result) return
      item.result = action.payload.result
      state.currentRevision += 1
      state.inspection.localRevision = state.currentRevision
      state.storageError = null
      state.completionError = false
      addEvent(state, { source: 'react', event: 'itemChanged', revision: state.currentRevision })
    },
    itemNoteChanged(state, action: PayloadAction<{ itemId: string; note: string }>) {
      if (state.hydration !== 'ready' || !state.inspection || state.inspection.lifecycle !== 'in_progress') return
      const item = state.inspection.items.find((candidate) => candidate.itemId === action.payload.itemId)
      if (!item || item.note === action.payload.note) return
      item.note = action.payload.note
      state.currentRevision += 1
      state.inspection.localRevision = state.currentRevision
      state.storageError = null
      state.completionError = false
      addEvent(state, { source: 'react', event: 'noteChanged', revision: state.currentRevision })
    },
    flushRequested(state) {
      if (state.hydration !== 'ready' || !state.inspection || state.inspection.lifecycle !== 'in_progress') return
      addEvent(state, { source: 'redux', event: 'flushRequested', revision: state.currentRevision })
    },
    storageRetryRequested(state) {
      if (state.hydration !== 'ready' || !state.inspection || state.inspection.lifecycle !== 'in_progress') return
      state.storageError = null
      state.completionError = false
      addEvent(state, { source: 'redux', event: 'storageRetryRequested', revision: state.currentRevision })
    },
    completionRequested(state) {
      if (
        state.hydration !== 'ready'
        || !state.inspection
        || state.inspection.lifecycle !== 'in_progress'
        || state.inspection.items.some((item) => item.result === 'unanswered')
      ) return
      state.inspection.lifecycle = 'completing'
      state.completionTargetRevision = state.currentRevision
      state.storageError = null
      state.completionError = false
      addEvent(state, { source: 'react', event: 'completionRequested', revision: state.currentRevision })
    },
    completionCommitted(
      state,
      action: PayloadAction<{ inspection: InspectionSnapshot; operation: OutboxOperation }>,
    ) {
      if (
        !state.inspection
        || state.inspection.lifecycle !== 'completing'
        || state.completionTargetRevision !== action.payload.inspection.localRevision
      ) return
      state.inspection = action.payload.inspection
      state.outbox = action.payload.operation
      state.durableRevision = action.payload.inspection.localRevision
      state.completionTargetRevision = null
      state.storageError = null
      state.completionError = false
      addEvent(state, {
        source: 'indexeddb',
        event: 'completionCommitted',
        revision: action.payload.inspection.localRevision,
        operationId: action.payload.operation.operationId,
      })
    },
    completionFailed(
      state,
      action: PayloadAction<{ inspectionId: string; revision: number; code: StorageErrorCode }>,
    ) {
      if (
        !state.inspection
        || state.inspection.inspectionId !== action.payload.inspectionId
        || state.inspection.lifecycle !== 'completing'
        || state.completionTargetRevision !== action.payload.revision
      ) return
      state.inspection.lifecycle = 'in_progress'
      state.completionTargetRevision = null
      state.storageError = { revision: action.payload.revision, code: action.payload.code }
      state.completionError = true
      addEvent(state, {
        source: 'indexeddb',
        event: 'completionFailed',
        revision: action.payload.revision,
        code: action.payload.code,
      })
    },
    persistenceScheduled(state, action: PayloadAction<{ inspectionId: string; revision: number }>) {
      if (action.payload.revision > state.scheduledRevision) state.scheduledRevision = action.payload.revision
      if (state.storageError && action.payload.revision >= state.storageError.revision) state.storageError = null
    },
    persistenceStarted(state, action: PayloadAction<{ inspectionId: string; revision: number }>) {
      addEvent(state, { source: 'redux', event: 'persistStarted', revision: action.payload.revision })
    },
    persistenceCommitted(state, action: PayloadAction<{ inspectionId: string; revision: number }>) {
      if (action.payload.revision > state.durableRevision) state.durableRevision = action.payload.revision
      if (state.storageError && action.payload.revision >= state.storageError.revision) state.storageError = null
      addEvent(state, { source: 'indexeddb', event: 'transactionCommitted', revision: action.payload.revision })
    },
    persistenceFailed(state, action: PayloadAction<{ inspectionId: string; revision: number; code: StorageErrorCode }>) {
      const isCurrentFailure =
        action.payload.revision === state.currentRevision
        && state.scheduledRevision <= action.payload.revision
        && state.durableRevision < state.currentRevision
      if (isCurrentFailure) state.storageError = { revision: action.payload.revision, code: action.payload.code }
      addEvent(state, {
        source: 'indexeddb',
        event: 'transactionAborted',
        revision: action.payload.revision,
        code: action.payload.code,
      })
    },
    syncRequested(state) {
      addEvent(state, { source: 'redux', event: 'syncRequested', operationId: state.outbox?.operationId })
    },
    operationClaimed(state, action: PayloadAction<OutboxOperation>) {
      if (state.outbox?.operationId !== action.payload.operationId) return
      state.outbox = action.payload
      addEvent(state, { source: 'indexeddb', event: 'operationClaimed', operationId: action.payload.operationId })
      addEvent(state, { source: 'network', event: 'sendStarted', operationId: action.payload.operationId })
    },
    operationUpdated(
      state,
      action: PayloadAction<{ inspection: InspectionSnapshot; operation: OutboxOperation }>,
    ) {
      if (state.outbox?.operationId !== action.payload.operation.operationId) return
      state.inspection = action.payload.inspection
      state.outbox = action.payload.operation
      const event = action.payload.operation.status === 'acknowledged'
        ? 'acknowledged'
        : action.payload.operation.status === 'conflicted'
          ? 'conflicted'
          : action.payload.operation.status === 'rejected'
            ? 'rejected'
            : 'retryScheduled'
      addEvent(state, {
        source: action.payload.operation.status === 'retryable' ? 'indexeddb' : 'network',
        event,
        operationId: action.payload.operation.operationId,
        code: action.payload.operation.lastError?.code,
      })
    },
    staleResponseIgnored(state, action: PayloadAction<{ operationId: string }>) {
      addEvent(state, { source: 'indexeddb', event: 'staleResponseIgnored', operationId: action.payload.operationId })
    },
    manualRetryRequested(state) {
      if (!state.outbox || (state.outbox.status !== 'retryable' && state.outbox.status !== 'pending')) return
      addEvent(state, { source: 'react', event: 'manualRetryRequested', operationId: state.outbox.operationId })
    },
    diagnosticsCleared(state) {
      state.events = []
    },
  },
})

export const inspectionActions = inspectionSlice.actions
export const inspectionReducer = inspectionSlice.reducer

export type InspectionRootState = { inspection: InspectionState }

export const selectInspection = (state: InspectionRootState) => state.inspection.inspection
export const selectHydration = (state: InspectionRootState) => state.inspection.hydration
export const selectEvents = (state: InspectionRootState) => state.inspection.events
export const selectOutbox = (state: InspectionRootState) => state.inspection.outbox
export const selectCanEdit = (state: InspectionRootState) =>
  state.inspection.hydration === 'ready'
  && state.inspection.inspection?.lifecycle === 'in_progress'
export const selectCanComplete = (state: InspectionRootState) =>
  selectCanEdit(state)
  && state.inspection.inspection?.items.every((item) => item.result !== 'unanswered') === true

export const selectDurabilityStatus = (state: InspectionRootState) => {
  const inspectionState = state.inspection
  if (inspectionState.hydration === 'hydrating') return 'Opening today\u2019s work\u2026'
  if (inspectionState.hydration === 'hydration_error') return 'Couldn\u2019t open this device\u2019s work'
  if (inspectionState.hydration === 'read_only') return 'Sitepad is already open in another tab'
  if (inspectionState.hydration === 'unsupported_browser') return 'This browser cannot safely edit offline'
  if (inspectionState.hydration === 'upgrade_blocked') return 'Storage update blocked \u2014 close other Sitepad tabs'
  if (inspectionState.storageError) {
    return inspectionState.completionError
      ? 'Not completed \u2014 your work is still here'
      : 'Not saved \u2014 your last change needs attention'
  }
  if (inspectionState.outbox?.status === 'conflicted') return 'Needs your call'
  if (inspectionState.outbox?.status === 'rejected') return 'Couldn\u2019t be accepted \u2014 kept on this device'
  if (inspectionState.currentRevision !== inspectionState.durableRevision) return 'Saving'
  if (inspectionState.inspection?.lifecycle === 'completing') return 'Finishing on this device\u2026'
  if (inspectionState.outbox?.status === 'sending') return 'Sending'
  if (inspectionState.outbox?.status === 'retryable') return 'Couldn\u2019t send \u2014 will retry'
  if (inspectionState.outbox?.status === 'pending') return 'Waiting to send'
  if (inspectionState.outbox?.status === 'acknowledged') return 'Sent'
  return 'On this device'
}
