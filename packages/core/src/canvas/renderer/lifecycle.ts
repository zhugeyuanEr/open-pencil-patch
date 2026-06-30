import type { SkiaRenderer } from '#core/canvas/renderer'
import { clearSubtreePictureCache } from '#core/canvas/renderer/state'
import { fontManager } from '#core/text/fonts'

function clearRetainedSceneState(r: SkiaRenderer): void {
  r.scenePicture?.delete()
  r.sceneBacking?.image.delete()
  r.sceneBacking = null
  r.sceneBackingBuild?.surface.delete()
  r.sceneBackingBuild = null
}

export function destroyRenderer(r: SkiaRenderer, options: { resetFonts?: boolean } = {}): void {
  if (r.destroyed) return
  r.destroyed = true

  deleteImageCache(r)
  deleteVectorCaches(r)
  deleteRendererPaints(r)
  deleteTextAndLabelFonts(r)
  deleteOverlayPaints(r)
  deleteFilterAndPictureCaches(r)
  clearSubtreePictureCache(r)
  clearRetainedSceneState(r)
  r._flashPaint?.delete()
  r.profiler.destroy()
  r.surface.delete()
  resetFontManagerIfRequested(options.resetFonts)
}

function deleteImageCache(r: SkiaRenderer): void {
  for (const img of r.imageCache.values()) img.delete()
  r.imageCache.clear()
}

function deleteVectorCaches(r: SkiaRenderer): void {
  for (const cache of [
    r.vectorPathCache,
    r.vectorStrokePathCache,
    r.vectorStrokeOutlineCache,
    r.fillGeometryCache,
    r.strokeGeometryCache
  ]) {
    for (const paths of cache.values()) {
      for (const p of paths) p.delete()
    }
    cache.clear()
  }
}

function deleteRendererPaints(r: SkiaRenderer): void {
  r.fillPaint.delete()
  r.strokePaint.delete()
  r.selectionPaint.delete()
  r.parentOutlinePaint.delete()
  r.snapPaint.delete()
  r.auxFill.delete()
  r.auxStroke.delete()
  r.opacityPaint.delete()
  r.effectLayerPaint.delete()
}

function deleteTextAndLabelFonts(r: SkiaRenderer): void {
  r.textFont?.delete()
  r.labelFont?.delete()
  r.sizeFont?.delete()
  r.sectionTitleFont?.delete()
  r.componentLabelFont?.delete()
  r.fontMgr?.delete()
  const fontProvider = r.fontProvider
  fontProvider?.delete()
  r.fontProvider = null
  r.fontsLoaded = false
  fontManager.detachProvider(fontProvider)
}

function deleteOverlayPaints(r: SkiaRenderer): void {
  r.rulerBgPaint.delete()
  r.rulerTickPaint.delete()
  r.rulerTextPaint.delete()
  r.rulerHlPaint.delete()
  r.rulerBadgePaint.delete()
  r.rulerLabelPaint.delete()
  r.penPathPaint.delete()
  r.penLiveStrokePaint.delete()
  r.penHandlePaint.delete()
  r.penVertexFill.delete()
  r.penVertexStroke.delete()
}

function deleteFilterAndPictureCaches(r: SkiaRenderer): void {
  for (const filter of r.imageFilterCache.values()) filter?.delete()
  r.imageFilterCache.clear()
  for (const filter of r.maskFilterCache.values()) filter?.delete()
  r.maskFilterCache.clear()
  for (const pic of r.nodePictureCache.values()) pic?.delete()
  r.nodePictureCache.clear()
}

/**
 * Clear the module-level font manager so a fresh surface mount starts from a
 * known state. Caller-controlled via the `destroyRenderer` `resetFonts` flag
 * — we deliberately keep the teardown decision in the lifecycle caller
 * (Vue surface `destroy()`, test teardown) instead of auto-resetting here.
 */
function resetFontManagerIfRequested(resetFonts: boolean | undefined): void {
  if (resetFonts) fontManager.reset()
}
