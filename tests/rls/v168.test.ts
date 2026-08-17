/** v1.68 — SIU intake, case lifecycle and recusal (§14, §15, §17, §32, §33;
 *  migrations 20260830120000 / 20260830130000 / 20260830140000), LIVE project.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  Standard CID build fixtures: lsb, lead, director, owner. `rls-test-owner`
 *  carries `profiles.is_owner`, so it holds SIU 'owner' standing — which is
 *  command standing — and stands in for a Special Agent in Charge here. The
 *  other three hold NO SIU standing at all: the release gate is open, but
 *  migration 20260829120000 excludes test fixtures from the ex-officio
 *  branches, so `rls-test-director` gets no oversight. That is deliberate and
 *  it is what makes assertion 2 below meaningful.
 *
 *  ── What it proves ─────────────────────────────────────────────────────────
 *   1. THE DOOR IS OPEN TO EVERYONE. A plain detective can submit a referral —
 *      §14 is worthless if the people most likely to notice misconduct cannot
 *      report. Their receipt (siu_my_referrals) carries NO review column, so a
 *      referral cannot become an oracle about what SIU did with it.
 *   2. THE QUEUE IS CLOSED TO EVERYONE ELSE. A detective, a Bureau Lead and the
 *      Director read ZERO rows from siu_referrals and have no client write
 *      path. The Director matters most: a referral can NAME them.
 *   3. §15 AN INQUIRY IS TIGHTER THAN A CASE. A referral accepted as a
 *      preliminary inquiry is invisible to CID entirely, and promotion is the
 *      deliberate act that opens it. The stage is RPC-only.
 *   4. §17 A CONFLICT IS A VETO, NOT A SUBTRACTION. The declaring account loses
 *      read AND write on the investigation IMMEDIATELY — at command rank, with
 *      the owner flag set, holding every standing there is. It cannot clear its
 *      own conflict, and CID cannot reach the register at all.
 *   5. §33 CLOSING CARRIES WHY. A closure without a reason or a note is
 *      refused; a valid one records both, and the columns are RPC-only.
 *
 *  ── Known coverage gap ─────────────────────────────────────────────────────
 *  The RESTORE path — another member of command clearing the conflict, access
 *  coming back — is NOT covered here, and is not faked. `rls-test-owner` is the
 *  only fixture holding SIU command standing, and siu_resolve_conflict() refuses
 *  the agent who declared the conflict, so no fixture can clear the one this
 *  suite creates. Covering it needs a second SIU-standing fixture. It is
 *  asserted against a rolled-back live transaction instead (see the migration
 *  header for 20260830130000). Recording the gap beats a conditional early
 *  return that silently skips the assertions after it.
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  Referrals are swept by rls_test_cleanup's intake branch (20260830140000) on
 *  submitted_by / reviewed_by / subject_user_id, and conflicts cascade from the
 *  case. The suite still tears down its own rows so a green run leaves nothing
 *  for the sweep to report. Both cases opened by siu_review_referral are
 *  created by the OWNER fixture, so they are inside the namespace — which also
 *  means the recused case, which the suite itself can no longer delete, is
 *  still removed by the sweep (rls_test_cleanup runs as a definer and is not
 *  subject to the recusal). Audit rows are never swept — audit is
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
if (!enabled) console.warn('[rls:v168] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const RUN = randomUUID().slice(0, 8)
const tag = (what: string) => `[rls-test] SIU ${what} ${RUN}`

describe.skipIf(!enabled)('v1.68 — SIU intake, lifecycle and recusal (live)', () => {
  let owner: C, lsb: C, lead: C, director: C
  let directorId = ''
  /** Submitted by the detective, NAMING the Director as its subject. */
  let referral = ''
  /** A second referral, used for the decline path. */
  let referral2 = ''
  /** A third, opened as a full investigation for the §32/§33 assertions —
   *  deliberately a DIFFERENT case from the recused one, so closure is tested
   *  on a file the suite can still reach. */
  let referral3 = ''
  /** The preliminary inquiry opened from `referral`. Recused, terminally. */
  let inquiry = ''
  /** The full investigation opened from `referral3`. */
  let lifecycleCase = ''
  let conflictId = ''

  beforeAll(async () => {
    owner = mk(); lsb = mk(); lead = mk(); director = mk()
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    directorId = await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)
  }, 90_000)

  afterAll(async () => {
    // `inquiry` is deliberately NOT deleted here: the suite recuses its only
    // command fixture from it, and a recusal is exactly the thing that must
    // survive a delete attempt by the recused account. rls_test_cleanup sweeps
    // it — the function is a definer and is not subject to the veto.
    if (lifecycleCase) await owner.from('cases').delete().eq('id', lifecycleCase)
    await owner.from('siu_referrals').delete().in('id', [referral, referral2, referral3].filter(Boolean))
    await Promise.all([owner, lsb, lead, director].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ── §14 — the door, and the wall ───────────────────────────────────────── */

  it('any active member can submit a referral, naming anyone', async () => {
    // A detective reporting the DIRECTOR. Nothing in the RPC consults the
    // subject's seniority, which is the point of the whole mechanism.
    const r = await lsb.rpc('siu_submit_referral', {
      p_category: 'corruption',
      p_summary: tag('alleged evidence tampering'),
      p_detail: 'Narrative body that must never reach CID.',
      p_subject_user: directorId,
    })
    expect(r.error, r.error?.message).toBeNull()
    referral = r.data as string
    expect(referral).toBeTruthy()

    const r2 = await lsb.rpc('siu_submit_referral', {
      p_category: 'misconduct', p_summary: tag('second allegation'),
    })
    expect(r2.error, r2.error?.message).toBeNull()
    referral2 = r2.data as string

    const r3 = await lsb.rpc('siu_submit_referral', {
      p_category: 'organized_crime', p_summary: tag('third allegation'),
    })
    expect(r3.error, r3.error?.message).toBeNull()
    referral3 = r3.data as string
  })

  it('the submitter gets a receipt carrying no review column', async () => {
    const mine = await lsb.rpc('siu_my_referrals', {})
    expect(mine.error, mine.error?.message).toBeNull()
    const rows = (mine.data ?? []) as Record<string, unknown>[]
    const own = rows.find((x) => x.id === referral)
    expect(own, 'the submitter must see their own referral').toBeTruthy()

    // The exact shape matters more than the values. If a review column ever
    // leaks into this projection, submitting a referral becomes a way to probe
    // what SIU is doing — including, for a subject, whether they are a target.
    expect(Object.keys(own!).sort()).toEqual(
      ['acknowledged', 'category', 'id', 'submitted_at', 'summary'],
    )
    for (const leak of ['status', 'review_note', 'reviewed_by', 'reviewed_at', 'opened_case_id', 'detail']) {
      expect(own, `siu_my_referrals must not expose ${leak}`).not.toHaveProperty(leak)
    }
  })

  it('the intake queue returns nothing to CID — the named Director included', async () => {
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const q = await c.from('siu_referrals').select('id, summary, detail')
      // No error and no rows: the ordinary "nothing here" answer, never a
      // permission failure that would confirm the table has contents.
      expect(q.error, `${who} must not error`).toBeNull()
      expect(q.data ?? [], `${who} must read zero referrals`).toHaveLength(0)
    }
  })

  it('CID has no client write path into the queue', async () => {
    const ins = await lsb.from('siu_referrals')
      .insert({ category: 'other', summary: tag('direct insert') }).select('id')
    expect(ins.error, 'a direct insert into siu_referrals must be refused').not.toBeNull()

    const upd = await director.from('siu_referrals')
      .update({ status: 'declined', review_note: 'forged' }).eq('id', referral).select('id')
    // Either an outright refusal or zero affected rows — both mean the Director
    // cannot dispose of a referral naming them.
    expect(upd.error ? true : (upd.data ?? []).length === 0).toBe(true)
  })

  it('reviewing a referral is field-only', async () => {
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const rev = await c.rpc('siu_review_referral', {
        p_referral: referral, p_disposition: 'declined', p_note: 'unauthorized attempt',
      })
      expect(rev.error, `${who} must be refused by siu_review_referral`).not.toBeNull()
    }
  })

  /* ── §15 — the inquiry ──────────────────────────────────────────────────── */

  it('accepting opens a preliminary inquiry that CID cannot see', async () => {
    const rev = await owner.rpc('siu_review_referral', {
      p_referral: referral,
      p_disposition: 'accepted',
      p_note: 'Credible enough to look at quietly.',
      p_open_as: 'preliminary_inquiry',
      // Standard classification DELIBERATELY: the weakest there is, so the
      // only thing hiding this case is its stage.
      p_classification: 'siu',
      p_category: 'law_enforcement_integrity',
    })
    expect(rev.error, rev.error?.message).toBeNull()
    inquiry = rev.data as string
    expect(inquiry).toBeTruthy()

    const mine = await owner.from('cases').select('siu_stage, siu_category, case_authority').eq('id', inquiry).single()
    expect(mine.data!.case_authority).toBe('siu')
    expect(mine.data!.siu_stage).toBe('preliminary_inquiry')
    expect(mine.data!.siu_category).toBe('law_enforcement_integrity')

    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const q = await c.from('cases').select('id').eq('id', inquiry)
      expect(q.data ?? [], `${who} must not see the inquiry`).toHaveLength(0)
    }
  })

  it('the referral cannot be actioned twice', async () => {
    const again = await owner.rpc('siu_review_referral', {
      p_referral: referral, p_disposition: 'declined', p_note: 'second bite',
    })
    expect(again.error, 'an actioned referral must not be re-reviewed').not.toBeNull()
  })

  it('a review note is mandatory, and a bogus disposition is refused', async () => {
    const blank = await owner.rpc('siu_review_referral', {
      p_referral: referral2, p_disposition: 'declined', p_note: '   ',
    })
    expect(blank.error, 'an empty review note must be refused').not.toBeNull()

    const bogus = await owner.rpc('siu_review_referral', {
      p_referral: referral2, p_disposition: 'shelved', p_note: 'not a real disposition',
    })
    expect(bogus.error, 'an unknown disposition must be refused').not.toBeNull()

    const ok = await owner.rpc('siu_review_referral', {
      p_referral: referral2, p_disposition: 'declined', p_note: 'Not an SIU matter.',
    })
    expect(ok.error, ok.error?.message).toBeNull()
    // Declining opens nothing.
    expect(ok.data).toBeNull()
  })

  it('the lifecycle columns are RPC-only', async () => {
    const up = await owner.from('cases')
      .update({ siu_stage: 'investigation', siu_closure_reason: 'unfounded' })
      .eq('id', inquiry).select('id')
    expect(up.error, 'writing the lifecycle columns directly must be refused').not.toBeNull()
    const row = await owner.from('cases').select('siu_stage').eq('id', inquiry).single()
    expect(row.data!.siu_stage, 'the stage must be unchanged').toBe('preliminary_inquiry')
  })

  it('promotion is the deliberate act, and only happens once', async () => {
    const bad = await owner.rpc('siu_promote_inquiry', { p_case: inquiry, p_reason: '  ' })
    expect(bad.error, 'promotion without a reason must be refused').not.toBeNull()

    const ok = await owner.rpc('siu_promote_inquiry', {
      p_case: inquiry, p_reason: 'Corroborated by a second source.',
    })
    expect(ok.error, ok.error?.message).toBeNull()

    const again = await owner.rpc('siu_promote_inquiry', { p_case: inquiry, p_reason: 'again' })
    expect(again.error, 'promoting a full investigation must be refused').not.toBeNull()

    // Still invisible to CID — promotion opens it to OVERSIGHT, which is not
    // the same thing as opening it to the Division.
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead]] as const) {
      const q = await c.from('cases').select('id').eq('id', inquiry)
      expect(q.data ?? [], `${who} must still not see it`).toHaveLength(0)
    }
  })

  /* ── §17 — the veto ─────────────────────────────────────────────────────── */

  it('declaring a conflict ends the declarer\'s access immediately, at any rank', async () => {
    const before = await owner.from('cases').select('id').eq('id', inquiry)
    expect(before.data ?? [], 'command must be able to read it first').toHaveLength(1)

    const d = await owner.rpc('siu_declare_conflict', {
      p_case: inquiry, p_reason: tag('the subject is a personal associate'),
    })
    expect(d.error, d.error?.message).toBeNull()
    conflictId = d.data as string

    // THE assertion. This account holds profiles.is_owner and therefore SIU
    // 'owner' standing — the highest there is, and the one that reaches a
    // standard case by rank alone with no assignment. The recusal beats it.
    const after = await owner.from('cases').select('id').eq('id', inquiry)
    expect(after.data ?? [], 'a recused account must read zero rows').toHaveLength(0)

    const write = await owner.rpc('siu_set_case_category', {
      p_case: inquiry, p_category: 'organized_crime',
    })
    expect(write.error, 'a recused account must not write').not.toBeNull()

    const close = await owner.rpc('siu_close_case', {
      p_case: inquiry, p_reason: 'unfounded', p_note: 'should be refused',
    })
    expect(close.error, 'a recused account must not close the investigation').not.toBeNull()

    // Deleting is a write like any other, and the veto covers it. This is also
    // why the teardown leaves this case to rls_test_cleanup.
    const del = await owner.from('cases').delete().eq('id', inquiry).select('id')
    expect(del.error ? true : (del.data ?? []).length === 0,
      'a recused account must not delete the investigation').toBe(true)
  })

  it('the declaration itself stays visible to the agent who made it', async () => {
    // Otherwise declaring a conflict would look like the record vanished, and
    // an agent doing the right thing would have no proof they did it.
    const k = await owner.from('siu_conflicts').select('id, status, reason').eq('id', conflictId)
    expect(k.error, k.error?.message).toBeNull()
    expect(k.data ?? [], 'the declarer must keep sight of their own declaration').toHaveLength(1)
    expect(k.data![0].status).toBe('declared')
  })

  it('declaring twice on the same investigation is refused', async () => {
    const again = await owner.rpc('siu_declare_conflict', {
      p_case: inquiry, p_reason: 'again',
    })
    expect(again.error, 'a second declaration must be refused').not.toBeNull()
  })

  it('nobody can clear their own conflict, and CID cannot reach the register', async () => {
    const self = await owner.rpc('siu_resolve_conflict', {
      p_conflict: conflictId, p_status: 'cleared', p_note: 'clearing my own',
    })
    expect(self.error, 'self-resolution must be refused').not.toBeNull()
    expect(self.error!.message).toMatch(/cannot be resolved by the agent who declared it/)

    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const r = await c.rpc('siu_resolve_conflict', {
        p_conflict: conflictId, p_status: 'cleared', p_note: 'unauthorized',
      })
      expect(r.error, `${who} must be refused by siu_resolve_conflict`).not.toBeNull()
      const q = await c.from('siu_conflicts').select('id').eq('id', conflictId)
      expect(q.data ?? [], `${who} must read zero conflicts`).toHaveLength(0)
    }

    // The recusal still stands after every failed attempt to lift it.
    const still = await owner.from('cases').select('id').eq('id', inquiry)
    expect(still.data ?? [], 'the veto must survive the failed resolutions').toHaveLength(0)
  })

  /* ── §32/§33 — category and closure, on a case nobody has recused from ──── */

  it('opens a full investigation directly, and categorises it', async () => {
    const rev = await owner.rpc('siu_review_referral', {
      p_referral: referral3,
      p_disposition: 'accepted',
      p_note: 'Straight to a full investigation.',
      p_open_as: 'investigation',
      p_classification: 'siu_restricted',
    })
    expect(rev.error, rev.error?.message).toBeNull()
    lifecycleCase = rev.data as string

    const opened = await owner.from('cases')
      .select('siu_stage, siu_category, status').eq('id', lifecycleCase).single()
    expect(opened.data!.siu_stage).toBe('investigation')
    // No category was passed, so it must be genuinely unset rather than
    // defaulted into something that looks like a finding.
    expect(opened.data!.siu_category).toBeNull()

    const bad = await owner.rpc('siu_set_case_category', {
      p_case: lifecycleCase, p_category: 'siu_restricted',
    })
    expect(bad.error, 'a classification is not a category — it must be refused').not.toBeNull()

    const ok = await owner.rpc('siu_set_case_category', {
      p_case: lifecycleCase, p_category: 'organized_crime',
    })
    expect(ok.error, ok.error?.message).toBeNull()

    const after = await owner.from('cases')
      .select('siu_category, siu_classification').eq('id', lifecycleCase).single()
    // Subject matter and sensitivity are orthogonal: setting one left the
    // other exactly where it was.
    expect(after.data!.siu_category).toBe('organized_crime')
    expect(after.data!.siu_classification).toBe('siu_restricted')
  })

  it('closure needs a reason from the list and a note', async () => {
    const noNote = await owner.rpc('siu_close_case', {
      p_case: lifecycleCase, p_reason: 'unfounded', p_note: '  ',
    })
    expect(noNote.error, 'closing without a note must be refused').not.toBeNull()

    const badReason = await owner.rpc('siu_close_case', {
      p_case: lifecycleCase, p_reason: 'got_bored', p_note: 'not a real reason',
    })
    expect(badReason.error, 'an unknown closure reason must be refused').not.toBeNull()

    const ok = await owner.rpc('siu_close_case', {
      p_case: lifecycleCase, p_reason: 'insufficient_evidence',
      p_note: 'No corroboration beyond the original report.',
    })
    expect(ok.error, ok.error?.message).toBeNull()

    const row = await owner.from('cases')
      .select('status, siu_closure_reason, siu_closure_note, closed_at').eq('id', lifecycleCase).single()
    expect(row.data!.status).toBe('closed')
    expect(row.data!.siu_closure_reason).toBe('insufficient_evidence')
    expect(row.data!.siu_closure_note).toBeTruthy()
    expect(row.data!.closed_at, 'closing must stamp closed_at').toBeTruthy()
  })

  it('a closed SIU investigation is still invisible to CID', async () => {
    // Closure is not declassification. Nothing about finishing an
    // investigation hands it back to the Division.
    for (const [who, c] of [['detective', lsb], ['bureau lead', lead], ['director', director]] as const) {
      const q = await c.from('cases').select('id').eq('id', lifecycleCase)
      expect(q.data ?? [], `${who} must not see the closed investigation`).toHaveLength(0)
    }
  })
})
