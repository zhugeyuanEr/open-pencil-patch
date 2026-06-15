import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  COMPONENT_LABEL_FONT_SIZE,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  LABEL_FONT_SIZE,
  SECTION_TITLE_FONT_SIZE,
  SIZE_FONT_SIZE
} from '#core/constants'
import type { SceneGraph, SceneNode } from '#core/scene-graph'
import type { FontFallbackScript } from '#core/text/fallbacks'
import { fontManager } from '#core/text/fonts'

export function getFontProvider(r: SkiaRenderer) {
  return r.isDestroyed() || !r.fontProvider ? null : r.fontProvider
}

const CJK_RE = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/u
const ARABIC_RE = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u

export async function loadFonts(
  r: SkiaRenderer,
  onFallbackFontsLoaded?: () => void
): Promise<void> {
  if (r.isDestroyed()) return
  r.fontProvider?.delete()
  r.fontProvider = r.ck.TypefaceFontProvider.Make()

  fontManager.attachProvider(r.ck, r.fontProvider)

  const fontData = await fontManager.loadFont(DEFAULT_FONT_FAMILY, 'Regular')
  const fallbackFamilies = await fontManager.ensureFallbackPack()
  if (r.isDestroyed()) return
  if (fontData) {
    r.fontProvider.registerFont(fontData, DEFAULT_FONT_FAMILY)
    const typeface = r.ck.Typeface.MakeFreeTypeFaceFromData(fontData)
    if (typeface) {
      r.textFont?.delete()
      r.labelFont?.delete()
      r.sizeFont?.delete()
      r.sectionTitleFont?.delete()
      r.componentLabelFont?.delete()
      r.textFont = new r.ck.Font(typeface, DEFAULT_FONT_SIZE)
      r.labelFont = new r.ck.Font(typeface, LABEL_FONT_SIZE)
      r.sizeFont = new r.ck.Font(typeface, SIZE_FONT_SIZE)
      r.sectionTitleFont = new r.ck.Font(typeface, SECTION_TITLE_FONT_SIZE)
      r.componentLabelFont = new r.ck.Font(typeface, COMPONENT_LABEL_FONT_SIZE)
      r.profiler.setTypeface(typeface)
    }
    r.fontMgr = r.ck.FontMgr.FromData(fontData) ?? null
  }

  r.fontsLoaded = true
  r.invalidateAllPictures()

  if (fallbackFamilies.cjk.length > 0 || fallbackFamilies.arabic.length > 0) {
    onFallbackFontsLoaded?.()
  }
}

export async function prepareForExport(
  r: SkiaRenderer,
  graph: SceneGraph,
  pageId: string,
  nodeIds: string[]
): Promise<() => void> {
  const { getTextMeasurer, setTextMeasurer, computeAllLayouts } = await import('#core/layout')

  const previousTextMeasurer = getTextMeasurer()
  setTextMeasurer((node, maxWidth) => r.measureTextNode(node, maxWidth))

  const fontKeys = fontManager.collectFontKeys(graph, nodeIds)
  await Promise.all(fontKeys.map(([family, style]) => fontManager.loadFont(family, style)))
  const fallbackScripts = collectFallbackScripts(graph, nodeIds)
  if (fallbackScripts.length > 0) await fontManager.ensureFallbackPack(fallbackScripts)

  computeAllLayouts(graph, pageId)

  return () => setTextMeasurer(previousTextMeasurer)
}

function collectFallbackScripts(graph: SceneGraph, nodeIds: string[]): FontFallbackScript[] {
  const scripts = new Set<FontFallbackScript>()
  const visit = (node: SceneNode) => {
    if (node.type === 'TEXT') {
      if (CJK_RE.test(node.text)) scripts.add('cjk')
      if (ARABIC_RE.test(node.text)) scripts.add('arabic')
    }
    for (const childId of node.childIds) {
      const child = graph.getNode(childId)
      if (child) visit(child)
    }
  }

  for (const id of nodeIds) {
    const node = graph.getNode(id)
    if (node) visit(node)
  }

  return [...scripts]
}
