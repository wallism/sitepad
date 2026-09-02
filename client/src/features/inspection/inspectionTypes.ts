export type InspectionResult = 'unanswered' | 'pass' | 'fail' | 'not_applicable'

export interface ChecklistItem {
  itemId: string
  label: string
  result: InspectionResult
  note: string
}

export interface InspectionSnapshot {
  inspectionId: string
  address: string
  inspectionType: string
  lifecycle: 'in_progress'
  items: ChecklistItem[]
  localRevision: number
  baseVersion: number
  activeOperationId: null
  lastStorageDiagnostic: string | null
}

export type StorageErrorCode =
  | 'database_unavailable'
  | 'database_version_error'
  | 'read_failed'
  | 'transaction_aborted'
  | 'quota_exceeded'
  | 'upgrade_blocked'
  | 'unknown'

export type StorageResult =
  | { kind: 'committed'; inspectionId: string; revision: number }
  | { kind: 'failed'; inspectionId: string; revision: number; code: StorageErrorCode }

export type HydrationResult =
  | { kind: 'hydrated'; inspection: InspectionSnapshot }
  | { kind: 'failed'; code: StorageErrorCode }

export interface StorageDiagnostic {
  source: 'indexeddb'
  event: 'transactionCommitted' | 'transactionAborted' | 'databaseVersionChanged' | 'upgradeBlocked'
  inspectionId?: string
  revision?: number
  code?: StorageErrorCode
}

export interface InspectionStorage {
  hydrate(): Promise<HydrationResult>
  persist(snapshot: InspectionSnapshot): Promise<StorageResult>
  close(): void
  setVersionChangeHandler(handler: () => void): void
  getDiagnostics?(): readonly StorageDiagnostic[]
  readCommitted?(): Promise<InspectionSnapshot | undefined>
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
