/** v1.59 — break-glass rework: Lead-granted restricted-media access, migration
 *  20260808320000_break_glass_lead_granted.
 *
 *  The D6 self-service break-glass becomes a REQUEST → DECIDE → REVOKE
 *  workflow. This suite proves, live:
 *   - the OLD self-service RPC (restricted_media_break_glass) is unreachable
 *     for authenticated (EXECUTE revoked — permission denied);
 *   - a case member without clearance can REQUEST access: the row lands
 *     status='pending' and the restricted media stays HIDDEN (the pending
 *     row's placeholder expires_at opens nothing);
 *   - a duplicate live request is refused; a non-member (cross-bureau) cannot
 *     request at all; a CLEARED member (lead = can_edit_narcotics_intel)
 *     cannot request — which is also why the decider≠requester guard cannot
 *     be probed end-to-end with these fixtures: the request RPC refuses
 *     command upstream, so we assert THAT refusal instead;
 *   - lead GRANTS → has_media_break_glass bites (lsb NOW sees the restricted
 *     row), expires_at ≈ 24h from the DECISION (> now()+23h — the placeholder
 *     was replaced), requester + command notifications exist, and the
 *     requester reads their remaining time via rag_sel on their own row;
 *   - lead REVOKES → media hidden again immediately, revoked fields set, and
 *     a revoked (non-live) grant cannot be re-revoked;
 *   - the DENY path requires a note and leaves media hidden;
 *   - case_restricted_events returns the request/grant/revoke trail to a case
 *     MEMBER (ral_sel stays command-only) but raises for a non-member;
 *   - log_restricted_view accepts the new 'download' action and rejects a
 *     bogus one;
 *   - the packet-export gate: has_restricted_packet_approval is false, lsb
 *     cannot approve (command gate), lead approves, then it reads true for
 *     case members;
 *   - anon is denied throughout.
 *
 *  Fixtures (v158 shape): lsb (LSB detective — requester, NO narcotics
 *  clearance), bcb (BCB detective — cross-bureau probe), lead (bureau_lead =
 *  command + clearance, the decider), owner (kept for shape), anon.
 *  media.case_id is ON DELETE SET NULL, so teardown lead-deletes the media row
 *  explicitly; grants cascade with the case and log rows are purged by the
 *  extended rls_test_cleanup (they have no case FK). */

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
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:v159] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.59 — Lead-granted break-glass (live)', () => {
  let lsb: C, bcb: C, lead: C, owner: C, anon: C
  let lsbId = '', leadId = ''
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let restrictedMediaId = ''
  let grantId = '' // first request → granted → revoked
  let grant2Id = '' // second request → denied

  const restrictedVisible = async (client: C) => {
    const r = await client.from('media').select('id').eq('id', restrictedMediaId)
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []).length === 1
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); owner = mk(); anon = mk()
    for (const [client, email, pw] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb],
      [lead, 'rls-test-lead@cidportal.test', PW.lead],
      [owner, 'rls-test-owner@cidportal.test', PW.owner],
    ] as const) {
      const id = await signInWithRetry(client, email, pw!)
      if (client === lsb) lsbId = id
      if (client === lead) leadId = id
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    // An LSB case the BCB detective cannot access; lead attaches a RESTRICTED
    // media row (media_ins has no restricted clause but lead has clearance).
    const c = await lsb.from('cases').insert({ case_number: `V159-${tag}`, title: `[rls-test] v159 break-glass case ${tag}`, bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(`case insert: ${c.error.message}`)
    caseId = c.data![0].id as string
    const m = await lead.from('media').insert({ title: `[rls-test] v159 restricted ${tag}`, type: 'image', case_id: caseId, restricted: true }).select('id')
    if (m.error) throw new Error(`media insert: ${m.error.message}`)
    restrictedMediaId = m.data![0].id as string
  })

  afterAll(async () => {
    if (!lead) return
    // media.case_id is ON DELETE SET NULL — delete the row explicitly before
    // the case sweep (lead = can_delete; the fixture case carries no hold).
    if (restrictedMediaId) { try { await lead.from('media').delete().eq('id', restrictedMediaId) } catch { /* best effort */ } }
    // Grants cascade with the case; log rows are purged by the extended
    // rls_test_cleanup (no case FK on restricted_access_log.entity_id).
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lsb, bcb, lead, owner, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ================= the self-service path is retired ================= */

  it('the OLD self-service break-glass RPC is unreachable for authenticated', async () => {
    const r = await lsb.rpc('restricted_media_break_glass', { p_case: caseId, p_reason: 'v159 retired path probe' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/permission denied/i)
  })

  /* ================= request gates ================= */

  it('a cleared member (lead/command) cannot request — refused upstream of the decider guard', async () => {
    // The decider≠requester rule cannot be probed end-to-end with these
    // fixtures: command IS the clearance tier, so the REQUEST RPC refuses lead
    // before a self-decidable row can ever exist. Assert that refusal.
    const r = await lead.rpc('restricted_media_request_access', { p_case: caseId, p_reason: 'v159 lead probe' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/already have clearance/i)
  })

  it('a non-member (cross-bureau) cannot request on the LSB case', async () => {
    const r = await bcb.rpc('restricted_media_request_access', { p_case: caseId, p_reason: 'v159 bcb probe' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/case you have access to/i)
  })

  it('a blank reason is refused', async () => {
    const r = await lsb.rpc('restricted_media_request_access', { p_case: caseId, p_reason: '   ' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/reason is required/i)
  })

  it('lsb requests access → pending; the restricted row stays HIDDEN', async () => {
    const r = await lsb.rpc('restricted_media_request_access', { p_case: caseId, p_reason: `v159 need restricted media ${tag}` })
    expect(r.error, r.error?.message).toBeNull()
    const g = r.data as { id: string; status: string; user_id: string }
    expect(g.status).toBe('pending')
    expect(g.user_id).toBe(lsbId)
    grantId = g.id
    // A pending request opens NOTHING — the placeholder expires_at is inert.
    expect(await restrictedVisible(lsb)).toBe(false)
  })

  it('a duplicate live request is refused', async () => {
    const r = await lsb.rpc('restricted_media_request_access', { p_case: caseId, p_reason: 'v159 duplicate' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/already have a pending request/i)
  })

  it('command got a restricted_access_requested notification for this request', async () => {
    const n = await lead.from('notifications').select('type, payload').eq('type', 'restricted_access_requested')
    expect(n.error, n.error?.message).toBeNull()
    const mine = (n.data ?? []).filter((row) => (row.payload as { grant_id?: string })?.grant_id === grantId)
    expect(mine.length).toBeGreaterThan(0)
  })

  /* ================= decide: gates + grant path ================= */

  it('a non-command member cannot decide', async () => {
    const r = await lsb.rpc('restricted_media_decide_access', { p_grant: grantId, p_decision: 'grant' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/restricted to command/i)
  })

  it('lead GRANTS → media visible to lsb, 24h clock starts at the decision', async () => {
    const before = Date.now()
    const r = await lead.rpc('restricted_media_decide_access', { p_grant: grantId, p_decision: 'grant', p_note: 'v159 approved' })
    expect(r.error, r.error?.message).toBeNull()
    const g = r.data as { status: string; decided_by: string; decided_at: string; expires_at: string }
    expect(g.status).toBe('granted')
    expect(g.decided_by).toBe(leadId)
    expect(g.decided_at).toBeTruthy()
    // The placeholder was replaced: expiry sits ~24h after the DECISION.
    expect(new Date(g.expires_at).getTime()).toBeGreaterThan(before + 23 * 3600 * 1000)
    // has_media_break_glass now bites — lsb sees the restricted row.
    expect(await restrictedVisible(lsb)).toBe(true)
  })

  it('the requester was notified of the grant', async () => {
    const n = await lsb.from('notifications').select('type, payload').eq('type', 'restricted_access_granted')
    expect(n.error, n.error?.message).toBeNull()
    const mine = (n.data ?? []).filter((row) => (row.payload as { grant_id?: string })?.grant_id === grantId)
    expect(mine.length).toBeGreaterThan(0)
  })

  it('the requester reads their remaining time via rag_sel on their own row', async () => {
    const r = await lsb.from('restricted_access_grants').select('status, expires_at, revoked_at').eq('id', grantId).maybeSingle()
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data?.status).toBe('granted')
    expect(r.data?.revoked_at).toBeNull()
    expect(new Date(r.data!.expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('an already-decided request cannot be re-decided', async () => {
    const r = await lead.rpc('restricted_media_decide_access', { p_grant: grantId, p_decision: 'deny', p_note: 'v159 too late' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/already been decided/i)
  })

  /* ================= revoke ================= */

  it('a non-command member cannot revoke', async () => {
    const r = await lsb.rpc('restricted_media_revoke_access', { p_grant: grantId, p_reason: 'v159 self-revoke probe' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/restricted to command/i)
  })

  it('lead REVOKES → media hidden again immediately, revoked fields set', async () => {
    const r = await lead.rpc('restricted_media_revoke_access', { p_grant: grantId, p_reason: `v159 no longer needed ${tag}` })
    expect(r.error, r.error?.message).toBeNull()
    const g = r.data as { status: string; revoked_at: string; revoked_by: string; revoke_reason: string }
    expect(g.status).toBe('revoked')
    expect(g.revoked_at).toBeTruthy()
    expect(g.revoked_by).toBe(leadId)
    expect(g.revoke_reason).toMatch(/no longer needed/)
    expect(await restrictedVisible(lsb)).toBe(false)
  })

  it('a revoked (non-live) grant cannot be re-revoked', async () => {
    const r = await lead.rpc('restricted_media_revoke_access', { p_grant: grantId, p_reason: 'v159 twice' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/only a live grant/i)
  })

  /* ================= deny path ================= */

  it('after the revoke, lsb may request again (the old row is no longer live)', async () => {
    const r = await lsb.rpc('restricted_media_request_access', { p_case: caseId, p_reason: `v159 second request ${tag}` })
    expect(r.error, r.error?.message).toBeNull()
    grant2Id = (r.data as { id: string }).id
  })

  it('deny REQUIRES a note', async () => {
    const r = await lead.rpc('restricted_media_decide_access', { p_grant: grant2Id, p_decision: 'deny' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/note is required/i)
  })

  it('lead DENIES with a note → media stays hidden, requester notified', async () => {
    const r = await lead.rpc('restricted_media_decide_access', { p_grant: grant2Id, p_decision: 'deny', p_note: 'v159 not justified' })
    expect(r.error, r.error?.message).toBeNull()
    expect((r.data as { status: string }).status).toBe('denied')
    expect(await restrictedVisible(lsb)).toBe(false)
    const n = await lsb.from('notifications').select('type, payload').eq('type', 'restricted_access_denied')
    expect(n.error, n.error?.message).toBeNull()
    const mine = (n.data ?? []).filter((row) => (row.payload as { grant_id?: string })?.grant_id === grant2Id)
    expect(mine.length).toBeGreaterThan(0)
  })

  /* ================= view/download audit ================= */

  it("log_restricted_view accepts 'download' and rejects a bogus action", async () => {
    const ok = await lsb.rpc('log_restricted_view', { p_entity_type: 'media', p_entity: restrictedMediaId, p_action: 'download' })
    expect(ok.error, ok.error?.message).toBeNull()
    const bad = await lsb.rpc('log_restricted_view', { p_entity_type: 'media', p_entity: restrictedMediaId, p_action: 'exfiltrate' })
    expect(bad.error).not.toBeNull()
    expect(bad.error!.message).toMatch(/invalid action/i)
  })

  /* ================= case timeline ================= */

  it('case_restricted_events returns the trail to a case MEMBER (lsb)', async () => {
    const r = await lsb.rpc('case_restricted_events', { p_case: caseId })
    expect(r.error, r.error?.message).toBeNull()
    const actions = ((r.data ?? []) as { action: string; entity_id: string }[]).map((e) => e.action)
    for (const expected of ['request', 'grant', 'revoke', 'deny', 'download']) {
      expect(actions, `timeline should contain '${expected}'`).toContain(expected)
    }
  })

  it('case_restricted_events raises for a non-member (bcb)', async () => {
    const r = await bcb.rpc('case_restricted_events', { p_case: caseId })
    expect(r.error).not.toBeNull()
  })

  /* ================= packet-export approval gate ================= */

  it('no fresh approval → false; lsb cannot approve (command gate)', async () => {
    const q = await lsb.rpc('has_restricted_packet_approval', { p_case: caseId })
    expect(q.error, q.error?.message).toBeNull()
    expect(q.data).toBe(false)
    const r = await lsb.rpc('packet_export_approve_restricted', { p_case: caseId, p_note: 'v159 member probe' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/restricted to command/i)
  })

  it('lead approves → true for case members inside the 1-hour window', async () => {
    const r = await lead.rpc('packet_export_approve_restricted', { p_case: caseId, p_note: `v159 packet ok ${tag}` })
    expect(r.error, r.error?.message).toBeNull()
    const q = await lsb.rpc('has_restricted_packet_approval', { p_case: caseId })
    expect(q.error, q.error?.message).toBeNull()
    expect(q.data).toBe(true)
    // Non-members never see a true (can_access_case gate inside the fn).
    const cross = await bcb.rpc('has_restricted_packet_approval', { p_case: caseId })
    expect(cross.error, cross.error?.message).toBeNull()
    expect(cross.data).toBe(false)
  })

  /* ================= anon ================= */

  it('anon is denied throughout', async () => {
    const req = await anon.rpc('restricted_media_request_access', { p_case: caseId, p_reason: 'v159 anon' })
    expect(req.error).not.toBeNull()
    const dec = await anon.rpc('restricted_media_decide_access', { p_grant: grantId, p_decision: 'grant' })
    expect(dec.error).not.toBeNull()
    const rev = await anon.rpc('restricted_media_revoke_access', { p_grant: grantId, p_reason: 'v159 anon' })
    expect(rev.error).not.toBeNull()
    const ev = await anon.rpc('case_restricted_events', { p_case: caseId })
    expect(ev.error).not.toBeNull()
    const pk = await anon.rpc('packet_export_approve_restricted', { p_case: caseId })
    expect(pk.error).not.toBeNull()
    const rows = await anon.from('restricted_access_grants').select('id').eq('case_id', caseId)
    expect(rows.data ?? []).toHaveLength(0)
  })
})
