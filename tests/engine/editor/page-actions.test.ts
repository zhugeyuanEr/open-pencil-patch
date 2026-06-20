import { describe, expect, spyOn, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'

describe('page actions', () => {
  test('renamePage updates the page name', () => {
    const editor = createEditor()
    const initial = editor.graph.getPages()
    expect(initial).toHaveLength(1)

    const pageId = initial[0].id
    editor.renamePage(pageId, 'Renamed')

    const updated = editor.graph.getPages()
    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe(pageId)
    expect(updated[0].name).toBe('Renamed')
  })

  test('deletePage removes the page when more than one exists', () => {
    const editor = createEditor()
    const pageA = editor.addPage('A')
    const pageB = editor.addPage('B')

    expect(editor.graph.getPages()).toHaveLength(3)

    editor.deletePage(pageA)

    const remaining = editor.graph.getPages()
    expect(remaining).toHaveLength(2)
    expect(remaining.some((p) => p.id === pageA)).toBe(false)
    expect(remaining.some((p) => p.id === pageB)).toBe(true)
  })

  test('deletePage refuses to delete the last remaining page', () => {
    const editor = createEditor()
    const initial = editor.graph.getPages()
    expect(initial).toHaveLength(1)

    editor.deletePage(initial[0].id)

    const after = editor.graph.getPages()
    expect(after).toHaveLength(1)
    expect(after[0].id).toBe(initial[0].id)
  })

  test('deletePage switches to a sibling when current is deleted', () => {
    const editor = createEditor()
    const initialPageId = editor.graph.getPages()[0].id
    const newPageId = editor.addPage('New')

    expect(editor.state.currentPageId).toBe(newPageId)

    editor.deletePage(newPageId)

    expect(editor.state.currentPageId).toBe(initialPageId)
  })

  test('deletePage clears the page viewport entry', () => {
    const editor = createEditor()
    const pageA = editor.addPage('A')
    const pageB = editor.addPage('B')

    const deleteSpy = spyOn(Map.prototype, 'delete')
    try {
      editor.deletePage(pageB)
      const callsWithPageB = deleteSpy.mock.calls.filter(([key]) => key === pageB)
      expect(callsWithPageB.length).toBeGreaterThan(0)
    } finally {
      deleteSpy.mockRestore()
    }

    expect(editor.graph.getNode(pageB)).toBeUndefined()
    expect(editor.graph.getNode(pageA)).toBeDefined()
  })
})