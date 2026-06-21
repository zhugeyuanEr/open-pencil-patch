import { describe, test, expect, beforeAll } from 'bun:test'

import { exportFigFile, parseFigFile, initCodec, SceneGraph } from '@open-pencil/core'

beforeAll(async () => {
  await initCodec()
})

function childFrameNames(graph: SceneGraph, pageId: string): string[] {
  return graph.nodes
    .get(pageId)
    ?.childIds.map((id) => graph.nodes.get(id)?.name)
    .filter((n): n is string => !!n && n !== 'Document')
    .sort() ?? []
}

function collectGuids(graph: SceneGraph): string[] {
  const ids: string[] = []
  for (const n of graph.nodes.values()) {
    if (n.source.id) ids.push(n.source.id)
  }
  return ids
}

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
    const reimported1 = await parseFigFile(out1.buffer as ArrayBuffer)

    expect(childFrameNames(reimported1, reimported1.getPages()[0].id)).toEqual([
      'A0',
      'A1',
      'A2',
      'A3',
      'A4'
    ])

    for (let i = 0; i < 5; i++) {
      graph.createNode('FRAME', page.id, { name: `B${i}` })
    }

    const out2 = await exportFigFile(graph)
    const reimported2 = await parseFigFile(out2.buffer as ArrayBuffer)

    expect(childFrameNames(reimported2, reimported2.getPages()[0].id)).toEqual([
      'A0',
      'A1',
      'A2',
      'A3',
      'A4',
      'B0',
      'B1',
      'B2',
      'B3',
      'B4'
    ])
  })

  test('GUID uniqueness across incremental writes', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    for (let i = 0; i < 3; i++) {
      const n = graph.createNode('FRAME', page.id, { name: `seed${i}` })
      n.source.id = `1:${100 + i}`
    }

    const out1 = await exportFigFile(graph)
    const guids1 = new Set(collectGuids(await parseFigFile(out1.buffer as ArrayBuffer)))

    for (let i = 0; i < 3; i++) {
      graph.createNode('FRAME', page.id, { name: `new${i}` })
    }

    const out2 = await exportFigFile(graph)
    const reimported2 = await parseFigFile(out2.buffer as ArrayBuffer)
    const guids2 = new Set(collectGuids(reimported2))

    for (const g of guids1) {
      expect(guids2.has(g)).toBe(true)
    }

    expect(guids2.size).toBeGreaterThan(guids1.size)

    // The blob itself must not contain duplicate GUIDs internally —
    // a previous symptom of the collision was a Set smaller than the list.
    const allIds = collectGuids(reimported2)
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  test('high-water-mark scan advances past sessionID:1 localIDs', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    // Plant three nodes deep into sessionID: 1 with high localIDs.
    for (let i = 0; i < 3; i++) {
      const n = graph.createNode('FRAME', page.id, { name: `hi${i}` })
      n.source.id = `1:${5000 + i}`
    }

    // Add a fresh node WITHOUT source.id — the writer must mint it at
    // a localID that clears the high-water mark, never below 5003.
    graph.createNode('FRAME', page.id, { name: 'minted' })

    const exported = await exportFigFile(graph)
    const reimported = await parseFigFile(exported.buffer as ArrayBuffer)

    const minted = reimported.nodes.get(
      reimported.getPages()[0].childIds.find(
        (id) => reimported.nodes.get(id)?.name === 'minted'
      ) ?? ''
    )
    expect(minted?.source.id).toBeTruthy()
    const [sessionStr, localStr] = (minted?.source.id ?? '').split(':')
    expect(Number.parseInt(sessionStr, 10)).toBe(1)
    expect(Number.parseInt(localStr, 10)).toBeGreaterThan(5002)

    // Original high GUIDs must also survive.
    const seedGuids = [...reimported.nodes.values()]
      .map((n) => n.source.id)
      .filter((id): id is string => id !== null)
    expect(seedGuids).toContain('1:5000')
    expect(seedGuids).toContain('1:5001')
    expect(seedGuids).toContain('1:5002')
  })
})