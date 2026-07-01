import type { Editor } from '@open-pencil/core/editor'
import { computeAllLayouts } from '@open-pencil/core/layout'
import type { SceneGraph, SceneNode } from '@open-pencil/core/scene-graph'

// Minimal shape needed to import a SceneGraph in place. Both the raw core
// `Editor` and the app-level `EditorStore` satisfy this — duck-typed so
// importing doesn't have to know which world the caller lives in.
type ImportTarget = {
  graph: SceneGraph
  replaceGraph(g: SceneGraph): void
  undo: { clear(): void }
  clearSelection(): void
  switchPage(pageId: string): Promise<void> | void
}

export function prepareImportedDocument(imported: SceneGraph): SceneNode | undefined {
  const firstPage = imported.getPages()[0] as SceneNode | undefined
  if (firstPage) computeAllLayouts(imported, firstPage.id)
  return firstPage
}

export async function applyImportedDocument(target: ImportTarget | Editor, imported: SceneGraph) {
  const firstPage = prepareImportedDocument(imported)
  target.replaceGraph(imported)
  target.undo.clear()
  target.clearSelection()
  const pageId = firstPage?.id ?? target.graph.rootId
  await target.switchPage(pageId)
}
