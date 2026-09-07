/** v1.65 — Investigative stages, evidence designation, and the
 *  referenced-material case brief (migration 20260818120000_bureau_queues_stages),
 *  LIVE project.
 *
 *  History: this suite also pinned the bureau prosecutor queues and the
 *  AG-granted `prosecutor_coverage` lane. Portal Improvements P4-01
 *  (migration 20261025120000_legal_reroute) retired the prosecutor stage — a Bureau Lead
 *  approve now lands in `submitted_to_judge` (tests/rls/v186a.test.ts) and
 *  the judicial walkthrough lives in tests/rls/v163.test.ts. The coverage
 *  and bureau-queue tests are gone; `justice_set_coverage` /
 *  `justice_end_coverage` remain server-side (AG/Owner-only, unused) and
 *  keep ONLY their refusal assertion here.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  CID build fixtures only: lsb, bcb, lead, director, owner.
 *
 *  ── What it proves ─────────────────────────────────────────────────────────
 *   1. justice_set_coverage / justice_end_coverage refuse everyone below the
 *      Attorney General / Owner (the retained refusal wall).
 *   2. justice_appoint is 4-arg and judge/AG-only: a prosecutor appointment
 *      answers the retired-role message, a judge appointment with p_bureau is
 *      refused, and the is_test fixture wall still refuses fully-valid
 *      arguments (v164's safety property).
 *   3. submit_legal_request_to_cid carries p_material_change (3-arg): calling
 *      the new signature on an unknown id answers "request not found" — the
 *      signature resolves, nothing else happens.
 *   4. cases.investigative_stage is RPC-only (direct UPDATE hits the
 *      case_set_stage trigger), a reason is mandatory, a non-lead detective is
 *      refused, cross-bureau probes get no oracle, and the lead/supervisor
 *      path works exactly once per stage ("already at that stage").
 *   5. media_designate_evidence: an on-case non-uploader detective is refused
 *      ("only the uploader or a supervisor"); the uploader designates, a
 *      supervisor clears — and uploaded_by never changes (identity untouched).
 *   6. legal_request_case_brief answers inaccessible/unknown ids with an
 *      explicit {error} payload for every role — never a throw, never a leak.
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  Cases carry the [rls-test]/run-tag marker and are swept by rls_test_cleanup
 *  (pre-run + afterAll). media.case_id is ON DELETE SET NULL, so the two
 *  media rows are lead-deleted explicitly before the sweep (the v158
 *  pattern). No prosecutor_coverage row is ever created here. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
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
if (!enabled) console.warn('[rls:v165] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.65 — stages, evidence designation, case brief (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C, owner: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''            // MCB case created by the lsb detective (no lead set)
  let mediaByLeadId = ''     // uploaded by the bureau_lead — the non-uploader probe
  let mediaByLsbId = ''      // uploaded by the lsb detective — designate/clear cycle

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk(); owner = mk()
    // Sequential with backoff — parallel password grants trip the per-IP auth
    // rate limit and fail with an empty error.
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director!, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner!, 'owner'],
    ]
    for (const [client, email, pw, key] of logins) {
      ids[key] = await signInWithRetry(client, email, pw)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c = await lsb.from('cases').insert({
      case_number: `V165-${tag}`, title: `[rls-test] v165 stages/evidence case ${tag}`, bureau: 'major_crimes',
    }).select('id')
    if (c.error) throw new Error(`case insert: ${c.error.message}`)
    caseId = c.data![0].id as string

    const m1 = await lead.from('media').insert({
      title: `[rls-test] v165 lead upload ${tag}`, type: 'image', case_id: caseId,
    }).select('id')
    if (m1.error) throw new Error(`media insert (lead): ${m1.error.message}`)
    mediaByLeadId = m1.data![0].id as string
    const m2 = await lsb.from('media').insert({
      title: `[rls-test] v165 detective upload ${tag}`, type: 'image', case_id: caseId,
    }).select('id')
    if (m2.error) throw new Error(`media insert (lsb): ${m2.error.message}`)
    mediaByLsbId = m2.data![0].id as string
  })

  afterAll(async () => {
    if (!lsb) return
    // media.case_id is ON DELETE SET NULL — delete the created rows explicitly
    // so nothing orphans into the vault (v158 pattern), then sweep the rest.
    for (const id of [mediaByLeadId, mediaByLsbId]) {
      if (id) { try { await lead.from('media').delete().eq('id', id) } catch { /* best effort */ } }
    }
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v165] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, director, owner].map((c) => c.auth.signOut()))
  })

  /* ============ 1. coverage management is AG/Owner-only (refusal only) ============ */

  it('justice_set_coverage and justice_end_coverage refuse everyone below the Attorney General / Owner', async () => {
    for (const [actor, name] of [[lsb, 'detective'], [lead, 'bureau_lead'], [director, 'director']] as const) {
      const grant = await actor.rpc('justice_set_coverage', {
        p_user: randomUUID(), p_bureau: 'major_crimes', p_reason: '[rls-test] v165 refusal probe',
      })
      expect(grant.error, `${name} grant`).not.toBeNull()
      expect(grant.error!.message).toMatch(/only the Attorney General or Owner/i)
      const end = await actor.rpc('justice_end_coverage', { p_coverage: randomUUID() })
      expect(end.error, `${name} end`).not.toBeNull()
      expect(end.error!.message).toMatch(/only the Attorney General or Owner/i)
    }
  })

  /* ============ 2. justice_appoint is judge/AG-only (P4-01) ============ */

  it('a prosecutor appointment is refused as retired, a judge refuses a bureau, and the is_test wall still holds', async () => {
    // The retired-role wall answers before any authority check — even a
    // detective's probe proves the P4-01 signature is live.
    for (const actor of [lsb, director]) {
      const retired = await actor.rpc('justice_appoint', {
        p_user: randomUUID(), p_role: 'prosecutor', p_reason: '[rls-test] v165 signature probe',
      })
      expect(retired.error).not.toBeNull()
      expect(retired.error!.message).toMatch(/retired|not eligible|Attorney General|Owner/i)
    }
    const asOwner = await owner.rpc('justice_appoint', {
      p_user: ids.bcb, p_role: 'prosecutor', p_reason: '[rls-test] v165 retired-role probe',
    })
    expect(asOwner.error).not.toBeNull()
    expect(asOwner.error!.message).toMatch(/prosecutor role is retired/i)
    const judgeWithBureau = await owner.rpc('justice_appoint', {
      p_user: ids.bcb, p_role: 'judge', p_reason: '[rls-test] v165 signature probe', p_bureau: 'major_crimes',
    })
    expect(judgeWithBureau.error).not.toBeNull()
    expect(judgeWithBureau.error!.message).toMatch(/bureau/i)
    // Fully valid arguments still cannot touch a fixture account (v164 wall).
    const fixtureTarget = await owner.rpc('justice_appoint', {
      p_user: ids.bcb, p_role: 'judge', p_reason: '[rls-test] v165 eligibility probe',
    })
    expect(fixtureTarget.error).not.toBeNull()
    expect(fixtureTarget.error!.message).toMatch(/not eligible for a DOJ appointment/i)
    expect((await owner.from('justice_memberships').select('user_id').eq('user_id', ids.bcb)).data ?? []).toHaveLength(0)
  })

  /* ============ 3. submit_legal_request_to_cid carries p_material_change ============ */

  it('the 3-arg submit signature resolves: p_material_change on an unknown id answers "request not found"', async () => {
    const res = await lsb.rpc('submit_legal_request_to_cid', {
      p_request: randomUUID(), p_change_summary: '[rls-test] v165 signature probe', p_material_change: true,
    })
    expect(res.error).not.toBeNull()
    // PGRST202 here would mean the 3-arg overload does not exist.
    expect(res.error!.message).toMatch(/request not found/i)
  })

  /* ============ 4. investigative stage: RPC-only, reasoned, role-gated ============ */

  it('cases.investigative_stage cannot be written directly — the trigger names the RPC', async () => {
    const direct = await lsb.from('cases').update({ investigative_stage: 'active_investigation' }).eq('id', caseId).select('id')
    expect(direct.error).not.toBeNull()
    expect(direct.error!.message).toMatch(/case_set_stage/i)
    const still = await lsb.from('cases').select('investigative_stage').eq('id', caseId).single()
    expect(still.data).toMatchObject({ investigative_stage: 'intake' })
  })

  it('case_set_stage: invalid stage and blank reason are refused before anything else', async () => {
    const badStage = await lsb.rpc('case_set_stage', { p_case: caseId, p_stage: 'vibing', p_reason: '[rls-test] v165' })
    expect(badStage.error).not.toBeNull()
    expect(badStage.error!.message).toMatch(/invalid investigative stage/i)
    const noReason = await lsb.rpc('case_set_stage', { p_case: caseId, p_stage: 'active_investigation', p_reason: '   ' })
    expect(noReason.error).not.toBeNull()
    expect(noReason.error!.message).toMatch(/a reason is required/i)
  })

  it('a non-lead detective is refused; a cross-bureau probe gets no oracle; a supervisor moves the stage exactly once', async () => {
    // lsb created the case but is NOT its lead detective and holds no
    // supervisor rank — the stage is not theirs to move.
    const det = await lsb.rpc('case_set_stage', {
      p_case: caseId, p_stage: 'active_investigation', p_reason: '[rls-test] v165 non-lead probe',
    })
    expect(det.error).not.toBeNull()
    expect(det.error!.message).toMatch(/only the case lead or a supervisor/i)

    // a SCB detective cannot even learn the case exists
    const foreign = await bcb.rpc('case_set_stage', {
      p_case: caseId, p_stage: 'active_investigation', p_reason: '[rls-test] v165 cross-bureau probe',
    })
    expect(foreign.error).not.toBeNull()
    expect(foreign.error!.message).toMatch(/case not found or not accessible/i)

    // the Bureau Lead moves it, with the reason mandatory and audited
    const ok = await lead.rpc('case_set_stage', {
      p_case: caseId, p_stage: 'active_investigation', p_reason: '[rls-test] v165 canvass complete',
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ id: caseId, investigative_stage: 'active_investigation' })

    // no-op transitions are refused — every stage change is a real event
    const again = await lead.rpc('case_set_stage', {
      p_case: caseId, p_stage: 'active_investigation', p_reason: '[rls-test] v165 duplicate',
    })
    expect(again.error).not.toBeNull()
    expect(again.error!.message).toMatch(/already at that stage/i)
  })

  /* ============ 5. evidence designation (uploader/identity untouched) ============ */

  it('an on-case non-uploader detective cannot designate; cross-bureau gets no oracle', async () => {
    // lsb can access the case but did not upload the lead's row and holds no
    // supervisor rank.
    const deny = await lsb.rpc('media_designate_evidence', { p_media: mediaByLeadId, p_ref: '[rls-test] EV-165-X' })
    expect(deny.error).not.toBeNull()
    expect(deny.error!.message).toMatch(/only the uploader or a supervisor/i)

    const foreign = await bcb.rpc('media_designate_evidence', { p_media: mediaByLeadId })
    expect(foreign.error).not.toBeNull()
    expect(foreign.error!.message).toMatch(/media not found or not accessible/i)
  })

  it('the uploader designates (custom + default ref), a supervisor clears — uploaded_by never changes', async () => {
    const set = await lsb.rpc('media_designate_evidence', { p_media: mediaByLsbId, p_ref: `EV-165-${tag}` })
    expect(set.error).toBeNull()
    expect(set.data).toMatchObject({
      id: mediaByLsbId, evidence_ref: `EV-165-${tag}`,
      evidence_designated_by: ids.lsb, uploaded_by: ids.lsb,
    })
    expect((set.data as { evidence_designated_at?: string }).evidence_designated_at).toBeTruthy()

    // a supervisor clears the designation — the designation fields empty,
    // the upload identity stays exactly as it was
    const clear = await lead.rpc('media_designate_evidence', { p_media: mediaByLsbId, p_clear: true })
    expect(clear.error).toBeNull()
    expect(clear.data).toMatchObject({
      id: mediaByLsbId, evidence_ref: null,
      evidence_designated_by: null, evidence_designated_at: null,
      uploaded_by: ids.lsb,
    })

    // designating without a ref mints the EV-prefixed default
    const dflt = await lsb.rpc('media_designate_evidence', { p_media: mediaByLsbId })
    expect(dflt.error).toBeNull()
    expect((dflt.data as { evidence_ref: string }).evidence_ref).toMatch(/^EV-/)
    expect((dflt.data as { uploaded_by: string }).uploaded_by).toBe(ids.lsb)
  })

  /* ============ 6. case brief: error payload, never a leak ============ */

  it('legal_request_case_brief answers unknown/inaccessible ids with an explicit {error} payload for every role', async () => {
    for (const actor of [lsb, bcb, lead, owner]) {
      const res = await actor.rpc('legal_request_case_brief', { p_request: randomUUID() })
      expect(res.error).toBeNull()
      expect((res.data as Record<string, unknown>).error).toBe('request not found or not accessible')
    }
  })
})
