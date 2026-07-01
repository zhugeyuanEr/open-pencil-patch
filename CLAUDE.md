# Claude Code

Use [AGENTS.md](./AGENTS.md) as the source of truth for OpenPencil architecture,
commands, conventions, and release rules.

## Local Safety

Follow [Local AI-agent safety](./AGENTS.md#local-ai-agent-safety) before running
validation commands on this Windows checkout.

- Do not run `bun run check`, `bun run test:unit`, broad `bun test ./tests/engine`,
  broad Playwright, `bun run tauri dev`, or `bun run tauri build` unless the user
  explicitly asks for a full validation or release build.
- Prefer the smallest targeted `bun test path/to/file.test.ts` or focused check
  for the touched files.
- Use hard timeouts for Bun, Node, Playwright, Vite, and Tauri commands.
- If a command times out, is backgrounded, or produces an empty long-running task
  output, stop launching more Node/Bun work, inspect processes, and report the
  blocked validation.
- In final status, separate targeted validation that ran from full gates skipped
  for local resource safety.
