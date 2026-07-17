/** v1.37 — pending CID reviewer visibility
 *  (migration 20260806040000_legal_cid_reviewer_visibility).
 *
 *  One additive branch in private.can_view_legal_request:
 *    r.review_status = 'cid_supervisor_review'
 *      AND private.can_review_as_cid(p_request, p_user)
 *  — whoever the review RPC would accept (active senior CID rank + case
 *  access + not the creator) can SEE the request while it awaits CID review,
 *  ANY classification. Before this, warrants (classified by default) were
 *  invisible to the very supervisor who must review them.
 *
 *  Pins:
 *   - a classified warrant at cid_supervisor_review IS visible to the
 *     same-bureau bureau_lead (non-creator; case access via is_command);
 *   - the legal_request_versions child rows ride the same predicate;
 *   - a non-supervisor same-bureau detective (case access via division, rank
 *     'detective') still sees NOTHING — the branch needs review authority,
 *     not just case access; the creator keeps the creator branch;
 *   - a senior rank WITHOUT case access (senior_detective parked in another
 *     bureau via rls_test_reset_member) still sees NOTHING — the branch needs
 *     case access, not just rank;
 *   - after the supervisor approves (review_legal_request_as_cid), the RPC
 *     records them as a 'cid_supervisor' participant, so they REMAIN visible
 *     via is_legal_participant once the status branch no longer applies;
 *   - a SEALED request at cid_supervisor_review is visible to the pending
 *     reviewer (deliberate — the CID gate is mandatory for sealed too) and
 *     stays invisible to the no-access supervisor and to an unrelated judge;
 *   - a classified DRAFT (not submitted) is invisible to the supervisor —
 *     the branch is scoped to the one status.
 *
 *  Fixtures (tests/rls/README.md): lsb (creator detective), lead (LSB
 *  bureau_lead — case access via is_command), bcb (other-bureau detective),
 *  target (throwaway — temporarily senior_detective/BCB, restored to
 *  detective/LSB in teardown via rls_test_reset_member), director (performs
 *  the resets), judge. All requests are [rls-test] v137 search warrants on a
 *  per-run LSB case; rls_test_cleanup() runs at start AND teardown.
 *  legal_notify suppresses test-actor → real-target pings, so submit/approve
 *  never notify real members. Requires migration 20260806040000 applied. */

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
  target: process.env.RLS_TEST_PASSWORD_TARGET,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director && PW.target && PW.judge)
