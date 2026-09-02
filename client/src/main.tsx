import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { App } from './App'
import { createAppStore } from './app/store'
import { ConsoleAppLogger, isLogLevel } from './diagnostics/logger'
import { inspectionActions } from './features/inspection/inspectionSlice'
import { IndexedDbInspectionStorage } from './storage/indexedDbInspectionStorage'
import { DevInspectionStorageFaults } from './storage/inspectionStorageFaults'
import { WebEditLock } from './storage/webEditLock'
import { DevSyncTransport, FetchSyncTransport } from './sync/syncTransport'
import './styles.css'

const parameters = new URLSearchParams(globalThis.location.search)
const requestedLogLevel = parameters.get('log')
const logger = new ConsoleAppLogger(
  import.meta.env.DEV && isLogLevel(requestedLogLevel)
    ? requestedLogLevel
    : import.meta.env.DEV ? 'debug' : 'warn',
)
logger.info('logging.configured', { outcome: logger.getLevel() })
const databaseName = import.meta.env.DEV && parameters.get('db')
  ? `sitepad-${parameters.get('db')}`
  : 'sitepad-local-v1'
const faults = import.meta.env.DEV
  ? new DevInspectionStorageFaults({ failFirstOpen: parameters.get('failOpenOnce') === '1' })
  : undefined
const storage = new IndexedDbInspectionStorage({ databaseName, faults, logger })
const editLock = new WebEditLock(`sitepad-editor:${databaseName}`)
const baseTransport = new FetchSyncTransport(import.meta.env.VITE_SITEPAD_API_URL)
const devTransport = import.meta.env.DEV ? new DevSyncTransport(baseTransport) : undefined
const app = createAppStore({ storage, transport: devTransport ?? baseTransport, logger })

if (import.meta.env.DEV) {
  let closeBlockingConnection: (() => void) | undefined
  globalThis.__SITEPAD_TEST__ = {
    failNextWrite: () => faults!.injectNextWriteFailure(),
    setWriteDelay: (milliseconds) => faults!.setWriteDelay(milliseconds),
    getTrace: () => ({ redux: [...app.actionTrace], indexedDb: [...storage.getDiagnostics()] }),
    readCommitted: () => storage.readCommitted(),
    readOutbox: () => storage.readOutboxForTest(),
    failNextSend: () => devTransport!.failNextSend(),
    failNextResponseWrite: () => faults!.injectNextOperationUpdateFailure(),
    requestSync: () => app.store.dispatch(inspectionActions.syncRequested()),
    claimNext: (now, claimId, leaseMilliseconds) => storage.claimNext(now, claimId, leaseMilliseconds),
    recordTerminal: (operationId, claimId, response) => storage.recordTerminal(operationId, claimId, response),
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
      onFailNextSend={import.meta.env.DEV ? () => devTransport!.failNextSend() : undefined}
      onFailNextResponseWrite={import.meta.env.DEV ? () => faults!.injectNextOperationUpdateFailure() : undefined}
    />
  </Provider>,
)
