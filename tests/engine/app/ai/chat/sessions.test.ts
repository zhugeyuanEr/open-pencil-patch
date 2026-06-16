import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { UIMessage } from 'ai'
import { computed, ref } from 'vue'

const store = new Map<string, string>()
const getDelays = new Map<string, Promise<void>>()
let blockNextSet = false
let blockedSetStarted: (() => void) | null = null
let releaseBlockedSet: (() => void) | null = null

await mock.module('idb-keyval', () => ({
  get: async (key: string) => {
    const delay = getDelays.get(key)
    if (delay) await delay
    return store.get(key)
  },
  set: async (key: string, value: string) => {
    if (blockNextSet) {
      blockNextSet = false
      blockedSetStarted?.()
      await new Promise<void>((resolve) => {
        releaseBlockedSet = resolve
      })
    }
    store.set(key, value)
  },
  del: async (key: string) => {
    store.delete(key)
  }
}))

const { createChatSessionsStore, loadChatSessionsStore, deleteChatSessions } =
  await import('@/app/ai/chat/sessions')
const { createChatSessionManager } = await import('@/app/ai/chat/transports')
const { docKeyForTab, createDefaultStorage, serializeStorage, storageKey } =
  await import('@/app/ai/chat/persistence')

function makeMessage(role: 'user' | 'assistant', text: string, id: string): UIMessage {
  return { id, role, parts: [{ type: 'text', text }] }
}

const sampleMessages: UIMessage[] = [
  makeMessage('user', 'hello', 'm1'),
  makeMessage('assistant', 'hi there', 'm2')
]

beforeEach(() => {
  store.clear()
  getDelays.clear()
  blockNextSet = false
  blockedSetStarted = null
  releaseBlockedSet = null
})

afterEach(() => {
  store.clear()
  getDelays.clear()
  releaseBlockedSet?.()
})

