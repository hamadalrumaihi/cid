/** Pins for the Phase 8 Trash mock handlers (scratch p8_contract.md §1 / §3):
 *  the 27-kind vocabulary taken from db.ts's SOFT_DELETE_KIND; the caller's
 *  Trash = the soft-deleted rows they could restore (a detective: their own
 *  case material; the Bureau Lead of the case bureau: every deleted row of
 *  the bureau's cases; the outsider: nothing; the Owner: everything); the
 *  row shape (label fallback order, case_id / case_number, deleted_by_name,
 *  restorable, permanently_deletable = Owner); the kind filter and its
 *  raise; the limit clamp; newest first; `trash_count` = the list's size;
 *  a denied table contributing nothing; a deleted case's children staying
 *  listed; the explicit routes registered before the generic rpc
 *  catch-all. Called directly against the mock store — no MSW server. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { SOFT_DELETE_KIND } from '@/lib/db'
import { caseNoteRow, caseRow, caseTaskRow, mediaRow, personRow, profileRow, roleSession } from '../fixtures'
import { mockTimestamp, resetMockStore, seedRows, setDenial, setSession } from '../store'
import { handlers } from './index'
import {
  TRASH_COUNT_CAP, TRASH_KINDS, TRASH_LABEL_COLUMNS, TRASH_TABLE_OF_KIND, TrashRpcError, canRestoreAs, isTrashKind, trashCaseIdOf, trashCount,
  trashHandlers, trashLabelOf, trashList,
} from './trash'

const asUser = (p: Tables<'profiles'> | null) => setSession(p ? { userId: p.id, email: p.email ?? 'x@cid.test', password: 'mock-password' } : null)
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort()

/** The cast: an MCB detective (the session), an SCB detective, the MCB
 *  Bureau Lead, the Owner and an inactive member. */
function cast() {
  const me = roleSession('detective')
  const [other, lead, owner, inactive] = seedRows('profiles', [
    profileRow({ display_name: 'Det. Other', division: 'street_crimes' }),
    profileRow({ role: 'bureau_lead', display_name: 'Lt. Lead' }),
    profileRow({ is_owner: true, display_name: 'The Owner' }),
    profileRow({ active: false, display_name: 'Inactive' }),
  ])
  return { me: me.profile, other, lead, owner, inactive }
}
type Cast = ReturnType<typeof cast>

/** An MCB case led and created by `me`, one deleted task (by me), one deleted
 *  note (by me) and one live task. */
function trashedCaseMaterial(c: Cast, deletedAt = mockTimestamp(-10)) {
  const [kase] = seedRows('cases', [caseRow({ case_number: 'MCB-4000901', lead_detective_id: c.me.id, created_by: c.me.id })])
  const [task] = seedRows('case_tasks', [caseTaskRow({
    case_id: kase.id, title: 'Canvass the pier', created_by: c.me.id,
    deleted_at: deletedAt, deleted_by: c.me.id, delete_batch: 'batch-1', delete_reason: null,
  })])
  const [note] = seedRows('case_notes', [caseNoteRow({
    case_id: kase.id, author_id: c.me.id, body_md: 'Seen at the pier.',
    deleted_at: mockTimestamp(-5), deleted_by: c.me.id, delete_batch: 'batch-2',
  })])
  const [live] = seedRows('case_tasks', [caseTaskRow({ case_id: kase.id, title: 'Still open', created_by: c.me.id })])
  return { kase, task, note, live }
}

