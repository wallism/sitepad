import { waitFor } from '@testing-library/react'
import type { AppLogger, DiagnosticContext } from '../diagnostics/logger'
import { cloneInspection, fixtureInspection } from '../features/inspection/fixture'
import { inspectionActions } from '../features/inspection/inspectionSlice'
import { FakeStorage } from '../test/fakes'
import { createAppStore } from './store'

class CapturingLogger implements AppLogger {
  records: Array<{ level: string; event: string; context?: DiagnosticContext }> = []

  debug = (event: string, context?: DiagnosticContext) => this.record('debug', event, context)
  info = (event: string, context?: DiagnosticContext) => this.record('info', event, context)
  warn = (event: string, context?: DiagnosticContext) => this.record('warn', event, context)
  error = (event: string, context?: DiagnosticContext) => this.record('error', event, context)

  private record(level: string, event: string, context?: DiagnosticContext) {
    this.records.push({ level, event, context })
  }
}

describe('persistence diagnostics', () => {
  it('logs the useful write lifecycle without logging inspection values', async () => {
    const marker = 'PRIVATE-NOTE-MARKER-7f29'
    const logger = new CapturingLogger()
    const storage = new FakeStorage()
    const app = createAppStore({ storage, logger })
    app.store.dispatch(inspectionActions.inspectionHydrated(cloneInspection(fixtureInspection)))

    app.store.dispatch(inspectionActions.itemNoteChanged({ itemId: 'smoke-hallway', note: marker }))
    app.store.dispatch(inspectionActions.flushRequested())

    await waitFor(() => expect(
      logger.records.some((record) => record.event === 'persistence.write_committed'),
    ).toBe(true))

    expect(logger.records.map((record) => record.event)).toEqual(expect.arrayContaining([
      'redux.action',
      'persistence.debounce_scheduled',
      'persistence.flush_requested',
      'persistence.write_started',
      'persistence.write_committed',
    ]))
    expect(JSON.stringify(logger.records)).not.toContain(marker)
    expect(logger.records.find((record) => record.event === 'persistence.write_committed')).toMatchObject({
      level: 'info',
      context: {
        inspectionId: fixtureInspection.inspectionId,
        revision: 1,
      },
    })
    app.dispose()
  })
})
