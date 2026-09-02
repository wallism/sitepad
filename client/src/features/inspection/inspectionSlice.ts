import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type {
  InspectionResult,
  InspectionSnapshot,
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
  source: 'react' | 'redux' | 'indexeddb'
  event: string
  revision?: number
  code?: StorageErrorCode
}

export interface InspectionState {
  inspection: InspectionSnapshot | null
  hydration: HydrationState
  hydrationErrorCode: StorageErrorCode | null
  currentRevision: number
  scheduledRevision: number
  durableRevision: number
  storageError: { revision: number; code: StorageErrorCode } | null
  events: LearningEvent[]
  nextEventSequence: number
}

export const initialInspectionState: InspectionState = {
  inspection: null,
  hydration: 'hydrating',
  hydrationErrorCode: null,
  currentRevision: 0,
  scheduledRevision: 0,
  durableRevision: 0,
  storageError: null,
  events: [],
  nextEventSequence: 1,
}

function addEvent(
  state: InspectionState,
  event: Omit<LearningEvent, 'sequence'>,
) {
  state.events.push({ sequence: state.nextEventSequence, ...event })
  state.nextEventSequence += 1
  if (state.events.length > 60) state.events.shift()
}

export const inspectionSlice = createSlice({
  name: 'inspection',
  initialState: initialInspectionState,
  reducers: {
    hydrationStarted(state) {
      state.hydration = 'hydrating'
      state.hydrationErrorCode = null
      addEvent(state, { source: 'redux', event: 'hydrationStarted' })
    },
    inspectionHydrated(state, action: PayloadAction<InspectionSnapshot>) {
      state.inspection = action.payload
      state.hydration = 'ready'
      state.hydrationErrorCode = null
      state.currentRevision = action.payload.localRevision
      state.scheduledRevision = action.payload.localRevision
      state.durableRevision = action.payload.localRevision
      state.storageError = null
      addEvent(state, {
        source: 'redux',
        event: 'inspectionHydrated',
        revision: action.payload.localRevision,
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
    itemResultChanged(
      state,
      action: PayloadAction<{ itemId: string; result: InspectionResult }>,
    ) {
      if (state.hydration !== 'ready' || !state.inspection) return
      const item = state.inspection.items.find((candidate) => candidate.itemId === action.payload.itemId)
      if (!item || item.result === action.payload.result) return
      item.result = action.payload.result
      state.currentRevision += 1
      state.inspection.localRevision = state.currentRevision
      state.storageError = null
      addEvent(state, { source: 'react', event: 'itemChanged', revision: state.currentRevision })
    },
    itemNoteChanged(state, action: PayloadAction<{ itemId: string; note: string }>) {
      if (state.hydration !== 'ready' || !state.inspection) return
      const item = state.inspection.items.find((candidate) => candidate.itemId === action.payload.itemId)
      if (!item || item.note === action.payload.note) return
      item.note = action.payload.note
      state.currentRevision += 1
      state.inspection.localRevision = state.currentRevision
      state.storageError = null
      addEvent(state, { source: 'react', event: 'noteChanged', revision: state.currentRevision })
    },
    flushRequested(state) {
      if (state.hydration !== 'ready' || !state.inspection) return
      addEvent(state, { source: 'redux', event: 'flushRequested', revision: state.currentRevision })
    },
    storageRetryRequested(state) {
      if (state.hydration !== 'ready' || !state.inspection) return
      state.storageError = null
      addEvent(state, { source: 'redux', event: 'storageRetryRequested', revision: state.currentRevision })
    },
    persistenceScheduled(state, action: PayloadAction<{ inspectionId: string; revision: number }>) {
      if (action.payload.revision > state.scheduledRevision) {
        state.scheduledRevision = action.payload.revision
      }
      if (state.storageError && action.payload.revision >= state.storageError.revision) {
        state.storageError = null
      }
    },
    persistenceStarted(state, action: PayloadAction<{ inspectionId: string; revision: number }>) {
      addEvent(state, { source: 'redux', event: 'persistStarted', revision: action.payload.revision })
    },
    persistenceCommitted(state, action: PayloadAction<{ inspectionId: string; revision: number }>) {
      if (action.payload.revision > state.durableRevision) {
        state.durableRevision = action.payload.revision
      }
      if (state.storageError && action.payload.revision >= state.storageError.revision) {
        state.storageError = null
      }
      addEvent(state, {
        source: 'indexeddb',
        event: 'transactionCommitted',
        revision: action.payload.revision,
      })
    },
    persistenceFailed(
      state,
      action: PayloadAction<{ inspectionId: string; revision: number; code: StorageErrorCode }>,
    ) {
      const isCurrentFailure =
        action.payload.revision === state.currentRevision &&
        state.scheduledRevision <= action.payload.revision &&
        state.durableRevision < state.currentRevision
      if (isCurrentFailure) {
        state.storageError = { revision: action.payload.revision, code: action.payload.code }
      }
      addEvent(state, {
        source: 'indexeddb',
        event: 'transactionAborted',
        revision: action.payload.revision,
        code: action.payload.code,
      })
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
export const selectCanEdit = (state: InspectionRootState) => state.inspection.hydration === 'ready'
export const selectDurabilityStatus = (state: InspectionRootState) => {
  const inspectionState = state.inspection
  if (inspectionState.hydration === 'hydrating') return 'Opening today’s work…'
  if (inspectionState.hydration === 'hydration_error') return 'Couldn’t open this device’s work'
  if (inspectionState.hydration === 'read_only') return 'Sitepad is already open in another tab'
  if (inspectionState.hydration === 'unsupported_browser') return 'This browser cannot safely edit offline'
  if (inspectionState.hydration === 'upgrade_blocked') return 'Storage update blocked — close other Sitepad tabs'
  if (inspectionState.storageError) return 'Not saved — your last change needs attention'
  if (inspectionState.currentRevision !== inspectionState.durableRevision) return 'Saving'
  return 'On this device'
}
