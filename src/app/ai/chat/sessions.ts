import type { UIMessage } from 'ai'
import { get, set, del } from 'idb-keyval'
import { effectScope, shallowRef, watch, computed } from 'vue'

import {
  createDefaultStorage,
  deserializeStorage,
  docKeyForTab,
  generateChatId,
  isStorageTooLarge,
  serializeStorage,
  storageKey,
  type ChatDocKey,
  type ChatDocStorage,
  type ChatSession,
  type ChatSessionID
} from './persistence'

const DEBOUNCE_MS = 500

export interface ChatSessionsStore {
  docKey: ChatDocKey
  getCurrentSession(): ChatSession
  getAllSessions(): ChatSession[]
  getStorageSnapshot(): ChatDocStorage
  createSession(name?: string): ChatSession
  switchSession(id: ChatSessionID): void
  renameSession(id: ChatSessionID, name: string): void
  deleteSession(id: ChatSessionID): void
  setSessionMessages(id: ChatSessionID, messages: UIMessage[]): void
  setMessages(messages: UIMessage[]): void
  flush(): Promise<void>
  dispose(): Promise<void>
}

export interface CreateChatSessionsOptions {
  docKey: ChatDocKey
  initialStorage?: ChatDocStorage
}

export function createChatSessionsStore(options: CreateChatSessionsOptions): ChatSessionsStore {
  const scope = effectScope()
  const storage = shallowRef<ChatDocStorage>(options.initialStorage ?? createDefaultStorage())
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let saveRequested = false
  let saveInFlight = false
  let saveChain: Promise<void> = Promise.resolve()

  function scheduleSave() {
    if (debounceTimer) clearTimeout(debounceTimer)
    if (saveInFlight) {
      void performSave()
      return
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void performSave()
    }, DEBOUNCE_MS)
  }

  function performSave(): Promise<void> {
    saveRequested = true
    if (!saveInFlight) {
      saveInFlight = true
      saveChain = drainSaves().finally(() => {
        saveInFlight = false
      })
    }
    return saveChain
  }

  async function drainSaves(): Promise<void> {
    while (saveRequested) {
      saveRequested = false
      await writeStorage(options.docKey, storage.value)
    }
  }

  function cancelPending() {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  scope.run(() => {
    watch(storage, scheduleSave, { deep: true })
  })

  const currentSession = computed<ChatSession>(() => {
    const s = storage.value
    return s.sessions.find((x) => x.id === s.currentSessionId) ?? s.sessions[0]
  })

  const allSessions = computed<ChatSession[]>(() => storage.value.sessions)

  function getStorageSnapshot(): ChatDocStorage {
    return structuredClone(storage.value)
  }

  function createSession(name?: string): ChatSession {
    const id = generateChatId()
    const now = Date.now()
    const session: ChatSession = {
      id,
      name: name ?? defaultSessionName(storage.value.sessions),
      messages: [],
      createdAt: now,
      updatedAt: now
    }
    storage.value = {
      currentSessionId: id,
      sessions: [...storage.value.sessions, session]
    }
    void performSave()
    return session
  }

  function switchSession(id: ChatSessionID): void {
    const exists = storage.value.sessions.some((s) => s.id === id)
    if (!exists) return
    storage.value = { ...storage.value, currentSessionId: id }
    void performSave()
  }

  function renameSession(id: ChatSessionID, name: string): void {
    const trimmed = name.trim()
    if (!trimmed) return
    const sessions = storage.value.sessions.map((s) =>
      s.id === id ? { ...s, name: trimmed, updatedAt: Date.now() } : s
    )
    storage.value = { ...storage.value, sessions }
    void performSave()
  }

  function deleteSession(id: ChatSessionID): void {
    const current = storage.value
    if (current.sessions.length <= 1) return
    const remaining = current.sessions.filter((s) => s.id !== id)
    const currentSessionId =
      current.currentSessionId === id ? remaining[0].id : current.currentSessionId
    storage.value = { currentSessionId, sessions: remaining }
    void performSave()
  }

  function setSessionMessages(id: ChatSessionID, messages: UIMessage[]): void {
    const current = storage.value
    const exists = current.sessions.some((s) => s.id === id)
    if (!exists) return
    const nextMessages = cloneMessages(messages)
    const sessions = current.sessions.map((s) =>
      s.id === id ? { ...s, messages: nextMessages, updatedAt: Date.now() } : s
    )
    storage.value = { ...current, sessions }
  }

  function setMessages(messages: UIMessage[]): void {
    setSessionMessages(storage.value.currentSessionId, messages)
  }

  async function flush(): Promise<void> {
    cancelPending()
    await performSave()
  }

  async function dispose(): Promise<void> {
    await flush()
    scope.stop()
  }

  const store: ChatSessionsStore = {
    docKey: options.docKey,
    getCurrentSession: () => currentSession.value,
    getAllSessions: () => allSessions.value,
    getStorageSnapshot,
    createSession,
    switchSession,
    renameSession,
    deleteSession,
    setSessionMessages,
    setMessages,
    flush,
    dispose
  }
  return store
}

export async function loadChatSessionsStore(docKey: ChatDocKey): Promise<ChatSessionsStore> {
  const initial = (await loadChatDocStorage(docKey)) ?? undefined
  return createChatSessionsStore({ docKey, initialStorage: initial })
}

export async function loadChatDocStorage(docKey: ChatDocKey): Promise<ChatDocStorage | null> {
  let initial: ChatDocStorage | undefined
  try {
    const raw = await get<string>(storageKey(docKey))
    const parsed = raw ? deserializeStorage(raw) : null
    if (parsed) initial = parsed
  } catch (e) {
    console.warn('Failed to load chat sessions', e)
  }
  return initial ?? null
}

export async function deleteChatSessions(docKey: ChatDocKey): Promise<void> {
  try {
    await del(storageKey(docKey))
  } catch (e) {
    console.warn('Failed to delete chat sessions', e)
  }
}

function defaultSessionName(sessions: ChatSession[]): string {
  return `Session ${sessions.length + 1}`
}

async function writeStorage(docKey: ChatDocKey, storage: ChatDocStorage): Promise<boolean> {
  const serialized = serializeStorage(storage)
  if (isStorageTooLarge(serialized)) {
    console.warn('Chat storage exceeds 5MB; skipping IDB write')
    return false
  }
  try {
    await set(storageKey(docKey), serialized)
    return true
  } catch (e) {
    console.warn('Failed to persist chat sessions', e)
    return false
  }
}

function cloneMessages(messages: UIMessage[]): UIMessage[] {
  // oxlint-disable-next-line eslint-plugin-unicorn(prefer-structured-clone) -- AI SDK chat messages can include non-cloneable reactive internals; persisted messages are JSON data.
  return structuredClone(JSON.parse(JSON.stringify(messages)) as UIMessage[])
}

export { docKeyForTab, createDefaultStorage }
export type { ChatSession, ChatDocStorage, ChatSessionID, ChatDocKey } from './persistence'
