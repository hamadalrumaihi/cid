import { describe, expect, it } from 'vitest'
import { parseFormValues, parseStringArray } from './jsonShapes'


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
