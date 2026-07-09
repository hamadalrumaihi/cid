import { describe, expect, it } from 'vitest'
import { parseCharges, parseFormValues, parseStringArray } from './jsonShapes'

describe('parseCharges', () => {
  it('keeps well-formed entries and defaults count to 1', () => {
    expect(parseCharges([{ code: 'PC-101', count: 3 }, { code: 'PC-102' }]))
      .toEqual([{ code: 'PC-101', count: 3 }, { code: 'PC-102', count: 1 }])
  })
  it('drops malformed entries and repairs bad counts', () => {
    expect(parseCharges([null, 'PC-101', { count: 2 }, { code: '' }, { code: 'PC-103', count: -4 }, { code: 'PC-104', count: 'two' }]))
      .toEqual([{ code: 'PC-103', count: 1 }, { code: 'PC-104', count: 1 }])
  })
  it('degrades non-arrays to []', () => {
    expect(parseCharges(null)).toEqual([])
    expect(parseCharges({ code: 'PC-101' })).toEqual([])
    expect(parseCharges('[]')).toEqual([])
  })
})

describe('parseFormValues', () => {
  it('passes plain objects through', () => {
    expect(parseFormValues({ narrative: 'x', rows: [{ a: 1 }] })).toEqual({ narrative: 'x', rows: [{ a: 1 }] })
  })
  it('degrades arrays, scalars and null to {}', () => {
    expect(parseFormValues(null)).toEqual({})
    expect(parseFormValues([1, 2])).toEqual({})
    expect(parseFormValues('nope')).toEqual({})
  })
})

describe('parseStringArray', () => {
  it('keeps only string elements', () => {
    expect(parseStringArray(['a', 1, null, 'b', {}])).toEqual(['a', 'b'])
  })
  it('degrades non-arrays to []', () => {
    expect(parseStringArray('a,b')).toEqual([])
    expect(parseStringArray(null)).toEqual([])
  })
})