if (!enabled) console.warn('[rls:v137] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.37 — pending CID reviewer visibility (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C, target: C, judge: C
  let leadId = ''
  let targetId = ''
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''       // LSB fixture case (lsb-created)
  let classifiedId = '' // classified (by DEFAULT) warrant, submitted → cid_supervisor_review
  let sealedId = ''     // sealed warrant, submitted → cid_supervisor_review (stays pending)
  let draftId = ''      // classified warrant, NEVER submitted — status-scoping pin

  const draft = async (title: string, classification?: string) => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'search_warrant',
      p_title: `[rls-test] v137 ${title} ${tag}`, p_priority: 'Medium',
      p_narrative: 'Pending-CID-reviewer visibility wall test.',
      p_form: { search_targets: 'RLS test locker 137' },
      ...(classification ? { p_classification: classification } : {}),
    })
    if (r.error) throw new Error(`create ${title}: ${r.error.message}`)
    return r.data!.id as string
  }

  // The throwaway target's durable baseline (rls.test.ts convention).
  const resetTarget = (role: string, division: string) =>
    director.rpc('rls_test_reset_member', {
      p_target: targetId, p_role: role, p_division: division, p_active: true,
    })

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk(); target = mk(); judge = mk()
    // Sequential with backoff — parallel password grants trip the per-IP limit.
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [target, 'rls-test-target@cidportal.test', PW.target, 'target'],
      [judge, 'rls-test-judge@cidportal.test', PW.judge, 'judge'],
    ] as const) {
      const id = await signInWithRetry(client, email, pw!)
      if (key === 'lead') leadId = id
      if (key === 'target') targetId = id
    }
    // Purge leftovers from any crashed prior run FIRST, and baseline the
    // throwaway target (a crashed run could have left it senior/BCB).
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const base = await resetTarget('detective', 'LSB')
    if (base.error) throw new Error(`target baseline failed: ${base.error.message}`)

    const c = await lsb.from('cases')
      .insert({ case_number: `V137-${tag}`, title: '[rls-test] v137 reviewer visibility', bureau: 'LSB' })
      .select('id')
    if (c.error) throw new Error(`fixture case: ${c.error.message}`)
    caseId = c.data![0].id

    classifiedId = await draft('classified-pending')  // no p_classification — pin the default
    sealedId = await draft('sealed-pending', 'sealed')
    draftId = await draft('classified-draft')

    for (const id of [classifiedId, sealedId]) {
      const s = await lsb.rpc('submit_legal_request_to_cid', { p_request: id })
      if (s.error) throw new Error(`submit ${id}: ${s.error.message}`)
      if (s.data!.review_status !== 'cid_supervisor_review') {
        throw new Error(`expected cid_supervisor_review, got ${s.data!.review_status}`)
      }
    }
  })

  afterAll(async () => {
    if (!lsb) return
    // Restore the throwaway target to its durable baseline, then let the
    // cleanup RPC sweep every rls-test case + legal request (+versions/
    // actions/participants) across all fixture accounts.
    if (director && targetId) await resetTarget('detective', 'LSB')
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v137] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, director, target, judge].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── 1. the fixed gap: classified + pending ⇒ the reviewer can SEE it ── */

  it('a classified warrant at cid_supervisor_review is visible to the same-bureau supervisor (non-creator)', async () => {
    const r = await lead.from('legal_requests')
      .select('id, classification, review_status, created_by')
      .eq('id', classifiedId)
    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(1)
    // the premise of the gap: warrants default to 'classified', so the old
    // standard-only CID branch never matched
    expect(r.data![0]).toMatchObject({
      classification: 'classified', review_status: 'cid_supervisor_review',
    })
    expect(r.data![0].created_by).not.toBe(leadId)
  })

  /* ── 2. child rows ride the same predicate ── */

  it('the supervisor can read the pending request\'s legal_request_versions row', async () => {
    const v = await lead.from('legal_request_versions')
      .select('version_number, submitted_stage')
      .eq('legal_request_id', classifiedId)
    expect(v.error).toBeNull()
    expect(v.data).toHaveLength(1)
    expect(v.data![0]).toMatchObject({ version_number: 1, submitted_stage: 'cid_supervisor_review' })
  })

  /* ── 3. review authority, not mere case access ── */

  it('a non-supervisor same-bureau detective sees NOTHING; the creator keeps the creator branch', async () => {
    // target is at its baseline: detective/LSB — can_access_case passes via
    // the division clause, but the rank check in can_review_as_cid fails.
    const t = await target.from('legal_requests').select('id').eq('id', classifiedId)
    expect(t.error).toBeNull()
    expect(t.data ?? []).toHaveLength(0)
    // the creator (also a plain detective) still sees their own request
    const c = await lsb.from('legal_requests').select('id').eq('id', classifiedId)
    expect(c.error).toBeNull()
    expect(c.data).toHaveLength(1)
  })

  /* ── 4. case access, not mere rank ── */

  it('a senior rank WITHOUT case access sees NOTHING (other-bureau senior_detective)', async () => {
    // Note: bureau_lead/deputy_director/director all hold cross-bureau case
    // access via is_command, so the only "supervisor without case access" is
    // a senior_detective outside the case bureau — repurpose the throwaway
    // target for exactly that (restored in test 3's shape by afterAll).
    const up = await resetTarget('senior_detective', 'BCB')
    expect(up.error).toBeNull()
    const t = await target.from('legal_requests').select('id').eq('id', classifiedId)
    expect(t.error).toBeNull()
    expect(t.data ?? []).toHaveLength(0)
    // and the other-bureau plain detective stays out too (rank AND access fail)
    const b = await bcb.from('legal_requests').select('id').eq('id', classifiedId)
    expect(b.error).toBeNull()
    expect(b.data ?? []).toHaveLength(0)
  })

  /* ── 5. after approval the reviewer remains visible — as a participant ── */

  it('after the supervisor approves, they REMAIN visible: the RPC records a cid_supervisor participant', async () => {
    const ap = await lead.rpc('review_legal_request_as_cid', {
      p_request: classifiedId, p_decision: 'approve',
      p_signature: 'RLS Lead', p_override_reason: '[rls-test] v137 no packet needed',
    })
    expect(ap.error).toBeNull()
    // routing is environment-dependent: ada_review when LSB has a routing
    // ADA, otherwise parked at submitted_to_doj — both are past the CID gate
    expect(['submitted_to_doj', 'ada_review']).toContain(ap.data!.review_status)

    // Pinned reality: the status branch no longer applies, but the approve
    // path ran legal_add_participant(request, reviewer, 'cid_supervisor'),
    // so visibility persists via is_legal_participant.
    const still = await lead.from('legal_requests')
      .select('id, review_status, cid_reviewed_by').eq('id', classifiedId)
    expect(still.error).toBeNull()
    expect(still.data).toHaveLength(1)
    expect(still.data![0].cid_reviewed_by).toBe(leadId)
    const part = await lead.from('legal_request_participants')
      .select('user_id, participant_role')
      .eq('legal_request_id', classifiedId).eq('user_id', leadId)
    expect(part.error).toBeNull()
    expect(part.data).toHaveLength(1)
    expect(part.data![0].participant_role).toBe('cid_supervisor')
  })

  /* ── 6. sealed is included — for the pending reviewer ONLY ── */

  it('a SEALED request at cid_supervisor_review is visible to the pending reviewer, invisible to the no-access supervisor and to an unrelated judge', async () => {
    const l = await lead.from('legal_requests')
      .select('id, classification, review_status').eq('id', sealedId)
    expect(l.error).toBeNull()
    expect(l.data).toHaveLength(1)
    expect(l.data![0]).toMatchObject({
      classification: 'sealed', review_status: 'cid_supervisor_review',
    })
    // target is still senior_detective/BCB from test 4 — senior rank, no access
    const t = await target.from('legal_requests').select('id').eq('id', sealedId)
    expect(t.error).toBeNull()
    expect(t.data ?? []).toHaveLength(0)
    // an unrelated judge: not at DOJ yet, and sealed never reaches the
    // judge-routed visibility branch anyway
    const j = await judge.from('legal_requests').select('id').eq('id', sealedId)
    expect(j.error).toBeNull()
    expect(j.data ?? []).toHaveLength(0)
  })

  /* ── 7. the branch is status-scoped: drafts stay invisible ── */

  it('a classified DRAFT (not yet submitted) is invisible to the supervisor', async () => {
    const sanity = await lsb.from('legal_requests')
      .select('id, review_status').eq('id', draftId)
    expect(sanity.data).toHaveLength(1)
    expect(sanity.data![0].review_status).toBe('not_submitted')

    const l = await lead.from('legal_requests').select('id').eq('id', draftId)
    expect(l.error).toBeNull()
    expect(l.data ?? []).toHaveLength(0)
  })
})
