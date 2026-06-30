import { readFile } from 'node:fs/promises'

import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const USE_REAL_LLM = process.env.TEST_REAL_LLM === '1'
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? ''

let page: Page
let canvas: CanvasHelper
const modKey = process.platform === 'darwin' ? 'Meta' : 'Control'

test.describe.configure({ mode: 'serial' })
test.setTimeout(30_000)

test.beforeAll(async ({ browser }) => {
  test.setTimeout(30_000)
  page = await browser.newPage()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  canvas = new CanvasHelper(page)
  await canvas.waitForInit()

  if (!USE_REAL_LLM) {
    await injectMockTransport(page)
  }
})

test.afterAll(async () => {
  await page.close()
})

async function injectMockTransport(page: Page) {
  await page.evaluate(() => {
    const setChatTransport = window.openPencil?.setChatTransport
    if (!setChatTransport) throw new Error('Transport override not available')

    let msgCounter = 0

    setChatTransport(() => ({
      async sendMessages({
        messages
      }: {
        messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>
      }) {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user')
        const text = lastUser?.parts?.find((p) => p.type === 'text')?.text ?? ''
        const msgId = `mock-msg-${++msgCounter}`
        const lowerText = text.toLowerCase()
        const wantsTool = lowerText.includes('frame') || lowerText.includes('rectangle')

        if (lowerText.includes('missing agent')) {
          throw new Error(
            '"claude-agent-acp" is not installed. Install it with: npm i -g @agentclientprotocol/claude-agent-acp'
          )
        }

        return new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'start', messageId: msgId })

            if (wantsTool) {
              const toolCallId = `call-${msgId}`
              controller.enqueue({
                type: 'tool-input-start',
                toolCallId,
                toolName: 'create_shape'
              })
              controller.enqueue({
                type: 'tool-input-delta',
                toolCallId,
                inputTextDelta:
                  '{"type":"FRAME","x":100,"y":100,"width":200,"height":150,"name":"Card"}'
              })
              controller.enqueue({
                type: 'tool-input-available',
                toolCallId,
                toolName: 'create_shape',
                input: { type: 'FRAME', x: 100, y: 100, width: 200, height: 150, name: 'Card' }
              })
              controller.enqueue({
                type: 'tool-output-available',
                toolCallId,
                toolName: 'create_shape',
                output: {
                  id: '0:99',
                  type: 'FRAME',
                  x: 100,
                  y: 100,
                  width: 200,
                  height: 150,
                  name: 'Card'
                }
              })
            }

            const words = wantsTool
              ? ['Created', 'a', 'frame', 'called', '"Card".']
              : `I'll help you with: "${text}". Here's a mock response.`.split(' ')

            controller.enqueue({ type: 'text-start', id: 'text-1' })
            for (const word of words) {
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

function chatTab() {
  return page.getByRole('tab', { name: /^AI$/ })
}

function designTab() {
  return page.getByRole('tab', { name: /^(Design|设计)$/ })
}

function chatInput() {
  return page.getByTestId('chat-input')
}

function apiKeyInput() {
  return page.getByTestId('api-key-input')
}

async function sendChatMessage(text: string) {
  await chatInput().fill(text)
  await chatInput().press('Enter')
  await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 5000 })
  if (!USE_REAL_LLM) {
    await expect(page.getByText(`I'll help you with: "${text}"`, { exact: false })).toBeVisible({
      timeout: 5000
    })
  }
}

async function openSessionMenu() {
  await page.getByTestId('chat-session-toggle').click()
  await expect(page.getByTestId('chat-session-dropdown')).toBeVisible()
}

async function switchChatSession(name: string) {
  await openSessionMenu()
  await page
    .getByTestId('chat-session-item')
    .filter({ hasText: name })
    .getByText(name, { exact: true })
    .click()
}

test('⌘J switches to AI tab', async () => {
  await designTab().waitFor()
  await page.keyboard.press(`${modKey}+j`)
  await expect(chatTab()).toHaveAttribute('data-state', 'active')
})

test('⌘J switches back to Design tab', async () => {
  await page.keyboard.press(`${modKey}+j`)
  await expect(designTab()).toHaveAttribute('data-state', 'active')
})

test('clicking AI tab shows provider setup when no key set', async () => {
  await chatTab().click()
  await expect(apiKeyInput()).toBeVisible()
  await expect(page.getByTestId('provider-setup')).toBeVisible()
  await expect(page.getByTestId('provider-custom-model')).toBeHidden()
})

test('saving API key shows chat interface', async () => {
  const key = USE_REAL_LLM ? OPENROUTER_KEY : 'sk-or-test-key-12345'
  await apiKeyInput().fill(key)
  await page.getByTestId('api-key-save').click()

  await expect(chatInput()).toBeVisible()
  await expect(page.getByTestId('chat-empty-state')).toBeVisible()
})

test('empty input has disabled send button', async () => {
  const sendButton = page.locator('button[type="submit"]')
  await expect(sendButton).toBeDisabled()
})

test('typing enables send button', async () => {
  await chatInput().fill('Make a red rectangle')
  const sendButton = page.locator('button[type="submit"]')
  await expect(sendButton).toBeEnabled()
})

test('Enter submits message and clears input', async () => {
  await chatInput().fill('Hello there')
  await chatInput().press('Enter')

  await expect(page.getByText('Hello there', { exact: true })).toBeVisible({ timeout: 5000 })
  await expect(chatInput()).toHaveValue('')
})

test('assistant responds', async () => {
  if (USE_REAL_LLM) {
    await expect(page.locator('.chat-markdown, [class*="rounded-tl-md"]').first()).toBeVisible({
      timeout: 30000
    })
  } else {
    await expect(page.getByText('mock response', { exact: false })).toBeVisible({ timeout: 5000 })
  }
})

test('model selector is visible and clickable', async () => {
  const trigger = page.getByTestId('chat-model-selector')
  await expect(trigger).toBeVisible()
  await trigger.click()

  await expect(page.getByRole('option', { name: /Claude Sonnet 4\.6/ })).toBeVisible()
  await expect(page.getByText('Best for design')).toBeVisible()
  await expect(page.getByText('Free').first()).toBeVisible()

  await page.getByRole('option', { name: /Claude Sonnet 4\.6/ }).click()
  await expect(page.getByRole('option', { name: /Claude Sonnet 4\.6/ })).toBeHidden()
})

test('tool calls render in assistant message', async () => {
  await chatInput().fill('Create a frame')
  await chatInput().press('Enter')

  if (USE_REAL_LLM) {
    await expect(page.locator('.chat-markdown, [class*="rounded-tl-md"]').first()).toBeVisible({
      timeout: 30000
    })
  } else {
    await expect(page.getByText('Create Shape')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Done')).toBeVisible()
    await expect(page.getByText('Created a frame', { exact: false })).toBeVisible()
  }
})

test('switching tabs preserves chat', async () => {
  const selectedModel = page.getByRole('option', { name: /Claude Sonnet 4\.6/ })
  if (await selectedModel.isVisible().catch(() => false)) {
    await selectedModel.click()
  }
  await designTab().click({ timeout: 10000 })
  await expect(designTab()).toHaveAttribute('data-state', 'active')

  await chatTab().click()
  await expect(page.getByText('Hello there', { exact: true })).toBeVisible({ timeout: 10000 })
})

test('chat sessions persist across reload', async () => {
  test.skip(USE_REAL_LLM, 'session persistence E2E uses the mock chat transport')

  await openSessionMenu()
  await page.getByTestId('chat-session-new').click()
  await expect(page.getByTestId('chat-empty-state')).toBeVisible()

  await sendChatMessage('Second session marker')
  await switchChatSession('New session')
  await expect(page.getByText('Hello there', { exact: true })).toBeVisible({ timeout: 5000 })
  await expect(page.getByText('Second session marker', { exact: true })).toBeHidden()

  await switchChatSession('Session 2')
  await expect(page.getByText('Second session marker', { exact: true })).toBeVisible({
    timeout: 5000
  })

  await page.reload()
  await canvas.waitForInit()
  await injectMockTransport(page)
  await chatTab().click()

  await expect(chatInput()).toBeVisible()
  await expect(page.getByText('Second session marker', { exact: true })).toBeVisible({
    timeout: 10000
  })
  await switchChatSession('New session')
  await expect(page.getByText('Hello there', { exact: true })).toBeVisible({ timeout: 5000 })
})

test('chat export menu copies and downloads markdown', async () => {
  test.skip(USE_REAL_LLM, 'export E2E relies on deterministic mock chat content')

  await page.getByTestId('chat-export-toggle').click()
  await page.getByTestId('chat-export-copy-markdown').click()
  const markdown = await page.evaluate(() => navigator.clipboard.readText())
  expect(markdown).toContain('# AI chat export')
  expect(markdown).toContain('## user')
  expect(markdown).toContain('Hello there')

  await page.getByTestId('chat-export-toggle').click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('chat-export-download-markdown').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^openpencil-chat-\d{8}-\d{4}\.md$/)
  const path = await download.path()
  if (path) {
    const downloadedMarkdown = await readFile(path, 'utf8')
    expect(downloadedMarkdown).toContain('Hello there')
  }
})

test('Ctrl+S after AI completion clears the IDB recovery snapshot', async () => {
  test.skip(USE_REAL_LLM, 'recovery snapshot E2E uses the mock chat transport')

  await page.evaluate(async () => {
    const idb = (await import('idb-keyval')) as { del: (k: string) => Promise<void> }
    const keys: string[] = [
      'doc-snapshot:fp:test',
      'doc-snapshot:dn:test',
      'doc-snapshot:tab:test',
      // Belt-and-suspenders for legacy state from ≤ 0.13.x builds.
      'ai-recovery:fp:test',
      'ai-recovery:dn:test',
      'ai-recovery:tab:test'
    ]
    for (const k of keys) await idb.del(k)
  })

  await sendChatMessage('Create a frame')

  await page.waitForTimeout(1500)

  const beforeSave = await page.evaluate(async () => {
    const idb = (await import('idb-keyval')) as { keys: () => Promise<string[]> }
    return (await idb.keys()).filter((k) => k.startsWith('doc-snapshot:') || k.startsWith('ai-recovery:'))
  })
  expect(beforeSave.length).toBeGreaterThan(0)

  await page.evaluate(() => {
    const mockWritable = {
      write: async () => undefined,
      close: async () => undefined
    }
    const mockHandle = {
      createWritable: async () => mockWritable
    }
    window.showSaveFilePicker = async () => mockHandle as FileSystemFileHandle
  })
  await page.keyboard.press(`${modKey}+s`)
  await page.waitForTimeout(500)

  const afterSave = await page.evaluate(async () => {
    const idb = (await import('idb-keyval')) as { keys: () => Promise<string[]> }
    return (await idb.keys()).filter((k) => k.startsWith('doc-snapshot:') || k.startsWith('ai-recovery:'))
  })
  expect(afterSave).toHaveLength(0)
})

test('document tabs keep separate chat context', async () => {
  test.skip(USE_REAL_LLM, 'document persistence E2E uses the mock chat transport')

  await sendChatMessage('First document marker')
  await page.keyboard.press(`${modKey}+N`)
  await expect(page.getByTestId('tabbar-tab')).toHaveCount(2)
  await chatTab().click()
  await expect(page.getByTestId('chat-empty-state')).toBeVisible({ timeout: 5000 })

  await sendChatMessage('Second document marker')
  await page.getByTestId('tabbar-tab').nth(0).click()
  await expect(page.getByText('First document marker', { exact: true })).toBeVisible({
    timeout: 5000
  })
  await expect(page.getByText('Second document marker', { exact: true })).toBeHidden()

  await page.getByTestId('tabbar-tab').nth(1).click()
  await expect(page.getByText('Second document marker', { exact: true })).toBeVisible({
    timeout: 5000
  })
  await expect(page.getByText('First document marker', { exact: true })).toBeHidden()
})

test('OpenRouter accepts a custom model ID from provider settings', async () => {
  const customModel = 'meta-llama/llama-3.3-70b-instruct'

  await page.keyboard.press('Escape')
  await page.getByTestId('provider-settings-trigger').click()
  const customModelInput = page.getByTestId('provider-settings-custom-model')
  await expect(customModelInput).toBeVisible()
  await customModelInput.fill(customModel)
  await page.getByTestId('provider-settings-done').click()

  await expect(page.getByTestId('chat-custom-model-label')).toContainText(customModel)
  await expect(page.getByTestId('chat-model-selector')).toBeHidden()

  await page.getByTestId('provider-settings-trigger').click()
  await page.getByTestId('provider-settings-custom-model').fill('')
  await page.getByTestId('provider-settings-done').click()

  await expect(page.getByTestId('chat-model-selector')).toBeVisible()
})

test('transport errors show an actionable toast', async () => {
  await chatInput().fill('Trigger missing agent error')
  await chatInput().press('Enter')

  await expect(
    page.getByTestId('toast-item').filter({
      hasText: 'Install it with: npm i -g @agentclientprotocol/claude-agent-acp'
    })
  ).toBeVisible({ timeout: 5000 })
})

test('"Get API key" link opens external URL via window.open', async () => {
  await page.evaluate("localStorage.removeItem('open-pencil:ai-key:openrouter')")
  await page.reload()
  await canvas.waitForInit()
  await chatTab().click()

  const link = page.getByTestId('api-key-get-link')
  await expect(link).toBeVisible()

  // Intercept window.open to verify it's called with the right URL
  const openedUrls: string[] = []
  await page.exposeFunction('mockWindowOpen', (url: string) => openedUrls.push(url))
  await page.evaluate(() => {
    window.openPencil ??= {}
    window.openPencil.test = { ...window.openPencil.test, savedOpen: window.open }
    window.open = (url: string | URL) => {
      window.mockWindowOpen?.(String(url))
      return null
    }
  })

  await link.click()

  await expect(() => {
    expect(openedUrls.length).toBeGreaterThan(0)
    expect(openedUrls[0]).toMatch(/^https:\/\//)
  }).toPass({ timeout: 3000 })

  // Restore
  await page.evaluate(() => {
    const savedOpen = window.openPencil?.test?.savedOpen
    if (savedOpen) window.open = savedOpen
  })
})
