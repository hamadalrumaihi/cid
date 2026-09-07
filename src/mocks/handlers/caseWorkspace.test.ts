/** Pins for the case-workspace mock handlers (P3-03 / P3-04): the feed
 *  synthesis honours p_before / p_limit, the restricted-note rule applies to
 *  reads, the feed and history, and refusals are returned, never raised.
 *  These call the handlers directly against the mock store — no MSW server,
 *  no network; the wire shape is exercised by tests/msw. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { caseLinkRow, caseNoteRow, caseRow, emptyCase, profileRow, roleSession } from '../fixtures'
import { mockId, mockTimestamp, readRows, resetMockStore, seedRows, setSession } from '../store'
import { caseAuditFeed, caseNoteMention, recordHistory, visibleCaseNotes } from './caseWorkspace'

const version = (over: Partial<Tables<'record_versions'>> & Pick<Tables<'record_versions'>, 'table_name' | 'record_id'>): Tables<'record_versions'> => ({
  actor_id: null, changed_fields: ['body_md'], created_at: mockTimestamp(10), id: 1, new: {}, old: {},
  reason: null, source: 'edit', updated_at: mockTimestamp(10), version_no: 1, ...over,
})
const ledger = (over: Partial<Tables<'audit_log'>> & Pick<Tables<'audit_log'>, 'entity' | 'entity_id'>): Tables<'audit_log'> => ({
  action: 'INSERT', actor_id: null, created_at: mockTimestamp(), detail: null, id: 1, prev_hash: null, row_hash: null, ...over,
})

/** A detective's case with the detective's own note, a command-restricted
 *  note by the lead, and a link to a second case. Returns the ids. */
function workspace() {
  const me = roleSession('detective')
  const [lead] = seedRows('profiles', [profileRow({ role: 'bureau_lead', display_name: 'Lt. Lead' })])
  const { caseRecord } = emptyCase({ created_by: me.profile.id, created_at: mockTimestamp(-120), case_number: 'CID-26-0500' })
  const [other] = seedRows('cases', [caseRow({ case_number: 'CID-26-0501', created_at: mockTimestamp(-100) })])
  const [mine, restricted] = seedRows('case_notes', [
    caseNoteRow({ case_id: caseRecord.id, author_id: me.profile.id, body_md: 'SECRET my note', created_at: mockTimestamp(-30), updated_at: mockTimestamp(-30) }),
    caseNoteRow({ case_id: caseRecord.id, author_id: lead.id, body_md: 'SECRET command only', restricted_to_command: true, created_at: mockTimestamp(-20), updated_at: mockTimestamp(-20) }),
  ])
  const [link] = seedRows('case_links', [caseLinkRow({ case_id: caseRecord.id, related_case_id: other.id, created_by: me.profile.id, created_at: mockTimestamp(-10) })])
  return { me, lead, caseRecord, other, mine, restricted, link }
}
const asUser = (p: Tables<'profiles'>) => setSession({ userId: p.id, email: p.email ?? 'x@cid.test', password: 'mock-password' })

beforeEach(() => resetMockStore())

describe('visibleCaseNotes — the case_notes_sel shape', () => {
  it('hides a command-restricted note from a detective who is not its author, never from the author, command or the Owner', () => {
    const w = workspace()
    expect(visibleCaseNotes(readRows('case_notes')).map((n) => n.id)).toEqual([w.mine.id])
    asUser(w.lead)
    expect(visibleCaseNotes(readRows('case_notes'))).toHaveLength(2)
    const owner = roleSession('owner')
    expect(visibleCaseNotes(readRows('case_notes'))).toHaveLength(2)
    // A restricted note's author reads it whatever their rank.
    const [ownRestricted] = seedRows('case_notes', [caseNoteRow({ case_id: w.caseRecord.id, author_id: owner.profile.id, restricted_to_command: true })])
    asUser(w.me.profile)
    expect(visibleCaseNotes(readRows('case_notes')).map((n) => n.id)).toEqual([w.mine.id])
    asUser(owner.profile)
    expect(visibleCaseNotes(readRows('case_notes')).map((n) => n.id)).toContain(ownRestricted.id)
    setSession(null)
    expect(visibleCaseNotes(readRows('case_notes')).map((n) => n.id)).toEqual([w.mine.id])
  })
})

