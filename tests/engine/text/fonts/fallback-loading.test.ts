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
