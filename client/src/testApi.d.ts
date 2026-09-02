import type { ReduxActionTrace } from './app/store'
import type { InspectionSnapshot, StorageDiagnostic } from './features/inspection/inspectionTypes'

declare global {
  var __SITEPAD_TEST__: {
    failNextWrite(): void
    setWriteDelay(milliseconds: number): void
    getTrace(): { redux: ReduxActionTrace[]; indexedDb: StorageDiagnostic[] }
    readCommitted(): Promise<InspectionSnapshot | undefined>
    openBlockingConnection(): Promise<void>
    closeBlockingConnection(): void
    requestUpgrade(version: number): Promise<'upgraded' | 'blocked'>
  }
}

export {}
