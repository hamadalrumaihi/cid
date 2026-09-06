/** v1.80b — Soft delete, cases and case children (P1-03b, migrations
 *  20261008120001 … 20261008120100).
 *
 *  The ten case tables (cases, reports, media, evidence, case_tasks,
 *  case_messages, case_intel_links, case_blockers, rico_cases,
 *  predicate_acts) join the soft-delete vocabulary of v180a: no client
 *  DELETE (42501), lifecycle columns frozen (P0403), deletion through
 *  public.soft_delete(kind, id, reason) and restoration through
 *  public.restore_record(kind, id, reason), both refusing by RETURNING
 *  {ok:false, code}.
 *
 *  Pinned here, on a fixture-owned case + report + task:
 *   · a detective is DENIED soft-deleting a case or a report (the former
 *     DELETE predicates: can_delete() for the case, can_delete_case_child
 *     for the child) but may delete a task they created (author rule), and
 *     a task needs no reason;
 *   · the Bureau Lead is refused a case delete WITHOUT a reason
 *     (reason_required), then succeeds with one, and the report and task are
 *     cascaded under the batch;
 *   · the deleted case and its children are invisible to the detective and
 *     can_record answers false for read / edit; the Owner still reads them;
 *   · a child cannot be restored under a deleted case (parent_deleted);
 *     restoring the case brings the whole batch back;
 *   · `unarchive` is the archive-restore action and answers false for a live
 *     case, while `restore` (un-delete) answers false for a live case too —
 *     liveness never leaks through can_record.
 *
 *  Fixtures (tests/rls/README.md): lsb (MCB detective), lead (MCB Bureau
 *  Lead); owner optional. Rows are created by lsb and purged by
 *  rls_test_cleanup() in afterAll. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.lead)
if (!enabled) console.warn('[rls:v180b] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Res = { ok: boolean; code?: string; cascaded?: Record<string, number>; restored?: Record<string, number> }
const softDelete = async (c: C, kind: string, id: string, reason?: string): Promise<Res> => {
  const r = await c.rpc('soft_delete', { p_kind: kind, p_id: id, p_reason: reason })
  expect(r.error, `soft_delete ${kind}`).toBeNull()
  return r.data as unknown as Res
}
const restore = async (c: C, kind: string, id: string, reason?: string): Promise<Res> => {
  const r = await c.rpc('restore_record', { p_kind: kind, p_id: id, p_reason: reason })
  expect(r.error, `restore_record ${kind}`).toBeNull()
  return r.data as unknown as Res
}
const can = async (c: C, action: string, kind: string, id: string) => {
  const r = await c.rpc('can_record', { p_action: action, p_kind: kind, p_id: id })
  expect(r.error, `can_record ${action}/${kind}`).toBeNull()
  return r.data as unknown as boolean
}

describe.skipIf(!enabled)('v1.80b soft delete — cases and case children', () => {
  let lsb: C, lead: C, owner: C | null = null
  let caseId = '', reportId = '', taskId = '', ownTaskId = ''
  const tag = Date.now().toString(36)

  beforeAll(async () => {
    lsb = mk(); lead = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    if (PW.owner) { owner = mk(); await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
    const c = await lsb.from('cases').insert({ case_number: `V180B-${tag}`, title: 'v1.80b RLS case (MCB)', bureau: 'major_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
    const r = await lsb.from('reports').insert({ case_id: caseId, template: 'initial', fields: {} }).select('id').single()
    if (r.error) throw new Error(`report insert failed: ${r.error.message}`)
    reportId = r.data!.id
    const t = await lsb.from('case_tasks').insert({ case_id: caseId, title: `[rls-test] v180b task ${tag}` }).select('id').single()
    if (t.error) throw new Error(`task insert failed: ${t.error.message}`)
    taskId = t.data!.id
  }, 90_000)

  afterAll(async () => {
    if (lsb) await lsb.rpc('rls_test_cleanup')
  })

  it('a client DELETE is a hard permission error on the case tables', async () => {
    for (const [table, id] of [['cases', caseId], ['reports', reportId], ['case_tasks', taskId]] as const) {
      for (const [name, c] of [['lsb', lsb], ['lead', lead]] as [string, C][]) {
        const r = await c.from(table).delete().eq('id', id)
        expect(r.error, `${name} delete ${table}`).not.toBeNull()
        expect(r.error!.code, `${name} delete ${table} code`).toBe('42501')
      }
    }
  })

  it('the lifecycle columns cannot be written from a client, the Owner included', async () => {
    const r = await lead.from('cases').update({ deleted_at: new Date().toISOString() }).eq('id', caseId)
    expect(r.error).not.toBeNull()
    expect(r.error!.code).toBe('P0403')
    const t = await lsb.from('case_tasks').update({ delete_batch: '00000000-0000-4000-8000-000000000001' }).eq('id', taskId)
    expect(t.error!.code).toBe('P0403')
    if (owner) {
      const o = await owner.from('reports').update({ delete_reason: 'x' }).eq('id', reportId)
      expect(o.error).not.toBeNull()
      expect(o.error!.code).toBe('P0403')
    }
  })

  it('unarchive is the archive-restore action; neither it nor restore answers true for a live case', async () => {
    expect(await can(lead, 'unarchive', 'case', caseId)).toBe(false)
    expect(await can(lead, 'restore', 'case', caseId)).toBe(false)
    expect(await can(lead, 'archive', 'case', caseId)).toBe(true)
    expect(await can(lead, 'soft_delete', 'case', caseId)).toBe(true)
    expect(await can(lsb, 'soft_delete', 'case', caseId)).toBe(false)
    expect(await can(lsb, 'read', 'report', reportId)).toBe(true)
    expect(await can(lsb, 'edit', 'report', reportId)).toBe(true)
  })

  it('a detective may delete a task they created without a reason, and restore it', async () => {
    const t = await lsb.from('case_tasks').insert({ case_id: caseId, title: `[rls-test] v180b own task ${tag}` }).select('id').single()
    expect(t.error).toBeNull()
    ownTaskId = t.data!.id
    expect((await softDelete(lsb, 'report', reportId, 'x')).code).toBe('denied')
    const r = await softDelete(lsb, 'case_task', ownTaskId)
    expect(r.ok).toBe(true)
    expect(r.cascaded).toEqual({})
    const gone = await lsb.from('case_tasks').select('id').eq('id', ownTaskId)
    expect(gone.data).toEqual([])
    expect((await restore(lsb, 'case_task', ownTaskId)).ok).toBe(true)
    const back = await lsb.from('case_tasks').select('id').eq('id', ownTaskId)
    expect(back.data).toHaveLength(1)
  })

  it('a detective is denied; the Bureau Lead needs a reason, then deletes with the children cascaded', async () => {
    expect((await softDelete(lsb, 'case', caseId, 'x')).code).toBe('denied')
    expect((await softDelete(lead, 'case', caseId)).code).toBe('reason_required')
    const r = await softDelete(lead, 'case', caseId, `rls-test v180b ${tag}`)
    expect(r.ok).toBe(true)
    expect(r.cascaded).toEqual({ reports: 1, case_tasks: 2 })
    expect((await softDelete(lead, 'case', caseId, 'again')).code).toBe('denied')
  })

  it('a deleted case and its children are invisible to members and still readable by the Owner', async () => {
    for (const [table, id] of [['cases', caseId], ['reports', reportId], ['case_tasks', taskId]] as const) {
      const r = await lsb.from(table).select('id').eq('id', id)
      expect(r.error, `lsb select ${table}`).toBeNull()
      expect(r.data, `lsb select ${table}`).toEqual([])
    }
    expect(await can(lsb, 'read', 'case', caseId)).toBe(false)
    expect(await can(lsb, 'edit', 'report', reportId)).toBe(false)
    expect(await can(lead, 'archive', 'case', caseId)).toBe(false)
    if (owner) {
      const r = await owner.from('cases').select('id, deleted_at, delete_reason').eq('id', caseId).single()
      expect(r.error).toBeNull()
      expect(r.data!.deleted_at).not.toBeNull()
      expect(r.data!.delete_reason).toContain('rls-test')
      expect(await can(owner, 'read', 'report', reportId)).toBe(true)
    }
  })

  it('a child cannot be restored under a deleted case; restoring the case brings the batch back', async () => {
    expect((await restore(lead, 'report', reportId, 'x')).code).toBe('parent_deleted')
    expect((await restore(lsb, 'case', caseId, 'x')).code).toBe('denied')
    const r = await restore(lead, 'case', caseId, 'undo')
    expect(r.ok).toBe(true)
    expect(r.restored).toEqual({ cases: 1, reports: 1, case_tasks: 2 })
    expect((await restore(lead, 'case', caseId)).code).toBe('denied')
    for (const [table, id] of [['cases', caseId], ['reports', reportId], ['case_tasks', taskId]] as const) {
      const back = await lsb.from(table).select('id').eq('id', id)
      expect(back.data, `lsb select ${table} after restore`).toHaveLength(1)
    }
  })

  it('deny by default: unknown kind, unknown id', async () => {
    expect((await softDelete(lead, 'spaceship', caseId, 'x')).code).toBe('bad_request')
    expect((await softDelete(lead, 'case', '00000000-0000-4000-8000-000000000001', 'x')).code).toBe('denied')
  })
})
