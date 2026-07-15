/** v1.27 — Action Center: case access request decision path + decision
 *  notifications (migration 20260728010000). Pins:
 *   - the decide flow is plain RLS writes under private.can_grant_case: a
 *     requester CANNOT approve their own request (car_upd → 0 rows), while a
 *     bureau_lead CAN flip status + decided_by/decided_at and insert the
 *     case_access_grants row (cag_ins); after the grant the requester gains
 *     case visibility through private.can_access_case.
 *   - create_notification admits the new 'access_granted'/'access_denied'
 *     types ONLY for someone holding can_grant_case on payload.case_id — the
 *     exact car_upd/cag_ins authority. A non-granter (the requester
 *     themselves) cannot forge either decision notice.
 *   - deny path: a denied request grants nothing — the requester still cannot
 *     select the case.
 *
 *  Fixtures (tests/rls/README.md): lsb (LSB detective, case creator + lead),
 *  bcb (BCB detective — the cross-bureau requester), lead (LSB bureau_lead —
 *  the decider), director (command teardown). Same conventions as the sibling
 *  suites; rls_test_cleanup at start + teardown (requests/grants cascade with
 *  the fixture cases; fixture notifications are swept by user_id).
 *  Requires migration 20260728010000. */

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
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director)
if (!enabled) console.warn('[rls:v127] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.27 — access request decisions + decision notifications (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''      // approve-path case (LSB, led by lsb)
  let caseId2 = ''     // deny-path case (LSB, led by lsb)
  let requestId = ''   // bcb's request on caseId
  let requestId2 = ''  // bcb's request on caseId2

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    // Two LSB cases led by the LSB detective: one for the approve path, one
    // for the deny path (a grant on the first must not bleed into the second).
    const c1 = await lsb.from('cases')
      .insert({ case_number: `V127A-${tag}`, title: 'v1.27 access approve case', bureau: 'LSB', lead_detective_id: ids.lsb })
      .select('id')
    if (c1.error) throw new Error(c1.error.message)
    caseId = c1.data![0].id as string
    const c2 = await lsb.from('cases')
      .insert({ case_number: `V127D-${tag}`, title: 'v1.27 access deny case', bureau: 'LSB', lead_detective_id: ids.lsb })
      .select('id')
    if (c2.error) throw new Error(c2.error.message)
    caseId2 = c2.data![0].id as string
  })

  afterAll(async () => {
    if (!lsb) return
    // Best-effort explicit teardown; rls_test_cleanup then sweeps anything
    // left (requests + grants cascade with the fixture cases' plain delete,
    // fixture notifications are deleted by user_id).
    if (director) {
      await director.from('cases').delete().eq('id', caseId)
      await director.from('cases').delete().eq('id', caseId2)
    }
    const clean = await lsb.rpc('rls_test_cleanup')
    if (clean.error) throw new Error(`rls_test_cleanup failed: ${clean.error.message}`)
    await Promise.all([lsb, bcb, lead, director].filter(Boolean).map((c) => c.auth.signOut()))
  })

  // ── the wall + the request ─────────────────────────────────────────────────
  it('the cross-bureau detective cannot see the case before any grant', async () => {
    const res = await bcb.from('cases').select('id').eq('id', caseId)
    expect(res.error).toBeNull()
    expect(res.data ?? []).toHaveLength(0)
  })

  it('the cross-bureau detective files an access request (car_ins as requester)', async () => {
    const res = await bcb.from('case_access_requests')
      .insert({ case_id: caseId, requester_id: ids.bcb, reason: `v127 need eyes on this ${tag}` })
      .select('id, status')
    expect(res.error).toBeNull()
    expect(res.data![0].status).toBe('pending')
    requestId = res.data![0].id as string
  })

  // ── self-approval denied ───────────────────────────────────────────────────
  it('the requester CANNOT approve their own request (car_upd → 0 rows)', async () => {
    const res = await bcb.from('case_access_requests')
      .update({ status: 'approved', decided_by: ids.bcb, decided_at: new Date().toISOString() })
      .eq('id', requestId)
      .select('id')
    // can_grant_case is false for the requester: RLS either filters the row
    // (0 rows) or rejects the write outright — never a successful update.
    if (res.error) {
      expect(res.error).not.toBeNull()
    } else {
      expect(res.data ?? []).toHaveLength(0)
    }
    const back = await bcb.from('case_access_requests').select('status').eq('id', requestId)
    expect(back.data?.[0]?.status).toBe('pending')
  })

  // ── the approve path (bureau_lead) ─────────────────────────────────────────
  it('the bureau lead approves: request status flips + grant row inserted', async () => {
    const upd = await lead.from('case_access_requests')
      .update({ status: 'approved', decided_by: ids.lead, decided_at: new Date().toISOString() })
      .eq('id', requestId)
      .select('id, status, decided_by')
    expect(upd.error).toBeNull()
    expect(upd.data ?? []).toHaveLength(1)
    expect(upd.data![0].status).toBe('approved')
    expect(upd.data![0].decided_by).toBe(ids.lead)
    const grant = await lead.from('case_access_grants')
      .insert({ case_id: caseId, officer_id: ids.bcb })
      .select('id, officer_id')
    expect(grant.error).toBeNull()
    expect(grant.data![0].officer_id).toBe(ids.bcb)
  })

  it('after the grant the requester CAN select the case (can_access_case via grant)', async () => {
    const res = await bcb.from('cases').select('id, case_number').eq('id', caseId)
    expect(res.error).toBeNull()
    expect(res.data ?? []).toHaveLength(1)
    expect(res.data![0].id).toBe(caseId)
  })

  // ── decision notifications: granter yes, non-granter no ───────────────────
  it("the granter emits 'access_granted' and the requester reads it", async () => {
    const res = await lead.rpc('create_notification', {
      p_user_id: ids.bcb,
      p_type: 'access_granted',
      p_payload: { case_id: caseId, case_number: `V127A-${tag}`, title: 'v1.27 access approve case' },
    })
    expect(res.error).toBeNull()
    const inbox = await bcb.from('notifications')
      .select('type, payload')
      .eq('type', 'access_granted')
    expect(inbox.error).toBeNull()
    const mine = (inbox.data ?? []).filter((n) => (n.payload as Record<string, unknown>)?.case_id === caseId)
    expect(mine).toHaveLength(1)
    expect((mine[0].payload as Record<string, unknown>).actor_id).toBe(ids.lead)
  })

  it("a non-granter CANNOT emit 'access_granted' for the case", async () => {
    const res = await bcb.rpc('create_notification', {
      p_user_id: ids.bcb,
      p_type: 'access_granted',
      p_payload: { case_id: caseId, case_number: `V127A-${tag}` },
    })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/not authorized/i)
  })

  it("'access_denied' for a case the caller cannot grant is refused", async () => {
    const res = await bcb.rpc('create_notification', {
      p_user_id: ids.bcb,
      p_type: 'access_denied',
      p_payload: { case_id: caseId2, case_number: `V127D-${tag}` },
    })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/not authorized/i)
  })

  // ── the deny path ──────────────────────────────────────────────────────────
  it('deny path: lead denies the second request; requester still cannot select the case', async () => {
    const req = await bcb.from('case_access_requests')
      .insert({ case_id: caseId2, requester_id: ids.bcb, reason: `v127 second look ${tag}` })
      .select('id')
    expect(req.error).toBeNull()
    requestId2 = req.data![0].id as string
    const upd = await lead.from('case_access_requests')
      .update({ status: 'denied', decided_by: ids.lead, decided_at: new Date().toISOString() })
      .eq('id', requestId2)
      .select('id, status')
    expect(upd.error).toBeNull()
    expect(upd.data ?? []).toHaveLength(1)
    expect(upd.data![0].status).toBe('denied')
    const notif = await lead.rpc('create_notification', {
      p_user_id: ids.bcb,
      p_type: 'access_denied',
      p_payload: { case_id: caseId2, case_number: `V127D-${tag}`, title: 'v1.27 access deny case' },
    })
    expect(notif.error).toBeNull()
    // A denial grants nothing: no case_access_grants row, no visibility.
    const cases = await bcb.from('cases').select('id').eq('id', caseId2)
    expect(cases.error).toBeNull()
    expect(cases.data ?? []).toHaveLength(0)
  })
})
