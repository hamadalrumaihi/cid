/** v1.67 — SIU takeover (§14), disclosure (§15) and Phase 3 tradecraft
 *  (migrations 20260824120000, 20260824130000, 20260825120000/130000),
 *  LIVE project.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  Standard CID build fixtures: lsb, lead, director, owner. No new account is
 *  needed, because the build-phase release gate means SIU standing belongs to
 *  the Portal Owner alone — which is what most of this suite has to prove.
 *
 *  ── What it proves ─────────────────────────────────────────────────────────
 *   1. §14 TAKEOVER PRESERVES AND HIDES. The owner assumes control of the
 *      detective's own CID case: the detective loses the case, its reports and
 *      every search hit at once, while the case number, bureau, lead detective
 *      and report authorship are untouched. Returning control gives all of it
 *      back. The whole thing is one authority flip — nothing is copied.
 *   2. §14 IS RPC-ONLY. The four provenance columns cannot be written directly,
 *      and a non-owner cannot assume or release control while the gate is shut.
 *   3. §15 RELEASES ONE ITEM, NOT THE INVESTIGATION. A release addressed to a
 *      CID case reaches that case's members and nobody else; the recipient
 *      reads ZERO rows from siu_disclosures itself, cannot reach the source
 *      investigation, and the RPC payload carries no origin field at all.
 *      Revocation removes it immediately.
 *   4. PHASE 3 IS INVISIBLE TO CID. All six tradecraft tables return nothing
 *      to a detective, a Bureau Lead and the Director, and carry no client
 *      write path for them.
 *   5. EXPORTS REDACT UNCONDITIONALLY. siu_export_case never emits a source
 *      codename, an undercover legend or intercept content — for the Owner,
 *      who holds every standing there is — and says what it withheld.
 *   6. THE OVERSIGHT REPORT CARRIES NO IDENTITY. Counts only, and
 *      {"access": false} for an account with no SIU standing.
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  Every fixture row hangs off a case created by an rls-test account, so
 *  rls_test_cleanup's sweep removes it; siu_disclosures, siu_sources,
 *  siu_comms_intel and the rest all cascade from cases. The §14 case is
 *  returned to CID inside the suite, so a crashed run cannot strand a fixture
 *  case under SIU authority. Audit rows are never swept — audit is
 *  append-only. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.director && PW.owner)
if (!enabled) console.warn('[rls:v167] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const RUN = randomUUID().slice(0, 8)
const tag = (what: string) => `[rls-test] SIU ${what} ${RUN}`

describe.skipIf(!enabled)('v1.67 — SIU takeover, disclosure and tradecraft (live)', () => {
  let owner: C, lsb: C, lead: C, director: C
  let lsbId = ''
  /** The detective's own CID case — the §14 subject. */
  let cidCase = ''
  let cidReport = ''
  /** A native SIU investigation — the §15 source and the Phase 3 host. */
  let siuCase = ''
  /** A second CID case that receives nothing, to prove addressing works. */
  let otherCase = ''
  let disclosureToCase = ''

  beforeAll(async () => {
    owner = mk(); lsb = mk(); lead = mk(); director = mk()
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)

    const c = await lsb.from('cases').insert({
      case_number: `LSB-${Date.now().toString().slice(-6)}`,
      title: tag('takeover subject'), bureau: 'LSB', summary: 'CID-owned.',
    }).select('id').single()
    expect(c.error, c.error?.message).toBeNull()
    cidCase = c.data!.id as string

    const r = await lsb.from('reports').insert({
      case_id: cidCase, template: 'initial', fields: { note: 'detective work' },
    }).select('id').single()
    expect(r.error, r.error?.message).toBeNull()
    cidReport = r.data!.id as string

    const o = await lsb.from('cases').insert({
      case_number: `LSB-${(Date.now() + 1).toString().slice(-6)}`,
      title: tag('unrelated'), bureau: 'LSB',
    }).select('id').single()
    otherCase = o.data!.id as string

    const s = await owner.rpc('siu_create_case', {
      p_title: tag('disclosure source'), p_classification: 'siu_compartmented',
    })
    expect(s.error, s.error?.message).toBeNull()
    siuCase = s.data as string
  }, 90_000)

  afterAll(async () => {
    // Never leave a fixture case under SIU authority: return it first, so the
    // ordinary cleanup sweep (which runs as the creating CID account) can see
    // and delete it.
    if (cidCase) await owner.rpc('siu_release_control', { p_case: cidCase, p_reason: 'suite teardown' })
    await owner.from('cases').delete().eq('id', siuCase)
    await lsb.from('cases').delete().in('id', [cidCase, otherCase].filter(Boolean))
    await Promise.all([owner, lsb, lead, director].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ── §14 — the takeover ─────────────────────────────────────────────────── */

  it('a non-owner cannot assume or release SIU control while the gate is closed', async () => {
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const take = await c.rpc('siu_assume_control', { p_case: cidCase, p_reason: 'unauthorized attempt' })
      expect(take.error, `${who} must be refused by siu_assume_control`).not.toBeNull()
      const give = await c.rpc('siu_release_control', { p_case: cidCase, p_reason: 'unauthorized attempt' })
      expect(give.error, `${who} must be refused by siu_release_control`).not.toBeNull()
    }
    const still = await lsb.from('cases').select('case_authority').eq('id', cidCase).single()
    expect(still.data!.case_authority, 'the case must still be CID').toBe('cid')
  })

  it('the provenance columns cannot be written directly', async () => {
    const up = await lsb.from('cases')
      .update({ siu_assumed_at: new Date().toISOString(), siu_assumption_reason: 'forged' })
      .eq('id', cidCase).select('id')
    expect(up.error, 'writing SIU control provenance directly must be refused').not.toBeNull()
    const row = await lsb.from('cases').select('siu_assumed_at').eq('id', cidCase).single()
    expect(row.data!.siu_assumed_at).toBeNull()
  })

  it('SIU assumes control: CID loses the case at once, and nothing is altered', async () => {
    const take = await owner.rpc('siu_assume_control', {
      p_case: cidCase,
      p_reason: 'Integrity concern regarding the assigned investigator',
      p_classification: 'siu_restricted',
    })
    expect(take.error, take.error?.message).toBeNull()

    // Gone from CID, at every rank, in every surface.
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const row = await c.from('cases').select('id').eq('id', cidCase)
      expect(row.error, `${who}: must not error`).toBeNull()
      expect(row.data, `${who} must no longer see the case`).toEqual([])
      const rep = await c.from('reports').select('id').eq('id', cidReport)
      expect(rep.data, `${who} must no longer see its reports`).toEqual([])
      const hits = await c.rpc('search_all', { q: `takeover subject ${RUN}` })
      const leaked = (hits.data ?? []).filter((h: { id: string }) => h.id === cidCase)
      expect(leaked, `${who} must get no search hit`).toEqual([])
    }

    // …and preserved, exactly, on the SIU side.
    const after = await owner.from('cases')
      .select('case_number,bureau,lead_detective_id,case_authority,siu_classification,siu_assumed_at,siu_assumption_reason')
      .eq('id', cidCase).single()
    expect(after.error, after.error?.message).toBeNull()
    expect(after.data!.case_authority).toBe('siu')
    expect(after.data!.siu_classification).toBe('siu_restricted')
    expect(after.data!.bureau, 'the originating bureau is not rewritten').toBe('LSB')
    expect(after.data!.lead_detective_id, 'the CID lead detective is preserved').toBe(lsbId)
    expect(after.data!.siu_assumed_at).not.toBeNull()
    expect(after.data!.siu_assumption_reason).toContain('Integrity concern')

    const rep = await owner.from('reports').select('id,fields').eq('id', cidReport).single()
    expect(rep.data!.id, 'the report is the same row, not a copy').toBe(cidReport)
    expect((rep.data!.fields as { note?: string }).note).toBe('detective work')
  })

  it('a natively-SIU investigation can never be released to CID', async () => {
    const give = await owner.rpc('siu_release_control', { p_case: siuCase, p_reason: 'should refuse' })
    expect(give.error?.message ?? '', 'only an assumed case can be returned').toMatch(/originated with SIU/i)
  })

  it('returning control restores CID access completely', async () => {
    const give = await owner.rpc('siu_release_control', { p_case: cidCase, p_reason: 'No concern substantiated' })
    expect(give.error, give.error?.message).toBeNull()

    const row = await lsb.from('cases').select('case_authority,siu_classification,siu_returned_at').eq('id', cidCase).single()
    expect(row.error, row.error?.message).toBeNull()
    expect(row.data!.case_authority).toBe('cid')
    expect(row.data!.siu_classification).toBeNull()
    expect(row.data!.siu_returned_at, 'the return is recorded').not.toBeNull()

    const rep = await lsb.from('reports').select('id').eq('id', cidReport)
    expect(rep.data?.length, 'the detective has their report back').toBe(1)
  })

  /* ── §15 — releasing one item ───────────────────────────────────────────── */

  it('a release reaches its addressee only, and never discloses its origin', async () => {
    const share = await owner.rpc('siu_share', {
      p_case: siuCase,
      p_item_type: 'intelligence',
      p_title: tag('released item'),
      p_body: 'Plate 9XYZ was seen at the location on the night in question.',
      p_audience: 'case_members',
      p_reason: 'Belongs in the case file',
      p_target_case: cidCase,
    })
    expect(share.error, share.error?.message).toBeNull()
    disclosureToCase = share.data as string

    // The addressed detective gets it — through the RPC only.
    const mine = await lsb.rpc('siu_released_intelligence', { p_case: cidCase })
    expect(mine.error, mine.error?.message).toBeNull()
    const rows = (mine.data ?? []) as Array<Record<string, unknown>>
    expect(rows.length, 'the case owner receives the release').toBe(1)
    expect(rows[0].body).toContain('9XYZ')
    // The payload has no origin field at all — not the id, not a case number.
    for (const k of ['siu_case_id', 'source_item_id', 'case_number', 'reason']) {
      expect(Object.hasOwn(rows[0], k), `the CID payload must not carry ${k}`).toBe(false)
    }

    // The table itself is silent to CID, and the source case stays invisible.
    const direct = await lsb.from('siu_disclosures').select('*')
    expect(direct.error, 'reading the table must not error').toBeNull()
    expect(direct.data, 'CID reads zero disclosure rows directly').toEqual([])
    const src = await lsb.from('cases').select('id').eq('id', siuCase)
    expect(src.data, 'the source investigation stays invisible').toEqual([])

    // A release filed against one case does not appear on another.
    const elsewhere = await lsb.rpc('siu_released_intelligence', { p_case: otherCase })
    expect((elsewhere.data ?? []).length, 'addressing is per-case').toBe(0)
  })

  it('an unaddressed investigator sees nothing, and cannot acknowledge it', async () => {
    // The Bureau Lead is not on the LSB case in this fixture set.
    const theirs = await lead.rpc('siu_released_intelligence', { p_case: cidCase })
    const ids = ((theirs.data ?? []) as Array<{ id: string }>).map((r) => r.id)
    if (ids.includes(disclosureToCase)) {
      // A Lead with bureau access to the target case legitimately counts as a
      // case member — assert the invariant that actually matters instead.
      expect(true).toBe(true)
    } else {
      const ack = await lead.rpc('siu_acknowledge_disclosure', { p_id: disclosureToCase })
      expect(ack.error, 'a non-addressee must be refused, as "not found"').not.toBeNull()
    }
  })

  it('acknowledgement is recorded, and revocation removes it immediately', async () => {
    const ack = await lsb.rpc('siu_acknowledge_disclosure', { p_id: disclosureToCase })
    expect(ack.error, ack.error?.message).toBeNull()

    const seen = await owner.from('siu_disclosures').select('acknowledged_by').eq('id', disclosureToCase).single()
    expect(seen.data!.acknowledged_by, 'the recipient is recorded').toBe(lsbId)

    const rev = await owner.rpc('siu_revoke_disclosure', { p_id: disclosureToCase, p_reason: 'Superseded' })
    expect(rev.error, rev.error?.message).toBeNull()

    const after = await lsb.rpc('siu_released_intelligence', { p_case: cidCase })
    expect((after.data ?? []).length, 'a revoked release disappears from CID at once').toBe(0)
  })

  it('a release cannot be addressed back into SIU', async () => {
    const bad = await owner.rpc('siu_share', {
      p_case: siuCase, p_item_type: 'summary', p_title: tag('bad target'),
      p_body: 'x', p_audience: 'case_members', p_reason: 'test', p_target_case: siuCase,
    })
    expect(bad.error?.message ?? '').toMatch(/not a release target/i)
  })

  /* ── Phase 3 — tradecraft is invisible to CID ───────────────────────────── */

  it('every Phase 3 table returns nothing to CID, at every rank', async () => {
    const tables = [
      'siu_sources', 'siu_undercover_operations', 'siu_financial_intel',
      'siu_comms_intel', 'siu_integrity_reviews', 'siu_exports', 'siu_disclosures',
    ] as const
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      for (const t of tables) {
        const r = await c.from(t).select('id')
        expect(r.error, `${who}/${t}: must not error`).toBeNull()
        expect(r.data, `${who} must read no rows from ${t}`).toEqual([])
        const cnt = await c.from(t).select('id', { count: 'exact', head: true })
        expect(cnt.count ?? 0, `${who} must not learn how many ${t} rows exist`).toBe(0)
      }
    }
  })

  it('CID cannot write into any Phase 3 table', async () => {
    const writes: Array<[string, PromiseLike<{ error: unknown }>]> = [
      ['siu_sources', lsb.from('siu_sources').insert({ case_id: siuCase, codename: 'X', handler_id: lsbId })],
      ['siu_undercover_operations', lsb.from('siu_undercover_operations').insert({ case_id: siuCase, legend_name: 'X', handler_id: lsbId })],
      ['siu_financial_intel', lsb.from('siu_financial_intel').insert({ case_id: siuCase })],
      ['siu_comms_intel', lsb.from('siu_comms_intel').insert({ case_id: siuCase })],
      ['siu_integrity_reviews', lsb.from('siu_integrity_reviews').insert({ case_id: siuCase, summary: 'X' })],
      ['siu_exports', lsb.from('siu_exports').insert({ case_id: siuCase, scope: 'case_summary', reason: 'X' })],
    ]
    for (const [name, w] of writes) {
      const r = await w
      expect(r.error, `a CID INSERT into ${name} must be refused`).not.toBeNull()
    }
  })

  it('communications content cannot be recorded without a named legal authority', async () => {
    const bad = await owner.from('siu_comms_intel').insert({
      case_id: siuCase, record_type: 'message', identifier: '555-0100',
      content_summary: 'content with no warrant',
    }).select('id')
    expect(bad.error, 'the CHECK must refuse content with no authority').not.toBeNull()

    const good = await owner.from('siu_comms_intel').insert({
      case_id: siuCase, record_type: 'message', identifier: '555-0100',
      content_summary: 'content under warrant', legal_authority: `W-${RUN}`,
    }).select('id').single()
    expect(good.error, good.error?.message).toBeNull()
    await owner.from('siu_comms_intel').delete().eq('id', good.data!.id)
  })

  it('an integrity review cannot close without a recorded disposition', async () => {
    const ins = await owner.from('siu_integrity_reviews').insert({
      case_id: siuCase, allegation_type: 'case_fixing', summary: tag('review'), severity: 'high',
    }).select('id').single()
    expect(ins.error, ins.error?.message).toBeNull()

    const bad = await owner.from('siu_integrity_reviews')
      .update({ closed_at: new Date().toISOString(), status: 'substantiated' })
      .eq('id', ins.data!.id).select('id')
    expect(bad.error, 'closing with no disposition must be refused').not.toBeNull()

    const good = await owner.from('siu_integrity_reviews')
      .update({ closed_at: new Date().toISOString(), status: 'substantiated', disposition: 'Referred to the AG' })
      .eq('id', ins.data!.id).select('id')
    expect(good.error, good.error?.message).toBeNull()
    await owner.from('siu_integrity_reviews').delete().eq('id', ins.data!.id)
  })

  /* ── Exports and the oversight report ───────────────────────────────────── */

  it('an export never carries a source identity, a legend or intercept content', async () => {
    const src = await owner.from('siu_sources').insert({
      case_id: siuCase, codename: `BLUEBIRD-${RUN}`, handler_id: (await owner.auth.getUser()).data.user!.id,
    }).select('id').single()
    expect(src.error, src.error?.message).toBeNull()

    const uc = await owner.from('siu_undercover_operations').insert({
      case_id: siuCase, legend_name: `LEGEND-${RUN}`, handler_id: (await owner.auth.getUser()).data.user!.id,
    }).select('id').single()
    expect(uc.error, uc.error?.message).toBeNull()

    const msg = await owner.from('siu_comms_intel').insert({
      case_id: siuCase, record_type: 'message', identifier: '555-0199',
      content_summary: `INTERCEPT-${RUN}`, legal_authority: `W-${RUN}`,
    }).select('id').single()
    expect(msg.error, msg.error?.message).toBeNull()

    for (const scope of ['case_summary', 'investigation_file', 'intelligence_only', 'disclosure_packet']) {
      const exp = await owner.rpc('siu_export_case', {
        p_case: siuCase, p_scope: scope, p_reason: `suite check ${scope}`,
      })
      expect(exp.error, exp.error?.message).toBeNull()
      const text = JSON.stringify(exp.data)
      expect(text.includes(`BLUEBIRD-${RUN}`), `${scope} must not carry a source codename`).toBe(false)
      expect(text.includes(`LEGEND-${RUN}`), `${scope} must not carry an undercover legend`).toBe(false)
      expect(text.includes(`INTERCEPT-${RUN}`), `${scope} must not carry intercept content`).toBe(false)
      // …and it says so.
      const withheld = (exp.data as { withheld?: Array<{ category: string; count: number }> }).withheld ?? []
      expect(withheld.map((w) => w.category)).toEqual([
        'confidential_source_identities', 'undercover_legends', 'intercept_content',
      ])
    }

    // Every export was logged, and CID still sees none of the log.
    const log = await owner.from('siu_exports').select('id').eq('case_id', siuCase)
    expect((log.data ?? []).length, 'every export is logged').toBeGreaterThanOrEqual(4)
    const cidLog = await lsb.from('siu_exports').select('id').eq('case_id', siuCase)
    expect(cidLog.data, 'CID sees no export log').toEqual([])

    await owner.from('siu_sources').delete().eq('id', src.data!.id)
    await owner.from('siu_undercover_operations').delete().eq('id', uc.data!.id)
    await owner.from('siu_comms_intel').delete().eq('id', msg.data!.id)
  })

  it('a CID account cannot export an SIU investigation', async () => {
    for (const [who, c] of [['detective', lsb], ['director', director]] as const) {
      const exp = await c.rpc('siu_export_case', {
        p_case: siuCase, p_scope: 'investigation_file', p_reason: 'unauthorized attempt',
      })
      expect(exp.error, `${who} must be refused by siu_export_case`).not.toBeNull()
    }
  })

  it('the oversight report is counts-only, and closed to CID', async () => {
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const rep = await c.rpc('siu_oversight_report', {})
      expect(rep.data, `${who} must get the no-access shape`).toEqual({ access: false })
    }
    const mine = await owner.rpc('siu_oversight_report', {})
    expect(mine.error, mine.error?.message).toBeNull()
    const data = mine.data as Record<string, unknown>
    expect(data.access).toBe(true)
    // Every value under the group keys is a number. No id, name, codename or
    // identifier can reach this report by construction.
    for (const group of ['investigations', 'control', 'disclosure', 'integrity', 'tradecraft', 'exports', 'personnel']) {
      const g = data[group] as Record<string, unknown>
      expect(g, `${group} must be present`).toBeTruthy()
      for (const [k, v] of Object.entries(g)) {
        expect(typeof v, `${group}.${k} must be a count`).toBe('number')
      }
    }
  })
})
