import { describe, expect, test } from 'bun:test'

import { check } from '../src/check'

describe('tauri-config-check', () => {
  test('passes when dragDropEnabled is false', async () => {
    const result = await check({
      app: { windows: [{ title: 'Test', dragDropEnabled: false }] }
    })
    expect(result.failures).toEqual([])
  })

  test('fails when dragDropEnabled is missing', async () => {
    const result = await check({ app: { windows: [{ title: 'Test' }] } })
    expect(result.failures.length).toBeGreaterThan(0)
    expect(result.failures[0]).toContain('dragDropEnabled')
  })

  test('fails when dragDropEnabled is true', async () => {
    const result = await check({
      app: { windows: [{ title: 'Test', dragDropEnabled: true }] }
    })
    expect(result.failures.length).toBeGreaterThan(0)
    expect(result.failures[0]).toContain('#292')
  })

  test('fails when there are no windows', async () => {
    const result = await check({ app: { windows: [] } })
    expect(result.failures.length).toBeGreaterThan(0)
  })

  test('checks every window entry independently', async () => {
    const result = await check({
      app: {
        windows: [
          { title: 'Main', dragDropEnabled: false },
          { title: 'Aux', dragDropEnabled: true }
        ]
      }
    })
    expect(result.failures.length).toBe(1)
    expect(result.failures[0]).toContain('Aux')
  })
})