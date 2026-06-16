import { describe, test, expect } from 'bun:test'

import { createEditorStore } from '@/app/editor/session'

describe('setPlannedFilePath', () => {
  test('starts with document source version zero', () => {
    const store = createEditorStore()
    expect(store.state.documentSourceVersion).toBe(0)
  })

  test('sets document name from file path', () => {
    const store = createEditorStore()
    store.setPlannedFilePath('/tmp/projects/my-design.fig')
    expect(store.state.documentName).toBe('my-design')
  })

  test('handles Windows-style paths', () => {
    const store = createEditorStore()
    store.setPlannedFilePath('C:\\Users\\test\\design.fig')
    expect(store.state.documentName).toBe('design')
  })

  test('handles path without extension', () => {
    const store = createEditorStore()
    store.setPlannedFilePath('/tmp/Untitled')
    expect(store.state.documentName).toBe('Untitled')
  })

  test('increments document source version when planning a path', () => {
    const store = createEditorStore()
    store.setPlannedFilePath('/tmp/projects/my-design.fig')
    expect(store.state.documentSourceVersion).toBe(1)

    store.setPlannedFilePath('/tmp/projects/next-design.fig')
    expect(store.state.documentSourceVersion).toBe(2)
  })

  test('increments document source version when setting opened file source', () => {
    const store = createEditorStore()
    store.setDocumentSource('opened.fig', 'fig', undefined, '/tmp/opened.fig')
    expect(store.state.documentSourceVersion).toBe(1)
  })
})