describe('createChatSessionsStore', () => {
  test('initializes with a default session', () => {
    const store = createChatSessionsStore({ docKey: 'tab:1' })
    expect(store.getAllSessions()).toHaveLength(1)
    expect(store.getCurrentSession().messages).toEqual([])
  })

  test('uses provided initialStorage when supplied', () => {
    const initial = createDefaultStorage()
    initial.sessions[0].messages = sampleMessages
    const s = createChatSessionsStore({ docKey: 'tab:1', initialStorage: initial })
    expect(s.getCurrentSession().messages).toEqual(sampleMessages)
  })

  test('createSession appends and switches', () => {
    const s = createChatSessionsStore({ docKey: 'tab:1' })
    const initialId = s.getCurrentSession().id
    const created = s.createSession('Topic B')
    expect(s.getAllSessions()).toHaveLength(2)
    expect(s.getCurrentSession().id).toBe(created.id)
    expect(created.name).toBe('Topic B')
    expect(initialId).not.toBe(created.id)
  })

  test('switchSession changes currentSessionId', () => {
    const s = createChatSessionsStore({ docKey: 'tab:1' })
    const a = s.createSession('A')
    const b = s.createSession('B')
    s.switchSession(a.id)
    expect(s.getCurrentSession().id).toBe(a.id)
    s.switchSession(b.id)
    expect(s.getCurrentSession().id).toBe(b.id)
  })

  test('switchSession ignores unknown id', () => {
    const s = createChatSessionsStore({ docKey: 'tab:1' })
    const before = s.getCurrentSession().id
    s.switchSession('does-not-exist')
    expect(s.getCurrentSession().id).toBe(before)
  })

  test('renameSession updates name and updatedAt', async () => {
    const s = createChatSessionsStore({ docKey: 'tab:1' })
    const id = s.getCurrentSession().id
    const before = s.getCurrentSession().updatedAt
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve()
      }, 5)
    })
    s.renameSession(id, '  New Name  ')
    expect(s.getCurrentSession().name).toBe('New Name')
    expect(s.getCurrentSession().updatedAt).toBeGreaterThan(before)
  })

  test('renameSession ignores empty input', () => {
    const s = createChatSessionsStore({ docKey: 'tab:1' })
    const id = s.getCurrentSession().id
    s.renameSession(id, '   ')
    expect(s.getCurrentSession().name).not.toBe('')
    expect(s.getCurrentSession().id).toBe(id)
  })

  test('deleteSession removes the session and shifts current', () => {
    const s = createChatSessionsStore({ docKey: 'tab:1' })
    const a = s.createSession('A')
    const b = s.createSession('B')
    s.switchSession(a.id)
    s.deleteSession(b.id)
    expect(s.getAllSessions()).toHaveLength(2)
    expect(s.getCurrentSession().id).toBe(a.id)
  })

  test('deleteSession keeps at least one session', () => {
    const s = createChatSessionsStore({ docKey: 'tab:1' })
    const onlyId = s.getCurrentSession().id
    s.deleteSession(onlyId)
    expect(s.getAllSessions()).toHaveLength(1)
  })

  test('setMessages writes into the current session and bumps updatedAt', async () => {
    const s = createChatSessionsStore({ docKey: 'tab:1' })
    const id = s.getCurrentSession().id
    const before = s.getCurrentSession().updatedAt
    await new Promise<void>((resolve) => {
      setTimeout(() => {
        resolve()
      }, 5)
    })
    s.setMessages(sampleMessages)
    expect(s.getCurrentSession().id).toBe(id)
    expect(s.getCurrentSession().messages).toEqual(sampleMessages)
    expect(s.getCurrentSession().updatedAt).toBeGreaterThan(before)
  })

  test('setMessages clones the provided array', () => {
    const s = createChatSessionsStore({ docKey: 'tab:1' })
    const messages = [...sampleMessages]
    s.setMessages(messages)
    messages.push(makeMessage('user', 'later mutation', 'm3'))
    expect(s.getCurrentSession().messages).toEqual(sampleMessages)
  })

  test('setSessionMessages updates an inactive session by id', () => {
    const s = createChatSessionsStore({ docKey: 'tab:1' })
    const firstId = s.getCurrentSession().id
    const second = s.createSession('Second')
    s.setSessionMessages(firstId, sampleMessages)
    expect(s.getCurrentSession().id).toBe(second.id)
    expect(s.getCurrentSession().messages).toEqual([])
    expect(s.getAllSessions().find((session) => session.id === firstId)?.messages).toEqual(
      sampleMessages
    )
  })

  test('flush writes to IDB immediately', async () => {
    const s = createChatSessionsStore({ docKey: 'tab:1' })
    s.setMessages(sampleMessages)
    await s.flush()
    expect(store.has('chat-sessions:tab:1')).toBe(true)
  })

  test('flush drains changes queued while an IDB write is pending', async () => {
    const s = createChatSessionsStore({ docKey: 'tab:pending' })
    const first = [makeMessage('user', 'first', 'first')]
    const second = [makeMessage('user', 'second', 'second')]
    const setStarted = new Promise<void>((resolve) => {
      blockedSetStarted = resolve
    })

    s.setMessages(first)
    blockNextSet = true
    const flushing = s.flush()
    await setStarted

    s.setMessages(second)
    releaseBlockedSet?.()
    await flushing

    const reloaded = await loadChatSessionsStore('tab:pending')
    expect(reloaded.getCurrentSession().messages).toEqual(second)
  })

  test('messages are preserved across reload via loadChatSessionsStore', async () => {
    const s = createChatSessionsStore({ docKey: 'tab:reload' })
    s.setMessages(sampleMessages)
    await s.flush()
    s.dispose()

    const reloaded = await loadChatSessionsStore('tab:reload')
    expect(reloaded.getCurrentSession().messages).toEqual(sampleMessages)
  })

  test('deleteChatSessions removes the IDB key', async () => {
    const s = createChatSessionsStore({ docKey: 'tab:del' })
    s.setMessages(sampleMessages)
    await s.flush()
    expect(store.has('chat-sessions:tab:del')).toBe(true)
    await deleteChatSessions('tab:del')
    expect(store.has('chat-sessions:tab:del')).toBe(false)
  })

  test('docKeyForTab helper integration', () => {
    expect(docKeyForTab('tab-1', '/x.fig', 'X')).toBe('fp:/x.fig')
    expect(
      createChatSessionsStore({ docKey: docKeyForTab('tab-2', null, 'Untitled') }).docKey
    ).toBe('tab:tab-2')
  })
})

