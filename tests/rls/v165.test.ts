/** v1.65 — Bureau prosecutor queues, investigative stages, evidence
 *  designation, and the referenced-material case brief
 *  (migration 20260818120000_bureau_queues_stages), LIVE project.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  Core assertions run with the CID build fixtures: lsb, bcb, lead, director,
 *  owner. The bureau-queue lane additionally needs the v163 DOJ fixtures —
 *  UPDATED for bureau queues (see the v163 header, which is the canonical
 *  provisioning contract):
 *
 *    RLS_TEST_PASSWORD_PROSECUTOR   rls-test-prosecutor@cidportal.test
 *                                   justice_memberships.prosecutor_bureau='LSB'
 *    RLS_TEST_PASSWORD_PROSECUTOR2  rls-test-prosecutor2@cidportal.test
 *                                   justice_memberships.prosecutor_bureau='BCB'
 *    RLS_TEST_PASSWORD_AG           rls-test-ag@cidportal.test (attorney_general)
 *
 *  DOJ-dependent tests it.skipIf cleanly while those passwords are unset (the
 *  v163/v164 pattern) and run unmodified the day they exist.
 *
 *  ── What it proves ─────────────────────────────────────────────────────────
 *   1. prosecutor_coverage is RPC-only for clients (INSERT/UPDATE revoked) and
 *      SELECT is scoped per policy (a plain member reads only their own rows).
 *   2. justice_set_coverage / justice_end_coverage refuse everyone below the
 *      Attorney General / Owner, and (with the AG fixture) the argument walls
 *      hold: blank reason, past expiry, non-prosecutor grantee — none of which
 *      ever writes a row.
 *   3. Bureau eligibility on claiming: a request approved into the BCB queue
 *      is invisible to the LSB-home prosecutor and their claim is refused
 *      "outside your bureau"; the BCB-home prosecutor sees it and claims it.
 *   4. justice_appoint is now 4-arg: a prosecutor appointment without p_bureau
 *      fails "home bureau", a non-prosecutor appointment with p_bureau fails
 *      "only prosecutors carry a home bureau", and the is_test fixture wall
 *      still refuses fully-valid arguments (v164's safety property).
 *   5. submit_legal_request_to_cid carries p_material_change (3-arg): calling
 *      the new signature on an unknown id answers "request not found" — the
 *      signature resolves, nothing else happens.
 *   6. cases.investigative_stage is RPC-only (direct UPDATE hits the
 *      case_set_stage trigger), a reason is mandatory, a non-lead detective is
 *      refused, cross-bureau probes get no oracle, and the lead/supervisor
 *      path works exactly once per stage ("already at that stage").
 *   7. media_designate_evidence: an on-case non-uploader detective is refused
 *      ("only the uploader or a supervisor"); the uploader designates, a
 *      supervisor clears — and uploaded_by never changes (identity untouched).
 *   8. legal_request_case_brief answers inaccessible/unknown ids with an
 *      explicit {error} payload for every role — never a throw, never a leak.
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  Cases/requests carry the [rls-test]/run-tag marker and are swept by
 *  rls_test_cleanup (pre-run + afterAll). media.case_id is ON DELETE SET NULL,
 *  so the two media rows are lead-deleted explicitly before the sweep (the
 *  v158 pattern). The coverage tests only exercise REFUSALS — no
 *  prosecutor_coverage row is ever created here (clients hold no DELETE grant
 *  on the new table, so a created row could not be removed). */

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
  prosecutor: process.env.RLS_TEST_PASSWORD_PROSECUTOR,
  prosecutor2: process.env.RLS_TEST_PASSWORD_PROSECUTOR2,
  ag: process.env.RLS_TEST_PASSWORD_AG,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director && PW.owner)
