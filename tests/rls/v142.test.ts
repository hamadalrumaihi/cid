/** v1.42 — workflow dead ends unblocked
 *  (migrations 20260807100000_legal_resubmit_clears_judge,
 *   20260807110000_search_exclude_merged_persons,
 *   20260807120000_membership_rereview_terminal).
 *
 *  Pins:
 *   - JUDGE RETURN LOOP: a judge-routed warrant is claimed, returned for
 *     revision, revised and resubmitted — the resubmission clears the stale
 *     judicial assignment, so a second judge can claim it (previously the
 *     claim lane answered "a judge is already assigned" forever and the
 *     request stranded);
 *   - TERMINAL RE-REVIEW: a rejected membership request can be re-reviewed
 *     to approved — the queue's "Re-review" button finally has a server path
 *     (previously every route back was closed: unique row, edit policies,
 *     assign_member guard, and this RPC's pending-only gate);
 *   - MERGED SEARCH: a merged person tombstone no longer surfaces in
 *     search_all / search_persons (matching the narcotics branch).
 *
 *  Fixtures: lsb (LSB detective — investigator + searcher), lead (LSB
 *  bureau_lead — CID reviewer), director (merges, reviews membership),
 *  judge/judge2 (claim lane), applicant (disposable membership fixture,
 *  reset inactive before and after). rls_test_cleanup sweeps requests,
 *  cases, and membership rows at start and teardown; the two test persons
 *  are deleted in afterAll by the director. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
  judge2: process.env.RLS_TEST_PASSWORD_JUDGE2,
  applicant: process.env.RLS_TEST_PASSWORD_APPLICANT,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.director && PW.judge && PW.judge2 && PW.applicant)
if (!enabled) console.warn('[rls:v142] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.42 — workflow dead ends unblocked (live)', () => {
  let lsb: C, lead: C, director: C, judge: C, judge2: C, applicant: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let personId = ''
  let victimId = ''
  let warrantId = ''
  let requestId = ''

  beforeAll(async () => {
    lsb = mk(); lead = mk(); director = mk(); judge = mk(); judge2 = mk(); applicant = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [judge, 'rls-test-judge@cidportal.test', PW.judge, 'judge'],
      [judge2, 'rls-test-judge2@cidportal.test', PW.judge2, 'judge2'],
      [applicant, 'rls-test-applicant@cidportal.test', PW.applicant, 'applicant'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await director.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const park = await director.rpc('rls_test_reset_member', { p_target: ids.applicant, p_role: 'detective', p_division: 'LSB', p_active: false })
    if (park.error) throw new Error(`applicant reset failed: ${park.error.message}`)

    const c = await lsb.from('cases').insert({ case_number: `V142-${tag}`, title: '[rls-test] v142 legal case', bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id
    const p = await lsb.from('persons').insert({ name: `RLS Test V142 Suspect ${tag}` }).select('id')
    if (p.error) throw new Error(p.error.message)
    personId = p.data![0].id
  })

  afterAll(async () => {
    if (!director) return
    await director.rpc('rls_test_reset_member', { p_target: ids.applicant, p_role: 'detective', p_division: 'LSB', p_active: false })
    const clean = await director.rpc('rls_test_cleanup')
    if (clean.error) throw new Error(`rls_test_cleanup failed: ${clean.error.message}`)
    // Persons are outside rls_test_cleanup's sweep — delete the two test
    // records (the merge victim is a tombstone; the survivor carries no refs
    // after cleanup removed the legal request).
    for (const pid of [victimId, personId]) {
      if (!pid) continue
      const del = await director.from('persons').delete().eq('id', pid)
      if (del.error) console.warn('[rls:v142] person cleanup failed:', del.error.message)
    }
    await Promise.all([lsb, lead, director, judge, judge2, applicant].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── 1. judge return -> resubmit -> second claim ── */

  it('a judge-returned request re-enters the open claim lane after resubmission', async () => {
    const cr = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `[rls-test] V142 warrant ${tag}`, p_priority: 'High', p_person: personId,
      p_narrative: '[rls-test] v142 probable cause',
    })
    expect(cr.error).toBeNull()
    warrantId = (cr.data as { id: string }).id

    // CID approval requires at least one supporting item in the packet.
    const ex = await lsb.rpc('add_legal_exhibit', { p_request: warrantId, p_type: 'external_link', p_meta: { url: 'https://evidence.example/v142' } })
    expect(ex.error).toBeNull()
    const sub1 = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId })
    expect(sub1.error).toBeNull()
    const ap1 = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ap1.error).toBeNull()

    // Parallel lane: judge claims directly, then returns for revision.
    const claim1 = await judge.rpc('claim_legal_request_as_judge', { p_request: warrantId })
    expect(claim1.error).toBeNull()
    const ret = await judge.rpc('decide_legal_request_as_judge', { p_request: warrantId, p_decision: 'return', p_note: '[rls-test] tighten the PC statement' })
    expect(ret.error).toBeNull()

    // Resubmission clears the stale judicial assignment (20260807100000)…
    const sub2 = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId, p_change_summary: '[rls-test] PC tightened' })
    expect(sub2.error).toBeNull()
    const row = await lsb.from('legal_requests').select('assigned_judge_id,review_status').eq('id', warrantId)
    expect(row.error).toBeNull()
    expect(row.data![0].assigned_judge_id).toBeNull()

    const ap2 = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ap2.error).toBeNull()

    // …so a DIFFERENT judge can claim round two (previously: "a judge is
    // already assigned", forever).
    const claim2 = await judge2.rpc('claim_legal_request_as_judge', { p_request: warrantId })
    expect(claim2.error).toBeNull()
    const after = await lsb.from('legal_requests').select('assigned_judge_id,review_status').eq('id', warrantId)
    expect(after.data![0]).toMatchObject({ assigned_judge_id: ids.judge2, review_status: 'judicial_review' })

    // Close it out so nothing dangles: judge2 denies with a note.
    const done = await judge2.rpc('decide_legal_request_as_judge', { p_request: warrantId, p_decision: 'deny', p_note: '[rls-test] v142 closing out' })
    expect(done.error).toBeNull()
  })

  /* ── 2. rejected membership requests are re-reviewable ── */

  it('a rejected request can be re-reviewed to approved (the queue button finally works)', async () => {
    const ins = await applicant.from('membership_requests')
      .insert({
        applicant_id: ids.applicant, display_name: 'RLS Test Applicant',
        requested_bureau: 'LSB', requested_role: 'detective', reason: '[rls-test] v142 join',
      })
      .select('id')
    expect(ins.error).toBeNull()
    requestId = ins.data![0].id
    const sub = await applicant.rpc('membership_request_submit', { p_request: requestId })
    expect(sub.error).toBeNull()

    const rej = await director.rpc('review_membership_request', { p_request: requestId, p_decision: 'reject', p_applicant_note: '[rls-test] v142 first decision' })
    expect(rej.error).toBeNull()

    // Old gate: 'request is not awaiting review'. New: the terminal row is
    // re-reviewable and the approval activates the applicant atomically.
    const re = await director.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve', p_final_bureau: 'LSB', p_final_role: 'detective',
      p_applicant_note: '[rls-test] v142 superseding decision',
    })
    expect(re.error).toBeNull()
    const prof = await director.from('profiles').select('active,role,division').eq('id', ids.applicant)
    expect(prof.data![0]).toMatchObject({ active: true, role: 'detective', division: 'LSB' })

    // Park the disposable applicant back to its inactive baseline.
    const park = await director.rpc('rls_test_reset_member', { p_target: ids.applicant, p_role: 'detective', p_division: 'LSB', p_active: false })
    expect(park.error).toBeNull()
  })

  it('an APPROVED request is not re-reviewable (member management owns it now); self-review stays blocked', async () => {
    // Only refusals are supersedable — an accepted membership is managed via
    // deactivate/remove, never by rewriting the approval.
    const again = await director.rpc('review_membership_request', { p_request: requestId, p_decision: 'reject', p_applicant_note: '[rls-test] v142 must fail' })
    expect(again.error).not.toBeNull()
    expect(again.error!.message).toMatch(/not awaiting review/i)
    const self = await applicant.rpc('review_membership_request', { p_request: requestId, p_decision: 'approve' })
    expect(self.error).not.toBeNull()
  })

  /* ── 3. merged person tombstones leave search ── */

  it('a merged person no longer surfaces in search_all or search_persons', async () => {
    const uniq = `Zzyzx${tag}`
    const v = await lsb.from('persons').insert({ name: `RLS Test ${uniq} Victim` }).select('id')
    expect(v.error).toBeNull()
    victimId = v.data![0].id

    const before = await lsb.rpc('search_all', { q: uniq })
    expect(before.error).toBeNull()
    expect((before.data as { entity: string; id: string }[]).some((h) => h.id === victimId)).toBe(true)

    const merge = await director.rpc('person_merge', { p_survivor: personId, p_victims: [victimId], p_reason: `[rls-test] v142 dedupe ${tag}` })
    expect(merge.error).toBeNull()

    const after = await lsb.rpc('search_all', { q: uniq })
    expect(after.error).toBeNull()
    expect((after.data as { entity: string; id: string }[]).some((h) => h.id === victimId)).toBe(false)

    const sp = await lsb.rpc('search_persons', { p_q: uniq })
    expect(sp.error).toBeNull()
    expect((sp.data as { id: string }[]).some((h) => h.id === victimId)).toBe(false)
  })
})
