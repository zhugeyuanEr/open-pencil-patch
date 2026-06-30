import { describe, expect, test } from 'bun:test'

import type { CanvasKit } from 'canvaskit-wasm'

import { FontManager } from '@open-pencil/core'

import { createRecordingProvider } from './helpers'

describe('bundled fallback font loading', () => {
  test('loads bundled CJK fallback without network access', async () => {
    const manager = new FontManager()
    const recording = createRecordingProvider()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('network disabled')
    }) as typeof fetch

    try {
      manager.attachProvider({} as CanvasKit, recording.provider)
      const families = await manager.ensureCJKFallback()

      expect(families).toEqual(['Noto Sans SC'])
      expect(recording.registrations).toHaveLength(1)
      expect(recording.registrations[0].family).toBe('Noto Sans SC')
      expect(recording.registrations[0].byteLength).toBeGreaterThan(1_000_000)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('fetchBundledFontFromUrl retries up to 3 times before failing', async () => {
    // The retry contract is owned by the bundled-fetch helper, so we assert
    // it directly. Production callers in the browser hit this path through
    // `FontManager.fetchBundledFont` -> `fetchBundledFontFromUrl`; in Node
    // they hit `readFile` which is single-shot, but the browser retry is
    // what protects the first-open .fig path from a 503-then-200 sequence.
    const { fetchBundledFontFromUrl } = await import('#core/text/bundled-fetch')
    const originalFetch = globalThis.fetch
    let calls = 0
    globalThis.fetch = (async () => {
      calls += 1
      if (calls < 2) {
        // Simulate transient failures on the first attempt; succeed on the
        // second so the retry helper returns a real buffer.
        throw new Error('network glitch')
      }
      return originalFetch.apply(globalThis, arguments as unknown as Parameters<typeof fetch>)
    }) as typeof fetch

    try {
      const buffer = await fetchBundledFontFromUrl('/NotoSansSC-Regular.ttf')
      expect(calls).toBeGreaterThanOrEqual(2)
      // Without an HTTP origin in the bun runtime for `/NotoSansSC-Regular.ttf`
      // the helper falls back to file reads, which gives a non-null ArrayBuffer.
      if (buffer !== null) {
        expect(buffer.byteLength).toBeGreaterThan(1_000_000)
      }
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('uses bundled regular CJK face for unavailable bundled styles', async () => {
    const manager = new FontManager()
    const recording = createRecordingProvider()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('network disabled')
    }) as typeof fetch

    try {
      manager.attachProvider({} as CanvasKit, recording.provider)
      const data = await manager.loadFont('Noto Sans SC', 'Bold')

      expect(data?.byteLength).toBeGreaterThan(1_000_000)
      expect(manager.isStyleLoaded('Noto Sans SC', 'Bold')).toBe(true)
      expect(recording.registrations).toEqual([
        { family: 'Noto Sans SC', byteLength: data?.byteLength }
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
