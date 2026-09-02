import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { App } from './App'
import { createAppStore } from './app/store'
import { ConsoleAppLogger } from './diagnostics/logger'
import { inspectionActions } from './features/inspection/inspectionSlice'
import { IndexedDbInspectionStorage } from './storage/indexedDbInspectionStorage'
import { DevInspectionStorageFaults } from './storage/inspectionStorageFaults'
import { WebEditLock } from './storage/webEditLock'
import './styles.css'

const parameters = new URLSearchParams(globalThis.location.search)
const logger = new ConsoleAppLogger(import.meta.env.DEV)
const databaseName = import.meta.env.DEV && parameters.get('db')
  ? `sitepad-${parameters.get('db')}`
  : 'sitepad-local-v1'
const faults = import.meta.env.DEV
  ? new DevInspectionStorageFaults({ failFirstOpen: parameters.get('failOpenOnce') === '1' })
  : undefined
const storage = new IndexedDbInspectionStorage({ databaseName, faults, logger })
const editLock = new WebEditLock(`sitepad-editor:${databaseName}`)
const app = createAppStore({ storage, logger })

if (import.meta.env.DEV) {
  let closeBlockingConnection: (() => void) | undefined
  globalThis.__SITEPAD_TEST__ = {
    failNextWrite: () => faults!.injectNextWriteFailure(),
    setWriteDelay: (milliseconds) => faults!.setWriteDelay(milliseconds),
    getTrace: () => ({ redux: [...app.actionTrace], indexedDb: [...storage.getDiagnostics()] }),
    readCommitted: () => storage.readCommitted(),
    openBlockingConnection: async () => {
      closeBlockingConnection = await storage.openBlockingConnectionForTest()
    },
    closeBlockingConnection: () => {
      closeBlockingConnection?.()
      closeBlockingConnection = undefined
    },
    requestUpgrade: (version) => storage.requestUpgradeForTest(version, () => {
      app.store.dispatch(inspectionActions.upgradeBlocked())
    }),
  }
}

createRoot(document.getElementById('root')!).render(
  <Provider store={app.store}>
    <App
      store={app.store}
      storage={storage}
      editLock={editLock}
      logger={logger}
      onFailNextWrite={import.meta.env.DEV ? () => faults!.injectNextWriteFailure() : undefined}
    />
  </Provider>,
)
