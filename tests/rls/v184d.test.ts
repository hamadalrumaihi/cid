/** v1.84d — case-scoped observations, master-record update suggestions and
 *  the bounded cross-reference (P2-05 / P2-06, migrations 20261018120000 +
 *  20261019120000).
 *
 *  Pins, on a fixture MCB case with a person and a vehicle:
 *   · a case member records an observation on the case (recorded_by must be
 *     themselves; the promotion stamps are RPC-only, P0403 on a direct
 *     write); another bureau cannot read it — the case wall — nor add one;
 *   · promote_observation by a Detective QUEUES ({applied:false}) and the
 *     master stays untouched; the reviewer (director, same division) is
 *     notified entity_update_suggested;
 *   · entity_suggestion_decide by the director applies the value, stamps
 *     the observation promoted, marks the suggestion accepted and notifies
 *     the proposer; deciding twice is already_decided;
 *   · entity_suggest_update by SrDet+ applies at once, refuses `stale` on a
 *     wrong p_expected_current, and `bad_request` on a non-editable field;
 *   · a Detective cannot decide (denied); only the proposer withdraws a
 *     pending suggestion (denied for anyone else, already_decided after);
 *   · case_intel_links accepts kind 'vehicle' (and still refuses an unknown
 *     kind); entity_crossref('vehicle') answers the linked case via 'link'
 *     for a case member and nothing across the bureau wall.
 *
 *  Fixtures: lsb (MCB Detective — author, proposer), bcb (SCB Detective —
 *  the wall), director (MCB — the reviewer). rls_test_cleanup() sweeps the
 *  case (observations cascade with it), the person, the vehicle and the
 *  fixtures' notifications. entity_update_suggestions rows have no FK and
 *  are not swept (see the report). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, bcb: process.env.RLS_TEST_PASSWORD_BCB, director: process.env.RLS_TEST_PASSWORD_DIRECTOR }
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.director)
if (!enabled) console.warn('[rls:v184d] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Answer = { ok: boolean; code?: string; applied?: boolean; suggestion_id?: string; observation_id?: string; current?: string | null; changed?: boolean; from?: string | null; to?: string | null }
type Crossref = { case_id: string; case_number: string; via: string; detail: string | null }

describe.skipIf(!enabled)('v1.84d — observations, update suggestions, crossref', () => {
  let lsb: C, bcb: C, director: C
  let lsbId = '', bcbId = '', directorId = ''
  let caseId = '', caseNumber = '', personId = '', vehicleId = '', observationId = '', suggestionId = '', pendingId = ''
  const tag = Date.now().toString(36)
  const alias = `Ghost ${tag}`

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); director = mk()
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    bcbId = await signInWithRetry(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    directorId = await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)

    caseNumber = `V184D-${tag.toUpperCase()}`
    const c = await lsb.from('cases').insert({ case_number: caseNumber, title: `[rls-test] v184d observation case ${tag}`, bureau: 'major_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
    const p = await lsb.from('persons').insert({ name: `[rls-test] v184d Subject ${tag}` }).select('id').single()
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data!.id
    const v = await lsb.from('vehicles').insert({ plate: `V84D${tag.slice(-4).toUpperCase()}`, model: 'v184d coupe' }).select('id').single()
    if (v.error) throw new Error(`vehicle insert failed: ${v.error.message}`)
    vehicleId = v.data!.id
  }, 90_000)

  afterAll(async () => { if (lsb) await lsb.rpc('rls_test_cleanup') })

  const person = async (c: C) => (await c.from('persons').select('alias, phone').eq('id', personId).single()).data

  /* ── P2-06: the vehicle link kind and the cross-reference ───────────── */

  it('case_intel_links accepts kind vehicle and still refuses an unknown kind', async () => {
    const ok = await lsb.from('case_intel_links').insert({ case_id: caseId, kind: 'vehicle', ref_id: vehicleId }).select('id')
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data).toHaveLength(1)
    const bad = await lsb.from('case_intel_links').insert({ case_id: caseId, kind: 'operation', ref_id: vehicleId }).select('id')
    expect(bad.error).not.toBeNull()
    expect(bad.error!.code).toBe('23514')
  })

  it('entity_crossref(vehicle) answers the linked case via link for a case member, nothing across the wall', async () => {
    const mine = await lsb.rpc('entity_crossref', { p_kind: 'vehicle', p_id: vehicleId })
    expect(mine.error, mine.error?.message).toBeNull()
    const rows = (mine.data ?? []) as Crossref[]
    expect(rows.find((r) => r.case_id === caseId)).toMatchObject({ case_number: caseNumber, via: 'link', detail: 'linked' })
    const theirs = await bcb.rpc('entity_crossref', { p_kind: 'vehicle', p_id: vehicleId })
    expect(theirs.error).toBeNull()
    expect(theirs.data).toEqual([])
    expect((await lsb.rpc('entity_crossref', { p_kind: 'report', p_id: vehicleId })).data).toEqual([])
  })

  /* ── P2-05: observations ────────────────────────────────────────────── */

  it('a case member records an observation as themselves; the case wall hides it; stamps are RPC-only', async () => {
    const forged = await lsb.from('entity_field_observations')
      .insert({ kind: 'person', ref_id: personId, case_id: caseId, field: 'alias', value: alias, recorded_by: directorId }).select('id')
    expect(forged.error?.code).toBe('42501')
    const o = await lsb.from('entity_field_observations')
      .insert({ kind: 'person', ref_id: personId, case_id: caseId, field: 'alias', value: alias, note: `[rls-test] v184d ${tag}`, recorded_by: lsbId })
      .select('id, promoted_at').single()
    expect(o.error, o.error?.message).toBeNull()
    observationId = o.data!.id
    expect(o.data!.promoted_at).toBeNull()

    expect((await lsb.from('entity_field_observations').select('id').eq('id', observationId)).data).toHaveLength(1)
    const wall = await bcb.from('entity_field_observations').select('id').eq('id', observationId)
    expect(wall.error).toBeNull()
    expect(wall.data).toEqual([])
    const theirs = await bcb.from('entity_field_observations')
      .insert({ kind: 'person', ref_id: personId, case_id: caseId, field: 'alias', value: 'x', recorded_by: bcbId }).select('id')
    expect(theirs.error?.code).toBe('42501')

    const stamp = await lsb.from('entity_field_observations').update({ promoted_at: new Date().toISOString() }).eq('id', observationId).select('id')
    expect(stamp.error?.code).toBe('P0403')
  })

  it('promote_observation by a Detective queues a suggestion; the master stays; the reviewer is notified', async () => {
    expect((await lsb.rpc('promote_observation', { p_id: observationId, p_reason: ' ' })).data).toMatchObject({ ok: false, code: 'reason_required' })
    expect((await bcb.rpc('promote_observation', { p_id: observationId, p_reason: 'across the wall' })).data).toMatchObject({ ok: false, code: 'denied' })
    const r = await lsb.rpc('promote_observation', { p_id: observationId, p_reason: `[rls-test] v184d confirmed alias ${tag}` })
    expect(r.error, r.error?.message).toBeNull()
    const a = r.data as Answer
    expect(a).toMatchObject({ ok: true, applied: false, observation_id: observationId })
    suggestionId = a.suggestion_id!
    expect((await person(lsb))?.alias).toBeNull()
    const s = await lsb.from('entity_update_suggestions').select('status, field, proposed_value, proposed_by, source_observation_id').eq('id', suggestionId).single()
    expect(s.error, s.error?.message).toBeNull()
    expect(s.data).toEqual({ status: 'pending', field: 'alias', proposed_value: alias, proposed_by: lsbId, source_observation_id: observationId })
    expect((await lsb.from('entity_field_observations').select('promoted_at').eq('id', observationId).single()).data?.promoted_at).toBeNull()
    const n = await director.from('notifications').select('id').eq('type', 'entity_update_suggested').eq('user_id', directorId).filter('payload->>suggestion_id', 'eq', suggestionId)
    expect(n.error, n.error?.message).toBeNull()
    expect(n.data).toHaveLength(1)
  })

  it('a Detective cannot decide; the director accepts: field applied, observation promoted, proposer notified', async () => {
    expect((await lsb.rpc('entity_suggestion_decide', { p_id: suggestionId, p_accept: true })).data).toMatchObject({ ok: false, code: 'denied' })
    expect((await person(lsb))?.alias).toBeNull()
    const d = await director.rpc('entity_suggestion_decide', { p_id: suggestionId, p_accept: true, p_note: `[rls-test] v184d accepted ${tag}` })
    expect(d.error, d.error?.message).toBeNull()
    expect(d.data).toMatchObject({ ok: true, id: suggestionId, accepted: true, changed: true })
    expect((await person(lsb))?.alias).toBe(alias)
    const o = await lsb.from('entity_field_observations').select('promoted_at, promoted_by').eq('id', observationId).single()
    expect(o.data?.promoted_at).not.toBeNull()
    expect(o.data?.promoted_by).toBe(directorId)
    const s = await lsb.from('entity_update_suggestions').select('status, decided_by').eq('id', suggestionId).single()
    expect(s.data).toEqual({ status: 'accepted', decided_by: directorId })
    expect((await director.rpc('entity_suggestion_decide', { p_id: suggestionId, p_accept: false })).data).toMatchObject({ ok: false, code: 'already_decided' })
    expect((await lsb.rpc('promote_observation', { p_id: observationId, p_reason: 'again' })).data).toMatchObject({ ok: false, code: 'already_promoted' })
    const n = await lsb.from('notifications').select('id').eq('type', 'entity_suggestion_decided').eq('user_id', lsbId).filter('payload->>suggestion_id', 'eq', suggestionId)
    expect(n.data).toHaveLength(1)
  })

  it('entity_suggest_update by SrDet+: stale on a wrong expected value, bad_request on a frozen field, applied otherwise', async () => {
    const stale = await director.rpc('entity_suggest_update', { p_kind: 'person', p_id: personId, p_field: 'phone', p_value: '555-0100', p_reason: 'x', p_expected_current: '555-9999' })
    expect(stale.error).toBeNull()
    expect(stale.data).toMatchObject({ ok: false, code: 'stale', current: null })
    expect((await person(lsb))?.phone).toBeNull()
    expect((await director.rpc('entity_suggest_update', { p_kind: 'person', p_id: personId, p_field: 'lifecycle', p_value: 'merged', p_reason: 'x' })).data)
      .toMatchObject({ ok: false, code: 'bad_request' })
    expect((await director.rpc('entity_suggest_update', { p_kind: 'person', p_id: personId, p_field: 'phone', p_value: '555-0100', p_reason: ' ' })).data)
      .toMatchObject({ ok: false, code: 'reason_required' })
    const ok = await director.rpc('entity_suggest_update', { p_kind: 'person', p_id: personId, p_field: 'phone', p_value: '555-0100', p_reason: `[rls-test] v184d direct ${tag}` })
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data).toMatchObject({ ok: true, applied: true, from: null, to: '555-0100' })
    expect((await person(lsb))?.phone).toBe('555-0100')
    expect((await director.rpc('entity_suggest_update', { p_kind: 'person', p_id: personId, p_field: 'phone', p_value: '555-0100', p_reason: 'same' })).data)
      .toMatchObject({ ok: false, code: 'no_change' })
  })

  it('only the proposer withdraws a pending suggestion', async () => {
    const q = await lsb.rpc('entity_suggest_update', { p_kind: 'person', p_id: personId, p_field: 'notes', p_value: `[rls-test] v184d note ${tag}`, p_reason: `[rls-test] v184d ${tag}` })
    expect(q.error, q.error?.message).toBeNull()
    expect(q.data).toMatchObject({ ok: true, applied: false })
    pendingId = (q.data as Answer).suggestion_id!
    expect((await bcb.rpc('entity_suggestion_withdraw', { p_id: pendingId })).data).toMatchObject({ ok: false, code: 'denied' })
    expect((await director.rpc('entity_suggestion_withdraw', { p_id: pendingId })).data).toMatchObject({ ok: false, code: 'denied' })
    const w = await lsb.rpc('entity_suggestion_withdraw', { p_id: pendingId })
    expect(w.error).toBeNull()
    expect(w.data).toMatchObject({ ok: true, id: pendingId })
    expect((await lsb.from('entity_update_suggestions').select('status').eq('id', pendingId).single()).data?.status).toBe('withdrawn')
    expect((await lsb.rpc('entity_suggestion_withdraw', { p_id: pendingId })).data).toMatchObject({ ok: false, code: 'already_decided' })
    expect((await director.rpc('entity_suggestion_decide', { p_id: pendingId, p_accept: true })).data).toMatchObject({ ok: false, code: 'already_decided' })
  })
})
