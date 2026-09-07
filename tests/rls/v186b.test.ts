/** v1.86b — Charges on legal requests (Portal Improvements P4-03,
 *  migrations 20261024120000_legal_tables + 20261026120000_legal_rpcs).
 *
 *  A legal request carries a STRUCTURED set of charges chosen from the
 *  case's own `case_charges` rows, each frozen with the statute snapshot the
 *  case charge already holds (`snap_code / snap_offense / snap_charge_class /
 *  snap_penal_title`), so amending the penal code later never rewrites what
 *  a warrant asked for. The table is RPC-only:
 *   · the creator proposes a case charge (a plain case_charges INSERT — the
 *     BEFORE INSERT trigger fills the snapshot) and `legal_set_charges`
 *     REPLACES the request's whole set, snapshotting from the case charge;
 *   · a case charge belonging to ANOTHER case is refused;
 *   · the set is frozen once the request is submitted (creator while
 *     editable only);
 *   · the other bureau reads 0 rows and cannot set anything;
 *   · no client INSERT / UPDATE / DELETE on legal_request_charges (42501).
 *
 *  Fixtures: lsb (creator, two MCB cases), lead (the approver — unused
 *  beyond sign-in, kept so the suite matches the CID build), bcb (outsider).
 *  Both cases, their case_charges and the request are swept by
 *  rls_test_cleanup() in afterAll (charges cascade with the case). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, bcb: process.env.RLS_TEST_PASSWORD_BCB, lead: process.env.RLS_TEST_PASSWORD_LEAD }
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v186b] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Res = { ok: boolean; code?: string; count?: number }
type Snap = { snap_code: string | null; snap_offense: string; snap_charge_class: string; snap_penal_title: string | null }

describe.skipIf(!enabled)('v1.86b — legal_request_charges: creator-set, snapshotted, case-scoped, frozen on submit', () => {
  let lsb: C, bcb: C, lead: C
  let lsbId = ''
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v186b ${tag}`
  let caseA = '', caseB = ''
  let chargeA1 = '', chargeA2 = '', chargeB = ''   // case_charges ids
  let penalIds: string[] = []
  let requestId = ''

  const proposeCharge = async (caseId: string, penalId: string) => {
    // src/lib/caseCharges.ts proposeCaseCharge: case_id + charge_id + counts —
    // the trigger fills version_id and the snap_* columns.
    const r = await lsb.from('case_charges').insert({ case_id: caseId, charge_id: penalId, counts: 1 }).select('id, snap_code, snap_offense, snap_charge_class, snap_penal_title').single()
    expect(r.error, r.error?.message).toBeNull()
    return r.data!
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    for (const [key, n] of [['A', 'A'], ['B', 'B']] as const) {
      const c = await lsb.from('cases').insert({ case_number: `V186B-${tag}-${n}`, title: `${stamp} charges case ${n}`, bureau: 'major_crimes' }).select('id').single()
      if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
      if (key === 'A') caseA = c.data!.id; else caseB = c.data!.id
    }
    // Two distinct live penal charges (any published version).
    const p = await lsb.from('penal_charges').select('id').eq('lifecycle', 'active').order('code').limit(2)
    if (p.error) throw new Error(`penal_charges read failed: ${p.error.message}`)
    penalIds = (p.data ?? []).map((r) => r.id as string)
    if (penalIds.length < 2) throw new Error('v186b needs at least two active penal charges')
    chargeA1 = (await proposeCharge(caseA, penalIds[0])).id
    chargeA2 = (await proposeCharge(caseA, penalIds[1])).id
    chargeB = (await proposeCharge(caseB, penalIds[0])).id

    const r = await lsb.rpc('create_legal_request', {
      p_case: caseA, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `${stamp} charged warrant`, p_narrative: 'Narrative for the v186b charges wall test.',
      p_form: { standard_of_proof: 'probable_cause', pc_statement: 'The affiant observed the sale.', search_targets: 'Subject: RLS' },
    })
    if (r.error) throw new Error(`create_legal_request failed: ${r.error.message}`)
    requestId = r.data!.id
  }, 120_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v186b] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead].map((c) => c.auth.signOut()))
  }, 60_000)

  it('the creator sets the charge set; every row snapshots the case charge\'s statute', async () => {
    const set = await lsb.rpc('legal_set_charges', { p_request: requestId, p_items: [{ case_charge_id: chargeA1, counts: 2 }] })
    expect(set.error, set.error?.message).toBeNull()
    expect(set.data).toMatchObject({ ok: true, count: 1 })

    const rows = await lsb.from('legal_request_charges').select('case_charge_id, counts, added_by, snap_code, snap_offense, snap_charge_class, snap_penal_title').eq('legal_request_id', requestId)
    expect(rows.error).toBeNull()
    expect(rows.data).toHaveLength(1)
    expect(rows.data![0]).toMatchObject({ case_charge_id: chargeA1, counts: 2, added_by: lsbId })
    const src = await lsb.from('case_charges').select('snap_code, snap_offense, snap_charge_class, snap_penal_title').eq('id', chargeA1).single()
    const snap = rows.data![0] as Snap
    expect(snap.snap_code).toBe(src.data!.snap_code)
    expect(snap.snap_offense).toBe(src.data!.snap_offense)
    expect(snap.snap_charge_class).toBe(src.data!.snap_charge_class)
    expect(snap.snap_penal_title).toBe(src.data!.snap_penal_title)

    const acts = await lsb.from('legal_request_actions').select('action').eq('legal_request_id', requestId)
    expect((acts.data ?? []).map((a) => a.action)).toContain('charges_set')
  })

  it('a second call REPLACES the set (no accumulation); counts are bounded', async () => {
    const set = await lsb.rpc('legal_set_charges', { p_request: requestId, p_items: [{ case_charge_id: chargeA2, counts: 1 }, { case_charge_id: chargeA1, counts: 3 }] })
    expect(set.error, set.error?.message).toBeNull()
    expect(set.data).toMatchObject({ ok: true, count: 2 })
    const rows = await lsb.from('legal_request_charges').select('case_charge_id, counts').eq('legal_request_id', requestId).order('counts')
    expect((rows.data ?? []).map((r) => [r.case_charge_id, r.counts])).toEqual([[chargeA2, 1], [chargeA1, 3]])

    const zero = await lsb.rpc('legal_set_charges', { p_request: requestId, p_items: [{ case_charge_id: chargeA1, counts: 0 }] })
    expect(zero.error !== null || (zero.data as Res).ok === false).toBe(true)
    expect((await lsb.from('legal_request_charges').select('id').eq('legal_request_id', requestId)).data).toHaveLength(2)
  })

  it('a case charge from ANOTHER case is refused and the set is untouched', async () => {
    const foreign = await lsb.rpc('legal_set_charges', { p_request: requestId, p_items: [{ case_charge_id: chargeA1, counts: 1 }, { case_charge_id: chargeB, counts: 1 }] })
    // A hard validation error raises; an authority refusal returns ok:false —
    // either way nothing was written.
    expect(foreign.error !== null || (foreign.data as Res).ok === false).toBe(true)
    if (foreign.error) expect(foreign.error.message).toMatch(/case/i)
    const rows = await lsb.from('legal_request_charges').select('case_charge_id').eq('legal_request_id', requestId)
    expect((rows.data ?? []).map((r) => r.case_charge_id).sort()).toEqual([chargeA1, chargeA2].sort())
    expect((rows.data ?? []).some((r) => r.case_charge_id === chargeB)).toBe(false)
  })

  it('the other bureau reads 0 rows and cannot set the charges', async () => {
    expect((await bcb.from('legal_request_charges').select('id').eq('legal_request_id', requestId)).data ?? []).toEqual([])
    const set = await bcb.rpc('legal_set_charges', { p_request: requestId, p_items: [{ case_charge_id: chargeB, counts: 1 }] })
    expect(set.error).toBeNull()
    expect(set.data).toMatchObject({ ok: false, code: 'denied' })
    // Command may approve the packet but never authors its charges either.
    const asLead = await lead.rpc('legal_set_charges', { p_request: requestId, p_items: [{ case_charge_id: chargeA1, counts: 1 }] })
    expect(asLead.error).toBeNull()
    expect(asLead.data).toMatchObject({ ok: false, code: 'denied' })
  })

  it('no client INSERT / UPDATE / DELETE on legal_request_charges', async () => {
    const ins = await lsb.from('legal_request_charges').insert({
      legal_request_id: requestId, case_charge_id: chargeA1, snap_offense: 'forged', snap_charge_class: 'felony', counts: 1,
    }).select('id')
    expect(ins.error?.code).toBe('42501')
    const upd = await lsb.from('legal_request_charges').update({ counts: 9 }).eq('legal_request_id', requestId).select('id')
    expect(upd.error?.code).toBe('42501')
    const del = await lsb.from('legal_request_charges').delete().eq('legal_request_id', requestId).select('id')
    expect(del.error?.code).toBe('42501')
    const rows = await lsb.from('legal_request_charges').select('counts').eq('legal_request_id', requestId).order('counts')
    expect((rows.data ?? []).map((r) => r.counts)).toEqual([1, 3])
  })

  it('the set freezes on submit and the frozen version carries the charges', async () => {
    const ex = await lsb.rpc('add_legal_exhibit', { p_request: requestId, p_type: 'external_link', p_meta: { url: `https://evidence.example/v186b/${tag}` } })
    expect(ex.error, ex.error?.message).toBeNull()
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: requestId })
    expect(sub.error, sub.error?.message).toBeNull()
    expect(sub.data).toMatchObject({ review_status: 'cid_supervisor_review' })

    const late = await lsb.rpc('legal_set_charges', { p_request: requestId, p_items: [{ case_charge_id: chargeA1, counts: 1 }] })
    expect(late.error !== null || (late.data as Res).ok === false).toBe(true)
    const rows = await lsb.from('legal_request_charges').select('counts').eq('legal_request_id', requestId).order('counts')
    expect((rows.data ?? []).map((r) => r.counts)).toEqual([1, 3])
    // The charge rows stay readable to the creator after the freeze (the
    // judicial version copies them into form_data._charges — pinned by v186d).
    expect((await lsb.from('legal_request_charges').select('id').eq('legal_request_id', requestId)).data).toHaveLength(2)
  })
})
