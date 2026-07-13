/** v1.14 security-wall tests — LIVE project, rls-test accounts.
 *
 *  Covers the three v1.14 surfaces:
 *   - report_versions: report_finalize() snapshots, immutability (no client
 *     UPDATE/DELETE for anyone, owner included), bureau-scoped reads, and the
 *     reopen → refinalize → v2 cycle.
 *   - search_all 'legal' kind: SECURITY INVOKER means legal hits follow the
 *     caller's legal_requests SELECT policy — creators find their requests,
 *     strangers get nothing, sealed requests stay undiscoverable.
 *   - security testing RPCs: security_test_report() (fixture-only writer)
 *     and owner_security_overview() (is_owner()-gated reader).
 *
 *  Fixtures reused (tests/rls/README.md): lsb/bcb detectives, lead (LSB
 *  bureau_lead), owner. Same conventions as rls.test.ts / legal.test.ts:
 *  sequential sign-ins with backoff, rls_test_cleanup() at suite start and
 *  teardown, and every created row authored by a test account so cleanup
 *  catches it. security_test_runs rows have no client deletion path by
 *  design — the suite reports under one constant suite name, so the server's
 *  50-run-per-suite retention caps any accumulation. */

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
if (!enabled) console.warn('[rls:v114] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

/** Constant suite name for the self-reported test run (retention-capped). */
const REPORT_SUITE = 'v114 rls self-test'

interface SearchHit { kind: string; id: string; label: string; sublabel: string }
const legalHits = (rows: unknown): SearchHit[] =>
  ((rows ?? []) as SearchHit[]).filter((h) => h.kind === 'legal')

describe.skipIf(!enabled)('v1.14 — report versions, legal search, security dashboard (live)', () => {
  let lsb: C, bcb: C, lead: C, owner: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let reportId = ''
  let versionId = ''
  let requestId = ''
  let requestNumber = ''
  let sealedId = ''
  const sealedTitle = `RLS V114 SEALED ${tag}`

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); owner = mk()
    // Sequential with backoff — parallel password grants trip the per-IP
    // auth rate limit (see tests/rls/auth.ts).
    for (const [client, email, pw] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb],
      [lead, 'rls-test-lead@cidportal.test', PW.lead],
      [owner, 'rls-test-owner@cidportal.test', PW.owner],
    ] as const) {
      await signInWithRetry(client, email, pw!)
    }
    // Purge leftovers from any crashed prior run first.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c = await lsb.from('cases')
      .insert({ case_number: `V114-${tag}`, title: 'v1.14 RLS case (LSB)', bureau: 'LSB' })
      .select('id')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id
  })

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v114] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, owner].map((c2) => c2.auth.signOut()))
  })

  /* ================= report_versions ================= */

  it('report_finalize seals the report AND writes an immutable v1 snapshot', async () => {
    const ins = await lsb.from('reports')
      .insert({ case_id: caseId, template: 'initial', kind: 'initial', seq: 1, fields: { summary: `v114 snapshot ${tag}` } })
      .select('id')
    expect(ins.error).toBeNull()
    reportId = ins.data![0].id

    const fin = await lsb.rpc('report_finalize', { p_report: reportId, p_badge: 'V114' })
    expect(fin.error).toBeNull()
    expect(fin.data).toMatchObject({ finalized: true })

    const vs = await lsb.from('report_versions')
      .select('id,version_number,fields,signature,created_by')
      .eq('report_id', reportId)
    expect(vs.error).toBeNull()
    expect(vs.data).toHaveLength(1)
    versionId = vs.data![0].id
    expect(vs.data![0].version_number).toBe(1)
    // the snapshot froze exactly what was sealed
    expect(vs.data![0].fields).toMatchObject({ summary: `v114 snapshot ${tag}` })
    expect(vs.data![0].signature).toMatchObject({ badge: 'V114' })
  })

  it('report versions are immutable — no client UPDATE or DELETE, not even the owner', async () => {
    const asAuthor = await lsb.from('report_versions')
      .update({ fields: { summary: 'tampered' } }).eq('id', versionId).select('id')
    expect(asAuthor.error).not.toBeNull()
    const asOwner = await owner.from('report_versions')
      .update({ fields: { summary: 'tampered by owner' } }).eq('id', versionId).select('id')
    expect(asOwner.error).not.toBeNull()
    // direct DELETE grant is revoked too (only the report-delete cascade may remove versions)
    const del = await lsb.from('report_versions').delete().eq('id', versionId).select('id')
    expect(del.error).not.toBeNull()
    // and nothing changed
    const still = await lsb.from('report_versions').select('fields').eq('id', versionId)
    expect(still.data?.[0]?.fields).toMatchObject({ summary: `v114 snapshot ${tag}` })
  })

  it('report versions follow case access — the other bureau sees nothing', async () => {
    const peek = await bcb.from('report_versions').select('id').eq('report_id', reportId)
    expect(peek.error).toBeNull()
    expect(peek.data ?? []).toHaveLength(0)
  })

  it('reopen → refinalize produces v2 with v1 still intact', async () => {
    // report_reopen is bureau_lead+ (lead is LSB, same bureau as the case)
    const re = await lead.rpc('report_reopen', { p_report: reportId })
    expect(re.error).toBeNull()
    expect(re.data).toMatchObject({ finalized: false })
    const fin2 = await lsb.rpc('report_finalize', { p_report: reportId })
    expect(fin2.error).toBeNull()
    const vs = await lsb.from('report_versions')
      .select('version_number,fields').eq('report_id', reportId)
      .order('version_number', { ascending: true })
    expect(vs.error).toBeNull()
    expect((vs.data ?? []).map((v) => v.version_number)).toEqual([1, 2])
    expect(vs.data![0].fields).toMatchObject({ summary: `v114 snapshot ${tag}` })
  })

  /* ================= search_all 'legal' kind ================= */

  it('search_all returns a legal hit for the creator, by request number', async () => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'document_production',
      p_title: `RLS V114 Search ${tag}`, p_recipient_type: 'entity', p_recipient_name: 'Maze Bank',
      p_narrative: 'v1.14 search-wall test.',
      p_form: { items_requested: 'Ledger extracts', date_range: '2026-01 → 2026-06' },
    })
    expect(r.error).toBeNull()
    requestId = r.data!.id
    requestNumber = r.data!.request_number

    const res = await lsb.rpc('search_all', { q: requestNumber })
    expect(res.error).toBeNull()
    const hit = legalHits(res.data).find((h) => h.id === requestId)
    expect(hit).toBeTruthy()
    // label contract: request_number · title
    expect(hit!.label).toContain(requestNumber)
    expect(hit!.label).toContain(`RLS V114 Search ${tag}`)
  })

  it('an unrelated detective searching the same terms gets no legal hit (INVOKER)', async () => {
    const byNumber = await bcb.rpc('search_all', { q: requestNumber })
    expect(byNumber.error).toBeNull()
    expect(legalHits(byNumber.data)).toHaveLength(0)
    const byTitle = await bcb.rpc('search_all', { q: `RLS V114 Search ${tag}` })
    expect(byTitle.error).toBeNull()
    expect(legalHits(byTitle.data).some((h) => h.id === requestId)).toBe(false)
  })

  it('a sealed request is undiscoverable to a non-participant — but not to oversight', async () => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'subpoena', p_subtype: 'medical_records',
      p_title: sealedTitle, p_recipient_type: 'entity', p_recipient_name: 'Pillbox Medical',
      p_narrative: 'sealed search-wall test.', p_classification: 'sealed',
      p_form: { items_requested: 'Treatment records' },
    })
    expect(r.error).toBeNull()
    sealedId = r.data!.id
    expect(r.data).toMatchObject({ classification: 'sealed' })

    // creator still finds their own sealed draft
    const mine = await lsb.rpc('search_all', { q: sealedTitle })
    expect(legalHits(mine.data).some((h) => h.id === sealedId)).toBe(true)
    // the stranger gets nothing — undiscoverable by construction
    const stranger = await bcb.rpc('search_all', { q: sealedTitle })
    expect(stranger.error).toBeNull()
    expect(legalHits(stranger.data)).toHaveLength(0)
    // positive control: owner oversight can still find it, so the empty
    // result above is a visibility decision, not an indexing gap
    const oversight = await owner.rpc('search_all', { q: sealedTitle })
    expect(legalHits(oversight.data).some((h) => h.id === sealedId)).toBe(true)
  })

  /* ================= exhibit URL hardening (20260715040000, M1) ========== */

  it('external-link exhibits reject non-http(s) schemes at the server', async () => {
    // A stored URL becomes a clickable href for DOJ reviewers — the scheme
    // allow-list must hold even against a hand-crafted RPC call.
    const bad = await lsb.rpc('add_legal_exhibit', {
      p_request: requestId, p_type: 'external_link',
      p_meta: { url: 'javascript:alert(1)' },
    })
    expect(bad.error).toBeTruthy()
    expect(bad.error!.message).toMatch(/http/i)
    const good = await lsb.rpc('add_legal_exhibit', {
      p_request: requestId, p_type: 'external_link',
      p_meta: { url: 'https://evidence.example/v114-hardening' },
    })
    expect(good.error).toBeNull()
  })

  /* ================= security testing RPCs ================= */
  // NOTE: the "non-fixture accounts are refused" branch of
  // security_test_report cannot be exercised here — every credentialed test
  // account IS an rls-test-%@cidportal.test fixture, and that is the whole
  // point of the guard. The server-side email check is asserted by code
  // review (migration 20260715030000) instead.

  it('security_test_report accepts a fixture-reported run and sanitizes failures server-side', async () => {
    const r = await lsb.rpc('security_test_report', {
      p_suite: REPORT_SUITE, p_passed: 3, p_failed: 1, p_skipped: 2,
      // the extra `row` key and the long string must never survive server sanitization
      p_failures: [{ name: `v114 probe ${tag}`, expected: 'denied', actual: 'x'.repeat(500), row: 'SENSITIVE-PAYLOAD' }],
      p_source: 'local', p_duration_ms: 1234,
    })
    expect(r.error).toBeNull()
    expect(typeof r.data).toBe('string') // uuid of the stored run
  })

  it('the runs table itself stays fully locked — not even SELECT for clients', async () => {
    const sel = await lsb.from('security_test_runs').select('id').limit(1)
    expect(sel.error).not.toBeNull() // grant revoked, definer RPCs are the only path
    const own = await owner.from('security_test_runs').select('id').limit(1)
    expect(own.error).not.toBeNull()
  })

  it('owner_security_overview returns runs (incl. the reported one, sanitized), fixtures and leftovers', async () => {
    const r = await owner.rpc('owner_security_overview')
    expect(r.error).toBeNull()
    const data = r.data as {
      runs: { suite: string; passed: number; failed: number; skipped: number; total: number
        failures: Record<string, unknown>[] }[]
      fixtures: { email: string; present: boolean; issues: string[] }[]
      leftovers: Record<string, number>
    }
    const run = data.runs.find((x) => x.suite === REPORT_SUITE
      && (x.failures ?? []).some((f) => f.name === `v114 probe ${tag}`))
    expect(run).toBeTruthy()
    expect(run).toMatchObject({ passed: 3, failed: 1, skipped: 2, total: 6 })
    const failure = run!.failures.find((f) => f.name === `v114 probe ${tag}`)!
    expect(Object.keys(failure).sort()).toEqual(['actual', 'expected', 'name']) // `row` stripped
    expect((failure.actual as string).length).toBeLessThanOrEqual(300)
    // fixture health covers the documented roster; leftovers is a count map
    expect(data.fixtures.length).toBeGreaterThanOrEqual(16)
    expect(data.fixtures.some((f) => f.email === 'rls-test-lsb@cidportal.test' && f.present)).toBe(true)
    expect(typeof data.leftovers).toBe('object')
    expect(Object.keys(data.leftovers)).toContain('cases')
  })

  it('owner_security_overview is owner-only — a detective is refused', async () => {
    const r = await lsb.rpc('owner_security_overview')
    expect(r.error).not.toBeNull()
  })
})
