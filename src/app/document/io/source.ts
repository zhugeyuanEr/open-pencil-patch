import type { Editor, EditorState } from '@open-pencil/core/editor'
import { exportFigFile } from '@open-pencil/core/io/formats/fig'

import { createAutosave } from '@/app/document/autosave'
import {
  documentNameFromFigPath,
  downloadNameFromPath,
  figDownloadName
} from '@/app/document/io/names'
import { createRecoveryActions } from '@/app/document/recovery'
import { createSaveActions } from '@/app/document/io/save'
import { createDocumentSourceState } from '@/app/document/io/source-state'

type DocumentSourceState = EditorState & {
  documentName: string
  autosaveEnabled: boolean
  documentSourceVersion: number
}

export { createDocumentSourceState }

type DocumentSourceOptions = {
  editor: Editor
  state: DocumentSourceState
  stopWatchingFile: () => void
  startWatchingFile: () => Promise<void>
  getFileHandle: () => FileSystemFileHandle | null
  setFileHandle: (handle: FileSystemFileHandle | null) => void
  getFilePath: () => string | null
  setFilePath: (path: string | null) => void
  getDownloadName: () => string | null
  setDownloadName: (name: string | null) => void
  getSavedVersion: () => number
  setSavedVersion: (version: number) => void
  setLastWriteTime: (time: number) => void
  getRenderer: () => Editor['renderer']
  getDocKey: () => string
}

export function createDocumentSourceActions({
  editor,
  state,
  stopWatchingFile,
  startWatchingFile,
  getFileHandle,
  setFileHandle,
  getFilePath,
  setFilePath,
  getDownloadName,
  setDownloadName,
  getSavedVersion,
  setSavedVersion,
  setLastWriteTime,
  getRenderer,
  getDocKey
}: DocumentSourceOptions) {
  function buildFigFile() {
    return exportFigFile(editor.graph, undefined, getRenderer() ?? undefined, state.currentPageId)
  }

  const { saveFigFile, saveFigFileAs, writeFile } = createSaveActions({
    state,
    buildFigFile,
    getFilePath,
    setFilePath,
    getFileHandle,
    setFileHandle,
    getDownloadName,
    setDownloadName,
    setSavedVersion,
    setLastWriteTime,
    startWatchingFile: () => {
      void startWatchingFile()
    }
  })

  const hasWritableSource = () => !!getFileHandle() || !!getFilePath()

  const { disposeAutosave } = createAutosave({
    state,
    getSavedVersion,
    hasWritableSource,
    saveCurrentDocument: async () => writeFile(await buildFigFile())
  })

  const recovery = createRecoveryActions({
    hasWritableSource,
    buildFigFile,
    getDocKey
  })

  function markDocumentSourceChanged() {
    state.documentSourceVersion += 1
  }

  // Serial cleanup chain — multiple rapid `setDocumentSource` calls
  // (e.g. opening file A then file B in quick succession) chain their
  // IDB deletes instead of firing them in parallel and clobbering each
  // other's in-flight writes. Errors are swallowed inside the recovery
  // layer; the chain itself never rejects.
  let cleanupChain: Promise<void> = Promise.resolve()
  function queueClearRecovery() {
    cleanupChain = cleanupChain.then(() => recovery.clearRecoverySnapshot())
  }

  function setDocumentSource(
    fileName: string,
    sourceFormat: string,
    handle?: FileSystemFileHandle,
    path?: string
  ) {
    stopWatchingFile()
    const isFig = sourceFormat === 'fig'
    setFileHandle(isFig ? (handle ?? null) : null)
    setFilePath(isFig ? (path ?? null) : null)
    setDownloadName(figDownloadName(fileName, sourceFormat))
    markDocumentSourceChanged()
    setSavedVersion(state.sceneVersion)
    if (isFig && (handle || path)) {
      void startWatchingFile()
    }
    queueClearRecovery()
  }

  function setPlannedFilePath(path: string) {
    stopWatchingFile()
    setFileHandle(null)
    setFilePath(path)
    const downloadName = downloadNameFromPath(path)
    setDownloadName(downloadName)
    state.documentName = documentNameFromFigPath(downloadName)
    markDocumentSourceChanged()
  }

  function startWatchingCurrentFile() {
    void startWatchingFile()
  }

  function disposeDocumentIO() {
    stopWatchingFile()
    disposeAutosave()
    recovery.dispose()
  }

  // Snapshot cleanup runs in `finally` so a partial failure during save
  // (e.g. Tauri permission error after the bytes hit disk) still drops the
  // recovery entry — otherwise the next launch would offer to "restore" a
  // state the user has already overwritten on disk.
  async function saveFigFileWithCleanup() {
    try {
      await saveFigFile()
    } finally {
      void recovery.clearRecoverySnapshot()
    }
  }

  async function saveFigFileAsWithCleanup() {
    try {
      await saveFigFileAs()
    } finally {
      void recovery.clearRecoverySnapshot()
    }
  }

  return {
    setDocumentSource,
    setPlannedFilePath,
    startWatchingCurrentFile,
    disposeDocumentIO,
    saveFigFile: saveFigFileWithCleanup,
    saveFigFileAs: saveFigFileAsWithCleanup,
    ...recovery
  }
}
