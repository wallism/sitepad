import type { ReduxActionTrace } from './app/store'
import type {
  ClaimResult,
  InspectionSnapshot,
  OperationUpdateResult,
  OutboxOperation,
  StorageDiagnostic,
  TerminalSyncResponse,
} from './features/inspection/inspectionTypes'

declare global {
  var __SITEPAD_TEST__: {
    failNextWrite(): void
    setWriteDelay(milliseconds: number): void
    getTrace(): { redux: ReduxActionTrace[]; indexedDb: StorageDiagnostic[] }
    readCommitted(): Promise<InspectionSnapshot | undefined>
    readOutbox(): Promise<OutboxOperation[]>
    failNextSend(): void
    failNextResponseWrite(): void
    requestSync(): void
    claimNext(now: number, claimId: string, leaseMilliseconds: number): Promise<ClaimResult>
    recordTerminal(operationId: string, claimId: string, response: TerminalSyncResponse): Promise<OperationUpdateResult>
    openBlockingConnection(): Promise<void>
    closeBlockingConnection(): void
    requestUpgrade(version: number): Promise<'upgraded' | 'blocked'>
  }
}

export {}
