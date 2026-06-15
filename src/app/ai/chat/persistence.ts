import type { UIMessage } from 'ai'

export type ChatSessionID = string
export type ChatDocKey = string

export interface ChatSession {
  id: ChatSessionID
  name: string
  messages: UIMessage[]
  createdAt: number
  updatedAt: number
}

export interface ChatDocStorage {
  currentSessionId: ChatSessionID
  sessions: ChatSession[]
}

const STORAGE_PREFIX = 'chat-sessions:'
const MAX_MESSAGES_BYTES = 5 * 1024 * 1024

export function storageKey(docKey: ChatDocKey): string {
  return `${STORAGE_PREFIX}${docKey}`
}

export function docKeyForTab(
  tabId: string,
  filePath?: string | null,
  documentName?: string
): ChatDocKey {
  if (filePath) return `fp:${filePath}`
  const name = documentName?.trim()
  if (name && name !== 'Untitled') return `dn:${name}`
  return `tab:${tabId}`
}

export function createDefaultStorage(): ChatDocStorage {
  const now = Date.now()
  const id = generateChatId()
  return {
    currentSessionId: id,
    sessions: [
      {
        id,
        name: 'New session',
        messages: [],
        createdAt: now,
        updatedAt: now
      }
    ]
  }
}

export function serializeStorage(storage: ChatDocStorage): string {
  return JSON.stringify(storage)
}

export function deserializeStorage(json: string): ChatDocStorage | null {
  try {
    const parsed = JSON.parse(json)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.currentSessionId !== 'string' ||
      !Array.isArray(parsed.sessions)
    ) {
      return null
    }
    const sessions: ChatSession[] = []
    for (const raw of parsed.sessions) {
      if (!raw || typeof raw !== 'object') continue
      if (
        typeof raw.id !== 'string' ||
        typeof raw.name !== 'string' ||
        typeof raw.createdAt !== 'number' ||
        typeof raw.updatedAt !== 'number' ||
        !Array.isArray(raw.messages)
      ) {
        continue
      }
      sessions.push({
        id: raw.id,
        name: raw.name,
        messages: raw.messages as UIMessage[],
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt
      })
    }
    if (sessions.length === 0) return null
    const currentSessionId = sessions.some((s) => s.id === parsed.currentSessionId)
      ? parsed.currentSessionId
      : sessions[0].id
    return { currentSessionId, sessions }
  } catch {
    return null
  }
}

export function isStorageTooLarge(serialized: string): boolean {
  return new TextEncoder().encode(serialized).length > MAX_MESSAGES_BYTES
}

export function generateChatId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  throw new Error('No secure random source available')
}
