# `@open-pencil/tauri-config-check`

Static invariant checker for `desktop/tauri.conf.json`. The Tauri 2 config parser
does not accept JSON comments, so critical flags cannot be documented inline.
This tool is the regression guard.

## Why it exists

`dragDropEnabled` defaults to `true` in Tauri 2. On WebView2 (Windows) this
makes the webview swallow `dragstart` / `dragover` / `drop` events before
Atlassian `pragmatic-drag-and-drop` can observe them, breaking the Layers
panel reorder. Disabling it is required, but a future contributor could
inadvertently flip it back. This tool fails the build if that happens.

## Run

```sh
bun tools/tauri-config-check/src/check.ts
```

CI / pre-commit should wire this into the existing quality gate.