describe('case_audit_feed — synthesized from the case, its notes and its links', () => {
  it('lists the case INSERT, the visible note and the link with kind / label, newest first, ids agreeing with time', () => {
    const w = workspace()
    const rows = caseAuditFeed({ p_case: w.caseRecord.id })
    expect(rows.map((r) => [r.kind, r.action, r.label])).toEqual([
      ['case_link', 'INSERT', 'related'],
      ['case_note', 'INSERT', 'note'],
      ['case', 'INSERT', 'CID-26-0500'],
    ])
    expect(rows.map((r) => r.entity)).toEqual(['case_links', 'case_notes', 'cases'])
    expect(rows.map((r) => r.entity_id)).toEqual([w.link.id, w.mine.id, w.caseRecord.id])
    expect(rows[2].actor_id).toBe(w.me.profile.id)
    expect(rows.every((r) => r.changed_fields === null && r.detail === null)).toBe(true)
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].id).toBeGreaterThan(rows[i].id)
    expect(JSON.stringify(rows)).not.toContain('SECRET')
  })

  it('a restricted note is absent for a detective and present for command / the author', () => {
    const w = workspace()
    expect(caseAuditFeed({ p_case: w.caseRecord.id }).some((r) => r.entity_id === w.restricted.id)).toBe(false)
    asUser(w.lead)
    const cmd = caseAuditFeed({ p_case: w.caseRecord.id })
    expect(cmd.some((r) => r.entity_id === w.restricted.id && r.kind === 'case_note')).toBe(true)
    expect(cmd).toHaveLength(4)
  })

  it('honours p_limit (clamped to 1…200) and p_before (strictly older rows)', () => {
    const w = workspace()
    const all = caseAuditFeed({ p_case: w.caseRecord.id })
    expect(caseAuditFeed({ p_case: w.caseRecord.id, p_limit: 1 })).toEqual([all[0]])
    expect(caseAuditFeed({ p_case: w.caseRecord.id, p_limit: 0 })).toHaveLength(1)
    expect(caseAuditFeed({ p_case: w.caseRecord.id, p_limit: 999 })).toHaveLength(3)
    const older = caseAuditFeed({ p_case: w.caseRecord.id, p_before: all[0].at })
    expect(older.map((r) => r.id)).toEqual(all.slice(1).map((r) => r.id))
    expect(older.every((r) => Date.parse(r.at) < Date.parse(all[0].at))).toBe(true)
    expect(caseAuditFeed({ p_case: w.caseRecord.id, p_before: all[all.length - 1].at })).toEqual([])
    expect(caseAuditFeed({ p_case: w.caseRecord.id, p_before: 'not a date' })).toHaveLength(3)
  })

  it('UPDATE rows come from record_versions and carry changed_fields; a hidden note\'s versions stay hidden', () => {
    const w = workspace()
    seedRows('record_versions', [
      version({ table_name: 'case_notes', record_id: w.mine.id, changed_fields: ['pinned', 'body_md'], actor_id: w.me.profile.id, created_at: mockTimestamp(-5) }),
      version({ table_name: 'case_notes', record_id: w.restricted.id, changed_fields: ['body_md'], actor_id: w.lead.id, created_at: mockTimestamp(-4), id: 2 }),
      version({ table_name: 'cases', record_id: w.caseRecord.id, changed_fields: ['title'], created_at: mockTimestamp(-3), id: 3 }),
    ])
    const rows = caseAuditFeed({ p_case: w.caseRecord.id })
    expect(rows.map((r) => [r.kind, r.action, r.changed_fields])).toEqual([
      ['case', 'UPDATE', ['title']],
      ['case_note', 'UPDATE', ['pinned', 'body_md']],
      ['case_link', 'INSERT', null],
      ['case_note', 'INSERT', null],
      ['case', 'INSERT', null],
    ])
    asUser(w.lead)
    expect(caseAuditFeed({ p_case: w.caseRecord.id }).filter((r) => r.action === 'UPDATE')).toHaveLength(3)
  })

  it('answers [] for an unknown case, a missing session or an inactive profile', () => {
    const w = workspace()
    expect(caseAuditFeed({ p_case: mockId() })).toEqual([])
    expect(caseAuditFeed({})).toEqual([])
    setSession(null)
    expect(caseAuditFeed({ p_case: w.caseRecord.id })).toEqual([])
    roleSession('applicant')
    expect(caseAuditFeed({ p_case: w.caseRecord.id })).toEqual([])
  })
})

