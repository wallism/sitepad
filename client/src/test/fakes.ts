import { cloneInspection, fixtureInspection } from '../features/inspection/fixture'
import { canonicalRequestJson } from '../storage/indexedDbInspectionStorage'
import type {
  ClaimResult,
  CompletionResult,
  EditLock,
  EditLockResult,
  HydrationResult,
  InspectionSnapshot,
  InspectionStorage,
  OperationUpdateResult,
  OutboxOperation,
  StorageResult,
  TerminalSyncResponse,
} from '../features/inspection/inspectionTypes'

function cloneOperation(operation: OutboxOperation) {
  return JSON.parse(JSON.stringify(operation)) as OutboxOperation
}

export class FakeStorage implements InspectionStorage {
  snapshot = cloneInspection(fixtureInspection)
  operation: OutboxOperation | null = null
  hydrationResults: HydrationResult[] = []
  persistResults: StorageResult[] = []
  persisted: InspectionSnapshot[] = []
  versionChangeHandler: () => void = () => undefined

  async hydrate(): Promise<HydrationResult> {
    return this.hydrationResults.shift() ?? {
      kind: 'hydrated',
      inspection: cloneInspection(this.snapshot),
      outbox: this.operation ? cloneOperation(this.operation) : null,
    }
  }

  async persist(snapshot: InspectionSnapshot): Promise<StorageResult> {
    this.persisted.push(cloneInspection(snapshot))
    const result = this.persistResults.shift() ?? {
      kind: 'committed' as const,
      inspectionId: snapshot.inspectionId,
      revision: snapshot.localRevision,
    }
    if (result.kind === 'committed') this.snapshot = cloneInspection(snapshot)
    return result
  }

  async complete(snapshot: InspectionSnapshot, operationId: string, createdAt: number): Promise<CompletionResult> {
    const item = snapshot.items.find((candidate) => candidate.result === 'fail') ?? snapshot.items[0]
    const request = {
      operationId,
      inspectionId: snapshot.inspectionId,
      baseVersion: snapshot.baseVersion,
      base: { ...snapshot.baseSnapshot },
      mine: { result: item.result, note: item.note },
    }
    this.operation = {
      operationId,
      inspectionId: snapshot.inspectionId,
      deliveryItemId: item.itemId,
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
    this.snapshot = { ...cloneInspection(snapshot), lifecycle: 'completed', activeOperationId: operationId }
    return {
      kind: 'committed',
      inspection: cloneInspection(this.snapshot),
      operation: cloneOperation(this.operation),
    }
  }

  async claimNext(now: number, claimId: string, leaseMilliseconds: number): Promise<ClaimResult> {
    if (!this.operation) return { kind: 'none', nextAttemptAt: null }
    if (this.operation.status === 'sending' && (this.operation.leaseExpiresAt ?? 0) <= now) {
      this.operation.status = 'pending'
    }
    if (
      !['pending', 'retryable'].includes(this.operation.status)
      || this.operation.nextAttemptAt > now
    ) {
      return {
        kind: 'none',
        nextAttemptAt: this.operation.status === 'retryable' ? this.operation.nextAttemptAt : null,
      }
    }
    this.operation.status = 'sending'
    this.operation.claimId = claimId
    this.operation.leaseExpiresAt = now + leaseMilliseconds
    this.operation.attemptCount += 1
    return { kind: 'claimed', operation: cloneOperation(this.operation) }
  }

  async recordTerminal(operationId: string, claimId: string, response: TerminalSyncResponse): Promise<OperationUpdateResult> {
    if (!this.operation || this.operation.operationId !== operationId || this.operation.claimId !== claimId) {
      return { kind: 'stale' }
    }
    this.operation.claimId = null
    this.operation.leaseExpiresAt = null
    this.operation.terminalResponse = response
    this.operation.status = response.kind === 'acknowledged'
      ? 'acknowledged'
      : response.kind === 'conflict' ? 'conflicted' : 'rejected'
    if (response.kind === 'acknowledged') {
      this.snapshot.baseVersion = response.serverVersion
      this.snapshot.baseSnapshot = { ...response.server }
      this.snapshot.activeOperationId = null
    } else if (response.kind === 'rejected') {
      this.snapshot.activeOperationId = null
    }
    return {
      kind: 'committed',
      inspection: cloneInspection(this.snapshot),
      operation: cloneOperation(this.operation),
    }
  }

  async recordRetryable(
    operationId: string,
    claimId: string,
    code: string,
    nextAttemptAt: number,
    recordedAt: number,
  ): Promise<OperationUpdateResult> {
    if (!this.operation || this.operation.operationId !== operationId || this.operation.claimId !== claimId) {
      return { kind: 'stale' }
    }
    this.operation.status = 'retryable'
    this.operation.claimId = null
    this.operation.leaseExpiresAt = null
    this.operation.nextAttemptAt = nextAttemptAt
    this.operation.lastError = { code, at: recordedAt }
    return {
      kind: 'committed',
      inspection: cloneInspection(this.snapshot),
      operation: cloneOperation(this.operation),
    }
  }

  async retryNow(operationId: string, now: number): Promise<OperationUpdateResult> {
    if (!this.operation || this.operation.operationId !== operationId) return { kind: 'stale' }
    this.operation.nextAttemptAt = now
    return {
      kind: 'committed',
      inspection: cloneInspection(this.snapshot),
      operation: cloneOperation(this.operation),
    }
  }

  close() {}

  setVersionChangeHandler(handler: () => void) {
    this.versionChangeHandler = handler
  }
}

export function fakeLock(result: EditLockResult): EditLock {
  return { acquire: async () => result }
}

export const acquiredFakeLock = () => fakeLock({
  kind: 'acquired',
  handle: { release: () => undefined },
})
