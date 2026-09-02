export function retryDelayMilliseconds(attemptCount: number) {
  return Math.min(2 ** Math.max(0, attemptCount - 1) * 1_000, 30_000)
}
