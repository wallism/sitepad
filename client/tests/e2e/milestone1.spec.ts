import { chromium, expect, test, type Page, type TestInfo } from '@playwright/test'

function databaseUrl(testInfo: TestInfo, suffix = '') {
  const safeName = `${testInfo.title}-${suffix}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `/?db=${safeName}`
}

async function expectReady(page: Page) {
  await expect(page.getByRole('heading', { name: '2/88 Trafalgar St' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('On this device')
}

function firstItem(page: Page) {
  return page.getByRole('article', { name: /smoke alarm — hallway/i })
}

async function openLearningTrace(page: Page) {
  const summary = page.getByText('Learning trace', { exact: true })
  if (await summary.getAttribute('aria-expanded') !== 'true') await summary.click()
}

test('commits an edit before claiming durability and restores it from a persistent profile', async ({}, testInfo) => {
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    headless: true,
    baseURL: 'http://127.0.0.1:4173',
  })
  let page = context.pages()[0] ?? await context.newPage()
  const url = databaseUrl(testInfo)
  await page.goto(url)
  await expectReady(page)

  await page.evaluate(() => globalThis.__SITEPAD_TEST__.setWriteDelay(450))
  await firstItem(page).getByRole('button', { name: 'Fail' }).click()
  await expect(page.getByRole('status')).toContainText('Saving')
  await expect(page.getByRole('status')).toContainText('On this device')

  const note = 'Synthetic check: alarm is not interconnected.'
  await firstItem(page).getByRole('textbox', { name: 'Failure note' }).fill(note)
  await openLearningTrace(page)
  await page.getByRole('button', { name: 'Flush now' }).click()
  await expect(page.getByRole('status')).toContainText('On this device')

  const trace = await page.evaluate(() => globalThis.__SITEPAD_TEST__.getTrace())
  expect(trace.redux.map((entry) => entry.type)).toEqual(expect.arrayContaining([
    'inspection/itemResultChanged',
    'inspection/persistenceStarted',
    'inspection/persistenceCommitted',
    'inspection/itemNoteChanged',
    'inspection/flushRequested',
  ]))
  expect(trace.indexedDb.filter((entry) => entry.event === 'transactionCommitted')).toHaveLength(2)

  await page.close()
  page = await context.newPage()
  await page.goto(url)
  await expectReady(page)
  await expect(firstItem(page).getByRole('button', { name: 'Fail' })).toHaveAttribute('aria-pressed', 'true')
  await expect(firstItem(page).getByRole('textbox', { name: 'Failure note' })).toHaveValue(note)
  await context.close()
})

test('an aborted write never reaches On this device and Retry commits the current revision', async ({ page }, testInfo) => {
  await page.goto(databaseUrl(testInfo))
  await expectReady(page)
  const before = await page.evaluate(() => globalThis.__SITEPAD_TEST__.readCommitted())

  await page.evaluate(() => globalThis.__SITEPAD_TEST__.failNextWrite())
  await firstItem(page).getByRole('button', { name: 'Fail' }).click()
  await openLearningTrace(page)
  await page.getByRole('button', { name: 'Flush now' }).click()

  await expect(page.getByRole('status')).toContainText('Not saved')
  await expect(page.getByRole('status')).not.toContainText('On this device')
  const afterFailure = await page.evaluate(() => globalThis.__SITEPAD_TEST__.readCommitted())
  expect(afterFailure?.localRevision).toBe(before?.localRevision)
  expect(afterFailure?.items[0].result).toBe('unanswered')
  const failedTrace = await page.evaluate(() => globalThis.__SITEPAD_TEST__.getTrace())
  expect(failedTrace.indexedDb.at(-1)).toMatchObject({
    event: 'transactionAborted',
    revision: 1,
    code: 'transaction_aborted',
  })

  await page.getByRole('button', { name: 'Retry' }).click()
  await expect(page.getByRole('status')).toContainText('On this device')
  const afterRetry = await page.evaluate(() => globalThis.__SITEPAD_TEST__.readCommitted())
  expect(afterRetry?.items[0].result).toBe('fail')
})

test('closing before a delayed write starts does not create a durability claim', async ({ context }, testInfo) => {
  const url = databaseUrl(testInfo)
  let page = await context.newPage()
  await page.goto(url)
  await expectReady(page)
  await page.evaluate(() => globalThis.__SITEPAD_TEST__.setWriteDelay(5_000))

  await firstItem(page).getByRole('button', { name: 'Fail' }).click()
  await openLearningTrace(page)
  await page.getByRole('button', { name: 'Flush now' }).click()
  await expect(page.getByRole('status')).toContainText('Saving')
  await page.close()

  page = await context.newPage()
  await page.goto(url)
  await expectReady(page)
  await expect(firstItem(page).getByRole('button', { name: 'Fail' })).toHaveAttribute('aria-pressed', 'false')
})

test('a second tab stays read-only until the writer closes and the tab reloads', async ({ context }, testInfo) => {
  const url = databaseUrl(testInfo)
  const writer = await context.newPage()
  await writer.goto(url)
  await expectReady(writer)

  const secondary = await context.newPage()
  await secondary.goto(url)
  await expect(secondary.getByText('Sitepad is already open in another tab')).toBeVisible()
  await writer.close()
  await expect(secondary.getByText('Sitepad is already open in another tab')).toBeVisible()

  await secondary.reload()
  await expectReady(secondary)
})

test('fails closed when Web Locks are unavailable', async ({ context }, testInfo) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  })
  const page = await context.newPage()
  await page.goto(databaseUrl(testInfo))

  await expect(page.getByText('This browser cannot safely edit offline')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fail' })).toHaveCount(0)
})

test('a hydration failure retries without erasing committed work', async ({ context }, testInfo) => {
  const url = databaseUrl(testInfo)
  let page = await context.newPage()
  await page.goto(url)
  await expectReady(page)
  await firstItem(page).getByRole('button', { name: 'Fail' }).click()
  const note = 'Synthetic committed note survives a failed open.'
  await firstItem(page).getByRole('textbox', { name: 'Failure note' }).fill(note)
  await openLearningTrace(page)
  await page.getByRole('button', { name: 'Flush now' }).click()
  await expect(page.getByRole('status')).toContainText('On this device')
  await page.close()

  page = await context.newPage()
  await page.goto(`${url}&failOpenOnce=1`)
  await expect(page.getByText('Couldn’t open this device’s work')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fail' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Retry' }).click()

  await expectReady(page)
  await expect(firstItem(page).getByRole('textbox', { name: 'Failure note' })).toHaveValue(note)
})

test('versionchange closes the app connection and a blocked upgrade stays read-only', async ({ page }, testInfo) => {
  await page.goto(databaseUrl(testInfo))
  await expectReady(page)
  await page.evaluate(() => globalThis.__SITEPAD_TEST__.openBlockingConnection())

  const outcome = await page.evaluate(() => globalThis.__SITEPAD_TEST__.requestUpgrade(2))
  expect(outcome).toBe('blocked')
  await expect(page.getByText('Storage update blocked — close other Sitepad tabs')).toBeVisible()
  await expect(page.getByText('Close other Sitepad tabs, then reload to finish the storage update.')).toBeVisible()
  const trace = await page.evaluate(() => globalThis.__SITEPAD_TEST__.getTrace())
  expect(trace.indexedDb.map((entry) => entry.event)).toEqual(expect.arrayContaining([
    'databaseVersionChanged',
    'upgradeBlocked',
  ]))
  await page.evaluate(() => globalThis.__SITEPAD_TEST__.closeBlockingConnection())
})

test('browser diagnostics are useful without exposing inspection values', async ({ page }, testInfo) => {
  const marker = 'PRIVATE-BROWSER-NOTE-3b81'
  const messages: string[] = []
  page.on('console', (message) => {
    if (message.text().startsWith('[sitepad]')) messages.push(message.text())
  })
  await page.goto(databaseUrl(testInfo))
  await expectReady(page)

  await firstItem(page).getByRole('button', { name: 'Fail' }).click()
  await firstItem(page).getByRole('textbox', { name: 'Failure note' }).fill(marker)
  await openLearningTrace(page)
  await page.getByRole('button', { name: 'Flush now' }).click()
  await expect(page.getByRole('status')).toContainText('On this device')

  await expect.poll(() => messages.some((message) => message.includes('app.edit_lock_acquired'))).toBe(true)
  await expect.poll(() => messages.some((message) => message.includes('storage.transaction_committed'))).toBe(true)
  expect(messages.some((message) => message.includes('persistence.flush_requested'))).toBe(true)
  expect(messages.join('\n')).not.toContain(marker)
})
