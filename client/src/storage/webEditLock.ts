import type { EditLock, EditLockResult } from '../features/inspection/inspectionTypes'

export class WebEditLock implements EditLock {
  constructor(private readonly lockName: string) {}

  acquire(): Promise<EditLockResult> {
    if (!navigator.locks) return Promise.resolve({ kind: 'unsupported' })

    return new Promise((resolve) => {
      let releaseLock: () => void = () => undefined
      void navigator.locks.request(
        this.lockName,
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          if (!lock) {
            resolve({ kind: 'contended' })
            return
          }
          const released = new Promise<void>((release) => {
            releaseLock = release
          })
          resolve({ kind: 'acquired', handle: { release: () => releaseLock() } })
          await released
        },
      )
    })
  }
}
