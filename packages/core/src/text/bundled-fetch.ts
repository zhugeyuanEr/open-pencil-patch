import { resolveBundledFontUrl } from '#core/text/bundled'

export async function fetchBundledFontFromUrl(url: string): Promise<ArrayBuffer | null> {
  const assetUrl = await resolveBundledFontUrl(url)
  let lastError: unknown = null

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(assetUrl)
      if (response.ok) {
        return await response.arrayBuffer()
      }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (e) {
      lastError = e
    }

    if (attempt < 2) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 80 * (attempt + 1))
      })
    }
  }

  console.warn(`Bundled font fetch failed after 3 attempts: ${assetUrl}`, lastError)
  return null
}
