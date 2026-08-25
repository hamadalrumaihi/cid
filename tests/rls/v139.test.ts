/** v1.39 — Surveillance & Intelligence domain: authorization pipeline,
 *  observation walls, and the dormant bridge
 *  (migration 20260812120000_surveillance_domain.sql).
 *
 *  The walls under test: surveillance_targets is RPC-only (no client write
 *  policies) and reads follow private.can_access_case; observations are
 *  ordinary casework but the non-definer guard trigger stamps browser writes
 *  (never automated provenance, never pre-verified); restricted observations
 *  add a stricter wall on top of case access; the inbound bridge is
 *  service_role-only by construction.
 *
 *  Pins:
 *   - surveillance_request_create(p_submit) → pending_approval; a DIRECT
 *     insert into surveillance_targets is rejected (no insert policy);
 *   - SELF-APPROVAL: the requester (even a bureau_lead with authority) cannot
 *     surveillance_decide their own request;
 *   - a plain detective cannot decide at all (Bureau Lead+ authority);
 *   - director authorizes with an expiry → authorized; the target history is
 *     visible to case members; the requester activates → active;
 *   - the other-bureau detective (bcb) sees NO targets/observations for the
 *     MCB case (case wall);
 *   - OBSERVATION GUARD: a direct insert claiming source_type 'alpr' +
 *     verification_status 'verified' is stamped detective_manual/unverified;
 *   - RESTRICTED WALL: a restricted observation is invisible to a same-bureau
 *     case-access member who is neither creator/reviewer/command; command
 *     (director) reads it;
 *   - observation_review: a case-access member verifies → verified + a
 *     surveillance_review_history row; observation_promote is rejected while
 *     unverified (/VERIFIED/) and stamps promoted_at after verification;
 *   - bridge_ingest_event and mdt_bridge_ack are service_role-only
 *     (authenticated call → permission denied);
 *   - surveillance_alert_rules: readable by active members; a detective
 *     update is policy-filtered (0 rows);
 *   - ALERTS + DECONFLICTION smoke: ≥3 same-person observations raise a
 *     repeated_person alert; after entity links + verification on two cases,
 *     surveillance_deconflict returns the cross-case row for the case member
 *     and ZERO rows for the no-access viewer (gated on can_access_case).
 *
 *  Fixtures (tests/rls/README.md): lsb (MCB detective, case creator), bcb
 *  (SCB detective — the other-bureau viewer), lead (MCB bureau_lead — the
 *  self-approval pin), director (major_crimes director — command authorizer), target
 *  (throwaway, reset to detective/MCB — the same-bureau case-access member).
 *  rls_test_cleanup() runs at start AND teardown; the 20260812120000 re-emit
 *  sweeps surveillance rows + rls-test% bridge events (cases cascade
 *  their surveillance children). The fixture person is deleted best-effort by
 *  the director (persons are not swept). Requires migration 20260812120000. */

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
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director && PW.target)
if (!enabled) console.warn('[rls:v139] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.39 — surveillance & intelligence domain (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C, target: C
  let targetId = ''
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''         // MCB case (creator: lsb) — the surveillance case
  let caseBId = ''        // second MCB case (creator: lsb) — deconfliction sibling
  let personId = ''       // shared subject for the pattern/deconfliction pins
  let leadReqId = ''      // lead's request — the self-approval + lifecycle pin
  let obsId = ''          // manual observation (guard + review/promote pins)
  let restrictedObsId = ''// restricted observation — the stricter wall pin

  const resetTarget = (role: string, division: string) =>
    director.rpc('rls_test_reset_member', {
      p_target: targetId, p_role: role, p_division: division, p_active: true,
    })

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk(); target = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [target, 'rls-test-target@cidportal.test', PW.target, 'target'],
    ] as const) {
      const id = await signInWithRetry(client, email, pw!)
      if (key === 'target') targetId = id
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const base = await resetTarget('detective', 'major_crimes')
    if (base.error) throw new Error(`target baseline failed: ${base.error.message}`)

    // Fixture cases: both MCB, creator lsb. bcb has no path to either.
    const a = await lsb.from('cases')
      .insert({ case_number: `V139A-${tag}`, title: '[rls-test] v139 surveillance case', bureau: 'major_crimes' })
      .select('id')
    if (a.error) throw new Error(`case A: ${a.error.message}`)
    caseId = a.data![0].id
    const b = await lsb.from('cases')
      .insert({ case_number: `V139B-${tag}`, title: '[rls-test] v139 deconfliction sibling', bureau: 'major_crimes' })
      .select('id')
    if (b.error) throw new Error(`case B: ${b.error.message}`)
    caseBId = b.data![0].id

    // Shared registry subject for the repeated-person / deconfliction pins.
    const p = await lsb.from('persons')
      .insert({ name: `[rls-test] v139 subject ${tag}` }).select('id')
    if (p.error) throw new Error(`person: ${p.error.message}`)
    personId = p.data![0].id
  })

  afterAll(async () => {
    if (!lsb) return
    if (director && targetId) await resetTarget('detective', 'major_crimes')
    // Persons are not swept by rls_test_cleanup — command delete, best effort
    // (observations reference person_id with ON DELETE SET NULL).
    if (director && personId) {
      try { await director.from('persons').delete().eq('id', personId) } catch { /* best effort */ }
    }
    // Cleanup sweeps rls-test cases (surveillance children cascade), plus
    // tips by creator and rls-test% bridge events (20260812120000 re-emit).
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v139] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, director, target].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── 1. request pipeline is RPC-only ───────────────────────────────────── */

  it('surveillance_request_create(p_submit) → pending_approval; direct target inserts are rejected', async () => {
    const r = await lsb.rpc('surveillance_request_create', {
      p_case: caseId, p_target_type: 'person', p_ref: personId,
      p_label: `[rls-test] v139 lsb target ${tag}`,
      p_reason: 'RLS pin: pipeline entry', p_submit: true,
    })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ status: 'pending_approval', case_id: caseId })

    // No INSERT policy on surveillance_targets — the browser can never mint one.
    const direct = await lsb.from('surveillance_targets')
      .insert({ case_id: caseId, target_type: 'person', label: `[rls-test] v139 direct ${tag}`, reason: 'should fail' })
      .select('id')
    expect(direct.error).not.toBeNull()
  })

  /* ── 2–4. decision authority + self-approval prohibition ───────────────── */

  it('self-approval: a bureau_lead cannot authorize their OWN request', async () => {
    const mk2 = await lead.rpc('surveillance_request_create', {
      p_case: caseId, p_target_type: 'vehicle',
      p_label: `[rls-test] v139 lead target ${tag}`,
      p_reason: 'RLS pin: self-approval prohibition', p_submit: true,
    })
    expect(mk2.error, mk2.error?.message).toBeNull()
    expect(mk2.data.status).toBe('pending_approval')
    leadReqId = mk2.data.id as string

    const self = await lead.rpc('surveillance_decide', {
      p_target: leadReqId, p_decision: 'authorize',
    })
    expect(self.error).not.toBeNull()
    expect(self.error!.message).toMatch(/own surveillance request/)
  })

  it('a plain detective cannot decide a request (Bureau Lead+ authority)', async () => {
    const r = await lsb.rpc('surveillance_decide', {
      p_target: leadReqId, p_decision: 'authorize',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/Bureau Lead/i)
  })

  it('director authorizes with an expiry; history is case-visible; requester activates', async () => {
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString()
    const ok = await director.rpc('surveillance_decide', {
      p_target: leadReqId, p_decision: 'authorize', p_expires_at: expires,
    })
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data.status).toBe('authorized')
    expect(ok.data.approved_by).not.toBeNull()
    expect(ok.data.expires_at).not.toBeNull()

    // Every decision is historized and readable by case members (lsb).
    const hist = await lsb.from('surveillance_target_history')
      .select('action, to_status').eq('target_id', leadReqId)
    expect(hist.error).toBeNull()
    expect((hist.data ?? []).length).toBeGreaterThanOrEqual(2)
    expect((hist.data ?? []).some((h: { to_status: string }) => h.to_status === 'authorized')).toBe(true)

    const act = await lead.rpc('surveillance_transition', {
      p_target: leadReqId, p_action: 'activate',
    })
    expect(act.error, act.error?.message).toBeNull()
    expect(act.data.status).toBe('active')
  })

  /* ── 5. the case wall ──────────────────────────────────────────────────── */

  it('the other-bureau detective sees NO surveillance rows for the MCB case', async () => {
    const t = await bcb.from('surveillance_targets').select('id').eq('case_id', caseId)
    expect(t.error).toBeNull()
    expect(t.data ?? []).toHaveLength(0)
    const o = await bcb.from('surveillance_observations').select('id').eq('case_id', caseId)
    expect(o.error).toBeNull()
    expect(o.data ?? []).toHaveLength(0)
  })

  /* ── 6–7. observation guard + restricted wall ──────────────────────────── */

  it('the guard stamps direct observation inserts: no automated provenance, never pre-verified', async () => {
    const r = await lsb.from('surveillance_observations')
      .insert({
        case_id: caseId, target_id: leadReqId, observed_at: new Date().toISOString(),
        source_type: 'alpr', verification_status: 'verified',
        activity: `[rls-test] v139 manual sighting ${tag}`,
      })
      .select('id, source_type, verification_status, created_by')
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data![0]).toMatchObject({
      source_type: 'detective_manual', verification_status: 'unverified',
    })
    obsId = r.data![0].id
  })

  it('restricted observations are hidden from plain case-access members but visible to command', async () => {
    const ins = await lsb.from('surveillance_observations')
      .insert({
        case_id: caseId, observed_at: new Date().toISOString(), restricted: true,
        activity: `[rls-test] v139 restricted sighting ${tag}`,
      })
      .select('id, restricted')
    expect(ins.error, ins.error?.message).toBeNull()
    expect(ins.data![0].restricted).toBe(true)
    restrictedObsId = ins.data![0].id

    // target is an MCB detective with case access — but neither creator,
    // reviewer, command, nor owner: the restricted clause filters the row.
    const hidden = await target.from('surveillance_observations').select('id').eq('id', restrictedObsId)
    expect(hidden.error).toBeNull()
    expect(hidden.data ?? []).toHaveLength(0)

    const seen = await director.from('surveillance_observations').select('id').eq('id', restrictedObsId)
    expect(seen.error).toBeNull()
    expect(seen.data).toHaveLength(1)
  })

  /* ── 8. review + promotion ─────────────────────────────────────────────── */

  it('promotion requires VERIFIED; a case member verifies (historized) and then promotion sticks', async () => {
    // Unverified intelligence can never enter the case record.
    const early = await lsb.rpc('observation_promote', { p_observation: obsId })
    expect(early.error).not.toBeNull()
    expect(early.error!.message).toMatch(/VERIFIED/i)

    // target (case-access member) performs the verification.
    const ver = await target.rpc('observation_review', {
      p_observation: obsId, p_decision: 'verify',
    })
    expect(ver.error, ver.error?.message).toBeNull()
    expect(ver.data.verification_status).toBe('verified')
    expect(ver.data.reviewed_by).toBe(targetId)

    const hist = await lsb.from('surveillance_review_history')
      .select('action, to_status').eq('observation_id', obsId)
    expect(hist.error).toBeNull()
    expect((hist.data ?? []).some((h: { action: string }) => h.action === 'verify')).toBe(true)

    const prom = await lsb.rpc('observation_promote', { p_observation: obsId })
    expect(prom.error, prom.error?.message).toBeNull()
    expect(prom.data.promoted_at).not.toBeNull()
    expect(prom.data.promoted_by).not.toBeNull()
  })

  /* ── 9. (was: tips guard, source wall, triage authority) ────────────────
     Removed with intelligence_tips. The pins it held now live on
     field_submissions: the insert guard is exercised by the Field Intelligence
     suite, and the source wall is stronger than a policy there --
     field_submission_sources has RLS on with no policy and no grants, so no
     role can read it at all and there is nothing left for a SELECT test to
     assert against. field_submission_source_reveal() is the only way in. */

  /* ── 10–11. the dormant bridge is service_role-only ────────────────────── */

  it('bridge_ingest_event cannot be called by an authenticated member', async () => {
    const r = await lsb.rpc('bridge_ingest_event', {
      p_source: 'rls-test-bridge', p_event_type: 'alpr',
      p_source_event_id: `rls-test-${tag}`, p_event_time: new Date().toISOString(),
      p_payload: { activity: 'should never land' },
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/permission denied/i)
  })

  it('mdt_bridge_ack cannot be called by an authenticated member', async () => {
    const r = await lsb.rpc('mdt_bridge_ack', {
      p_kind: 'export', p_id: '00000000-0000-0000-0000-000000000000', p_result: 'synced',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/permission denied/i)
  })

  /* ── 12. alert rules: readable, command-tunable only ───────────────────── */

  it('alert rules are readable but a detective update is policy-filtered', async () => {
    const rules = await lsb.from('surveillance_alert_rules').select('rule_key, threshold, window_days')
    expect(rules.error).toBeNull()
    expect((rules.data ?? []).map((r: { rule_key: string }) => r.rule_key)).toContain('repeated_person')

    const up = await lsb.from('surveillance_alert_rules')
      .update({ threshold: 99 }).eq('rule_key', 'repeated_vehicle').select('rule_key')
    expect(up.error).toBeNull()
    expect(up.data ?? []).toHaveLength(0) // policy filtered — nothing updated
  })

  /* ── 13. alerts + deconfliction smoke ──────────────────────────────────── */

  it('≥3 same-person observations raise an alert; deconfliction crosses cases for members only', async () => {
    // Three sightings of the same person on case A → repeated_person fires
    // (seeded threshold 3 / 30 days) via the definer scan trigger.
    const obsIds: string[] = []
    for (let i = 0; i < 3; i++) {
      const o = await lsb.from('surveillance_observations')
        .insert({
          case_id: caseId, target_id: leadReqId, person_id: personId,
          observed_at: new Date(Date.now() - i * 60_000).toISOString(),
          activity: `[rls-test] v139 pattern sighting ${i} ${tag}`,
        })
        .select('id')
      expect(o.error, o.error?.message).toBeNull()
      obsIds.push(o.data![0].id)
    }
    const alerts = await lsb.from('surveillance_alerts')
      .select('alert_type, explanation, status')
      .eq('case_id', caseId).eq('alert_type', 'repeated_person')
    expect(alerts.error).toBeNull()
    expect((alerts.data ?? []).length).toBeGreaterThanOrEqual(1)
    expect(alerts.data![0].explanation).toMatch(/repeated_person/) // explainability

    // Entity-link + verify each sighting (deconfliction only counts VERIFIED).
    for (const id of obsIds) {
      const link = await lsb.from('surveillance_observation_entities')
        .insert({ observation_id: id, kind: 'person', ref_id: personId })
      expect(link.error, link.error?.message).toBeNull()
      const ver = await lsb.rpc('observation_review', { p_observation: id, p_decision: 'verify' })
      expect(ver.error, ver.error?.message).toBeNull()
    }

    // The same person, verified on the SIBLING case → a cross-case hit.
    const ob = await lsb.from('surveillance_observations')
      .insert({
        case_id: caseBId, person_id: personId,
        observed_at: new Date().toISOString(),
        activity: `[rls-test] v139 sibling sighting ${tag}`,
      })
      .select('id')
    expect(ob.error, ob.error?.message).toBeNull()
    const obBId = ob.data![0].id as string
    const linkB = await lsb.from('surveillance_observation_entities')
      .insert({ observation_id: obBId, kind: 'person', ref_id: personId })
    expect(linkB.error, linkB.error?.message).toBeNull()
    const verB = await lsb.rpc('observation_review', { p_observation: obBId, p_decision: 'verify' })
    expect(verB.error, verB.error?.message).toBeNull()

    const mine = await lsb.rpc('surveillance_deconflict', { p_case: caseId })
    expect(mine.error, mine.error?.message).toBeNull()
    const hit = (mine.data ?? []).find(
      (r: { kind: string; ref_id: string }) => r.kind === 'person' && r.ref_id === personId)
    expect(hit).toBeTruthy()
    expect(Number(hit.other_case_count)).toBeGreaterThanOrEqual(1)
    expect(hit.visible_case_ids).toContain(caseBId)

    // The RPC gates on can_access_case: no access, no rows — not even counts.
    const theirs = await bcb.rpc('surveillance_deconflict', { p_case: caseId })
    expect(theirs.error).toBeNull()
    expect(theirs.data ?? []).toHaveLength(0)
  })
})
