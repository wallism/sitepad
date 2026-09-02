import { useEffect } from 'react'
import { noopLogger, type AppLogger } from './diagnostics/logger'
import { bootstrapSitepad } from './app/bootstrap'
import { useAppDispatch, useAppSelector, type AppStore } from './app/store'
import { InspectionScreen } from './features/inspection/InspectionScreen'
import {
  inspectionActions,
  selectDurabilityStatus,
  selectHydration,
} from './features/inspection/inspectionSlice'
import type { EditLock, InspectionStorage } from './features/inspection/inspectionTypes'

interface AppProps {
  store: AppStore
  storage: InspectionStorage
  editLock: EditLock
  logger?: AppLogger
  onFailNextWrite?: () => void
}

export function App({ store, storage, editLock, logger = noopLogger, onFailNextWrite }: AppProps) {
  const dispatch = useAppDispatch()
  const hydration = useAppSelector(selectHydration)
  const status = useAppSelector(selectDurabilityStatus)

  useEffect(
    () => bootstrapSitepad(store, storage, editLock, logger),
    [editLock, logger, storage, store],
  )

  useEffect(() => {
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') dispatch(inspectionActions.flushRequested())
    }
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => document.removeEventListener('visibilitychange', flushWhenHidden)
  }, [dispatch])

  if (hydration === 'ready') {
    return <InspectionScreen onFailNextWrite={onFailNextWrite} />
  }

  const canRetry = hydration === 'hydration_error'
  return (
    <main className="state-screen">
      <div className="state-panel" role={canRetry ? 'alert' : 'status'}>
        <span className="state-mark" aria-hidden="true">S</span>
        <h1>Sitepad</h1>
        <p>{status}</p>
        {hydration === 'read_only' && <p>Close the editing tab, then reload this one to take over.</p>}
        {hydration === 'unsupported_browser' && <p>Use current Chrome or Edge so Sitepad can enforce one safe writer.</p>}
        {hydration === 'upgrade_blocked' && <p>Close other Sitepad tabs, then reload to finish the storage update.</p>}
        {canRetry && (
          <button type="button" onClick={() => dispatch(inspectionActions.hydrationRetryRequested())}>
            Retry
          </button>
        )}
      </div>
    </main>
  )
}
