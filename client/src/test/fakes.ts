import { cloneInspection, fixtureInspection } from '../features/inspection/fixture'
import type {
  EditLock,
  EditLockResult,
  HydrationResult,
  InspectionSnapshot,
  InspectionStorage,
  StorageResult,
} from '../features/inspection/inspectionTypes'

export class FakeStorage implements InspectionStorage {
  snapshot = cloneInspection(fixtureInspection)
  hydrationResults: HydrationResult[] = []
  persistResults: StorageResult[] = []
  persisted: InspectionSnapshot[] = []
  versionChangeHandler: () => void = () => undefined

  async hydrate(): Promise<HydrationResult> {
    return this.hydrationResults.shift() ?? { kind: 'hydrated', inspection: cloneInspection(this.snapshot) }
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
