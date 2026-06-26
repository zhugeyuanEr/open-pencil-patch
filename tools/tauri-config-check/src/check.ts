#!/usr/bin/env bun
/**
 * Static checks for desktop/tauri.conf.json invariants.
 *
 * The Tauri 2 config parser does not support JSON comments, so we cannot
 * mark up the file in place. This tool is the safety net: it fails the
 * build if a critical flag is removed or flipped back to a value that
 * breaks the editor.
 *
 * Run via `bun tools/tauri-config-check/src/check.ts` or wire into CI.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface TauriWindow {
  title?: string
  dragDropEnabled?: boolean
}

export interface TauriConfig {
  app?: {
    windows?: TauriWindow[]
  }
}

export interface CheckResult {
  failures: string[]
}

export function check(config: TauriConfig): CheckResult {
  const failures: string[] = []

  const windows = config.app?.windows ?? []
  if (windows.length === 0) {
    failures.push('tauri.conf.json: app.windows must contain at least one entry')
    return { failures }
  }

  windows.forEach((w, i) => {
    const label = `app.windows[${i}]${w.title ? ` (${w.title})` : ''}`
    if (w.dragDropEnabled !== false) {
      failures.push(
        `${label}: dragDropEnabled must be false. ` +
          'Tauri 2 defaults this to true, which makes WebView2 (Windows) swallow HTML5 ' +
          'dragstart / dragover / drop events before the Layers panel reorder can fire. ' +
          'macOS WKWebView is unaffected. See upstream issue #292.'
      )
    }
  })

  return { failures }
}

function main() {
  const configPath = resolve(process.cwd(), 'desktop/tauri.conf.json')
  const raw = readFileSync(configPath, 'utf8')
  const config = JSON.parse(raw) as TauriConfig

  const result = check(config)

  if (result.failures.length === 0) {
    console.log('tauri-config-check: all invariants hold')
    return
  }

  console.error('tauri-config-check: FAILED')
  for (const f of result.failures) console.error(`  - ${f}`)
  process.exit(1)
}

if (import.meta.main) {
  main()
}