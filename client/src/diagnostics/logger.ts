export interface DiagnosticContext {
  actionType?: string
  attemptCount?: number
  claimId?: string | null
  code?: string
  currentRevision?: number
  databaseName?: string
  debounceMilliseconds?: number
  durableRevision?: number
  deliveryStatus?: string
  durationMilliseconds?: number
  fromVersion?: number
  inspectionId?: string
  lockName?: string
  nextAttemptAt?: number
  operationId?: string
  outcome?: string
  pendingRevision?: number
  reason?: string
  revision?: number
  toVersion?: number
}

export interface AppLogger {
  debug(event: string, context?: DiagnosticContext): void
  info(event: string, context?: DiagnosticContext): void
  warn(event: string, context?: DiagnosticContext): void
  error(event: string, context?: DiagnosticContext): void
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const logLevelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
}

export function isLogLevel(value: string | null): value is LogLevel {
  return value !== null && value in logLevelPriority
}

export const noopLogger: AppLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

export class ConsoleAppLogger implements AppLogger {
  private level: LogLevel

  constructor(
    level: LogLevel | boolean,
    private readonly timestamp: () => string = () => new Date().toISOString(),
  ) {
    this.level = typeof level === 'boolean' ? (level ? 'debug' : 'silent') : level
  }

  setLevel(level: LogLevel) {
    this.level = level
  }

  getLevel() {
    return this.level
  }

  debug(event: string, context: DiagnosticContext = {}) {
    this.write('debug', event, context)
  }

  info(event: string, context: DiagnosticContext = {}) {
    this.write('info', event, context)
  }

  warn(event: string, context: DiagnosticContext = {}) {
    this.write('warn', event, context)
  }

  error(event: string, context: DiagnosticContext = {}) {
    this.write('error', event, context)
  }

  private write(
    level: 'debug' | 'info' | 'warn' | 'error',
    event: string,
    context: DiagnosticContext,
  ) {
    if (logLevelPriority[level] < logLevelPriority[this.level]) return
    const method = typeof console[level] === 'function' ? console[level] : console.log
    if (typeof method !== 'function') return
    try {
      method.call(console, `[sitepad] ${event}`, {
        timestamp: this.timestamp(),
        ...context,
      })
    } catch {
      // Diagnostics must never interrupt the offline write path.
    }
  }
}
