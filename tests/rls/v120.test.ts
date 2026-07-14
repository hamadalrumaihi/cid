/** v1.20 — Warrant lifecycle integrity (Sprint 1B) — LIVE project, rls-test accounts.
 *
 *  Pins the contract of migration 20260722010000 for warrant_set_status:
 *   - `signed` requires command OR a legal request linked to the report
 *     (source_report_id) with review_status='approved' — a detective can no
 *     longer sign their own warrant.
 *   - Ordering is forward-only: draft → signed → executed → returned. `executed`
 *     cannot precede `signed`; `returned` cannot precede `executed`.
 *   - The one backward transition — revert to draft — is command-only and is
 *     audited with authority='override'.
 *   - SELECT ... FOR UPDATE + post-lock revalidation: of two concurrent
 *     transitions exactly one applies; the loser (including a stale same-status
 *     retry, previously a silent no-op) gets a P0001 "reload and retry".
 *   - _warrant_log entries now carry `authority` (command | legal_approved |
 *     override) so the basis of a signature is structural.
 *
 *  Fixtures (tests/rls/README.md): lsb (LSB detective, case owner), lead (LSB
 *  bureau_lead = command), director (command; two clients for the concurrency
 *  race), da / adaLsb / judge for the legal-approval positive path. Same
 *  conventions as the sibling suites; rls_test_cleanup at start + teardown;
 *  the registry person is removed director-side in teardown. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  da: process.env.RLS_TEST_PASSWORD_DA,
  adaLsb: process.env.RLS_TEST_PASSWORD_ADA_LSB,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.director && PW.da && PW.adaLsb && PW.judge)
if (!enabled) console.warn('[rls:v120] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

interface LogEntry { at: string; by: string; by_id: string; from: string; to: string; authority?: string }
const logOf = (r: { fields: unknown }): LogEntry[] =>
  (((r.fields ?? {}) as Record<string, unknown>)._warrant_log ?? []) as LogEntry[]
const statusOf = (r: { fields: unknown }): string =>
  String(((r.fields ?? {}) as Record<string, unknown>)._warrant_status ?? 'draft')

describe.skipIf(!enabled)('v1.20 — warrant lifecycle: signing authority, ordering, conflicts (live)', () => {
  let lsb: C, lead: C, director: C, director2: C, da: C, adaLsb: C, judge: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let personId = ''
  let w1 = '' // walks the full ordered lifecycle

  let n = 0
  const newWarrant = async (): Promise<string> => {
    const r = await lsb.from('reports')
      .insert({ case_id: caseId, template: 'arrest_warrant', fields: { warrant_title: `V120-${tag}-${++n}` } })
      .select('id')
    if (r.error) throw new Error(`warrant report create failed: ${r.error.message}`)
    return r.data![0].id as string
  }

  beforeAll(async () => {
    lsb = mk(); lead = mk(); director = mk(); director2 = mk(); da = mk(); adaLsb = mk(); judge = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [director2, 'rls-test-director@cidportal.test', PW.director, 'director2'],
      [da, 'rls-test-da@cidportal.test', PW.da, 'da'],
      [adaLsb, 'rls-test-ada-lsb@cidportal.test', PW.adaLsb, 'adaLsb'],
      [judge, 'rls-test-judge@cidportal.test', PW.judge, 'judge'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c = await lsb.from('cases')
      .insert({ case_number: `V120-${tag}`, title: 'v1.20 warrant lifecycle case (LSB)', bureau: 'LSB' })
      .select('id')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id
    const p = await lsb.from('persons').insert({ name: `RLS V120 Subject ${tag}` }).select('id')
    if (p.error) throw new Error(p.error.message)
    personId = p.data![0].id
    // Cover LSB with a primary ADA so a CID approval auto-routes to `adaLsb`.
    const cov = await da.rpc('set_primary_ada', { p_prosecutor: ids.adaLsb, p_bureau: 'LSB' })
    if (cov.error) throw new Error(`ADA coverage setup failed: ${cov.error.message}`)
  })

  afterAll(async () => {
    if (!lsb) return
    const { error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    if (personId) await director.from('persons').delete().eq('id', personId)
    await Promise.all([lsb, lead, director, director2, da, adaLsb, judge].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('a non-warrant report is rejected (regression)', async () => {
    const r = await lsb.from('reports').insert({ case_id: caseId, template: 'initial', fields: {} }).select('id')
    expect(r.error).toBeNull()
    const res = await director.rpc('warrant_set_status', { p_report: r.data![0].id, p_status: 'signed' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/not a warrant report/i)
  })

  it('the case owner (non-command, no approved legal request) can NOT mark their warrant signed', async () => {
    w1 = await newWarrant()
    const res = await lsb.rpc('warrant_set_status', { p_report: w1, p_status: 'signed' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/command authority or an approved legal request/i)
  })

  it('executed cannot precede signed — even for command (P0001)', async () => {
    const res = await director.rpc('warrant_set_status', { p_report: w1, p_status: 'executed' })
    expect(res.error).not.toBeNull()
    expect(res.error!.code).toBe('P0001')
    expect(res.error!.message).toMatch(/cannot be executed before it is signed/i)
  })

  it('command may sign; the log entry is authority=command with a real actor id', async () => {
    const res = await director.rpc('warrant_set_status', { p_report: w1, p_status: 'signed' })
    expect(res.error).toBeNull()
    expect(statusOf(res.data!)).toBe('signed')
    const last = logOf(res.data!).at(-1)!
    expect(last).toMatchObject({ by_id: ids.director, from: 'draft', to: 'signed', authority: 'command' })
  })

  it('returned cannot precede executed (P0001)', async () => {
    const res = await director.rpc('warrant_set_status', { p_report: w1, p_status: 'returned' })
    expect(res.error).not.toBeNull()
    expect(res.error!.code).toBe('P0001')
    expect(res.error!.message).toMatch(/cannot be returned before it is executed/i)
  })

  it('the ordered chain works for the case-access owner: signed → executed → returned', async () => {
    const ex = await lsb.rpc('warrant_set_status', { p_report: w1, p_status: 'executed' })
    expect(ex.error).toBeNull()
    const ret = await lsb.rpc('warrant_set_status', { p_report: w1, p_status: 'returned' })
    expect(ret.error).toBeNull()
    expect(statusOf(ret.data!)).toBe('returned')
    expect(logOf(ret.data!).map((e) => e.to)).toEqual(['signed', 'executed', 'returned'])
  })

  it('a non-command member cannot revert to draft', async () => {
    const res = await lsb.rpc('warrant_set_status', { p_report: w1, p_status: 'draft' })
    expect(res.error).not.toBeNull()
    expect(res.error!.message).toMatch(/only command can revert/i)
  })

  it('command may revert to draft; audited as authority=override', async () => {
    const res = await director.rpc('warrant_set_status', { p_report: w1, p_status: 'draft' })
    expect(res.error).toBeNull()
    expect(statusOf(res.data!)).toBe('draft')
    const last = logOf(res.data!).at(-1)!
    expect(last).toMatchObject({ by_id: ids.director, from: 'returned', to: 'draft', authority: 'override' })
  })

  it('two concurrent signings: exactly one succeeds, the loser gets a P0001 conflict, one log entry', async () => {
    const w2 = await newWarrant()
    const [a, b] = await Promise.all([
      director.rpc('warrant_set_status', { p_report: w2, p_status: 'signed' }),
      director2.rpc('warrant_set_status', { p_report: w2, p_status: 'signed' }),
    ])
    const oks = [a, b].filter((r) => !r.error)
    const errs = [a, b].filter((r) => r.error)
    expect(oks).toHaveLength(1)
    expect(errs).toHaveLength(1)
    expect(errs[0].error!.code).toBe('P0001')
    expect(errs[0].error!.message).toMatch(/reload and retry/i)
    const cur = await lsb.from('reports').select('fields').eq('id', w2).single()
    expect(statusOf(cur.data!)).toBe('signed')
    expect(logOf(cur.data!).filter((e) => e.to === 'signed')).toHaveLength(1)
  })

  it('an APPROVED linked legal request lets the (non-command) owner sign; audited as authority=legal_approved', async () => {
    const w3 = await newWarrant()
    // Drive the real judicial pipeline to review_status='approved'.
    const lr = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `V120 warrant ${tag}`, p_priority: 'High', p_person: personId,
      p_narrative: 'Probable cause narrative for the v120 lifecycle test.',
      p_source_report: w3,
    })
    expect(lr.error).toBeNull()
    const reqId = lr.data!.id as string
    // A merely-drafted legal request is NOT enough to sign.
    const early = await lsb.rpc('warrant_set_status', { p_report: w3, p_status: 'signed' })
    expect(early.error).not.toBeNull()
    expect(early.error!.message).toMatch(/command authority or an approved legal request/i)

    const ex = await lsb.rpc('add_legal_exhibit', { p_request: reqId, p_type: 'external_link', p_meta: { url: 'https://evidence.example/v120' } })
    expect(ex.error).toBeNull()
    const fin = await lsb.rpc('report_finalize', { p_report: w3 }) // DOJ submission requires a finalized source report
    expect(fin.error).toBeNull()
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: reqId })
    expect(sub.error).toBeNull()
    const cid = await lead.rpc('review_legal_request_as_cid', { p_request: reqId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(cid.error).toBeNull() // auto-routes to the LSB primary ADA
    const toJudge = await adaLsb.rpc('review_legal_request_as_ada', { p_request: reqId, p_decision: 'submit_to_judge', p_signature: 'RLS ADA' })
    expect(toJudge.error).toBeNull()
    const asg = await adaLsb.rpc('assign_judge', { p_request: reqId, p_judge: ids.judge })
    expect(asg.error).toBeNull()
    const dec = await judge.rpc('decide_legal_request_as_judge', {
      p_request: reqId, p_decision: 'approve', p_note: 'Approved for the v120 lifecycle test',
      p_expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(), p_signature: 'RLS Judge',
    })
    expect(dec.error).toBeNull()
    expect(dec.data).toMatchObject({ review_status: 'approved' })

    const res = await lsb.rpc('warrant_set_status', { p_report: w3, p_status: 'signed' })
    expect(res.error).toBeNull()
    expect(statusOf(res.data!)).toBe('signed')
    const last = logOf(res.data!).at(-1)!
    expect(last).toMatchObject({ by_id: ids.lsb, from: 'draft', to: 'signed', authority: 'legal_approved' })
  })
})
