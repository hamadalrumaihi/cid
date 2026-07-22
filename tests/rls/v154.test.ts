/** v1.54 — warrant execution + seized-items completion (Phase 3,
 *  migration 20260808180000_warrant_execution_completion).
 *
 *  Drives one warrant to 'issued' via the POST-Phase-1 approval path (submit to
 *  CID → Bureau Lead+ approve → issue; the DOJ/ADA/judge chain is retired) and
 *  then exercises the custody-grade upgrades:
 *   - record_warrant_execution now REQUIRES an incident number AND ≥1 executing
 *     officer (each a known profile) for EVERY result — a missing incident
 *     number or empty officer list is rejected and leaves the warrant issued.
 *   - an 'unable' execution records the failed attempt, keeps the warrant
 *     'issued', and auto-opens a follow-up case_task on the case.
 *   - a 'full' execution advances to 'executed', stores incident/officers, and
 *     auto-seeds a warrant-return REPORT DRAFT (finalized=false) linked via
 *     legal_requests.return_report_id.
 *   - legal_seized_item_add accepts the new custody fields (evidence bag,
 *     storage location, disposition); legal_seized_item_remove is now a SOFT
 *     strike (row stays visible with removed_at set — NOT deleted);
 *     legal_seized_item_set_disposition updates disposition.
 *   - an outsider (anon) can neither read nor write, and the table stays
 *     SELECT-only (a direct client INSERT is refused).
 *
 *  Fixtures: lsb (active detective, case creator = the fulfiller), lead (LSB
 *  bureau_lead = the Lead+ approver), owner (oversight/teardown), anon (denied).
 *  Post-Phase-1 the seized-item read policy (private.can_view_legal_request) no
 *  longer admits a packet-only ADA — warrants never reach DOJ and justice
 *  memberships are deactivated — so the former "ADA reads but cannot write"
 *  probe is retired; the outsider is now simply denied on read and write. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:v154] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.54 — warrant execution + seized-items completion (live)', () => {
  let lsb: C, lead: C, owner: C, anon: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let personId = ''
  let warrantId = ''
  let seizedId = ''
  let otherReportId = ''

  beforeAll(async () => {
    lsb = mk(); lead = mk(); owner = mk(); anon = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c = await lsb.from('cases').insert({ case_number: `V154-${tag}`, title: `[rls-test] v154 execution case ${tag}`, bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id as string
    const p = await lsb.from('persons').insert({ name: `RLS Test V154 Suspect ${tag}` }).select('id')
    if (p.error) throw new Error(p.error.message)
    personId = p.data![0].id as string

    // A SECOND LSB case + report, used to prove a cross-case custody link is
    // refused. lsb can fulfil the warrant AND access this other case, so only
    // the case-scope guard (not the fulfil gate) can reject the link.
    const oc = await lsb.from('cases').insert({ case_number: `V154X-${tag}`, title: `[rls-test] v154 other case ${tag}`, bureau: 'LSB' }).select('id')
    if (oc.error) throw new Error(oc.error.message)
    const orep = await lsb.from('reports').insert({ case_id: oc.data![0].id as string, template: 'note' }).select('id')
    if (orep.error) throw new Error(orep.error.message)
    otherReportId = orep.data![0].id as string

    // Drive a warrant to 'issued' via the post-Phase-1 path: create → submit to
    // CID → Bureau Lead+ approve → issue. No expiry set (execution allowed).
    const draft = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `RLS V154 Warrant ${tag}`, p_priority: 'High', p_person: personId,
      p_narrative: 'Probable cause narrative for the v154 execution test.',
    })
    if (draft.error) throw new Error(`create_legal_request failed: ${draft.error.message}`)
    warrantId = draft.data!.id as string
    await lsb.rpc('add_legal_exhibit', { p_request: warrantId, p_type: 'external_link', p_meta: { url: 'https://evidence.example/v154' } })
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: warrantId })
    if (sub.error) throw new Error(`submit_to_cid failed: ${sub.error.message}`)
    const appr = await lead.rpc('review_legal_request_as_cid', { p_request: warrantId, p_decision: 'approve', p_signature: 'RLS Lead' })
    if (appr.error) throw new Error(`Lead+ approve failed: ${appr.error.message}`)
    const issue = await lsb.rpc('issue_legal_request', { p_request: warrantId })
    if (issue.error) throw new Error(`issue failed: ${issue.error.message}`)
    if (issue.data?.fulfilment_status !== 'issued') throw new Error(`warrant not issued: ${JSON.stringify(issue.data)}`)
  })

  afterAll(async () => {
    if (!lsb) return
    const { error } = await lsb.rpc('rls_test_cleanup')
    if (error) console.warn('[rls:v154] rls_test_cleanup failed:', error.message)
    if (personId) {
      try { await owner.from('persons').delete().eq('id', personId) } catch { /* best effort */ }
    }
    await Promise.all([lsb, lead, owner, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ================= structured execution: required fields ================= */

  it('record_warrant_execution now REQUIRES an incident number', async () => {
    const r = await lsb.rpc('record_warrant_execution', {
      p_request: warrantId, p_incident_number: '   ', p_officers: [ids.lsb],
      p_outcome: 'Search completed.', p_result: 'full',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/incident number is required/i)
    const row = await lsb.from('legal_requests').select('fulfilment_status').eq('id', warrantId).maybeSingle()
    expect(row.data?.fulfilment_status).toBe('issued')
  })

  it('record_warrant_execution now REQUIRES at least one executing officer', async () => {
    const r = await lsb.rpc('record_warrant_execution', {
      p_request: warrantId, p_incident_number: `INC-${tag}`, p_officers: [],
      p_outcome: 'Search completed.', p_result: 'full',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/executing officer is required/i)
    const row = await lsb.from('legal_requests').select('fulfilment_status').eq('id', warrantId).maybeSingle()
    expect(row.data?.fulfilment_status).toBe('issued')
  })

  it('an officer that is not a known profile is rejected', async () => {
    const r = await lsb.rpc('record_warrant_execution', {
      p_request: warrantId, p_incident_number: `INC-${tag}`,
      p_officers: ['00000000-0000-0000-0000-000000000000'],
      p_outcome: 'Search completed.', p_result: 'full',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/known profile/i)
  })

  it('only an authorized CID member on the case may record execution', async () => {
    const anonr = await anon.rpc('record_warrant_execution', {
      p_request: warrantId, p_incident_number: `INC-${tag}`, p_officers: [ids.lsb], p_outcome: 'x', p_result: 'full',
    })
    expect(anonr.error).not.toBeNull()
  })

  /* ================= automation: unable → follow-up task ================= */

  it("'unable' records the failed attempt, keeps the warrant issued, and opens a follow-up case_task", async () => {
    const r = await lsb.rpc('record_warrant_execution', {
      p_request: warrantId, p_incident_number: `INC-${tag}-A`, p_officers: [ids.lsb],
      p_outcome: 'Premises found vacant; target not located.', p_result: 'unable',
    })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ fulfilment_status: 'issued', execution_result: 'unable' })
    expect(r.data!.execution_incident_number).toBe(`INC-${tag}-A`)
    expect(Array.isArray(r.data!.execution_officers)).toBe(true)
    expect(r.data!.executed_at).toBeNull()

    const tasks = await lsb.from('case_tasks').select('id,title,done').eq('case_id', caseId)
    expect(tasks.error, tasks.error?.message).toBeNull()
    expect((tasks.data ?? []).some((t) => /unable to execute/i.test(t.title))).toBe(true)
  })

  /* ================= automation: full → executed + return report draft ==== */

  it("'full' execution stores incident/officers and seeds a warrant-return report draft", async () => {
    const r = await lsb.rpc('record_warrant_execution', {
      p_request: warrantId, p_incident_number: `INC-${tag}-B`, p_officers: [ids.lsb],
      p_outcome: 'Search completed; items seized.', p_result: 'full', p_notes: 'Executed at 0600.',
    })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ fulfilment_status: 'executed', execution_result: 'full', executed_by: ids.lsb })
    expect(r.data!.execution_incident_number).toBe(`INC-${tag}-B`)
    expect(r.data!.executed_at).not.toBeNull()
    expect(r.data!.return_report_id).toBeTruthy()

    const rep = await lsb.from('reports').select('id,template,kind,finalized').eq('id', r.data!.return_report_id).maybeSingle()
    expect(rep.error, rep.error?.message).toBeNull()
    expect(rep.data).toMatchObject({ template: 'warrant_return', finalized: false })
  })

  /* ================= custody-grade seized items ================= */

  it('an authorized CID member adds a seized item with custody fields', async () => {
    const add = await lsb.rpc('legal_seized_item_add', {
      p_request: warrantId, p_item: '  Glock 19  ', p_quantity: '1', p_category: 'weapon',
      p_person: personId, p_notes: 'Recovered from the bedroom safe.',
      p_evidence_bag: 'BAG-0007', p_storage_location: 'Locker 3B', p_disposition: 'held',
    })
    expect(add.error, add.error?.message).toBeNull()
    seizedId = add.data!.id as string
    expect(add.data).toMatchObject({
      legal_request_id: warrantId, item: 'Glock 19', category: 'weapon', quantity: '1',
      person_id: personId, added_by: ids.lsb, evidence_bag: 'BAG-0007', storage_location: 'Locker 3B',
      disposition: 'held',
    })
  })

  it('an invalid disposition is rejected on add', async () => {
    const r = await lsb.rpc('legal_seized_item_add', { p_request: warrantId, p_item: 'Mystery box', p_disposition: 'vaporized' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/invalid disposition/i)
  })

  it('a seized-item report link from another case is refused (custody-chain scoping)', async () => {
    const r = await lsb.rpc('legal_seized_item_add', {
      p_request: warrantId, p_item: 'Cross-case link probe', p_report: otherReportId,
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/must belong to this warrant/i)
  })

  it('set_disposition updates a seized item disposition', async () => {
    const r = await lsb.rpc('legal_seized_item_set_disposition', { p_item: seizedId, p_disposition: 'forfeited', p_note: 'Court-ordered forfeiture.' })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ id: seizedId, disposition: 'forfeited' })
    const r2 = await lsb.rpc('legal_seized_item_set_disposition', { p_item: seizedId, p_disposition: 'bogus' })
    expect(r2.error).not.toBeNull()
  })

  it('an outsider (anon) can neither read nor write seized items, and the table is SELECT-only', async () => {
    const read = await anon.from('legal_seized_items').select('id').eq('id', seizedId)
    expect(read.data ?? []).toHaveLength(0)
    const add = await anon.rpc('legal_seized_item_add', { p_request: warrantId, p_item: 'anon item' })
    expect(add.error).not.toBeNull()
    // The table carries no client write policy — even a case member cannot INSERT
    // directly; every write must flow through the SECURITY DEFINER RPCs.
    const direct = await lsb.from('legal_seized_items').insert({ legal_request_id: warrantId, item: 'direct write' }).select('id')
    expect(direct.error).not.toBeNull()
  })

  /* ================= soft strike (correction, not deletion) ================= */

  it('remove now SOFT-strikes: the row stays visible with removed_at set (a reason is required)', async () => {
    const missing = await lsb.rpc('legal_seized_item_remove', { p_item: seizedId, p_reason: '   ' })
    expect(missing.error).not.toBeNull()
    expect(missing.error!.message).toMatch(/reason is required/i)

    const rm = await lsb.rpc('legal_seized_item_remove', { p_item: seizedId, p_reason: 'Logged in error — duplicate of BAG-0006.' })
    expect(rm.error, rm.error?.message).toBeNull()
    expect(rm.data).toMatchObject({ id: seizedId, removed_by: ids.lsb })
    expect(rm.data!.removed_at).not.toBeNull()

    // Still present (NOT deleted) — the custody chain keeps the struck row.
    const still = await lsb.from('legal_seized_items').select('id,removed_at,removal_reason').eq('id', seizedId).maybeSingle()
    expect(still.error, still.error?.message).toBeNull()
    expect(still.data?.id).toBe(seizedId)
    expect(still.data?.removed_at).not.toBeNull()
    expect(still.data?.removal_reason).toMatch(/duplicate/i)
  })
})
