/** v1.26 — Case Detail convergence: durable case blockers + cases.priority
 *  (migration 20260727010000). Pins:
 *   - case_blockers follows the case_tasks sibling convention exactly:
 *     select/insert/update under private.can_access_case(case_id), delete for
 *     command (can_delete) OR the row's creator — so the bureau wall applies
 *     to blockers like every other case child.
 *   - controlled vocabularies: case_blockers.type and cases.priority CHECKs
 *     reject invalid values (23514) but admit the real ones.
 *   - lifecycle: an open blocker can be resolved in place (status +
 *     resolution_note + resolved_by) by a case-access member.
 *   - blocker inserts are audited (audit_log row, readable by owner).
 *   - task_id is ON DELETE SET NULL: deleting the linked case_task leaves the
 *     blocker standing with task_id null (the blocker outlives its link).
 *
 *  Fixtures (tests/rls/README.md): lsb (LSB detective, case creator), bcb
 *  (BCB detective — bureau isolation), director (command teardown), owner
 *  (audit_log reader). Same conventions as the sibling suites;
 *  rls_test_cleanup at start + teardown (fixture blockers cascade with their
 *  fixture cases — the cleanup's plain `delete from cases` sweeps them).
 *  Requires migration 20260727010000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.director && PW.owner)
if (!enabled) console.warn('[rls:v126] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.26 — case blockers + case priority (live)', () => {
  let lsb: C, bcb: C, director: C, owner: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let blockerId = ''

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); director = mk(); owner = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c = await lsb.from('cases')
      .insert({ case_number: `V126-${tag}`, title: 'v1.26 blocker case', bureau: 'LSB', lead_detective_id: ids.lsb })
      .select('id')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id as string
  })

  afterAll(async () => {
    if (!lsb) return
    // Best-effort explicit teardown; rls_test_cleanup then sweeps anything
    // left (blockers cascade with the fixture case's plain delete).
    if (director) {
      await director.from('case_blockers').delete().eq('case_id', caseId)
      await director.from('cases').delete().eq('id', caseId)
    }
    const clean = await lsb.rpc('rls_test_cleanup')
    if (clean.error) throw new Error(`rls_test_cleanup failed: ${clean.error.message}`)
    await Promise.all([lsb, bcb, director, owner].filter(Boolean).map((c) => c.auth.signOut()))
  })

  // ── create + read under case access ────────────────────────────────────────
  it('a case-access member can create a blocker on their case', async () => {
    const res = await lsb.from('case_blockers')
      .insert({ case_id: caseId, title: `v126 waiting on lab ${tag}`, type: 'awaiting_evidence', owner_id: ids.lsb })
      .select('id, status')
    expect(res.error).toBeNull()
    expect(res.data![0].status).toBe('open')
    blockerId = res.data![0].id as string
  })

  it('the creator reads the blocker back', async () => {
    const res = await lsb.from('case_blockers').select('id, title, type').eq('id', blockerId)
    expect(res.error).toBeNull()
    expect(res.data ?? []).toHaveLength(1)
    expect(res.data![0].type).toBe('awaiting_evidence')
  })

  // ── the bureau wall applies to blockers ────────────────────────────────────
  it('a detective from another bureau cannot see the blocker', async () => {
    const res = await bcb.from('case_blockers').select('id').eq('id', blockerId)
    expect(res.data ?? []).toHaveLength(0)
  })

  // ── controlled vocabulary ──────────────────────────────────────────────────
  it('an invalid blocker type is rejected by the CHECK constraint', async () => {
    const res = await lsb.from('case_blockers')
      .insert({ case_id: caseId, title: `v126 bogus ${tag}`, type: 'bogus' })
      .select('id')
    expect(res.error).not.toBeNull()
    expect(res.error!.code).toBe('23514')
  })

  // ── resolve lifecycle ──────────────────────────────────────────────────────
  it('a case-access member resolves the blocker with a note', async () => {
    const res = await lsb.from('case_blockers')
      .update({ status: 'resolved', resolution_note: `lab results arrived ${tag}`, resolved_by: ids.lsb, resolved_at: new Date().toISOString() })
      .eq('id', blockerId)
      .select('status, resolution_note, resolved_by')
    expect(res.error).toBeNull()
    expect(res.data![0].status).toBe('resolved')
    expect(res.data![0].resolution_note).toContain('lab results arrived')
    expect(res.data![0].resolved_by).toBe(ids.lsb)
    const back = await lsb.from('case_blockers').select('status').eq('id', blockerId)
    expect(back.data?.[0]?.status).toBe('resolved')
  })

  // ── audit trail ────────────────────────────────────────────────────────────
  it('creating a blocker wrote an audit_log row (readable by owner)', async () => {
    const al = await owner.from('audit_log').select('action, entity').eq('entity', 'case_blockers').eq('entity_id', blockerId)
    expect(al.error).toBeNull()
    expect((al.data ?? []).some((r) => r.action === 'INSERT')).toBe(true)
  })

  // ── cases.priority vocabulary ──────────────────────────────────────────────
  it("cases.priority accepts 'high' but rejects 'urgent'", async () => {
    const ok = await lsb.from('cases').update({ priority: 'high' }).eq('id', caseId).select('priority')
    expect(ok.error).toBeNull()
    expect(ok.data![0].priority).toBe('high')
    const bad = await lsb.from('cases').update({ priority: 'urgent' }).eq('id', caseId).select('id')
    expect(bad.error).not.toBeNull()
    expect(bad.error!.code).toBe('23514')
  })

  // ── task link is ON DELETE SET NULL ────────────────────────────────────────
  it('a blocker survives deletion of its linked task with task_id nulled', async () => {
    const t = await lsb.from('case_tasks').insert({ case_id: caseId, title: `v126 dependency task ${tag}` }).select('id')
    expect(t.error).toBeNull()
    const taskId = t.data![0].id as string
    const b = await lsb.from('case_blockers')
      .insert({ case_id: caseId, title: `v126 blocked by task ${tag}`, type: 'task_dependency', task_id: taskId })
      .select('id, task_id')
    expect(b.error).toBeNull()
    expect(b.data![0].task_id).toBe(taskId)
    const linked = b.data![0].id as string
    // case_tasks delete allows the creator — lsb removes its own task.
    const del = await lsb.from('case_tasks').delete().eq('id', taskId).select('id')
    expect(del.error).toBeNull()
    const after = await lsb.from('case_blockers').select('id, task_id').eq('id', linked)
    expect(after.error).toBeNull()
    expect(after.data ?? []).toHaveLength(1)
    expect(after.data![0].task_id).toBeNull()
  })
})
