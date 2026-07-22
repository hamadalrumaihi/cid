/** v1.48 — typed warrant execution + structured seized-items inventory
 *  (spec D3, migration 20260807200000_legal_execution_inventory).
 *
 *  Two deltas exercised here:
 *   - record_warrant_execution gained a typed result. 'unable' is NOT an
 *     execution: it requires a reason and leaves the warrant 'issued'
 *     (execution_result='unable'); 'full'/'partial' advance to 'executed' and
 *     stamp execution_result exactly as before.
 *   - legal_seized_items is a structured inventory: reads follow the request
 *     wall (lsi_sel → private.can_view_legal_request), and there is NO client
 *     write policy — legal_seized_item_add / _remove (private.can_fulfil_legal-
 *     gated, warrant-only) are the only write path.
 *
 *  To exercise execution we drive one warrant all the way to 'issued' via the
 *  established DOJ chain (lsb drafts → lead CID-approves → adaLsb → judge
 *  approves with a FUTURE expiry → lsb issues). The case is an LSB case created
 *  by lsb, so lsb (active detective + case access) passes can_fulfil_legal; the
 *  ADA (packet visibility only, no case access) can READ seized items but can
 *  never WRITE them.
 *
 *  Fixtures: lsb (active detective, case creator = the fulfiller), lead (LSB
 *  bureau_lead = CID approver), adaLsb (routing ADA — read-not-write probe),
 *  judge (judicial approval), da (sets ADA coverage), owner (oversight), anon
 *  (denied). Real prosecutor coverage is snapshotted and asserted byte-identical
 *  in afterAll; rls_test_cleanup sweeps the fixture case + requests (seized rows
 *  cascade on the request), and the fixture ADA coverage is ended explicitly.
 *
 *  NOTE: the migration is not yet applied to the live project, so against the
 *  current DB this suite fails on the missing legal_seized_items table and the
 *  new record_warrant_execution signature — "written, needs migration applied",
 *  not a defect (same posture as v147 before its migration landed). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  adaLsb: process.env.RLS_TEST_PASSWORD_ADA_LSB,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
  da: process.env.RLS_TEST_PASSWORD_DA,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.adaLsb && PW.judge && PW.da && PW.owner)
if (!enabled) console.warn('[rls:v148] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.48 — typed warrant execution + seized-items inventory (live)', () => {
  let lsb: C, lead: C, adaLsb: C, judge: C, da: C, owner: C, anon: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let personId = ''
  let warrantId = ''
  let seizedId = ''
  let realCoverage: string[] = []

  // Non-fixture prosecutor coverage snapshot — the tripwire that turns any
  // accidental production damage into a loud failure (same guard as legal.test).
  const nonFixtureCoverage = async () => {
    const fixtures = new Set([ids.adaLsb])
    const cov = await da.from('prosecutor_bureau_assignments')
      .select('id,prosecutor_id,bureau,assignment_type').is('ends_at', null)
    if (cov.error) throw new Error(`coverage snapshot failed: ${cov.error.message}`)
    return (cov.data ?? [])
      .filter((r) => !fixtures.has(r.prosecutor_id))
      .map((r) => JSON.stringify(r))
      .sort()
  }

  beforeAll(async () => {
    lsb = mk(); lead = mk(); adaLsb = mk(); judge = mk(); da = mk(); owner = mk(); anon = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [adaLsb, 'rls-test-ada-lsb@cidportal.test', PW.adaLsb, 'adaLsb'],
      [judge, 'rls-test-judge@cidportal.test', PW.judge, 'judge'],
      [da, 'rls-test-da@cidportal.test', PW.da, 'da'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    // LSB case created by lsb → lsb has case access → passes can_fulfil_legal.
    const c = await lsb.from('cases').insert({ case_number: `V148-${tag}`, title: `[rls-test] v148 execution case ${tag}`, bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id as string
    const p = await lsb.from('persons').insert({ name: `RLS Test V148 Suspect ${tag}` }).select('id')
    if (p.error) throw new Error(p.error.message)
    personId = p.data![0].id as string

    // Route LSB → adaLsb. Where a real prosecutor already holds LSB's primary
    // slot, take the ACTING slot instead (acting outranks primary for routing),
    // so real coverage is never displaced.
    realCoverage = await nonFixtureCoverage()
    const realPrimaryLsb = realCoverage
      .map((s) => JSON.parse(s) as { bureau: string; assignment_type: string })
      .some((a) => a.bureau === 'LSB' && a.assignment_type === 'primary')
    const asg = realPrimaryLsb
      ? await da.rpc('set_acting_ada', { p_prosecutor: ids.adaLsb, p_bureau: 'LSB' })
      : await da.rpc('set_primary_ada', { p_prosecutor: ids.adaLsb, p_bureau: 'LSB' })
    if (asg.error) throw new Error(`ADA coverage setup failed: ${asg.error.message}`)

    // Drive a warrant to 'issued' with a FUTURE expiry (so execution is allowed).
    const draft = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `RLS V148 Warrant ${tag}`, p_priority: 'High', p_person: personId,
      p_narrative: 'Probable cause narrative for the v148 execution test.',
    })
    if (draft.error) throw new Error(`create_legal_request failed: ${draft.error.message}`)
    warrantId = draft.data!.id as string
    await lsb.rpc('add_legal_exhibit', { p_request: warrantId, p_type: 'external_link', p_meta: { url: 'https://evidence.example/v148' } })
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId })
    if (sub.error) throw new Error(`submit_to_cid failed: ${sub.error.message}`)
    const cid = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'approve', p_signature: 'RLS Lead' })
    if (cid.error) throw new Error(`CID approve failed: ${cid.error.message}`)
    const toJudge = await adaLsb.rpc('review_legal_request_as_ada', { p_request: warrantId, p_decision: 'submit_to_judge', p_signature: 'RLS ADA' })
    if (toJudge.error) throw new Error(`ADA submit_to_judge failed: ${toJudge.error.message}`)
    const assign = await adaLsb.rpc('assign_judge', { p_request: warrantId, p_judge: ids.judge })
    if (assign.error) throw new Error(`assign_judge failed: ${assign.error.message}`)
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString()
    const decide = await judge.rpc('decide_legal_request_as_judge', {
      p_request: warrantId, p_decision: 'approve', p_note: 'Approved for the v148 execution test',
      p_expires_at: future, p_signature: 'RLS Judge',
    })
    if (decide.error) throw new Error(`judge approve failed: ${decide.error.message}`)
    const issue = await lsb.rpc('issue_legal_request', { p_request: warrantId })
    if (issue.error) throw new Error(`issue failed: ${issue.error.message}`)
    if (issue.data?.fulfilment_status !== 'issued') throw new Error(`warrant not issued: ${JSON.stringify(issue.data)}`)
  })

  afterAll(async () => {
    if (!lsb) return
    const { error } = await lsb.rpc('rls_test_cleanup')
    if (error) console.warn('[rls:v148] rls_test_cleanup failed:', error.message)
    // End the fixture ADA coverage so it never lingers.
    const fx = await da.from('prosecutor_bureau_assignments').select('id')
      .eq('prosecutor_id', ids.adaLsb).eq('bureau', 'LSB').is('ends_at', null)
    for (const row of fx.data ?? []) {
      try { await da.rpc('end_ada_bureau_assignment', { p_assignment: row.id }) } catch { /* best effort */ }
    }
    if (personId) {
      try { await owner.from('persons').delete().eq('id', personId) } catch { /* best effort */ }
    }
    // Production-state invariant: real coverage must be byte-identical.
    const after = await nonFixtureCoverage()
    if (JSON.stringify(after) !== JSON.stringify(realCoverage)) {
      throw new Error('REAL PROSECUTOR COVERAGE CHANGED DURING THE SUITE — '
        + `before: ${JSON.stringify(realCoverage)} after: ${JSON.stringify(after)}`)
    }
    await Promise.all([lsb, lead, adaLsb, judge, da, owner, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ================= typed execution ================= */

  it("record_warrant_execution with result 'unable' and no reason is rejected", async () => {
    const r = await lsb.rpc('record_warrant_execution', { p_request: warrantId, p_outcome: '   ', p_result: 'unable' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/reason is required/i)
    // still issued, no result recorded
    const row = await lsb.from('legal_requests').select('fulfilment_status,execution_result').eq('id', warrantId).maybeSingle()
    expect(row.data?.fulfilment_status).toBe('issued')
    expect(row.data?.execution_result).toBeNull()
  })

  it("an invalid execution result is rejected (RPC guard + CHECK constraint)", async () => {
    const r = await lsb.rpc('record_warrant_execution', { p_request: warrantId, p_outcome: 'x', p_result: 'bogus' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/invalid execution result/i)
  })

  it("record_warrant_execution 'unable' WITH a reason records the failed attempt and keeps the warrant issued", async () => {
    const r = await lsb.rpc('record_warrant_execution', {
      p_request: warrantId, p_outcome: 'Premises found vacant; target not located.', p_result: 'unable',
    })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ fulfilment_status: 'issued', execution_result: 'unable' })
    expect(r.data!.execution_outcome).toMatch(/vacant/i)
    // executed_by / executed_at stay null — it was never executed
    expect(r.data!.executed_at).toBeNull()
  })

  it("only an authorized CID member on the case may record execution", async () => {
    const r = await anon.rpc('record_warrant_execution', { p_request: warrantId, p_outcome: 'x', p_result: 'full' })
    expect(r.error).not.toBeNull()
    // packet-only ADA (no case access) also cannot execute
    const ada = await adaLsb.rpc('record_warrant_execution', { p_request: warrantId, p_outcome: 'x', p_result: 'full' })
    expect(ada.error).not.toBeNull()
  })

  it("record_warrant_execution 'full' advances the warrant to executed", async () => {
    const r = await lsb.rpc('record_warrant_execution', {
      p_request: warrantId, p_outcome: 'Search completed; items seized.', p_result: 'full',
      p_notes: 'Executed at 0600.',
    })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ fulfilment_status: 'executed', execution_result: 'full', executed_by: ids.lsb })
    expect(r.data!.executed_at).not.toBeNull()
  })

  /* ================= structured seized-items inventory ================= */

  it('an authorized CID member adds a seized item and can read it back', async () => {
    const add = await lsb.rpc('legal_seized_item_add', {
      p_request: warrantId, p_item: '  Glock 19  ', p_quantity: '1', p_category: 'weapon',
      p_person: personId, p_notes: 'Recovered from the bedroom safe.',
    })
    expect(add.error, add.error?.message).toBeNull()
    seizedId = add.data!.id as string
    expect(add.data).toMatchObject({ legal_request_id: warrantId, item: 'Glock 19', category: 'weapon', quantity: '1', person_id: personId, added_by: ids.lsb })

    const seen = await lsb.from('legal_seized_items').select('id,item,category').eq('id', seizedId).maybeSingle()
    expect(seen.error, seen.error?.message).toBeNull()
    expect(seen.data?.item).toBe('Glock 19')
  })

  it('an invalid category is rejected', async () => {
    const r = await lsb.rpc('legal_seized_item_add', { p_request: warrantId, p_item: 'Mystery box', p_category: 'contraband' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/invalid category/i)
  })

  it('the assigned ADA can READ the seized item (request wall) but can never WRITE one (no case access)', async () => {
    const read = await adaLsb.from('legal_seized_items').select('id,item').eq('id', seizedId).maybeSingle()
    expect(read.error, read.error?.message).toBeNull()
    expect(read.data?.item).toBe('Glock 19')
    const add = await adaLsb.rpc('legal_seized_item_add', { p_request: warrantId, p_item: 'ADA smuggled item' })
    expect(add.error).not.toBeNull()
    const remove = await adaLsb.rpc('legal_seized_item_remove', { p_item: seizedId })
    expect(remove.error).not.toBeNull()
  })

  it('a non-fulfil / anonymous caller can neither read nor write seized items', async () => {
    const read = await anon.from('legal_seized_items').select('id').eq('id', seizedId)
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true)
    expect(read.data ?? []).toHaveLength(0)
    const add = await anon.rpc('legal_seized_item_add', { p_request: warrantId, p_item: 'anon item' })
    expect(add.error).not.toBeNull()
    // direct client writes are denied — there is no write policy
    const direct = await lsb.from('legal_seized_items').insert({ legal_request_id: warrantId, item: 'direct write' }).select('id')
    expect(direct.error).not.toBeNull()
  })

  it('the authorized member removes the seized item', async () => {
    const rm = await lsb.rpc('legal_seized_item_remove', { p_item: seizedId })
    expect(rm.error, rm.error?.message).toBeNull()
    const gone = await lsb.from('legal_seized_items').select('id').eq('id', seizedId)
    expect(gone.data ?? []).toHaveLength(0)
  })
})
