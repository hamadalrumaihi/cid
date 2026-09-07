/** Pins for the narrative mention grammar and the report-entity helpers
 *  (P5-04 / P5-05): token round-trip, entity-row derivation, the
 *  "differs from record" marker and the REPLACE-semantics merge. */
import { describe, expect, it } from 'vitest'
import {
  MENTION_RE, RESTRICTED_LABEL, detectEditedEntities, entityKey, markEdited, mentionEntityRows, mentionKey,
  mentionToken, mentionsToText, mergeEntityItems, parseMentions, splitMentions, withMentionLabels, type EntityItem,
} from './mentions'

const P = '11111111-2222-4333-8444-555555555555'
const V = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

describe('token grammar', () => {
  it('serialises and parses back the same ref (lower-cased id)', () => {
    const tok = mentionToken('person', P.toUpperCase())
    expect(tok).toBe(`[person:${P}]`)
    expect(parseMentions(`Seen with ${tok} at the drop.`)).toEqual([{ kind: 'person', id: P }])
  })

  it('accepts every EntityLink kind, case-insensitively, and dedupes', () => {
    const md = `[Person:${P}] [vehicle:${V}] [gang:${P}] [place:${V}] [case:${P}] [narcotic:${V}] [person:${P.toUpperCase()}]`
    expect(parseMentions(md).map((r) => r.kind)).toEqual(['person', 'vehicle', 'gang', 'place', 'case', 'narcotic'])
  })

  it('ignores brackets that are not tokens (links, media refs, unknown kinds, non-uuids)', () => {
    expect(parseMentions(`[media:${P}] [officer:${P}] [person:not-a-uuid] [Weapons](https://x.y) [person]`)).toEqual([])
    expect(MENTION_RE.test(`[account:${P}]`)).toBe(false)
  })

  it('splitMentions keeps literal text and order', () => {
    expect(splitMentions(`a [person:${P}] b [vehicle:${V}]`)).toEqual(['a ', { kind: 'person', id: P }, ' b ', { kind: 'vehicle', id: V }])
    expect(splitMentions('plain')).toEqual(['plain'])
  })

  it('mentionsToText flattens to labels and never prints an id', () => {
    const out = mentionsToText(`Met [person:${P}] and [vehicle:${V}].`, { [mentionKey('person', P)]: 'John Doe' })
    expect(out).toBe(`Met John Doe and ${RESTRICTED_LABEL}.`)
    expect(out).not.toContain(V)
  })
})

describe('entity derivation', () => {
  it('mentionEntityRows emits one role-mention row per LABELLED token', () => {
    const rows = mentionEntityRows(`[person:${P}] [person:${P}] [vehicle:${V}]`, { [mentionKey('person', P)]: 'John Doe', [mentionKey('vehicle', V)]: null })
    expect(rows).toEqual([{ kind: 'person', ref_id: P, role: 'mention', label: 'John Doe', snapshot: { label: 'John Doe' }, edited: false }])
  })

  it('withMentionLabels folds entity rows in without overriding resolved labels', () => {
    const labels = withMentionLabels({ [mentionKey('person', P)]: 'Live name' }, [
      { kind: 'person', ref_id: P, label: 'Snapshot name' },
      { kind: 'vehicle', ref_id: V, label: 'ABC123' },
      { kind: 'evidence', ref_id: V, label: 'not a mention kind' },
      { kind: 'gang', ref_id: null, label: 'no ref' },
    ])
    expect(labels).toEqual({ [mentionKey('person', P)]: 'Live name', [mentionKey('vehicle', V)]: 'ABC123' })
  })
})

const subject: EntityItem = { kind: 'person', ref_id: P, role: 'subject', label: 'John Doe', snapshot: {}, edited: false }
const mention: EntityItem = { kind: 'person', ref_id: P, role: 'mention', label: 'John Doe', snapshot: {}, edited: false }
const event: EntityItem = { kind: 'timeline_event', ref_id: null, role: 'event', label: 'Arrest logged', snapshot: {}, edited: false }

describe('edited marker and merge', () => {
  it('entityKey separates roles and keys ref-less items by label', () => {
    expect(entityKey(subject)).not.toBe(entityKey(mention))
    expect(entityKey(event)).toBe('timeline_event:label=Arrest logged:event')
  })

  it('markEdited flips exactly the keyed item and returns a new array', () => {
    const out = markEdited([subject, mention], entityKey(subject))
    expect(out[0].edited).toBe(true)
    expect(out[1].edited).toBe(false)
    expect(out).not.toBe([subject, mention])
    expect(markEdited([subject], 'nope')).toEqual([subject])
  })

  it('detectEditedEntities flags inserted items whose label left the text, never mentions', () => {
    const out = detectEditedEntities([subject, mention, event], 'Arrest logged yesterday.')
    expect(out.map((e) => e.edited)).toEqual([true, false, false])
  })

  it('merge upserts by key; mentions mode replaces only the mention rows', () => {
    const current = [subject, mention, event]
    const merged = mergeEntityItems(current, [{ ...subject, snapshot: { fresh: true } }])
    expect(merged).toHaveLength(3)
    expect(merged.find((e) => e.role === 'subject')?.snapshot).toEqual({ fresh: true })
    const newMention: EntityItem = { kind: 'vehicle', ref_id: V, role: 'mention', label: 'ABC123', snapshot: {}, edited: false }
    const swapped = mergeEntityItems(current, [newMention], 'mentions')
    expect(swapped.map(entityKey)).toEqual([entityKey(subject), entityKey(event), entityKey(newMention)])
  })
})
