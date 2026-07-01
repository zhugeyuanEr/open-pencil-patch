import { describe, expect, mock, test } from 'bun:test'

import type { Editor } from '@open-pencil/core/editor'
import { SceneGraph } from '@open-pencil/core/scene-graph'

const calls: string[] = []
const figModule = await import('@open-pencil/core/io/formats/fig')

await mock.module('@open-pencil/core/io/formats/fig', () => ({
  ...figModule,
  readFigFile: async () => {
    calls.push('readFigFile')
    return new SceneGraph()
  }
}))

await mock.module('@/app/document/io/browser', () => ({
  yieldToUI: async () => {
    calls.push('yieldToUI')
  }
}))

await mock.module('@/app/editor/fonts', () => ({
  ensureGraphFonts: async () => {
    calls.push('ensureGraphFonts')
    return true
  }
}))

await mock.module('@/app/shell/ui', () => ({
  toast: {
    error: (message: string) => calls.push(`toast.error:${message}`)
  }
}))

const { createOpenActions } = await import('@/app/document/io/read')

function createTestEditor(): Editor {
  let graph = new SceneGraph()
  const editor = {
    get graph() {
      return graph
    },
    state: { sceneVersion: 0 },
    replaceGraph(nextGraph: SceneGraph) {
      calls.push('replaceGraph')
      graph = nextGraph
    },
    undo: {
      clear() {
        calls.push('undo.clear')
      }
    },
    clearSelection() {
      calls.push('clearSelection')
    },
    switchPage() {
      calls.push('switchPage')
    },
    requestRender() {
      calls.push('requestRender')
    }
  }
  return editor as Editor
}

describe('open document import order', () => {
  test('preloads graph fonts before replacing the visible graph', async () => {
    calls.length = 0
    const state = { documentName: 'Untitled', loading: false }
    const editor = createTestEditor()
    const { openFigFile } = createOpenActions({
      editor,
      state: state as Parameters<typeof createOpenActions>[0]['state'],
      setDocumentSource: () => calls.push('setDocumentSource'),
      fitCurrentPageToViewport: async () => {
        calls.push('fitCurrentPageToViewport')
      }
    })

    await openFigFile(new File([new Uint8Array()], 'sample.fig'))

    expect(calls.indexOf('ensureGraphFonts')).toBeGreaterThan(-1)
    expect(calls.indexOf('replaceGraph')).toBeGreaterThan(-1)
    expect(calls.indexOf('ensureGraphFonts')).toBeLessThan(calls.indexOf('replaceGraph'))
    expect(state.loading).toBe(false)
  })
})
