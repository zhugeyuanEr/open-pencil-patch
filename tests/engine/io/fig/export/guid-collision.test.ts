import { beforeAll, describe, expect, test } from 'bun:test'

import { exportFigFile, initCodec, parseFigFile, SceneGraph } from '@open-pencil/core'

/**
 * Regression test: two distinct nodes sharing the same source.id
 * (as happens with component-instance children) must receive
 * different GUIDs on export, preventing silent data loss on reimport.
 */
describe('export: GUID collision prevention', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('two nodes with same source.id get different GUIDs on export', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    // Create two nodes that share the same Figma source.id
    // (simulates component master + instance child)
    const rect1 = graph.createNode('RECTANGLE', page.id, {
      name: 'Master Child',
      width: 100,
      height: 50
    })
    graph.updateNode(rect1.id, {
      source: { ...rect1.source, id: '1:94', format: 'fig' }
    })

    const rect2 = graph.createNode('RECTANGLE', page.id, {
      name: 'Instance Child',
      width: 100,
      height: 50
    })
    graph.updateNode(rect2.id, {
      source: { ...rect2.source, id: '1:94', format: 'fig' }
    })

    const figBytes = await exportFigFile(graph)
    const reimported = await parseFigFile(figBytes.buffer as ArrayBuffer)

    // Both nodes must survive reimport — no silent last-write-wins
    const allNodes = [...reimported.getAllNodes()]
    const rects = allNodes.filter(
      (n) => n.type === 'RECTANGLE' && (n.name === 'Master Child' || n.name === 'Instance Child')
    )
    expect(rects.length).toBe(2)
  })

  test('cloned node does not collide with original GUID', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    const rect = graph.createNode('RECTANGLE', page.id, {
      name: 'Original',
      width: 100,
      height: 50
    })
    graph.updateNode(rect.id, {
      source: { ...rect.source, id: '1:200', format: 'fig' }
    })

    // Clone the node — cloneTree should clear source.id
    const clone = graph.cloneTree(rect.id, page.id)
    expect(clone).not.toBeNull()
    if (!clone) throw new Error('Expected clone to exist')
    expect(clone.source.id).toBeNull()

    const figBytes = await exportFigFile(graph)
    const reimported = await parseFigFile(figBytes.buffer as ArrayBuffer)

    const allNodes = [...reimported.getAllNodes()]
    const rects = allNodes.filter((n) => n.type === 'RECTANGLE')
    // Both original and clone must survive
    expect(rects.length).toBe(2)
  })

  test('export roundtrip preserves three nodes with identical source.id', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    for (let i = 0; i < 3; i++) {
      const rect = graph.createNode('RECTANGLE', page.id, {
        name: `Rect ${i}`,
        width: 50,
        height: 50
      })
      graph.updateNode(rect.id, {
        source: { ...rect.source, id: '1:500', format: 'fig' }
      })
    }

    const figBytes = await exportFigFile(graph)
    const reimported = await parseFigFile(figBytes.buffer as ArrayBuffer)

    const allNodes = [...reimported.getAllNodes()]
    const rects = allNodes.filter((n) => n.type === 'RECTANGLE')
    expect(rects.length).toBe(3)
  })

  test('nodes with session-0 source.id do not collide with document GUID', async () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]

    // The document GUID is always {sessionID:0, localID:0}.
    // Imported nodes with source.id in the 0:* namespace must not reuse
    // that slot — the export must reserve the document GUID first.
    const rect1 = graph.createNode('RECTANGLE', page.id, {
      name: 'S0 Node A',
      width: 100,
      height: 50
    })
    graph.updateNode(rect1.id, {
      source: { ...rect1.source, id: '0:94', format: 'fig' }
    })

    const rect2 = graph.createNode('RECTANGLE', page.id, {
      name: 'S0 Node B',
      width: 100,
      height: 50
    })
    graph.updateNode(rect2.id, {
      source: { ...rect2.source, id: '0:94', format: 'fig' }
    })

    const figBytes = await exportFigFile(graph)
    const reimported = await parseFigFile(figBytes.buffer as ArrayBuffer)

    const allNodes = [...reimported.getAllNodes()]
    const rects = allNodes.filter(
      (n) => n.type === 'RECTANGLE' && (n.name === 'S0 Node A' || n.name === 'S0 Node B')
    )
    // Both nodes must survive — the document GUID (0:0) must not swallow them
    expect(rects.length).toBe(2)
  })
})

/**
 * Regression coverage for upstream #349: incremental writes must not
 * collide with imported sessionID: 1 nodes. Verifies high-water-mark
 * scan, GUID uniqueness, and counter advancement past high localIDs.
 */
describe('GUID collision regression (#349)', () => {
  beforeAll(async () => {
    await initCodec()
  })

  function childFrameNames(graph: SceneGraph, pageId: string): string[] {
    return (
      graph.nodes
        .get(pageId)
        ?.childIds.map((id) => graph.nodes.get(id)?.name)
        .filter((n): n is string => !!n && n !== 'Document')
        .sort() ?? []
    )
  }

  function collectGuids(graph: SceneGraph): string[] {
    const ids: string[] = []
    for (const n of graph.nodes.values()) {
      if (n.source.id) ids.push(n.source.id)
    }
    return ids
  }

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

    const page0 = reimported.getPages()[0]
    const mintedId = page0.childIds.find((id) => reimported.nodes.get(id)?.name === 'minted') ?? ''
    const minted = reimported.nodes.get(mintedId)
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