describe('trash — vocabulary and helpers', () => {
  beforeEach(() => resetMockStore())

  it('the kind → table map is the inverse of db.ts SOFT_DELETE_KIND (27 kinds, never a second vocabulary)', () => {
    const inverse = Object.fromEntries(Object.entries(SOFT_DELETE_KIND).map(([table, kind]) => [kind, table]))
    expect(TRASH_TABLE_OF_KIND).toEqual(inverse)
    expect(TRASH_KINDS).toHaveLength(27)
    expect(isTrashKind('case_note')).toBe(true)
    expect(isTrashKind('legal')).toBe(false)
  })

  it('the label follows the server fallback: case_number → name → plate → title → label → item_code → value → code → id', () => {
    expect([...TRASH_LABEL_COLUMNS]).toEqual(['case_number', 'name', 'plate', 'title', 'label', 'item_code', 'value', 'code'])
    expect(trashLabelOf({ id: 'x', case_number: 'MCB-1', name: 'Ana' })).toBe('MCB-1')
    expect(trashLabelOf({ id: 'x', name: 'Ana', plate: 'ABC' })).toBe('Ana')
    expect(trashLabelOf({ id: 'x', plate: ' 46ABC123 ', title: 'T' })).toBe('46ABC123')
    expect(trashLabelOf({ id: 'x', title: 'Pull CCTV' })).toBe('Pull CCTV')
    expect(trashLabelOf({ id: 'x', label: 'L' })).toBe('L')
    expect(trashLabelOf({ id: 'x', item_code: 'EV-7' })).toBe('EV-7')
    expect(trashLabelOf({ id: 'x', value: '555-0100' })).toBe('555-0100')
    expect(trashLabelOf({ id: 'x', code: 'K9' })).toBe('K9')
    expect(trashLabelOf({ id: 'x', body_md: 'a note', name: '   ' })).toBe('x')
  })

  it('the governing case: the case itself, the row\'s case_id, the RICO parent\'s case, else null', () => {
    const [kase] = seedRows('cases', [caseRow()])
    const [rico] = seedRows('rico_cases', [{ case_id: kase.id, id: 'rico-1' } as unknown as Tables<'rico_cases'>])
    expect(trashCaseIdOf('cases', { id: kase.id })).toBe(kase.id)
    expect(trashCaseIdOf('case_notes', { id: 'n', case_id: kase.id })).toBe(kase.id)
    expect(trashCaseIdOf('case_links', { id: 'l', case_id: kase.id })).toBe(kase.id)
    expect(trashCaseIdOf('predicate_acts', { id: 'p', rico_case_id: rico.id })).toBe(kase.id)
    expect(trashCaseIdOf('predicate_acts', { id: 'p', rico_case_id: 'missing' })).toBeNull()
    expect(trashCaseIdOf('persons', { id: 'per', case_id: 'ignored' })).toBeNull()
    expect(trashCaseIdOf('case_tasks', { id: 't' })).toBeNull()
  })
})