describe('createChatSessionManager', () => {
  test('uses the editor store file path for document keys', async () => {
    const activeStore = makeEditorStore('/a/design.fig', 'Same Name')
    const manager = createTestManager(() => activeStore)
    manager.setOverrideTransport(createMockTransport)

    await manager.ensureChat()

    expect(manager.sessions.value?.docKey).toBe('fp:/a/design.fig')
  })

  test('keeps same-named saved files in separate stores', async () => {
    let activeStore = makeEditorStore('/a/design.fig', 'Design')
    const manager = createTestManager(() => activeStore)
    manager.setOverrideTransport(createMockTransport)

    const chatA = await manager.ensureChat()
    chatA?.messages.push(makeMessage('user', 'from A', 'a'))
    await manager.flush()

    activeStore = makeEditorStore('/b/design.fig', 'Design')
    const chatB = await manager.ensureChat()
    chatB?.messages.push(makeMessage('user', 'from B', 'b'))
    await manager.flush()

    expect(store.get(storageKey('fp:/a/design.fig'))).toContain('from A')
    expect(store.get(storageKey('fp:/b/design.fig'))).toContain('from B')
  })

  test('migrates a temporary document key to file path when the target is empty', async () => {
    const activeStore = makeEditorStore(null, 'Draft')
    const manager = createTestManager(() => activeStore)
    manager.setOverrideTransport(createMockTransport)

    const chat = await manager.ensureChat()
    chat?.messages.push(...sampleMessages)
    await manager.flush()

    activeStore.getFilePath = () => '/saved/draft.fig'
    await manager.ensureChat()
    await manager.flush()

    expect(manager.sessions.value?.docKey).toBe('fp:/saved/draft.fig')
    expect(manager.sessions.value?.getCurrentSession().messages).toEqual(sampleMessages)
    expect(store.has(storageKey('dn:Draft'))).toBe(false)
    expect(store.has(storageKey('fp:/saved/draft.fig'))).toBe(true)
  })

  test('rekeys the same store when an opened file path becomes available', async () => {
    const activeStore = makeMutableEditorStore(null, 'Untitled')
    const manager = createTestManager(() => activeStore)
    manager.setOverrideTransport(createMockTransport)

    const chat = await manager.ensureChat()
    chat?.messages.push(...sampleMessages)
    await manager.flush()

    activeStore.state.documentName = 'Opened Design'
    activeStore.setFilePath('/saved/opened.fig')
    await manager.ensureChat()
    await manager.flush()

    expect(manager.sessions.value?.docKey).toBe('fp:/saved/opened.fig')
    expect(manager.sessions.value?.getCurrentSession().messages).toEqual(sampleMessages)
    expect(store.has(storageKey('tab:unknown'))).toBe(false)
    expect(store.has(storageKey('fp:/saved/opened.fig'))).toBe(true)
  })

  test('does not overwrite an existing file-path chat during migration', async () => {
    const target = createDefaultStorage()
    target.sessions[0].messages = [makeMessage('assistant', 'existing target', 'target')]
    store.set(storageKey('fp:/saved/draft.fig'), serializeStorage(target))

    const activeStore = makeEditorStore(null, 'Draft')
    const manager = createTestManager(() => activeStore)
    manager.setOverrideTransport(createMockTransport)

    const chat = await manager.ensureChat()
    chat?.messages.push(makeMessage('user', 'temporary source', 'source'))
    await manager.flush()

    activeStore.getFilePath = () => '/saved/draft.fig'
    await manager.ensureChat()

    expect(manager.sessions.value?.getCurrentSession().messages).toEqual(
      target.sessions[0].messages
    )
    expect(store.get(storageKey('dn:Draft'))).toContain('temporary source')
  })

  test('ignores stale session loads when switching documents quickly', async () => {
    const slowStorage = createDefaultStorage()
    slowStorage.sessions[0].messages = [makeMessage('user', 'slow', 'slow')]
    const fastStorage = createDefaultStorage()
    fastStorage.sessions[0].messages = [makeMessage('user', 'fast', 'fast')]
    store.set(storageKey('fp:/slow.fig'), serializeStorage(slowStorage))
    store.set(storageKey('fp:/fast.fig'), serializeStorage(fastStorage))

    let releaseSlowLoad: (() => void) | null = null
    getDelays.set(
      storageKey('fp:/slow.fig'),
      new Promise<void>((resolve) => {
        releaseSlowLoad = resolve
      })
    )

    let activeStore = makeEditorStore('/slow.fig', 'Design')
    const manager = createTestManager(() => activeStore)
    manager.setOverrideTransport(createMockTransport)

    const slowEnsure = manager.ensureChat()
    activeStore = makeEditorStore('/fast.fig', 'Design')
    const fastChat = await manager.ensureChat()
    releaseSlowLoad?.()
    await slowEnsure

    expect(manager.sessions.value?.docKey).toBe('fp:/fast.fig')
    expect(fastChat?.messages).toEqual(fastStorage.sessions[0].messages)
  })
})

type TestEditorStore = {
  state: { documentName: string }
  getFilePath: () => string | null
}

function makeEditorStore(filePath: string | null, documentName: string): TestEditorStore {
  return {
    state: { documentName },
    getFilePath: () => filePath
  }
}

function makeMutableEditorStore(filePath: string | null, documentName: string) {
  let currentFilePath = filePath
  return {
    state: { documentName },
    getFilePath: () => currentFilePath,
    setFilePath: (path: string | null) => {
      currentFilePath = path
    }
  }
}

function createTestManager(getStore: () => TestEditorStore) {
  return createChatSessionManager({
    isConfigured: computed(() => true),
    isACPProvider: computed(() => false),
    providerID: ref('openrouter'),
    apiKey: ref('test-key'),
    modelID: ref('test-model'),
    customModelID: ref(''),
    customBaseURL: ref(''),
    customAPIType: ref('responses'),
    maxOutputTokens: ref(1000),
    getActiveEditorStore: getStore
  })
}

function createMockTransport() {
  return {
    async sendMessages() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'finish', finishReason: 'stop' })
          controller.close()
        }
      })
    },
    async reconnectToStream() {
      return null
    }
  }
}
