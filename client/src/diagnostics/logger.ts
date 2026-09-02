export interface DiagnosticContext {
  actionType?: string
  code?: string
  currentRevision?: number
  databaseName?: string
  debounceMilliseconds?: number
  durableRevision?: number
  durationMilliseconds?: number
  fromVersion?: number
  inspectionId?: string
  lockName?: string
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

export const noopLogger: AppLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

export class ConsoleAppLogger implements AppLogger {
  constructor(
    private readonly enabled: boolean,
    private readonly timestamp: () => string = () => new Date().toISOString(),
  ) {}

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
    if (!this.enabled) return
    console[level](`[sitepad] ${event}`, {
      timestamp: this.timestamp(),
      ...context,
    })
  }
}
