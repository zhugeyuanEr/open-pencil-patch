import { IS_TAURI } from '#core/constants'

const BUNDLED_FONTS: Record<string, string> = {
  'Inter|Regular': '/Inter-Regular.ttf',
  'Inter|Medium': '/Inter-Medium.ttf',
  'Inter|SemiBold': '/Inter-SemiBold.ttf',
  'Inter|Bold': '/Inter-Bold.ttf',
  'Inter|ExtraBold': '/Inter-ExtraBold.ttf',
  'Noto Naskh Arabic|Regular': '/NotoNaskhArabic-Regular.ttf',
  'Noto Sans SC|Regular': '/NotoSansSC-Regular.ttf'
}

const BUNDLED_REGULAR_STYLE_FALLBACK_FAMILIES = new Set(['Noto Naskh Arabic', 'Noto Sans SC'])

export function bundledFontUrl(family: string, style: string): string | undefined {
  const exact = BUNDLED_FONTS[`${family}|${style}`]
  if (exact) return exact
  if (BUNDLED_REGULAR_STYLE_FALLBACK_FAMILIES.has(family)) {
    return BUNDLED_FONTS[`${family}|Regular`]
  }
  return undefined
}

export const bundledFontUrls: readonly string[] = Object.values(BUNDLED_FONTS)

export async function resolveBundledFontUrl(path: string): Promise<string> {
  if (!IS_TAURI) return path
  try {
    const mod = (await import(/* @vite-ignore */ '@tauri-apps/api/core' as string)) as {
      convertFileSrc?: (path: string) => string
    }
    return mod.convertFileSrc ? mod.convertFileSrc(path) : path
  } catch {
    return path
  }
}

