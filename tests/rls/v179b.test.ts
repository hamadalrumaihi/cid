/** v1.79b — Director of CID: read-only SIB oversight standing (P1-04,
 *  migration 20261010120000, decision P1b).
 *
 *  The Director of CID now resolves to `director_oversight` in
 *  private.siu_standing(): a strict READ subset of the AG's `oversight` —
 *  standard investigations and the oversight totals, never appointment,
 *  removal, release, export, compartments or the unit's own intelligence
 *  layer (notes, targets, sources, watchlist, referrals).
 *
 *  ── What this suite can and cannot pin ─────────────────────────────────────
 *  `rls-test-director` is a FIXTURE, and ex-officio standing never attaches
 *  to a fixture (20260829120000: profiles.is_test → NULL standing). So the
 *  POSITIVE read — a real Director reading a standard SIB case and its
 *  reports, `siu_oversight_report` / `siu_overview` answering access:true,
 *  `siu_department_context().siu_standing = 'director_oversight'` — cannot be
 *  exercised by any fixture and was verified live at apply time against a
 *  real Director profile in a rolled-back transaction (MIGRATION-HISTORY).
 *
 *  What IS pinned here, and matters just as much:
 *   · the fixture exclusion holds — the director fixture's standing is NULL
 *     and it is offered no department switch;
 *   · every SIB-only read surface answers ZERO rows to the CID Director
 *     fixture: siu_targets, siu_case_notes, siu_sources, siu_watchlist,
 *     siu_referrals, siu_memberships;
 *   · fourteen SIB write / personnel / release / export RPCs refuse the
 *     Director fixture outright (an error, never a row);
 *   · the Director keeps what they had: registry-visibility control and the
 *     per-case access request are profile-role tests, not standing.
 *
 *  Fixtures (tests/rls/README.md): director (CID director), lsb (CID
 *  detective, the control). Nothing is created; nothing to clean up. */

import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
}
const enabled = !!(ANON && PW.director && PW.lsb)
if (!enabled) console.warn('[rls:v179b] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.79b — Director of CID read-only SIB oversight', () => {
  let director: C, lsb: C
  let directorId = ''
  const ghost = randomUUID()

  beforeAll(async () => {
    director = mk(); lsb = mk()
    directorId = await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
  })

  it('the fixture exclusion holds: ex-officio standing never attaches to a test fixture', async () => {
    const ctx = await director.rpc('siu_department_context')
    expect(ctx.error).toBeNull()
    const c = ctx.data as Record<string, unknown>
    expect(c.siu_standing).toBeNull()
    expect(c.siu_available).toBe(false)
    expect(c.may_switch).toBe(false)
    expect(c.department).toBe('cid')
    // …while the profile-role windows the Director always had are intact.
    expect(c.may_control_visibility).toBe(true)
    const perms = await director.rpc('my_permissions')
    expect(perms.error).toBeNull()
    const p = perms.data as { sib_standing: unknown; flags: Record<string, unknown> }
    expect(p.sib_standing).toBeNull()
    expect(p.flags.sib_may_switch).toBe(false)
    expect(p.flags.sib_may_control_visibility).toBe(true)
  })

  it('every SIB-only read surface answers zero rows to the CID Director', async () => {
    for (const table of ['siu_targets', 'siu_case_notes', 'siu_sources', 'siu_watchlist', 'siu_referrals', 'siu_memberships'] as const) {
      const r = await director.from(table).select('id').limit(5)
      expect(r.error, `${table} must not error`).toBeNull()
      expect(r.data, `${table} must be empty`).toEqual([])
    }
    const ov = await director.rpc('siu_oversight_report')
    expect(ov.error).toBeNull()
    expect((ov.data as { access: boolean }).access).toBe(false)
    const sup = await director.rpc('siu_oversight_supplement')
    expect(sup.error).toBeNull()
    expect((sup.data as { access: boolean }).access).toBe(false)
  })

  it('fourteen SIB write, personnel, release and export RPCs refuse the Director outright', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ['siu_appoint', { p_user: ghost, p_role: 'special_agent' }],
      ['siu_remove', { p_user: ghost, p_reason: '[rls-test] v179b' }],
      ['siu_create_case', { p_title: '[rls-test] v179b', p_summary: 'x', p_classification: 'siu' }],
      ['siu_assign_agent', { p_case: ghost, p_user: ghost }],
      ['siu_set_case_classification', { p_case: ghost, p_classification: 'siu_restricted', p_reason: 'x' }],
      ['siu_record_intelligence', { p_case: ghost, p_note_type: 'integrity_concern', p_body: 'x' }],
      ['siu_designate_target', { p_case: ghost, p_entity_type: 'unknown', p_entity_id: null, p_designation: 'subject', p_label: 'x' }],
      ['siu_share', { p_case: ghost, p_item_type: 'summary', p_title: 'x', p_body: 'x', p_audience: 'cid', p_reason: 'x' }],
      ['siu_export_case', { p_case: ghost, p_scope: 'case_summary', p_reason: 'x' }],
      ['siu_grant_temp_access', { p_case: ghost, p_user: ghost, p_reason: 'x' }],
      ['siu_review_referral', { p_referral: ghost, p_disposition: 'declined', p_note: 'x' }],
      ['siu_resolve_conflict', { p_conflict: ghost, p_status: 'cleared', p_note: 'x' }],
      ['siu_watch_add', { p_entity_type: 'unknown', p_entity_id: null, p_reason: 'x', p_label: 'x' }],
      ['siu_compartment_add', { p_case: ghost, p_user: ghost, p_reason: 'x' }],
    ]
    for (const [fn, args] of calls) {
      const r = await director.rpc(fn, args)
      expect(r.error, `${fn} must refuse the Director`).not.toBeNull()
    }
    // The control: a CID detective is refused the same way — the Director
    // gained nothing a detective lacks on the write side.
    const det = await lsb.rpc('siu_create_case', { p_title: '[rls-test] v179b', p_summary: 'x', p_classification: 'siu' })
    expect(det.error).not.toBeNull()
  })

  it('the Director may still file a per-case access request (profile-role window, not standing)', async () => {
    // Deny-by-default on the argument, not the caller: a blank reason is
    // refused BEFORE any row is written, which proves the gate is open to
    // the Director without leaving a request behind.
    const r = await director.rpc('siu_request_case_access', { p_case_number: `V179B-${directorId.slice(0, 8)}`, p_reason: '' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/reason/i)
    const det = await lsb.rpc('siu_request_case_access', { p_case_number: 'V179B-X', p_reason: 'x' })
    expect(det.error).not.toBeNull()
    expect(det.error!.message).toMatch(/not authorized/i)
  })
})
