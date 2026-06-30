import type { Editor, EditorState } from '@open-pencil/core/editor'
import { prefetchFigmaSchema } from '@open-pencil/core/kiwi'

import { createDocumentViewportActions, downloadBlob } from '@/app/document/io/browser'
import { createOpenActions, createReloadActions } from '@/app/document/io/read'
import { createDocumentSourceActions, createDocumentSourceState } from '@/app/document/io/source'
import type { ViewportSize } from '@/app/document/io/types'
import { createFileWatcher } from '@/app/document/io/watch'

type DocumentIOState = EditorState & {
  documentName: string
  loading: boolean
  autosaveEnabled: boolean
  documentSourceVersion: number
}

export function createDocumentIOActions(
  editor: Editor,
  state: DocumentIOState,
  viewportSize: ViewportSize,
  getDocKey: () => string
) {
  const sourceState = createDocumentSourceState()

  void prefetchFigmaSchema()

  const { reloadFromDisk } = createReloadActions({
    editor,
    state,
    getFilePath: sourceState.getFilePath,
    getFileHandle: sourceState.getFileHandle,
    setSavedVersion: sourceState.setSavedVersion
  })
  const { startWatchingFile, stopWatchingFile } = createFileWatcher({
    getFilePath: sourceState.getFilePath,
    getFileHandle: sourceState.getFileHandle,
    getLastWriteTime: sourceState.getLastWriteTime,
    reloadFromDisk: () => {
      void reloadFromDisk()
    }
  })
  const { setViewportSize, fitCurrentPageToViewport } = createDocumentViewportActions(
    editor,
    viewportSize
  )
  const sourceActions = createDocumentSourceActions({
    editor,
    state,
    stopWatchingFile,
    startWatchingFile,
    getRenderer: () => editor.renderer,
    getDocKey,
    ...sourceState
  })
  const { openFigFile } = createOpenActions({
    editor,
    state,
    setDocumentSource: sourceActions.setDocumentSource,
    fitCurrentPageToViewport
  })

  return {
    downloadBlob,
    getFilePath: sourceState.getFilePath,
    setViewportSize,
    fitCurrentPageToViewport,
    setDocumentSource: sourceActions.setDocumentSource,
    setPlannedFilePath: sourceActions.setPlannedFilePath,
    startWatchingCurrentFile: sourceActions.startWatchingCurrentFile,
    disposeDocumentIO: sourceActions.disposeDocumentIO,
    openFigFile,
    saveFigFile: sourceActions.saveFigFile,
    saveFigFileAs: sourceActions.saveFigFileAs,
    // Recovery methods are bound through arrow wrappers so they keep their
    // closure over the recovery actions even when destructured off the
    // sourceActions object. Avoids unbound-method warnings.
    writeRecoverySnapshot: () => sourceActions.writeRecoverySnapshot(),
    readRecoverySnapshot: () => sourceActions.readRecoverySnapshot(),
    clearRecoverySnapshot: () => sourceActions.clearRecoverySnapshot()
  }
}
