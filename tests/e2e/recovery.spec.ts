import { expect, test, type Page, type Browser } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

test.describe.configure({ mode: 'serial' })
test.setTimeout(30_000)

let page: Page
let canvas: CanvasHelper

async function injectMockTransport(page: Page) {
  await page.evaluate(() => {
    const setChatTransport = window.openPencil?.setChatTransport
    if (!setChatTransport) throw new Error('Transport override not available')

    let msgCounter = 0
    setChatTransport(() => ({
      async sendMessages({ messages }: { messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }> }) {
        void messages
        const msgId = `mock-msg-${++msgCounter}`
        return new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'start', messageId: msgId })
            controller.enqueue({
              type: 'tool-input-start',
              toolCallId: `call-${msgId}`,
              toolName: 'create_shape'
            })
            controller.enqueue({
              type: 'tool-input-delta',
              toolCallId: `call-${msgId}`,
              inputTextDelta: '{"type":"FRAME","x":100,"y":100,"width":200,"height":150,"name":"Recovery"}'
            })
            controller.enqueue({
              type: 'tool-input-available',
              toolCallId: `call-${msgId}`,
              toolName: 'create_shape',
              input: { type: 'FRAME', x: 100, y: 100, width: 200, height: 150, name: 'Recovery' }
            })
            controller.enqueue({
              type: 'tool-output-available',
              toolCallId: `call-${msgId}`,
              toolName: 'create_shape',
              output: { id: '0:99', type: 'FRAME', x: 100, y: 100, width: 200, height: 150, name: 'Recovery' }
            })
            controller.enqueue({ type: 'text-start', id: 'text-1' })
            for (const word of `Created a frame called "Recovery".`.split(' ')) {
              controller.enqueue({ type: 'text-delta', id: 'text-1', delta: word + ' ' })
            }
            controller.enqueue({ type: 'text-end', id: 'text-1' })
            controller.enqueue({ type: 'finish', finishReason: 'stop' })
            controller.close()
          }
        })
      },
      async reconnectToStream() {
        return null
      }
    }))
  })
}

async function clearAllSnapshots(page: Page) {
  await page.evaluate(async () => {
    const idb = (await import('idb-keyval')) as { keys: () => Promise<string[]>; del: (k: string) => Promise<void> }
    const keys = await idb.keys()
    for (const k of keys) {
      // Cover both the new prefix and the legacy AI-specific key from
      // builds ≤ 0.13.x so a stateful IDB doesn't bleed between specs.
      if (k.startsWith('doc-snapshot:') || k.startsWith('ai-recovery:')) await idb.del(k)
    }
  })
}

async function setupApiKey(page: Page) {
  await page.evaluate(() => {
    Reflect.deleteProperty(window, 'showSaveFilePicker')
  })
  await page.getByTestId('api-key-input').fill('sk-or-test-key-12345')
  await page.getByTestId('api-key-save').click()
  await page.getByTestId('chat-empty-state').waitFor()
}

async function setupWithMockTransport(browser: Browser) {
  page = await browser.newPage()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()
  await injectMockTransport(page)
  await page.getByRole('tab', { name: /^AI$/ }).click()
  await setupApiKey(page)
  await clearAllSnapshots(page)
}

test.beforeEach(async ({ browser }) => {
  await setupWithMockTransport(browser)
})

test.afterEach(async () => {
  if (page) await page.close()
})

test.afterAll(async () => {
  // Defensive sweep so a failing test never leaks `doc-snapshot:` /
  // `ai-recovery:` entries that would surface in unrelated specs sharing
  // the same browser context.
  const browserContext = page?.context()
  if (!browserContext) return
  for (const p of browserContext.pages()) {
    if (!p.isClosed()) await clearAllSnapshots(p)
  }
})

test('AI completion writes IDB recovery snapshot for new docs', async () => {
  await page.getByTestId('chat-input').fill('Create a frame')
  await page.getByTestId('chat-input').press('Enter')

  await expect(page.getByText('Created a frame', { exact: false })).toBeVisible({ timeout: 5000 })

  await page.waitForTimeout(1500)

  const keys = await page.evaluate(async () => {
    const idb = (await import('idb-keyval')) as { keys: () => Promise<string[]> }
    return await idb.keys()
  })
  expect(keys.some((k) => k.startsWith('doc-snapshot:') || k.startsWith('ai-recovery:'))).toBe(true)
})

test('recovery banner appears after reload and restore works', async () => {
  await page.getByTestId('chat-input').fill('Create a frame')
  await page.getByTestId('chat-input').press('Enter')
  await expect(page.getByText('Created a frame', { exact: false })).toBeVisible({ timeout: 5000 })
  await page.waitForTimeout(1500)

  await page.reload({ waitUntil: 'domcontentloaded' })
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  const banner = page.getByTestId('recovery-banner')
  await expect(banner).toBeVisible({ timeout: 5000 })

  await page.getByTestId('recovery-banner-restore').click()
  await expect(banner).toBeHidden({ timeout: 5000 })

  const snapshotCleared = await page.evaluate(async () => {
    const idb = (await import('idb-keyval')) as { keys: () => Promise<string[]> }
    const keys = await idb.keys()
    return !keys.some((k) => k.startsWith('doc-snapshot:') || k.startsWith('ai-recovery:'))
  })
  expect(snapshotCleared).toBe(true)
})

test('discard clears recovery snapshot', async () => {
  await page.getByTestId('chat-input').fill('Create a frame')
  await page.getByTestId('chat-input').press('Enter')
  await expect(page.getByText('Created a frame', { exact: false })).toBeVisible({ timeout: 5000 })
  await page.waitForTimeout(1500)

  await page.reload({ waitUntil: 'domcontentloaded' })
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  await expect(page.getByTestId('recovery-banner')).toBeVisible({ timeout: 5000 })
  await page.getByTestId('recovery-banner-discard').click()

  await expect(page.getByTestId('recovery-banner')).toBeHidden({ timeout: 5000 })

  const keys = await page.evaluate(async () => {
    const idb = (await import('idb-keyval')) as { keys: () => Promise<string[]> }
    return await idb.keys()
  })
  expect(keys.some((k) => k.startsWith('doc-snapshot:') || k.startsWith('ai-recovery:'))).toBe(false)
})