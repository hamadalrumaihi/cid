/** v1.60 — advisor hardening, migration 20260808360000_advisor_hardening.
 *
 *  A full Supabase advisor digest (zero ERROR-level findings) surfaced four
 *  actionable WARN/INFO groups; this suite proves the client-observable ones
 *  live:
 *   - 51 RPCs had drifted from the anon-revoked convention (their creation
 *     waves ran `revoke ... from public` without `from anon`, and Supabase's
 *     defacl grants anon EXPLICITLY): every one is now permission-denied for
 *     anon — the grant is checked BEFORE the body, so these probes must fail
 *     with /permission denied/, not with an in-body auth raise;
 *   - authenticated EXECUTE is untouched: read-only members of the 49 still
 *     answer for the right signed-in callers (doj_bureau_coverage /
 *     justice_directory for an active member, admin_membership_requests /
 *     announcement_recipient_count for command, owner_security_overview for
 *     the owner, rls_test_cleanup for a fixture — the beforeAll pre-clean
 *     itself proves that one);
 *   - the search_path pin on private.case_number_base broke nothing:
 *     next_case_number (its only caller) still mints numbers in the bureau
 *     block;
 *   - client_errors_ins no longer accepts spoofed attribution: an insert with
 *     someone ELSE's reporter_id is an RLS violation, while the reporter
 *     shapes that actually occur — no reporter_id (column default auth.uid()),
 *     own id, explicit NULL — all still insert; anon stays hard-denied
 *     (no table grant since 20260807150000).
 *  The 67 FK covering indexes are not client-observable through PostgREST —
 *  they are verified by re-running the advisor after apply, not here.
 *
 *  Fixtures: lsb (MCB detective — the plain member), lead (bureau_lead =
 *  command), owner (owner-gated probes + client_errors teardown), anon.
 *  bcb is signed in only to keep the shared fixture-password contract
 *  (unused otherwise). CLEANUP: client_errors rows are tag-deleted by the
 *  owner in afterAll (rls_test_cleanup also sweeps fixture-reporter rows,
 *  but the explicit-NULL row has no reporter to match). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:v160] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

/** Placeholder uuid — never dereferenced: the EXECUTE check fires first. */
const NIL = '00000000-0000-0000-0000-000000000000'
const NOW = new Date().toISOString()

/** The 51 drifted RPCs, with named args matching each LIVE signature so
 *  PostgREST resolves the function (a wrong arg set would 404 as "function
 *  not found" and prove nothing about the grant). Values are inert — anon is
 *  refused at the ACL, before any validation runs. */
