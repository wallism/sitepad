import { cloneInspection, fixtureInspection } from '../features/inspection/fixture'
import { noopLogger, type AppLogger } from '../diagnostics/logger'
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
  logger?: AppLogger
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
    const startedAt = performance.now()
    this.logger.info('storage.hydration_started', { databaseName: this.databaseName })
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
      this.logger.info('storage.hydration_committed', {
        databaseName: this.databaseName,
        inspectionId: inspection.inspectionId,
        revision: inspection.localRevision,
        durationMilliseconds: this.elapsed(startedAt),
      })
      return { kind: 'hydrated', inspection }
    } catch (error) {
      const code = classifyError(error, 'read_failed')
      this.logger.error('storage.hydration_failed', {
        databaseName: this.databaseName,
        code,
        durationMilliseconds: this.elapsed(startedAt),
      })
      return { kind: 'failed', code }
    }
  }

  async persist(snapshot: InspectionSnapshot): Promise<StorageResult> {
    const startedAt = performance.now()
    const revision = snapshot.localRevision
    const inspectionId = snapshot.inspectionId
    this.logger.debug('storage.write_requested', { inspectionId, revision })
    await this.options.faults?.waitBeforeWrite()

    try {
      const database = await this.openDatabase()
      const shouldAbort = this.options.faults?.consumeWriteFailure() ?? false
      this.logger.debug('storage.transaction_started', { inspectionId, revision })
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
      this.logger.info('storage.transaction_committed', {
        inspectionId,
        revision,
        durationMilliseconds: this.elapsed(startedAt),
      })
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
      this.logger.error('storage.transaction_failed', {
        inspectionId,
        revision,
        code,
        durationMilliseconds: this.elapsed(startedAt),
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
    this.logger.debug('storage.connection_closed', { databaseName: this.databaseName })
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
        this.logger.warn('storage.upgrade_blocked', {
          databaseName: this.databaseName,
          toVersion: version,
        })
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
      this.logger.warn('storage.open_injected_failure', { databaseName: this.databaseName })
      return Promise.reject(new DOMException('Injected database open failure', 'InvalidStateError'))
    }
    if (!globalThis.indexedDB) {
      this.logger.error('storage.unavailable', { databaseName: this.databaseName })
      return Promise.reject(new DOMException('IndexedDB unavailable', 'InvalidStateError'))
    }
    if (this.database) return Promise.resolve(this.database)

    const startedAt = performance.now()
    this.logger.debug('storage.open_started', { databaseName: this.databaseName })
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, DATABASE_VERSION)
      let blocked = false
      request.onupgradeneeded = (event) => {
        this.logger.info('storage.schema_upgrade_started', {
          databaseName: this.databaseName,
          fromVersion: event.oldVersion,
          toVersion: DATABASE_VERSION,
        })
        createSchema(request.result)
      }
      request.onblocked = () => {
        blocked = true
        this.diagnostics.push({ source: 'indexeddb', event: 'upgradeBlocked', code: 'upgrade_blocked' })
        this.logger.warn('storage.open_blocked', { databaseName: this.databaseName })
        reject(new DOMException('Database upgrade blocked', 'InvalidStateError'))
      }
      request.onerror = () => {
        this.logger.error('storage.open_failed', {
          databaseName: this.databaseName,
          code: classifyError(request.error, 'database_unavailable'),
          durationMilliseconds: this.elapsed(startedAt),
        })
        reject(request.error ?? new Error('Database open failed'))
      }
      request.onsuccess = () => {
        if (blocked) {
          request.result.close()
          return
        }
        this.database = request.result
        this.logger.info('storage.open_succeeded', {
          databaseName: this.databaseName,
          toVersion: this.database.version,
          durationMilliseconds: this.elapsed(startedAt),
        })
        this.database.onversionchange = () => {
          this.diagnostics.push({ source: 'indexeddb', event: 'databaseVersionChanged' })
          this.logger.warn('storage.version_changed', { databaseName: this.databaseName })
          this.database?.close()
          this.database = null
          this.versionChangeHandler()
        }
        resolve(this.database)
      }
    })
  }

  private get logger() {
    return this.options.logger ?? noopLogger
  }

  private elapsed(startedAt: number) {
    return Math.round((performance.now() - startedAt) * 10) / 10
  }
}
