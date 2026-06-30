import type { Editor } from '@open-pencil/core/editor'

import type { CanvasRenderLayer } from './types'

type RenderLoopOptions = {
  layer?: CanvasRenderLayer
}

type EditorRenderScheduler = {
  schedule: (callback: () => void) => void
  cancel: (callback: () => void) => void
}

const renderSchedulers = new WeakMap<Editor, EditorRenderScheduler>()

function getRenderScheduler(editor: Editor): EditorRenderScheduler {
  const existing = renderSchedulers.get(editor)
  if (existing) return existing

  let frameId: number | null = null
  const callbacks = new Set<() => void>()

  function flush() {
    frameId = null
    const pending = [...callbacks]
    callbacks.clear()
    for (const callback of pending) callback()
  }

  const scheduler = {
    schedule(callback: () => void) {
      callbacks.add(callback)
      if (frameId !== null) return
      frameId = requestAnimationFrame(flush)
    },
    cancel(callback: () => void) {
      callbacks.delete(callback)
      if (callbacks.size === 0 && frameId !== null) {
        cancelAnimationFrame(frameId)
        frameId = null
      }
    }
  }

  renderSchedulers.set(editor, scheduler)
  return scheduler
}

function shouldScheduleForSelection(layer: CanvasRenderLayer | undefined) {
  return layer !== 'scene'
}

export function createCanvasRenderLoop(
  editor: Editor,
  renderNow: () => void,
  options: RenderLoopOptions & { getRenderer?: () => { fontsLoaded: boolean } | null } = {}
) {
  const scheduler = getRenderScheduler(editor)
  const getRenderer = options.getRenderer
  let dirty = true
  let frameScheduled = false
  let lastRenderVersion = -1
  let lastSelectedIds: Set<string> | null = null
  // Cap the time we will sit on a "fonts not loaded yet" gate before forcing
  // a render. Without this cap a failed `loadFonts` would loop forever and
  // the user would never see anything.
  const FONTS_WAIT_TIMEOUT_MS = 5000
  let fontsWaitStartedAt: number | null = null

  function renderFrame() {
    frameScheduled = false
    if (editor.state.loading) {
      scheduleRender()
      return
    }

    const renderer = getRenderer ? getRenderer() : null
    if (renderer && !renderer.fontsLoaded) {
      const waited =
        fontsWaitStartedAt == null
          ? (fontsWaitStartedAt = performance.now())
          : performance.now() - fontsWaitStartedAt
      if (waited < FONTS_WAIT_TIMEOUT_MS) {
        scheduleRender()
        return
      }
      // Timed out: give up waiting and render. `renderText` will skip CJK
      // glyphs via `fontsLoadFailed` / missing fonts and show a placeholder.
      fontsWaitStartedAt = null
    } else if (fontsWaitStartedAt != null) {
      fontsWaitStartedAt = null
    }

    const versionChanged = editor.state.renderVersion !== lastRenderVersion
    const selectionChanged = editor.state.selectedIds !== lastSelectedIds
    if (dirty || versionChanged || selectionChanged) {
      dirty = false
      renderNow()
    }
  }

  const scheduleRender = () => {
    dirty = true
    if (frameScheduled) return
    frameScheduled = true
    scheduler.schedule(renderFrame)
  }

  const unsubscribe = [
    editor.onEditorEvent('render:requested', scheduleRender),
    editor.onEditorEvent('viewport:changed', scheduleRender)
  ]

  unsubscribe.push(editor.onEditorEvent('repaint:requested', scheduleRender))

  if (shouldScheduleForSelection(options.layer)) {
    unsubscribe.push(editor.onEditorEvent('selection:changed', scheduleRender))
  }

  function markRendered() {
    lastRenderVersion = editor.state.renderVersion
    lastSelectedIds = editor.state.selectedIds
  }

  function pause() {
    for (const off of unsubscribe) off()
    if (frameScheduled) {
      scheduler.cancel(renderFrame)
      frameScheduled = false
    }
  }

  return {
    pause,
    markRendered,
    markDirty: scheduleRender
  }
}
