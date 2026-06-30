import { useTimeoutFn } from '@vueuse/core'
import { get, set, del } from 'idb-keyval'

const RECOVERY_PREFIX = 'doc-snapshot:'
// Older builds (≤ 0.13.x) stored snapshots under an AI-specific key. Keep
// reading them so an upgrade doesn't silently drop user data, but always
// write under the new key. The legacy entries are deleted on first read.
const LEGACY_RECOVERY_PREFIX = 'ai-recovery:'
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024
const DEBOUNCE_MS = 500

// rIC lets serialization of the full scene graph run when the main thread
// is otherwise idle — keeps AI completion snappy on large docs. Falls back
// to a 0ms setTimeout yield when rIC isn't available (SSR, non-browser
// test runners, etc.).
function requestIdle(): Promise<void> {
  return new Promise((resolve) => {
    const ric = (
      globalThis as { requestIdleCallback?: (cb: () => void) => void }
    ).requestIdleCallback
    if (ric) ric(() => resolve())
    else setTimeout(resolve, 0)
  })
}

export interface RecoveryActions {
  writeRecoverySnapshot(): Promise<void>
  readRecoverySnapshot(): Promise<Uint8Array | undefined>
  clearRecoverySnapshot(): Promise<void>
  flush(): Promise<void>
  dispose(): void
}

export interface CreateRecoveryOptions {
  hasWritableSource: () => boolean
  buildFigFile: () => Promise<Uint8Array>
  getDocKey: () => string
}

function recoveryKey(docKey: string): string {
  return `${RECOVERY_PREFIX}${docKey}`
}

function legacyRecoveryKey(docKey: string): string {
  return `${LEGACY_RECOVERY_PREFIX}${docKey}`
}

export function createRecoveryActions({
  hasWritableSource,
  buildFigFile,
  getDocKey
}: CreateRecoveryOptions): RecoveryActions {
  // `disposed` is mutated from `dispose()` and read across await points; keep
  // it as a boolean so the type checker doesn't narrow it to a literal `false`
  // and flag the cross-await guards as always-falsy.
  let disposed: boolean = false

  function reportFailure(op: 'write' | 'read' | 'delete', e: unknown) {
    // Recovery is a best-effort, background feature. A failed IDB write must
    // never turn into a user-visible toast — the user did nothing to trigger
    // it and there is nothing they can do about it. Log only.
    console.warn(`Recovery: IDB ${op} failed:`, e)
  }

  async function snapshotToIDB(): Promise<void> {
    if (hasWritableSource()) return
    await requestIdle()
    if (disposed) return
    let data: Uint8Array
    try {
      data = await buildFigFile()
    } catch (e) {
      reportFailure('write', e)
      return
    }
    if (data.byteLength > MAX_SNAPSHOT_BYTES) {
      // Over cap: clear so the banner doesn't reappear next launch against a
      // snapshot we already know is bogus.
      try {
        await del(recoveryKey(getDocKey()))
      } catch (e) {
        reportFailure('delete', e)
      }
      return
    }
    try {
      await set(recoveryKey(getDocKey()), data)
    } catch (e) {
      reportFailure('write', e)
    }
  }

  function performSnapshot(): void {
    if (disposed) return
    void snapshotToIDB()
  }

  const { start: scheduleSnapshot, stop: cancelSnapshot } = useTimeoutFn(
    performSnapshot,
    DEBOUNCE_MS,
    { immediate: false }
  )

  async function writeRecoverySnapshot(): Promise<void> {
    if (disposed) return
    cancelSnapshot()
    scheduleSnapshot()
  }

  async function readRecoverySnapshot(): Promise<Uint8Array | undefined> {
    const docKey = getDocKey()
    try {
      const current = await get<Uint8Array>(recoveryKey(docKey))
      if (current) return current
      // Fall back to the legacy key from pre-0.14 builds. Migrate by reading
      // once and dropping the old entry, so the next launch reads the new key.
      const legacy = await get<Uint8Array>(legacyRecoveryKey(docKey))
      if (legacy) {
        try {
          await del(legacyRecoveryKey(docKey))
        } catch (e) {
          reportFailure('delete', e)
        }
      }
      return legacy
    } catch (e) {
      reportFailure('read', e)
      return undefined
    }
  }

  async function clearRecoverySnapshot(): Promise<void> {
    const docKey = getDocKey()
    try {
      await del(recoveryKey(docKey))
    } catch (e) {
      reportFailure('delete', e)
    }
    // Best-effort cleanup of any legacy entry. Don't propagate failures
    // here — `del` on a missing key is already a no-op in idb-keyval.
    try {
      await del(legacyRecoveryKey(docKey))
    } catch (e) {
      reportFailure('delete', e)
    }
  }

  async function flush(): Promise<void> {
    cancelSnapshot()
    await snapshotToIDB()
  }

  function dispose(): void {
    disposed = true
    cancelSnapshot()
  }

  return {
    writeRecoverySnapshot,
    readRecoverySnapshot,
    clearRecoverySnapshot,
    flush,
    dispose
  }
}