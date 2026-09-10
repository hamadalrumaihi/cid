import { describe, expect, it } from 'vitest'
import type { FormSchema } from './forms'
import { canEditNarrativeOnMobile, mergeNarrativeFields, narrativeSections } from './reportNarrative'

const schema: FormSchema = {
  title: 'T', subtitle: '',
  sections: [
    { id: 'details', label: 'Details', type: 'kv', fields: [{ key: 'case_number', label: 'Case', type: 'text' }] },
    { id: 'narr', label: 'Narrative', type: 'textarea', key: 'narrative' },
    { id: 'media', label: 'Media', type: 'textarea', key: 'media_refs', mediaPick: true },
    { id: 'note', label: 'Note', type: 'note', text: 'x' },
    { id: 'concl', label: 'Conclusion', type: 'textarea', key: 'conclusion' },
    { id: 'grid', label: 'Grid', type: 'grid', cols: [{ key: 'a', label: 'A' }] },
  ],
}

describe('narrativeSections', () => {
  it('keeps textarea sections and drops media pick-lists, kv, grid and notes', () => {
    expect(narrativeSections(schema).map((s) => s.key)).toEqual(['narrative', 'conclusion'])
  })
  it('answers nothing for a missing schema', () => {
    expect(narrativeSections(null)).toEqual([])
    expect(narrativeSections(undefined)).toEqual([])
  })
})

describe('mergeNarrativeFields', () => {
  it('replaces only the given key and keeps every other key', () => {
    const fields = { case_number: 'C-1', narrative: 'old', _warrant_log: [{ at: '2026' }], grid: [{ a: '1' }] }
    const out = mergeNarrativeFields(fields, 'narrative', 'new')
    expect(out).toEqual({ case_number: 'C-1', narrative: 'new', _warrant_log: [{ at: '2026' }], grid: [{ a: '1' }] })
    expect(out._warrant_log).toBe(fields._warrant_log) // carried over, not cloned
  })
  it('returns a new object and leaves the input untouched', () => {
    const fields = { narrative: 'old' }
    const out = mergeNarrativeFields(fields, 'narrative', 'new')
    expect(out).not.toBe(fields)
    expect(fields.narrative).toBe('old')
  })
  it('adds the key when it did not exist', () => {
    expect(mergeNarrativeFields({ a: 1 }, 'conclusion', 'done')).toEqual({ a: 1, conclusion: 'done' })
  })
  it('starts from an empty object for null, arrays and legacy strings', () => {
    expect(mergeNarrativeFields(null, 'n', 'x')).toEqual({ n: 'x' })
    expect(mergeNarrativeFields('legacy', 'n', 'x')).toEqual({ n: 'x' })
    expect(mergeNarrativeFields([1, 2], 'n', 'x')).toEqual({ n: 'x' })
  })
})

describe('canEditNarrativeOnMobile', () => {
  const me = 'u1'
  it('allows the author while draft or returned', () => {
    expect(canEditNarrativeOnMobile({ author_id: me, review_status: 'draft', finalized: false }, me)).toBe(true)
    expect(canEditNarrativeOnMobile({ author_id: me, review_status: 'returned', finalized: false }, me)).toBe(true)
  })
  it('refuses anyone but the author', () => {
    expect(canEditNarrativeOnMobile({ author_id: 'u2', review_status: 'draft', finalized: false }, me)).toBe(false)
    expect(canEditNarrativeOnMobile({ author_id: me, review_status: 'draft', finalized: false }, null)).toBe(false)
    expect(canEditNarrativeOnMobile({ author_id: me, review_status: 'draft', finalized: false }, undefined)).toBe(false)
  })
  it('refuses submitted, approved, finalized and deleted reports', () => {
    expect(canEditNarrativeOnMobile({ author_id: me, review_status: 'submitted', finalized: false }, me)).toBe(false)
    expect(canEditNarrativeOnMobile({ author_id: me, review_status: 'approved', finalized: false }, me)).toBe(false)
    expect(canEditNarrativeOnMobile({ author_id: me, review_status: 'draft', finalized: true }, me)).toBe(false)
    expect(canEditNarrativeOnMobile({ author_id: me, review_status: 'draft', finalized: false, deleted_at: '2026-01-01' }, me)).toBe(false)
  })
  it('treats a missing review_status as draft (pre-column rows)', () => {
    expect(canEditNarrativeOnMobile({ author_id: me, review_status: null, finalized: false }, me)).toBe(true)
    expect(canEditNarrativeOnMobile({ author_id: me, review_status: 'weird', finalized: false }, me)).toBe(true)
  })
})
