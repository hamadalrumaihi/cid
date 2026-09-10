/** Pins the Trash's pure helpers: grouping, labels and the deep link a
 *  restored row lands on (P8-02). The RPC itself is covered by the RLS suite
 *  (v190a) and the MSW handler tests. */
import { describe, expect, it } from 'vitest'
import {
  TRASH_GROUPS, TRASH_KIND_LABEL, groupTrash, tableForKind, trashGroupOf, trashHref, trashKindLabel, trashReasonOffered,
  trashRowLabel, type TrashRow,
} from './trash'
import { SOFT_DELETE_KIND } from './db'

const row = (over: Partial<TrashRow>): TrashRow => ({
  kind: 'case_task', id: '11111111-2222-3333-4444-555555555555', label: 'Canvass the block', case_id: 'c1', case_number: 'CID-1',
  deleted_at: '2026-09-09T10:00:00Z', deleted_by: 'u1', deleted_by_name: 'Det. A', delete_reason: null, delete_batch: null,
  restorable: true, permanently_deletable: false, ...over,
})

describe('trash — kinds and groups', () => {
  it('labels every soft-delete kind the client knows and places it in exactly one group', () => {
    for (const kind of Object.values(SOFT_DELETE_KIND)) {
      expect(TRASH_KIND_LABEL[kind], `label for ${kind}`).toBeTruthy()
      expect(TRASH_GROUPS.filter((g) => g.kinds.includes(kind)), `group for ${kind}`).toHaveLength(1)
    }
  })
  it('maps kinds to groups, unknown kinds to Registry', () => {
    expect(trashGroupOf('case')).toBe('cases')
    expect(trashGroupOf('report')).toBe('material')
    expect(trashGroupOf('person')).toBe('registry')
    expect(trashGroupOf('person_vehicle')).toBe('links')
    expect(trashGroupOf('case_template')).toBe('admin')
    expect(trashGroupOf('commendation')).toBe('admin')
    expect(trashGroupOf('something_new')).toBe('registry')
  })
  it('labels the two administrative kinds that joined the soft-delete rule', () => {
    expect(TRASH_KIND_LABEL.case_template).toBe('Case template')
    expect(TRASH_KIND_LABEL.commendation).toBe('Commendation')
    expect(tableForKind('case_template')).toBe('case_templates')
    expect(tableForKind('commendation')).toBe('commendations')
  })
  it('degrades an unknown kind to a readable label', () => {
    expect(trashKindLabel('case_note')).toBe('Case note')
    expect(trashKindLabel('brand_new_kind')).toBe('Brand new kind')
  })
  it('groups rows in TRASH_GROUPS order, keeping the server order inside a group and omitting empty groups', () => {
    const rows = [
      row({ kind: 'person', id: 'p1', label: 'Ana' }),
      row({ kind: 'case_task', id: 't1', label: 'Task one' }),
      row({ kind: 'case', id: 'c9', label: 'CID-9' }),
      row({ kind: 'case_task', id: 't2', label: 'Task two' }),
    ]
    const grouped = groupTrash(rows)
    expect(grouped.map((g) => g.group.id)).toEqual(['cases', 'material', 'registry'])
    expect(grouped[1].rows.map((r) => r.id)).toEqual(['t1', 't2'])
  })
  it('inverts SOFT_DELETE_KIND', () => {
    expect(tableForKind('case_note')).toBe('case_notes')
    expect(tableForKind('person_vehicle')).toBe('person_vehicles')
    expect(tableForKind('nope')).toBeNull()
  })
  it('offers a reason on restore for the kinds whose delete required one', () => {
    expect(trashReasonOffered('person')).toBe(true)
    expect(trashReasonOffered('case_task')).toBe(false)
  })
})

describe('trashRowLabel — the server label with a fallback', () => {
  it('uses the server label when present', () => {
    expect(trashRowLabel(row({ label: 'CID-42' }))).toBe('CID-42')
  })
  it('falls back to kind + short id when the label is blank or just the id', () => {
    expect(trashRowLabel(row({ kind: 'person_vehicle', label: null }))).toBe('Person–vehicle link · 11111111')
    expect(trashRowLabel(row({ kind: 'case_link', label: '11111111-2222-3333-4444-555555555555' }))).toBe('Related-case link · 11111111')
    expect(trashRowLabel(row({ kind: 'gang_turf', label: '   ' }))).toBe('Gang turf · 11111111')
  })
})

describe('trashHref — where a restored row lives', () => {
  it('a case opens in the workspace', () => {
    expect(trashHref(row({ kind: 'case', id: 'c1', case_id: 'c1' }))).toBe('/workspace?case=c1')
  })
  it('case children open their case section (record param where the section supports it)', () => {
    expect(trashHref(row({ kind: 'case_task', id: 't1', case_id: 'c1' }))).toBe('/workspace?case=c1&tab=tasks&task=t1')
    expect(trashHref(row({ kind: 'report', id: 'r1', case_id: 'c1' }))).toBe('/workspace?case=c1&tab=reports&report=r1')
    expect(trashHref(row({ kind: 'evidence', id: 'e1', case_id: 'c1' }))).toBe('/workspace?case=c1&tab=media&evidence=e1')
    expect(trashHref(row({ kind: 'case_note', id: 'n1', case_id: 'c1' }))).toBe('/workspace?case=c1&tab=notes')
    expect(trashHref(row({ kind: 'predicate_act', id: 'a1', case_id: 'c1' }))).toBe('/workspace?case=c1&tab=rico')
  })
  it('registry rows open their tool — a record tab where one exists', () => {
    expect(trashHref(row({ kind: 'person', id: 'p1', case_id: null }))).toBe('/workspace?tool=persons&record=p1')
    expect(trashHref(row({ kind: 'vehicle', id: 'v1', case_id: null }))).toBe('/workspace?tool=vehicles&record=v1')
    expect(trashHref(row({ kind: 'account', id: 'a1', case_id: null }))).toBe('/workspace?tool=accounts')
    expect(trashHref(row({ kind: 'operation', id: 'o1', case_id: null }))).toBe('/operations?op=o1')
  })
  it('media without a case opens the vault; media with a case opens the case', () => {
    expect(trashHref(row({ kind: 'media', id: 'm1', case_id: null }))).toBe('/workspace?tool=media')
    expect(trashHref(row({ kind: 'media', id: 'm1', case_id: 'c1' }))).toBe('/workspace?case=c1&tab=media')
  })
  it('administrative rows open where they are managed', () => {
    expect(trashHref(row({ kind: 'case_template', id: 'tpl1', case_id: null }))).toBe('/cases?new=1')
    expect(trashHref(row({ kind: 'commendation', id: 'cm1', case_id: null }))).toBe('/personnel')
  })
  it('link rows fall back to their case, or have no address', () => {
    expect(trashHref(row({ kind: 'gang_member', id: 'g1', case_id: 'c1' }))).toBe('/workspace?case=c1')
    expect(trashHref(row({ kind: 'person_vehicle', id: 'l1', case_id: null }))).toBeNull()
  })
})
