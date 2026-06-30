import { describe, expect, test } from 'bun:test'

import { fontManager } from '@open-pencil/core/text/fonts'

describe('FontManager.reset', () => {
  test('clears loaded families, CJK/Arabic fallbacks, and registered render families', () => {
    fontManager.markLoaded('Inter', 'Regular', new ArrayBuffer(8))
    fontManager.setCJKFallbackFamily('Noto Sans SC')
    fontManager.setArabicFallbackFamily('Noto Naskh Arabic')

    try {
      expect(fontManager.isStyleLoaded('Inter', 'Regular')).toBe(true)
      expect(fontManager.getCJKFallbackFamilies()).toContain('Noto Sans SC')
      expect(fontManager.getArabicFallbackFamilies()).toContain('Noto Naskh Arabic')

      fontManager.reset()

      expect(fontManager.isStyleLoaded('Inter', 'Regular')).toBe(false)
      expect(fontManager.getCJKFallbackFamilies()).toEqual([])
      expect(fontManager.getArabicFallbackFamilies()).toEqual([])
    } finally {
      // Restore the module singleton to a known empty state for the next test.
      fontManager.reset()
    }
  })
})
