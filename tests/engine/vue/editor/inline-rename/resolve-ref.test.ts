import { describe, expect, test } from 'bun:test'

import { pickInput } from '#vue/editor/inline-rename/resolve-ref'

function makeInput(): HTMLInputElement {
  return { focus: () => {} } as unknown as HTMLInputElement
}

describe('pickInput (resolve-ref)', () => {
  test('returns the element when ref is a single HTMLInputElement', () => {
    const el = makeInput()
    expect(pickInput(el)).toBe(el)
  })

  test('returns the first element when ref is a non-empty array', () => {
    const first = makeInput()
    const second = makeInput()
    expect(pickInput([first, second])).toBe(first)
  })

  test('returns null when ref is an empty array', () => {
    expect(pickInput([])).toBeNull()
  })

  test('returns null when ref is null', () => {
    expect(pickInput(null)).toBeNull()
  })

  test('returns the element when ref is a single-element array', () => {
    const el = makeInput()
    expect(pickInput([el])).toBe(el)
  })
})
