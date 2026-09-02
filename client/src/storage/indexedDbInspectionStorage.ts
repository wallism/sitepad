import { cloneInspection, fixtureInspection } from '../features/inspection/fixture'
import { noopLogger, type AppLogger } from '../diagnostics/logger'
import type {
  ClaimResult,
  CompletionResult,
  DeliverySnapshot,
  HydrationResult,
  InspectionSnapshot,
  InspectionStorage,
  OperationUpdateResult,
  OutboxOperation,
  StorageDiagnostic,
  StorageErrorCode,
  StorageResult,
  SyncRequest,
  TerminalSyncResponse,
} from '../features/inspection/inspectionTypes'
import type { InspectionStorageFaultBoundary } from './inspectionStorageFaults'

const DATABASE_VERSION = 1
const INSPECTIONS_STORE = 'inspections'
const OUTBOX_STORE = 'outbox'

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
  if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
    const outbox = database.createObjectStore(OUTBOX_STORE, { keyPath: 'operationId' })
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

function normalizeInspection(value: InspectionSnapshot): InspectionSnapshot {
  const normalized = cloneInspection({
    ...value,
    lifecycle: value.lifecycle ?? 'in_progress',
    baseSnapshot: value.baseSnapshot ?? { result: 'unanswered', note: '' },
    activeOperationId: value.activeOperationId ?? null,
  })
  if (normalized.lifecycle === 'completing') normalized.lifecycle = 'in_progress'
  return normalized
}

function cloneOperation(operation: OutboxOperation): OutboxOperation {
  return {
    ...operation,
    request: {
      ...operation.request,
      base: { ...operation.request.base },
      mine: { ...operation.request.mine },
    },
    lastError: operation.lastError ? { ...operation.lastError } : null,
    terminalResponse: operation.terminalResponse
      ? {
          ...operation.terminalResponse,
          ...('server' in operation.terminalResponse
            ? { server: { ...operation.terminalResponse.server } }
            : {}),
        }
      : null,
  } as OutboxOperation
}

export function canonicalRequestJson(request: SyncRequest) {
  return JSON.stringify({
    operationId: request.operationId,
    inspectionId: request.inspectionId,
    baseVersion: request.baseVersion,
    base: { result: request.base.result, note: request.base.note },
    mine: { result: request.mine.result, note: request.mine.note },
  })
}

