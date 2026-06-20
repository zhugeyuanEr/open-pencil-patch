import { describe, test, expect, beforeAll } from 'bun:test'

import { exportFigFile, parseFigFile, initCodec, SceneGraph } from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'

beforeAll(async () => {
  await initCodec()
})

describe('GUID collision regression (#349)', () => {
  test('new nodes do not collide with existing sessionID:1 nodes', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    // Simulate Figma import: existing nodes live in sessionID: 1 with
    // small localIDs that the writer previously ignored.
    for (let i = 0; i < 5; i++) {
      const n = graph.createNode('FRAME', page.id, { name: `A${i}` })
      n.source.id = `1:${82 + i}`
    }

    const out1 = await exportFigFile(graph)
    const figBytes1 = out1.buffer as ArrayBuffer

    for (let i = 0; i < 5; i++) {
      graph.createNode('FRAME', page.id, { name: `B${i}` })
    }

    const out2 = await exportFigFile(graph)
    const figBytes2 = out2.buffer as ArrayBuffer

    const reimported1 = await parseFigFile(figBytes1)
    const reimported2 = await parseFigFile(figBytes2)

    const frameNames = (g: typeof reimported1) =>
      [...g.nodes.values()]
        .filter((nd) => nd.type === 'FRAME' && nd.name !== 'Document')
        .map((nd) => nd.name)
        .sort()

    expect(frameNames(reimported1)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4'])
    expect(frameNames(reimported2)).toEqual(['A0', 'A1', 'A2', 'A3', 'A4', 'B0', 'B1', 'B2', 'B3', 'B4'])
  })

  test('GUID uniqueness across incremental writes', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    for (let i = 0; i < 3; i++) {
      const n = graph.createNode('FRAME', page.id, { name: `seed${i}` })
      n.source.id = `1:${100 + i}`
    }

    const out1 = await exportFigFile(graph)
    const out1Graph = await parseFigFile(out1.buffer as ArrayBuffer)
    const guids1 = new Set<string>()
    for (const n of out1Graph.nodes.values()) {
      const id = n.source.id
      if (id) guids1.add(id)
    }

    for (let i = 0; i < 3; i++) {
      graph.createNode('FRAME', page.id, { name: `new${i}` })
    }

    const out2 = await exportFigFile(graph)
    const out2Graph = await parseFigFile(out2.buffer as ArrayBuffer)
    const guids2 = new Set<string>()
    for (const n of out2Graph.nodes.values()) {
      const id = n.source.id
      if (id) guids2.add(id)
    }

    for (const g of guids1) {
      expect(guids2.has(g)).toBe(true)
    }
    expect(guids2.size).toBeGreaterThan(guids1.size)
  })

  test('high-water-mark scan advances past sessionID:1 localIDs', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    for (let i = 0; i < 3; i++) {
      const n = graph.createNode('FRAME', page.id, { name: `hi${i}` })
      n.source.id = `1:${5000 + i}`
    }

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(exported.buffer as ArrayBuffer)

    const highGuids = [...reimported.nodes.values()]
      .filter((nd) => nd.type === 'FRAME' && nd.name !== 'Document')
      .map((nd) => nd.source.id)
      .filter((id): id is string => id !== null)
      .sort()

    expect(highGuids).toContain('1:5000')
    expect(highGuids).toContain('1:5001')
    expect(highGuids).toContain('1:5002')

    expectDefined(highGuids.find((g) => g === '1:5000'), 'high GUID 5000')
  })
})