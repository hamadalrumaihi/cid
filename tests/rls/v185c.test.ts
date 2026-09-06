/** v1.85c — archived cases are read-only at RLS (Portal Improvements P3-05,
 *  migration 20261023120000).
 *
 *  Before the migration `cases.archived_at` appeared in no row-level
 *  predicate; the client alone hid the editors. Now every case-child write
 *  policy gates on private.case_writable (access AND not archived AND not
 *  deleted), so after command archives a case a Detective with full case
 *  access finds:
 *   · INSERT into a child (case_tasks, case_notes, reports …) refused, 42501;
 *   · UPDATE of a child matches ZERO rows (the silent RLS shape);
 *   · UPDATE of the case row itself matches zero rows;
 *   · can_record('edit', 'case_task' | 'case', …) and
 *     can_record('soft_delete', 'case_task' | 'report', …) answer false —
 *     the permission module mirrors RLS;
 *   · soft_delete answers {ok:false, code:'denied'};
 *   · report_finalize / signoff_submit / create_legal_request raise
 *     "this case is archived — …";
 *   · READS are untouched: the case, its tasks, its reports list as before;
 *   · after command's case_restore every write succeeds again.
 *
 *  Fixtures: lsb (MCB detective — the case author), lead (MCB Bureau Lead —
 *  archives / restores, authors the task the soft-delete pin uses: a task's
 *  own creator keeps a soft-delete escape in perm_registry_delete, so the
 *  archived refusal is pinned on a task lsb did not create and on the
 *  report). rls_test_cleanup() sweeps the case. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, lead: process.env.RLS_TEST_PASSWORD_LEAD }
const enabled = !!(ANON && PW.lsb && PW.lead)
if (!enabled) console.warn('[rls:v185c] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
const can = async (c: C, action: string, kind: string, id: string): Promise<boolean> => {
  const r = await c.rpc('can_record', { p_action: action, p_kind: kind, p_id: id })
  expect(r.error, `can_record ${action} ${kind}: ${r.error?.message}`).toBeNull()
  return r.data as boolean
}

describe.skipIf(!enabled)('v1.85c — an archived case refuses every client write and reads as before', () => {
  let lsb: C, lead: C
  let lsbId = ''
  let caseId = '', taskId = '', leadTaskId = '', reportId = ''
  const tag = Date.now().toString(36)
  const stamp = `[rls-test] v185c ${tag}`

  beforeAll(async () => {
    lsb = mk(); lead = mk()
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    const c = await lsb.from('cases').insert({ case_number: `V185C-${tag}`, title: `${stamp} archive case`, bureau: 'major_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
    const t = await lsb.from('case_tasks').insert({ case_id: caseId, title: `${stamp} task` }).select('id').single()
    if (t.error) throw new Error(`task insert failed: ${t.error.message}`)
    taskId = t.data!.id
    const lt = await lead.from('case_tasks').insert({ case_id: caseId, title: `${stamp} command task` }).select('id').single()
    if (lt.error) throw new Error(`lead task insert failed: ${lt.error.message}`)
    leadTaskId = lt.data!.id
    const r = await lsb.from('reports').insert({ case_id: caseId, template: 'initial', fields: {} }).select('id').single()
    if (r.error) throw new Error(`report insert failed: ${r.error.message}`)
    reportId = r.data!.id
  }, 90_000)

  afterAll(async () => { if (lsb) await lsb.rpc('rls_test_cleanup') })

  it('before the archive the Detective writes freely and the permission module agrees', async () => {
    expect(await can(lsb, 'edit', 'case_task', taskId)).toBe(true)
    expect(await can(lsb, 'edit', 'case', caseId)).toBe(true)
    expect(await can(lsb, 'edit', 'report', reportId)).toBe(true)
    const upd = await lsb.from('case_tasks').update({ title: `${stamp} task (pre-archive edit)` }).eq('id', taskId).select('id')
    expect(upd.error).toBeNull()
    expect(upd.data).toHaveLength(1)
  })

  it('command archives; a Detective\'s insert is a policy violation and updates match zero rows', async () => {
    const a = await lead.rpc('case_archive', { p_case: caseId, p_note: `${stamp} shelved` })
    expect(a.error, a.error?.message).toBeNull()
    expect((a.data as { archived_at: string | null }).archived_at).not.toBeNull()

    expect((await lsb.from('case_tasks').insert({ case_id: caseId, title: `${stamp} after archive` })).error?.code).toBe('42501')
    expect((await lsb.from('case_notes').insert({ case_id: caseId, author_id: lsbId, body_md: `${stamp} after archive` })).error?.code).toBe('42501')
    expect((await lsb.from('reports').insert({ case_id: caseId, template: 'general', fields: {} })).error?.code).toBe('42501')
    expect((await lsb.from('evidence').insert({ case_id: caseId, item_code: `V185C-${tag.slice(-4).toUpperCase()}`, description: stamp })).error?.code).toBe('42501')

    const task = await lsb.from('case_tasks').update({ done: true }).eq('id', taskId).select('id')
    expect(task.error).toBeNull()
    expect(task.data).toEqual([])
    const kase = await lsb.from('cases').update({ title: `${stamp} renamed while archived` }).eq('id', caseId).select('id')
    expect(kase.error).toBeNull()
    expect(kase.data).toEqual([])
    const report = await lsb.from('reports').update({ fields: { narrative: 'x' } }).eq('id', reportId).select('id')
    expect(report.error).toBeNull()
    expect(report.data).toEqual([])
    // Command is bound by the same wall — archive and restore are the RPCs.
    const cmd = await lead.from('case_tasks').update({ done: true }).eq('id', leadTaskId).select('id')
    expect(cmd.error).toBeNull()
    expect(cmd.data).toEqual([])
  })

  it('can_record mirrors the wall and soft_delete is denied', async () => {
    expect(await can(lsb, 'edit', 'case_task', taskId)).toBe(false)
    expect(await can(lsb, 'soft_delete', 'case_task', leadTaskId)).toBe(false)
    expect(await can(lsb, 'edit', 'case', caseId)).toBe(false)
    expect(await can(lsb, 'edit', 'report', reportId)).toBe(false)
    expect(await can(lsb, 'soft_delete', 'report', reportId)).toBe(false)
    expect((await lsb.rpc('soft_delete', { p_kind: 'case_task', p_id: leadTaskId })).data).toMatchObject({ ok: false, code: 'denied' })
    expect((await lsb.rpc('soft_delete', { p_kind: 'report', p_id: reportId, p_reason: stamp })).data).toMatchObject({ ok: false, code: 'denied' })
    // The reads still answer — the case is archived, not hidden.
    expect(await can(lsb, 'read', 'case_task', taskId)).toBe(true)
    expect(await can(lsb, 'access', 'case', caseId)).toBe(true)
  })

  it('the write RPCs raise "this case is archived"', async () => {
    const fin = await lsb.rpc('report_finalize', { p_report: reportId })
    expect(fin.error?.message).toMatch(/archived/i)
    const sub = await lsb.rpc('signoff_submit', { p_case: caseId })
    expect(sub.error?.message).toMatch(/archived/i)
    const legal = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'records',
      p_title: `${stamp} subpoena`, p_recipient_type: 'entity', p_recipient_name: 'Fleeca Bank',
    })
    expect(legal.error?.message).toMatch(/archived/i)
    expect((await lsb.from('reports').select('finalized').eq('id', reportId).single()).data?.finalized).toBe(false)
  })

  it('reads are unchanged while archived', async () => {
    const c = await lsb.from('cases').select('id, archived_at').eq('id', caseId).single()
    expect(c.error).toBeNull()
    expect(c.data!.archived_at).not.toBeNull()
    const tasks = await lsb.from('case_tasks').select('id').eq('case_id', caseId)
    expect((tasks.data ?? []).map((t) => t.id).sort()).toEqual([taskId, leadTaskId].sort())
    expect((await lsb.from('reports').select('id').eq('case_id', caseId)).data).toEqual([{ id: reportId }])
    const feed = await lsb.rpc('case_audit_feed', { p_case: caseId })
    expect(feed.error).toBeNull()
    expect((feed.data as { action: string }[]).some((r) => r.action === 'CASE_ARCHIVED' || r.action === 'UPDATE')).toBe(true)
  })

  it('after command restores the case, the Detective\'s writes succeed again', async () => {
    const r = await lead.rpc('case_restore', { p_case: caseId })
    expect(r.error, r.error?.message).toBeNull()
    expect((r.data as { archived_at: string | null }).archived_at).toBeNull()

    expect(await can(lsb, 'edit', 'case_task', taskId)).toBe(true)
    expect(await can(lsb, 'edit', 'case', caseId)).toBe(true)
    const upd = await lsb.from('case_tasks').update({ done: true }).eq('id', taskId).select('id, done')
    expect(upd.error).toBeNull()
    expect(upd.data).toEqual([{ id: taskId, done: true }])
    const ins = await lsb.from('case_tasks').insert({ case_id: caseId, title: `${stamp} after restore` }).select('id').single()
    expect(ins.error, ins.error?.message).toBeNull()
    const note = await lsb.from('case_notes').insert({ case_id: caseId, author_id: lsbId, body_md: `${stamp} after restore` }).select('id').single()
    expect(note.error, note.error?.message).toBeNull()
    const kase = await lsb.from('cases').update({ title: `${stamp} renamed after restore` }).eq('id', caseId).select('id')
    expect(kase.data).toEqual([{ id: caseId }])
  })
})