function operationFor(
  inspection: InspectionSnapshot,
  operationId: string,
  createdAt: number,
): OutboxOperation {
  const deliveryItem = inspection.items.find((item) => item.result === 'fail') ?? inspection.items[0]
  const mine: DeliverySnapshot = {
    result: deliveryItem?.result ?? 'unanswered',
    note: deliveryItem?.note ?? '',
  }
  const request: SyncRequest = {
    operationId,
    inspectionId: inspection.inspectionId,
    baseVersion: inspection.baseVersion,
    base: { ...inspection.baseSnapshot },
    mine,
  }
  return {
    operationId,
    inspectionId: inspection.inspectionId,
    deliveryItemId: deliveryItem?.itemId ?? '',
    status: 'pending',
    request,
    requestJson: canonicalRequestJson(request),
    predecessorOperationId: null,
    attemptCount: 0,
    nextAttemptAt: createdAt,
    claimId: null,
    leaseExpiresAt: null,
    lastError: null,
    terminalResponse: null,
    createdAt,
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
      const hydrated = await new Promise<{ inspection: InspectionSnapshot; outbox: OutboxOperation | null }>((resolve, reject) => {
        const transaction = database.transaction([INSPECTIONS_STORE, OUTBOX_STORE], 'readwrite')
        const inspectionStore = transaction.objectStore(INSPECTIONS_STORE)
        const inspectionRequest = inspectionStore.get(fixtureInspection.inspectionId)
        const outboxRequest = transaction.objectStore(OUTBOX_STORE).getAll()
        let inspection = cloneInspection(fixtureInspection)
        let operations: OutboxOperation[] = []

        inspectionRequest.onsuccess = () => {
          if (inspectionRequest.result) {
            inspection = normalizeInspection(inspectionRequest.result as InspectionSnapshot)
            inspectionStore.put(inspection)
          } else {
            inspectionStore.put(inspection)
          }
        }
        outboxRequest.onsuccess = () => {
          operations = (outboxRequest.result as OutboxOperation[]).map(cloneOperation)
        }
        inspectionRequest.onerror = () => transaction.abort()
        outboxRequest.onerror = () => transaction.abort()
        transaction.oncomplete = () => resolve({
          inspection,
          outbox: operations.find((operation) => operation.operationId === inspection.activeOperationId)
            ?? operations.sort((left, right) => right.createdAt - left.createdAt)[0]
            ?? null,
        })
        transaction.onabort = () => reject(transaction.error ?? new Error('Hydration aborted'))
        transaction.onerror = () => undefined
      })
      this.logger.info('storage.hydration_committed', {
        databaseName: this.databaseName,
        inspectionId: hydrated.inspection.inspectionId,
        revision: hydrated.inspection.localRevision,
        operationId: hydrated.outbox?.operationId,
        durationMilliseconds: this.elapsed(startedAt),
      })
      return { kind: 'hydrated', ...hydrated }
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
      await new Promise<void>((resolve, reject) => {
        const transaction = this.transaction(database, INSPECTIONS_STORE)
        const record = normalizeInspection(snapshot)
        record.lifecycle = 'in_progress'
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
      this.diagnostics.push({ source: 'indexeddb', event: 'transactionAborted', inspectionId, revision, code })
      this.logger.error('storage.transaction_failed', { inspectionId, revision, code })
      return { kind: 'failed', inspectionId, revision, code }
    }
  }

  async complete(snapshot: InspectionSnapshot, operationId: string, createdAt: number): Promise<CompletionResult> {
    const revision = snapshot.localRevision
    try {
      const database = await this.openDatabase()
      const shouldAbort = this.options.faults?.consumeWriteFailure() ?? false
      return await new Promise<CompletionResult>((resolve, reject) => {
        const transaction = this.transaction(database, [INSPECTIONS_STORE, OUTBOX_STORE])
        const inspectionStore = transaction.objectStore(INSPECTIONS_STORE)
        const request = inspectionStore.get(snapshot.inspectionId)
        let completed: InspectionSnapshot | null = null
        let operation: OutboxOperation | null = null
        let failure: StorageErrorCode | null = null

        request.onsuccess = () => {
          const persisted = request.result
            ? normalizeInspection(request.result as InspectionSnapshot)
            : null
          if (!persisted || persisted.lifecycle !== 'in_progress' || persisted.localRevision !== revision) {
            failure = 'stale_revision'
            transaction.abort()
            return
          }
          operation = operationFor(persisted, operationId, createdAt)
          completed = {
            ...persisted,
            lifecycle: 'completed',
            activeOperationId: operationId,
          }
          inspectionStore.put(completed)
          transaction.objectStore(OUTBOX_STORE).add(operation)
          if (shouldAbort) transaction.abort()
        }
        request.onerror = () => transaction.abort()
        transaction.oncomplete = () => resolve({
          kind: 'committed',
          inspection: cloneInspection(completed!),
          operation: cloneOperation(operation!),
        })
        transaction.onabort = () => {
          if (failure) {
            resolve({ kind: 'failed', inspectionId: snapshot.inspectionId, revision, code: failure })
          } else {
            reject(transaction.error ?? new DOMException('Completion aborted', 'AbortError'))
          }
        }
        transaction.onerror = () => undefined
      })
    } catch (error) {
      const code = classifyError(error, 'transaction_aborted')
      this.logger.error('storage.completion_failed', {
        inspectionId: snapshot.inspectionId,
        revision,
        operationId,
        code,
      })
      return { kind: 'failed', inspectionId: snapshot.inspectionId, revision, code }
    }
  }

  async claimNext(now: number, claimId: string, leaseMilliseconds: number): Promise<ClaimResult> {
    try {
      const database = await this.openDatabase()
      return await new Promise<ClaimResult>((resolve, reject) => {
        const transaction = this.transaction(database, OUTBOX_STORE)
        const store = transaction.objectStore(OUTBOX_STORE)
        const request = store.getAll()
        let claimed: OutboxOperation | null = null
        let earliest: number | null = null
        request.onsuccess = () => {
          const operations = (request.result as OutboxOperation[]).map(cloneOperation)
          for (const operation of operations) {
            if (operation.status === 'sending' && (operation.leaseExpiresAt ?? 0) <= now) {
              operation.status = 'pending'
              operation.claimId = null
              operation.leaseExpiresAt = null
              operation.nextAttemptAt = now
              store.put(operation)
            }
          }
          const eligible = operations
            .filter((operation) =>
              (operation.status === 'pending' || operation.status === 'retryable' || operation.status === 'sending')
              && (operation.status !== 'sending' || (operation.leaseExpiresAt ?? 0) <= now)
              && operation.nextAttemptAt <= now)
            .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt || left.createdAt - right.createdAt)[0]
          if (eligible) {
            eligible.status = 'sending'
            eligible.claimId = claimId
            eligible.leaseExpiresAt = now + leaseMilliseconds
            eligible.attemptCount += 1
            store.put(eligible)
            claimed = eligible
          } else {
            const future = operations
              .filter((operation) => operation.status === 'pending' || operation.status === 'retryable')
              .map((operation) => operation.nextAttemptAt)
            earliest = future.length ? Math.min(...future) : null
          }
        }
        request.onerror = () => transaction.abort()
        transaction.oncomplete = () => resolve(claimed
          ? { kind: 'claimed', operation: cloneOperation(claimed) }
          : { kind: 'none', nextAttemptAt: earliest })
        transaction.onabort = () => reject(transaction.error ?? new Error('Claim aborted'))
        transaction.onerror = () => undefined
      })
    } catch (error) {
      return { kind: 'failed', code: classifyError(error, 'transaction_aborted') }
    }
  }

  async recordTerminal(
    operationId: string,
    claimId: string,
    response: TerminalSyncResponse,
  ): Promise<OperationUpdateResult> {
    return this.updateOperation(operationId, claimId, (operation, inspection) => {
      operation.claimId = null
      operation.leaseExpiresAt = null
      operation.terminalResponse = response
      if (response.kind === 'acknowledged') {
        operation.status = 'acknowledged'
        inspection.baseVersion = response.serverVersion
        inspection.baseSnapshot = { ...response.server }
        const item = inspection.items.find((candidate) => candidate.itemId === operation.deliveryItemId)
        if (item) {
          item.result = response.server.result
          item.note = response.server.note
        }
        inspection.activeOperationId = null
      } else if (response.kind === 'conflict') {
        operation.status = 'conflicted'
      } else {
        operation.status = 'rejected'
        inspection.activeOperationId = null
      }
    })
  }

  async recordRetryable(
    operationId: string,
    claimId: string,
    code: string,
    nextAttemptAt: number,
    recordedAt: number,
  ): Promise<OperationUpdateResult> {
    return this.updateOperation(operationId, claimId, (operation) => {
      operation.status = 'retryable'
      operation.claimId = null
      operation.leaseExpiresAt = null
      operation.nextAttemptAt = nextAttemptAt
      operation.lastError = { code, at: recordedAt }
    })
  }

  async retryNow(operationId: string, now: number): Promise<OperationUpdateResult> {
    return this.updateOperation(operationId, null, (operation) => {
      if (operation.status !== 'retryable' && operation.status !== 'pending') return
      operation.status = 'retryable'
      operation.nextAttemptAt = now
    }, false)
  }

  private async updateOperation(
    operationId: string,
    claimId: string | null,
    update: (operation: OutboxOperation, inspection: InspectionSnapshot) => void,
    requireSending = true,
  ): Promise<OperationUpdateResult> {
    if (this.options.faults?.consumeOperationUpdateFailure()) {
      this.logger.error('storage.operation_update_failed', {
        operationId,
        code: 'transaction_aborted',
      })
      return { kind: 'failed', code: 'transaction_aborted' }
    }
    try {
      const database = await this.openDatabase()
      return await new Promise<OperationUpdateResult>((resolve, reject) => {
        const transaction = this.transaction(database, [INSPECTIONS_STORE, OUTBOX_STORE])
        const operationStore = transaction.objectStore(OUTBOX_STORE)
        const operationRequest = operationStore.get(operationId)
        let updatedOperation: OutboxOperation | null = null
        let updatedInspection: InspectionSnapshot | null = null
        let stale = false
        operationRequest.onsuccess = () => {
          if (!operationRequest.result) {
            stale = true
            return
          }
          const operation = cloneOperation(operationRequest.result as OutboxOperation)
          if (requireSending && (operation.status !== 'sending' || operation.claimId !== claimId)) {
            stale = true
            return
          }
          const inspectionRequest = transaction.objectStore(INSPECTIONS_STORE).get(operation.inspectionId)
          inspectionRequest.onsuccess = () => {
            if (!inspectionRequest.result) {
              transaction.abort()
              return
            }
            const inspection = normalizeInspection(inspectionRequest.result as InspectionSnapshot)
            update(operation, inspection)
            operationStore.put(operation)
            transaction.objectStore(INSPECTIONS_STORE).put(inspection)
            updatedOperation = operation
            updatedInspection = inspection
          }
          inspectionRequest.onerror = () => transaction.abort()
        }
        operationRequest.onerror = () => transaction.abort()
        transaction.oncomplete = () => resolve(stale || !updatedOperation || !updatedInspection
          ? { kind: 'stale' }
          : {
              kind: 'committed',
              inspection: cloneInspection(updatedInspection),
              operation: cloneOperation(updatedOperation),
            })
        transaction.onabort = () => reject(transaction.error ?? new Error('Operation update aborted'))
        transaction.onerror = () => undefined
      })
    } catch (error) {
      return { kind: 'failed', code: classifyError(error, 'transaction_aborted') }
    }
  }

  async readCommitted(): Promise<InspectionSnapshot | undefined> {
    const database = await this.openDatabase()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(INSPECTIONS_STORE, 'readonly')
      const request = transaction.objectStore(INSPECTIONS_STORE).get(fixtureInspection.inspectionId)
      request.onsuccess = () => resolve(request.result
        ? normalizeInspection(request.result as InspectionSnapshot)
        : undefined)
      request.onerror = () => reject(request.error)
    })
  }

  async readOutboxForTest(): Promise<OutboxOperation[]> {
    const database = await this.openDatabase()
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(OUTBOX_STORE, 'readonly')
      const request = transaction.objectStore(OUTBOX_STORE).getAll()
      request.onsuccess = () => resolve((request.result as OutboxOperation[]).map(cloneOperation))
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

  private transaction(database: IDBDatabase, stores: string | string[]) {
    try {
      return database.transaction(stores, 'readwrite', { durability: 'strict' })
    } catch {
      return database.transaction(stores, 'readwrite')
    }
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

  private get logger() {
    return this.options.logger ?? noopLogger
  }

  private elapsed(startedAt: number) {
    return Math.round((performance.now() - startedAt) * 10) / 10
  }
}
