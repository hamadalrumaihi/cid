import { describe, expect, it } from 'vitest'
import { actionVerb, differingObservations, entityKindLabel, orderNotes, writeRefusal } from './sectionShared'

describe('differingObservations', () => {
  const master = { id: 'p1', name: 'Ray', phone: '555-0100', aliases: ['Ray-Ray'] }
  it('keeps only the latest observation per field whose value differs from the record', () => {
    const rows = [
      { id: 'o3', field: 'phone', value: '555-0142' }, // newest — differs
      { id: 'o2', field: 'phone', value: '555-0100' }, // older, superseded
      { id: 'o1', field: 'name', value: 'Ray' },       // same as the record
    ]
    expect(differingObservations(master, rows).map((o) => o.id)).toEqual(['o3'])
  })
  it('compares array fields by their joined text and trims whitespace', () => {
    expect(differingObservations(master, [{ id: 'a', field: 'aliases', value: ' Ray-Ray ' }])).toEqual([])
    expect(differingObservations(master, [{ id: 'b', field: 'aliases', value: 'Razor' }])).toHaveLength(1)
  })
  it('answers nothing when the master record is unreadable', () => {
    expect(differingObservations(undefined, [{ id: 'a', field: 'phone', value: 'x' }])).toEqual([])
  })
})

describe('writeRefusal', () => {
  it('reads 42501, an error message, and ZERO ROWS all as refusals', () => {
    expect(writeRefusal({ data: null, error: { message: 'denied', code: '42501' } })).toMatch(/not permitted/)
    expect(writeRefusal({ data: null, error: { message: 'boom' } })).toBe('boom')
    expect(writeRefusal({ data: [], error: null })).toMatch(/refused/)
    expect(writeRefusal({ data: [{}], error: null })).toBeNull()
  })
})

describe('feed wording', () => {
  it('turns audit actions into verbs', () => {
    expect(actionVerb('INSERT')).toBe('added')
    expect(actionVerb('CASE_ARCHIVED')).toBe('case archived')
  })
  it('names entity kinds', () => {
    expect(entityKindLabel('case_intel_link')).toBe('intel link')
    expect(entityKindLabel('raid_compensation')).toBe('raid compensation')
    expect(entityKindLabel('some_thing')).toBe('some thing')
  })
})

describe('orderNotes', () => {
  it('puts pinned notes first, newest first within each group', () => {
    const rows = [
      { id: 'a', pinned: false, created_at: '2026-09-01T00:00:00Z' },
      { id: 'b', pinned: true, created_at: '2026-08-01T00:00:00Z' },
      { id: 'c', pinned: false, created_at: '2026-09-02T00:00:00Z' },
      { id: 'd', pinned: true, created_at: '2026-08-15T00:00:00Z' },
    ]
    expect(orderNotes(rows).map((r) => r.id)).toEqual(['d', 'b', 'c', 'a'])
  })
})
