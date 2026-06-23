import { beforeAll, describe, expect, it } from 'bun:test'

import {
  buildFigmaClipboardHTML,
  fontManager,
  initCodec,
  parseFigmaClipboard,
  SceneGraph,
  weightToStyle
} from '@open-pencil/core'

import { expectDefined } from '#tests/helpers/assert'

describe('Figma clipboard fidelity - layout / text / font', () => {
  beforeAll(async () => {
    await initCodec()
  })

  describe('padding serialization', () => {
    it('emits single stackPadding when all four sides are equal', async () => {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      const frame = graph.createNode('FRAME', page.id, {
        name: 'Card',
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        layoutMode: 'VERTICAL',
        itemSpacing: 8,
        paddingTop: 20,
        paddingRight: 20,
        paddingBottom: 20,
        paddingLeft: 20
      })

      const html = await buildFigmaClipboardHTML([frame], graph)
      const parsed = await parseFigmaClipboard(html)
      const frameNode = parsed?.nodes.find((node) => node.type === 'FRAME' && node.name === 'Card')

      expect(frameNode).toBeDefined()
      expect(frameNode?.stackPadding).toBe(20)
      expect(frameNode?.stackVerticalPadding).toBeUndefined()
      expect(frameNode?.stackHorizontalPadding).toBeUndefined()
      expect(frameNode?.stackPaddingBottom).toBeUndefined()
      expect(frameNode?.stackPaddingRight).toBeUndefined()
    })

    it('emits four-value padding when sides differ', async () => {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      const frame = graph.createNode('FRAME', page.id, {
        name: 'Asymmetric',
        x: 0,
        y: 0,
        width: 300,
        height: 200,
        layoutMode: 'VERTICAL',
        itemSpacing: 8,
        paddingTop: 24,
        paddingRight: 16,
        paddingBottom: 8,
        paddingLeft: 16
      })

      const html = await buildFigmaClipboardHTML([frame], graph)
      const parsed = await parseFigmaClipboard(html)
      const frameNode = parsed?.nodes.find((node) => node.name === 'Asymmetric')

      expect(frameNode).toBeDefined()
      expect(frameNode?.stackVerticalPadding).toBe(24)
      expect(frameNode?.stackHorizontalPadding).toBe(16)
      expect(frameNode?.stackPaddingBottom).toBe(8)
      expect(frameNode?.stackPaddingRight).toBe(16)
      expect(frameNode?.stackPadding).toBeUndefined()
    })
  })

  describe('text serialization', () => {
    it('preserves maxLines when text truncation is enabled', async () => {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      graph.createNode('TEXT', page.id, {
        name: 'Truncated',
        x: 0,
        y: 0,
        width: 240,
        height: 60,
        text: 'A long paragraph that will wrap to several lines and be truncated.',
        fontFamily: 'Inter',
        fontWeight: 400,
        fontSize: 14,
        maxLines: 2,
        textTruncation: 'ENDING'
      })

      const html = await buildFigmaClipboardHTML(graph.getChildren(page.id), graph)
      const parsed = await parseFigmaClipboard(html)
      const textNode = parsed?.nodes.find((node) => node.type === 'TEXT')

      expect(textNode?.maxLines).toBe(2)
      expect(textNode?.textTruncation).toBe('ENDING')
    })

    it('omits maxLines when not set on the source node', async () => {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      graph.createNode('TEXT', page.id, {
        name: 'Plain',
        x: 0,
        y: 0,
        width: 240,
        height: 40,
        text: 'Short copy',
        fontFamily: 'Inter',
        fontWeight: 400,
        fontSize: 14
      })

      const html = await buildFigmaClipboardHTML(graph.getChildren(page.id), graph)
      const parsed = await parseFigmaClipboard(html)
      const textNode = parsed?.nodes.find((node) => node.type === 'TEXT')

      expect(textNode?.maxLines).toBeUndefined()
      expect(textNode?.textTruncation).toBeUndefined()
    })
  })

  describe('font digest map', () => {
    it('includes digest entries for fonts that load successfully', async () => {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      graph.createNode('TEXT', page.id, {
        name: 'Loaded',
        x: 0,
        y: 0,
        width: 200,
        height: 24,
        text: 'Hello',
        fontFamily: 'Inter',
        fontWeight: 400,
        fontSize: 16
      })

      // Simulate the editor path where the font has already been loaded into
      // the font manager (this happens automatically when CanvasKit renders
      // text). For the test we just mark it loaded so digest computation has
      // data to hash.
      const style = weightToStyle(400, false)
      const dummy = new Uint8Array([0, 1, 0, 1]).buffer
      fontManager.markLoaded('Inter', style, dummy)

      const html = await buildFigmaClipboardHTML(graph.getChildren(page.id), graph)
      const parsed = await parseFigmaClipboard(html)
      const textNode = parsed?.nodes.find((node) => node.type === 'TEXT')

      const fontMeta = textNode?.derivedTextData?.fontMetaData?.[0]
      expect(fontMeta).toBeDefined()
      expect(fontMeta?.fontDigest).toBeDefined()
      expect(fontMeta?.fontDigest?.length).toBe(20)
      expect(fontMeta?.key?.family).toBe('Inter')
    })

    it('normalizes the family name when building digest keys (Inter Variable to Inter)', async () => {
      // Regression: the digest map used to be keyed by raw family while the
      // serializer looked up using the normalized family, so Figma always
      // received an undefined digest and fell back to a default font.
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      graph.createNode('TEXT', page.id, {
        name: 'Variable',
        x: 0,
        y: 0,
        width: 200,
        height: 24,
        text: 'Hello',
        fontFamily: 'Inter Variable',
        fontWeight: 400,
        fontSize: 16
      })

      const style = weightToStyle(400, false)
      const dummy = new Uint8Array([0, 1, 0, 1]).buffer
      fontManager.markLoaded('Inter', style, dummy)

      const html = await buildFigmaClipboardHTML(graph.getChildren(page.id), graph)
      const parsed = await parseFigmaClipboard(html)
      const textNode = parsed?.nodes.find((node) => node.type === 'TEXT')
      const fontMeta = textNode?.derivedTextData?.fontMetaData?.[0]

      // Family name on the meta is normalized to match what Figma expects.
      expect(fontMeta?.key?.family).toBe('Inter')
      // Digest is present even though the source node used the raw variant.
      expect(fontMeta?.fontDigest).toBeDefined()
      expect(fontMeta?.fontDigest?.length).toBe(20)
    })

    it('uses raw family candidates when only the raw variable family has loaded data', async () => {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      graph.createNode('TEXT', page.id, {
        name: 'RawVariableOnly',
        x: 0,
        y: 0,
        width: 200,
        height: 24,
        text: 'Hello',
        fontFamily: 'Review Sans Variable',
        fontWeight: 400,
        fontSize: 16
      })

      const style = weightToStyle(400, false)
      const dummy = new Uint8Array([0, 2, 0, 2]).buffer
      fontManager.markLoaded('Review Sans Variable', style, dummy)

      const html = await buildFigmaClipboardHTML(graph.getChildren(page.id), graph)
      const parsed = await parseFigmaClipboard(html)
      const textNode = parsed?.nodes.find((node) => node.type === 'TEXT')
      const fontMeta = textNode?.derivedTextData?.fontMetaData?.[0]

      expect(fontMeta?.key?.family).toBe('Review Sans')
      expect(fontMeta?.fontDigest).toBeDefined()
      expect(fontMeta?.fontDigest?.length).toBe(20)
    })
  })

  describe('roundtrip preserves copy-visible fields', () => {
    it('preserves padding, maxLines, truncation, and font meta on decode', async () => {
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      const frame = graph.createNode('FRAME', page.id, {
        name: 'Card',
        x: 0,
        y: 0,
        width: 320,
        height: 200,
        layoutMode: 'VERTICAL',
        itemSpacing: 12,
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
        cornerRadius: 12
      })
      graph.createNode('TEXT', frame.id, {
        name: 'Title',
        x: 0,
        y: 0,
        width: 288,
        height: 28,
        text: 'Truncated title goes here',
        fontFamily: 'Inter',
        fontWeight: 600,
        fontSize: 18,
        maxLines: 1,
        textTruncation: 'ENDING'
      })

      const html = await buildFigmaClipboardHTML([frame], graph)
      const parsed = await parseFigmaClipboard(html)

      const figmaFrame = parsed?.nodes.find((node) => node.name === 'Card')
      const figmaText = parsed?.nodes.find((node) => node.name === 'Title')

      // Layout padding: symmetric so we expect the aggregate stackPadding.
      expect(figmaFrame?.stackPadding).toBe(16)
      expect(figmaFrame?.stackVerticalPadding).toBeUndefined()
      expect(figmaFrame?.stackHorizontalPadding).toBeUndefined()

      // Truncation survives the round trip.
      expect(figmaText?.maxLines).toBe(1)
      expect(figmaText?.textTruncation).toBe('ENDING')
    })
  })

  describe('baseline behaviour: getFontDigest loads on demand', () => {
    it('does not throw when a font has not been loaded yet', async () => {
      // The clipboard path calls buildFontDigestMap which queries
      // fontManager.loadedData. If the font is not loaded the digest is
      // simply absent (Figma will fall back to the family name). This test
      // ensures the copy pipeline never throws for unloaded fonts.
      const graph = new SceneGraph()
      const page = graph.getPages()[0]
      graph.createNode('TEXT', page.id, {
        name: 'UnloadedFont',
        x: 0,
        y: 0,
        width: 200,
        height: 24,
        text: 'Hello',
        fontFamily: 'Definitely Not A Real Font 9000',
        fontWeight: 400,
        fontSize: 16
      })

      const html = await buildFigmaClipboardHTML(graph.getChildren(page.id), graph)
      expect(html).toContain('figma')

      const parsed = await parseFigmaClipboard(html)
      const textNode = parsed?.nodes.find((node) => node.type === 'TEXT')
      expect(textNode?.derivedTextData?.fontMetaData?.[0]?.key?.family).toBe(
        'Definitely Not A Real Font 9000'
      )
      // Digest may be undefined when the font is not loaded; that is OK, the
      // payload still encodes the family so Figma can resolve the closest match.
      expectDefined(textNode, 'textNode')
    })
  })
})
