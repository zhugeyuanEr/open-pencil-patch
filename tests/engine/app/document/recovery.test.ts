import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const idbStore = new Map<string, Uint8Array>()

await mock.module('idb-keyval', () => ({
  get: async (key: string) => idbStore.get(key),
  set: async (key: string, value: Uint8Array) => {
    idbStore.set(key, value)
  },
  del: async (key: string) => {
    idbStore.delete(key)
  }
}))

const { createRecoveryActions } = await import('@/app/document/recovery')

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function makeDeps(overrides: Partial<Parameters<typeof createRecoveryActions>[0]> = {}) {
  const calls = { buildFigFile: 0 }
  const data = new Uint8Array([1, 2, 3, 4])
  const deps = {
    hasWritableSource: () => false,
    buildFigFile: async () => {
      calls.buildFigFile++
      return data
    },
    getDocKey: () => 'docA',
    ...overrides
  }
  return { deps, calls, data }
}

beforeEach(() => {
  idbStore.clear()
})

afterEach(() => {
  idbStore.clear()
})

describe('recovery: createRecoveryActions', () => {
  test('writes snapshot to IDB when no writable source', async () => {
    const { deps } = makeDeps()
    const recovery = createRecoveryActions(deps)
    recovery.writeRecoverySnapshot()
    await recovery.flush()
    expect(idbStore.has('doc-snapshot:docA')).toBe(true)
    const stored = idbStore.get('doc-snapshot:docA')
    expect(stored).toBeDefined()
    if (stored) expect(Array.from(stored)).toEqual([1, 2, 3, 4])
  })

  test('skips IDB write when writable source exists', async () => {
    const { deps, calls } = makeDeps({ hasWritableSource: () => true })
    const recovery = createRecoveryActions(deps)
    recovery.writeRecoverySnapshot()
    await recovery.flush()
    expect(calls.buildFigFile).toBe(0)
    expect(idbStore.size).toBe(0)
  })

  test('debounces multiple calls into a single snapshot', async () => {
    const { deps, calls } = makeDeps()
    const recovery = createRecoveryActions(deps)
    recovery.writeRecoverySnapshot()
    recovery.writeRecoverySnapshot()
    recovery.writeRecoverySnapshot()
    await recovery.flush()
    expect(calls.buildFigFile).toBe(1)
  })

  test('skips write when payload exceeds 5MB cap', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1)
    const { deps } = makeDeps({ buildFigFile: async () => big })
    const recovery = createRecoveryActions(deps)
    recovery.writeRecoverySnapshot()
    await recovery.flush()
    expect(idbStore.size).toBe(0)
  })

  test('clears the snapshot key', async () => {
    const { deps } = makeDeps()
    const recovery = createRecoveryActions(deps)
    recovery.writeRecoverySnapshot()
    await recovery.flush()
    expect(idbStore.has('doc-snapshot:docA')).toBe(true)
    await recovery.clearRecoverySnapshot()
    expect(idbStore.has('doc-snapshot:docA')).toBe(false)
  })

  test('reads back the snapshot bytes', async () => {
    const { deps, data } = makeDeps()
    const recovery = createRecoveryActions(deps)
    recovery.writeRecoverySnapshot()
    await recovery.flush()
    const read = await recovery.readRecoverySnapshot()
    expect(read).toBeDefined()
    if (read) expect(Array.from(read)).toEqual(Array.from(data))
  })

  test('different docKeys produce different keys', async () => {
    const { deps } = makeDeps()
    const recoveryA = createRecoveryActions(deps)
    recoveryA.writeRecoverySnapshot()
    await recoveryA.flush()
    expect(idbStore.has('doc-snapshot:docA')).toBe(true)

    const { deps: depsB } = makeDeps({ getDocKey: () => 'docB' })
    const recoveryB = createRecoveryActions(depsB)
    recoveryB.writeRecoverySnapshot()
    await recoveryB.flush()
    expect(idbStore.has('doc-snapshot:docB')).toBe(true)
    expect(idbStore.size).toBe(2)
  })

  test('reads from legacy key and removes it on first read', async () => {
    const legacy = new Uint8Array([9, 8, 7])
    idbStore.set('ai-recovery:docA', legacy)
    const { deps } = makeDeps()
    const recovery = createRecoveryActions(deps)
    const read = await recovery.readRecoverySnapshot()
    expect(read).toBeDefined()
    if (read) expect(Array.from(read)).toEqual([9, 8, 7])
    // Legacy entry must be gone so subsequent launches don't re-read it.
    expect(idbStore.has('ai-recovery:docA')).toBe(false)
  })

  test('clearRecoverySnapshot also drops the legacy entry', async () => {
    idbStore.set('doc-snapshot:docA', new Uint8Array([1]))
    idbStore.set('ai-recovery:docA', new Uint8Array([1]))
    const { deps } = makeDeps()
    const recovery = createRecoveryActions(deps)
    await recovery.clearRecoverySnapshot()
    expect(idbStore.has('doc-snapshot:docA')).toBe(false)
    expect(idbStore.has('ai-recovery:docA')).toBe(false)
  })

  test('dispose cancels pending snapshot', async () => {
    const { deps, calls } = makeDeps()
    const recovery = createRecoveryActions(deps)
    recovery.writeRecoverySnapshot()
    recovery.dispose()
    await sleep(50)
    expect(calls.buildFigFile).toBe(0)
    expect(idbStore.size).toBe(0)
  })
})