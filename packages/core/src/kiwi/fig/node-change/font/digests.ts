import type { SceneGraph } from '#core/scene-graph'
import { fontManager, normalizeFontFamily, weightToStyle } from '#core/text/fonts'

const fontDigestCache = new Map<string, Uint8Array>()

type FontDigestTarget = {
  style: string
  families: Set<string>
}

async function computeFontDigest(data: ArrayBuffer): Promise<Uint8Array> {
  if (typeof crypto !== 'undefined') {
    const hash = await crypto.subtle.digest('SHA-1', data)
    return new Uint8Array(hash)
  }
  return new Uint8Array(20)
}

async function loadAnyFontData(family: string, style: string): Promise<ArrayBuffer | null> {
  const normalized = normalizeFontFamily(family)
  return (
    fontManager.loadedData(family, style) ??
    fontManager.loadedData(normalized, style) ??
    (await fontManager.loadFont(family, style)) ??
    (await fontManager.loadFont(normalized, style))
  )
}

async function getFontDigest(family: string, style: string): Promise<Uint8Array | null> {
  const normalized = normalizeFontFamily(family)
  const key = `${normalized}|${style}`
  const cached = fontDigestCache.get(key)
  if (cached) return cached
  const data = await loadAnyFontData(family, style)
  if (!data) return null
  const digest = await computeFontDigest(data)
  fontDigestCache.set(key, digest)
  return digest
}

export async function buildFontDigestMap(graph: SceneGraph): Promise<Map<string, Uint8Array>> {
  const fontTargets = new Map<string, FontDigestTarget>()
  const addFont = (family: string, style: string) => {
    const normalized = normalizeFontFamily(family)
    const key = `${normalized}|${style}`
    const target = fontTargets.get(key)
    if (target) {
      target.families.add(family)
      target.families.add(normalized)
      return
    }
    fontTargets.set(key, {
      style,
      families: new Set([family, normalized])
    })
  }

  for (const node of graph.getAllNodes()) {
    if (node.type !== 'TEXT') continue
    const baseStyle = weightToStyle(node.fontWeight, node.italic)
    addFont(node.fontFamily, baseStyle)
    for (const run of node.styleRuns) {
      const family = run.style.fontFamily ?? node.fontFamily
      const weight = run.style.fontWeight ?? node.fontWeight
      const italic = run.style.italic ?? node.italic
      addFont(family, weightToStyle(weight, italic))
    }
  }

  const result = new Map<string, Uint8Array>()
  for (const [key, target] of fontTargets) {
    let digest: Uint8Array | null = null
    for (const family of target.families) {
      digest = await getFontDigest(family, target.style)
      if (digest) break
    }
    if (digest) result.set(key, digest)
  }
  return result
}
