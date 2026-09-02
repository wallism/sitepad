import type {
  DeliverySnapshot,
  OutboxOperation,
  TerminalSyncResponse,
} from '../features/inspection/inspectionTypes'

export type TransportOutcome =
  | { kind: 'terminal'; response: TerminalSyncResponse }
  | { kind: 'retryable'; code: 'network_error' | 'timeout' | 'http_retryable' | 'protocol_error' }

export interface SyncTransport {
  send(operation: OutboxOperation): Promise<TransportOutcome>
}

export function isRetryableHttpStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

export const unavailableTransport: SyncTransport = {
  send: async () => ({ kind: 'retryable', code: 'network_error' }),
}

const resultValues = new Set(['unanswered', 'pass', 'fail', 'not_applicable'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

function parseSnapshot(value: unknown): DeliverySnapshot | null {
  if (!isRecord(value) || !hasExactKeys(value, ['result', 'note'])) return null
  if (typeof value.result !== 'string' || !resultValues.has(value.result)) return null
  if (typeof value.note !== 'string' || value.note.length > 2000) return null
  return { result: value.result as DeliverySnapshot['result'], note: value.note }
}

export function validateSyncResponse(value: unknown, operationId: string): TerminalSyncResponse | null {
  if (!isRecord(value) || value.operationId !== operationId || typeof value.kind !== 'string') return null
  if (value.kind === 'acknowledged' || value.kind === 'conflict') {
    if (!hasExactKeys(value, ['kind', 'operationId', 'serverVersion', 'server'])) return null
    if (!Number.isSafeInteger(value.serverVersion) || (value.serverVersion as number) < 1) return null
    const server = parseSnapshot(value.server)
    if (!server) return null
    return {
      kind: value.kind,
      operationId,
      serverVersion: value.serverVersion as number,
      server,
    }
  }
  if (value.kind === 'rejected') {
    if (!hasExactKeys(value, ['kind', 'operationId', 'code', 'message'])) return null
    if (typeof value.code !== 'string' || !value.code || value.code.length > 128) return null
    if (typeof value.message !== 'string' || !value.message || value.message.length > 500) return null
    return { kind: 'rejected', operationId, code: value.code, message: value.message }
  }
  return null
}

export class FetchSyncTransport implements SyncTransport {
  constructor(
    private readonly endpoint = 'http://127.0.0.1:5079/api/sync',
    private readonly timeoutMilliseconds = 10_000,
  ) {}

  async send(operation: OutboxOperation): Promise<TransportOutcome> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), this.timeoutMilliseconds)
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: operation.requestJson,
        signal: controller.signal,
      })
      if (isRetryableHttpStatus(response.status)) {
        return { kind: 'retryable', code: 'http_retryable' }
      }
      let body: unknown
      try {
        body = await response.json()
      } catch {
        return { kind: 'retryable', code: 'protocol_error' }
      }
      const terminal = validateSyncResponse(body, operation.operationId)
      return terminal
        ? { kind: 'terminal', response: terminal }
        : { kind: 'retryable', code: 'protocol_error' }
    } catch (error) {
      return {
        kind: 'retryable',
        code: error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'network_error',
      }
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }
}

export class DevSyncTransport implements SyncTransport {
  private failSend = false

  constructor(private readonly inner: SyncTransport) {}

  failNextSend() {
    this.failSend = true
  }

  async send(operation: OutboxOperation): Promise<TransportOutcome> {
    if (this.failSend) {
      this.failSend = false
      return { kind: 'retryable', code: 'network_error' }
    }
    return this.inner.send(operation)
  }
}
