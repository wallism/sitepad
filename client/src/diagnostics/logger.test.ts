import { ConsoleAppLogger } from './logger'

describe('ConsoleAppLogger', () => {
  it('emits structured operational metadata', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const logger = new ConsoleAppLogger(true, () => '2026-09-03T00:00:00.000Z')

    logger.info('storage.write_committed', {
      inspectionId: 'inspection-1',
      revision: 4,
      durationMilliseconds: 12,
    })

    expect(consoleInfo).toHaveBeenCalledWith('[sitepad] storage.write_committed', {
      timestamp: '2026-09-03T00:00:00.000Z',
      inspectionId: 'inspection-1',
      revision: 4,
      durationMilliseconds: 12,
    })
  })

  it('stays silent when disabled', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logger = new ConsoleAppLogger(false)

    logger.error('storage.write_failed', { code: 'transaction_aborted' })

    expect(consoleError).not.toHaveBeenCalled()
  })

  it('filters by level and allows a temporary runtime override', () => {
    const consoleDebug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const logger = new ConsoleAppLogger('warn')

    logger.debug('debug.hidden')
    logger.info('info.hidden')
    logger.warn('warning.visible')
    expect(consoleDebug).not.toHaveBeenCalled()
    expect(consoleInfo).not.toHaveBeenCalled()
    expect(consoleWarn).toHaveBeenCalledOnce()

    logger.setLevel('debug')
    logger.debug('debug.visible')
    expect(logger.getLevel()).toBe('debug')
    expect(consoleDebug).toHaveBeenCalledOnce()
  })
})
