import { describe, expect, it } from 'vitest'
import {
  PERSON_COMPLETION_FIELDS, appendNoteLines, caseOnlyNoteLines, splitCompletionFields,
  type PersonCompletionRow,
} from './personCompletion'

const row = (over: PersonCompletionRow = {}): PersonCompletionRow => ({
  dob: null, phone: null, alias: null, classification: null, status: null, ...over,
})

describe('PERSON_COMPLETION_FIELDS', () => {
  it('is the stable editable vocabulary, in display order', () => {
    expect(PERSON_COMPLETION_FIELDS.map((f) => f.key))
      .toEqual(['dob', 'phone', 'alias', 'classification', 'status'])
  })
})

describe('splitCompletionFields', () => {
  it('splits present vs missing by isBlank semantics', () => {
    const { present, missing } = splitCompletionFields(row({ phone: '555-0100', status: 'Person of Interest' }))
    expect(present.map((p) => [p.def.key, p.value]))
      .toEqual([['phone', '555-0100'], ['status', 'Person of Interest']])
    expect(missing.map((f) => f.key)).toEqual(['dob', 'alias', 'classification'])
  })

  it('treats whitespace-only and empty strings as missing', () => {
    const { missing } = splitCompletionFields(row({ alias: '   ', status: '' }))
    expect(missing.map((f) => f.key)).toEqual(['dob', 'phone', 'alias', 'classification', 'status'])
  })

  it('clips dob timestamps to the date and trims values', () => {
    const { present } = splitCompletionFields(row({ dob: '1990-01-01T00:00:00Z', alias: ' Ghost ' }))
    expect(present.map((p) => [p.def.key, p.value])).toEqual([['dob', '1990-01-01'], ['alias', 'Ghost']])
  })

  it('an all-empty row is entirely missing', () => {
    const { present, missing } = splitCompletionFields(row())
    expect(present).toEqual([])
    expect(missing).toHaveLength(PERSON_COMPLETION_FIELDS.length)
  })
})

describe('caseOnlyNoteLines', () => {
  it('formats provenance-labelled lines in field order, skipping blanks', () => {
    expect(caseOnlyNoteLines({ status: 'Suspect', dob: '1990-01-01', alias: '' }))
      .toEqual(['DOB (case record): 1990-01-01', 'Status (case record): Suspect'])
  })

  it('trims values and returns [] for an empty proposal', () => {
    expect(caseOnlyNoteLines({ phone: ' 555-0100 ' })).toEqual(['Phone (case record): 555-0100'])
    expect(caseOnlyNoteLines({})).toEqual([])
    expect(caseOnlyNoteLines({ phone: '  ' })).toEqual([])
  })
})

describe('appendNoteLines', () => {
  it('appends to an existing note with a "; " separator', () => {
    expect(appendNoteLines('Seen at the docks', ['DOB (case record): 1990-01-01']))
      .toBe('Seen at the docks; DOB (case record): 1990-01-01')
  })

  it('starts fresh when the note is blank (whitespace included)', () => {
    expect(appendNoteLines('', ['A', 'B'])).toBe('A; B')
    expect(appendNoteLines('   ', ['A'])).toBe('A')
  })

  it('returns the note unchanged when there are no lines', () => {
    expect(appendNoteLines('keep me', [])).toBe('keep me')
  })

  it('case-only round-trip: provenance lines land after existing note text, and a second pass appends again (append-only, never rewrites)', () => {
    // The LinkedPersonPanel "Case only" flow composes these two helpers: the
    // investigator's own note text must survive verbatim, and adding another
    // field later appends rather than reformatting what is already there.
    const first = appendNoteLines('Seen at the docks', caseOnlyNoteLines({ dob: '1990-01-01', alias: ' Ghost ' }))
    expect(first).toBe('Seen at the docks; DOB (case record): 1990-01-01; Alias (case record): Ghost')
    const second = appendNoteLines(first, caseOnlyNoteLines({ phone: '555-0100' }))
    expect(second).toBe(
      'Seen at the docks; DOB (case record): 1990-01-01; Alias (case record): Ghost; Phone (case record): 555-0100',
    )
  })
})
