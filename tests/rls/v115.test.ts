/** v1.15 security-wall tests — LIVE project, rls-test accounts.
 *
 *  Covers the two v1.15 surfaces:
 *   - search_warrant subtype: a first-class warrant subtype that routes
 *     CID -> ADA -> Judge (judge-only approval, 'classified' by default),
 *     requires a subject OR at least one form_data.search_targets (no
 *     mandatory Persons-registry suspect), and NEVER projects an MDT
 *     wanted-person row.
 *   - owner-only warrant import: import_legal_warrant() lands a historical
 *     in-city warrant at submitted_to_doj intake, preserves the source
 *     submitter as created_by, records provenance columns + a LEGAL_IMPORTED
 *     audit row, freezes an immutable version, is idempotent on import_key,
 *     and is reversible via import_rollback_by_key() — both owner-only.
 *
 *  Fixtures reused (tests/rls/README.md): lsb/bcb detectives, lead (LSB
 *  bureau_lead), director (SAB command), ada (LSB primary ADA), da, ag,
 *  judge, owner. Same conventions as legal.test.ts / v114.test.ts:
 *  sequential sign-ins with backoff (GoTrue rate-limits parallel grants),
 *  rls_test_cleanup() at suite start and teardown, every created row authored
 *  by a test account so cleanup catches it, and every imported row rolled back
 *  by import_key in teardown so production is left clean.
 *
 *  NOTE: the two v1.15 migrations (20260716010000 / 20260716020000) must be
 *  applied to the target project before this suite can pass; it self-skips
 *  when the fixture passwords are absent, like the sibling suites. */

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
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  ada: process.env.RLS_TEST_PASSWORD_ADA_LSB,
  da: process.env.RLS_TEST_PASSWORD_DA,
  ag: process.env.RLS_TEST_PASSWORD_AG,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director && PW.owner
  && PW.ada && PW.da && PW.ag && PW.judge)
