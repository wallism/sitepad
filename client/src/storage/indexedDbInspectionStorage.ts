import { cloneInspection, fixtureInspection } from '../features/inspection/fixture'
import type {
  HydrationResult,
  InspectionSnapshot,
  InspectionStorage,
  StorageDiagnostic,
  StorageErrorCode,
  StorageResult,
} from '../features/inspection/inspectionTypes'
import type { InspectionStorageFaultBoundary } from './inspectionStorageFaults'

const DATABASE_VERSION = 1
const INSPECTIONS_STORE = 'inspections'

function classifyError(error: unknown, fallback: StorageErrorCode): StorageErrorCode {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return 'quota_exceeded'
    if (error.name === 'VersionError') return 'database_version_error'
    if (error.name === 'AbortError') return 'transaction_aborted'
  }
  return fallback
}

function createSchema(database: IDBDatabase) {
  if (!database.objectStoreNames.contains(INSPECTIONS_STORE)) {
    database.createObjectStore(INSPECTIONS_STORE, { keyPath: 'inspectionId' })
  }
  if (!database.objectStoreNames.contains('outbox')) {
    const outbox = database.createObjectStore('outbox', { keyPath: 'operationId' })
    outbox.createIndex('inspectionId', 'inspectionId')
    outbox.createIndex('statusNextAttemptAt', ['status', 'nextAttemptAt'])
  }
  if (!database.objectStoreNames.contains('photos')) {
    const photos = database.createObjectStore('photos', { keyPath: 'photoId' })
    photos.createIndex('inspectionItem', ['inspectionId', 'itemId'])
  }
  if (!database.objectStoreNames.contains('meta')) {
    database.createObjectStore('meta', { keyPath: 'name' })
  }
}

export interface IndexedDbInspectionStorageOptions {
  databaseName?: string
  faults?: InspectionStorageFaultBoundary
}

export class IndexedDbInspectionStorage implements InspectionStorage {
  private database: IDBDatabase | null = null
  private versionChangeHandler: () => void = () => undefined
  private readonly diagnostics: StorageDiagnostic[] = []

  constructor(private readonly options: IndexedDbInspectionStorageOptions = {}) {}

  setVersionChangeHandler(handler: () => void) {
    this.versionChangeHandler = handler
  }

  getDiagnostics() {
    return this.diagnostics
  }

  async hydrate(): Promise<HydrationResult> {
    try {
      const database = await this.openDatabase()
      const inspection = await new Promise<InspectionSnapshot>((resolve, reject) => {
        const transaction = database.transaction(INSPECTIONS_STORE, 'readwrite')
        const store = transaction.objectStore(INSPECTIONS_STORE)
        const request = store.get(fixtureInspection.inspectionId)
        let hydrated = cloneInspection(fixtureInspection)

        request.onsuccess = () => {
          if (request.result) {
            hydrated = cloneInspection(request.result as InspectionSnapshot)
          } else {
            store.put(hydrated)
          }
        }
        request.onerror = () => transaction.abort()
        transaction.oncomplete = () => resolve(hydrated)
        transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Hydration aborted'))
        transaction.onerror = () => undefined
      })
      return { kind: 'hydrated', inspection }
    } catch (error) {
      return { kind: 'failed', code: classifyError(error, 'read_failed') }
    }
  }

  async persist(snapshot: InspectionSnapshot): Promise<StorageResult> {
    const revision = snapshot.localRevision
    const inspectionId = snapshot.inspectionId
    await this.options.faults?.waitBeforeWrite()

    try {
      const database = await this.openDatabase()
      const shouldAbort = this.options.faults?.consumeWriteFailure() ?? false
      await new Promise<void>((resolve, reject) => {
        let transaction: IDBTransaction
        try {
          transaction = database.transaction(INSPECTIONS_STORE, 'readwrite', { durability: 'strict' })
        } catch {
          transaction = database.transaction(INSPECTIONS_STORE, 'readwrite')
        }
        const record = cloneInspection(snapshot)
        record.lastStorageDiagnostic = null
        transaction.objectStore(INSPECTIONS_STORE).put(record)
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error ?? new DOMException('Write aborted', 'AbortError'))
        transaction.onerror = () => undefined
        if (shouldAbort) transaction.abort()
      })
      this.diagnostics.push({ source: 'indexeddb', event: 'transactionCommitted', inspectionId, revision })
      return { kind: 'committed', inspectionId, revision }
    } catch (error) {
      const code = classifyError(error, 'transaction_aborted')
      this.diagnostics.push({
        source: 'indexeddb',
        event: 'transactionAborted',
        inspectionId,
        revision,
        code,
      })
      return { kind: 'failed', inspectionId, revision, code }
    }
  }

  async readCommitted(): Promise<InspectionSnapshot | undefined> {
    const database = await this.openDatabase()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(INSPECTIONS_STORE, 'readonly')
      const request = transaction.objectStore(INSPECTIONS_STORE).get(fixtureInspection.inspectionId)
      request.onsuccess = () => resolve(
        request.result ? cloneInspection(request.result as InspectionSnapshot) : undefined,
      )
      request.onerror = () => reject(request.error)
    })
  }

  close() {
    this.database?.close()
    this.database = null
  }

  async openBlockingConnectionForTest(): Promise<() => void> {
    const request = indexedDB.open(this.databaseName, DATABASE_VERSION)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    database.onversionchange = () => undefined
    return () => database.close()
  }

  requestUpgradeForTest(version: number, onBlocked: () => void): Promise<'upgraded' | 'blocked'> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, version)
      let settled = false
      request.onupgradeneeded = () => createSchema(request.result)
      request.onblocked = () => {
        this.diagnostics.push({ source: 'indexeddb', event: 'upgradeBlocked', code: 'upgrade_blocked' })
        onBlocked()
        settled = true
        resolve('blocked')
      }
      request.onsuccess = () => {
        request.result.close()
        if (!settled) resolve('upgraded')
      }
      request.onerror = () => {
        if (!settled) reject(request.error)
      }
    })
  }

  private get databaseName() {
    return this.options.databaseName ?? 'sitepad-local-v1'
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.options.faults?.consumeOpenFailure()) {
      return Promise.reject(new DOMException('Injected database open failure', 'InvalidStateError'))
    }
    if (!globalThis.indexedDB) {
      return Promise.reject(new DOMException('IndexedDB unavailable', 'InvalidStateError'))
    }
    if (this.database) return Promise.resolve(this.database)

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, DATABASE_VERSION)
      let blocked = false
      request.onupgradeneeded = () => createSchema(request.result)
      request.onblocked = () => {
        blocked = true
        this.diagnostics.push({ source: 'indexeddb', event: 'upgradeBlocked', code: 'upgrade_blocked' })
        reject(new DOMException('Database upgrade blocked', 'InvalidStateError'))
      }
      request.onerror = () => reject(request.error ?? new Error('Database open failed'))
      request.onsuccess = () => {
        if (blocked) {
          request.result.close()
          return
        }
        this.database = request.result
        this.database.onversionchange = () => {
          this.diagnostics.push({ source: 'indexeddb', event: 'databaseVersionChanged' })
          this.database?.close()
          this.database = null
          this.versionChangeHandler()
        }
        resolve(this.database)
      }
    })
  }
}
