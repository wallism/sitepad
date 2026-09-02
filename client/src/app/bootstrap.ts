import { inspectionActions } from '../features/inspection/inspectionSlice'
import { noopLogger, type AppLogger } from '../diagnostics/logger'
import type { EditLock, EditLockHandle, InspectionStorage } from '../features/inspection/inspectionTypes'
import type { AppStore } from './store'

export function bootstrapSitepad(
  store: AppStore,
  storage: InspectionStorage,
  editLock: EditLock,
  logger: AppLogger = noopLogger,
) {
  let disposed = false
  let lockHandle: EditLockHandle | undefined

  storage.setVersionChangeHandler(() => {
    logger.warn('app.storage_version_changed')
    store.dispatch(inspectionActions.upgradeBlocked())
    lockHandle?.release()
    lockHandle = undefined
  })

  logger.info('app.boot_started')
  store.dispatch(inspectionActions.hydrationStarted())
  void editLock.acquire().then(async (lockResult) => {
    if (disposed) {
      if (lockResult.kind === 'acquired') lockResult.handle.release()
      return
    }
    if (lockResult.kind === 'unsupported') {
      logger.error('app.edit_lock_unsupported')
      store.dispatch(inspectionActions.editLockUnsupported())
      return
    }
    if (lockResult.kind === 'contended') {
      logger.warn('app.edit_lock_contended')
      store.dispatch(inspectionActions.editLockContended())
      return
    }

    lockHandle = lockResult.handle
    logger.info('app.edit_lock_acquired')
    const hydration = await storage.hydrate()
    if (disposed) return
    if (hydration.kind === 'hydrated') {
      logger.info('app.hydration_succeeded', {
        inspectionId: hydration.inspection.inspectionId,
        revision: hydration.inspection.localRevision,
      })
      store.dispatch(inspectionActions.inspectionHydrated(hydration.inspection))
    } else {
      logger.error('app.hydration_failed', { code: hydration.code })
      store.dispatch(inspectionActions.hydrationFailed(hydration.code))
    }
  })

  return () => {
    logger.debug('app.disposed')
    disposed = true
    storage.close()
    lockHandle?.release()
    lockHandle = undefined
  }
}
