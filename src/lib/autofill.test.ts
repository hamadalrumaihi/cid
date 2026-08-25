import { describe, expect, it } from 'vitest'
import { buildAutofill, diffForMasterUpdate, isBlank, mergeIdentityArrays } from './autofill'

describe('isBlank', () => {
  it('treats null / undefined / blank strings / empty arrays as empty', () => {
    expect(isBlank(null)).toBe(true)
    expect(isBlank(undefined)).toBe(true)
    expect(isBlank('')).toBe(true)
    expect(isBlank('   ')).toBe(true)
    expect(isBlank([])).toBe(true)
  })

  it('never treats 0 / false / populated values as empty', () => {
    expect(isBlank(0)).toBe(false)
    expect(isBlank(false)).toBe(false)
    expect(isBlank('x')).toBe(false)
    expect(isBlank(['x'])).toBe(false)
    expect(isBlank({})).toBe(false)
  })
})

describe('buildAutofill — master fills gaps, never replaces user input', () => {
  type Form = { name: string; phone: string; dob: string; tags: string[] }

  it('fills only fields empty in current and reports provenance', () => {
    const master: Partial<Form> = { name: 'Marcus Bell', phone: '555-0100', dob: '1990-01-01' }
    const current: Partial<Form> = { name: 'M. Bell', phone: '' }
    const r = buildAutofill<Form>(master, current)
    expect(r.values).toEqual({ name: 'M. Bell', phone: '555-0100', dob: '1990-01-01' })
    expect(r.provenance).toEqual({ name: 'user', phone: 'master', dob: 'master' })
    expect(r.missing).toEqual([])
  })

  it('empty = null/undefined/blank string/empty array; both-empty lands in missing', () => {
    const r = buildAutofill<Form>(
      { name: '', tags: [] },
      { name: '  ', phone: undefined as unknown as string, tags: [] },
    )
    expect(r.values).toEqual({})
    expect(r.provenance).toEqual({ name: 'empty', tags: 'empty', phone: 'empty' })
    expect(r.missing.sort()).toEqual(['name', 'phone', 'tags'])
  })

  it('a user-entered value always wins, even when master disagrees', () => {
    const r = buildAutofill<Form>({ phone: '555-9999' }, { phone: '555-0100' })
    expect(r.values.phone).toBe('555-0100')
    expect(r.provenance.phone).toBe('user')
  })
})

describe('diffForMasterUpdate — fill-the-gaps payload only', () => {
  type Person = { name: string; phone: string; dob: string; alias: string }

  it('returns only fields empty on master and non-empty in proposed', () => {
    const master: Partial<Person> = { name: 'Marcus Bell', phone: '', dob: '1990-01-01' }
    const proposed: Partial<Person> = { name: 'Different Name', phone: '555-0100', dob: '1991-02-02', alias: 'Ghost' }
    expect(diffForMasterUpdate<Person>(master, proposed)).toEqual({ phone: '555-0100', alias: 'Ghost' })
  })

  it('never writes blanks and never touches non-empty master values', () => {
    const master: Partial<Person> = { name: 'Kept', phone: '' }
    expect(diffForMasterUpdate<Person>(master, { name: '', phone: '   ', alias: '' })).toEqual({})
    expect(diffForMasterUpdate<Person>(master, { name: 'Overwrite attempt' })).toEqual({})
  })

  it('empty diff for an empty proposal', () => {
    expect(diffForMasterUpdate<Person>({ name: 'X' }, {})).toEqual({})
  })
})

describe('mergeIdentityArrays — append-only union over persons.identity', () => {
  it('appends new entries, dedupes case-insensitively, preserves existing order', () => {
    const merged = mergeIdentityArrays(
      { aliases: ['Ghost', 'Shadow'], street_names: [], license_ids: ['DL-1'] },
      { aliases: ['ghost', 'Wraith'], license_ids: ['dl-1', 'DL-2'] },
    )
    // Existing spelling wins; additions append in their given order.
    expect(merged.aliases).toEqual(['Ghost', 'Shadow', 'Wraith'])
    expect(merged.license_ids).toEqual(['DL-1', 'DL-2'])
    expect(merged.street_names).toEqual([])
  })

  it('never removes anything already stored', () => {
    const merged = mergeIdentityArrays({ aliases: ['Keep Me'] }, { aliases: [] })
    expect(merged.aliases).toEqual(['Keep Me'])
  })

  it('fills the free-text fields only when the master is empty', () => {
    const filled = mergeIdentityArrays({ occupation: '' }, { occupation: 'Mechanic', notes: 'seen at docks' })
    expect(filled.occupation).toBe('Mechanic')
    expect(filled.notes).toBe('seen at docks')
    const kept = mergeIdentityArrays({ occupation: 'Chemist', notes: 'existing' }, { occupation: 'Mechanic', notes: 'new' })
    expect(kept.occupation).toBe('Chemist')
    expect(kept.notes).toBe('existing')
  })

  it('degrades a malformed master row to empty instead of crashing (jsonShapes parser)', () => {
    const merged = mergeIdentityArrays('not-an-object', { aliases: ['Ghost', 42 as unknown as string, '  '] })
    expect(merged.aliases).toEqual(['Ghost']) // non-strings and blanks dropped
    expect(merged.street_names).toEqual([])
    expect(merged.occupation).toBe('')
  })
})
