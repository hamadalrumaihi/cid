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