const REVOKED_RPCS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['admin_membership_requests', {}],
  ['announcement_notify_update', { p_announce: NIL }],
  ['announcement_recipient_count', { p_audience: 'members' }],
  ['approve_transfer_source', { p_id: NIL }],
  ['approve_transfer_target', { p_id: NIL }],
  ['assign_member', { target: NIL, set_active: false }],
  ['cancel_transfer', { p_id: NIL }],
  ['case_reassign_bureau', { p_case: NIL, p_to_bureau: 'street_crimes', p_reason: 'v160 anon probe' }],
  ['change_member_role', { p_target: NIL, p_new_role: 'detective', p_reason: 'v160 anon probe' }],
  ['close_legal_request', { p_request: NIL }],
  ['complete_transfer', { p_id: NIL }],
  ['convert_case_to_joint', { p_case: NIL, p_members: [] }],
  ['correct_membership_organization', { p_target: NIL, p_direction: 'to_justice', p_reason: 'v160 anon probe' }],
  ['create_legal_request', { p_case: NIL, p_request_type: 'warrant', p_subtype: 'search', p_title: 'v160 anon probe' }],
  ['deny_member_login', { p_target: NIL, p_reason: 'v160 anon probe' }],
  ['doj_bureau_coverage', {}],
  ['import_legal_warrant', {
    p_case: NIL, p_subtype: 'search', p_title: 'v160 anon probe', p_priority: 'routine',
    p_form: {}, p_narrative: 'v160', p_person: NIL, p_classification: null,
    p_source_submitted_at: NOW, p_source_submitter: NIL, p_import_key: 'v160-anon-probe',
  }],
  ['import_rollback_by_key', { p_import_key: 'v160-anon-probe' }],
  ['issue_legal_request', { p_request: NIL }],
  ['joint_case_add_members', { p_case: NIL, p_members: [] }],
  ['joint_case_end', { p_case: NIL }],
  ['joint_case_remove_member', { p_case: NIL, p_officer: NIL }],
  ['justice_directory', {}],
  ['legal_internal_notes', { p_request: NIL }],
  ['legal_request_people', { p_request: NIL }],
  ['legal_search', { q: 'v160 anon probe' }],
  ['mdt_wanted_current', {}],
  ['membership_request_submit', { p_request: NIL }],
  ['membership_request_withdraw', { p_request: NIL }],
  ['owner_security_overview', {}],
  ['permanent_delete_arm', { p_target: NIL, p_reason: 'v160 anon probe' }],
  ['permanent_delete_execute', { p_token: NIL, p_confirm: 'v160' }],
  ['permanent_delete_preview', { p_target: NIL }],
  ['publish_announcement', { p_title: 'v160', p_body: 'v160 anon probe', p_audience: 'members' }],
  ['record_subpoena_compliance', { p_request: NIL, p_status: 'complied' }],
  ['record_subpoena_service', { p_request: NIL, p_status: 'served' }],
  ['reject_transfer', { p_id: NIL }],
  ['remove_legal_exhibit', { p_exhibit: NIL }],
  ['report_reopen', { p_report: NIL }],
  ['resolve_case_originating_bureau', { p_case: NIL, p_bureau: 'major_crimes' }],
  ['restore_member_login', { p_target: NIL }],
  ['review_membership_request', { p_request: NIL, p_decision: 'reject' }],
  ['rls_test_cleanup', {}],
  ['rls_test_reset_member', { p_target: NIL, p_role: 'detective', p_division: 'major_crimes', p_active: false }],
  ['rls_test_spawn_disposable', { p_suffix: 'v160' }],
  ['security_test_report', { p_suite: 'v160-anon-probe', p_passed: 0, p_failed: 0, p_skipped: 0 }],
  ['set_profile_test_flag', { p_target: NIL, p_is_test: true }],
  ['signoff_command_override', { p_case: NIL, p_action: 'approve', p_reason: 'v160 anon probe' }],
  ['update_legal_draft', { p_request: NIL }],
  ['warrant_set_status', { p_report: NIL, p_status: 'signed' }],
  ['withdraw_legal_request', { p_request: NIL }],
]

