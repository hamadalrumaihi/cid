/** v1.86d — Partial approval (Portal Improvements P4-07, migrations
 *  20261024120000_legal_tables + 20261025120000_legal_reroute).
 *
 *  A judge may approve a request for SOME of its targets: each target
 *  (`subject` for the request's person, `exhibit:<id>` for an attached
 *  exhibit) gets its own approved / denied decision with reasoning in
 *  `legal_request_target_decisions`; any denied target makes the request
 *  `partially_approved`, the narrowed scope is frozen into the judicial
 *  version (`form_data._target_decisions`), and CID may still issue it.
 *
 *  What the CID fixtures alone prove (lsb creator, lead approver, bcb outsider):
 *   · the table is RPC-only — no client INSERT / UPDATE / DELETE (42501) —
 *     and the outsider reads 0 rows.
 *  With the judge fixture (rls-test-judge — NOT provisioned, issue #299;
 *  `it.skipIf(!doj)`):
 *   · denying EVERY target is refused ("deny the request instead");
 *   · approve with one denied target → `partially_approved`, decided_by the
 *     judge, expires_at defaulted from legal_expiry_defaults, target rows
 *     readable by the creator, the judicial version carrying the scope;
 *   · `issue_legal_request` succeeds for the creator on a partially approved
 *     request; `withdraw_legal_request` is refused as already decided.
 *
 *  Safety: fixture-created case / person / request only; rls_test_cleanup in
 *  afterAll (it nulls the MDT/legal refs before the lead deletes the person). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB, bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD, judge: process.env.RLS_TEST_PASSWORD_JUDGE,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v186d] fixture passwords not set — suite skipped')
const doj = enabled && !!PW.judge
if (enabled && !doj) console.warn('[rls:v186d] RLS_TEST_PASSWORD_JUDGE not set — judicial legs skipped (DOJ fixtures: issue #299)')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Req = { review_status: string; decision: string | null; decided_by: string | null; expires_at: string | null; current_version_id: string | null }

const DAY = 86_400_000

describe.skipIf(!enabled)('v1.86d — partial approval: per-target judicial decisions, frozen scope, still issuable', () => {
  let lsb: C, bcb: C, lead: C
  let judge: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v186d ${tag}`
  let caseId = '', personId = '', requestId = ''
  let exhibitA = '', exhibitB = ''

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
    ]
    if (doj) { judge = mk(); logins.push([judge, 'rls-test-judge@cidportal.test', PW.judge!, 'judge']) }
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c = await lsb.from('cases').insert({ case_number: `V186D-${tag}`, title: `${stamp} partial approval case`, bureau: 'major_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
    const p = await lsb.from('persons').insert({ name: `RLS Test Suspect ${tag}` }).select('id').single()
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data!.id

    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `${stamp} two-target warrant`, p_person: personId,
      p_narrative: 'Narrative for the v186d partial-approval wall test.',
      p_form: { standard_of_proof: 'probable_cause', pc_statement: 'Both the subject and the storage unit are tied to the sale.' },
    })
    if (r.error) throw new Error(`create_legal_request failed: ${r.error.message}`)
    requestId = r.data!.id
    for (const [key, url] of [['A', 'unit-12'], ['B', 'vehicle-cam']] as const) {
      const ex = await lsb.rpc('add_legal_exhibit', { p_request: requestId, p_type: 'external_link', p_meta: { url: `https://evidence.example/v186d/${tag}/${url}` }, p_rationale: `${stamp} ${url}` })
      if (ex.error) throw new Error(`add_legal_exhibit failed: ${ex.error.message}`)
      const id = (ex.data as { id: string }).id
      if (key === 'A') exhibitA = id; else exhibitB = id
    }
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: requestId })
    if (sub.error) throw new Error(`submit failed: ${sub.error.message}`)
    const ap = await lead.rpc('review_legal_request_as_cid', { p_request: requestId, p_decision: 'approve', p_signature: 'RLS Lead' })
    if (ap.error) throw new Error(`approve failed: ${ap.error.message}`)
    if ((ap.data as Req).review_status !== 'submitted_to_judge') throw new Error(`expected submitted_to_judge, got ${(ap.data as Req).review_status}`)
  }, 120_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v186d] cleanup:', JSON.stringify(data))
    if (personId) {
      const del = await lead.from('persons').delete().eq('id', personId)
      if (del.error) console.warn('[rls:v186d] person cleanup failed:', del.error.message)
    }
    await Promise.all([lsb, bcb, lead, judge].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ CID-only: the table is RPC-only ============ */

  it('legal_request_target_decisions has no client write; the outsider reads 0 rows', async () => {
    const ins = await lsb.from('legal_request_target_decisions').insert({
      legal_request_id: requestId, target_key: 'subject', decision: 'approved',
    }).select('id')
    expect(ins.error?.code).toBe('42501')
    const upd = await lsb.from('legal_request_target_decisions').update({ decision: 'approved' }).eq('legal_request_id', requestId).select('id')
    expect(upd.error?.code).toBe('42501')
    const del = await lsb.from('legal_request_target_decisions').delete().eq('legal_request_id', requestId).select('id')
    expect(del.error?.code).toBe('42501')
    // Reads are policy-scoped, never an error.
    const outsider = await bcb.from('legal_request_target_decisions').select('id').eq('legal_request_id', requestId)
    expect(outsider.error).toBeNull()
    expect(outsider.data ?? []).toEqual([])
    // The creator's own read is empty too — nothing has been decided.
    expect((await lsb.from('legal_request_target_decisions').select('id').eq('legal_request_id', requestId)).data ?? []).toEqual([])
  })

  it('a CID actor cannot decide anything: decide_legal_request_as_judge with target decisions is refused', async () => {
    const res = await lead.rpc('decide_legal_request_as_judge', {
      p_request: requestId, p_decision: 'approve', p_note: 'not a judge',
      p_target_decisions: [{ target_key: 'subject', exhibit_id: null, decision: 'approved', reasoning: 'x' }],
    })
    expect(res.error).not.toBeNull()
    expect((await lsb.from('legal_requests').select('review_status').eq('id', requestId).single()).data).toMatchObject({ review_status: 'submitted_to_judge' })
  })

  /* ============ judicial legs (DOJ fixtures — issue #299) ============ */

  it.skipIf(!doj)('denying every target is refused — the judge must deny the request instead', async () => {
    const claim = await judge!.rpc('claim_legal_request_as_judge', { p_request: requestId })
    expect(claim.error, claim.error?.message).toBeNull()
    expect(claim.data).toMatchObject({ review_status: 'judicial_review', assigned_judge_id: ids.judge })

    const allDenied = await judge!.rpc('decide_legal_request_as_judge', {
      p_request: requestId, p_decision: 'approve', p_note: 'Nothing here holds.',
      p_target_decisions: [
        { target_key: 'subject', exhibit_id: null, decision: 'denied', reasoning: 'no nexus' },
        { target_key: `exhibit:${exhibitA}`, exhibit_id: exhibitA, decision: 'denied', reasoning: 'stale' },
        { target_key: `exhibit:${exhibitB}`, exhibit_id: exhibitB, decision: 'denied', reasoning: 'stale' },
      ],
    })
    expect(allDenied.error).not.toBeNull()
    expect(allDenied.error!.message).toMatch(/deny the request instead/i)
    expect((await lsb.from('legal_request_target_decisions').select('id').eq('legal_request_id', requestId)).data ?? []).toEqual([])
    expect((await lsb.from('legal_requests').select('review_status').eq('id', requestId).single()).data).toMatchObject({ review_status: 'judicial_review' })
  })

  it.skipIf(!doj)('approve with one denied target → partially_approved; rows, frozen scope and a defaulted expiry', async () => {
    const before = Date.now()
    const ok = await judge!.rpc('decide_legal_request_as_judge', {
      p_request: requestId, p_decision: 'approve',
      p_note: 'Probable cause holds for the subject and the storage unit; the vehicle footage is uncorroborated.',
      p_conditions: 'Daylight service only.', p_signature: 'RLS Judge',
      p_target_decisions: [
        { target_key: 'subject', exhibit_id: null, decision: 'approved', reasoning: 'Direct observation of the sale.' },
        { target_key: `exhibit:${exhibitA}`, exhibit_id: exhibitA, decision: 'approved', reasoning: 'Lease in the subject\'s name.' },
        { target_key: `exhibit:${exhibitB}`, exhibit_id: exhibitB, decision: 'denied', reasoning: 'No chain of custody for the footage.' },
      ],
    })
    expect(ok.error, ok.error?.message).toBeNull()
    const row = ok.data as Req
    expect(row).toMatchObject({ review_status: 'partially_approved', decided_by: ids.judge })
    expect(row.decision).toBeTruthy()
    // arrest_warrant default = 30 days (legal_expiry_defaults) when the judge sets none.
    expect(row.expires_at).toBeTruthy()
    const exp = Date.parse(row.expires_at!)
    expect(exp).toBeGreaterThan(before + 29 * DAY)
    expect(exp).toBeLessThan(before + 31 * DAY)

    const decisions = await lsb.from('legal_request_target_decisions').select('target_key, exhibit_id, decision, reasoning, decided_by, version_id').eq('legal_request_id', requestId).order('target_key')
    expect(decisions.error).toBeNull()
    expect(decisions.data).toHaveLength(3)
    expect(decisions.data!.map((d) => [d.target_key, d.decision])).toEqual([
      [`exhibit:${exhibitA}`, 'approved'], [`exhibit:${exhibitB}`, 'denied'], ['subject', 'approved'],
    ].sort((a, b) => a[0].localeCompare(b[0])))
    expect(decisions.data!.every((d) => d.decided_by === ids.judge && d.version_id === row.current_version_id)).toBe(true)
    // The judicial version froze the narrowed scope.
    const v = await lsb.from('legal_request_versions').select('form_data').eq('id', row.current_version_id!).single()
    expect(v.error).toBeNull()
    const scope = (v.data!.form_data as { _target_decisions?: { target_key: string; decision: string }[] })._target_decisions
    expect(Array.isArray(scope)).toBe(true)
    expect(scope!.find((t) => t.target_key === `exhibit:${exhibitB}`)?.decision).toBe('denied')
    const acts = await lsb.from('legal_request_actions').select('action').eq('legal_request_id', requestId)
    expect((acts.data ?? []).map((a) => a.action)).toContain('partially_approved')
    // Still policy-scoped: the outsider reads none of it.
    expect((await bcb.from('legal_request_target_decisions').select('id').eq('legal_request_id', requestId)).data ?? []).toEqual([])
  })

  it.skipIf(!doj)('a partially approved request is issuable by the creator and can no longer be withdrawn', async () => {
    const wd = await lsb.rpc('withdraw_legal_request', { p_request: requestId, p_note: `${stamp} too late` })
    expect(wd.error).not.toBeNull()
    expect(wd.error!.message).toMatch(/decided|terminal|cannot be withdrawn/i)

    const foreign = await bcb.rpc('issue_legal_request', { p_request: requestId })
    expect(foreign.error).not.toBeNull()
    const asJudge = await judge!.rpc('issue_legal_request', { p_request: requestId })
    expect(asJudge.error).not.toBeNull()
    expect(asJudge.error!.message).toMatch(/only an authorized CID member/i)

    const issue = await lsb.rpc('issue_legal_request', { p_request: requestId })
    expect(issue.error, issue.error?.message).toBeNull()
    expect(issue.data).toMatchObject({ fulfilment_status: 'issued', review_status: 'partially_approved' })
    expect((issue.data as { issued_by: string }).issued_by).toBe(ids.lsb)
  })
})
