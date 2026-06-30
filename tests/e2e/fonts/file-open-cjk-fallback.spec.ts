import { test, expect } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

// Regression: opening a .fig with CJK text before `loadFonts` resolves used to
// render tofu because the renderer fell back to `r.textFont` (Inter) for the
// first frame. The fix removes the `drawText` fallback, gates the render loop
// on `fontsLoaded`, and ensures `openFileInNewTab` calls `ensureGraphFonts`
// so the document's fonts are preloaded before the first render.

test('first-frame CJK text does not render as tofu when fonts are still loading', async ({
  page
}) => {
  const canvas = new CanvasHelper(page)
  await page.goto('http://localhost:1420/?test&no-chrome&no-rulers')
  await canvas.waitForInit()

  // Force the renderer into the pre-load state: pretend `loadFonts` has not
  // resolved yet and the CJK fallback has not been registered.
  const prepared = await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const renderer = store.renderer
    if (!renderer) throw new Error('OpenPencil renderer not initialized')

    const { fontManager } = await import('/packages/core/src/text/fonts.ts')
    const manager = fontManager as typeof fontManager & {
      cjkFallbackFamilies: string[]
    }
    const originalFamilies = [...manager.cjkFallbackFamilies]
    const originalFontsLoaded = renderer.fontsLoaded
    const originalFontsLoadFailed = renderer.fontsLoadFailed

    manager.cjkFallbackFamilies = []
    renderer.fontsLoaded = false
    renderer.fontsLoadFailed = false

    const pageNode = store.graph.getNode(store.state.currentPageId)
    if (!pageNode) throw new Error('page not found')

    // Create a CJK text node that will be shaped on the next render.
    const text = store.graph.createNode('TEXT', pageNode.id, {
      name: 'CJK File Open',
      x: 80,
      y: 80,
      width: 320,
      height: 60,
      text: '上班打卡',
      fontSize: 32,
      fontFamily: 'Inter',
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, visible: true, opacity: 1 }]
    })

    store.requestRender()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)

    // The node should NOT have a cached text picture yet: the renderer is
    // gated on `fontsLoaded` so the render loop never ran for this frame.
    const cachedPicture = (store.graph.getNode(text.id) as { textPicture?: unknown }).textPicture

    return {
      nodeId: text.id,
      cachedPicture: Boolean(cachedPicture),
      originalFamilies,
      originalFontsLoaded,
      originalFontsLoadFailed
    }
  })

  expect(prepared.cachedPicture).toBe(false)

  // Now let the renderer settle: release the gate and let the real font load
  // finish. The node should pick up the CJK fallback on the next render.
  await page.evaluate(async () => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const renderer = store.renderer
    if (!renderer) throw new Error('OpenPencil renderer not initialized')

    const { fontManager } = await import('/packages/core/src/text/fonts.ts')
    const manager = fontManager as typeof fontManager & {
      cjkFallbackFamilies: string[]
    }

    // Restore the cached fallback list and let `loadFonts` complete normally
    // by re-running the bundled CJK fallback ensure path.
    await fontManager.ensureCJKFallback()
    renderer.fontsLoaded = true
    store.requestRender()
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)

    manager.cjkFallbackFamilies = [] // cleaned up for the next test
  })

  canvas.assertNoErrors()
})
