/** v1.19 — Case sign-off integrity (Sprint 1A) — LIVE project, rls-test accounts.
 *
 *  Pins the contract added by migration 20260721040000 (+ the fixture-gated test
 *  helper 20260721040001):
 *   - Concurrency: the decision RPCs take SELECT ... FOR UPDATE and re-validate,
 *     so exactly ONE of two concurrent deciders transitions the case; the loser
 *     sees a clear application conflict (errcode P0001), not a silent no-op.
 *   - Provenance: every RPC-written history row now carries a real actor_id and a
 *     structured `source` (submit | reviewer | owner | command_override) plus
 *     from_status — the owner/override distinction is structural, not free-text.
 *   - Forgery blocked: case_signoff_history is RPC-only. A member with case
 *     access can no longer INSERT a row directly (csh_ins dropped, grants revoked).
 *   - Owner authz: signoff_owner_action is STRICT owner (lead detective or
 *     original submitter). A non-owner detective and a bureau_lead are rejected.
 *   - Command override: signoff_command_override is limited to Deputy Director /
 *     Director / Owner (never a bureau_lead, never rank-and-file), requires a
 *     reason, and is audited as source='command_override'.
 *
 *  Fixtures (tests/rls/README.md): lsb (LSB detective — case owner), bcb (BCB
 *  detective — non-owner), lead (LSB bureau_lead — the routed reviewer), director
 *  (SAB command), owner (is_owner). Same conventions as v114–v118: sequential
 *  sign-in with backoff, rls_test_cleanup() at start and teardown, every row
 *  authored by a fixture so cleanup catches it. Self-skips without fixture
 *  passwords. Requires migrations 20260721040000 + 20260721040001. */

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
if (!enabled) console.warn('[rls:v119] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

interface HistRow {
  action: string; actor_id: string | null; actor_name: string | null
  from_status: string | null; to_status: string | null; note: string | null; source: string | null
}
const hist = (c: C, caseId: string) =>
  c.from('case_signoff_history').select('action, actor_id, actor_name, from_status, to_status, note, source').eq('case_id', caseId)

describe.skipIf(!enabled)('v1.19 — sign-off integrity: concurrency, provenance, owner/override authz (live)', () => {
  let lsb: C, lead: C, lead2: C, bcb: C, director: C, owner: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()

  // Create an LSB case owned by the lsb detective; returns its id.
  let n = 0
  const newCase = async (): Promise<string> => {
    const r = await lsb.from('cases')
      .insert({ case_number: `V119-${tag}-${++n}`, title: 'v1.19 sign-off integrity case (LSB)', bureau: 'LSB' })
      .select('id')
    if (r.error) throw new Error(`case create failed: ${r.error.message}`)
    return r.data![0].id as string
  }
  // Place a fixture-owned case at a sign-off state deterministically (bypasses
  // private.signoff_pick, which selects deputy/director globally).
  const setState = async (caseId: string, status: string, stage: string | null = null) => {
    const r = await lsb.rpc('rls_test_set_signoff', { p_case: caseId, p_status: status, p_stage: stage })
    if (r.error) throw new Error(`set_signoff failed: ${r.error.message}`)
  }

  beforeAll(async () => {
    lsb = mk(); lead = mk(); lead2 = mk(); bcb = mk(); director = mk(); owner = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [lead2, 'rls-test-lead@cidportal.test', PW.lead, 'lead2'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
  })

  afterAll(async () => {
    if (!lsb) return
    const { error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    await Promise.all([lsb, lead, lead2, bcb, director, owner].filter(Boolean).map((c) => c.auth.signOut()))
  })

  // ── submit + decide provenance (real actor_id + structured source) ─────────
  it('signoff_submit writes exactly one history row with actor_id + source=submit', async () => {
    const caseId = await newCase()
    const s = await lsb.rpc('signoff_submit', { p_case: caseId })
    expect(s.error).toBeNull()
    expect(s.data?.signoff_stage).toBe('bureau_lead')

    const { data } = await hist(lsb, caseId)
    const rows = (data ?? []) as HistRow[]
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'submitted', actor_id: ids.lsb, from_status: 'none', source: 'submit' })
    expect(rows[0].actor_name).toBeTruthy()
  })

  // ── concurrency: exactly one decider wins, the loser gets P0001 ────────────
  it('two concurrent signoff_decide calls: exactly one succeeds, the other is a P0001 conflict', async () => {
    const caseId = await newCase()
    const s = await lsb.rpc('signoff_submit', { p_case: caseId })
    expect(s.error).toBeNull() // routes to bureau_lead (the `lead` fixture)

    const [a, b] = await Promise.all([
      lead.rpc('signoff_decide', { p_case: caseId, p_decision: 'deny', p_note: 'concurrent A' }),
      lead2.rpc('signoff_decide', { p_case: caseId, p_decision: 'deny', p_note: 'concurrent B' }),
    ])
    const oks = [a, b].filter((r) => !r.error)
    const errs = [a, b].filter((r) => r.error)
    expect(oks).toHaveLength(1)
    expect(errs).toHaveLength(1)
    // The loser is a clear application conflict, not a silent no-op or a generic error.
    expect(errs[0].error!.code).toBe('P0001')
    expect(errs[0].error!.message).toMatch(/reload and retry/i)

    // Case ended in a single consistent state with exactly one 'denied' row,
    // carrying a real actor_id and source=reviewer.
    const cur = await lsb.from('cases').select('signoff_status, signoff_stage').eq('id', caseId).single()
    expect(cur.data?.signoff_status).toBe('denied')
    expect(cur.data?.signoff_stage).toBeNull()
    const { data } = await hist(lsb, caseId)
    const denied = ((data ?? []) as HistRow[]).filter((r) => r.action === 'denied')
    expect(denied).toHaveLength(1)
    expect(denied[0]).toMatchObject({ actor_id: ids.lead, to_status: 'denied', source: 'reviewer' })
    expect(denied[0].from_status).toBe('awaiting_bureau_lead')
  })

  // ── forgery blocked: history is RPC-only now ───────────────────────────────
  it('a member with case access can NOT insert a history row directly (csh_ins dropped + grants revoked)', async () => {
    const caseId = await newCase()
    const res = await lsb.from('case_signoff_history')
      .insert({ case_id: caseId, action: 'forged', actor_name: 'spoof', to_status: 'ready_doj', source: 'reviewer' })
    expect(res.error).not.toBeNull() // permission denied / RLS violation
  })

  // ── owner authz (strict) — signoff_owner_action ────────────────────────────
  it('owner action — a non-owner detective is rejected at the deputy stop-point', async () => {
    const caseId = await newCase()
    await setState(caseId, 'approved_deputy')
    const res = await bcb.rpc('signoff_owner_action', { p_case: caseId, p_action: 'complete' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/only the case owner/i)
  })

  it('owner action — a bureau_lead (not the owner) is rejected — owner is not a command role here', async () => {
    const caseId = await newCase()
    await setState(caseId, 'approved_deputy')
    const res = await lead.rpc('signoff_owner_action', { p_case: caseId, p_action: 'complete' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/only the case owner/i)
  })

  it('owner action — the original submitter succeeds and is audited as source=owner', async () => {
    const caseId = await newCase()
    await setState(caseId, 'approved_deputy') // submitter coalesced to lsb (the caller/creator)
    const res = await lsb.rpc('signoff_owner_action', { p_case: caseId, p_action: 'complete' })
    expect(res.error).toBeNull()
    expect(res.data?.signoff_status).toBe('approved_complete')
    const { data } = await hist(lsb, caseId)
    const completed = ((data ?? []) as HistRow[]).filter((r) => r.action === 'completed')
    expect(completed).toHaveLength(1)
    expect(completed[0]).toMatchObject({ actor_id: ids.lsb, from_status: 'approved_deputy', to_status: 'approved_complete', source: 'owner' })
  })

  // ── command override authz (narrow) — signoff_command_override ──────────────
  it('command override — a rank-and-file detective is rejected', async () => {
    const caseId = await newCase()
    await setState(caseId, 'approved_deputy')
    const res = await bcb.rpc('signoff_command_override', { p_case: caseId, p_action: 'complete', p_reason: 'should fail' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/deputy director, director, or owner/i)
  })

  it('command override — a bureau_lead is rejected (never Bureau Lead)', async () => {
    const caseId = await newCase()
    await setState(caseId, 'approved_deputy')
    const res = await lead.rpc('signoff_command_override', { p_case: caseId, p_action: 'complete', p_reason: 'should fail' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/deputy director, director, or owner/i)
  })

  it('command override — an authorized actor with a blank reason is rejected', async () => {
    const caseId = await newCase()
    await setState(caseId, 'approved_deputy')
    const res = await director.rpc('signoff_command_override', { p_case: caseId, p_action: 'complete', p_reason: '   ' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/reason is required/i)
  })

  it('command override — the Director succeeds and is audited distinctly as source=command_override', async () => {
    const caseId = await newCase()
    await setState(caseId, 'approved_deputy')
    const reason = 'owner on LOA — director completing on their behalf'
    const res = await director.rpc('signoff_command_override', { p_case: caseId, p_action: 'complete', p_reason: reason })
    expect(res.error).toBeNull()
    expect(res.data?.signoff_status).toBe('approved_complete')
    const { data } = await hist(lsb, caseId)
    const row = ((data ?? []) as HistRow[]).find((r) => r.source === 'command_override')
    expect(row).toBeTruthy()
    expect(row).toMatchObject({
      action: 'completed', actor_id: ids.director,
      from_status: 'approved_deputy', to_status: 'approved_complete', note: reason, source: 'command_override',
    })
    // Structural distinction: the override is NOT recorded as an owner action.
    expect(row!.source).not.toBe('owner')
  })

  it('command override — the Owner (is_owner) may also override', async () => {
    const caseId = await newCase()
    await setState(caseId, 'approved_deputy')
    const res = await owner.rpc('signoff_command_override', { p_case: caseId, p_action: 'escalate', p_reason: 'owner escalating for review' })
    expect(res.error).toBeNull()
    expect(res.data?.signoff_status).toBe('awaiting_director')
    const { data } = await hist(lsb, caseId)
    const row = ((data ?? []) as HistRow[]).find((r) => r.action === 'escalated')
    expect(row).toMatchObject({ actor_id: ids.owner, source: 'command_override', to_status: 'awaiting_director' })
  })
})
