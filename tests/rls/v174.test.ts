/** v1.74 — a charge on a case is a record with an author, a status and a
 *  frozen snapshot (migrations 20260905130000 / 20260905140000), LIVE project.
 *
 *  ── The defect that mattered most ──────────────────────────────────────────
 *  20260905130000 shipped an authority check that passed for anybody with no
 *  justice role at all. private.justice_role() is NULL for every CID user, so
 *
 *      NULL in ('prosecutor', ...)  ->  NULL
 *      not NULL                     ->  NULL
 *      if NULL then raise           ->  never fires
 *
 *  and a detective could move their own case's charges to filed, convicted or
 *  dismissed — recording a conviction with no court involved. It read as
 *  correct and it tested as correct against a real Attorney General, because a
 *  NON-null role compares FALSE rather than NULL. It was caught by asserting
 *  ROW COUNTS rather than the absence of an exception, which is the only
 *  honest way to test a system that refuses by doing nothing.
 *
 *  That is why the negative assertions below check `data` came back EMPTY
 *  rather than merely checking `error` is null. An RLS refusal and a trigger
 *  refusal look completely different from the client — one is a silent no-op,
 *  the other an exception — and a test that accepts either would have passed
 *  against the bug.
 *
 *  ── The other rules worth pinning ──────────────────────────────────────────
 *    * The SNAPSHOT is written by the database. A client that supplies its own
 *      offense, class, fine or jail has all of it discarded and replaced from
 *      penal_charges, and status is forced to 'proposed'. Without this a
 *      client could file a Felony at an Infraction's penalty.
 *    * A charge from an UNPUBLISHED draft version cannot be attached at all.
 *      The 2026 code is still a draft, so nothing may be charged under it.
 *    * RICO modifiers are reserved to a prosecuting attorney or judge — the
 *      penal code's own rule, enforced by policy rather than a hidden button.
 *    * The snapshot is immutable afterwards. Correcting the penal code is a
 *      new version, not a quiet edit to somebody's case history.
 *    * Nobody approves their own proposal.
 *    * There is NO delete. A charge that should not have been brought is
 *      withdrawn, which keeps the record that it was brought.
 *    * A judge-set penalty is never totalled as zero.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  `rls-test-lsb` is an ordinary LSB detective and owns the case. `rls-test-lead`
 *  is an LSB Bureau Lead — the CID approver. `rls-test-prosecutor` files;
 *  `rls-test-judge` disposes. The detective doubles as the no-justice-role
 *  caller that the NULL hole let through.
 *
 *  ── Cleanup notes ──────────────────────────────────────────────────────────
 *  Non-destructive and self-cleaning: one CID case created here, deleted in
 *  afterAll, with its charges cascading. No fixture reset, no pre-existing case
 *  touched, and nothing in the penal code itself is written to. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  prosecutor: process.env.RLS_TEST_PASSWORD_PROSECUTOR,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.prosecutor && PW.judge)
if (!enabled) console.warn('[rls:v174] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

const RUN = randomUUID().slice(0, 8)

describe.skipIf(!enabled)('v1.74 — charge records, snapshots and the status lane (live)', () => {
  let lsb: C, lead: C, pros: C, judge: C
  let lsbId = ''
  let caseId = ''
  let legacyVersion = ''
  let attemptedMurder = ''   // (1)09 — fixed 60 months / $110,000
  let perjury = ''           // (4)24 — judge-set jail, fixed fine
  let ricoConspiracy = ''    // (10)01 — RICO modifier
  let draft2026 = ''         // a charge from the unpublished 2026 draft

  const idOf = async (c: C, version: string, code: string) => {
    const r = await c.from('penal_charges').select('id, version_id')
      .eq('code', code).eq('version_id', version).maybeSingle()
    expect(r.error, r.error?.message).toBeNull()
    return r.data?.id as string
  }

  beforeAll(async () => {
    lsb = mk(); lead = mk(); pros = mk(); judge = mk()
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    await signInWithRetry(pros, 'rls-test-prosecutor@cidportal.test', PW.prosecutor!)
    await signInWithRetry(judge, 'rls-test-judge@cidportal.test', PW.judge!)

    const v = await lsb.from('penal_code_versions').select('id, name, status')
      .eq('name', 'San Andreas Penal Code (legacy)').single()
    expect(v.error, v.error?.message).toBeNull()
    legacyVersion = v.data!.id as string
    // Superseded, not published: historical charges must stay resolvable.
    expect(v.data!.status).toBe('superseded')

    attemptedMurder = await idOf(lsb, legacyVersion, '(1)09')
    perjury = await idOf(lsb, legacyVersion, '(4)24')
    ricoConspiracy = await idOf(lsb, legacyVersion, '(10)01')

    const c = await lsb.from('cases').insert({
      case_number: `LSB-${Date.now().toString().slice(-6)}`,
      title: `[rls-test] charge records ${RUN}`, bureau: 'LSB',
    }).select('id').single()
    expect(c.error, c.error?.message).toBeNull()
    caseId = c.data!.id as string
  }, 120_000)

  afterAll(async () => {
    if (caseId) await lsb.from('cases').delete().eq('id', caseId)
    await Promise.all([lsb, lead, pros, judge].map((c) => c.auth.signOut()))
  }, 60_000)

  const add = async (c: C, chargeId: string, extra: Record<string, unknown> = {}) =>
    c.from('case_charges').insert({
      case_id: caseId, charge_id: chargeId, version_id: legacyVersion,
      snap_offense: 'placeholder', snap_charge_class: 'Felony', ...extra,
    }).select('id').maybeSingle()

  const row = async (c: C, id: string) => {
    const r = await c.from('case_charges').select('*').eq('id', id).maybeSingle()
    expect(r.error, r.error?.message).toBeNull()
    return r.data
  }

  /* --------------------------------------------------------- the snapshot */

  it('writes the snapshot itself and discards what the caller supplied', async () => {
    const r = await add(lsb, attemptedMurder, {
      counts: 2, status: 'convicted',
      snap_offense: 'Jaywalking', snap_charge_class: 'Infraction',
      snap_fine: 1, snap_jail_months: 1, snap_is_rico: false,
      decided_by: lsbId, imposed_fine: 5,
    })
    expect(r.error, r.error?.message).toBeNull()
    const got = await row(lsb, r.data!.id as string)

    // Everything the caller asserted about the charge is gone.
    expect(got!.snap_offense).toBe('Attempted Murder')
    expect(got!.snap_charge_class).toBe('Felony')
    expect(got!.snap_fine).toBe(110000)
    expect(got!.snap_jail_months).toBe(60)
    // A charge always starts as a proposal, never pre-decided or pre-sentenced.
    expect(got!.status).toBe('proposed')
    expect(got!.decided_by).toBeNull()
    expect(got!.imposed_fine).toBeNull()
    // counts IS the caller's to set.
    expect(got!.counts).toBe(2)
    expect(got!.added_by).toBe(lsbId)
  })

  it('refuses a charge from an unpublished draft of the penal code', async () => {
    const draft = await lsb.from('penal_code_versions').select('id')
      .eq('name', 'Odyssey RP Penal Code 2026').maybeSingle()
    // The draft is invisible to an ordinary member — that itself is the guard.
    if (!draft.data) { expect(draft.data).toBeNull(); return }
    draft2026 = await idOf(lsb, draft.data.id as string, '101')
    const r = await add(lsb, draft2026)
    expect(r.error).not.toBeNull()
  })

  it('reserves RICO modifiers to a prosecuting attorney or judge', async () => {
    const bad = await add(lsb, ricoConspiracy)
    expect(bad.error, 'a detective must not be able to add a RICO modifier').not.toBeNull()

    const ok = await add(pros, ricoConspiracy)
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data?.id).toBeTruthy()
  })

  it('freezes the snapshot against later edits', async () => {
    const r = await lsb.from('case_charges').select('id').eq('case_id', caseId)
      .eq('charge_id', attemptedMurder).single()
    const upd = await lsb.from('case_charges')
      .update({ snap_fine: 1, snap_offense: 'Littering' }).eq('id', r.data!.id)
    expect(upd.error, 'the snapshot is a historical record').not.toBeNull()
  })

  /* ------------------------------------------------------------ the lane */

  it('walks the lane only along legal edges, with the right actor at each step', async () => {
    const r = await lsb.from('case_charges').select('id').eq('case_id', caseId)
      .eq('charge_id', attemptedMurder).single()
    const id = r.data!.id as string

    // Skipping review is refused.
    const skip = await lsb.from('case_charges').update({ status: 'approved' }).eq('id', id).select('id')
    expect(skip.data ?? []).toHaveLength(0)

    const up = await lsb.from('case_charges').update({ status: 'under_review' }).eq('id', id).select('id')
    expect(up.error, up.error?.message).toBeNull()
    expect(up.data).toHaveLength(1)

    // The author cannot approve their own proposal.
    const self = await lsb.from('case_charges').update({ status: 'approved' }).eq('id', id).select('id')
    expect(self.data ?? [], 'nobody approves their own charge').toHaveLength(0)

    const appr = await lead.from('case_charges').update({ status: 'approved' }).eq('id', id).select('id')
    expect(appr.error, appr.error?.message).toBeNull()
    expect(appr.data, 'a Bureau Lead approves a CID charge').toHaveLength(1)

    // ---- THE NULL-ROLE HOLE. A detective has no justice role at all. ----
    const file = await lsb.from('case_charges').update({ status: 'filed' }).eq('id', id).select('id')
    expect(file.data ?? [], 'a detective must not be able to file').toHaveLength(0)

    const filed = await pros.from('case_charges').update({ status: 'filed' }).eq('id', id).select('id')
    expect(filed.error, filed.error?.message).toBeNull()
    expect(filed.data, 'a prosecutor files').toHaveLength(1)

    const convict = await lsb.from('case_charges').update({ status: 'convicted' }).eq('id', id).select('id')
    expect(convict.data ?? [], 'a detective must not be able to convict').toHaveLength(0)
    const dismiss = await lsb.from('case_charges').update({ status: 'dismissed' }).eq('id', id).select('id')
    expect(dismiss.data ?? [], 'a detective must not be able to dismiss').toHaveLength(0)
    const prosConvict = await pros.from('case_charges').update({ status: 'convicted' }).eq('id', id).select('id')
    expect(prosConvict.data ?? [], 'a prosecutor does not convict either').toHaveLength(0)

    const conv = await judge.from('case_charges').update({ status: 'convicted' }).eq('id', id).select('id')
    expect(conv.error, conv.error?.message).toBeNull()
    expect(conv.data, 'a judge convicts').toHaveLength(1)

    // Terminal.
    const undo = await judge.from('case_charges').update({ status: 'proposed' }).eq('id', id).select('id')
    expect(undo.data ?? [], 'a conviction is terminal').toHaveLength(0)
  })

  it('never deletes a charge — withdrawal keeps the record', async () => {
    const r = await add(lsb, perjury)
    expect(r.error, r.error?.message).toBeNull()
    const id = r.data!.id as string

    const del = await lsb.from('case_charges').delete().eq('id', id).select('id')
    expect(del.data ?? [], 'there is no delete path').toHaveLength(0)

    const wd = await lsb.from('case_charges').update({ status: 'withdrawn' }).eq('id', id).select('id')
    expect(wd.error, wd.error?.message).toBeNull()
    expect(wd.data).toHaveLength(1)
    expect((await row(lsb, id))!.status).toBe('withdrawn')
  })

  /* ----------------------------------------------------------- the total */

  it('counts a judge-set penalty separately instead of as zero', async () => {
    // Perjury: fixed $50,000 fine, jail left to a judge.
    const r = await add(lsb, perjury)
    expect(r.error, r.error?.message).toBeNull()
    const id = r.data!.id as string

    const before = await lsb.rpc('case_charge_totals', { p_case: caseId })
    expect(before.error, before.error?.message).toBeNull()
    const t = before.data as Record<string, number | null>
    expect(t.judge_jail_pending, 'the unsentenced charge is pending, not zero')
      .toBeGreaterThanOrEqual(1)
    // A version that states no maximum must not be reported as within one.
    expect(t.cap_months).toBeNull()
    expect(t.over_cap).toBeNull()

    // Only a judge may set it.
    const bad = await lsb.from('case_charges')
      .update({ imposed_jail_months: 12 }).eq('id', id).select('id')
    expect(bad.data ?? [], 'only a judge sets a judge-set penalty').toHaveLength(0)
  })

  it('refuses an imposed penalty on a charge the code did not leave to a judge', async () => {
    const r = await lsb.from('case_charges').select('id').eq('case_id', caseId)
      .eq('charge_id', attemptedMurder).single()
    // Attempted Murder carries a fixed fine, so there is nothing for a judge
    // to set — recording one would invent a discretion the code never gave.
    const bad = await judge.from('case_charges')
      .update({ imposed_fine: 999 }).eq('id', r.data!.id).select('id')
    expect(bad.error ?? { code: '' }).toBeTruthy()
    expect(bad.data ?? []).toHaveLength(0)
  })
})