describe('trash_list — who sees what', () => {
  beforeEach(() => resetMockStore())

  it('a signed-out or inactive caller reads zero rows and counts 0', () => {
    const c = cast()
    trashedCaseMaterial(c)
    asUser(null)
    expect(trashList()).toEqual([])
    expect(trashCount()).toBe(0)
    asUser(c.inactive)
    expect(trashList()).toEqual([])
    expect(trashCount()).toBe(0)
  })

  it('a detective reads their own deleted task and note with the client\'s row shape; the live task is not in the Trash', () => {
    const c = cast()
    const { kase, task, note, live } = trashedCaseMaterial(c)
    asUser(c.me)
    const rows = trashList()
    expect(ids(rows)).toEqual(ids([task, note]))
    expect(rows.some((r) => r.id === live.id)).toBe(false)
    const t = rows.find((r) => r.id === task.id)!
    expect(t).toEqual({
      kind: 'case_task', id: task.id, label: 'Canvass the pier', case_id: kase.id, case_number: 'MCB-4000901',
      deleted_at: task.deleted_at, deleted_by: c.me.id, deleted_by_name: c.me.display_name, delete_reason: null,
      delete_batch: 'batch-1', restorable: true, permanently_deletable: false,
    })
    const n = rows.find((r) => r.id === note.id)!
    expect(n.kind).toBe('case_note')
    expect(n.label, 'no label column → the id').toBe(note.id)
    expect(n.case_number).toBe('MCB-4000901')
  })

  it('newest first: the note (deleted 5 min ago) precedes the task (10 min ago)', () => {
    const c = cast()
    const { task, note } = trashedCaseMaterial(c)
    asUser(c.me)
    expect(trashList().map((r) => r.id)).toEqual([note.id, task.id])
  })

  it('the outsider in the other bureau reads none of it; the case bureau\'s Bureau Lead reads all of it (not permanently deletable)', () => {
    const c = cast()
    const { task, note } = trashedCaseMaterial(c)
    asUser(c.other)
    expect(trashList()).toEqual([])
    expect(trashCount()).toBe(0)
    asUser(c.lead)
    const rows = trashList()
    expect(ids(rows)).toEqual(ids([task, note]))
    expect(rows.every((r) => r.permanently_deletable === false && r.restorable === true)).toBe(true)
  })

  it('the Owner reads everything — including a deleted registry person no detective may restore — as permanently deletable', () => {
    const c = cast()
    const { task, note } = trashedCaseMaterial(c)
    const [person] = seedRows('persons', [personRow({ name: 'Tommy Vercelli', deleted_at: mockTimestamp(-1), deleted_by: c.lead.id, delete_reason: 'duplicate' })])
    asUser(c.me)
    expect(trashList().some((r) => r.id === person.id), 'a detective cannot restore a registry row').toBe(false)
    asUser(c.lead)
    expect(trashList().find((r) => r.id === person.id)).toMatchObject({ kind: 'person', label: 'Tommy Vercelli', case_id: null, case_number: null, deleted_by_name: 'Lt. Lead', delete_reason: 'duplicate' })
    asUser(c.owner)
    const rows = trashList()
    expect(ids(rows)).toEqual(ids([task, note, person]))
    expect(rows.every((r) => r.permanently_deletable)).toBe(true)
    expect(trashCount()).toBe(3)
  })

  it('a deleted case is listed for command only; its cascaded child stays listed for its author (case access evaluated as if live)', () => {
    const c = cast()
    const [kase] = seedRows('cases', [caseRow({
      case_number: 'MCB-4000902', lead_detective_id: c.me.id, created_by: c.me.id,
      deleted_at: mockTimestamp(-2), deleted_by: c.lead.id, delete_reason: 'opened in error', delete_batch: 'b-case',
    })])
    const [child] = seedRows('case_tasks', [caseTaskRow({ case_id: kase.id, title: 'Child', created_by: c.me.id, deleted_at: mockTimestamp(-2), deleted_by: c.lead.id, delete_batch: 'b-case' })])
    asUser(c.me)
    const mine = trashList()
    expect(mine.map((r) => r.id)).toEqual([child.id])
    expect(mine[0]).toMatchObject({ kind: 'case_task', case_id: kase.id, case_number: 'MCB-4000902', delete_batch: 'b-case' })
    asUser(c.lead)
    const theirs = trashList()
    expect(ids(theirs)).toEqual(ids([kase, child]))
    expect(theirs.find((r) => r.id === kase.id)).toMatchObject({ kind: 'case', label: 'MCB-4000902', case_id: kase.id, case_number: 'MCB-4000902', deleted_by_name: 'Lt. Lead' })
    asUser(c.other)
    expect(trashList()).toEqual([])
  })

  it('deleted_by_name is null when the deleter has no profile row; case_number is null when the case is gone', () => {
    const c = cast()
    const [task] = seedRows('case_tasks', [caseTaskRow({ case_id: 'no-such-case', title: 'Orphan', created_by: c.me.id, deleted_at: mockTimestamp(-1), deleted_by: 'ghost' })])
    asUser(c.owner)
    const [row] = trashList()
    expect(row.id).toBe(task.id)
    expect(row).toMatchObject({ deleted_by: 'ghost', deleted_by_name: null, case_id: 'no-such-case', case_number: null })
    // Without case access the author cannot restore an orphaned child.
    asUser(c.me)
    expect(trashList()).toEqual([])
  })
})

