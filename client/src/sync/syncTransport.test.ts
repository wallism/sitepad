import { isRetryableHttpStatus, validateSyncResponse } from './syncTransport'

describe('validateSyncResponse', () => {
  it('accepts a closed acknowledged response for the requested operation', () => {
    expect(validateSyncResponse({
      kind: 'acknowledged',
      operationId: 'op-1',
      serverVersion: 2,
      server: { result: 'fail', note: 'Synthetic note' },
    }, 'op-1')).toEqual({
      kind: 'acknowledged',
      operationId: 'op-1',
      serverVersion: 2,
      server: { result: 'fail', note: 'Synthetic note' },
    })
  })

  it.each([
    ['mismatched operation', { kind: 'acknowledged', operationId: 'op-2', serverVersion: 2, server: { result: 'fail', note: '' } }],
    ['unknown kind', { kind: 'mystery', operationId: 'op-1' }],
    ['open schema', { kind: 'rejected', operationId: 'op-1', code: 'closed', message: 'No', extra: true }],
    ['invalid conflict', { kind: 'conflict', operationId: 'op-1', serverVersion: 2 }],
  ])('rejects %s as a protocol error', (_, response) => {
    expect(validateSyncResponse(response, 'op-1')).toBeNull()
  })
})

describe('isRetryableHttpStatus', () => {
  it.each([408, 429, 500, 503])('classifies %i as retryable', (status) => {
    expect(isRetryableHttpStatus(status)).toBe(true)
  })

  it.each([200, 400, 403, 409, 422])('does not classify %i as retryable', (status) => {
    expect(isRetryableHttpStatus(status)).toBe(false)
  })
})
