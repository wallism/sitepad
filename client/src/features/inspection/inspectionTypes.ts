export type InspectionResult = 'unanswered' | 'pass' | 'fail' | 'not_applicable'

export interface ChecklistItem {
  itemId: string
  label: string
  result: InspectionResult
  note: string
}

export interface DeliverySnapshot {
  result: InspectionResult
  note: string
}

export type InspectionLifecycle = 'in_progress' | 'completing' | 'completed'

export interface InspectionSnapshot {
  inspectionId: string
  address: string
  inspectionType: string
  lifecycle: InspectionLifecycle
  items: ChecklistItem[]
  localRevision: number
  baseVersion: number
  baseSnapshot: DeliverySnapshot
  activeOperationId: string | null
  lastStorageDiagnostic: string | null
}

export interface SyncRequest {
  operationId: string
  inspectionId: string
  baseVersion: number
  base: DeliverySnapshot
  mine: DeliverySnapshot
}

export interface AcknowledgedResponse {
  kind: 'acknowledged'
  operationId: string
  serverVersion: number
  server: DeliverySnapshot
}

export interface ConflictResponse {
  kind: 'conflict'
  operationId: string
  serverVersion: number
  server: DeliverySnapshot
}

export interface RejectedResponse {
  kind: 'rejected'
  operationId: string
  code: string
  message: string
}

export type TerminalSyncResponse = AcknowledgedResponse | ConflictResponse | RejectedResponse
export type OutboxStatus =
  | 'pending'
  | 'sending'
  | 'acknowledged'
  | 'retryable'
  | 'conflicted'
  | 'superseded'
  | 'rejected'

export interface OutboxOperation {
  operationId: string
  inspectionId: string
  deliveryItemId: string
  status: OutboxStatus
  request: SyncRequest
  requestJson: string
  predecessorOperationId: string | null
  attemptCount: number
  nextAttemptAt: number
  claimId: string | null
  leaseExpiresAt: number | null
  lastError: { code: string; at: number } | null
  terminalResponse: TerminalSyncResponse | null
  createdAt: number
}

export type StorageErrorCode =
  | 'database_unavailable'
  | 'database_version_error'
  | 'read_failed'
  | 'transaction_aborted'
  | 'quota_exceeded'
  | 'upgrade_blocked'
  | 'stale_revision'
  | 'unknown'

export type StorageResult =
  | { kind: 'committed'; inspectionId: string; revision: number }
  | { kind: 'failed'; inspectionId: string; revision: number; code: StorageErrorCode }

export type HydrationResult =
  | { kind: 'hydrated'; inspection: InspectionSnapshot; outbox?: OutboxOperation | null }
  | { kind: 'failed'; code: StorageErrorCode }

export type CompletionResult =
  | { kind: 'committed'; inspection: InspectionSnapshot; operation: OutboxOperation }
  | { kind: 'failed'; inspectionId: string; revision: number; code: StorageErrorCode }

export type ClaimResult =
  | { kind: 'claimed'; operation: OutboxOperation }
  | { kind: 'none'; nextAttemptAt: number | null }
  | { kind: 'failed'; code: StorageErrorCode }

export type OperationUpdateResult =
  | { kind: 'committed'; inspection: InspectionSnapshot; operation: OutboxOperation }
  | { kind: 'stale' }
  | { kind: 'failed'; code: StorageErrorCode }

export interface StorageDiagnostic {
  source: 'indexeddb'
  event: 'transactionCommitted' | 'transactionAborted' | 'databaseVersionChanged' | 'upgradeBlocked'
  inspectionId?: string
  revision?: number
  operationId?: string
  code?: StorageErrorCode
}

export interface InspectionStorage {
  hydrate(): Promise<HydrationResult>
  persist(snapshot: InspectionSnapshot): Promise<StorageResult>
  complete(snapshot: InspectionSnapshot, operationId: string, createdAt: number): Promise<CompletionResult>
  claimNext(now: number, claimId: string, leaseMilliseconds: number): Promise<ClaimResult>
  recordTerminal(operationId: string, claimId: string, response: TerminalSyncResponse): Promise<OperationUpdateResult>
  recordRetryable(operationId: string, claimId: string, code: string, nextAttemptAt: number, recordedAt: number): Promise<OperationUpdateResult>
  retryNow(operationId: string, now: number): Promise<OperationUpdateResult>
  close(): void
  setVersionChangeHandler(handler: () => void): void
  getDiagnostics?(): readonly StorageDiagnostic[]
  readCommitted?(): Promise<InspectionSnapshot | undefined>
  readOutboxForTest?(): Promise<OutboxOperation[]>
  requestUpgradeForTest?(version: number, onBlocked: () => void): Promise<'upgraded' | 'blocked'>
  openBlockingConnectionForTest?(): Promise<() => void>
}

export interface EditLockHandle {
  release(): void
}

export type EditLockResult =
  | { kind: 'acquired'; handle: EditLockHandle }
  | { kind: 'contended' }
  | { kind: 'unsupported' }

export interface EditLock {
  acquire(): Promise<EditLockResult>
}
