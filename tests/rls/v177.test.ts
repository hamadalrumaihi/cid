/** v1.77 — charges without command approval, hierarchical legal review, and an
 *  SIU member who works CID (migrations 20261001120000 / 120100 / 120200), LIVE.
 *
 *  ── What each part actually changed ────────────────────────────────────────
 *  CHARGES lost their INTERNAL command review and nothing else. 'proposed' and
 *  'under_review' existed solely to hold a charge in a Bureau Lead's queue and
 *  are gone from the constraint. The COURT lane is untouched, and that is the
 *  half worth testing hardest: an investigator who can now add a charge
 *  unilaterally must still be unable to file or convict it. A test that only
 *  checked "adding works" would pass against a version that let a detective
 *  record a conviction.
 *
 *  SIU MEMBERS work CID. The wall was two functions -- can_access_case and
 *  can_access_case_row -- carrying `not is_siu_department()`. Removing it opens
 *  CID cases and everything scoped to one. The tests that matter most here are
 *  the ones proving what did NOT open: the SIU -> CID direction, and Owner-only
 *  administration.
 *
 *  ── row_count is not proof ─────────────────────────────────────────────────
 *  The role-management test below reads the VALUE back rather than trusting the
 *  affected-row count. An UPDATE that matches a row and is then silently
 *  reverted by a trigger still reports one row affected -- during development
 *  that read as "SIU can promote people", which was wrong.
 *
 *  ── Fixture / env contract ─────────────────────────────────────────────────
 *  `rls-test-owner` is the SIU actor (siu_standing() returns 'owner' from its
 *  first branch, before the release gate). `rls-test-lsb` is an MCB detective,
 *  `rls-test-bcb` a SCB detective, `rls-test-lead` an MCB Bureau Lead and
 *  `rls-test-director` the CID Director.
 *
 *  ── Cleanup ────────────────────────────────────────────────────────────────
 *  One case created here and deleted in afterAll, charges cascading with it. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
}
const enabled = !!(ANON && PW.owner && PW.lsb && PW.bcb && PW.lead && PW.director)
if (!enabled) console.warn('[rls:v177] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
const RUN = randomUUID().slice(0, 8)

describe.skipIf(!enabled)('v1.77 — charges, legal hierarchy, SIU inside CID (live)', () => {
  let owner: C, lsb: C, bcb: C, lead: C, director: C
  let lsbId = '', bcbId = ''
  let caseId = '', chargeId = '', penalId = ''

  beforeAll(async () => {
    owner = mk(); lsb = mk(); bcb = mk(); lead = mk(); director = mk()
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    bcbId = await signInWithRetry(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)

    const c = await lsb.from('cases').insert({
      case_number: `MCB-${Date.now().toString().slice(-6)}`,
      title: `[rls-test] v177 ${RUN}`, bureau: 'major_crimes',
    }).select('id').single()
    expect(c.error, c.error?.message).toBeNull()
    caseId = c.data!.id as string

    const p = await lsb.from('penal_charges').select('id, version_id')
      .eq('lifecycle', 'active').limit(1).single()
    expect(p.error, p.error?.message).toBeNull()
    penalId = p.data!.id as string
  }, 120_000)

  afterAll(async () => {
    if (caseId) await lsb.from('cases').delete().eq('id', caseId)
    await Promise.all([owner, lsb, bcb, lead, director].map((c) => c.auth.signOut()))
  }, 60_000)

  it('a charge is live the moment an investigator adds it', async () => {
    const r = await lsb.from('case_charges')
      .insert({ case_id: caseId, charge_id: penalId, counts: 1 })
      .select('id, status, added_by').single()
    expect(r.error, r.error?.message).toBeNull()
    chargeId = r.data!.id as string
    // No queue, no Bureau Lead, no second person.
    expect(r.data!.status).toBe('approved')
    expect(r.data!.added_by).toBe(lsbId)
  })

  it('the two command-queue states no longer exist', async () => {
    // Removed from the CHECK, not merely unreachable.
    const r = await lsb.from('case_charges')
      .update({ status: 'under_review' }).eq('id', chargeId).select('id')
    expect(r.data ?? []).toHaveLength(0)
  })

  it('but the court lane is exactly as closed as it was', async () => {
    // The half that matters. An investigator who can add a charge unilaterally
    // must still be unable to file it or record a conviction.
    for (const status of ['filed', 'convicted', 'dismissed']) {
      const r = await lsb.from('case_charges')
        .update({ status }).eq('id', chargeId).select('id')
      expect(r.data ?? [], status).toHaveLength(0)
    }
  })

  it('the author may withdraw their own charge', async () => {
    const r = await lsb.from('case_charges')
      .update({ status: 'withdrawn' }).eq('id', chargeId).select('id, status').single()
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data!.status).toBe('withdrawn')
  })

  it('an active SIU member works a CID case in a bureau they do not belong to', async () => {
    const seen = await owner.from('cases').select('id').eq('id', caseId)
    expect(seen.error, seen.error?.message).toBeNull()
    expect(seen.data).toHaveLength(1)

    const edit = await owner.from('cases')
      .update({ title: `[rls-test] v177 ${RUN} edited by SIU` })
      .eq('id', caseId).select('id')
    expect(edit.error, edit.error?.message).toBeNull()
    expect(edit.data).toHaveLength(1)

    const task = await owner.from('case_tasks')
      .insert({ case_id: caseId, title: '[rls-test] by SIU' }).select('id')
    expect(task.error, task.error?.message).toBeNull()
    expect(task.data).toHaveLength(1)
  })

  it('opening CID to SIU did not open SIU to CID', async () => {
    // The direction that must not move. Compartmentation, targets, notes and
    // the watchlist keep every predicate they had.
    for (const t of ['siu_targets', 'siu_case_notes', 'siu_watchlist', 'siu_visibility']) {
      const r = await lsb.from(t).select('*', { count: 'exact', head: true })
      expect(r.error, `${t}: ${r.error?.message}`).toBeNull()
      expect(r.count ?? 0, t).toBe(0)
    }
  })

  it('SIU standing confers no Owner-only administration', async () => {
    // Read the VALUE back, not the row count: an UPDATE that matches a row and
    // is silently reverted by a trigger still reports one row affected.
    const before = await owner.from('profiles').select('role').eq('id', bcbId).single()
    expect(before.error, before.error?.message).toBeNull()
    await owner.from('profiles').update({ role: 'director' }).eq('id', bcbId)
    const after = await owner.from('profiles').select('role').eq('id', bcbId).single()
    expect(after.data!.role).toBe(before.data!.role)
  })

  // NOTE on part 3, deliberately not tested here. The legal hierarchy is
  // exercised by src/lib/legalWorkflow.test.ts, which pins the seven rules that
  // changed (own-bureau lead yes, other-bureau lead no, JTF widening, higher
  // command any bureau, no responsible bureau at all, author never, inactive
  // never). Reaching the SERVER predicate needs a legal request in
  // cid_supervisor_review, which means driving the whole draft-and-submit flow
  // -- and the first version of this test faked it with a promise that
  // resolved true either way. A check that cannot fail is not a check, so it
  // is gone rather than left looking like coverage.
})
