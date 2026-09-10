/** v1.90a — the Trash: `trash_list(kind?, limit)` / `trash_count()` (Portal
 *  Improvements P8-02, migration 20261102120000_trash_list).
 *
 *  What the CID fixtures prove (lsb — the MCB detective who creates and
 *  LEADS the fixture cases; bcb — the SCB detective, no grant, the outsider;
 *  lead — the MCB Bureau Lead, command; owner optional — the permanent-delete
 *  preview; inactive optional — the zero-rows leg):
 *   · a row is in the caller's Trash exactly when `perm_dispatch('restore',
 *     kind, id)` holds — lsb soft-deletes a task and a note on their own case
 *     and reads both (kind, label = the title / the id fallback, case_id,
 *     case_number, deleted_by = lsb, deleted_by_name, restorable true,
 *     permanently_deletable FALSE); the lead (command with reach) reads them
 *     too; bcb (other bureau, no grant) reads neither; the inactive fixture
 *     reads zero rows;
 *   · `trash_list('case_task')` filters to the kind (case-insensitive, trimmed);
 *     an unknown kind raises 'unknown record kind';
 *   · `trash_count()` equals the number of rows `trash_list()` returns (the
 *     server counts to 100 — the badge shows 99+; the fixtures never reach it);
 *   · a case child is listed only while the caller can still READ the case
 *     (`private.can_read_case`, the review fix) — bcb, who cannot read lsb's
 *     case, never sees its children whatever authored them;
 *   · `case_assignment_end(p_assignment)` (the review's replacement for the
 *     client's removed_at UPDATE): lsb (detective) → P0403 'only a Bureau Lead
 *     or above can remove an officer from a case'; a client UPDATE stamping
 *     removed_at matches zero rows; the lead ends it → removed_at / removed_by
 *     set, `{ok, id, case_id, officer_id}`, 'that assignment has already
 *     ended' on a repeat, CASE_UNASSIGNED read by the Owner (optional);
 *   · restoring through `restore_record` removes the row from the list and
 *     lowers the count by one;
 *   · a deleted CASE (the lead deletes lsb's second case with a reason) is
 *     listed for the lead (kind 'case', label = the case number) and NOT for
 *     lsb (a detective may not restore a case); its cascaded child task stays
 *     listed for lsb (author), whose restore answers `parent_deleted` —
 *     'restore the record this belongs to first'; the lead's restore of the
 *     case brings the batch back;
 *   · `permanent_delete_record_preview` refuses lsb and the lead with
 *     'permanent deletion is restricted to the owner'; the Owner (optional)
 *     sees `permanently_deletable` true and previews the deleted task as
 *     `eligible` with `target.label` = its title.
 *
 *  Every record is authored by lsb ('[rls-test] v190a …') on cases lsb
 *  leads; bcb creates nothing. Soft-deleted rows are the tables' own rows, so
 *  rls_test_cleanup (definer — the freeze trigger is BEFORE INSERT OR UPDATE
 *  only) sweeps the fixture cases and their children whether live or in the
 *  Trash; nothing new is spliced for this suite. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v190a] fixture passwords not set — suite skipped')
const hasOwner = !!PW.owner

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type TrashRow = {
  kind: string; id: string; label: string | null; case_id: string | null; case_number: string | null
  deleted_at: string; deleted_by: string | null; deleted_by_name: string | null; delete_reason: string | null
  delete_batch: string | null; restorable: boolean; permanently_deletable: boolean
}
type SoftResult = { ok: boolean; code?: string; message?: string; batch?: string }
type Preview = { eligible: boolean; ineligible_reasons: string[]; target: { kind: string; label: string | null; id: string } }

describe.skipIf(!enabled)('v1.90a — the Trash: trash_list / trash_count, restore authority, the Owner\'s preview', () => {
  let lsb: C, bcb: C, lead: C, owner: C | null = null, inactive: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v190a ${tag}`
  let caseId = ''        // lsb's MCB case (lsb leads it) — the task / note legs
  let caseNumber = ''
  let taskA = ''         // restored in the restore leg
  let taskB = ''         // stays deleted — the Owner's preview
  let noteId = ''        // stays deleted — no label column → the id fallback
  let case2Id = ''       // lsb's second case — the lead deletes it whole
  let case2Number = ''
  let childTask = ''     // task on case2 — cascaded, hidden behind parent_deleted

  const trash = async (c: C, kind?: string): Promise<TrashRow[]> => {
    const r = await c.rpc('trash_list', kind === undefined ? {} : { p_kind: kind })
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as TrashRow[]
  }
  const count = async (c: C): Promise<number> => {
    const r = await c.rpc('trash_count')
    expect(r.error, r.error?.message).toBeNull()
    return r.data as number
  }
  const softDelete = async (c: C, kind: string, id: string, reason?: string): Promise<SoftResult> => {
    const r = await c.rpc('soft_delete', { p_kind: kind, p_id: id, ...(reason ? { p_reason: reason } : {}) })
    expect(r.error, r.error?.message).toBeNull()
    return r.data as SoftResult
  }
  const restore = async (c: C, kind: string, id: string, reason?: string): Promise<SoftResult> => {
    const r = await c.rpc('restore_record', { p_kind: kind, p_id: id, ...(reason ? { p_reason: reason } : {}) })
    expect(r.error, r.error?.message).toBeNull()
    return r.data as SoftResult
  }
  const byId = (rows: TrashRow[], id: string) => rows.find((r) => r.id === id)

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    if (PW.owner) { owner = mk(); ids.owner = await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
    if (PW.inactive) { inactive = mk(); ids.inactive = await signInWithRetry(inactive, 'rls-test-inactive@cidportal.test', PW.inactive) }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c = await lsb.from('cases').insert({ case_number: `V190A-${tag}`, title: `${stamp} trash case`, bureau: 'major_crimes', lead_detective_id: ids.lsb }).select('id, case_number').single()
    if (c.error) throw new Error(`case: ${c.error.message}`)
    caseId = c.data!.id; caseNumber = c.data!.case_number
    const tA = await lsb.from('case_tasks').insert({ case_id: caseId, title: `${stamp} task A`, created_by: ids.lsb }).select('id').single()
    if (tA.error) throw new Error(`task A: ${tA.error.message}`)
    taskA = tA.data!.id
    const tB = await lsb.from('case_tasks').insert({ case_id: caseId, title: `${stamp} task B`, created_by: ids.lsb }).select('id').single()
    if (tB.error) throw new Error(`task B: ${tB.error.message}`)
    taskB = tB.data!.id
    const n = await lsb.from('case_notes').insert({ case_id: caseId, author_id: ids.lsb, body_md: `${stamp} note body` }).select('id').single()
    if (n.error) throw new Error(`note: ${n.error.message}`)
    noteId = n.data!.id
    const c2 = await lsb.from('cases').insert({ case_number: `V190B-${tag}`, title: `${stamp} whole-case delete`, bureau: 'major_crimes', lead_detective_id: ids.lsb }).select('id, case_number').single()
    if (c2.error) throw new Error(`case 2: ${c2.error.message}`)
    case2Id = c2.data!.id; case2Number = c2.data!.case_number
    const ct = await lsb.from('case_tasks').insert({ case_id: case2Id, title: `${stamp} child task`, created_by: ids.lsb }).select('id').single()
    if (ct.error) throw new Error(`child task: ${ct.error.message}`)
    childTask = ct.data!.id
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v190a] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, owner, inactive].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ trash_list — who sees what ============ */

  it('lsb soft-deletes a task and a note on their own case and reads both in the Trash with the row shape the client renders', async () => {
    const before = await count(lsb)
    const dA = await softDelete(lsb, 'case_task', taskA)
    expect(dA.ok, dA.message).toBe(true)
    const dB = await softDelete(lsb, 'case_task', taskB)
    expect(dB.ok, dB.message).toBe(true)
    const dN = await softDelete(lsb, 'case_note', noteId)
    expect(dN.ok, dN.message).toBe(true)
    const rows = await trash(lsb)
    const a = byId(rows, taskA)
    expect(a, 'task A listed for its author').toBeTruthy()
    expect(a).toMatchObject({ kind: 'case_task', label: `${stamp} task A`, case_id: caseId, case_number: caseNumber, deleted_by: ids.lsb, restorable: true, permanently_deletable: false, delete_reason: null })
    expect(a!.deleted_at).toBeTruthy()
    expect(a!.delete_batch).toBeTruthy()
    expect(a!.deleted_by_name, 'the deleter is named from profiles').toBeTruthy()
    const n = byId(rows, noteId)
    expect(n, 'the note listed for its author').toBeTruthy()
    expect(n).toMatchObject({ kind: 'case_note', case_id: caseId, case_number: caseNumber, deleted_by: ids.lsb, restorable: true, permanently_deletable: false })
    // case_notes has no case_number / name / plate / title / … column: the server's label falls back to the id.
    expect(n!.label).toBe(noteId)
    // Newest first.
    const stamps = rows.map((r) => Date.parse(r.deleted_at))
    expect(stamps).toEqual([...stamps].sort((x, y) => y - x))
    expect(await count(lsb)).toBe(before + 3)
  })

  it('the lead (command with reach) reads the same rows; bcb (other bureau, no grant) reads none of them; the inactive fixture reads zero rows', async () => {
    const forLead = await trash(lead)
    expect(byId(forLead, taskA)?.kind).toBe('case_task')
    expect(byId(forLead, noteId)?.kind).toBe('case_note')
    expect(byId(forLead, taskA)!.permanently_deletable).toBe(false)
    const forBcb = await trash(bcb)
    expect(byId(forBcb, taskA)).toBeUndefined()
    expect(byId(forBcb, taskB)).toBeUndefined()
    expect(byId(forBcb, noteId)).toBeUndefined()
    if (inactive) {
      const r = await inactive.rpc('trash_list')
      expect(r.error, r.error?.message).toBeNull()
      expect(r.data ?? []).toEqual([])
      const cnt = await inactive.rpc('trash_count')
      expect(cnt.error, cnt.error?.message).toBeNull()
      expect(cnt.data).toBe(0)
    }
  })

  it('trash_list(kind) filters to that kind (case-insensitive, trimmed); an unknown kind raises "unknown record kind"', async () => {
    const tasks = await trash(lsb, 'case_task')
    expect(tasks.length).toBeGreaterThanOrEqual(2)
    expect(tasks.every((r) => r.kind === 'case_task')).toBe(true)
    expect(byId(tasks, taskA)).toBeTruthy()
    expect(byId(tasks, noteId)).toBeUndefined()
    const notes = await trash(lsb, '  Case_Note ')
    expect(notes.every((r) => r.kind === 'case_note')).toBe(true)
    expect(byId(notes, noteId)).toBeTruthy()
    const bad = await lsb.rpc('trash_list', { p_kind: 'bogus' })
    expect(bad.error).not.toBeNull()
    expect(bad.error!.message).toMatch(/unknown record kind/)
    // The limit is honoured (and clamped ≥ 1).
    const one = await lsb.rpc('trash_list', { p_limit: 1 })
    expect(one.error, one.error?.message).toBeNull()
    expect((one.data ?? []) as TrashRow[]).toHaveLength(1)
    const zero = await lsb.rpc('trash_list', { p_limit: 0 })
    expect(zero.error, zero.error?.message).toBeNull()
    expect((zero.data ?? []) as TrashRow[]).toHaveLength(1)
  })

  it('trash_count() is the number of rows trash_list() returns, for every caller', async () => {
    for (const [c, who] of [[lsb, 'lsb'], [bcb, 'bcb'], [lead, 'lead']] as const) {
      const rows = await trash(c)
      expect(await count(c), who).toBe(rows.length)
    }
  })

  /* ============ restore ============ */

  it('restoring through restore_record removes the row from the Trash and lowers the count by one', async () => {
    const before = await count(lsb)
    const r = await restore(lsb, 'case_task', taskA, 'undo')
    expect(r.ok, r.message).toBe(true)
    const rows = await trash(lsb)
    expect(byId(rows, taskA)).toBeUndefined()
    expect(byId(rows, taskB), 'the other task stays').toBeTruthy()
    expect(await count(lsb)).toBe(before - 1)
    const live = await lsb.from('case_tasks').select('id, deleted_at').eq('id', taskA).single()
    expect(live.error, live.error?.message).toBeNull()
    expect(live.data!.deleted_at).toBeNull()
    // Restoring a live row is refused by the RPC, and it is not in anyone's Trash.
    const again = await restore(lsb, 'case_task', taskA)
    expect(again.ok).toBe(false)
    expect(byId(await trash(lead), taskA)).toBeUndefined()
  })

  it('a deleted case is listed for the lead (never for a detective); its cascaded child is listed for its author, whose restore answers parent_deleted', async () => {
    const del = await softDelete(lead, 'case', case2Id, `${stamp} whole case`)
    expect(del.ok, del.message).toBe(true)
    const forLead = await trash(lead)
    const kase = byId(forLead, case2Id)
    expect(kase, 'the case is in the lead\'s Trash').toBeTruthy()
    expect(kase).toMatchObject({ kind: 'case', label: case2Number, case_id: case2Id, case_number: case2Number, deleted_by: ids.lead, delete_reason: `${stamp} whole case`, restorable: true })
    const child = byId(forLead, childTask)
    expect(child, 'the cascaded child is in the lead\'s Trash').toBeTruthy()
    expect(child!.delete_batch).toBe(kase!.delete_batch)
    const cases = await trash(lead, 'case')
    expect(cases.every((r) => r.kind === 'case')).toBe(true)
    expect(byId(cases, case2Id)).toBeTruthy()
    // lsb: the child (author) yes, the case (needs can_delete = command) no.
    const forLsb = await trash(lsb)
    expect(byId(forLsb, case2Id)).toBeUndefined()
    expect(byId(forLsb, childTask)).toMatchObject({ kind: 'case_task', case_number: case2Number })
    const blocked = await restore(lsb, 'case_task', childTask)
    expect(blocked.ok).toBe(false)
    expect(blocked.code).toBe('parent_deleted')
    expect(blocked.message).toMatch(/restore the record this belongs to first/)
    // bcb sees neither.
    const forBcb = await trash(bcb)
    expect(byId(forBcb, case2Id)).toBeUndefined()
    expect(byId(forBcb, childTask)).toBeUndefined()
    // The lead restores the case: the batch comes back and both rows leave the Trash.
    const back = await restore(lead, 'case', case2Id, `${stamp} back`)
    expect(back.ok, back.message).toBe(true)
    const after = await trash(lead)
    expect(byId(after, case2Id)).toBeUndefined()
    expect(byId(after, childTask)).toBeUndefined()
    const live = await lsb.from('case_tasks').select('id, deleted_at').eq('id', childTask).single()
    expect(live.error, live.error?.message).toBeNull()
    expect(live.data!.deleted_at).toBeNull()
  })

  /* ============ case_assignment_end (review fix) ============ */

  it('ending a standard assignment is command\'s: lsb → P0403, a client UPDATE of removed_at matches zero rows, the lead ends it once and audits CASE_UNASSIGNED', async () => {
    const a = await lsb.from('case_assignments').insert({ case_id: caseId, officer_id: ids.bcb, assignment_source: 'standard' }).select('id').single()
    if (a.error) { console.warn('[rls:v190a] could not insert a standard assignment as lsb — skipping the unassign leg:', a.error.message); return }
    const assignmentId = a.data!.id
    const denied = await lsb.rpc('case_assignment_end', { p_assignment: assignmentId })
    expect(denied.error).not.toBeNull()
    expect(denied.error!.code).toBe('P0403')
    expect(denied.error!.message).toMatch(/only a Bureau Lead or above can remove an officer from a case/)
    const direct = await lsb.from('case_assignments').update({ removed_at: new Date().toISOString() }).eq('id', assignmentId).select('id')
    if (direct.error) expect(direct.error.code).toBe('42501')
    else expect(direct.data ?? []).toEqual([])
    const still = await lsb.from('case_assignments').select('id, removed_at').eq('id', assignmentId).single()
    expect(still.error, still.error?.message).toBeNull()
    expect(still.data!.removed_at).toBeNull()
    const ok = await lead.rpc('case_assignment_end', { p_assignment: assignmentId })
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data).toMatchObject({ ok: true, id: assignmentId, case_id: caseId, officer_id: ids.bcb })
    const ended = await lead.from('case_assignments').select('id, removed_at, removed_by').eq('id', assignmentId).maybeSingle()
    expect(ended.error, ended.error?.message).toBeNull()
    // The row may be hidden from the policy once ended; when it is readable it carries the stamps.
    if (ended.data) { expect(ended.data.removed_at).toBeTruthy(); expect(ended.data.removed_by).toBe(ids.lead) }
    const again = await lead.rpc('case_assignment_end', { p_assignment: assignmentId })
    expect(again.error).not.toBeNull()
    expect(again.error!.message).toMatch(/already ended/)
    if (owner) {
      const audit = await owner.from('audit_log').select('action, entity, entity_id').eq('action', 'CASE_UNASSIGNED').eq('entity_id', assignmentId).limit(5)
      expect(audit.error, audit.error?.message).toBeNull()
      expect(audit.data ?? []).not.toHaveLength(0)
    }
  })

  /* ============ permanent deletion stays the Owner's ============ */

  it('permanent_delete_record_preview refuses a detective and command alike with "permanent deletion is restricted to the owner"', async () => {
    for (const [c, who] of [[lsb, 'lsb'], [lead, 'lead'], [bcb, 'bcb']] as const) {
      const r = await c.rpc('permanent_delete_record_preview', { p_kind: 'case_task', p_id: taskB })
      expect(r.error, who).not.toBeNull()
      expect(r.error!.message, who).toMatch(/permanent deletion is restricted to the owner/)
    }
  })

  it.skipIf(!hasOwner)('the Owner reads the rows as permanently deletable and previews the deleted task as eligible with its label', async () => {
    const rows = await trash(owner!)
    const b = byId(rows, taskB)
    expect(b, 'the Owner sees the detective\'s deleted task').toBeTruthy()
    expect(b!.permanently_deletable).toBe(true)
    expect(b!.restorable).toBe(true)
    expect(byId(rows, noteId)?.permanently_deletable).toBe(true)
    const r = await owner!.rpc('permanent_delete_record_preview', { p_kind: 'case_task', p_id: taskB })
    expect(r.error, r.error?.message).toBeNull()
    const p = r.data as Preview
    expect(p.eligible).toBe(true)
    expect(p.ineligible_reasons).toEqual([])
    expect(p.target).toMatchObject({ kind: 'case_task', id: taskB, label: `${stamp} task B` })
    // A live row is not in the Trash — the preview says so rather than arming anything.
    const liveRow = await owner!.rpc('permanent_delete_record_preview', { p_kind: 'case_task', p_id: taskA })
    expect(liveRow.error, liveRow.error?.message).toBeNull()
    expect((liveRow.data as Preview).eligible).toBe(false)
    expect((liveRow.data as Preview).ineligible_reasons).toContain('the record is not in the Trash')
  })
})
