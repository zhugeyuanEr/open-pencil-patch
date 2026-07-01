import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { Plugin } from 'vite'

// TODO: production — bundle MCP server as Tauri sidecar or spawn via shell plugin
function resolveBunCommand(): string {
  if (process.platform !== 'win32') return 'bun'

  const result = spawnSync('where.exe', ['bun'], { encoding: 'utf8' })
  const candidates = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const directExe = candidates.find((candidate) => candidate.toLowerCase().endsWith('.exe'))
  if (directExe) return directExe

  for (const candidate of candidates) {
    const bunExe = join(dirname(candidate), 'node_modules', 'bun', 'bin', 'bun.exe')
    if (existsSync(bunExe)) return bunExe
  }

  return candidates.find((candidate) => candidate.toLowerCase().endsWith('.cmd')) ?? 'bun.cmd'
}

export function automationPlugin(authToken: string | null, corsOrigin: string): Plugin {
  let child: ReturnType<typeof spawn> | null = null

  return {
    name: 'open-pencil-automation',
    configureServer() {
      if (child) return

      try {
        child = spawn(resolveBunCommand(), ['run', 'packages/mcp/src/index.ts'], {
          stdio: ['ignore', 'inherit', 'pipe'],
          env: {
            ...process.env,
            PORT: '7600',
            WS_PORT: '7601',
            ...(authToken ? { OPENPENCIL_MCP_AUTH_TOKEN: authToken } : {}),
            OPENPENCIL_MCP_CORS_ORIGIN: corsOrigin
          }
        })
      } catch (e) {
        console.warn(
          `[MCP] Failed to start local automation server: ${e instanceof Error ? e.message : String(e)}`
        )
        child = null
        return
      }

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        if (text.includes('EADDRINUSE')) {
          console.error(
            '\x1b[31m[MCP] Port 7600 already in use. Is another OpenPencil instance running?\x1b[0m'
          )
          child?.kill()
          child = null
          return
        }
        process.stderr.write(data)
      })

      child.on('error', (e) => {
        console.warn(`[MCP] Failed to start local automation server: ${e.message}`)
        child = null
      })

      child.on('exit', (code) => {
        if (code && code !== 0 && child) {
          console.error(`[MCP] Server exited with code ${code}`)
        }
        child = null
      })
    },
    buildEnd() {
      child?.kill()
      child = null
    }
  }
}
