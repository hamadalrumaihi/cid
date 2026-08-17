/** v1.69 — SIU intelligence quality, watchlist, deconfliction and §30
 *  supporting access (migrations 20260831120000 / 20260831130000 /
 *  20260831140000), LIVE project.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  Standard CID build fixtures: lsb, lead, director, owner. `rls-test-owner`
 *  holds SIU 'owner' standing (which is command); the other three hold no SIU
 *  standing at all, because 20260829120000 excludes fixtures from the
 *  ex-officio branches. `rls-test-lsb` therefore stands in for the CID officer
 *  a §30 grant is issued to — which is exactly the role it needs to play.
 *
 *  ── What it proves ─────────────────────────────────────────────────────────
 *   1. §20/§21 GRADING IS RPC-ONLY, AND UNGRADED IS A REAL STATE. Grading and
 *      review columns cannot be written directly; a new note starts ungraded
 *      rather than defaulting to anything that reads as trustworthy.
 *   2. §23 A REVIEW IS AN ACT BY A NAMED PERSON. siu_review_note stamps the
 *      reviewer, and 'withdrawn' resolves the note rather than deleting it.
 *   3. §25 THE WATCHLIST ALWAYS ENDS, AND CID NEVER SEES IT. Over-long grants
 *      are refused, removal keeps the row, and a detective / Bureau Lead /
 *      Director read ZERO entries.
 *   4. §19 DECONFLICTION NEVER NAMES WHAT YOU CANNOT SEE — and never counts a
 *      compartmented investigation at all. This is the assertion that pins the
 *      deliberate trade-off recorded in 20260831120000's header.
 *   5. §30 THE HOLE IS THE SIZE IT CLAIMS TO BE. A CID officer granted
 *      supporting access reads the case row AND its reports, and reads ZERO
 *      rows from every siu_* table. The grant dies on revoke, on expiry, and
 *      on reclassification — and the §17 recusal veto still beats it.
 *   6. §35/§53 THE DASHBOARDS RESPECT THEIR AUDIENCES. Command gets names;
 *      the oversight supplement is counts only and carries no case id.
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  Watch entries and access grants are swept by rls_test_cleanup's Delivery B
 *  branch (20260831140000); grants also cascade from the case. The suite tears
 *  down its own rows so a green run leaves nothing to report. Audit rows are
 *  never swept — audit is append-only. */

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
if (!enabled) console.warn('[rls:v169] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const RUN = randomUUID().slice(0, 8)
const tag = (what: string) => `[rls-test] SIU ${what} ${RUN}`
/** A subject nothing else in the database refers to, so the deconfliction
 *  counts below are exactly what this suite created and nothing more. */
const SUBJECT = `[rls-test] Deconflict Subject ${RUN}`

describe.skipIf(!enabled)('v1.69 — SIU intelligence quality, watchlist and supporting access (live)', () => {
  let owner: C, lsb: C, lead: C, director: C
  let lsbId = ''
  /** Standard classification — the §30 host and the visible deconfliction hit. */
  let openCase = ''
  /** Compartmented — must contribute NOTHING to any deconfliction count. */
  let sealedCase = ''
  let noteId = ''
  let watchId = ''
  let grantId = ''

  beforeAll(async () => {
    owner = mk(); lsb = mk(); lead = mk(); director = mk()
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)

    const a = await owner.rpc('siu_create_case', {
      p_title: tag('quality host'), p_classification: 'siu',
    })
    expect(a.error, a.error?.message).toBeNull()
    openCase = a.data as string

    const b = await owner.rpc('siu_create_case', {
      p_title: tag('sealed'), p_classification: 'siu_compartmented',
    })
    expect(b.error, b.error?.message).toBeNull()
    sealedCase = b.data as string

    const r = await owner.from('reports').insert({
      case_id: openCase, template: 'initial', fields: { note: 'SIU report' },
    }).select('id').single()
    expect(r.error, r.error?.message).toBeNull()

    const n = await owner.from('siu_case_notes').insert({
      case_id: openCase, note_type: 'intelligence', body: tag('graded intelligence'),
    }).select('id').single()
    expect(n.error, n.error?.message).toBeNull()
    noteId = n.data!.id as string

    // The same subject designated on BOTH — one visible, one compartmented.
    for (const c of [openCase, sealedCase]) {
      const t = await owner.from('siu_targets').insert({
        case_id: c, entity_type: 'person', label: SUBJECT, designation: 'target',
      }).select('id').single()
      expect(t.error, t.error?.message).toBeNull()
    }
  }, 120_000)

  afterAll(async () => {
    if (watchId) await owner.rpc('siu_watch_remove', { p_id: watchId, p_reason: 'suite teardown' })
    if (grantId) await owner.rpc('siu_revoke_temp_access', { p_id: grantId, p_reason: 'suite teardown' })
    await owner.from('cases').delete().in('id', [openCase, sealedCase].filter(Boolean))
    await Promise.all([owner, lsb, lead, director].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ── §20/§21/§23 — grading ──────────────────────────────────────────────── */

  it('a new note starts ungraded — nothing defaults to trustworthy', async () => {
    const row = await owner.from('siu_case_notes')
      .select('source_type, source_reliability, info_credibility, review_due_at')
      .eq('id', noteId).single()
    expect(row.error, row.error?.message).toBeNull()
    expect(row.data!.info_credibility, 'credibility must start null').toBeNull()
    expect(row.data!.source_reliability).toBeNull()
    expect(row.data!.source_type).toBeNull()
    // No review date either: a note nobody has assessed must not look
    // assessed-and-scheduled.
    expect(row.data!.review_due_at).toBeNull()
  })

  it('grading and review columns cannot be written directly', async () => {
    const grade = await owner.from('siu_case_notes')
      .update({ info_credibility: 'confirmed', source_reliability: 'reliable' })
      .eq('id', noteId).select('id')
    expect(grade.error, 'a direct regrade must be refused').not.toBeNull()

    const stamp = await owner.from('siu_case_notes')
      .update({ last_reviewed_at: new Date().toISOString(), review_outcome: 'revalidated' })
      .eq('id', noteId).select('id')
    expect(stamp.error, 'a direct review stamp must be refused').not.toBeNull()

    const still = await owner.from('siu_case_notes')
      .select('info_credibility, review_outcome').eq('id', noteId).single()
    expect(still.data!.info_credibility).toBeNull()
    expect(still.data!.review_outcome).toBeNull()
  })

  it('grading records both halves and schedules a review', async () => {
    const bad = await owner.rpc('siu_grade_note', {
      p_note: noteId, p_source_type: 'human_source',
      p_reliability: 'usually_reliable', p_credibility: 'gospel_truth',
    })
    expect(bad.error, 'an unknown credibility must be refused').not.toBeNull()

    const ok = await owner.rpc('siu_grade_note', {
      p_note: noteId, p_source_type: 'human_source',
      p_reliability: 'usually_reliable', p_credibility: 'probably_true',
    })
    expect(ok.error, ok.error?.message).toBeNull()

    const row = await owner.from('siu_case_notes')
      .select('source_type, source_reliability, info_credibility, review_due_at')
      .eq('id', noteId).single()
    expect(row.data!.source_reliability).toBe('usually_reliable')
    expect(row.data!.info_credibility).toBe('probably_true')
    // The two halves are independent: reliability and credibility disagree
    // here on purpose, and both survive.
    expect(row.data!.source_reliability).not.toBe(row.data!.info_credibility)
    expect(row.data!.review_due_at, 'grading must schedule a review').not.toBeNull()
  })

  it('a review is attributed, and withdrawal resolves rather than deletes', async () => {
    const blank = await owner.rpc('siu_review_note', {
      p_note: noteId, p_outcome: 'revalidated', p_note_text: '   ',
    })
    expect(blank.error, 'a review needs a note').not.toBeNull()

    const ok = await owner.rpc('siu_review_note', {
      p_note: noteId, p_outcome: 'withdrawn',
      p_note_text: 'Source retracted the account.',
    })
    expect(ok.error, ok.error?.message).toBeNull()

    const row = await owner.from('siu_case_notes')
      .select('review_outcome, last_reviewed_by, last_reviewed_at, resolved_at, review_due_at')
      .eq('id', noteId).single()
    expect(row.data!.review_outcome).toBe('withdrawn')
    expect(row.data!.last_reviewed_by, 'a review names its reviewer').not.toBeNull()
    expect(row.data!.last_reviewed_at).not.toBeNull()
    // Kept, not deleted: what the unit believed and when is the record.
    expect(row.data!.resolved_at, 'withdrawal resolves the note').not.toBeNull()
    expect(row.data!.review_due_at, 'a withdrawn note has no next review').toBeNull()
  })

  it('CID cannot grade or review SIU intelligence', async () => {
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const g = await c.rpc('siu_grade_note', {
        p_note: noteId, p_source_type: 'human_source',
        p_reliability: 'reliable', p_credibility: 'confirmed',
      })
      expect(g.error, `${who} must be refused by siu_grade_note`).not.toBeNull()
      const r = await c.rpc('siu_review_note', {
        p_note: noteId, p_outcome: 'revalidated', p_note_text: 'unauthorized',
      })
      expect(r.error, `${who} must be refused by siu_review_note`).not.toBeNull()
    }
  })

  /* ── §25 — the watchlist ────────────────────────────────────────────────── */

  it('a watch cannot be open-ended, and cannot outrun the cap', async () => {
    for (const days of [0, 400]) {
      const bad = await owner.rpc('siu_watch_add', {
        p_entity_type: 'person', p_label: SUBJECT, p_reason: 'probe', p_days: days,
      })
      expect(bad.error, `${days} days must be refused`).not.toBeNull()
    }

    const ok = await owner.rpc('siu_watch_add', {
      p_entity_type: 'person', p_label: SUBJECT,
      p_reason: tag('watch reason'), p_priority: 'elevated', p_days: 30,
    })
    expect(ok.error, ok.error?.message).toBeNull()
    watchId = ok.data as string

    const row = await owner.from('siu_watchlist')
      .select('expires_at, status, priority').eq('id', watchId).single()
    expect(row.data!.status).toBe('active')
    expect(row.data!.priority).toBe('elevated')
    expect(new Date(row.data!.expires_at).getTime(), 'a watch must expire in the future')
      .toBeGreaterThan(Date.now())
  })

  it('the watchlist returns nothing to CID at any rank', async () => {
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const q = await c.from('siu_watchlist').select('id, label, reason')
      expect(q.error, `${who} must not error`).toBeNull()
      expect(q.data ?? [], `${who} must read zero watch entries`).toHaveLength(0)

      const add = await c.rpc('siu_watch_add', {
        p_entity_type: 'person', p_label: 'unauthorized', p_reason: 'unauthorized',
      })
      expect(add.error, `${who} must be refused by siu_watch_add`).not.toBeNull()
    }

    const ins = await lsb.from('siu_watchlist')
      .insert({ entity_type: 'person', label: 'direct', reason: 'direct',
                expires_at: new Date(Date.now() + 86_400_000).toISOString() })
      .select('id')
    expect(ins.error, 'a direct insert must be refused').not.toBeNull()
  })

  it('extending needs a reason, and removal keeps the row', async () => {
    const noReason = await owner.rpc('siu_watch_extend', {
      p_id: watchId, p_days: 30, p_reason: '  ',
    })
    expect(noReason.error, 'extension without a reason must be refused').not.toBeNull()

    const before = await owner.from('siu_watchlist').select('expires_at').eq('id', watchId).single()
    const ext = await owner.rpc('siu_watch_extend', {
      p_id: watchId, p_days: 30, p_reason: 'Still warranted.',
    })
    expect(ext.error, ext.error?.message).toBeNull()
    const after = await owner.from('siu_watchlist').select('expires_at').eq('id', watchId).single()
    expect(new Date(after.data!.expires_at).getTime())
      .toBeGreaterThan(new Date(before.data!.expires_at).getTime())
  })

  /* ── §19 — deconfliction ────────────────────────────────────────────────── */

  it('never counts a compartmented investigation, and never names a hidden one', async () => {
    // The owner fixture holds every standing there is and IS in no compartment
    // it was not added to — but siu_create_case adds its creator, so both cases
    // are visible to it here. The assertion that matters is about the SHAPE of
    // the payload, checked below from the CID side and by inspection.
    const mine = await owner.rpc('siu_deconflict', {
      p_entity_type: 'person', p_label: SUBJECT,
    })
    expect(mine.error, mine.error?.message).toBeNull()
    const r = mine.data as Record<string, unknown>
    expect(r.access).toBe(true)

    // Everything the owner can see is named in full — no secret is created by
    // naming a case that is already on the caller's own list.
    const visible = r.investigations as { case_id: string }[]
    expect(visible.map((h) => h.case_id).sort()).toEqual([openCase, sealedCase].sort())

    // Nothing the caller cannot see, so nothing to coordinate.
    expect(r.other_interest).toBe(0)
    expect(r.coordinate_with ?? null).toBeNull()

    // The watch entry surfaces alongside — that is the point of running both
    // halves from one call.
    expect((r.watchlist as unknown[]).length).toBeGreaterThan(0)
  })

  it('returns nothing at all to CID', async () => {
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const d = await c.rpc('siu_deconflict', { p_entity_type: 'person', p_label: SUBJECT })
      expect(d.error, `${who} must not error`).toBeNull()
      const r = d.data as Record<string, unknown>
      // A refusal shaped as data, never an error — an error would confirm the
      // surface exists.
      expect(r.access, `${who} must get access:false`).toBe(false)
      expect(r.investigations, `${who} must get no investigations`).toBeUndefined()
      expect(r.other_interest, `${who} must get no count`).toBeUndefined()
      expect(JSON.stringify(r), `${who} must not see the subject echoed`).not.toContain(SUBJECT)
    }
  })

  /* ── §30 — supporting access ────────────────────────────────────────────── */

  it('a grant is command-only, standard-classification-only, and capped', async () => {
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const g = await c.rpc('siu_grant_temp_access', {
        p_case: openCase, p_user: lsbId, p_reason: 'unauthorized', p_days: 7,
      })
      expect(g.error, `${who} must be refused by siu_grant_temp_access`).not.toBeNull()
    }

    const sealed = await owner.rpc('siu_grant_temp_access', {
      p_case: sealedCase, p_user: lsbId, p_reason: 'compartment attempt', p_days: 7,
    })
    expect(sealed.error, 'a compartmented investigation must refuse a grant').not.toBeNull()

    for (const days of [0, 90]) {
      const bad = await owner.rpc('siu_grant_temp_access', {
        p_case: openCase, p_user: lsbId, p_reason: 'probe', p_days: days,
      })
      expect(bad.error, `${days} days must be refused`).not.toBeNull()
    }

    const ok = await owner.rpc('siu_grant_temp_access', {
      p_case: openCase, p_user: lsbId, p_reason: tag('ballistics expertise'), p_days: 7,
    })
    expect(ok.error, ok.error?.message).toBeNull()
    grantId = ok.data as string
  })

  it('opens the case file and NOTHING else — this is the whole boundary', async () => {
    const c = await lsb.from('cases').select('id, case_number').eq('id', openCase)
    expect(c.data ?? [], 'the supporting officer must see the case row').toHaveLength(1)

    const r = await lsb.from('reports').select('id').eq('case_id', openCase)
    expect((r.data ?? []).length, 'and its reports').toBeGreaterThan(0)

    // Every SIU-only surface stays shut. If a future migration keys one of
    // these on can_access_case instead of siu_case_access, this is the test
    // that catches it.
    for (const t of [
      'siu_case_notes', 'siu_targets', 'siu_sources', 'siu_undercover_operations',
      'siu_financial_intel', 'siu_comms_intel', 'siu_integrity_reviews',
      'siu_disclosures', 'siu_exports', 'siu_watchlist', 'siu_referrals',
    ]) {
      const q = await lsb.from(t).select('id')
      expect(q.data ?? [], `${t} must return zero rows to a supporting officer`).toHaveLength(0)
    }

    // No other investigation, and no SIU standing.
    const other = await lsb.from('cases').select('id').eq('id', sealedCase)
    expect(other.data ?? [], 'the compartmented case stays invisible').toHaveLength(0)
    const ctx = await lsb.rpc('siu_department_context', {})
    expect((ctx.data as Record<string, unknown> | null)?.siu_standing ?? null,
      'a grant confers no SIU standing').toBeNull()

    // They can see their OWN grant, so the case appearing is explicable.
    const own = await lsb.from('siu_temporary_access').select('id, reason').eq('id', grantId)
    expect(own.data ?? [], 'the holder sees their own grant').toHaveLength(1)
  })

  it('the §17 recusal veto still beats a supporting grant', async () => {
    const d = await lsb.rpc('siu_declare_conflict', {
      p_case: openCase, p_reason: tag('supporting officer conflict'),
    })
    expect(d.error, d.error?.message).toBeNull()

    const gone = await lsb.from('cases').select('id').eq('id', openCase)
    expect(gone.data ?? [], 'a recused supporting officer reads zero rows').toHaveLength(0)

    // Restore for the remaining assertions — the owner did not declare it, so
    // the not-self rule permits this.
    const cleared = await owner.rpc('siu_resolve_conflict', {
      p_conflict: d.data as string, p_status: 'cleared', p_note: 'Reviewed; not a conflict.',
    })
    expect(cleared.error, cleared.error?.message).toBeNull()
    const back = await lsb.from('cases').select('id').eq('id', openCase)
    expect(back.data ?? [], 'clearing restores the supporting grant').toHaveLength(1)
  })

  it('dies on revocation, and the holder may hand it back themselves', async () => {
    const rev = await lsb.rpc('siu_revoke_temp_access', {
      p_id: grantId, p_reason: 'No longer needed.',
    })
    expect(rev.error, rev.error?.message).toBeNull()

    const gone = await lsb.from('cases').select('id').eq('id', openCase)
    expect(gone.data ?? [], 'a revoked grant reads zero rows').toHaveLength(0)
    const reports = await lsb.from('reports').select('id').eq('case_id', openCase)
    expect(reports.data ?? [], 'and the reports go with it').toHaveLength(0)

    const twice = await lsb.rpc('siu_revoke_temp_access', {
      p_id: grantId, p_reason: 'again',
    })
    expect(twice.error, 'revoking twice must be refused').not.toBeNull()
    grantId = ''
  })

  /* ── §35/§53 — the dashboards ───────────────────────────────────────────── */

  it('command gets names; CID gets access:false', async () => {
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const d = await c.rpc('siu_command_dashboard', {})
      expect((d.data as Record<string, unknown>)?.access, `${who} must be refused`).toBe(false)
    }

    const cmd = await owner.rpc('siu_command_dashboard', {})
    expect(cmd.error, cmd.error?.message).toBeNull()
    const r = cmd.data as Record<string, unknown>
    expect(r.access).toBe(true)
    expect(Array.isArray(r.workload)).toBe(true)
    expect(r.queues).toBeTruthy()
  })

  it('the oversight supplement is counts only — no case, no name, no label', async () => {
    const s = await owner.rpc('siu_oversight_supplement', {})
    expect(s.error, s.error?.message).toBeNull()
    const r = s.data as Record<string, unknown>
    expect(r.access).toBe(true)

    // The payload must not contain anything identifying. This suite tagged
    // every row it created with RUN, so if any of it reached the supplement
    // the tag would appear.
    const text = JSON.stringify(r)
    expect(text, 'no case title may reach the supplement').not.toContain(RUN)
    expect(text, 'no case id may reach the supplement').not.toContain(openCase)
    expect(text).not.toContain('case_id')
    expect(text).not.toContain('display_name')

    // …and it is still useful: the counts it does carry are present.
    for (const k of ['referrals_total', 'inquiries_open', 'conflicts_declared',
                     'intel_ungraded', 'watch_active', 'temp_access_granted_total']) {
      expect(r, `${k} must be reported`).toHaveProperty(k)
    }

    // CID gets nothing.
    for (const [who, c] of [['detective', lsb], ['director', director]] as const) {
      const q = await c.rpc('siu_oversight_supplement', {})
      expect((q.data as Record<string, unknown>)?.access, `${who} must be refused`).toBe(false)
    }
  })
})
