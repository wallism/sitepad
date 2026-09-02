import { retryDelayMilliseconds } from './retryPolicy'

describe('retryDelayMilliseconds', () => {
  it.each([
    [1, 1_000],
    [2, 2_000],
    [3, 4_000],
    [4, 8_000],
    [5, 16_000],
    [6, 30_000],
    [20, 30_000],
  ])('backs off attempt %i to %i ms', (attempt, expected) => {
    expect(retryDelayMilliseconds(attempt)).toBe(expected)
  })
})