describe('trash_list — kind filter, limit, count, denials', () => {
  beforeEach(() => resetMockStore())

  it('p_kind narrows to one kind (trimmed, case-insensitive); an unknown kind raises "unknown record kind" before anything is read', () => {
    const c = cast()
    const { task, note } = trashedCaseMaterial(c)
    asUser(c.me)
    expect(trashList({ p_kind: 'case_task' }).map((r) => r.id)).toEqual([task.id])
    expect(trashList({ p_kind: '  Case_Note ' }).map((r) => r.id)).toEqual([note.id])
    expect(trashList({ p_kind: 'person' })).toEqual([])
    expect(trashList({ p_kind: null })).toHaveLength(2)
    expect(() => trashList({ p_kind: 'bogus' })).toThrow(TrashRpcError)
    expect(() => trashList({ p_kind: 'legal' })).toThrow(/unknown record kind/)
    asUser(null)
    expect(() => trashList({ p_kind: 'bogus' })).toThrow(/unknown record kind/)
  })

  it('p_limit is clamped to 1–500 across all kinds and applied after the newest-first sort', () => {
    const c = cast()
    const { note } = trashedCaseMaterial(c)
    asUser(c.me)
    expect(trashList({ p_limit: 1 }).map((r) => r.id)).toEqual([note.id])
    expect(trashList({ p_limit: 0 })).toHaveLength(1)
    expect(trashList({ p_limit: -5 })).toHaveLength(1)
    expect(trashList({ p_limit: 'nonsense' })).toHaveLength(2)
    expect(trashList({ p_limit: 10_000 })).toHaveLength(2)
  })

  it('trash_count() is the size of trash_list() for the caller', () => {
    const c = cast()
    trashedCaseMaterial(c)
    seedRows('persons', [personRow({ deleted_at: mockTimestamp(-1) })])
    for (const p of [c.me, c.other, c.lead, c.owner]) {
      asUser(p)
      expect(trashCount()).toBe(trashList().length)
    }
    asUser(c.owner)
    expect(trashCount()).toBe(3)
  })

  it('trash_count() counts to 100 — the badge shows 99+ beyond that', () => {
    const c = cast()
    const [kase] = seedRows('cases', [caseRow({ lead_detective_id: c.me.id, created_by: c.me.id })])
    seedRows('case_tasks', Array.from({ length: 120 }, (_, i) => caseTaskRow({ case_id: kase.id, title: `T${i}`, created_by: c.me.id, deleted_at: mockTimestamp(-i), deleted_by: c.me.id })))
    asUser(c.me)
    expect(TRASH_COUNT_CAP).toBe(100)
    expect(trashList({ p_limit: 500 })).toHaveLength(120)
    expect(trashCount()).toBe(100)
  })

  it('a restricted media row is the Owner\'s alone; an unrestricted one follows the command-with-case-access rule', () => {
    const c = cast()
    const [kase] = seedRows('cases', [caseRow({ lead_detective_id: c.me.id, created_by: c.me.id })])
    const [locked, open] = seedRows('media', [
      mediaRow({ case_id: kase.id, title: 'Sealed still', restricted: true, uploaded_by: c.me.id, deleted_at: mockTimestamp(-1), deleted_by: c.lead.id }),
      mediaRow({ case_id: kase.id, title: 'Open still', restricted: false, uploaded_by: c.me.id, deleted_at: mockTimestamp(-2), deleted_by: c.lead.id }),
    ])
    asUser(c.me)
    expect(trashList()).toEqual([])
    asUser(c.lead)
    expect(trashList().map((r) => r.id)).toEqual([open.id])
    asUser(c.owner)
    expect(ids(trashList())).toEqual(ids([locked, open]))
  })

  it('a policy-denied table contributes nothing to the Trash (rls: zero rows; grant: zero rows)', () => {
    const c = cast()
    const { note } = trashedCaseMaterial(c)
    asUser(c.me)
    setDenial('case_tasks', 'rls')
    expect(trashList().map((r) => r.id)).toEqual([note.id])
    setDenial('case_tasks', null)
    setDenial('case_notes', 'grant')
    expect(trashList().map((r) => r.kind)).toEqual(['case_task'])
  })
})

