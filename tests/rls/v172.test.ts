/** v1.72 — targets and intelligence can be CREATED, and only by the right
 *  people (migrations 20260903150000 / 20260903160000), LIVE project.
 *
 *  ── What was actually wrong ────────────────────────────────────────────────
 *  Both tables had INSERT policies and no way to reach them. The Targets tab
 *  listed designations with no action to make one; the Intelligence tab could
 *  grade and review notes but not write one. `siu_targets` was therefore empty
 *  — not a clean slate, a feature nobody could use.
 *
 *  So the first thing this suite pins is unglamorous and important: the write
 *  paths exist and work end to end.
 *
 *  ── The rules worth a regression test ──────────────────────────────────────
 *  Each of these is a decision that could plausibly be "simplified" away:
 *
 *    * A designation names a REGISTRY RECORD. A ghost id is refused, and so is
 *      a typed person with no id — the defect the watchlist had to be migrated
 *      out of, kept out of targets by construction rather than by convention.
 *    * ONE live designation per subject per case. Otherwise the same person is
 *      `associate` and `priority_target` at once and "what is their standing?"
 *      has two answers.
 *    * `cleared` cannot be an OPENING designation. It is an outcome; opening
 *      one would assert the unit looked when it never did.
 *    * Clearing KEEPS the row. Somebody wrongly designated is entitled to the
 *      record showing they were cleared.
 *    * A note recorded against a CID case is invisible to that case's own
 *      detectives — the property the whole SIU layer exists for. Asserted from
 *      the CID side, because asserting it from the SIU side proves nothing.
 *    * Grading is settable at AUTHORSHIP and only there.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  `rls-test-owner` holds SIU standing. `rls-test-lsb` is an ordinary CID
 *  detective and owns the CID case used as the concern's subject, so its
 *  blindness to the note is measured on a case it can definitely otherwise
 *  read in full. `rls-test-lead` is a CID Bureau Lead — rank is not standing.
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  Non-destructive and self-cleaning: one person, one SIU investigation and one
 *  CID case, all created here and all torn down. Notes and designations cascade
 *  from their cases. No fixture reset, nothing pre-existing touched. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
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
if (!enabled) console.warn('[rls:v172] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const RUN = randomUUID().slice(0, 8)
const tag = (what: string) => `[rls-test] ${what} ${RUN}`

describe.skipIf(!enabled)('v1.72 — designating and recording (live)', () => {
  let owner: C, lsb: C, lead: C
  let personId = ''
  let siuCase = ''
  let cidCase = ''
  let targetId = ''
  let noteId = ''
  const personName = tag('designation subject')

  beforeAll(async () => {
    owner = mk(); lsb = mk(); lead = mk()
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)

    const p = await lsb.from('persons').insert({ name: personName }).select('id').single()
    expect(p.error, p.error?.message).toBeNull()
    personId = p.data!.id as string

    const s = await owner.rpc('siu_create_case', {
      p_title: tag('designation subject case'), p_classification: 'siu',
    })
    expect(s.error, s.error?.message).toBeNull()
    siuCase = s.data as string

    const c = await lsb.from('cases').insert({
      case_number: `MCB-${Date.now().toString().slice(-6)}`,
      title: tag('cid case under concern'), bureau: 'major_crimes',
    }).select('id').single()
    expect(c.error, c.error?.message).toBeNull()
    cidCase = c.data!.id as string
  }, 90_000)

  afterAll(async () => {
    // Designations and notes cascade with their cases.
    if (siuCase) await owner.from('cases').delete().eq('id', siuCase)
    if (cidCase) await lsb.from('cases').delete().eq('id', cidCase)
    if (personId) await lsb.from('persons').delete().eq('id', personId)
    await Promise.all([owner, lsb, lead].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ------------------------------------------------------------- targets */

  it('designates a registry record', async () => {
    const r = await owner.rpc('siu_designate_target', {
      p_case: siuCase, p_entity_type: 'person', p_entity_id: personId,
      p_designation: 'subject', p_priority: 'high', p_role: 'distribution',
    })
    expect(r.error, r.error?.message).toBeNull()
    targetId = r.data as string

    const row = await owner.from('siu_targets')
      .select('person_id, label, entity_id, designation').eq('id', targetId).single()
    expect(row.error, row.error?.message).toBeNull()
    expect(row.data!.person_id).toBe(personId)
    expect(row.data!.label, 'a linked designation stores no name of its own').toBeNull()
    // entity_id is kept in step so siu_deconflict(), which reads it, keeps
    // seeing this designation. Letting it drift to null would blind the
    // collision check exactly as it was blinded on the watchlist.
    expect(row.data!.entity_id, 'entity_id tracks the typed reference').toBe(personId)
  })

  it('refuses a subject that is not in the registry', async () => {
    const ghost = await owner.rpc('siu_designate_target', {
      p_case: siuCase, p_entity_type: 'person', p_entity_id: randomUUID(),
      p_designation: 'subject',
    })
    expect(ghost.error, 'a designation must name a real record').not.toBeNull()

    const noId = await owner.rpc('siu_designate_target', {
      p_case: siuCase, p_entity_type: 'person', p_designation: 'subject',
    })
    expect(noId.error, 'a typed person designation must name a record').not.toBeNull()
  })

  it('refuses a SECOND live designation for the same subject in one case', async () => {
    const dup = await owner.rpc('siu_designate_target', {
      p_case: siuCase, p_entity_type: 'person', p_entity_id: personId,
      p_designation: 'priority_target',
    })
    expect(dup.error, 'one live standing per subject per investigation').not.toBeNull()
  })

  it('refuses to OPEN a designation as already cleared', async () => {
    // `cleared` is an outcome. Opening one would create a row asserting the
    // unit looked at somebody and cleared them, when it never looked.
    const r = await owner.rpc('siu_designate_target', {
      p_case: siuCase, p_entity_type: 'unknown',
      p_designation: 'cleared', p_label: tag('never looked'),
    })
    expect(r.error, 'cleared is recorded by siu_clear_target(), not opened').not.toBeNull()
  })

  it('reads the display name through the registry', async () => {
    const live = await owner.rpc('siu_targets_live', {})
    expect(live.error, live.error?.message).toBeNull()
    const row = (live.data as { id: string; display_name: string }[] | null ?? [])
      .find((r) => r.id === targetId)
    expect(row?.display_name, 'the name comes from persons, live').toBe(personName)
  })

  it('surfaces the designation on the person dossier', async () => {
    const d = await owner.rpc('siu_person_dossier', { p_person: personId })
    expect(d.error, d.error?.message).toBeNull()
    const targets = (d.data as { siu_targets: { id: string }[] }).siu_targets ?? []
    expect(targets.map((t) => t.id)).toContain(targetId)
  })

  it('clears a designation without deleting it, and requires a reason', async () => {
    const noReason = await owner.rpc('siu_clear_target', { p_id: targetId, p_reason: '  ' })
    expect(noReason.error, 'clearing somebody is a finding and needs one').not.toBeNull()

    const ok = await owner.rpc('siu_clear_target', {
      p_id: targetId, p_reason: tag('no involvement established'),
    })
    expect(ok.error, ok.error?.message).toBeNull()

    const row = await owner.from('siu_targets')
      .select('cleared_at, clearance_reason, designation').eq('id', targetId).single()
    expect(row.error, row.error?.message).toBeNull()
    expect(row.data!.cleared_at, 'the row survives its clearance').toBeTruthy()
    expect(row.data!.clearance_reason).toBeTruthy()
    expect(row.data!.designation).toBe('cleared')
  })

  it('lets the same subject be re-designated once cleared', async () => {
    // The unique index is partial on cleared_at for exactly this: people do get
    // re-designated, and the earlier clearance stays in the record.
    const again = await owner.rpc('siu_designate_target', {
      p_case: siuCase, p_entity_type: 'person', p_entity_id: personId,
      p_designation: 'person_of_interest',
    })
    expect(again.error, again.error?.message).toBeNull()
    expect(again.data).toBeTruthy()
  })

  it('a CID detective sees none of it', async () => {
    const live = await lsb.rpc('siu_targets_live', {})
    expect(live.error, live.error?.message).toBeNull()
    expect(live.data ?? [], 'designations are SIU-only').toHaveLength(0)

    const asLead = await lead.rpc('siu_targets_live', {})
    expect(asLead.error, asLead.error?.message).toBeNull()
    expect(asLead.data ?? [], 'CID command rank is not SIU standing').toHaveLength(0)
  })

  /* -------------------------------------------------------- intelligence */

  it('records a concern against a CID case, graded at authorship', async () => {
    const r = await owner.rpc('siu_record_intelligence', {
      p_case: cidCase,
      p_note_type: 'integrity_concern',
      p_body: tag('concern body'),
      p_severity: 'high',
      p_siu_case: siuCase,
      p_subject_person: personId,
      p_source_type: 'human_source',
      p_source_reliability: 'usually_reliable',
      p_info_credibility: 'probably_true',
      p_review_days: 30,
    })
    expect(r.error, r.error?.message).toBeNull()
    noteId = r.data as string

    const row = await owner.from('siu_case_notes')
      .select('info_credibility, source_reliability, review_due_at, last_reviewed_at, review_outcome')
      .eq('id', noteId).single()
    expect(row.error, row.error?.message).toBeNull()
    expect(row.data!.info_credibility, 'grading is settable at authorship').toBe('probably_true')
    expect(row.data!.review_due_at, 'graded intelligence gets a review date').toBeTruthy()
    // Creation is not a review. Somebody has to come back and check.
    expect(row.data!.last_reviewed_at, 'creating a note is not reviewing it').toBeNull()
    expect(row.data!.review_outcome).toBeNull()
  })

  it('leaves an ungraded note ungraded, with no review date', async () => {
    // Scheduling a review of something nobody has assessed would put a
    // meaningless date on the calendar; being visibly ungraded is the actual
    // next action.
    const r = await owner.rpc('siu_record_intelligence', {
      p_case: siuCase, p_note_type: 'intelligence', p_body: tag('ungraded body'),
    })
    expect(r.error, r.error?.message).toBeNull()

    const row = await owner.from('siu_case_notes')
      .select('info_credibility, review_due_at').eq('id', r.data as string).single()
    expect(row.error, row.error?.message).toBeNull()
    expect(row.data!.info_credibility).toBeNull()
    expect(row.data!.review_due_at, 'no grade, no review date').toBeNull()
  })

  it('refuses a subject who is not in the registry', async () => {
    const r = await owner.rpc('siu_record_intelligence', {
      p_case: siuCase, p_note_type: 'intelligence', p_body: tag('dangling subject'),
      p_subject_person: randomUUID(),
    })
    expect(r.error, 'a dangling subject never surfaces on the dossier').not.toBeNull()
  })

  it("THE POINT: the CID case's own detective cannot see the concern", async () => {
    // Asserted from the CID side. `rls-test-lsb` created cidCase and can read
    // every ordinary thing about it, which is what makes this measurement mean
    // something — the note is invisible despite full access to its case.
    const readsCase = await lsb.from('cases').select('id').eq('id', cidCase)
    expect(readsCase.data ?? [], 'the detective can still read their own case').toHaveLength(1)

    const direct = await lsb.from('siu_case_notes').select('id').eq('id', noteId)
    expect(direct.data ?? [], 'but not the SIU concern recorded against it').toHaveLength(0)

    const live = await lsb.rpc('siu_intelligence_live', {})
    expect(live.error, live.error?.message).toBeNull()
    expect(live.data ?? [], 'nor through the joined reader').toHaveLength(0)

    const asLead = await lead.rpc('siu_intelligence_live', {})
    expect(asLead.error, asLead.error?.message).toBeNull()
    expect(asLead.data ?? [], 'nor CID command').toHaveLength(0)
  })

  it('flags a CID-case note as such for the SIU reader', async () => {
    // The author must be told the note is hidden from CID rather than have to
    // infer it from where they happened to be standing.
    const live = await owner.rpc('siu_intelligence_live', {})
    expect(live.error, live.error?.message).toBeNull()
    const row = (live.data as { id: string; is_about_cid_case: boolean
                                subject_name: string | null }[] | null ?? [])
      .find((r) => r.id === noteId)
    expect(row, 'SIU sees the note it recorded').toBeTruthy()
    expect(row!.is_about_cid_case).toBe(true)
    expect(row!.subject_name, 'the subject is resolved from the registry').toBe(personName)
  })

  it('refuses to file a note under an investigation the author cannot work', async () => {
    // Otherwise a note lands in a compartment its own author cannot open,
    // where nobody expects it and they cannot find it again.
    const r = await owner.rpc('siu_record_intelligence', {
      p_case: cidCase, p_note_type: 'intelligence', p_body: tag('misfiled'),
      p_siu_case: cidCase,
    })
    expect(r.error, 'the holding investigation must be one you can work').not.toBeNull()
  })

  it('refuses to record anything from a caller without SIU standing', async () => {
    const r = await lsb.rpc('siu_record_intelligence', {
      p_case: cidCase, p_note_type: 'intelligence', p_body: tag('should be refused'),
    })
    expect(r.error, 'CID cannot write into the SIU layer').not.toBeNull()

    const t = await lsb.rpc('siu_designate_target', {
      p_case: siuCase, p_entity_type: 'person', p_entity_id: personId,
      p_designation: 'subject',
    })
    expect(t.error, 'nor designate a target').not.toBeNull()
  })
})
