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
})
