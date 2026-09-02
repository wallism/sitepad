import { inspectionActions } from '../features/inspection/inspectionSlice'
import type { EditLock, EditLockHandle, InspectionStorage } from '../features/inspection/inspectionTypes'
import type { AppStore } from './store'

export function bootstrapSitepad(store: AppStore, storage: InspectionStorage, editLock: EditLock) {
  let disposed = false
  let lockHandle: EditLockHandle | undefined

  storage.setVersionChangeHandler(() => {
    store.dispatch(inspectionActions.upgradeBlocked())
    lockHandle?.release()
    lockHandle = undefined
  })

  store.dispatch(inspectionActions.hydrationStarted())
  void editLock.acquire().then(async (lockResult) => {
    if (disposed) {
      if (lockResult.kind === 'acquired') lockResult.handle.release()
      return
    }
    if (lockResult.kind === 'unsupported') {
      store.dispatch(inspectionActions.editLockUnsupported())
      return
    }
    if (lockResult.kind === 'contended') {
      store.dispatch(inspectionActions.editLockContended())
      return
    }

    lockHandle = lockResult.handle
    const hydration = await storage.hydrate()
    if (disposed) return
    if (hydration.kind === 'hydrated') store.dispatch(inspectionActions.inspectionHydrated(hydration.inspection))
    else store.dispatch(inspectionActions.hydrationFailed(hydration.code))
  })

  return () => {
    disposed = true
    storage.close()
    lockHandle?.release()
    lockHandle = undefined
  }
}
