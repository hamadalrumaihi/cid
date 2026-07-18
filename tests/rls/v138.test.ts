/** v1.38 — case media canonical + evidence/custody freeze
 *  (migration 20260807010000_case_media_canonical).
 *
 *  media gained typed FKs (report_id, vehicle_id) and gallery metadata
 *  (category, featured, archived_at) with media_category_check; NO media
 *  policy changed — the audience stays is_active()-wide with the restricted
 *  gate intact. evidence + custody_chain lost their client write grants
 *  (INSERT/UPDATE/DELETE/TRUNCATE revoked from anon+authenticated; SELECT
 *  unchanged), and the 2 evidence-only medal.tv clips were copied into media
 *  with tags.legacy_evidence provenance (source rows preserved).
 *
 *  Pins:
 *   - an active member INSERTs media carrying the new columns (category,
 *     featured) — media_ins is still just is_active();
 *   - media_category_check rejects an unknown category (23514);
 *   - media_upd stays BROAD (pre-existing, unchanged): another active member
 *     from another bureau edits category/archived_at on a row they did not
 *     create; the archived row stays SELECTable (archive is client-side
 *     filtering only — RLS audience untouched);
 *   - the restricted gate survived the new columns: a plain detective reads
 *     ZERO restricted rows and their UPDATE matches 0 rows, while an intel
 *     editor (bureau_lead) still sees the row;
 *   - media.report_id is NOT a read path into reports: the media row is
 *     visible is_active()-wide, but the `report:report_id(...)` embed
 *     evaluates reports RLS and comes back null for a member without case
 *     access (and populated for the case creator);
 *   - evidence INSERT is now 42501 permission denied even for the case
 *     CREATOR (pre-freeze the RLS with-check passed for them — the denial is
 *     the revoke, not the policy);
 *   - evidence UPDATE and DELETE are 42501 even for command (director), while
 *     SELECT still works for a case-access fixture (read-only legacy);
 *   - custody_chain INSERT is 42501 (privilege check precedes RLS and FKs);
 *   - the 2 migrated legacy clips exist in media (tags.legacy_evidence,
 *     medal.tv clips mJtoIcmMSrKz / mJtHojLXXxEZXLe2K, category 'scene'),
 *     are readable by a plain active fixture WITHOUT SAB case access (case
 *     media is standard), and their evidence source rows are STILL in
 *     evidence — the migration copied, never deleted.
 *
 *  Fixtures (tests/rls/README.md): lsb (LSB detective — creator), bcb (BCB
 *  detective — broad-update + no-report-access side), lead (bureau_lead —
 *  can_edit_narcotics_intel for the restricted row), director (is_command —
 *  reads the live SAB-9000018 legacy rows; READ-ONLY, never mutated). All
 *  writes land on a per-run [rls-test] v138 case; rls_test_cleanup() runs at
 *  start AND teardown and sweeps the case plus every media/report row on it
 *  (media is deleted by case_id). No registry fixtures, no notifications, no
 *  storage uploads. Requires migration 20260807010000 applied. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
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
if (!enabled) console.warn('[rls:v138] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

/** Live prod legacy surface migrated by 20260807010000 — READ-ONLY here. */
const LEGACY = {
  caseNumber: 'SAB-9000018',
  clips: ['mJtoIcmMSrKz', 'mJtHojLXXxEZXLe2K'],
  evidencePrefixes: ['45ce4c71', '31803cfd'],
}