describe('case_audit_feed — from a seeded audit_log', () => {
  it('uses the ledger rows for the case and its children, re-checked per viewer, with body keys stripped from detail', () => {
    const w = workspace()
    seedRows('audit_log', [
      ledger({ id: 1, entity: 'cases', entity_id: w.caseRecord.id, created_at: mockTimestamp(-120), actor_id: w.me.profile.id }),
      ledger({ id: 2, entity: 'case_notes', entity_id: w.mine.id, created_at: mockTimestamp(-30), detail: { body_md: 'SECRET', pinned: false } }),
      ledger({ id: 3, entity: 'case_notes', entity_id: w.restricted.id, created_at: mockTimestamp(-20) }),
      ledger({ id: 4, entity: 'case_notes', entity_id: w.mine.id, action: 'UPDATE', created_at: mockTimestamp(-15) }),
      ledger({ id: 5, entity: 'cases', entity_id: w.caseRecord.id, action: 'CASE_ARCHIVED', created_at: mockTimestamp(-12), detail: { note: 'SECRET', reason: 'shelved' } }),
      ledger({ id: 6, entity: 'case_access_grants', entity_id: mockId(), action: 'CASE_ACCESS_GRANTED', created_at: mockTimestamp(-11), detail: { case_id: w.caseRecord.id } }),
      ledger({ id: 7, entity: 'legal_requests', entity_id: mockId(), created_at: mockTimestamp(-9), detail: { case_id: w.caseRecord.id, narrative: 'SECRET' } }),
      ledger({ id: 8, entity: 'cases', entity_id: w.other.id, created_at: mockTimestamp(-8) }),
    ])
    seedRows('record_versions', [version({ table_name: 'case_notes', record_id: w.mine.id, changed_fields: ['pinned'], created_at: mockTimestamp(-15) })])
    const rows = caseAuditFeed({ p_case: w.caseRecord.id })
    expect(rows.map((r) => [r.id, r.kind, r.action])).toEqual([
      [6, 'case', 'CASE_ACCESS_GRANTED'],
      [5, 'case', 'CASE_ARCHIVED'],
      [4, 'case_note', 'UPDATE'],
      [2, 'case_note', 'INSERT'],
      [1, 'case', 'INSERT'],
    ])
    expect(rows.find((r) => r.id === 4)?.changed_fields).toEqual(['pinned'])
    expect(rows.find((r) => r.id === 2)?.detail).toEqual({ pinned: false })
    expect(rows.find((r) => r.id === 5)?.detail).toEqual({ reason: 'shelved' })
    expect(rows.find((r) => r.id === 1)?.label).toBe('CID-26-0500')
    expect(JSON.stringify(rows)).not.toContain('SECRET')
    asUser(w.lead)
    expect(caseAuditFeed({ p_case: w.caseRecord.id }).map((r) => r.id)).toEqual([6, 5, 4, 3, 2, 1])
    expect(caseAuditFeed({ p_case: w.caseRecord.id, p_limit: 2, p_before: mockTimestamp(-11) }).map((r) => r.id)).toEqual([5, 4])
  })
})

describe('case_note_mention', () => {
  it('is author-only: the author notifies each active recipient once, anyone else is denied', () => {
    const w = workspace()
    const [inactive] = seedRows('profiles', [profileRow({ active: false })])
    const [gone] = seedRows('profiles', [profileRow({ removed_at: mockTimestamp() })])
    const ids = [w.lead.id, inactive.id, gone.id, w.me.profile.id]
    expect(caseNoteMention({ p_note: w.mine.id, p_user_ids: ids })).toEqual({ ok: true, sent: 1 })
    expect(readRows('notifications')).toMatchObject([{ type: 'note_mention', user_id: w.lead.id, payload: { note_id: w.mine.id, case_id: w.caseRecord.id, author_id: w.me.profile.id } }])
    // Repeat mentions of the same note do not fan out again.
    expect(caseNoteMention({ p_note: w.mine.id, p_user_ids: ids })).toEqual({ ok: true, sent: 0 })
    expect(readRows('notifications')).toHaveLength(1)
    expect(caseNoteMention({ p_note: w.restricted.id, p_user_ids: [w.lead.id] })).toMatchObject({ ok: false, code: 'denied' })
    asUser(w.lead)
    expect(caseNoteMention({ p_note: w.mine.id, p_user_ids: [w.me.profile.id] })).toMatchObject({ ok: false, code: 'denied' })
    expect(caseNoteMention({ p_note: mockId(), p_user_ids: [] })).toMatchObject({ ok: false, code: 'denied' })
    setSession(null)
    expect(caseNoteMention({ p_note: w.mine.id, p_user_ids: [w.lead.id] })).toMatchObject({ ok: false, code: 'denied' })
  })
})

describe('record_history', () => {
  it('returns a kind\'s versions newest first and nothing for a note the session cannot read', () => {
    const w = workspace()
    seedRows('record_versions', [
      version({ table_name: 'case_notes', record_id: w.mine.id, version_no: 1, id: 1 }),
      version({ table_name: 'case_notes', record_id: w.mine.id, version_no: 2, id: 2, changed_fields: ['pinned'] }),
      version({ table_name: 'case_notes', record_id: w.restricted.id, version_no: 1, id: 3 }),
      version({ table_name: 'cases', record_id: w.caseRecord.id, version_no: 1, id: 4, changed_fields: ['title'] }),
    ])
    expect(recordHistory({ p_kind: 'case_note', p_id: w.mine.id }).map((v) => v.version_no)).toEqual([2, 1])
    expect(recordHistory({ p_kind: 'case_note', p_id: w.restricted.id })).toEqual([])
    expect(recordHistory({ p_kind: 'case', p_id: w.caseRecord.id }).map((v) => v.changed_fields)).toEqual([['title']])
    expect(recordHistory({ p_kind: 'case_link', p_id: w.link.id })).toEqual([])
    asUser(w.lead)
    expect(recordHistory({ p_kind: 'case_note', p_id: w.restricted.id })).toHaveLength(1)
  })
})
