/** v1.23 — Sprint 1D: case bureau reassignment. LIVE project, rls-test
 *  accounts. Pins migration 20260725010000:
 *   - trg_block_direct_case_bureau freezes cases.bureau + originating_bureau
 *     against ALL direct client writes — even the case creator/lead can no
 *     longer PATCH a case across the bureau visibility wall.
 *   - case_reassign_bureau is the one authorized path: Deputy Director /
 *     Director / Owner ONLY (bureau_lead is excluded — the transfer precedent
 *     reserves unilateral moves for DD+), reason required, destination must be
 *     a permanent bureau ('JTF' rejected — bureau='JTF' means visible to every
 *     active member, so it can never be a reassignment destination),
 *     same-bureau reassignment rejected, audit_log row carries old + new
 *     bureau + reason, and the case's officers are notified.
 *   - Related records follow the case (child tables key off can_access_case),
 *     and the creator keeps access after the move via the creator clause.
 *
 *  Fixtures (tests/rls/README.md): lsb (LSB detective, case creator + lead),
 *  bcb (BCB detective — bureau isolation before, visibility after), lead
 *  (LSB bureau_lead — must be denied), director (SAB director — authorized),
 *  owner (audit_log reader). Same conventions as the sibling suites;
 *  rls_test_cleanup at start + teardown. Requires migration 20260725010000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director && PW.owner)
if (!enabled) console.warn('[rls:v123] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.23 — case bureau reassignment: freeze + authorized RPC (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C, owner: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const reason = `[rls-test] v123 jurisdiction correction ${tag}`
  let caseId = ''
  let caseNum = ''
  let taskId = ''

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk(); owner = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    // The case under test: LSB, created and led by the LSB detective. A child
    // row (case_tasks) is created BEFORE reassignment to prove related records
    // stay correctly accessible after the move.
    const c = await lsb.from('cases')
      .insert({ case_number: `V123-${tag}`, title: 'v1.23 bureau reassignment case', bureau: 'LSB', lead_detective_id: ids.lsb })
      .select('id, case_number')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id as string
    caseNum = c.data![0].case_number as string
    const t = await lsb.from('case_tasks').insert({ case_id: caseId, title: `v123 task ${tag}` }).select('id')
    if (t.error) throw new Error(t.error.message)
    taskId = t.data![0].id as string
  })

  afterAll(async () => {
    if (!lsb) return
    // Best-effort explicit teardown (these resolve with {error}; they never
    // reject); rls_test_cleanup then sweeps anything left (case, tasks,
    // notifications are all keyed to fixture accounts).
    if (director) {
      await director.from('case_tasks').delete().eq('case_id', caseId)
      await director.from('cases').delete().eq('id', caseId)
    }
    const clean = await lsb.rpc('rls_test_cleanup')
    if (clean.error) throw new Error(`rls_test_cleanup failed: ${clean.error.message}`)
    await Promise.all([lsb, bcb, lead, director, owner].filter(Boolean).map((c) => c.auth.signOut()))
  })

  // ── the freeze: no direct client mutation, not even by the creator/lead ────
  it('baseline: the BCB detective cannot see the LSB case', async () => {
    const res = await bcb.from('cases').select('id').eq('id', caseId)
    expect(res.data ?? []).toHaveLength(0)
  })

  it('the creator/lead can NOT change cases.bureau directly (trigger raises)', async () => {
    const res = await lsb.from('cases').update({ bureau: 'BCB' }).eq('id', caseId).select('id')
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/case_reassign_bureau/)
    const check = await lsb.from('cases').select('bureau').eq('id', caseId)
    expect(check.data?.[0]?.bureau).toBe('LSB')
  })

  it('the creator/lead can NOT change originating_bureau directly either', async () => {
    const res = await lsb.from('cases').update({ originating_bureau: 'BCB' }).eq('id', caseId).select('id')
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/case_reassign_bureau/)
  })

  // ── RPC authorization: DD+/Owner only ───────────────────────────────────────
  it('case_reassign_bureau as a detective (the creator) is denied', async () => {
    const res = await lsb.rpc('case_reassign_bureau', { p_case: caseId, p_to_bureau: 'BCB', p_reason: reason })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/Deputy Director or higher/i)
  })

  it('case_reassign_bureau as a bureau_lead is denied (DD+ only)', async () => {
    const res = await lead.rpc('case_reassign_bureau', { p_case: caseId, p_to_bureau: 'BCB', p_reason: reason })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/Deputy Director or higher/i)
  })

  // ── validation ──────────────────────────────────────────────────────────────
  it('a blank reason is rejected', async () => {
    const res = await director.rpc('case_reassign_bureau', { p_case: caseId, p_to_bureau: 'BCB', p_reason: '   ' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/reason is required/i)
  })

  it("'JTF' is rejected as a destination — no everyone-visible shortcut", async () => {
    const res = await director.rpc('case_reassign_bureau', { p_case: caseId, p_to_bureau: 'JTF', p_reason: reason })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/JTF/)
    const check = await director.from('cases').select('bureau').eq('id', caseId)
    expect(check.data?.[0]?.bureau).toBe('LSB')
  })

  // ── the authorized path ─────────────────────────────────────────────────────
  it('a director with a reason reassigns the case LSB → BCB', async () => {
    const res = await director.rpc('case_reassign_bureau', { p_case: caseId, p_to_bureau: 'BCB', p_reason: reason })
    expect(res.error).toBeNull()
    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as { bureau: string; originating_bureau: string | null }
    expect(row.bureau).toBe('BCB')
    // Provenance is preserved by default (p_update_originating not passed).
    expect(row.originating_bureau).toBeNull()
  })

  it('a same-bureau reassignment is rejected', async () => {
    const res = await director.rpc('case_reassign_bureau', { p_case: caseId, p_to_bureau: 'BCB', p_reason: reason })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/already in BCB/i)
  })

  // ── audit, notification, and post-move access ──────────────────────────────
  it('the audit_log row records old + new bureau and the reason', async () => {
    const al = await owner.from('audit_log')
      .select('action, entity, actor_id, detail')
      .eq('entity', 'cases').eq('entity_id', caseId).eq('action', 'REASSIGN_BUREAU')
    expect((al.data ?? []).length).toBeGreaterThanOrEqual(1)
    const row = al.data![0] as { actor_id: string; detail: { from: string; to: string; reason: string } }
    expect(row.actor_id).toBe(ids.director)
    expect(row.detail.from).toBe('LSB')
    expect(row.detail.to).toBe('BCB')
    expect(row.detail.reason).toContain(`v123 jurisdiction correction ${tag}`)
  })

  it('the lead detective is notified of the reassignment', async () => {
    const res = await lsb.from('notifications')
      .select('type, payload')
      .eq('user_id', ids.lsb).eq('type', 'case_reassigned')
    const mine = (res.data ?? []).filter((n) => (n.payload as { case_id?: string }).case_id === caseId)
    expect(mine.length).toBeGreaterThanOrEqual(1)
    expect(mine[0].payload as object).toMatchObject({ from: 'LSB', to: 'BCB', case_number: caseNum })
  })

  it('related records follow the case: the pre-move task is still readable', async () => {
    const res = await director.from('case_tasks').select('id').eq('case_id', caseId)
    expect((res.data ?? []).map((r) => r.id)).toContain(taskId)
  })

  it('the destination bureau can now see the case; the creator keeps access', async () => {
    const b = await bcb.from('cases').select('id, bureau').eq('id', caseId)
    expect(b.data ?? []).toHaveLength(1)
    // The creator clause holds across the move — no orphaned casework.
    const l = await lsb.from('cases').select('id, bureau').eq('id', caseId)
    expect(l.data ?? []).toHaveLength(1)
    const lt = await lsb.from('case_tasks').select('id').eq('case_id', caseId)
    expect((lt.data ?? []).map((r) => r.id)).toContain(taskId)
  })
})