if (!enabled) console.warn('[rls:v165] fixture passwords not set — suite skipped')
// Bureau-queue lane needs the DOJ fixtures (v163 provisioning contract).
const doj = enabled && !!(PW.prosecutor && PW.prosecutor2 && PW.ag)
if (enabled && !doj) console.warn('[rls:v165] DOJ fixture passwords not set (PROSECUTOR/PROSECUTOR2/AG) — bureau-queue tests skipped until the DOJ fixtures are provisioned')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.65 — bureau queues, stages, evidence designation (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C, owner: C
  let p1: C | null = null, p2: C | null = null, ag: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''            // LSB case created by the lsb detective (no lead set)
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
    if (doj) {
      p1 = mk(); p2 = mk(); ag = mk()
      logins.push(
        [p1, 'rls-test-prosecutor@cidportal.test', PW.prosecutor!, 'prosecutor'],
        [p2, 'rls-test-prosecutor2@cidportal.test', PW.prosecutor2!, 'prosecutor2'],
        [ag, 'rls-test-ag@cidportal.test', PW.ag!, 'ag'],
      )
    }
    for (const [client, email, pw, key] of logins) {
      ids[key] = await signInWithRetry(client, email, pw)
    }
    if (doj) {
      // The bureau-queue lane's meaning depends on the HOME bureaus — verify
      // the updated v163 provisioning contract live before asserting anything.
      for (const [client, key, bureau] of [
        [p1!, 'prosecutor', 'LSB'], [p2!, 'prosecutor2', 'BCB'],
      ] as const) {
        const m = await client.from('justice_memberships')
          .select('justice_role,active,prosecutor_bureau').eq('user_id', ids[key])
        if (m.error) throw new Error(`v165 provisioning check (${key}): ${m.error.message}`)
        const row = (m.data ?? [])[0]
        if (!row || !row.active || row.justice_role !== 'prosecutor' || row.prosecutor_bureau !== bureau) {
          throw new Error(`v165 provisioning drift: rls-test-${key} must be an ACTIVE prosecutor `
            + `with prosecutor_bureau='${bureau}' — got ${JSON.stringify(row ?? null)}. `
            + 'See the fixture contract at the top of tests/rls/v163.test.ts.')
        }
      }
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c = await lsb.from('cases').insert({
      case_number: `V165-${tag}`, title: `[rls-test] v165 stages/evidence case ${tag}`, bureau: 'LSB',
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
    await Promise.all(
      [lsb, bcb, lead, director, owner, p1, p2, ag]
        .filter((c): c is C => !!c).map((c) => c.auth.signOut()),
    )
  })

  /* ============ 1. prosecutor_coverage: writes revoked, reads scoped ============ */

  it('no client role can INSERT/UPDATE prosecutor_coverage directly; a plain member reads only their own rows', async () => {
    for (const actor of [lsb, lead, owner]) {
      const ins = await actor.from('prosecutor_coverage').insert({
        prosecutor_id: ids.lsb, bureau: 'LSB',
        reason: '[rls-test] v165 direct write probe', authorized_by: ids.owner,
      }).select('id')
      expect(ins.error).not.toBeNull()
      const upd = await actor.from('prosecutor_coverage')
        .update({ ended_at: new Date().toISOString() }).eq('prosecutor_id', ids.lsb).select('id')
      expect(upd.error).not.toBeNull()
    }
    // SELECT is policy-scoped, never an error: a plain detective sees only
    // rows where they are the prosecutor — none can exist for a CID fixture.
    const own = await lsb.from('prosecutor_coverage').select('id').eq('prosecutor_id', ids.lsb)
    expect(own.error).toBeNull()
    expect(own.data ?? []).toHaveLength(0)
  })

  /* ============ 2. coverage management is AG/Owner-only ============ */

  it('justice_set_coverage and justice_end_coverage refuse everyone below the Attorney General / Owner', async () => {
    for (const [actor, name] of [[lsb, 'detective'], [lead, 'bureau_lead'], [director, 'director']] as const) {
      const grant = await actor.rpc('justice_set_coverage', {
        p_user: randomUUID(), p_bureau: 'LSB', p_reason: '[rls-test] v165 refusal probe',
      })
      expect(grant.error, `${name} grant`).not.toBeNull()
      expect(grant.error!.message).toMatch(/only the Attorney General or Owner/i)
      const end = await actor.rpc('justice_end_coverage', { p_coverage: randomUUID() })
      expect(end.error, `${name} end`).not.toBeNull()
      expect(end.error!.message).toMatch(/only the Attorney General or Owner/i)
    }
  })

  it.skipIf(!doj)('AG argument walls: blank reason, past expiry, non-prosecutor grantee, unknown coverage — no row is ever written', async () => {
    const blank = await ag!.rpc('justice_set_coverage', {
      p_user: ids.prosecutor, p_bureau: 'BCB', p_reason: '   ',
    })
    expect(blank.error).not.toBeNull()
    expect(blank.error!.message).toMatch(/a reason is required/i)

    const past = await ag!.rpc('justice_set_coverage', {
      p_user: ids.prosecutor, p_bureau: 'BCB', p_reason: '[rls-test] v165 expiry probe',
      p_expires_at: new Date(Date.now() - 60_000).toISOString(),
    })
    expect(past.error).not.toBeNull()
    expect(past.error!.message).toMatch(/expiry must be in the future/i)

    // coverage is a prosecutor concept — a CID detective can never receive it
    const notPros = await ag!.rpc('justice_set_coverage', {
      p_user: ids.lsb, p_bureau: 'BCB', p_reason: '[rls-test] v165 grantee probe',
    })
    expect(notPros.error).not.toBeNull()
    expect(notPros.error!.message).toMatch(/active Prosecutor/i)

    const ghost = await ag!.rpc('justice_end_coverage', { p_coverage: randomUUID() })
    expect(ghost.error).not.toBeNull()
    expect(ghost.error!.message).toMatch(/coverage not found/i)

    // none of the refusals left a row behind (AG SELECT sees every row)
    const rows = await ag!.from('prosecutor_coverage').select('id,reason').ilike('reason', '%[rls-test] v165%')
    expect(rows.error).toBeNull()
    expect(rows.data ?? []).toHaveLength(0)
  })

  /* ============ 3. bureau eligibility on the queue ============ */

  it.skipIf(!doj)('a BCB-queued request is invisible and unclaimable outside the home bureau; the home-bureau prosecutor claims it', async () => {
    // The BCB detective drafts on their own case; the Director (cross-bureau
    // fallback authority) approves it into the BCB prosecutor queue.
    const c = await bcb.from('cases').insert({
      case_number: `V165B-${tag}`, title: `[rls-test] v165 BCB queue case ${tag}`, bureau: 'BCB',
    }).select('id')
    expect(c.error).toBeNull()
    const r = await bcb.rpc('create_legal_request', {
      p_case: c.data![0].id, p_request_type: 'subpoena', p_subtype: 'document_production',
      p_title: `[rls-test] V165 BCB Subpoena ${tag}`, p_recipient_type: 'entity', p_recipient_name: 'Fleeca Bank',
      p_narrative: 'Records needed for the v165 bureau-queue wall test.',
      p_form: { items_requested: 'Statements', date_range: '2026-01→2026-06' },
    })
    expect(r.error).toBeNull()
    const reqId = r.data!.id as string
    const ex = await bcb.rpc('add_legal_exhibit', { p_request: reqId, p_type: 'external_link', p_meta: { url: `https://evidence.example/v165/${tag}` } })
    expect(ex.error).toBeNull()
    const sub = await bcb.rpc('submit_legal_request_to_cid', { p_request: reqId })
    expect(sub.error).toBeNull()
    const ap = await director.rpc('review_legal_request_as_cid', { p_request: reqId, p_decision: 'approve', p_signature: 'RLS Director' })
    expect(ap.error).toBeNull()
    expect(ap.data).toMatchObject({ review_status: 'prosecutor_queue', responsible_bureau: 'BCB' })

    // The LSB-home prosecutor's lane view no longer includes the BCB queue…
    const hidden = await p1!.from('legal_requests').select('id').eq('id', reqId)
    expect(hidden.error).toBeNull()
    expect(hidden.data ?? []).toHaveLength(0)
    // …and a blind claim by id is refused at the bureau wall.
    const deny = await p1!.rpc('legal_claim_prosecutor', { p_request: reqId })
    expect(deny.error).not.toBeNull()
    expect(deny.error!.message).toMatch(/outside your bureau/i)

    // The BCB-home prosecutor sees the queue and the claim succeeds.
    const seen = await p2!.from('legal_requests').select('id').eq('id', reqId)
    expect(seen.error).toBeNull()
    expect(seen.data).toHaveLength(1)
    const claim = await p2!.rpc('legal_claim_prosecutor', { p_request: reqId })
    expect(claim.error).toBeNull()
    expect(claim.data).toMatchObject({ review_status: 'prosecutor_review', assigned_prosecutor_id: ids.prosecutor2 })
  })

  /* ============ 4. justice_appoint is 4-arg (home bureau) ============ */

  it('a prosecutor appointment demands a home bureau, non-prosecutors refuse one, and the is_test wall still holds', async () => {
    // The bureau argument wall answers before any authority check — even a
    // detective's probe proves the 4-arg signature is live.
    for (const actor of [lsb, director]) {
      const noBureau = await actor.rpc('justice_appoint', {
        p_user: randomUUID(), p_role: 'prosecutor', p_reason: '[rls-test] v165 signature probe',
      })
      expect(noBureau.error).not.toBeNull()
      expect(noBureau.error!.message).toMatch(/home bureau/i)
    }
    const judgeWithBureau = await director.rpc('justice_appoint', {
      p_user: randomUUID(), p_role: 'judge', p_reason: '[rls-test] v165 signature probe', p_bureau: 'LSB',
    })
    expect(judgeWithBureau.error).not.toBeNull()
    expect(judgeWithBureau.error!.message).toMatch(/only prosecutors carry a home bureau/i)
    // Fully valid arguments still cannot touch a fixture account (v164 wall).
    const fixtureTarget = await director.rpc('justice_appoint', {
      p_user: ids.bcb, p_role: 'prosecutor', p_reason: '[rls-test] v165 eligibility probe', p_bureau: 'BCB',
    })
    expect(fixtureTarget.error).not.toBeNull()
    expect(fixtureTarget.error!.message).toMatch(/not eligible for a DOJ appointment/i)
  })

  /* ============ 5. submit_legal_request_to_cid carries p_material_change ============ */

  it('the 3-arg submit signature resolves: p_material_change on an unknown id answers "request not found"', async () => {
    const res = await lsb.rpc('submit_legal_request_to_cid', {
      p_request: randomUUID(), p_change_summary: '[rls-test] v165 signature probe', p_material_change: true,
    })
    expect(res.error).not.toBeNull()
    // PGRST202 here would mean the 3-arg overload does not exist.
    expect(res.error!.message).toMatch(/request not found/i)
  })

  /* ============ 6. investigative stage: RPC-only, reasoned, role-gated ============ */

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

    // a BCB detective cannot even learn the case exists
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

  /* ============ 7. evidence designation (uploader/identity untouched) ============ */

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

  /* ============ 8. case brief: error payload, never a leak ============ */

  it('legal_request_case_brief answers unknown/inaccessible ids with an explicit {error} payload for every role', async () => {
    for (const actor of [lsb, bcb, lead, owner]) {
      const res = await actor.rpc('legal_request_case_brief', { p_request: randomUUID() })
      expect(res.error).toBeNull()
      expect((res.data as Record<string, unknown>).error).toBe('request not found or not accessible')
    }
  })
})
