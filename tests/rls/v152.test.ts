/** v152 — Bureau Lead+ legal approval replaces the DOJ/Judge/ADA workflow.
 *
 *  Asserts the 20260808140000_legal_lead_approval contract on the LIVE project
 *  with rls-test accounts:
 *    - a Bureau Lead (command, not the creator) approves a cid_supervisor_review
 *      request straight to `approved` (no DOJ/ADA hop);
 *    - a non-command detective cannot approve;
 *    - the creator cannot approve their own request;
 *    - deny (with a note) → `denied`; return (with a note) → `returned_by_cid`;
 *    - the retired workflow RPCs (review_legal_request_as_ada,
 *      decide_legal_request_as_judge) are EXECUTE-revoked — any authenticated
 *      non-owner call is permission-denied.
 *
 *  Fixtures reused from the CID build: lsb (detective, LSB, the creator),
 *  lead (bureau_lead, LSB — command), bcb (detective, BCB — non-command),
 *  director (SAB director — command). All artifacts are removed by
 *  rls_test_cleanup in afterAll so re-runs start clean. */

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
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director)
if (!enabled) console.warn('[rls:v152] CID fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v152 — Bureau Lead+ legal approval (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C
  const ids: Record<string, string> = {}
  let caseId = ''
  let personId = ''
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()

  // Draft an LSB arrest warrant as the lsb detective, attach one exhibit, and
  // submit it to CID — leaving it in `cid_supervisor_review` (a frozen v1) ready
  // for a command decision. Returns the request id.
  const mkSubmitted = async (title: string) => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `${title} ${tag}`, p_priority: 'High', p_person: personId,
      p_narrative: 'Probable cause narrative for the v152 approval test.',
    })
    expect(r.error).toBeNull()
    const id = r.data!.id as string
    const ex = await lsb.rpc('add_legal_exhibit', { p_request: id, p_type: 'external_link', p_meta: { url: 'https://evidence.example/v152' } })
    expect(ex.error).toBeNull()
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: id })
    expect(sub.error).toBeNull()
    expect(sub.data).toMatchObject({ review_status: 'cid_supervisor_review' })
    return id
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c1 = await lsb.from('cases').insert({ case_number: `V152-${tag}`, title: 'v152 lead-approval case (LSB)', bureau: 'LSB' }).select('id')
    if (c1.error) throw new Error(c1.error.message)
    caseId = c1.data![0].id
    const p = await lsb.from('persons').insert({ name: `V152 Suspect ${tag}` }).select('id')
    if (p.error) throw new Error(p.error.message)
    personId = p.data![0].id
  })

  afterAll(async () => {
    if (!lsb) return
    const { error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    if (personId) {
      const del = await director.from('persons').delete().eq('id', personId)
      if (del.error) console.warn('[rls:v152] person cleanup failed:', del.error.message)
    }
    await Promise.all([lsb, bcb, lead, director].map((c) => c.auth.signOut()))
  })

  it('a Bureau Lead (command, not the creator) approves straight to `approved` — no DOJ/ADA hop', async () => {
    const id = await mkSubmitted('V152 Approve')
    const ok = await lead.rpc('review_legal_request_as_cid', { p_request: id, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(ok.error).toBeNull()
    // terminal at approved; NOT submitted_to_doj, no assigned ADA, still unissued
    expect(ok.data).toMatchObject({
      review_status: 'approved', decision: 'approved',
      decided_by: ids.lead, cid_reviewed_by: ids.lead,
      assigned_ada_id: null, fulfilment_status: 'unissued',
    })
    // the command signature is recorded on the frozen version
    const sigs = await lead.from('legal_request_signatures').select('action,signer_id').eq('legal_request_id', id)
    expect((sigs.data ?? []).some((s) => s.action === 'cid_supervisor_approval' && s.signer_id === ids.lead)).toBe(true)
  })

  it('a non-command detective cannot approve', async () => {
    const id = await mkSubmitted('V152 NonCommand')
    const bad = await bcb.rpc('review_legal_request_as_cid', { p_request: id, p_decision: 'approve' })
    expect(bad.error).not.toBeNull()
    // still awaiting review — a command actor can then decide it
    const still = await lead.from('legal_requests').select('review_status').eq('id', id)
    expect(still.data?.[0]).toMatchObject({ review_status: 'cid_supervisor_review' })
  })

  it('the creator cannot approve their own request', async () => {
    const id = await mkSubmitted('V152 SelfApprove')
    const self = await lsb.rpc('review_legal_request_as_cid', { p_request: id, p_decision: 'approve' })
    expect(self.error).not.toBeNull()
  })

  it('deny (with a note) terminates at `denied`', async () => {
    const id = await mkSubmitted('V152 Deny')
    const noNote = await lead.rpc('review_legal_request_as_cid', { p_request: id, p_decision: 'deny' })
    expect(noNote.error).not.toBeNull() // a denial requires a note
    const deny = await lead.rpc('review_legal_request_as_cid', { p_request: id, p_decision: 'deny', p_note: 'insufficient probable cause' })
    expect(deny.error).toBeNull()
    expect(deny.data).toMatchObject({ review_status: 'denied', decision: 'denied', decided_by: ids.lead })
  })

  it('return (with a note) reopens the draft for the creator', async () => {
    const id = await mkSubmitted('V152 Return')
    const ret = await lead.rpc('review_legal_request_as_cid', { p_request: id, p_decision: 'return', p_note: 'tighten the PC statement' })
    expect(ret.error).toBeNull()
    expect(ret.data).toMatchObject({ review_status: 'returned_by_cid', document_status: 'reopened' })
  })

  it('the retired workflow RPCs are EXECUTE-revoked — any authenticated call is permission-denied', async () => {
    const id = await mkSubmitted('V152 Retired')
    const ada = await lsb.rpc('review_legal_request_as_ada', { p_request: id, p_decision: 'return', p_note: 'x' })
    expect(ada.error).not.toBeNull()
    expect(ada.error?.code).toBe('42501') // permission denied for function
    const judge = await lead.rpc('decide_legal_request_as_judge', { p_request: id, p_decision: 'approve' })
    expect(judge.error).not.toBeNull()
    expect(judge.error?.code).toBe('42501')
    // clean up the parked request via a command decision
    const clean = await lead.rpc('review_legal_request_as_cid', { p_request: id, p_decision: 'deny', p_note: 'v152 teardown' })
    expect(clean.error).toBeNull()
  })
})
