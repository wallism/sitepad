import { cloneInspection, fixtureInspection } from './fixture'
import {
  inspectionActions,
  inspectionReducer,
  initialInspectionState,
  selectDurabilityStatus,
} from './inspectionSlice'

function hydratedState() {
  return inspectionReducer(initialInspectionState, inspectionActions.inspectionHydrated(cloneInspection(fixtureInspection)))
}

describe('inspection reducer and durability selector', () => {
  it('updates an item and revision synchronously, then reports Saving', () => {
    const state = inspectionReducer(hydratedState(), inspectionActions.itemResultChanged({
      itemId: 'smoke-hallway',
      result: 'fail',
    }))

    expect(state.inspection?.items[0].result).toBe('fail')
    expect(state.currentRevision).toBe(1)
    expect(state.durableRevision).toBe(0)
    expect(selectDurabilityStatus({ inspection: state })).toBe('Saving')
  })

  it('shows On this device only when the current revision commits', () => {
    let state = inspectionReducer(hydratedState(), inspectionActions.itemResultChanged({
      itemId: 'smoke-hallway',
      result: 'pass',
    }))
    state = inspectionReducer(state, inspectionActions.persistenceScheduled({
      inspectionId: fixtureInspection.inspectionId,
      revision: 1,
    }))
    state = inspectionReducer(state, inspectionActions.persistenceCommitted({
      inspectionId: fixtureInspection.inspectionId,
      revision: 1,
    }))

    expect(state.durableRevision).toBe(1)
    expect(selectDurabilityStatus({ inspection: state })).toBe('On this device')
  })

  it('does not let stale results replace the visible state for newer work', () => {
    let state = hydratedState()
    state = inspectionReducer(state, inspectionActions.itemNoteChanged({ itemId: 'smoke-hallway', note: 'first' }))
    state = inspectionReducer(state, inspectionActions.itemNoteChanged({ itemId: 'smoke-hallway', note: 'newest' }))
    state = inspectionReducer(state, inspectionActions.persistenceScheduled({
      inspectionId: fixtureInspection.inspectionId,
      revision: 2,
    }))
    state = inspectionReducer(state, inspectionActions.persistenceFailed({
      inspectionId: fixtureInspection.inspectionId,
      revision: 1,
      code: 'transaction_aborted',
    }))
    state = inspectionReducer(state, inspectionActions.persistenceCommitted({
      inspectionId: fixtureInspection.inspectionId,
      revision: 1,
    }))

    expect(state.inspection?.items[0].note).toBe('newest')
    expect(state.storageError).toBeNull()
    expect(selectDurabilityStatus({ inspection: state })).toBe('Saving')
  })

  it('keeps a current failed revision unsafe until it is retried', () => {
    let state = inspectionReducer(hydratedState(), inspectionActions.itemResultChanged({
      itemId: 'smoke-hallway',
      result: 'fail',
    }))
    state = inspectionReducer(state, inspectionActions.persistenceScheduled({
      inspectionId: fixtureInspection.inspectionId,
      revision: 1,
    }))
    state = inspectionReducer(state, inspectionActions.persistenceFailed({
      inspectionId: fixtureInspection.inspectionId,
      revision: 1,
      code: 'transaction_aborted',
    }))

    expect(selectDurabilityStatus({ inspection: state })).toBe('Not saved — your last change needs attention')
    expect(state.durableRevision).toBe(0)
  })
})
