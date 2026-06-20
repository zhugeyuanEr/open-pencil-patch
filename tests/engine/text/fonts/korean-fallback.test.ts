import { describe, test, expect } from 'bun:test'

import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm'

import {
  FontManager,
  fontFallbackManifest,
  fontManager
} from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'

function createRecordingProvider() {
  const registrations: Array<{ family: string; byteLength: number }> = []
  const provider = {
    registerFont(data: ArrayBuffer, family: string) {
      registrations.push({ family, byteLength: data.byteLength })
    }
  } as TypefaceFontProvider
  return { provider, registrations }
}

describe('Korean fallback (#291)', () => {
  test('Noto Sans KR is in the CJK fallback manifest', () => {
    const manifest = fontFallbackManifest('X11; Linux x86_64')
    expect(manifest.cjk.remoteFamilies).toContain('Noto Sans KR')
  })

  test('bundled Noto Sans KR font data loads from disk', async () => {
    const buffer = await fontManager.fetchBundledFont('/NotoSansKR-Regular.ttf')
    const data = expectDefined(buffer, 'Korean font buffer')
    expect(data).toBeInstanceOf(ArrayBuffer)
    expect(data.byteLength).toBeGreaterThan(100_000)
    const view = new DataView(data)
    const magic = view.getUint32(0)
    expect([0x00010000, 0x4f54544f]).toContain(magic)
  })

  test('loadFont resolves Noto Sans KR from bundled assets without network', async () => {
    const manager = new FontManager()
    const recording = createRecordingProvider()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('network disabled')
    }) as typeof fetch

    try {
      manager.attachProvider({} as CanvasKit, recording.provider)
      const data = await manager.loadFont('Noto Sans KR', 'Regular')

      expectDefined(data, 'bundled Korean font buffer')
      expect(data?.byteLength).toBeGreaterThan(100_000)
      expect(recording.registrations).toEqual([
        { family: 'Noto Sans KR', byteLength: data?.byteLength }
      ])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('ensureCJKFallback picks up Noto Sans KR when no local font and no network', async () => {
    const manager = new FontManager()
    const recording = createRecordingProvider()
    const originalFetch = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('network disabled')
    }) as typeof fetch

    try {
      manager.attachProvider({} as CanvasKit, recording.provider)
      const families = await manager.ensureCJKFallback()

      expect(families).toContain('Noto Sans KR')
      expect(recording.registrations.map((r) => r.family)).toContain('Noto Sans KR')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
