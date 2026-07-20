/** v1.47 — legal hold (spec D7), migration 20260807190000_legal_hold.
 *
 *  A Lead+ (command) may place a legal hold on a case (or a legal request).
 *  While any hold is active the case cannot be permanently deleted, and —
 *  uniquely among command actions — the Owner cannot override it: the hold
 *  must be LIFTED (also command) first. Writes go only through the two
 *  SECURITY DEFINER RPCs (no client write policy); reads follow the case wall.
 *
 *  This suite proves, on a bare case carrying NO legal requests (so the hold
 *  itself is the only thing blocking the purge):
 *   - command places a hold; the row is visible to command;
 *   - anon cannot read legal_holds;
 *   - a non-command member is denied legal_hold_place;
 *   - a second active hold on the same target is refused;
 *   - the owner preview reports active_hold + deletable:false;
 *   - the owner's permanent delete is BLOCKED while held (no override);
 *   - a command lift releases it; the preview flips to deletable:true;
 *   - the owner can then permanently delete (which also tears the case down).
 *
 *  Fixtures: lead (LSB bureau_lead = command — places/lifts), lsb (plain
 *  active detective, NON-command — denied), owner (is_owner — preview/delete),
 *  anon (denied read). legal_holds cascades on case delete, but teardown
 *  lifts any residual hold and owner-deletes the case explicitly rather than
 *  relying on the cascade; rls_test_cleanup sweeps the fixture case. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lead && PW.lsb && PW.owner)
if (!enabled) console.warn('[rls:v147] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.47 — legal hold (live)', () => {
  let lead: C, lsb: C, owner: C, anon: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let holdId = ''
  let caseDeleted = false

  beforeAll(async () => {
    lead = mk(); lsb = mk(); owner = mk(); anon = mk()
    for (const [client, email, pw] of [
      [lead, 'rls-test-lead@cidportal.test', PW.lead],
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb],
      [owner, 'rls-test-owner@cidportal.test', PW.owner],
    ] as const) {
      await signInWithRetry(client, email, pw!)
    }
    // Best-effort pre-clean so a crashed prior run doesn't collide.
    try { await lead.rpc('rls_test_cleanup') } catch { /* best effort */ }

    // A bare case with NO legal requests — the hold is the only purge blocker.
    const c = await lead.from('cases').insert({ case_number: `V147-${tag}`, title: `[rls-test] v147 legal-hold case ${tag}`, bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id as string
  })

  afterAll(async () => {
    if (!owner) return
    // Best-effort: lift any residual hold (command), then owner-delete the case.
    if (!caseDeleted && holdId) {
      try { await lead.rpc('legal_hold_lift', { p_hold: holdId, p_reason: '[rls-test] v147 teardown lift' }) } catch { /* already lifted / gone */ }
    }
    if (!caseDeleted && caseId) {
      try { await owner.rpc('case_permanent_delete', { p_case: caseId, p_reason: '[rls-test] v147 teardown' }) } catch { /* already gone */ }
    }
    try { await lead.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lead, lsb, owner, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('command places a legal hold on a bare case; the row is visible', async () => {
    const place = await lead.rpc('legal_hold_place', { p_case: caseId, p_legal_request: null, p_reason: `[rls-test] v147 hold ${tag}` })
    expect(place.error, place.error?.message).toBeNull()
    const row = place.data as { id: string; case_id: string; legal_request_id: string | null; lifted_at: string | null; reason: string }
    holdId = row.id
    expect(row.case_id).toBe(caseId)
    expect(row.legal_request_id).toBeNull()
    expect(row.lifted_at).toBeNull()

    const seen = await lead.from('legal_holds').select('id,case_id,lifted_at').eq('id', holdId).maybeSingle()
    expect(seen.error, seen.error?.message).toBeNull()
    expect(seen.data?.case_id).toBe(caseId)
    expect(seen.data?.lifted_at).toBeNull()
  })

  it('an anonymous caller cannot read legal_holds', async () => {
    const r = await anon.from('legal_holds').select('id').eq('id', holdId)
    // Blanket anon revoke → permission error; either way no row leaks.
    expect(r.error !== null || (r.data ?? []).length === 0).toBe(true)
    expect(r.data ?? []).toHaveLength(0)
  })

  it('a non-command member is denied legal_hold_place (command-only)', async () => {
    const r = await lsb.rpc('legal_hold_place', { p_case: caseId, p_legal_request: null, p_reason: '[rls-test] v147 nope' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/command action/i)
  })

  it('a second active hold on the same case is refused', async () => {
    const r = await lead.rpc('legal_hold_place', { p_case: caseId, p_legal_request: null, p_reason: '[rls-test] v147 dup' })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/already under an active legal hold/i)
  })

  it('the owner preview reports the hold: deletable:false, active_hold:true', async () => {
    const pv = await owner.rpc('case_delete_preview', { p_case: caseId })
    expect(pv.error, pv.error?.message).toBeNull()
    const preview = pv.data as { deletable: boolean; active_hold: boolean; legal_requests: number }
    expect(preview.active_hold).toBe(true)
    expect(preview.deletable).toBe(false)
    expect(preview.legal_requests).toBe(0)
  })

  it('the owner cannot permanently delete a held case (no override)', async () => {
    const del = await owner.rpc('case_permanent_delete', { p_case: caseId, p_reason: '[rls-test] v147 override attempt' })
    expect(del.error).not.toBeNull()
    expect(del.error!.message).toMatch(/active legal hold/i)
    // Case still exists.
    const still = await lead.from('cases').select('id').eq('id', caseId)
    expect(still.data ?? []).toHaveLength(1)
  })

  it('a command lift releases the hold; the preview flips to deletable:true', async () => {
    const lift = await lead.rpc('legal_hold_lift', { p_hold: holdId, p_reason: '[rls-test] v147 released' })
    expect(lift.error, lift.error?.message).toBeNull()
    expect((lift.data as { lifted_at: string | null }).lifted_at).not.toBeNull()

    const pv = await owner.rpc('case_delete_preview', { p_case: caseId })
    expect(pv.error, pv.error?.message).toBeNull()
    const preview = pv.data as { deletable: boolean; active_hold: boolean }
    expect(preview.active_hold).toBe(false)
    expect(preview.deletable).toBe(true)
  })

  it('after the lift the owner can permanently delete the case', async () => {
    const del = await owner.rpc('case_permanent_delete', { p_case: caseId, p_reason: '[rls-test] v147 teardown delete' })
    expect(del.error, del.error?.message).toBeNull()
    caseDeleted = true
    const gone = await lead.from('cases').select('id').eq('id', caseId)
    expect(gone.data ?? []).toHaveLength(0)
  })
})