describe('canRestoreAs — the mock\'s perm_registry_delete', () => {
  beforeEach(() => resetMockStore())

  it('registry rows: command (or the Owner) for the core registries, the Owner alone for a narcotic, the creator or command for a person link, any active member for an account link', () => {
    const c = cast()
    const person = { id: 'p1', deleted_at: mockTimestamp(-1) }
    expect(canRestoreAs(c.me, 'person', 'persons', person)).toBe(false)
    expect(canRestoreAs(c.lead, 'person', 'persons', person)).toBe(true)
    expect(canRestoreAs(c.owner, 'person', 'persons', person)).toBe(true)
    expect(canRestoreAs(c.inactive, 'person', 'persons', person)).toBe(false)
    expect(canRestoreAs(null, 'person', 'persons', person)).toBe(false)
    const narcotic = { id: 'n1', deleted_at: mockTimestamp(-1) }
    expect(canRestoreAs(c.lead, 'narcotic', 'narcotics', narcotic)).toBe(false)
    expect(canRestoreAs(c.owner, 'narcotic', 'narcotics', narcotic)).toBe(true)
    const link = { id: 'l1', created_by: c.me.id, deleted_at: mockTimestamp(-1) }
    expect(canRestoreAs(c.me, 'person_vehicle', 'person_vehicles', link)).toBe(true)
    expect(canRestoreAs(c.other, 'person_vehicle', 'person_vehicles', link)).toBe(false)
    expect(canRestoreAs(c.lead, 'person_vehicle', 'person_vehicles', link)).toBe(true)
    expect(canRestoreAs(c.other, 'account_link', 'account_links', { id: 'a1' })).toBe(true)
    expect(canRestoreAs(c.me, 'unknown_kind', 'persons', person)).toBe(false)
  })

  it('case material: a report needs command with case access; a task its author or command; an intel link case access alone', () => {
    const c = cast()
    const [kase] = seedRows('cases', [caseRow({ lead_detective_id: c.me.id, created_by: c.me.id })])
    const report = { id: 'r1', case_id: kase.id, author_id: c.me.id }
    expect(canRestoreAs(c.me, 'report', 'reports', report), 'the author alone may not restore a report').toBe(false)
    expect(canRestoreAs(c.lead, 'report', 'reports', report)).toBe(true)
    const task = { id: 't1', case_id: kase.id, created_by: c.other.id }
    expect(canRestoreAs(c.me, 'case_task', 'case_tasks', task), 'a task by someone else on my case — I am not command').toBe(false)
    expect(canRestoreAs(c.other, 'case_task', 'case_tasks', task), 'the author without case access').toBe(false)
    expect(canRestoreAs(c.lead, 'case_task', 'case_tasks', task)).toBe(true)
    const mine = { id: 't2', case_id: kase.id, created_by: c.me.id }
    expect(canRestoreAs(c.me, 'case_task', 'case_tasks', mine)).toBe(true)
    const link = { id: 'il', case_id: kase.id }
    expect(canRestoreAs(c.me, 'case_intel_link', 'case_intel_links', link)).toBe(true)
    expect(canRestoreAs(c.other, 'case_intel_link', 'case_intel_links', link)).toBe(false)
  })
})

describe('trash — the wire', () => {
  it('registers one explicit route per function, both before the generic /rpc/:fn catch-all', () => {
    const paths = handlers.map((h) => h.info.path)
    const list = paths.findIndex((p) => String(p).endsWith('/rest/v1/rpc/trash_list'))
    const count = paths.findIndex((p) => String(p).endsWith('/rest/v1/rpc/trash_count'))
    const generic = paths.findIndex((p) => String(p).endsWith('/rest/v1/rpc/:fn'))
    expect(trashHandlers).toHaveLength(2)
    expect(list).toBeGreaterThanOrEqual(0)
    expect(count).toBeGreaterThanOrEqual(0)
    expect(generic).toBeGreaterThan(list)
    expect(generic).toBeGreaterThan(count)
  })
})