describe.skipIf(!enabled)('v1.60 — advisor hardening (live)', () => {
  let lsb: C, bcb: C, lead: C, owner: C, anon: C
  let lsbId = '', leadId = ''
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const msg = (kind: string) => `[rls-test] v160 ${kind} ${tag}`

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); owner = mk(); anon = mk()
    for (const [client, email, pw] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb],
      [lead, 'rls-test-lead@cidportal.test', PW.lead],
      [owner, 'rls-test-owner@cidportal.test', PW.owner],
    ] as const) {
      const id = await signInWithRetry(client, email, pw!)
      if (client === lsb) lsbId = id
      if (client === lead) leadId = id
    }
    // Pre-clean — and, incidentally, the authenticated-positive proof for
    // rls_test_cleanup (one of the 49): the grant to authenticated survived.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
  })

  afterAll(async () => {
    // client_errors has no case FK to cascade through — tag-delete as owner
    // (client_errors_owner_del). Covers the explicit-NULL row that
    // rls_test_cleanup's reporter sweep cannot match.
    if (owner) { try { await owner.from('client_errors').delete().like('message', `%${tag}%`) } catch { /* best effort */ } }
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lsb, bcb, lead, owner, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ================= 1) the 49 drifted RPCs are anon-revoked ================= */

  it('anon gets permission-denied on every drifted RPC (grant check, not body raise)', async () => {
    const results = await Promise.all(
      REVOKED_RPCS.map(async ([fn, args]) => [fn, await anon.rpc(fn, args)] as const),
    )
    for (const [fn, r] of results) {
      expect(r.error, `${fn}: expected an error for anon`).not.toBeNull()
      // The ACL refusal — NOT "not authorized"/"function not found", which
      // would mean the body ran (grant still there) or the probe missed the
      // live signature.
      expect(r.error!.message, `${fn}: ${r.error!.message}`).toMatch(/permission denied/i)
    }
  })

  /* ================= 2) authenticated EXECUTE is untouched ================= */

  it('an active member still executes the member-facing reads', async () => {
    const cov = await lsb.rpc('doj_bureau_coverage')
    expect(cov.error, cov.error?.message).toBeNull()
    expect((cov.data ?? []).length, 'coverage rows for the three CID bureaus').toBeGreaterThan(0)
    const dir = await lsb.rpc('justice_directory')
    expect(dir.error, dir.error?.message).toBeNull()
  })

  it('command still executes its gated reads', async () => {
    const reqs = await lead.rpc('admin_membership_requests')
    expect(reqs.error, reqs.error?.message).toBeNull()
    const count = await lead.rpc('announcement_recipient_count', { p_audience: 'members' })
    expect(count.error, count.error?.message).toBeNull()
    expect(typeof count.data).toBe('number')
  })

  it('the owner still executes owner_security_overview', async () => {
    const r = await owner.rpc('owner_security_overview')
    expect(r.error, r.error?.message).toBeNull()
  })

  /* ================= 3) search_path pin on private.case_number_base ================= */

  it('next_case_number still mints in the bureau block (pinned callee resolves)', async () => {
    const r = await lsb.rpc('next_case_number', { p_bureau: 'major_crimes' })
    expect(r.error, r.error?.message).toBeNull()
    // MCB block base is 4,000,000 — the next number is always 7 digits.
    expect(r.data).toMatch(/^MCB-4\d{6}$/)
  })

  /* ================= 4) client_errors_ins attribution binding ================= */

  it('the real reporter shape inserts: no reporter_id (default auth.uid())', async () => {
    const r = await lsb.from('client_errors').insert({ message: msg('default'), route: '/v160', user_agent: 'rls-test' })
    expect(r.error, r.error?.message).toBeNull()
  })

  it('an explicit OWN reporter_id inserts', async () => {
    const r = await lsb.from('client_errors').insert({ message: msg('self'), reporter_id: lsbId })
    expect(r.error, r.error?.message).toBeNull()
  })

  it('an explicit NULL reporter_id inserts (anonymous report stays legal)', async () => {
    const r = await lsb.from('client_errors').insert({ message: msg('null'), reporter_id: null })
    expect(r.error, r.error?.message).toBeNull()
  })

  it('SOMEONE ELSE\'s reporter_id is an RLS violation (spoof closed)', async () => {
    const r = await lsb.from('client_errors').insert({ message: msg('spoof'), reporter_id: leadId })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/row-level security/i)
  })

  it('anon cannot insert at all (table grant gone since 20260807150000)', async () => {
    const r = await anon.from('client_errors').insert({ message: msg('anon') })
    expect(r.error).not.toBeNull()
  })

  it('the owner sees exactly the three accepted rows, attributed correctly', async () => {
    const r = await owner.from('client_errors').select('message, reporter_id').like('message', `%${tag}%`)
    expect(r.error, r.error?.message).toBeNull()
    const rows = (r.data ?? []) as { message: string; reporter_id: string | null }[]
    expect(rows).toHaveLength(3) // spoof + anon never landed
    const byKind = new Map(rows.map((x) => [x.message.split(' ')[2], x.reporter_id]))
    expect(byKind.get('default'), 'column default filled the caller').toBe(lsbId)
    expect(byKind.get('self')).toBe(lsbId)
    expect(byKind.get('null')).toBeNull()
  })
})
