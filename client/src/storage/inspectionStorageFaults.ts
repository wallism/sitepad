export interface InspectionStorageFaultBoundary {
  consumeOpenFailure(): boolean
  consumeWriteFailure(): boolean
  consumeOperationUpdateFailure(): boolean
  waitBeforeWrite(): Promise<void>
}

export class DevInspectionStorageFaults implements InspectionStorageFaultBoundary {
  private failOpen = false
  private failWrite = false
  private failOperationUpdate = false
  private writeDelayMilliseconds = 0

  constructor({ failFirstOpen = false }: { failFirstOpen?: boolean } = {}) {
    this.failOpen = failFirstOpen
  }

  injectNextWriteFailure() {
    this.failWrite = true
  }

  injectNextOpenFailure() {
    this.failOpen = true
  }

  injectNextOperationUpdateFailure() {
    this.failOperationUpdate = true
  }

  setWriteDelay(milliseconds: number) {
    this.writeDelayMilliseconds = Math.max(0, milliseconds)
  }

  consumeOpenFailure() {
    const fail = this.failOpen
    this.failOpen = false
    return fail
  }

  consumeWriteFailure() {
    const fail = this.failWrite
    this.failWrite = false
    return fail
  }

  consumeOperationUpdateFailure() {
    const fail = this.failOperationUpdate
    this.failOperationUpdate = false
    return fail
  }

  async waitBeforeWrite() {
    if (this.writeDelayMilliseconds > 0) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, this.writeDelayMilliseconds))
    }
  }
}
