import { describe, expect, test } from 'bun:test'

import {
  createDefaultStorage,
  deserializeStorage,
  docKeyForTab,
  isStorageTooLarge,
  serializeStorage,
  storageKey,
  type ChatSession
} from '@/app/ai/chat/persistence'

describe('docKeyForTab', () => {
  test('prefers file path when available', () => {
    expect(docKeyForTab('tab-1', '/home/user/fig.fig', 'design')).toBe('fp:/home/user/fig.fig')
  })

  test('falls back to document name when path missing', () => {
    expect(docKeyForTab('tab-2', null, 'My Design')).toBe('dn:My Design')
  })

  test('falls back to tab id when neither is usable', () => {
    expect(docKeyForTab('tab-3', null, undefined)).toBe('tab:tab-3')
    expect(docKeyForTab('tab-3', null, '')).toBe('tab:tab-3')
  })

  test('treats default Untitled documents as tab-scoped', () => {
    expect(docKeyForTab('tab-4', null, 'Untitled')).toBe('tab:tab-4')
  })
})

describe('storageKey', () => {
  test('prefixes the doc key', () => {
    expect(storageKey('tab:1')).toBe('chat-sessions:tab:1')
  })
})

describe('createDefaultStorage', () => {
  test('creates one default session and selects it', () => {
    const storage = createDefaultStorage()
    expect(storage.sessions).toHaveLength(1)
    expect(storage.currentSessionId).toBe(storage.sessions[0].id)
    expect(storage.sessions[0].messages).toEqual([])
    expect(storage.sessions[0].name).toBe('New session')
  })
})

describe('serializeStorage / deserializeStorage', () => {
  test('round-trips a storage payload', () => {
    const storage = createDefaultStorage()
    const sample: ChatSession = {
      ...storage.sessions[0],
      id: 's1',
      name: 'Hello',
      createdAt: 1000,
      updatedAt: 2000,
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }]
    }
    const out = { currentSessionId: 's1', sessions: [sample] }
    const json = serializeStorage(out)
    const parsed = deserializeStorage(json)
    expect(parsed).toEqual(out)
  })

  test('rejects malformed json', () => {
    expect(deserializeStorage('not json')).toBeNull()
  })

  test('rejects non-object input', () => {
    expect(deserializeStorage('null')).toBeNull()
    expect(deserializeStorage('"string"')).toBeNull()
  })

  test('rejects payload missing currentSessionId', () => {
    expect(deserializeStorage('{"sessions":[]}')).toBeNull()
  })

  test('rejects payload missing sessions', () => {
    expect(deserializeStorage('{"currentSessionId":"x"}')).toBeNull()
  })

  test('falls back to first session id when currentSessionId is missing', () => {
    const json = JSON.stringify({
      currentSessionId: 'unknown',
      sessions: [
        { id: 'a', name: 'A', messages: [], createdAt: 1, updatedAt: 1 },
        { id: 'b', name: 'B', messages: [], createdAt: 1, updatedAt: 1 }
      ]
    })
    expect(deserializeStorage(json)?.currentSessionId).toBe('a')
  })

  test('returns null when no valid sessions remain', () => {
    const json = JSON.stringify({ currentSessionId: 'x', sessions: [null, 'bad'] })
    expect(deserializeStorage(json)).toBeNull()
  })
})

describe('isStorageTooLarge', () => {
  test('detects oversize payloads', () => {
    expect(isStorageTooLarge('a'.repeat(6 * 1024 * 1024))).toBe(true)
    expect(isStorageTooLarge('small')).toBe(false)
  })

  test('counts utf-8 bytes instead of utf-16 code units', () => {
    expect(isStorageTooLarge('😀'.repeat(2 * 1024 * 1024))).toBe(true)
  })
})
