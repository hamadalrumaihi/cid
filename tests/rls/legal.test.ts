/** Legal-request security-wall tests — LIVE project, rls-test accounts.
 *
 *  Reworked for the retired-DOJ / Bureau-Lead+ legal model (migration
 *  20260808140000_legal_lead_approval). Legal-request approval is now a single
 *  Bureau Lead+ decision via review_legal_request_as_cid — there is NO
 *  ADA/DA/AG/Judge stage, no prosecutor bureau routing, and no judicial hop.
 *  The retired workflow RPCs are EXECUTE-revoked and all justice memberships
 *  are inactive; that lockdown is asserted by tests/rls/v152.test.ts and is NOT
 *  re-tested here.
 *
 *  This suite covers the still-live CID-side contract:
 *    - drafting a legal request (create_legal_request) with case-access rules,
 *      draft-ownership, and the direct-write revoke;
 *    - exhibit rules (add_legal_exhibit from accessible sources only);
 *    - submit_legal_request_to_cid → cid_supervisor_review with a frozen,
 *      immutable v1;
 *    - a Bureau Lead+ approval (review_legal_request_as_cid p_decision:'approve')
 *      terminating at `approved` with no ADA/DOJ hop;
 *    - RLS READ visibility of legal_requests + versions/actions/exhibits/
 *      signatures across roles (creator, same-bureau CID command, other-bureau
 *      denial, owner, anon);
 *    - the CID-side fulfilment chain after a Lead+ approval — issue →
 *      execution/expiry (warrant) and service → compliance (subpoena) → close,
 *      gated to can_fulfil_legal;
 *    - sealed-request undiscoverability and hard-delete resistance.
 *
 *  Fixtures reused from the CID build: lsb (detective, LSB — the creator),
 *  bcb (detective, BCB — other-bureau), lead (bureau_lead, LSB — command,
 *  the approver), owner (is_owner — oversight). Every artifact is removed by
 *  rls_test_cleanup in afterAll (+ a director-side person delete), so re-runs
 *  start clean and test actors never notify a real member (server-side
 *  fixture fan-out suppression). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:legal] CID fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('Legal requests — RLS/RPC security wall (Bureau Lead+ model, live)', () => {
  let lsb: C, bcb: C, lead: C, owner: C
  const ids: Record<string, string> = {}
  let caseId = ''       // LSB case owned by the lsb detective
  let personId = ''
  let warrantId = ''    // the end-to-end warrant
  let subpoenaId = ''   // document_production subpoena (fulfilment chain)
  let sealedId = ''     // sealed subpoena
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); owner = mk()
    // Sequential with backoff — parallel password grants trip the per-IP auth
    // rate limit and fail with an empty error.
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    // Purge leftovers from any crashed prior run FIRST — requests and versions
    // would otherwise skew the read-visibility assertions.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c1 = await lsb.from('cases').insert({ case_number: `LGL-${tag}-A`, title: 'Legal RLS case (LSB)', bureau: 'LSB' }).select('id')
    if (c1.error) throw new Error(c1.error.message)
    caseId = c1.data![0].id
    const p = await lsb.from('persons').insert({ name: `RLS Test Suspect ${tag}` }).select('id')
    if (p.error) throw new Error(p.error.message)
    personId = p.data![0].id
  })

  afterAll(async () => {
    if (!lsb) return
    // Run cleanup FIRST (it nulls MDT/legal refs to the fixture person), then
    // delete the person as command (cleanup doesn't cover persons).
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:legal] cleanup:', JSON.stringify(data))
    if (personId) {
      const del = await lead.from('persons').delete().eq('id', personId)
      if (del.error) console.warn('[rls:legal] person cleanup failed:', del.error.message)
    }
    await Promise.all([lsb, bcb, lead, owner].map((c) => c.auth.signOut()))
  })

  /* ================= drafting ================= */

  it('a detective can draft a warrant only on an accessible case; the draft is theirs alone', async () => {
    const deny = await bcb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: 'cross-bureau warrant', p_person: personId,
    })
    expect(deny.error).not.toBeNull()

    const ok = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `RLS Warrant ${tag}`, p_priority: 'High', p_person: personId,
      p_narrative: 'Probable cause narrative for the RLS wall test.',
    })
    expect(ok.error).toBeNull()
    warrantId = ok.data!.id
    expect(ok.data).toMatchObject({ responsible_bureau: 'LSB', classification: 'classified' })

    // another bureau cannot edit the draft, and no client role holds a direct write grant
    const edit = await bcb.rpc('update_legal_draft', { p_request: warrantId, p_title: 'hijack' })
    expect(edit.error).not.toBeNull()
    const direct = await lsb.from('legal_requests').update({ review_status: 'approved' }).eq('id', warrantId).select('id')
    expect(direct.error).not.toBeNull()
  })

  it('exhibits attach only while editable and only from accessible sources', async () => {
    const link = await lsb.rpc('add_legal_exhibit', { p_request: warrantId, p_type: 'external_link', p_meta: { url: 'https://evidence.example/rls' } })
    expect(link.error).toBeNull()
    const foreign = await bcb.rpc('add_legal_exhibit', { p_request: warrantId, p_type: 'external_link', p_meta: { url: 'https://x' } })
    expect(foreign.error).not.toBeNull()
  })

  it('submitted versions freeze: CID submit creates v1, drafts lock, versions are immutable', async () => {
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId })
    expect(sub.error).toBeNull()
    expect(sub.data).toMatchObject({ review_status: 'cid_supervisor_review', document_status: 'finalized' })
    const editAfter = await lsb.rpc('update_legal_draft', { p_request: warrantId, p_title: 'post-submit edit' })
    expect(editAfter.error).not.toBeNull()
    const vs = await lsb.from('legal_request_versions').select('id,version_number').eq('legal_request_id', warrantId)
    expect((vs.data ?? []).length).toBeGreaterThanOrEqual(1)
    const tamper = await lsb.from('legal_request_versions').update({ narrative: 'tampered' }).eq('id', vs.data![0].id).select('id')
    expect(tamper.error).not.toBeNull()
  })

  /* ================= Bureau Lead+ approval + read visibility ================= */

  it('CID supervisor return → creator edits → resubmit; then a Bureau Lead approves straight to `approved` (no DOJ/ADA hop)', async () => {
    const ret = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'return', p_note: 'tighten the PC statement' })
    expect(ret.error).toBeNull()
    expect(ret.data).toMatchObject({ review_status: 'returned_by_cid', document_status: 'reopened' })
    const edit = await lsb.rpc('update_legal_draft', { p_request: warrantId, p_narrative: 'Probable cause narrative, revised per supervisor note.' })
    expect(edit.error).toBeNull()
    const resub = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId })
    expect(resub.error).toBeNull()

    // terminal at `approved`; no assigned ADA, still unissued (fulfilment is a separate step)
    const ok = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({
      review_status: 'approved', decision: 'approved',
      decided_by: ids.lead, assigned_ada_id: null, fulfilment_status: 'unissued',
    })
  })

  it('RLS read visibility of the approved (classified) request holds across roles', async () => {
    // creator sees the request AND its full packet (versions / actions / exhibits / signatures)
    const creatorReq = await lsb.from('legal_requests').select('id').eq('id', warrantId)
    expect(creatorReq.data).toHaveLength(1)
    for (const table of ['legal_request_versions', 'legal_request_actions', 'legal_request_exhibits', 'legal_request_signatures'] as const) {
      const rows = await lsb.from(table).select('id').eq('legal_request_id', warrantId)
      expect(rows.error).toBeNull()
      expect((rows.data ?? []).length).toBeGreaterThanOrEqual(1)
    }
    // same-bureau CID command who reviewed it is a participant → sees it
    const leadReq = await lead.from('legal_requests').select('id').eq('id', warrantId)
    expect(leadReq.data).toHaveLength(1)
    const leadSigs = await lead.from('legal_request_signatures').select('action,signer_id').eq('legal_request_id', warrantId)
    expect((leadSigs.data ?? []).some((s) => s.action === 'cid_supervisor_approval' && s.signer_id === ids.lead)).toBe(true)
    // other-bureau detective (not a participant, classified) sees nothing — row or packet
    const bcbReq = await bcb.from('legal_requests').select('id').eq('id', warrantId)
    expect(bcbReq.data ?? []).toHaveLength(0)
    for (const table of ['legal_request_versions', 'legal_request_actions', 'legal_request_exhibits', 'legal_request_signatures'] as const) {
      const rows = await bcb.from(table).select('id').eq('legal_request_id', warrantId)
      expect(rows.data ?? []).toHaveLength(0)
    }
    // owner oversight sees everything
    const ownReq = await owner.from('legal_requests').select('id').eq('id', warrantId)
    expect(ownReq.data).toHaveLength(1)
    // anonymous clients see nothing
    const anon = mk()
    const anonReq = await anon.from('legal_requests').select('id').eq('id', warrantId)
    expect((anonReq.data ?? []).length).toBe(0)
  })

  /* ================= CID-side fulfilment (warrant) ================= */

  it('issue is CID-side and case-scoped; execution respects expiry; the projection never stays wanted past expiration', async () => {
    // an off-case detective cannot issue
    const foreignIssue = await bcb.rpc('issue_legal_request', { p_request: warrantId })
    expect(foreignIssue.error).not.toBeNull()
    // issue with an already-past expiry to exercise the expiry contract below
    const past = new Date(Date.now() - 60_000).toISOString()
    const issue = await lsb.rpc('issue_legal_request', { p_request: warrantId, p_expires_at: past })
    expect(issue.error).toBeNull()
    expect(issue.data).toMatchObject({ fulfilment_status: 'issued' })
    // an expired warrant cannot be executed
    const exec = await lsb.rpc('record_warrant_execution', { p_request: warrantId, p_outcome: 'arrest made' })
    expect(exec.error).not.toBeNull()
    // MDT: raw row says wanted, the read-time contract says expired
    const cur = await lsb.rpc('mdt_wanted_current')
    const row = (cur.data ?? []).find((x: { legal_request_id: string }) => x.legal_request_id === warrantId)
    expect(row).toBeTruthy()
    expect(row!.effective_status).toBe('expired')
    // record the expiry, file the return, close
    const expd = await lsb.rpc('close_legal_request', { p_request: warrantId, p_outcome: 'expired' })
    expect(expd.error).toBeNull()
    const ret = await lsb.rpc('record_warrant_return', { p_request: warrantId, p_narrative: 'Warrant expired unexecuted; return filed for the record.' })
    expect(ret.error).toBeNull()
    const close = await lsb.rpc('close_legal_request', { p_request: warrantId, p_outcome: 'closed' })
    expect(close.error).toBeNull()
    // closed requests refuse edits
    const edit = await lsb.rpc('update_legal_draft', { p_request: warrantId, p_title: 'zombie edit' })
    expect(edit.error).not.toBeNull()
  })

  /* ================= CID-side fulfilment (subpoena) ================= */

  it('a document subpoena reaches Lead approval, then service + compliance are CID-side and case-scoped', async () => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'document_production',
      p_title: `RLS Subpoena ${tag}`, p_recipient_type: 'entity', p_recipient_name: 'Maze Bank',
      p_narrative: 'Business records needed for the RLS wall test.',
      p_form: { items_requested: 'Ledger extracts', date_range: '2026-01→2026-06' },
    })
    expect(r.error).toBeNull()
    subpoenaId = r.data!.id
    expect(r.data).toMatchObject({ classification: 'restricted' })
    await lsb.rpc('add_legal_exhibit', { p_request: subpoenaId, p_type: 'external_link', p_meta: { url: 'https://x/docs' } })
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: subpoenaId })
    expect(sub.error).toBeNull()
    // subpoenas terminate at Lead+ approval too (no DA/AG route)
    const ap = await lead.rpc('review_legal_request_as_cid', { p_request: subpoenaId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ap.error).toBeNull()
    expect(ap.data).toMatchObject({ review_status: 'approved', assigned_ada_id: null })
    // fulfilment: an off-case detective cannot serve; CID records service + compliance
    const issue = await lsb.rpc('issue_legal_request', { p_request: subpoenaId, p_response_deadline: new Date(Date.now() + 86_400_000).toISOString() })
    expect(issue.error).toBeNull()
    const foreignServe = await bcb.rpc('record_subpoena_service', { p_request: subpoenaId, p_status: 'served' })
    expect(foreignServe.error).not.toBeNull()
    const serve = await lsb.rpc('record_subpoena_service', { p_request: subpoenaId, p_status: 'served', p_method: 'in person' })
    expect(serve.error).toBeNull()
    expect(serve.data).toMatchObject({ fulfilment_status: 'compliance_pending' })
    const comp = await lsb.rpc('record_subpoena_compliance', { p_request: subpoenaId, p_status: 'complete', p_notes: 'records received and logged to the case' })
    expect(comp.error).toBeNull()
    expect(comp.data).toMatchObject({ fulfilment_status: 'records_received', case_id: caseId }) // stays linked to the source case
  })

  /* ================= classification / sealed ================= */

  it('sealed requests are undiscoverable to unauthorized users — table, search, and notifications', async () => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'medical_records',
      p_title: `RLS SEALED ${tag}`, p_recipient_type: 'player', p_person: personId,
      p_narrative: 'sealed medical subpoena.', p_classification: 'sealed',
      p_form: { items_requested: 'Treatment records' },
    })
    expect(r.error).toBeNull()
    sealedId = r.data!.id
    await lsb.rpc('add_legal_exhibit', { p_request: sealedId, p_type: 'external_link', p_meta: { url: 'https://x/sealed' } })
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: sealedId })
    expect(sub.error).toBeNull()

    // invisible to the unrelated detective — row and search both
    const row = await bcb.from('legal_requests').select('id').eq('id', sealedId)
    expect(row.data ?? []).toHaveLength(0)
    const search = await bcb.rpc('legal_search', { q: `RLS SEALED ${tag}` })
    expect((search.data ?? []).length).toBe(0)
    // owner oversight holds
    const own = await owner.from('legal_requests').select('id').eq('id', sealedId)
    expect(own.data).toHaveLength(1)
    // sealed notifications carry no title/number (the LSB lead got the CID-review ping)
    const notif = await lead.from('notifications').select('payload')
      .eq('type', 'legal_request').order('created_at', { ascending: false }).limit(5)
    const sealedPings = (notif.data ?? []).filter((n) => (n.payload as { request_id?: string })?.request_id === sealedId)
    for (const p of sealedPings) {
      const payload = p.payload as Record<string, unknown>
      expect(payload.sealed).toBe(true)
      expect(payload.title).toBeUndefined()
      expect(payload.request_number).toBeUndefined()
    }
  })

  /* ================= retention ================= */

  it('legal records resist deletion — no client role can hard-delete', async () => {
    const del = await lsb.from('legal_requests').delete().eq('id', subpoenaId).select('id')
    expect(del.error).not.toBeNull()
    const delActions = await lsb.from('legal_request_actions').delete().eq('legal_request_id', warrantId).select('id')
    expect(delActions.error).not.toBeNull()
    const delSig = await lead.from('legal_request_signatures').delete().eq('legal_request_id', warrantId).select('id')
    expect(delSig.error).not.toBeNull()
  })

  it('anonymous clients see nothing legal', async () => {
    const anon = mk()
    const a = await anon.from('legal_requests').select('id').limit(1)
    expect((a.data ?? []).length).toBe(0)
  })
})