describe.skipIf(!enabled)('v1.38 — case media canonical + evidence freeze (live)', () => {
  let lsb: C, bcb: C, lead: C, director: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''       // per-run LSB fixture case (lsb-created)
  let reportId = ''     // lsb report on the fixture case — the embed target
  let mediaId = ''      // test 1's row — updated/archived by test 3
  let restrictedId = '' // lead's restricted row — the gate pin
  let sabCaseId = ''    // LIVE SAB-9000018 (read-only legacy assertions)

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk()
    // Sequential with backoff — parallel password grants trip the per-IP limit.
    for (const [client, email, pw] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb],
      [lead, 'rls-test-lead@cidportal.test', PW.lead],
      [director, 'rls-test-director@cidportal.test', PW.director],
    ] as const) {
      await signInWithRetry(client, email, pw!)
    }
    // Purge leftovers from any crashed prior run FIRST.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c = await lsb.from('cases')
      .insert({ case_number: `V138-${tag}`, title: '[rls-test] v138 media canonical', bureau: 'LSB' })
      .select('id')
    if (c.error) throw new Error(`fixture case: ${c.error.message}`)
    caseId = c.data![0].id

    const r = await lsb.from('reports')
      .insert({ case_id: caseId, template: 'initial', kind: 'initial', seq: 1, fields: { summary: `[rls-test] v138 ${tag}` } })
      .select('id')
    if (r.error) throw new Error(`fixture report: ${r.error.message}`)
    reportId = r.data![0].id

    // The live legacy case — located as command (is_command read), never written.
    const sab = await director.from('cases').select('id').eq('case_number', LEGACY.caseNumber)
    if (sab.error) throw new Error(`legacy case lookup: ${sab.error.message}`)
    if ((sab.data ?? []).length !== 1) throw new Error(`legacy case ${LEGACY.caseNumber} not found — wrong environment?`)
    sabCaseId = sab.data![0].id
  })

  afterAll(async () => {
    if (!lsb) return
    // The cleanup RPC sweeps the rls-test case and every media/report row on
    // it (media is deleted by case_id, so the lead's restricted row and the
    // bcb-edited row go too).
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls:v138] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, director].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── 1. media_ins is still just is_active() — new columns write through ── */

  it('an active member INSERTs a media row with the new columns (category, featured)', async () => {
    const r = await lsb.from('media')
      .insert({
        title: `[rls-test] v138 scene ${tag}`, type: 'image',
        external_url: 'https://example.com/v138-scene.png',
        case_id: caseId, category: 'scene', featured: true,
      })
      .select('id, category, featured, archived_at, report_id, vehicle_id')
    expect(r.error).toBeNull()
    expect(r.data).toHaveLength(1)
    expect(r.data![0]).toMatchObject({
      category: 'scene', featured: true, archived_at: null, report_id: null, vehicle_id: null,
    })
    mediaId = r.data![0].id as string
  })

  /* ── 2. media_category_check closes over unknown values ── */

  it('media_category_check rejects an invalid category', async () => {
    const r = await lsb.from('media')
      .insert({
        title: `[rls-test] v138 bad category ${tag}`, type: 'image',
        external_url: 'https://example.com/v138-bad.png',
        case_id: caseId, category: 'selfie',
      })
      .select('id')
    expect(r.error).not.toBeNull()
    expect(r.error!.code).toBe('23514')
    expect(r.error!.message).toMatch(/media_category_check/i)
  })

  /* ── 3. media_upd is broad (pre-existing, unchanged) + archive keeps the row readable ── */

  it('ANOTHER active member (other bureau, not the creator) updates category/archived_at; the archived row stays SELECTable', async () => {
    const archivedAt = new Date().toISOString()
    const up = await bcb.from('media')
      .update({ category: 'documents', archived_at: archivedAt })
      .eq('id', mediaId)
      .select('id, category, archived_at')
    expect(up.error).toBeNull()
    expect(up.data).toHaveLength(1) // pinned reality: media_upd is is_active()-broad
    expect(up.data![0].category).toBe('documents')
    expect(up.data![0].archived_at).not.toBeNull()

    // Archive is client-side gallery filtering only — the RLS audience is untouched.
    const sel = await lsb.from('media').select('id, category, archived_at').eq('id', mediaId)
    expect(sel.error).toBeNull()
    expect(sel.data).toHaveLength(1)
    expect(sel.data![0].archived_at).not.toBeNull()
  })

  /* ── 4. the restricted gate survived the new columns ── */

  it('a RESTRICTED media row stays invisible and unwritable for a plain member; an intel editor sees it', async () => {
    const ins = await lead.from('media')
      .insert({
        title: `[rls-test] v138 restricted ${tag}`, type: 'image',
        external_url: 'https://example.com/v138-restricted.png',
        case_id: caseId, restricted: true, category: 'surveillance',
      })
      .select('id')
    expect(ins.error).toBeNull()
    restrictedId = ins.data![0].id as string

    // Plain active member: SELECT sees zero rows...
    const sel = await lsb.from('media').select('id').eq('id', restrictedId)
    expect(sel.error).toBeNull()
    expect(sel.data ?? []).toHaveLength(0)
    // ...and UPDATE (including the new columns) matches zero rows.
    const up = await lsb.from('media')
      .update({ category: 'other', archived_at: new Date().toISOString() })
      .eq('id', restrictedId)
      .select('id')
    expect(up.error).toBeNull()
    expect(up.data ?? []).toHaveLength(0)

    // Positive control: the bureau_lead (can_edit_narcotics_intel) reads it.
    const seen = await lead.from('media').select('id, category, restricted').eq('id', restrictedId)
    expect(seen.error).toBeNull()
    expect(seen.data).toHaveLength(1)
    expect(seen.data![0]).toMatchObject({ restricted: true, category: 'surveillance' })
  })

  /* ── 5. report_id is not a read path into reports ── */

  it('linking media to a report does NOT leak the report: the embed is null without case access, the media row stays visible', async () => {
    const ins = await lsb.from('media')
      .insert({
        title: `[rls-test] v138 report link ${tag}`, type: 'document',
        external_url: 'https://example.com/v138-report.pdf',
        case_id: caseId, report_id: reportId, category: 'report_media',
      })
      .select('id')
    expect(ins.error).toBeNull()
    const linkedId = ins.data![0].id as string

    // Sanity: the wall itself — bcb cannot read the LSB report directly.
    const direct = await bcb.from('reports').select('id').eq('id', reportId)
    expect(direct.error).toBeNull()
    expect(direct.data ?? []).toHaveLength(0)

    // The media row is is_active()-wide, but the embed evaluates reports RLS:
    // PostgREST filters the to-one embed to null for the no-access member.
    const b = await bcb.from('media')
      .select('id, report_id, report:report_id(id, template)')
      .eq('id', linkedId)
    expect(b.error).toBeNull()
    expect(b.data).toHaveLength(1)
    expect(b.data![0].report_id).toBe(reportId)
    expect(b.data![0].report).toBeNull()

    // Positive control: the case creator gets the embedded report.
    const a = await lsb.from('media')
      .select('id, report:report_id(id, template)')
      .eq('id', linkedId)
    expect(a.error).toBeNull()
    expect(a.data).toHaveLength(1)
    // (cast through unknown: the untyped client mis-infers the to-one embed
    // as an array; runtime is an object — asserted by the id match)
    expect((a.data![0].report as unknown as { id: string } | null)?.id).toBe(reportId)
  })

  /* ── 6. evidence INSERT is frozen — even for the case creator ── */

  it('evidence INSERT is 42501 permission denied for authenticated (case creator included)', async () => {
    // Pre-freeze, evidence_ins (can_access_case) PASSED for the creator — the
    // denial below is the grant revoke, not the policy.
    const r = await lsb.from('evidence')
      .insert({ case_id: caseId, item_code: `EV-V138-${tag}`, description: '[rls-test] v138 must not land' })
      .select('id')
    expect(r.error).not.toBeNull()
    expect(r.error!.code).toBe('42501')
    expect(r.error!.message).toMatch(/permission denied/i)
  })

  /* ── 7. evidence UPDATE/DELETE frozen; SELECT unchanged for a case-access fixture ── */

  it('evidence UPDATE and DELETE are 42501 even for command; SELECT still serves the legacy rows', async () => {
    // Privilege check precedes RLS and execution — nothing is ever mutated.
    const up = await director.from('evidence')
      .update({ notes: '[rls-test] v138 tamper attempt' })
      .eq('case_id', sabCaseId)
      .select('id')
    expect(up.error).not.toBeNull()
    expect(up.error!.code).toBe('42501')

    const del = await director.from('evidence').delete().eq('case_id', sabCaseId).select('id')
    expect(del.error).not.toBeNull()
    expect(del.error!.code).toBe('42501')

    // evidence_sel (can_access_case) is untouched: command still reads the
    // frozen legacy rows.
    const sel = await director.from('evidence').select('id, item_code').eq('case_id', sabCaseId)
    expect(sel.error).toBeNull()
    expect((sel.data ?? []).length).toBeGreaterThanOrEqual(2)
  })

  /* ── 8. custody_chain INSERT frozen ── */

  it('custody_chain INSERT is 42501 permission denied', async () => {
    // The privilege check fires before the FK would — no fixture evidence row
    // is needed (and none can exist: evidence is frozen too).
    const r = await lsb.from('custody_chain')
      .insert({ evidence_id: randomUUID(), from_officer: 'A', to_officer: 'B', reason: '[rls-test] v138' })
      .select('id')
    expect(r.error).not.toBeNull()
    expect(r.error!.code).toBe('42501')
    expect(r.error!.message).toMatch(/permission denied/i)
  })

  /* ── 9. the 2 migrated legacy clips: present in media, sources intact in evidence ── */

  it('the migrated clips live in media with tags.legacy_evidence, readable by a plain active fixture; the evidence sources are STILL present', async () => {
    const m = await director.from('media')
      .select('id, type, category, restricted, external_url, tags')
      .eq('case_id', sabCaseId)
      .not('tags->legacy_evidence', 'is', null)
    expect(m.error).toBeNull()
    expect(m.data).toHaveLength(2)

    const evidenceIds: string[] = []
    for (const clip of LEGACY.clips) {
      const row = m.data!.find((r) => (r.external_url as string).includes(clip))
      expect(row, `media row for clip ${clip}`).toBeTruthy()
      expect(row!).toMatchObject({ type: 'video', category: 'scene', restricted: false })
      expect(row!.external_url).toContain('medal.tv')
      const prov = (row!.tags as { legacy_evidence?: { evidence_id?: string } }).legacy_evidence
      expect(prov?.evidence_id).toBeTruthy()
      expect(LEGACY.evidencePrefixes.some((p) => prov!.evidence_id!.startsWith(p))).toBe(true)
      evidenceIds.push(prov!.evidence_id!)
    }

    // Case media is STANDARD: an active fixture WITHOUT SAB case access reads
    // both rows (media_sel is is_active()-wide for non-restricted rows).
    const asLsb = await lsb.from('media').select('id')
      .in('id', m.data!.map((r) => r.id))
    expect(asLsb.error).toBeNull()
    expect(asLsb.data).toHaveLength(2)
    // ...while the same fixture has no access to the underlying case.
    const wall = await lsb.from('cases').select('id').eq('id', sabCaseId)
    expect(wall.error).toBeNull()
    expect(wall.data ?? []).toHaveLength(0)

    // Copied, never deleted: both evidence source rows still exist, on the
    // same case, with the clip still embedded in notes.
    const ev = await director.from('evidence').select('id, case_id, notes').in('id', evidenceIds)
    expect(ev.error).toBeNull()
    expect(ev.data).toHaveLength(2)
    for (const row of ev.data!) {
      expect(row.case_id).toBe(sabCaseId)
      expect(LEGACY.clips.some((clip) => (row.notes ?? '').includes(clip))).toBe(true)
    }
  })
})
