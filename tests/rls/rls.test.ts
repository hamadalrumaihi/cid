/** RLS / RPC security-wall tests — run against the LIVE Supabase project as
 *  three dedicated accounts (see tests/rls/README.md):
 *
 *    rls-test-lsb@cidportal.test       detective, LSB, active
 *    rls-test-bcb@cidportal.test       detective, BCB, active
 *    rls-test-inactive@cidportal.test  inactive (deny-by-default)
 *
 *  Opt-in via `npm run test:rls` with the three RLS_TEST_PASSWORD_* env vars
 *  (or a git-ignored .env.rls.local). Every test asserts a DENIAL — the suite
 *  deliberately never drives the real sign-off chain, so it cannot ping or
 *  notify real officers. Fixtures are removed in afterAll via the
 *  rls_test_cleanup() RPC, which only test accounts may call and which only
 *  deletes rows they authored. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  target: process.env.RLS_TEST_PASSWORD_TARGET,
  applicant: process.env.RLS_TEST_PASSWORD_APPLICANT,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.inactive)
if (!enabled) console.warn('[rls] RLS_TEST_PASSWORD_* not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })

describe.skipIf(!enabled)('RLS security wall (live project, test accounts)', () => {
  let lsb: SupabaseClient
  let bcb: SupabaseClient
  let inactive: SupabaseClient
  let anon: SupabaseClient
  let lsbId = ''
  let caseId = ''
  const caseNumber = `RLS-TEST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); inactive = mk(); anon = mk()
    for (const [client, email, password] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb],
      [inactive, 'rls-test-inactive@cidportal.test', PW.inactive],
    ] as const) {
      const { data, error } = await client.auth.signInWithPassword({ email, password: password! })
      if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
      if (email.includes('-lsb')) lsbId = data.user!.id
    }
  })

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    // Surface cleanup problems loudly — leftovers pollute the live board.
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls] cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb, inactive].map((c) => c.auth.signOut()))
  })

  /* ---- sanity -------------------------------------------------------- */

  it('test accounts see their own profile with the expected role/bureau', async () => {
    const { data, error } = await lsb.from('profiles').select('id,role,division,active').eq('id', lsbId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({ role: 'detective', division: 'LSB', active: true })
  })

  it('LSB detective can create a case in their own bureau', async () => {
    const { data, error } = await lsb.from('cases')
      .insert({ case_number: caseNumber, title: 'RLS wall test case', bureau: 'LSB' })
      .select('id,bureau,status')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    caseId = data![0].id
  })

  /* ---- bureau isolation ---------------------------------------------- */

  it('BCB detective cannot read an LSB case', async () => {
    const { data, error } = await bcb.from('cases').select('id').eq('id', caseId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0) // RLS: invisible, not an error
  })

  it('BCB detective cannot update an LSB case (zero rows affected)', async () => {
    const { data, error } = await bcb.from('cases').update({ title: 'hijacked' }).eq('id', caseId).select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('BCB detective cannot create a case in the LSB bureau', async () => {
    const { error } = await bcb.from('cases')
      .insert({ case_number: `${caseNumber}-X`, title: 'cross-bureau insert', bureau: 'LSB' })
      .select('id')
    expect(error).not.toBeNull()
  })

  it('BCB detective cannot attach evidence to an LSB case', async () => {
    const { error } = await bcb.from('evidence')
      .insert({ case_id: caseId, item_code: 'EV-RLS-X', description: 'cross-bureau evidence' })
      .select('id')
    expect(error).not.toBeNull()
  })

  /* ---- deny-by-default (inactive account) ----------------------------- */

  it('inactive account sees no cases and cannot create one', async () => {
    const sel = await inactive.from('cases').select('id').limit(5)
    expect(sel.error).toBeNull()
    expect(sel.data).toHaveLength(0)
    const ins = await inactive.from('cases')
      .insert({ case_number: `${caseNumber}-I`, title: 'inactive insert', bureau: 'JTF' })
      .select('id')
    expect(ins.error).not.toBeNull()
  })

  it('inactive account sees only its own profile', async () => {
    const { data, error } = await inactive.from('profiles').select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  /* ---- server-authoritative workflows --------------------------------- */

  it('direct writes to sign-off columns are rejected by the lockdown trigger', async () => {
    const { error } = await lsb.from('cases').update({ signoff_status: 'submitted' }).eq('id', caseId).select('id')
    expect(error).not.toBeNull()
  })

  it('signoff_decide is rejected for a caller who is not the assignee', async () => {
    const { error } = await lsb.rpc('signoff_decide', { p_case: caseId, p_decision: 'approve' })
    expect(error).not.toBeNull()
  })

  it('reports cannot be finalized by a direct column write', async () => {
    const ins = await lsb.from('reports')
      .insert({ case_id: caseId, template: 'initial', kind: 'initial', seq: 1, fields: {} })
      .select('id')
    expect(ins.error).toBeNull()
    const { error } = await lsb.from('reports').update({ finalized: true }).eq('id', ins.data![0].id).select('id')
    expect(error).not.toBeNull()
  })

  /* ---- owner gates ----------------------------------------------------- */

  it('non-owner cannot read or write feedback triage metadata', async () => {
    const fb = await lsb.from('feedback').insert({ kind: 'feature', title: 'RLS test feedback' }).select('id')
    expect(fb.error).toBeNull()
    const sel = await lsb.from('feedback_meta').select('feedback_id')
    expect(sel.data ?? []).toHaveLength(0)
    const ins = await lsb.from('feedback_meta').insert({ feedback_id: fb.data![0].id, status: 'new' }).select('feedback_id')
    expect(ins.error).not.toBeNull()
  })

  it('non-owner cannot read the audit log', async () => {
    const { data } = await lsb.from('audit_log').select('id').limit(5)
    expect(data ?? []).toHaveLength(0)
  })

  it('is_owner cannot be self-granted', async () => {
    const upd = await lsb.from('profiles').update({ is_owner: true }).eq('id', lsbId).select('id')
    // Either the column grant rejects the write outright, or guard_profile
    // silently reverts it — both keep the flag false.
    if (!upd.error) {
      const { data } = await lsb.from('profiles').select('is_owner').eq('id', lsbId)
      expect(data![0].is_owner).toBe(false)
    } else {
      expect(upd.error).not.toBeNull()
    }
  })

  /* ---- column grants & anonymous access -------------------------------- */

  it('profile email column is not readable by non-command members', async () => {
    const { error } = await lsb.from('profiles').select('id,email').eq('id', lsbId)
    expect(error).not.toBeNull() // column-level grant excludes email
  })

  it('anonymous clients get nothing from member tables', async () => {
    const { data, error } = await anon.from('cases').select('id').limit(1)
    if (error) expect(error).not.toBeNull()
    else expect(data).toHaveLength(0)
  })

  it('cleanup RPC rejects anonymous callers', async () => {
    const { error } = await anon.rpc('rls_test_cleanup')
    expect(error).not.toBeNull()
  })
})

/** Owner-POSITIVE coverage — proves the owner paths keep working, not just
 *  that non-owners are denied. This is the block that would have caught the
 *  missing is_owner() EXECUTE grant before it shipped. Separate account and
 *  env var so the denial suite still runs without it. */
describe.skipIf(!enabled || !PW.owner)('Owner role (positive paths)', () => {
  let owner: SupabaseClient
  let ownerId = ''
  let feedbackId = ''

  beforeAll(async () => {
    owner = mk()
    const { data, error } = await owner.auth.signInWithPassword({ email: 'rls-test-owner@cidportal.test', password: PW.owner! })
    if (error) throw new Error(`owner sign-in failed: ${error.message}`)
    ownerId = data.user!.id
    const fb = await owner.from('feedback').insert({ kind: 'feature', title: 'RLS owner-path test feedback' }).select('id')
    if (fb.error) throw new Error(`feedback insert failed: ${fb.error.message}`)
    feedbackId = fb.data![0].id
  })

  afterAll(async () => {
    if (!owner) return
    const { error } = await owner.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    await owner.auth.signOut()
  })

  it('owner profile carries is_owner', async () => {
    const { data, error } = await owner.from('profiles').select('id,is_owner').eq('id', ownerId)
    expect(error).toBeNull()
    expect(data![0].is_owner).toBe(true)
  })

  it('owner can read the audit log', async () => {
    const { data, error } = await owner.from('audit_log').select('id').limit(1)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })

  it('owner can create and update feedback triage metadata', async () => {
    // Exercises BOTH previously-shipped live bugs: the audit trigger that
    // assumed an id column (feedback_meta keys by feedback_id) and the
    // missing is_owner() EXECUTE grant.
    const ins = await owner.from('feedback_meta')
      .insert({ feedback_id: feedbackId, status: 'triaged', priority: 'low', updated_by: ownerId })
      .select('feedback_id,status')
    expect(ins.error).toBeNull()
    expect(ins.data).toHaveLength(1)
    const upd = await owner.from('feedback_meta')
      .update({ status: 'planned', internal_notes: 'owner-path test note' })
      .eq('feedback_id', feedbackId)
      .select('status')
    expect(upd.error).toBeNull()
    expect(upd.data![0].status).toBe('planned')
  })

  it('owner can read internal triage fields back', async () => {
    const { data, error } = await owner.from('feedback_meta').select('feedback_id,internal_notes').eq('feedback_id', feedbackId)
    expect(error).toBeNull()
    expect(data![0].internal_notes).toBe('owner-path test note')
  })

  it('owner still cannot self-modify role/active (guard_profile)', async () => {
    const upd = await owner.from('profiles').update({ role: 'director' }).eq('id', ownerId).select('role')
    if (!upd.error) expect(upd.data![0].role).toBe('detective') // silently reverted
  })
})

/** Command Center — assign_member bureau-lead scoping. Proves a Bureau Lead is
 *  confined to their own bureau and can't over-promote, while a Director keeps
 *  the broad power. Uses dedicated lead/director accounts (never mutated) and a
 *  throwaway `target` (detective/LSB) that a test promotes and afterAll
 *  restores. Skips unless all three passwords are set. */
const ccEnabled = enabled && !!(PW.lead && PW.director && PW.target)
describe.skipIf(!ccEnabled)('Command Center — assign_member scoping', () => {
  let lead: SupabaseClient
  let director: SupabaseClient
  let plainDet: SupabaseClient
  let targetId = ''
  let bcbId = ''

  beforeAll(async () => {
    lead = mk(); director = mk(); plainDet = mk()
    const t = mk(); const b = mk()
    const signIn = async (c: SupabaseClient, email: string, pw: string) => {
      const { data, error } = await c.auth.signInWithPassword({ email, password: pw })
      if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
      return data.user!.id
    }
    await signIn(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    await signIn(director, 'rls-test-director@cidportal.test', PW.director!)
    await signIn(plainDet, 'rls-test-lsb@cidportal.test', PW.lsb!)
    targetId = await signIn(t, 'rls-test-target@cidportal.test', PW.target!)
    bcbId = await signIn(b, 'rls-test-bcb@cidportal.test', PW.bcb!)
    await t.auth.signOut(); await b.auth.signOut()
  })

  afterAll(async () => {
    if (director) {
      // restore the throwaway target to its baseline, then purge the
      // role_events this block created (cleanup deletes them for test ids)
      await director.rpc('assign_member', { target: targetId, new_role: 'detective', new_division: 'LSB', set_active: true })
      await director.rpc('rls_test_cleanup')
    }
    await Promise.all([lead, director, plainDet].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('Bureau Lead may manage a member in their own bureau (no-op update succeeds)', async () => {
    const { error } = await lead.rpc('assign_member', { target: targetId, new_role: 'detective', new_division: 'LSB', set_active: true })
    expect(error).toBeNull()
  })

  it('Bureau Lead cannot promote above senior detective', async () => {
    const { error } = await lead.rpc('assign_member', { target: targetId, new_role: 'bureau_lead', new_division: 'LSB', set_active: true })
    expect(error).not.toBeNull()
  })

  it('Bureau Lead cannot transfer a member out of their bureau', async () => {
    const { error } = await lead.rpc('assign_member', { target: targetId, new_role: 'detective', new_division: 'BCB', set_active: true })
    expect(error).not.toBeNull()
  })

  it('Bureau Lead cannot manage a member in another bureau', async () => {
    const { error } = await lead.rpc('assign_member', { target: bcbId, new_role: 'detective', new_division: 'BCB', set_active: true })
    expect(error).not.toBeNull()
  })

  it('Bureau Lead may promote to senior detective within their bureau', async () => {
    const up = await lead.rpc('assign_member', { target: targetId, new_role: 'senior_detective', new_division: 'LSB', set_active: true })
    expect(up.error).toBeNull()
    await director.rpc('assign_member', { target: targetId, new_role: 'detective', new_division: 'LSB', set_active: true })
  })

  it('Director can promote across bureaus and to command roles', async () => {
    const up = await director.rpc('assign_member', { target: targetId, new_role: 'bureau_lead', new_division: 'BCB', set_active: true })
    expect(up.error).toBeNull()
    // restore
    const back = await director.rpc('assign_member', { target: targetId, new_role: 'detective', new_division: 'LSB', set_active: true })
    expect(back.error).toBeNull()
  })

  it('role_events history is readable by command but not by a plain detective', async () => {
    const cmd = await director.from('role_events').select('id').limit(1)
    expect(cmd.error).toBeNull()
    const det = await plainDet.from('role_events').select('id').limit(1)
    expect(det.data ?? []).toHaveLength(0)
  })
})

/* Shared helpers for the blocks below. */
const signInAs = async (c: SupabaseClient, email: string, password: string) => {
  const { data, error } = await c.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`)
  return data.user!.id
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Membership requests (migration 20260713030000) — the applicant is the
 *  shared rls-test-inactive account. The request row is UNIQUE per applicant
 *  and has NO client delete path (by design). rls_test_cleanup() purges it in
 *  afterAll (migration 20260713070000), so a normal re-run starts fresh; the
 *  reuse path + self-skips below only cover a previous run that crashed
 *  before cleanup — one clean run (or any applicant rls_test_cleanup call)
 *  clears it. membership_request_submit() suppresses its command fan-out for
 *  rls-test applicants (migration 20260713080000), so this flow never
 *  notifies real officers.
 *
 *  Approval SUCCESS is deliberately never exercised HERE: approving would
 *  flip the shared rls-test-inactive fixture to active, breaking every
 *  deny-by-default test in this suite. The denial side of the approval
 *  authority (wrong-bureau and command-role rejections for a bureau lead,
 *  self-review rejection) lives in this block; the positive approval path
 *  runs in the next block against the DISPOSABLE rls-test-applicant. */
describe.skipIf(!enabled)('Membership requests — applicant wall & review authority', () => {
  let applicant: SupabaseClient
  let bcb: SupabaseClient
  let lead: SupabaseClient | null = null
  let reviewer: SupabaseClient | null = null // director preferred, else owner
  let applicantId = ''
  let reviewerId = ''
  let requestId = ''
  const reviewerCreds = PW.director
    ? { email: 'rls-test-director@cidportal.test', pw: PW.director }
    : PW.owner
      ? { email: 'rls-test-owner@cidportal.test', pw: PW.owner }
      : null
  // Explicit columns: the table's SELECT grant excludes internal_decision_note
  // (profiles.email precedent), so `select('*')` errors for everyone.
  const COLS = 'id,applicant_id,display_name,requested_bureau,requested_role,reason,status,decided_by,applicant_visible_decision_note'

  const readStatus = async () => {
    const { data, error } = await applicant.from('membership_requests').select('id,status').eq('id', requestId)
    if (error) throw new Error(`status read failed: ${error.message}`)
    return data && data[0] ? (data[0].status as string) : ''
  }
  /** Drive the request to 'pending' when the applicant still can; returns
   *  false when a previous run left the row terminal (no server reset path). */
  const ensurePending = async () => {
    const s = await readStatus()
    if (s === 'pending') return true
    if (s !== 'draft' && s !== 'correction_requested') return false
    const { error } = await applicant.rpc('membership_request_submit', { p_request: requestId })
    if (error) throw new Error(`membership_request_submit failed: ${error.message}`)
    return true
  }

  beforeAll(async () => {
    applicant = mk(); bcb = mk()
    applicantId = await signInAs(applicant, 'rls-test-inactive@cidportal.test', PW.inactive!)
    await signInAs(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    if (PW.lead) { lead = mk(); await signInAs(lead, 'rls-test-lead@cidportal.test', PW.lead) }
    if (reviewerCreds) { reviewer = mk(); reviewerId = await signInAs(reviewer, reviewerCreds.email, reviewerCreds.pw) }
    // Idempotency: reuse the row a previous run left behind (unique per applicant).
    const { data, error } = await applicant.from('membership_requests').select(COLS).eq('applicant_id', applicantId)
    if (error) throw new Error(`membership_requests probe failed: ${error.message}`)
    if (data && data[0]) requestId = data[0].id
  })

  afterAll(async () => {
    if (!applicant) return
    // rls_test_cleanup purges the request (+history) and the notifications
    // this flow sent to rls-test accounts; real members receive nothing
    // (submit's command fan-out is suppressed for rls-test applicants).
    const { error } = await applicant.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    await Promise.all(
      [applicant, bcb, lead, reviewer]
        .filter((c): c is SupabaseClient => !!c)
        .map((c) => c.auth.signOut()),
    )
  })

  it('inactive applicant can create (fresh run) or reuse (re-run) their draft and read it back', async () => {
    if (!requestId) {
      const ins = await applicant.from('membership_requests')
        .insert({
          applicant_id: applicantId, display_name: 'RLS Test Applicant',
          requested_bureau: 'LSB', requested_role: 'detective',
          reason: '[rls-test] membership security-wall fixture',
        })
        .select(COLS)
      expect(ins.error).toBeNull()
      expect(ins.data).toHaveLength(1)
      expect(ins.data![0]).toMatchObject({ status: 'draft', requested_bureau: 'LSB', requested_role: 'detective' })
      requestId = ins.data![0].id
    } else {
      // Reuse path: reset the applicant-editable form fields. On a terminal
      // row the mr_upd policy matches zero rows (silently) — that is fine,
      // the status-dependent tests below detect it and skip.
      const upd = await applicant.from('membership_requests')
        .update({ display_name: 'RLS Test Applicant', requested_bureau: 'LSB', requested_role: 'detective' })
        .eq('id', requestId)
        .select('id')
      expect(upd.error).toBeNull()
    }
    const sel = await applicant.from('membership_requests').select(COLS).eq('id', requestId)
    expect(sel.error).toBeNull()
    expect(sel.data).toHaveLength(1)
    expect(sel.data![0].applicant_id).toBe(applicantId)
  })

  it('a second request for the same applicant is rejected (unique per applicant)', async () => {
    const { error } = await applicant.from('membership_requests')
      .insert({
        applicant_id: applicantId, display_name: 'RLS Test Applicant (dupe)',
        requested_bureau: 'BCB', requested_role: 'detective', reason: '[rls-test] duplicate',
      })
      .select('id')
    expect(error).not.toBeNull()
  })

  it("requested_bureau 'JTF' is rejected (permanent onboarding departments only)", async () => {
    // CHECK constraints fire before the unique index, so this asserts the
    // bureau lock even though the applicant already has a row.
    const { error } = await applicant.from('membership_requests')
      .insert({
        applicant_id: applicantId, display_name: 'RLS Test Applicant (JTF)',
        requested_bureau: 'JTF', requested_role: 'detective', reason: '[rls-test] JTF attempt',
      })
      .select('id')
    expect(error).not.toBeNull()
  })

  it('internal_decision_note is not selectable by the applicant (column grant revoked)', async () => {
    const { error } = await applicant.from('membership_requests')
      .select('id,internal_decision_note')
      .eq('id', requestId)
    expect(error).not.toBeNull()
  })

  it('direct status update cannot approve (column grant / trigger freeze)', async () => {
    const before = await readStatus()
    const upd = await applicant.from('membership_requests')
      .update({ status: 'approved' })
      .eq('id', requestId)
      .select('id')
    // Either the column grant rejects the write outright, or the guard
    // trigger silently reverts it — both leave the status untouched.
    if (!upd.error) expect(await readStatus()).toBe(before)
    else expect(upd.error).not.toBeNull()
  })

  it('applicant cannot review their own request via review_membership_request', async () => {
    const { error } = await applicant.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve', p_final_bureau: 'LSB', p_final_role: 'detective',
    })
    expect(error).not.toBeNull()
  })

  it('ordinary detective gets neither the admin queue nor the row', async () => {
    const rpc = await bcb.rpc('admin_membership_requests')
    expect(rpc.error).not.toBeNull()
    const sel = await bcb.from('membership_requests').select('id').eq('id', requestId)
    expect(sel.error).toBeNull()
    expect(sel.data).toHaveLength(0) // RLS: invisible, not an error
  })

  it.skipIf(!PW.lead)('bureau lead cannot approve outside their bureau or assign command roles', async (ctx) => {
    if (!(await ensurePending())) ctx.skip('fixture row is terminal from a previous run — no server reset path (see README)')
    // rls-test-lead is bureau_lead of LSB (see README): BCB is the wrong bureau.
    const wrongBureau = await lead!.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve', p_final_bureau: 'BCB', p_final_role: 'detective',
    })
    expect(wrongBureau.error).not.toBeNull()
    expect(wrongBureau.error!.message).toMatch(/own bureau/i)
    const commandRole = await lead!.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve', p_final_bureau: 'LSB', p_final_role: 'director',
    })
    expect(commandRole.error).not.toBeNull()
    expect(commandRole.error!.message).toMatch(/command roles/i)
    expect(await readStatus()).toBe('pending') // no partial decision leaked
  })

  it.skipIf(!reviewerCreds)('command review: correction → resubmit → reject leaves the applicant inactive', async (ctx) => {
    if (!(await ensurePending())) ctx.skip('fixture row is terminal from a previous run — no server reset path (see README)')
    const corr = await reviewer!.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'request_correction',
      p_applicant_note: '[rls-test] please correct',
    })
    expect(corr.error).toBeNull()
    expect(await readStatus()).toBe('correction_requested')

    const resub = await applicant.rpc('membership_request_submit', { p_request: requestId })
    expect(resub.error).toBeNull()
    expect(await readStatus()).toBe('pending')

    // REJECT, never approve: approving would activate the shared
    // rls-test-inactive fixture and break every deny-by-default test in this
    // suite. The approval-success path runs in the next block against the
    // disposable rls-test-applicant account instead.
    const rej = await reviewer!.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'reject',
      p_applicant_note: '[rls-test] rejected by security suite',
      p_internal_note: '[rls-test] internal note (must stay hidden from the applicant)',
    })
    expect(rej.error).toBeNull()

    const row = await applicant.from('membership_requests').select(COLS).eq('id', requestId)
    expect(row.error).toBeNull()
    expect(row.data![0].status).toBe('rejected')
    expect(row.data![0].decided_by).toBe(reviewerId)
    // The wall around the reject path: the applicant's profile stays inactive.
    const prof = await applicant.from('profiles').select('id,active').eq('id', applicantId)
    expect(prof.error).toBeNull()
    expect(prof.data![0].active).toBe(false)
  })

  it('applicant cannot delete the request; withdraw is the only exit', async () => {
    const del = await applicant.from('membership_requests').delete().eq('id', requestId).select('id')
    if (!del.error) expect(del.data).toHaveLength(0) // no delete policy: zero rows
    const still = await applicant.from('membership_requests').select('id,status').eq('id', requestId)
    expect(still.error).toBeNull()
    expect(still.data).toHaveLength(1)
    const cur = still.data![0].status as string
    const wd = await applicant.rpc('membership_request_withdraw', { p_request: requestId })
    if (['draft', 'pending', 'correction_requested'].includes(cur)) {
      expect(wd.error).toBeNull()
      expect(await readStatus()).toBe('withdrawn')
    } else {
      expect(wd.error).not.toBeNull() // terminal rows (rejected/withdrawn) cannot be withdrawn again
    }
  })
})

/** Membership approval — the SUCCESS path, exercised against the DISPOSABLE
 *  rls-test-applicant fixture (never the shared rls-test-inactive account).
 *  review_membership_request must be atomic: request status + decided_*
 *  columns + profile role/division/active + applicant notification + history
 *  land together. Teardown returns the fixture to inactive detective/LSB and
 *  purges the request via rls_test_cleanup (which only checks that the CALLER
 *  is an rls-test auth account — active is not required, so the deactivated
 *  applicant can still purge). */
const approvalEnabled = enabled && !!(PW.applicant && (PW.director || PW.owner))
describe.skipIf(!approvalEnabled)('Membership approval — atomic activation (disposable applicant)', () => {
  let applicant: SupabaseClient
  let reviewer: SupabaseClient
  let applicantId = ''
  let reviewerId = ''
  let requestId = ''
  const reviewerCreds = PW.director
    ? { email: 'rls-test-director@cidportal.test', pw: PW.director }
    : { email: 'rls-test-owner@cidportal.test', pw: PW.owner! }

  beforeAll(async () => {
    applicant = mk(); reviewer = mk()
    // Password grant works while the profile is inactive — the active gate is
    // app/RLS-level, same as rls-test-inactive.
    applicantId = await signInAs(applicant, 'rls-test-applicant@cidportal.test', PW.applicant!)
    reviewerId = await signInAs(reviewer, reviewerCreds.email, reviewerCreds.pw)
    // Reset: purge any request a previous run left, then force the fixture
    // back to inactive detective/LSB (a no-op that records a role_event on an
    // already-clean fixture — cleanup removes those too).
    const clean = await applicant.rpc('rls_test_cleanup')
    if (clean.error) throw new Error(`rls_test_cleanup failed: ${clean.error.message}`)
    const reset = await reviewer.rpc('assign_member', {
      target: applicantId, new_role: 'detective', new_division: 'LSB', set_active: false,
    })
    if (reset.error) throw new Error(`assign_member reset failed: ${reset.error.message}`)
  })

  afterAll(async () => {
    if (!reviewer) return
    // Safety net (idempotent with the final test): never leave the disposable
    // applicant active, and purge its request/notifications/role_events.
    const back = await reviewer.rpc('assign_member', {
      target: applicantId, new_role: 'detective', new_division: 'LSB', set_active: false,
    })
    if (back.error) throw new Error(`assign_member restore failed: ${back.error.message}`)
    const { error } = await applicant.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    await Promise.all([applicant, reviewer].map((c) => c.auth.signOut()))
  })

  it('reset leaves the disposable applicant inactive', async () => {
    const { data, error } = await applicant.from('profiles').select('id,active').eq('id', applicantId)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
    expect(data![0].active).toBe(false)
  })

  it('applicant drafts and submits a request', async () => {
    const ins = await applicant.from('membership_requests')
      .insert({
        applicant_id: applicantId, display_name: 'RLS Test Applicant (disposable)',
        requested_bureau: 'LSB', requested_role: 'detective',
        reason: '[rls-test] approval-path fixture',
      })
      .select('id,status')
    expect(ins.error).toBeNull()
    requestId = ins.data![0].id
    const sub = await applicant.rpc('membership_request_submit', { p_request: requestId })
    expect(sub.error).toBeNull()
    expect((sub.data as { status: string }).status).toBe('pending')
  })

  it('approve_with_changes activates the profile atomically', async () => {
    const rev = await reviewer.rpc('review_membership_request', {
      p_request: requestId, p_decision: 'approve_with_changes',
      p_final_bureau: 'BCB', p_final_role: 'senior_detective',
      p_applicant_note: '[rls-test] approved with changes',
      p_internal_note: '[rls-test] internal',
    })
    expect(rev.error).toBeNull()
    const row = rev.data as {
      status: string; decided_bureau: string; decided_role: string
      requested_bureau: string; requested_role: string
      decided_by: string; decided_at: string | null
    }
    expect(row).toMatchObject({
      status: 'approved_with_changes',
      decided_bureau: 'BCB', decided_role: 'senior_detective',
      requested_bureau: 'LSB', requested_role: 'detective', // originals preserved
      decided_by: reviewerId,
    })
    expect(row.decided_at).not.toBeNull()

    // Profile flipped in the same transaction.
    const prof = await applicant.from('profiles').select('id,role,division,active').eq('id', applicantId)
    expect(prof.error).toBeNull()
    expect(prof.data![0]).toMatchObject({ active: true, role: 'senior_detective', division: 'BCB' })

    // The applicant was notified about their own approval.
    const note = await applicant.from('notifications')
      .select('id')
      .eq('type', 'member_approved')
      .eq('payload->>request_id', requestId)
    expect(note.error).toBeNull()
    expect(note.data).toHaveLength(1)

    // Column revoke still holds for the now-active applicant.
    const internal = await applicant.from('membership_requests')
      .select('id,internal_decision_note')
      .eq('id', requestId)
    expect(internal.error).not.toBeNull()

    // Applicant-visible history: submitted + approved_with_changes; the
    // internal-note history row stays hidden (mrh_sel filters internal).
    const hist = await applicant.from('membership_request_history')
      .select('id,action,internal')
      .eq('request_id', requestId)
    expect(hist.error).toBeNull()
    const actions = (hist.data ?? []).map((h) => h.action as string)
    expect(actions).toContain('submitted')
    expect(actions).toContain('approved_with_changes')
    expect((hist.data ?? []).every((h) => h.internal === false)).toBe(true)
  })

  it('teardown: deactivation + cleanup leave no trace', async () => {
    const back = await reviewer.rpc('assign_member', {
      target: applicantId, new_role: 'detective', new_division: 'LSB', set_active: false,
    })
    expect(back.error).toBeNull()
    const prof = await applicant.from('profiles').select('id,active').eq('id', applicantId)
    expect(prof.error).toBeNull()
    expect(prof.data![0].active).toBe(false)
    // rls_test_cleanup only verifies the caller is an rls-test auth account,
    // so the now-inactive applicant may still purge its own fixtures.
    const clean = await applicant.rpc('rls_test_cleanup')
    expect(clean.error).toBeNull()
    const left = await applicant.from('membership_requests').select('id').eq('applicant_id', applicantId)
    expect(left.error).toBeNull()
    expect(left.data).toHaveLength(0)
  })
})

/** Joint cases (migration 20260713040000) — temporary, case-scoped
 *  cross-bureau access via joint assignments. Uses the same LSB-owned-case /
 *  BCB-outsider pair as the bureau-isolation block; every case created here
 *  is removed by rls_test_cleanup in afterAll. */
describe.skipIf(!enabled)('Joint cases — temporary case-scoped cross-bureau access', () => {
  let lsb: SupabaseClient
  let bcb: SupabaseClient
  let bcbId = ''
  let caseA = '' // gets converted to joint
  let caseB = '' // control: joint access must NOT leak here
  const num = `RLS-JOINT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`

  beforeAll(async () => {
    lsb = mk(); bcb = mk()
    await signInAs(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    bcbId = await signInAs(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    const a = await lsb.from('cases').insert({ case_number: num, title: 'RLS joint-case test', bureau: 'LSB' }).select('id')
    if (a.error) throw new Error(`case A insert failed: ${a.error.message}`)
    caseA = a.data![0].id
    const b = await lsb.from('cases').insert({ case_number: `${num}-B`, title: 'RLS joint-case control', bureau: 'LSB' }).select('id')
    if (b.error) throw new Error(`case B insert failed: ${b.error.message}`)
    caseB = b.data![0].id
    const rep = await lsb.from('reports')
      .insert({ case_id: caseA, template: 'initial', kind: 'initial', seq: 1, fields: {} })
      .select('id')
    if (rep.error) throw new Error(`report insert failed: ${rep.error.message}`)
  })

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup') // cascades cases + assignments + reports
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    console.info('[rls] joint-case cleanup:', JSON.stringify(data))
    await Promise.all([lsb, bcb].map((c) => c.auth.signOut()))
  })

  it('BCB cannot read the LSB case before conversion (precondition)', async () => {
    const { data, error } = await bcb.from('cases').select('id').in('id', [caseA, caseB])
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('joint assignment rows cannot be minted by direct insert', async () => {
    // Outsider: no case access at all.
    const outsider = await bcb.from('case_assignments')
      .insert({ case_id: caseA, officer_id: bcbId, role: 'support', assignment_source: 'joint_case' })
      .select('id')
    expect(outsider.error).not.toBeNull()
    // Insider: has case access, but the with-check pins direct writes to 'standard'.
    const insider = await lsb.from('case_assignments')
      .insert({ case_id: caseA, officer_id: bcbId, role: 'support', assignment_source: 'joint_case' })
      .select('id')
    expect(insider.error).not.toBeNull()
  })

  it("an unrelated detective cannot convert someone else's case", async () => {
    const { error } = await bcb.rpc('convert_case_to_joint', {
      p_case: caseA,
      p_members: [{ officer_id: bcbId, joint_role: 'Joint Investigator' }],
      p_note: '[rls-test] should never work',
    })
    expect(error).not.toBeNull()
  })

  it('case creator converts to joint; bureau stays LSB (never flips to JTF)', async () => {
    const { data, error } = await lsb.rpc('convert_case_to_joint', {
      p_case: caseA,
      p_members: [{ officer_id: bcbId, joint_role: 'Joint Investigator' }],
      p_note: '[rls-test] joint conversion',
    })
    expect(error).toBeNull()
    expect((data as { members_added: number }).members_added).toBe(1)
    const c = await lsb.from('cases').select('id,bureau,is_joint_case,originating_bureau').eq('id', caseA)
    expect(c.error).toBeNull()
    expect(c.data![0]).toMatchObject({ is_joint_case: true, bureau: 'LSB', originating_bureau: 'LSB' })
  })

  it('the joint member can now read the case and its reports', async () => {
    const c = await bcb.from('cases').select('id').eq('id', caseA)
    expect(c.error).toBeNull()
    expect(c.data).toHaveLength(1)
    const r = await bcb.from('reports').select('id').eq('case_id', caseA)
    expect(r.error).toBeNull()
    expect(r.data!.length).toBeGreaterThanOrEqual(1)
  })

  it('joint access is case-scoped: the second LSB case stays invisible', async () => {
    const { data, error } = await bcb.from('cases').select('id').eq('id', caseB)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('removing the member revokes access immediately', async () => {
    const rm = await lsb.rpc('joint_case_remove_member', { p_case: caseA, p_officer: bcbId, p_reason: '[rls-test] removal' })
    expect(rm.error).toBeNull()
    const { data, error } = await bcb.from('cases').select('id').eq('id', caseA)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('expiring re-add: access holds until expiry, then is enforced server-side', async () => {
    const members = (ms: number) => [{
      officer_id: bcbId, joint_role: 'Read-Only Member',
      expires_at: new Date(Date.now() + ms).toISOString(),
    }]
    let add = await lsb.rpc('joint_case_add_members', { p_case: caseA, p_members: members(2000) })
    if (add.error && /future/i.test(add.error.message)) {
      // client clock behind the DB — pad the offset once and keep polling below
      add = await lsb.rpc('joint_case_add_members', { p_case: caseA, p_members: members(8000) })
    }
    expect(add.error).toBeNull()
    const before = await bcb.from('cases').select('id').eq('id', caseA)
    expect(before.error).toBeNull()
    expect(before.data).toHaveLength(1)
    await sleep(3000)
    let rows = (await bcb.from('cases').select('id').eq('id', caseA)).data ?? []
    for (let i = 0; i < 10 && rows.length > 0; i++) {
      await sleep(1000)
      rows = (await bcb.from('cases').select('id').eq('id', caseA)).data ?? []
    }
    expect(rows).toHaveLength(0)
  }, 25_000)

  it('joint_case_end clears the flag but preserves assignment history', async () => {
    const end = await lsb.rpc('joint_case_end', { p_case: caseA, p_note: '[rls-test] joint case ended' })
    expect(end.error).toBeNull()
    const c = await lsb.from('cases').select('id,is_joint_case,bureau,originating_bureau,joint_case_ended_at').eq('id', caseA)
    expect(c.error).toBeNull()
    expect(c.data![0]).toMatchObject({ is_joint_case: false, bureau: 'LSB', originating_bureau: 'LSB' })
    expect(c.data![0].joint_case_ended_at).not.toBeNull()
    const a = await lsb.from('case_assignments')
      .select('id,assignment_source,removed_at')
      .eq('case_id', caseA)
      .eq('officer_id', bcbId)
    expect(a.error).toBeNull()
    expect(a.data).toHaveLength(1)
    expect(a.data![0].assignment_source).toBe('joint_case')
    expect(a.data![0].removed_at).not.toBeNull()
  })
})

/** Announcements (migrations 20260713050000/060000) — audience CHECK,
 *  can_post_audience authority and server-side fan-out. Detective-tier denial
 *  always runs; the positive paths need the lead/director passwords.
 *
 *  ZERO fan-out to real members: broad audiences ('all' / a division) are
 *  proven via announcement_recipient_count (read-only) and DIRECT inserts —
 *  fan-out lives only in publish_announcement, so direct inserts create no
 *  notifications. The one publish_announcement success uses the
 *  'specific_members' audience with ONLY rls-test accounts mentioned. Every
 *  announcement carries a '[rls-test]' marker and is deleted by its author in
 *  afterAll (ann_del). */
describe.skipIf(!enabled)('Announcements — audience authority & scoped fan-out', () => {
  let lsb: SupabaseClient
  let bcb: SupabaseClient
  let lead: SupabaseClient | null = null
  let director: SupabaseClient | null = null
  let lsbId = ''
  let bcbId = ''
  const created: { by: () => SupabaseClient; id: string }[] = []

  beforeAll(async () => {
    lsb = mk(); bcb = mk()
    lsbId = await signInAs(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    bcbId = await signInAs(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    if (PW.lead) { lead = mk(); await signInAs(lead, 'rls-test-lead@cidportal.test', PW.lead) }
    if (PW.director) { director = mk(); await signInAs(director, 'rls-test-director@cidportal.test', PW.director) }
  })

  afterAll(async () => {
    if (!lsb) return
    // Baselines for the live board: leftovers pollute it, so fail loudly.
    for (const a of created) {
      const del = await a.by().from('announcements').delete().eq('id', a.id).select('id')
      if (del.error || (del.data ?? []).length !== 1) {
        throw new Error(`announcement cleanup failed for ${a.id}: ${del.error?.message ?? 'no row deleted'}`)
      }
    }
    // Purge the notifications the fan-out sent to the rls-test-* accounts.
    const { error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup failed: ${error.message}`)
    await Promise.all(
      [lsb, bcb, lead, director]
        .filter((c): c is SupabaseClient => !!c)
        .map((c) => c.auth.signOut()),
    )
  })

  it('a detective can neither insert nor publish announcements', async () => {
    const ins = await lsb.from('announcements')
      .insert({ title: '[rls-test] detective direct insert', body: 'should never exist', audience: 'LSB' })
      .select('id')
    expect(ins.error).not.toBeNull()
    const pub = await lsb.rpc('publish_announcement', {
      p_title: '[rls-test] detective publish', p_body: 'should never exist', p_audience: 'LSB',
    })
    expect(pub.error).not.toBeNull()
  })

  it('announcement_recipient_count is rejected for a detective', async () => {
    const { error } = await lsb.rpc('announcement_recipient_count', { p_audience: 'LSB' })
    expect(error).not.toBeNull()
  })

  it.skipIf(!PW.lead)('bureau lead: no @everyone; own-division authority proven without fan-out', async () => {
    const everyone = await lead!.rpc('publish_announcement', {
      p_title: '[rls-test] lead @everyone attempt', p_body: 'should never publish', p_audience: 'all',
    })
    expect(everyone.error).not.toBeNull()
    expect(everyone.error!.message).toMatch(/audience/i)
    // rls-test-lead is bureau_lead of LSB (see README). Authority proof
    // WITHOUT notifying real LSB members: recipient_count is read-only…
    const count = await lead!.rpc('announcement_recipient_count', { p_audience: 'LSB' })
    expect(count.error).toBeNull()
    expect(count.data as number).toBeGreaterThanOrEqual(0)
    // …and a direct INSERT creates no notifications (fan-out lives only in
    // publish_announcement).
    const ins = await lead!.from('announcements')
      .insert({ title: '[rls-test] LSB division notice', body: 'RLS security-suite fixture — safe to ignore.', audience: 'LSB' })
      .select('id')
    expect(ins.error).toBeNull()
    const annId = ins.data![0].id as string
    created.push({ by: () => lead!, id: annId })
    // Visible to a same-division member…
    const same = await lsb.from('announcements').select('id').eq('id', annId)
    expect(same.error).toBeNull()
    expect(same.data).toHaveLength(1)
    // …and invisible to the other bureau's detective.
    const other = await bcb.from('announcements').select('id').eq('id', annId)
    expect(other.error).toBeNull()
    expect(other.data).toHaveLength(0)
  })

  it.skipIf(!PW.director)('director @everyone authority proven without fan-out', async () => {
    const count = await director!.rpc('announcement_recipient_count', { p_audience: 'all' })
    expect(count.error).toBeNull()
    expect(count.data as number).toBeGreaterThanOrEqual(0)
    // Direct INSERT (RLS ann_ins allows the audience) — no notifications.
    const ins = await director!.from('announcements')
      .insert({ title: '[rls-test] portal-wide notice', body: 'RLS security-suite fixture — safe to ignore.', audience: 'all' })
      .select('id')
    expect(ins.error).toBeNull()
    const annId = ins.data![0].id as string
    created.push({ by: () => director!, id: annId })
    for (const c of [lsb, bcb]) {
      const vis = await c.from('announcements').select('id').eq('id', annId)
      expect(vis.error).toBeNull()
      expect(vis.data).toHaveLength(1)
      // No fan-out happened: direct inserts bypass publish_announcement.
      const notes = await c.from('notifications').select('id').eq('payload->>announce_id', annId)
      expect(notes.error).toBeNull()
      expect(notes.data).toHaveLength(0)
    }
  })

  it.skipIf(!(PW.director || PW.lead))('specific_members publish fans out to exactly the mentioned test accounts', async () => {
    const author = (director ?? lead)!
    // Safe fan-out proof: the recipient set is ONLY the two rls-test
    // detectives, so publish_announcement never pings a real member.
    const pub = await author.rpc('publish_announcement', {
      p_title: '[rls-test] specific-members fan-out',
      p_body: 'RLS security-suite fixture — safe to ignore.',
      p_audience: 'specific_members',
      p_mentions: [
        { target: lsbId, label: 'RLS Test LSB' },
        { target: bcbId, label: 'RLS Test BCB' },
      ],
    })
    expect(pub.error).toBeNull()
    const res = pub.data as { announce_id: string; recipients: number }
    created.push({ by: () => author, id: res.announce_id })
    expect(res.recipients).toBe(2) // only the mentioned rls-test accounts
    for (const c of [lsb, bcb]) {
      // Visible to each mentioned account. Neither is command, the author, or
      // in a division matching the audience, so visibility can only come
      // through the specific_members mentions clause of ann_sel.
      const vis = await c.from('announcements').select('id,audience').eq('id', res.announce_id)
      expect(vis.error).toBeNull()
      expect(vis.data).toHaveLength(1)
      expect(vis.data![0].audience).toBe('specific_members')
      // Deduplicated fan-out: exactly one notification each.
      const notes = await c.from('notifications')
        .select('id')
        .eq('type', 'announcement')
        .eq('payload->>announce_id', res.announce_id)
      expect(notes.error).toBeNull()
      expect(notes.data).toHaveLength(1)
    }
  })
})

/** Login denial (migration 20260713090000) — an app-level block Command/Owner
 *  apply via deny_member_login()/restore_member_login(). Uses the disposable
 *  rls-test-applicant so the shared deny-by-default fixtures are untouched; the
 *  block also stops the applicant filing a membership request. Teardown
 *  restores + rls_test_cleanup so the account returns to inactive/blank. */
const denyEnabled = enabled && !!(PW.applicant && PW.director)
describe.skipIf(!denyEnabled)('Login denial — deny/restore access', () => {
  let applicant: SupabaseClient
  let director: SupabaseClient
  let bcb: SupabaseClient
  let applicantId = ''

  beforeAll(async () => {
    applicant = mk(); director = mk(); bcb = mk()
    applicantId = await signInAs(applicant, 'rls-test-applicant@cidportal.test', PW.applicant!)
    await signInAs(director, 'rls-test-director@cidportal.test', PW.director!)
    await signInAs(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    // Clean slate: clear any prior denial + request.
    await director.rpc('restore_member_login', { p_target: applicantId })
    await applicant.rpc('rls_test_cleanup')
  })

  afterAll(async () => {
    if (!director) return
    await director.rpc('restore_member_login', { p_target: applicantId })
    await applicant.rpc('rls_test_cleanup')
    await Promise.all([applicant, director, bcb].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('an ordinary detective cannot deny anyone', async () => {
    const { error } = await bcb.rpc('deny_member_login', { p_target: applicantId, p_reason: '[rls-test]' })
    expect(error).not.toBeNull()
  })

  it('a director can deny and it blocks the membership-request flow', async () => {
    const deny = await director.rpc('deny_member_login', { p_target: applicantId, p_reason: '[rls-test] denied' })
    expect(deny.error).toBeNull()
    // Applicant sees the block on their own profile with the reason.
    const prof = await applicant.from('profiles').select('login_denied,login_denied_reason,active').eq('id', applicantId).maybeSingle()
    expect(prof.error).toBeNull()
    expect(prof.data!.login_denied).toBe(true)
    expect(prof.data!.active).toBe(false)
    expect(prof.data!.login_denied_reason).toBe('[rls-test] denied')
    // A denied applicant cannot insert a membership request (mr_ins RLS).
    const ins = await applicant.from('membership_requests')
      .insert({ applicant_id: applicantId, display_name: 'RLS Test Applicant', requested_bureau: 'LSB', requested_role: 'detective', reason: '[rls-test] blocked' })
      .select('id')
    expect(ins.error).not.toBeNull()
  })

  it('the denied applicant cannot self-clear the block', async () => {
    // Direct profile update is frozen by guard_profile for clients.
    await applicant.from('profiles').update({ login_denied: false }).eq('id', applicantId)
    const prof = await applicant.from('profiles').select('login_denied').eq('id', applicantId).maybeSingle()
    expect(prof.data!.login_denied).toBe(true)
    // And the restore RPC is authority-gated.
    const { error } = await applicant.rpc('restore_member_login', { p_target: applicantId })
    expect(error).not.toBeNull()
  })

  it('restore clears the block and re-opens the request flow', async () => {
    const res = await director.rpc('restore_member_login', { p_target: applicantId })
    expect(res.error).toBeNull()
    const prof = await applicant.from('profiles').select('login_denied,active').eq('id', applicantId).maybeSingle()
    expect(prof.data!.login_denied).toBe(false)
    expect(prof.data!.active).toBe(false)
    // Now the applicant can file a request again.
    const ins = await applicant.from('membership_requests')
      .insert({ applicant_id: applicantId, display_name: 'RLS Test Applicant', requested_bureau: 'LSB', requested_role: 'detective', reason: '[rls-test] restored' })
      .select('id')
    expect(ins.error).toBeNull()
  })

  it('a member cannot deny their own login', async () => {
    const { error } = await director.rpc('deny_member_login', { p_target: (await director.auth.getUser()).data.user!.id, p_reason: 'x' })
    expect(error).not.toBeNull()
  })
})
