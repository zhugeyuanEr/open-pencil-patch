import type { TypefaceFontProvider } from 'canvaskit-wasm'

export function createRecordingProvider() {
  const registrations: Array<{ family: string; byteLength: number }> = []
  const provider = {
    registerFont(data: ArrayBuffer, family: string) {
      registrations.push({ family, byteLength: data.byteLength })
    }
  } as TypefaceFontProvider
  return { provider, registrations }
}
