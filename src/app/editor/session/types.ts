import { createDefaultEditorState, type EditorState } from '@open-pencil/core/editor'

import type { NodeEditState } from '@/app/editor/vector-edit/types'

export function createInitialAppEditorState(pageId: string): AppEditorState {
  return {
    ...createDefaultEditorState(pageId),
    showUI: true,
    showRulers: true,
    showRemoteCursors: true,
    activeRibbonTab: 'panels',
    panelMode: 'design',
    actionToast: null,
    mobileDrawerSnap: 'closed',
    clipboardHtml: '',
    // Default false: createAutosave early-returns when hasWritableSource() is false
    // (i.e. the document is "Untitled" with no file handle/path), so flipping this
    // to true has no observable effect. Keep false so the intent matches reality.
    autosaveEnabled: false,
    documentSourceVersion: 0,
    cursorCanvasX: null,
    cursorCanvasY: null,
    nodeEditState: null,
    scrubInputFocused: false
  }
}

export type AppEditorState = EditorState & {
  showUI: boolean
  showRulers: boolean
  showRemoteCursors: boolean
  activeRibbonTab: 'panels' | 'code' | 'ai'
  panelMode: 'layers' | 'design'
  actionToast: string | null
  mobileDrawerSnap: 'closed' | 'half' | 'full'
  clipboardHtml: string
  autosaveEnabled: boolean
  documentSourceVersion: number
  cursorCanvasX: number | null
  cursorCanvasY: number | null
  nodeEditState: NodeEditState | null
  scrubInputFocused: boolean
}
