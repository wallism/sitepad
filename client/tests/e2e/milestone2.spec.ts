import { chromium, expect, test, type Page, type TestInfo } from '@playwright/test'

function databaseUrl(testInfo: TestInfo, suffix = '') {
  const safeName = `${testInfo.title}-${suffix}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `/?db=${safeName}`
}

async function expectReady(page: Page) {
  await expect(page.getByRole('heading', { name: '2/88 Trafalgar St' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('On this device')
}

async function answerAll(page: Page) {
  for (const card of await page.getByRole('article').all()) {
    await card.getByRole('button', { name: 'Pass' }).click()
  }
}

async function openTrace(page: Page) {
  const summary = page.getByText('Learning trace', { exact: true })
  if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click()
}

test('Complete flushes the captured revision and its outbox operation survives reload', async ({}, testInfo) => {
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    headless: true,
    baseURL: 'http://127.0.0.1:4173',
  })
  let page = context.pages()[0] ?? await context.newPage()
  const url = databaseUrl(testInfo)
  await page.goto(url)
  await expectReady(page)
  await answerAll(page)
  await openTrace(page)
  await page.getByRole('button', { name: 'Fail next send' }).click()

  await page.getByRole('button', { name: 'Complete & queue to send' }).click()

  await expect(page.getByRole('status')).toContainText('will retry')
  await expect(page.getByRole('button', { name: 'Pass' }).first()).toBeDisabled()
  const beforeReload = await page.evaluate(() => globalThis.__SITEPAD_TEST__.readOutbox())
  expect(beforeReload).toHaveLength(1)
  expect(beforeReload[0]).toMatchObject({
    status: 'retryable',
    attemptCount: 1,
    request: {
      inspectionId: 'inspection-trafalgar-2-88',
      baseVersion: 1,
      mine: { result: 'pass', note: '' },
    },
  })
  expect(JSON.parse(beforeReload[0].requestJson)).toEqual(beforeReload[0].request)

  const operationId = beforeReload[0].operationId
  await page.close()
  page = await context.newPage()
  await page.goto(url)
  await expect(page.getByRole('heading', { name: '2/88 Trafalgar St' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pass' }).first()).toBeDisabled()
  const afterReload = await page.evaluate(() => globalThis.__SITEPAD_TEST__.readOutbox())
  expect(afterReload).toHaveLength(1)
  expect(afterReload[0].operationId).toBe(operationId)
  await context.close()
})

test('a completion flush failure restores editing and creates no operation', async ({ page }, testInfo) => {
  await page.goto(databaseUrl(testInfo))
  await expectReady(page)
  await answerAll(page)
  await openTrace(page)
  await page.getByRole('button', { name: 'Fail next write' }).click()

  await page.getByRole('button', { name: 'Complete & queue to send' }).click()

  await expect(page.getByRole('status')).toContainText('Not completed')
  await expect(page.getByRole('button', { name: 'Pass' }).first()).toBeEnabled()
  expect(await page.evaluate(() => globalThis.__SITEPAD_TEST__.readOutbox())).toEqual([])
})

test('rapid duplicate completion produces one durable operation', async ({ page }, testInfo) => {
  await page.goto(databaseUrl(testInfo))
  await expectReady(page)
  await answerAll(page)
  await openTrace(page)
  await page.getByRole('button', { name: 'Fail next send' }).click()

  await page.getByRole('button', { name: 'Complete & queue to send' }).dblclick()

  await expect(page.getByRole('status')).toContainText('will retry')
  const operations = await page.evaluate(() => globalThis.__SITEPAD_TEST__.readOutbox())
  expect(operations).toHaveLength(1)
  const trace = await page.evaluate(() => globalThis.__SITEPAD_TEST__.getTrace())
  expect(trace.redux.filter((entry) => entry.type === 'inspection/completionRequested')).toHaveLength(1)
})

test('a lost local acknowledgement replays the exact operation after lease recovery', async ({ page }, testInfo) => {
  const requestBodies: string[] = []
  await page.route('http://127.0.0.1:5079/api/sync', async (route) => {
    const body = route.request().postData()!
    requestBodies.push(body)
    const request = JSON.parse(body) as { operationId: string; mine: { result: string; note: string } }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'acknowledged',
        operationId: request.operationId,
        serverVersion: 2,
        server: request.mine,
      }),
    })
  })
  await page.goto(databaseUrl(testInfo))
  await expectReady(page)
  await answerAll(page)
  await openTrace(page)
  await page.getByRole('button', { name: 'Fail next response write' }).click()
  await page.getByRole('button', { name: 'Complete & queue to send' }).click()

  await expect(page.getByRole('status')).toContainText('Sending')
  const sending = (await page.evaluate(() => globalThis.__SITEPAD_TEST__.readOutbox()))[0]
  expect(sending.status).toBe('sending')
  await page.evaluate((futureNow) => {
    Date.now = () => futureNow
    globalThis.__SITEPAD_TEST__.requestSync()
  }, sending.leaseExpiresAt! + 1)

  await expect(page.getByRole('status')).toContainText('Sent')
  expect(requestBodies).toHaveLength(2)
  expect(requestBodies[1]).toBe(requestBodies[0])
})

test('an expired claim makes the earlier response stale and duplicate sync triggers do not double-send', async ({ page }, testInfo) => {
  let releaseFirst!: () => void
  const firstMayFinish = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  let requestCount = 0
  await page.route('http://127.0.0.1:5079/api/sync', async (route) => {
    requestCount += 1
    await firstMayFinish
    const request = JSON.parse(route.request().postData()!) as { operationId: string; mine: { result: string; note: string } }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'acknowledged',
        operationId: request.operationId,
        serverVersion: 2,
        server: request.mine,
      }),
    })
  })
  await page.goto(databaseUrl(testInfo))
  await expectReady(page)
  await answerAll(page)
  await page.getByRole('button', { name: 'Complete & queue to send' }).click()
  await expect.poll(() => requestCount).toBe(1)

  await page.evaluate(() => {
    globalThis.__SITEPAD_TEST__.requestSync()
    globalThis.__SITEPAD_TEST__.requestSync()
  })
  await page.waitForTimeout(100)
  expect(requestCount).toBe(1)

  const first = (await page.evaluate(() => globalThis.__SITEPAD_TEST__.readOutbox()))[0]
  const secondClaim = await page.evaluate(
    ({ now }) => globalThis.__SITEPAD_TEST__.claimNext(now, 'replacement-claim', 30_000),
    { now: first.leaseExpiresAt! + 1 },
  )
  expect(secondClaim.kind).toBe('claimed')
  const stale = await page.evaluate(
    ({ operationId, claimId }) => globalThis.__SITEPAD_TEST__.recordTerminal(
      operationId,
      claimId,
      {
        kind: 'acknowledged',
        operationId,
        serverVersion: 2,
        server: { result: 'pass', note: '' },
      },
    ),
    { operationId: first.operationId, claimId: first.claimId! },
  )
  expect(stale.kind).toBe('stale')
  const committed = await page.evaluate(
    ({ operationId }) => globalThis.__SITEPAD_TEST__.recordTerminal(
      operationId,
      'replacement-claim',
      {
        kind: 'acknowledged',
        operationId,
        serverVersion: 2,
        server: { result: 'pass', note: '' },
      },
    ),
    { operationId: first.operationId },
  )
  expect(committed.kind).toBe('committed')
  releaseFirst()
  await expect.poll(async () => {
    const trace = await page.evaluate(() => globalThis.__SITEPAD_TEST__.getTrace())
    return trace.redux.some((entry) => entry.type === 'inspection/staleResponseIgnored')
  }).toBe(true)
})

test('a malformed server response becomes a retryable protocol error', async ({ page }, testInfo) => {
  await page.route('http://127.0.0.1:5079/api/sync', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"kind":"mystery"}' }))
  await page.goto(databaseUrl(testInfo))
  await expectReady(page)
  await answerAll(page)
  await page.getByRole('button', { name: 'Complete & queue to send' }).click()

  await expect(page.getByRole('status')).toContainText('will retry')
  const operation = (await page.evaluate(() => globalThis.__SITEPAD_TEST__.readOutbox()))[0]
  expect(operation).toMatchObject({
    status: 'retryable',
    lastError: { code: 'protocol_error' },
  })
})

test('a validated rejection remains durable and does not retry', async ({ page }, testInfo) => {
  let requests = 0
  await page.route('http://127.0.0.1:5079/api/sync', async (route) => {
    requests += 1
    const request = JSON.parse(route.request().postData()!) as { operationId: string }
    await route.fulfill({
      status: 422,
      contentType: 'application/json',
      body: JSON.stringify({
        kind: 'rejected',
        operationId: request.operationId,
        code: 'inspection_closed',
        message: 'The office closed this inspection.',
      }),
    })
  })
  await page.goto(databaseUrl(testInfo))
  await expectReady(page)
  await answerAll(page)
  await page.getByRole('button', { name: 'Complete & queue to send' }).click()

  await expect(page.getByRole('status')).toContainText('kept on this device')
  const operation = (await page.evaluate(() => globalThis.__SITEPAD_TEST__.readOutbox()))[0]
  expect(operation.status).toBe('rejected')
  await page.evaluate(() => globalThis.__SITEPAD_TEST__.requestSync())
  await page.waitForTimeout(100)
  expect(requests).toBe(1)
})