if (!enabled) console.warn('[rls:v115] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

interface SearchHit { kind: string; id: string; label: string; sublabel: string }
const legalHits = (rows: unknown): SearchHit[] =>
  ((rows ?? []) as SearchHit[]).filter((h) => h.kind === 'legal')

describe.skipIf(!enabled)('v1.15 — search_warrant subtype + owner warrant import (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C, owner: C, ada: C, da: C, ag: C, judge: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''        // LSB case owned by the lsb detective
  let importCaseId = ''  // separate LSB case for the imports
  let personId = ''
  let lifecycleId = ''   // the end-to-end search warrant

  // Distinctive import keys — all rolled back in teardown so prod stays clean.
  const keyArrest = `rls-test-v115-${tag}-arrest`
  const keyExhibit = `rls-test-v115-${tag}-exhibit`
  const keySearch = `rls-test-v115-${tag}-search`
  const keyRollback = `rls-test-v115-${tag}-rollback`
  const allKeys = [keyArrest, keyExhibit, keySearch, keyRollback]

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk(); owner = mk()
    ada = mk(); da = mk(); ag = mk(); judge = mk()
    // Sequential with backoff — parallel password grants trip the per-IP auth
    // rate limit (see tests/rls/auth.ts).
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [ada, 'rls-test-ada-lsb@cidportal.test', PW.ada, 'ada'],
      [da, 'rls-test-da@cidportal.test', PW.da, 'da'],
      [ag, 'rls-test-ag@cidportal.test', PW.ag, 'ag'],
      [judge, 'rls-test-judge@cidportal.test', PW.judge, 'judge'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    // Purge leftovers from any crashed prior run FIRST.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    // Roll back any imports orphaned by a crashed prior run (owner-only).
    for (const k of allKeys) await owner.rpc('import_rollback_by_key', { p_import_key: k })

    const c1 = await lsb.from('cases').insert({ case_number: `V115-${tag}-A`, title: 'v1.15 RLS case (LSB)', bureau: 'LSB' }).select('id')
    if (c1.error) throw new Error(c1.error.message)
    caseId = c1.data![0].id
    const c2 = await lsb.from('cases').insert({ case_number: `V115-${tag}-IMP`, title: 'v1.15 RLS import case (LSB)', bureau: 'LSB' }).select('id')
    if (c2.error) throw new Error(c2.error.message)
    importCaseId = c2.data![0].id
    const p = await lsb.from('persons').insert({ name: `RLS V115 Subject ${tag}` }).select('id')
    if (p.error) throw new Error(p.error.message)
    personId = p.data![0].id
    // Cover LSB with a primary ADA so CID approval auto-routes to `ada`.
    const cov = await da.rpc('set_primary_ada', { p_prosecutor: ids.ada, p_bureau: 'LSB' })
    if (cov.error) throw new Error(`ADA coverage setup failed: ${cov.error.message}`)
  })

  afterAll(async () => {
    if (!lsb) return
    // Reverse every import first (children are ON DELETE RESTRICT); this leaves
    // the audit trail intact but removes the request rows so the case delete in
    // rls_test_cleanup is unobstructed.
    for (const k of allKeys) {
      const rb = await owner.rpc('import_rollback_by_key', { p_import_key: k })
      if (rb.error) console.warn(`[rls:v115] rollback ${k} failed:`, rb.error.message)
    }
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v115] cleanup:', JSON.stringify(data))
    if (personId) {
      const del = await director.from('persons').delete().eq('id', personId)
      if (del.error) console.warn('[rls:v115] person cleanup failed:', del.error.message)
    }
    await Promise.all([lsb, bcb, lead, director, owner, ada, da, ag, judge].map((c) => c.auth.signOut()))
  })

  /* ================= search_warrant subtype ================= */

  it('a search warrant with a linked subject is created — judge route, classified', async () => {
    const ok = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'search_warrant',
      p_title: `RLS V115 Search Warrant ${tag}`, p_priority: 'High', p_person: personId,
      p_narrative: 'Probable cause to search the subject and their premises.',
      p_form: { search_targets: 'Person and vehicle' },
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({
      subtype: 'search_warrant', responsible_bureau: 'LSB',
      approval_route: 'judge', classification: 'classified',
    })
  })

  it('a search warrant with NO person but a search target succeeds (property-target path)', async () => {
    const ok = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'search_warrant',
      p_title: `RLS V115 Premises Warrant ${tag}`, p_priority: 'Medium',
      p_narrative: 'Probable cause to search a premises; no named suspect.',
      p_form: { search_targets: '221B Vinewood Blvd, Los Santos' },
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ subtype: 'search_warrant', person_id: null, approval_route: 'judge' })
  })

  it('a search warrant with neither a subject nor a search target is rejected', async () => {
    const bad = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'search_warrant',
      p_title: `RLS V115 Empty Warrant ${tag}`, p_priority: 'Low',
      p_narrative: 'no subject and no target — must be refused.',
      p_form: { search_targets: '   ' },
    })
    expect(bad.error).not.toBeNull()
  })

  it('an arrest warrant with no person is still rejected (regression)', async () => {
    const bad = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'arrest_warrant',
      p_title: `RLS V115 Arrest No Person ${tag}`, p_priority: 'High',
      p_narrative: 'arrest warrant requires a registry suspect.',
    })
    expect(bad.error).not.toBeNull()
  })

  it('full route: CID approve → ADA → (ADA/DA/AG cannot approve) → assign judge → judge approves', async () => {
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'search_warrant',
      p_title: `RLS V115 Lifecycle ${tag}`, p_priority: 'High', p_person: personId,
      p_narrative: 'Probable cause narrative for the end-to-end search-warrant route.',
      p_form: { search_targets: 'Residence and outbuildings' },
    })
    expect(r.error).toBeNull()
    lifecycleId = r.data!.id
    await lsb.rpc('add_legal_exhibit', { p_request: lifecycleId, p_type: 'external_link', p_meta: { url: 'https://evidence.example/v115-sw' } })

    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: lifecycleId })
    expect(sub.error).toBeNull()
    expect(sub.data).toMatchObject({ review_status: 'cid_supervisor_review' })

    // CID supervisor approval routes to the LSB primary ADA.
    const cid = await lead.rpc('review_legal_request_as_cid', { p_request: lifecycleId, p_decision: 'approve', p_signature: 'RLS Lead' })
    expect(cid.error).toBeNull()
    expect(cid.data).toMatchObject({ review_status: 'ada_review', assigned_ada_id: ids.ada })

    // The judge route forbids prosecutor approval at every stage:
    // the assigned ADA can only route to a Judge, never approve or send to DA/AG.
    const adaToDa = await ada.rpc('review_legal_request_as_ada', { p_request: lifecycleId, p_decision: 'submit_to_da', p_signature: 'RLS ADA' })
    expect(adaToDa.error).not.toBeNull()
    const adaToAg = await ada.rpc('review_legal_request_as_ada', { p_request: lifecycleId, p_decision: 'submit_to_ag', p_signature: 'RLS ADA' })
    expect(adaToAg.error).not.toBeNull()
    const daApprove = await da.rpc('review_legal_request_as_da', { p_request: lifecycleId, p_decision: 'approve' })
    expect(daApprove.error).not.toBeNull()
    const agApprove = await ag.rpc('review_legal_request_as_ag', { p_request: lifecycleId, p_decision: 'approve' })
    expect(agApprove.error).not.toBeNull()
    const daAsJudge = await da.rpc('decide_legal_request_as_judge', { p_request: lifecycleId, p_decision: 'approve' })
    expect(daAsJudge.error).not.toBeNull()
    const agAsJudge = await ag.rpc('decide_legal_request_as_judge', { p_request: lifecycleId, p_decision: 'approve' })
    expect(agAsJudge.error).not.toBeNull()

    // The ADA submits to a Judge; the ADA assigns the Judge; only the Judge approves.
    const toJudge = await ada.rpc('review_legal_request_as_ada', { p_request: lifecycleId, p_decision: 'submit_to_judge', p_signature: 'RLS ADA' })
    expect(toJudge.error).toBeNull()
    expect(toJudge.data).toMatchObject({ review_status: 'submitted_to_judge' })
    const asg = await ada.rpc('assign_judge', { p_request: lifecycleId, p_judge: ids.judge })
    expect(asg.error).toBeNull()
    expect(asg.data).toMatchObject({ review_status: 'judicial_review', assigned_judge_id: ids.judge })

    const future = new Date(Date.now() + 30 * 86_400_000).toISOString()
    const ok = await judge.rpc('decide_legal_request_as_judge', {
      p_request: lifecycleId, p_decision: 'approve', p_note: 'Approved for the RLS wall test',
      p_conditions: 'Daylight service only', p_expires_at: future, p_signature: 'RLS Judge',
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ review_status: 'approved', decision: 'approved' })
  })

  it('an issued search warrant NEVER creates an MDT wanted-person projection', async () => {
    const issue = await lsb.rpc('issue_legal_request', { p_request: lifecycleId })
    expect(issue.error).toBeNull()
    expect(issue.data).toMatchObject({ fulfilment_status: 'issued' })
    // Raw projection table: an arrest warrant would have a row here; a search
    // warrant must not — even with a non-expired approval.
    const proj = await lsb.from('mdt_wanted_projections').select('id').eq('legal_request_id', lifecycleId)
    expect(proj.error).toBeNull()
    expect(proj.data ?? []).toHaveLength(0)
    // And the read-time MDT contract never surfaces it as wanted.
    const cur = await lsb.rpc('mdt_wanted_current')
    expect((cur.data ?? []).some((x: { legal_request_id: string }) => x.legal_request_id === lifecycleId)).toBe(false)
  })

  it('a sealed search warrant is undiscoverable to an unrelated bureau but visible to owner oversight', async () => {
    const sealedTitle = `RLS V115 SEALED SW ${tag}`
    const r = await lsb.rpc('create_legal_request', {
      p_case: caseId, p_request_type: 'warrant', p_subtype: 'search_warrant',
      p_title: sealedTitle, p_priority: 'High', p_person: personId,
      p_narrative: 'sealed search warrant.', p_classification: 'sealed',
      p_form: { search_targets: 'Undisclosed premises' },
    })
    expect(r.error).toBeNull()
    const sealedId = r.data!.id
    expect(r.data).toMatchObject({ classification: 'sealed', subtype: 'search_warrant' })
    const sub = await lsb.rpc('submit_legal_request_to_cid', { p_request: sealedId })
    expect(sub.error).toBeNull()

    // Invisible to the unrelated detective — table read and both search RPCs.
    const row = await bcb.from('legal_requests').select('id').eq('id', sealedId)
    expect(row.data ?? []).toHaveLength(0)
    const ls = await bcb.rpc('legal_search', { q: sealedTitle })
    expect((ls.data ?? []).length).toBe(0)
    const sa = await bcb.rpc('search_all', { q: sealedTitle })
    expect(legalHits(sa.data)).toHaveLength(0)
    // Owner oversight still holds — the empty results above are a visibility
    // decision, not an indexing gap.
    const own = await owner.from('legal_requests').select('id').eq('id', sealedId)
    expect(own.data).toHaveLength(1)
    const ownSearch = await owner.rpc('search_all', { q: sealedTitle })
    expect(legalHits(ownSearch.data).some((h) => h.id === sealedId)).toBe(true)
  })

  /* ================= owner-only warrant import ================= */

  it('owner imports a historical arrest warrant → submitted_to_doj, provenance + immutable version + audit, no MDT', async () => {
    const sourceAt = '2026-03-01T12:00:00.000Z'
    const imp = await owner.rpc('import_legal_warrant', {
      p_case: importCaseId, p_subtype: 'arrest_warrant',
      p_title: `RLS V115 Imported Arrest ${tag}`, p_priority: 'High',
      p_form: {}, p_narrative: 'Historical in-city arrest warrant migrated to DOJ intake.',
      p_person: personId, p_classification: null,
      p_source_submitted_at: sourceAt, p_source_submitter: ids.lsb,
      p_import_key: keyArrest,
      p_exhibits: [{ type: 'external_link', title: 'Original filing', url: 'https://archive.example/v115-import' }],
    })
    expect(imp.error).toBeNull()
    const reqId = imp.data!.id
    // Lands pre-decision at DOJ intake; the historical submitter is the author.
    expect(imp.data).toMatchObject({
      subtype: 'arrest_warrant', review_status: 'submitted_to_doj',
      created_by: ids.lsb, approval_route: 'judge',
      source_system: 'in_city_classified_warrants', source_submitter_id: ids.lsb,
      imported_by: ids.owner, import_key: keyArrest, decision: null,
    })
    expect(imp.data.source_submitted_at).toBeTruthy()
    expect(imp.data.imported_at).toBeTruthy()
    // NOT approved/issued.
    expect(imp.data.fulfilment_status).not.toBe('issued')

    // An immutable version was frozen.
    const vs = await owner.from('legal_request_versions').select('id').eq('legal_request_id', reqId)
    expect((vs.data ?? []).length).toBeGreaterThanOrEqual(1)
    // The LEGAL_IMPORTED audit row is present.
    const audit = await owner.from('audit_log').select('id,detail').eq('entity_id', reqId).eq('action', 'LEGAL_IMPORTED')
    expect((audit.data ?? []).length).toBe(1)
    // No MDT projection for an imported (never-issued) warrant.
    const proj = await owner.from('mdt_wanted_projections').select('id').eq('legal_request_id', reqId)
    expect(proj.data ?? []).toHaveLength(0)
  })

  it('re-running the same import_key is idempotent — same row id, still exactly one row', async () => {
    const first = await owner.from('legal_requests').select('id').eq('import_key', keyArrest)
    expect(first.data).toHaveLength(1)
    const firstId = first.data![0].id
    const again = await owner.rpc('import_legal_warrant', {
      p_case: importCaseId, p_subtype: 'arrest_warrant',
      p_title: `RLS V115 Imported Arrest DUP ${tag}`, p_priority: 'Critical',
      p_form: {}, p_narrative: 'duplicate attempt — must be a no-op.',
      p_person: personId, p_classification: null,
      p_source_submitted_at: '2026-03-02T12:00:00.000Z', p_source_submitter: ids.lsb,
      p_import_key: keyArrest,
    })
    expect(again.error).toBeNull()
    expect(again.data!.id).toBe(firstId)
    // Title unchanged — the prior import won.
    expect(again.data!.title).toBe(`RLS V115 Imported Arrest ${tag}`)
    const total = await owner.from('legal_requests').select('id').eq('import_key', keyArrest)
    expect(total.data).toHaveLength(1)
  })

  it('a non-owner calling import_legal_warrant is rejected', async () => {
    const bad = await lsb.rpc('import_legal_warrant', {
      p_case: importCaseId, p_subtype: 'arrest_warrant',
      p_title: `RLS V115 Illicit Import ${tag}`, p_priority: 'High',
      p_form: {}, p_narrative: 'a detective must not be able to import.',
      p_person: personId, p_classification: null,
      p_source_submitted_at: '2026-03-03T12:00:00.000Z', p_source_submitter: ids.lsb,
      p_import_key: `${keyArrest}-illicit`,
    })
    expect(bad.error).not.toBeNull()
    // Nothing was written.
    const none = await owner.from('legal_requests').select('id').eq('import_key', `${keyArrest}-illicit`)
    expect(none.data ?? []).toHaveLength(0)
  })

  it('import external-link exhibits enforce the http(s) scheme allow-list', async () => {
    const bad = await owner.rpc('import_legal_warrant', {
      p_case: importCaseId, p_subtype: 'arrest_warrant',
      p_title: `RLS V115 Bad Exhibit ${tag}`, p_priority: 'High',
      p_form: {}, p_narrative: 'exhibit scheme guard.',
      p_person: personId, p_classification: null,
      p_source_submitted_at: '2026-03-04T12:00:00.000Z', p_source_submitter: ids.lsb,
      p_import_key: keyExhibit,
      p_exhibits: [{ type: 'external_link', title: 'XSS', url: 'javascript:alert(1)' }],
    })
    expect(bad.error).not.toBeNull()
    // The whole import rolled back — no partial row survives the bad exhibit.
    const none = await owner.from('legal_requests').select('id').eq('import_key', keyExhibit)
    expect(none.data ?? []).toHaveLength(0)

    const good = await owner.rpc('import_legal_warrant', {
      p_case: importCaseId, p_subtype: 'arrest_warrant',
      p_title: `RLS V115 Good Exhibit ${tag}`, p_priority: 'High',
      p_form: {}, p_narrative: 'exhibit scheme guard (valid).',
      p_person: personId, p_classification: null,
      p_source_submitted_at: '2026-03-04T13:00:00.000Z', p_source_submitter: ids.lsb,
      p_import_key: keyExhibit,
      p_exhibits: [{ type: 'external_link', title: 'Filing', url: 'https://archive.example/v115-good' }],
    })
    expect(good.error).toBeNull()
    const ex = await owner.from('legal_request_exhibits').select('id').eq('legal_request_id', good.data!.id)
    expect((ex.data ?? []).length).toBeGreaterThanOrEqual(1)
  })

  it('a search-warrant import with only a search target (no person) succeeds', async () => {
    const imp = await owner.rpc('import_legal_warrant', {
      p_case: importCaseId, p_subtype: 'search_warrant',
      p_title: `RLS V115 Imported Search ${tag}`, p_priority: 'Medium',
      p_form: { search_targets: 'Warehouse unit 7' },
      p_narrative: 'historical premises search warrant, no named suspect.',
      p_person: null, p_classification: null,
      p_source_submitted_at: '2026-03-05T12:00:00.000Z', p_source_submitter: ids.lsb,
      p_import_key: keySearch,
    })
    expect(imp.error).toBeNull()
    expect(imp.data).toMatchObject({
      subtype: 'search_warrant', person_id: null,
      review_status: 'submitted_to_doj', import_key: keySearch,
    })
  })

  it('owner rollback removes the imported request but preserves the audit trail; non-owner rollback is rejected', async () => {
    // Import a dedicated row to reverse.
    const imp = await owner.rpc('import_legal_warrant', {
      p_case: importCaseId, p_subtype: 'arrest_warrant',
      p_title: `RLS V115 Rollback Target ${tag}`, p_priority: 'High',
      p_form: {}, p_narrative: 'this import will be reversed.',
      p_person: personId, p_classification: null,
      p_source_submitted_at: '2026-03-06T12:00:00.000Z', p_source_submitter: ids.lsb,
      p_import_key: keyRollback,
    })
    expect(imp.error).toBeNull()
    const reqId = imp.data!.id

    // A detective cannot roll back.
    const bad = await lsb.rpc('import_rollback_by_key', { p_import_key: keyRollback })
    expect(bad.error).not.toBeNull()
    const still = await owner.from('legal_requests').select('id').eq('import_key', keyRollback)
    expect(still.data).toHaveLength(1)

    // The owner rollback returns the count and deletes the request + children.
    const rb = await owner.rpc('import_rollback_by_key', { p_import_key: keyRollback })
    expect(rb.error).toBeNull()
    expect(rb.data).toBe(1)
    const gone = await owner.from('legal_requests').select('id').eq('import_key', keyRollback)
    expect(gone.data ?? []).toHaveLength(0)
    const goneById = await owner.from('legal_requests').select('id').eq('id', reqId)
    expect(goneById.data ?? []).toHaveLength(0)

    // The audit trail survives: both the import and the rollback are on record.
    const imported = await owner.from('audit_log').select('id').eq('entity_id', reqId).eq('action', 'LEGAL_IMPORTED')
    expect((imported.data ?? []).length).toBe(1)
    const rolled = await owner.from('audit_log').select('id').eq('entity_id', reqId).eq('action', 'LEGAL_IMPORT_ROLLBACK')
    expect((rolled.data ?? []).length).toBe(1)
  })
})
