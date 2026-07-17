/** v1.36 — structured search-warrant targets + version change summaries
 *  (migration 20260806010000_legal_structured_targets).
 *
 *  Additive legal surface:
 *   1. legal_request_exhibits: CHECK widened with 'vehicle' / 'place' /
 *      'prior_legal_request'; new nullable `rationale` (per-target probable
 *      cause, trimmed server-side).
 *   2. legal_request_versions: nullable `change_summary` (author-supplied on
 *      submit) + `returned_from` (derived from a returned_by_% review status —
 *      never a parameter; null on a first submission).
 *   3. RPC signatures grew OPTIONAL defaulted params (old signatures dropped):
 *      add_legal_exhibit(+ p_rationale) with three validated kind branches —
 *      vehicle/place are existence-checked registries, prior_legal_request
 *      requires private.can_view_legal_request on the source, forbids
 *      self-reference, and a sealed prior's default title is its
 *      request_number ONLY (no sealed-title leak into another packet);
 *      submit_legal_request_to_cid(+ p_change_summary) threads the summary
 *      into private.legal_freeze_version, whose packet manifest now snapshots
 *      each exhibit's rationale.
 *
 *  Pins:
 *   - creator attaches vehicle / place targets (with rationale) to their own
 *     draft; default titles come from the registry rows; rationale is trimmed;
 *   - a random uuid vehicle/place is rejected (existence check);
 *   - prior_legal_request: the creator's OWN other request attaches and its
 *     default title carries the request_number (+ title when not sealed);
 *   - a sealed prior's default title is EXACTLY its request_number — the
 *     sealed title never leaks;
 *   - self-reference and a request the caller cannot view are both rejected;
 *   - unknown kinds still hit 'invalid exhibit type';
 *   - LEGACY call shapes unchanged: add_legal_exhibit without p_rationale and
 *     submit_legal_request_to_cid with only {p_request} both succeed
 *     (change_summary null on that version);
 *   - submit with p_change_summary stores the trimmed summary on the newest
 *     version with returned_from null (first submission — nothing superseded);
 *   - the frozen packet_manifest snapshots each exhibit's rationale;
 *   - anon cannot execute either RPC (EXECUTE revoked).
 *
 *  Fixtures (tests/rls/README.md): lsb/bcb detectives + director (registry
 *  teardown per the v122/v128 convention — rls_test_cleanup never sweeps
 *  vehicles/places). All requests are [rls-test] v136 search warrants on
 *  per-run cases; rls_test_cleanup() runs at start AND teardown and purges
 *  every rls-test case + legal request (bcb's included). No CID review, DOJ
 *  hand-off, or notification fan-out to real members (legal_notify suppresses
 *  test-actor → real-target pings). Requires migration 20260806010000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.director)
if (!enabled) console.warn('[rls:v136] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.36 — structured legal targets + change summaries (live)', () => {
  let anon: C, lsb: C, bcb: C, director: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''     // LSB fixture case (lsb-created)
  let bcbCaseId = ''  // BCB fixture case (bcb-created) — outside lsb's audience
  let vehicleId = ''  // registry fixture — director-deleted in teardown
  let placeId = ''    // registry fixture — director-deleted in teardown
  let mainId = ''     // lsb draft that collects the structured targets, then submits with a summary
  let priorId = ''    // lsb's OTHER draft — attached to mainId as prior_legal_request
  let sealedId = ''   // lsb sealed draft — sealed-title-leak pin
  let legacyId = ''   // lsb draft submitted via the LEGACY {p_request}-only shape
  let bcbReqId = ''   // bcb draft lsb cannot view — inaccessible-prior pin
  const VEHICLE_RATIONALE = 'Seen leaving the scene on both nights.'
  const PLACE_RATIONALE = 'Suspected stash location per CI report.'
  const SEALED_TITLE_WORD = 'SEALEDLEAKCANARY'

  const draft = async (client: C, title: string, caseRef: string, classification?: string) => {
    const r = await client.rpc('create_legal_request', {
      p_case: caseRef, p_request_type: 'warrant', p_subtype: 'search_warrant',
      p_title: `[rls-test] v136 ${title} ${tag}`, p_priority: 'Medium',
      p_narrative: 'Structured-targets RLS wall test.',
      p_form: { search_targets: 'RLS test locker 136' },
      ...(classification ? { p_classification: classification } : {}),
    })
    if (r.error) throw new Error(`create ${title}: ${r.error.message}`)
    return r.data!.id as string
  }

  beforeAll(async () => {
    anon = mk(); lsb = mk(); bcb = mk(); director = mk()
    // Sequential with backoff — parallel password grants trip the per-IP limit.
    for (const [client, email, pw] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb],
      [director, 'rls-test-director@cidportal.test', PW.director],
    ] as const) {
      await signInWithRetry(client, email, pw!)
    }
    // Purge leftovers from any crashed prior run FIRST.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c = await lsb.from('cases')
      .insert({ case_number: `V136-${tag}`, title: '[rls-test] v136 structured targets', bureau: 'LSB' })
      .select('id')
    if (c.error) throw new Error(`fixture case: ${c.error.message}`)
    caseId = c.data![0].id
    const cb = await bcb.from('cases')
      .insert({ case_number: `V136B-${tag}`, title: '[rls-test] v136 bcb isolation case', bureau: 'BCB' })
      .select('id')
    if (cb.error) throw new Error(`bcb fixture case: ${cb.error.message}`)
    bcbCaseId = cb.data![0].id

    // Registry fixtures — client INSERT is allowed on these is_active()
    // audiences (v122/v128 precedent); rls_test_cleanup never sweeps them,
    // so the director deletes them explicitly in afterAll.
    const veh = await lsb.from('vehicles')
      .insert({ plate: `V6${tag.slice(0, 4)}`, model: 'v136 sedan' }).select('id')
    if (veh.error) throw new Error(`fixture vehicle: ${veh.error.message}`)
    vehicleId = veh.data![0].id
    const pl = await lsb.from('places')
      .insert({ name: `[rls-test] v136 place ${tag}`, type: 'stash_house' }).select('id')
    if (pl.error) throw new Error(`fixture place: ${pl.error.message}`)
    placeId = pl.data![0].id

    mainId = await draft(lsb, 'main', caseId)
    priorId = await draft(lsb, 'prior', caseId)
    sealedId = await draft(lsb, `sealed ${SEALED_TITLE_WORD}`, caseId, 'sealed')
    legacyId = await draft(lsb, 'legacy', caseId)
    bcbReqId = await draft(bcb, 'bcb-hidden', bcbCaseId)
  })

  afterAll(async () => {
    if (!lsb) return
    // Registry rows first (explicit command teardown — v122/v128 convention),
    // then the cleanup RPC sweeps every rls-test case + legal request
    // (+versions/exhibits/actions/participants) across all fixture accounts.
    if (director) {
      if (vehicleId) await director.from('vehicles').delete().eq('id', vehicleId)
      if (placeId) await director.from('places').delete().eq('id', placeId)
    }
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v136] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, director].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── 1. new registry kinds on the creator's own draft ── */

  it('creator attaches a vehicle target with a rationale; default title from the registry row, rationale trimmed', async () => {
    const r = await lsb.rpc('add_legal_exhibit', {
      p_request: mainId, p_type: 'vehicle', p_source_id: vehicleId,
      p_rationale: `  ${VEHICLE_RATIONALE}  `,
    })
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({
      exhibit_type: 'vehicle', source_id: vehicleId, rationale: VEHICLE_RATIONALE,
    })
    expect(r.data!.display_title).toBe(`V6${tag.slice(0, 4)} — v136 sedan`)
  })

  it('creator attaches a place target with a rationale; a random uuid place is rejected', async () => {
    const r = await lsb.rpc('add_legal_exhibit', {
      p_request: mainId, p_type: 'place', p_source_id: placeId,
      p_rationale: PLACE_RATIONALE,
    })
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({
      exhibit_type: 'place', source_id: placeId, rationale: PLACE_RATIONALE,
      display_title: `[rls-test] v136 place ${tag}`,
    })
    // existence check: the registry row must actually exist
    const miss = await lsb.rpc('add_legal_exhibit', {
      p_request: mainId, p_type: 'place', p_source_id: randomUUID(),
    })
    expect(miss.error).not.toBeNull()
    expect(miss.error!.message).toMatch(/place not found/i)
  })

  /* ── 2. prior_legal_request ── */

  it('prior_legal_request: the creator attaches their OWN other request; default title carries the request number and title', async () => {
    const num = await lsb.from('legal_requests').select('request_number, title').eq('id', priorId)
    expect(num.error).toBeNull()
    expect(num.data).toHaveLength(1)
    const { request_number, title } = num.data![0]

    const r = await lsb.rpc('add_legal_exhibit', {
      p_request: mainId, p_type: 'prior_legal_request', p_source_id: priorId,
    })
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ exhibit_type: 'prior_legal_request', source_id: priorId })
    expect(r.data!.display_title).toBe(`${request_number} — ${title}`)
  })

  it('a sealed prior\'s default title is EXACTLY its request_number — the sealed title never leaks', async () => {
    const num = await lsb.from('legal_requests').select('request_number').eq('id', sealedId)
    expect(num.data).toHaveLength(1)
    const r = await lsb.rpc('add_legal_exhibit', {
      p_request: mainId, p_type: 'prior_legal_request', p_source_id: sealedId,
    })
    expect(r.error).toBeNull()
    expect(r.data!.display_title).toBe(num.data![0].request_number)
    expect(r.data!.display_title).not.toContain(SEALED_TITLE_WORD)
    expect(r.data!.display_title).not.toContain('—')
  })

  it('prior_legal_request self-reference is rejected', async () => {
    const r = await lsb.rpc('add_legal_exhibit', {
      p_request: mainId, p_type: 'prior_legal_request', p_source_id: mainId,
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/prior legal request not found or not accessible/i)
  })

  it('a prior request the caller cannot view is rejected (another bureau\'s draft)', async () => {
    // Sanity: the wall itself — lsb sees zero rows for bcb's draft.
    const peek = await lsb.from('legal_requests').select('id').eq('id', bcbReqId)
    expect(peek.error).toBeNull()
    expect(peek.data ?? []).toHaveLength(0)

    const r = await lsb.rpc('add_legal_exhibit', {
      p_request: mainId, p_type: 'prior_legal_request', p_source_id: bcbReqId,
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/prior legal request not found or not accessible/i)
  })

  /* ── 3. the CHECK/branch wall still closes ── */

  it('an unknown exhibit kind is still rejected', async () => {
    const r = await lsb.rpc('add_legal_exhibit', {
      p_request: mainId, p_type: 'search_target', p_source_id: vehicleId,
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/invalid exhibit type/i)
  })

  /* ── 4. legacy call shapes keep working ── */

  it('LEGACY shapes: add_legal_exhibit without p_rationale and submit with only {p_request} both succeed', async () => {
    // old add_legal_exhibit arg set (no p_rationale) → defaults to null
    const ex = await lsb.rpc('add_legal_exhibit', {
      p_request: legacyId, p_type: 'external_link', p_meta: { url: 'https://evidence.example/v136' },
    })
    expect(ex.error).toBeNull()
    expect(ex.data!.rationale).toBeNull()

    // old submit_legal_request_to_cid arg set (no p_change_summary)
    const s = await lsb.rpc('submit_legal_request_to_cid', { p_request: legacyId })
    expect(s.error).toBeNull()
    expect(s.data).toMatchObject({ document_status: 'finalized', review_status: 'cid_supervisor_review' })

    const v = await lsb.from('legal_request_versions')
      .select('version_number, change_summary, returned_from')
      .eq('legal_request_id', legacyId).order('version_number', { ascending: false }).limit(1)
    expect(v.error).toBeNull()
    expect(v.data).toHaveLength(1)
    expect(v.data![0]).toMatchObject({ version_number: 1, change_summary: null, returned_from: null })
  })

  /* ── 5. change summary + manifest rationale on the frozen version ── */

  it('submit with p_change_summary stores the trimmed summary on the new version; returned_from is null on a first submission', async () => {
    const s = await lsb.rpc('submit_legal_request_to_cid', {
      p_request: mainId, p_change_summary: '  Structured targets added.  ',
    })
    expect(s.error).toBeNull()
    expect(s.data).toMatchObject({ review_status: 'cid_supervisor_review' })

    const v = await lsb.from('legal_request_versions')
      .select('version_number, change_summary, returned_from')
      .eq('legal_request_id', mainId).order('version_number', { ascending: false }).limit(1)
    expect(v.error).toBeNull()
    expect(v.data).toHaveLength(1)
    expect(v.data![0]).toMatchObject({
      version_number: 1,
      change_summary: 'Structured targets added.', // trimmed server-side
      returned_from: null, // nothing superseded — never client-supplied
    })
  })

  it('the frozen packet_manifest snapshots each exhibit\'s rationale', async () => {
    const v = await lsb.from('legal_request_versions')
      .select('packet_manifest')
      .eq('legal_request_id', mainId).order('version_number', { ascending: false }).limit(1)
    expect(v.error).toBeNull()
    const manifest = (v.data![0].packet_manifest ?? []) as Array<{
      type: string, source_id: string, title: string, rationale: string | null
    }>
    // vehicle + place + own prior + sealed prior
    expect(manifest).toHaveLength(4)
    const byType = (t: string, src: string) => manifest.find((e) => e.type === t && e.source_id === src)
    expect(byType('vehicle', vehicleId)?.rationale).toBe(VEHICLE_RATIONALE)
    expect(byType('place', placeId)?.rationale).toBe(PLACE_RATIONALE)
    expect(byType('prior_legal_request', priorId)?.rationale).toBeNull()
    // and the sealed-title guarantee survives into the snapshot
    const sealed = byType('prior_legal_request', sealedId)
    expect(sealed?.rationale).toBeNull()
    expect(sealed?.title ?? '').not.toContain(SEALED_TITLE_WORD)
  })

  /* ── 6. anon stays out ── */

  it('anon cannot execute add_legal_exhibit or submit_legal_request_to_cid', async () => {
    const ex = await anon.rpc('add_legal_exhibit', {
      p_request: mainId, p_type: 'vehicle', p_source_id: vehicleId,
    })
    expect(ex.error).not.toBeNull()
    const sub = await anon.rpc('submit_legal_request_to_cid', { p_request: mainId })
    expect(sub.error).not.toBeNull()
  })
})
