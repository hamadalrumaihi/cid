/** v1.49 — MDT export controls (spec D4, migration 20260807210000_mdt_exports).
 *
 *  A Lead+ (command) gates the push of BOLOs / officer-safety caution flags to
 *  the in-city (patrol) MDT — never case details. Any active CID member may
 *  PROPOSE an export; it enters 'proposed' and only a command APPROVE advances
 *  it to 'exported'. Exports stay until a command CLEAR (manual — no auto-expiry).
 *  Reads follow the mdt_wanted_projections wall (active member / justice /
 *  owner); there is NO client write policy — the three SECURITY DEFINER RPCs
 *  (mdt_export_propose / _approve / _clear) are the only write path.
 *
 *  This suite proves, on a fixture person + vehicle:
 *   - lsb (active detective) proposes a person_bolo → 'proposed', row readable;
 *   - a non-command member (lsb) is denied mdt_export_approve;
 *   - lead (command) approves → 'exported';
 *   - a second live propose on the same person+kind is refused (the "one live
 *     row per target" partial-unique index);
 *   - lead clears → 'cleared', after which a fresh propose on that person+kind
 *     succeeds (cleared rows don't block the unique index);
 *   - invalid kind / invalid risk / missing-target are rejected by the RPC;
 *   - anon cannot select mdt_exports; a direct client insert is denied.
 *
 *  Fixtures: lsb (active detective — proposes), lead (LSB bureau_lead = command
 *  — approves/clears), owner (oversight read), anon (denied). The person and
 *  vehicle are created by lsb, tagged '[rls-test] v149'.
 *
 *  CLEANUP CAVEAT (flagged, not fixed): mdt_exports' person_id/vehicle_id FKs
 *  are ON DELETE SET NULL, but the mdt_exports_target_check requires the target
 *  FK to be NOT NULL for its kind — so deleting a referenced person/vehicle
 *  would try to null the FK and FAIL the check (it does NOT silently orphan the
 *  row). rls_test_cleanup does not purge mdt_exports and has no way to (no
 *  delete policy / RPC), so any residual export pins its person/vehicle against
 *  deletion. afterAll therefore CLEARS every export it created (cleared rows
 *  drop out of the partial-unique index, so reruns aren't blocked); it cannot
 *  remove the rows themselves. See the suite report for the recommended
 *  catch-up migration.
 *
 *  NOTE: the migration is not yet applied to the live project, so against the
 *  current DB this suite fails on the missing mdt_exports table + RPCs —
 *  "written, needs migration applied", not a defect (same posture as v147/v148
 *  before their migrations landed). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
if (!enabled) console.warn('[rls:v149] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.49 — MDT export controls (live)', () => {
  let lsb: C, lead: C, owner: C, anon: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let personId = ''
  let vehicleId = ''
  // Every export id we create, so afterAll can clear each (cleared rows fall
  // out of the "one live row per target" partial-unique index → reruns are safe).
  const exportIds: string[] = []

  beforeAll(async () => {
    lsb = mk(); lead = mk(); owner = mk(); anon = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    // Best-effort pre-clean so a crashed prior run doesn't collide.
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }

    const p = await lsb.from('persons').insert({ name: `[rls-test] v149 subject ${tag}` }).select('id')
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data![0].id as string
    const v = await lsb.from('vehicles').insert({ plate: `V149-${tag}`, notes: `[rls-test] v149 vehicle ${tag}` }).select('id')
    if (v.error) throw new Error(`vehicle insert failed: ${v.error.message}`)
    vehicleId = v.data![0].id as string
  })

  afterAll(async () => {
    if (!lead) return
    // Clear every export we created so no 'proposed'/'exported' row blocks a
    // rerun. mdt_export_clear is idempotent-safe here (already-cleared throws,
    // which we swallow). We cannot DELETE the rows — no write policy — so the
    // fixture person/vehicle stay pinned (see the suite's flagged concern).
    for (const id of exportIds) {
      try { await lead.rpc('mdt_export_clear', { p_export: id, p_reason: '[rls-test] v149 teardown' }) } catch { /* already cleared */ }
    }
    try { await lsb.rpc('rls_test_cleanup') } catch (e) { console.warn('[rls:v149] rls_test_cleanup failed:', (e as Error).message) }
    await Promise.all([lsb, lead, owner, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('lsb (active CID) proposes a person_bolo → status proposed, row readable', async () => {
    const r = await lsb.rpc('mdt_export_propose', {
      p_kind: 'person_bolo', p_person: personId, p_vehicle: null,
      p_snapshot: `  Subject ${tag}  `, p_risk: 'high',
      p_instructions: 'Approach with caution.', p_reason: 'Armed and wanted.',
    })
    expect(r.error, r.error?.message).toBeNull()
    exportIds.push(r.data!.id as string)
    expect(r.data).toMatchObject({
      kind: 'person_bolo', person_id: personId, vehicle_id: null,
      status: 'proposed', risk_level: 'high', proposed_by: ids.lsb,
    })
    // btrim applied to the snapshot label
    expect(r.data!.subject_snapshot).toBe(`Subject ${tag}`)

    const seen = await lsb.from('mdt_exports').select('id,status,kind').eq('id', exportIds[0]).maybeSingle()
    expect(seen.error, seen.error?.message).toBeNull()
    expect(seen.data?.status).toBe('proposed')
  })

  it('a non-command member (lsb) cannot approve an export (command-only)', async () => {
    const r = await lsb.rpc('mdt_export_approve', { p_export: exportIds[0] })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/command action/i)
    // still proposed
    const row = await lsb.from('mdt_exports').select('status').eq('id', exportIds[0]).maybeSingle()
    expect(row.data?.status).toBe('proposed')
  })

  it('lead (command) approves → status exported', async () => {
    const r = await lead.rpc('mdt_export_approve', { p_export: exportIds[0] })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ status: 'exported', exported_by: ids.lead })
    expect(r.data!.exported_at).not.toBeNull()
  })

  it('a second live propose on the same person+kind is refused (one live row per target)', async () => {
    const r = await lsb.rpc('mdt_export_propose', {
      p_kind: 'person_bolo', p_person: personId, p_vehicle: null, p_snapshot: `Dup ${tag}`,
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/already has a live MDT export/i)
  })

  it('lead clears → status cleared; a fresh propose on that person+kind then succeeds', async () => {
    const clr = await lead.rpc('mdt_export_clear', { p_export: exportIds[0], p_reason: 'Subject apprehended.' })
    expect(clr.error, clr.error?.message).toBeNull()
    expect(clr.data).toMatchObject({ status: 'cleared', cleared_by: ids.lead })
    expect(clr.data!.cleared_at).not.toBeNull()
    expect(clr.data!.clear_reason).toBe('Subject apprehended.')

    // Cleared rows drop out of the partial-unique index → re-propose is allowed.
    const re = await lsb.rpc('mdt_export_propose', {
      p_kind: 'person_bolo', p_person: personId, p_vehicle: null, p_snapshot: `Reissued ${tag}`,
    })
    expect(re.error, re.error?.message).toBeNull()
    exportIds.push(re.data!.id as string)
    expect(re.data).toMatchObject({ status: 'proposed', person_id: personId })
  })

  it('lsb proposes a vehicle_bolo → proposed; a second on the same vehicle is refused', async () => {
    const r = await lsb.rpc('mdt_export_propose', {
      p_kind: 'vehicle_bolo', p_person: null, p_vehicle: vehicleId, p_snapshot: `Plate V149-${tag}`,
    })
    expect(r.error, r.error?.message).toBeNull()
    exportIds.push(r.data!.id as string)
    expect(r.data).toMatchObject({ kind: 'vehicle_bolo', vehicle_id: vehicleId, person_id: null, status: 'proposed' })

    const dup = await lsb.rpc('mdt_export_propose', {
      p_kind: 'vehicle_bolo', p_person: null, p_vehicle: vehicleId, p_snapshot: `Dup plate ${tag}`,
    })
    expect(dup.error).not.toBeNull()
    expect(dup.error!.message).toMatch(/already has a live MDT export/i)
  })

  it('invalid kind and invalid risk are rejected by the RPC', async () => {
    const badKind = await lsb.rpc('mdt_export_propose', {
      p_kind: 'apb', p_person: personId, p_vehicle: null, p_snapshot: `Bad kind ${tag}`,
    })
    expect(badKind.error).not.toBeNull()
    expect(badKind.error!.message).toMatch(/invalid export kind/i)

    const badRisk = await lsb.rpc('mdt_export_propose', {
      p_kind: 'caution', p_person: personId, p_vehicle: null, p_snapshot: `Bad risk ${tag}`, p_risk: 'extreme',
    })
    expect(badRisk.error).not.toBeNull()
    expect(badRisk.error!.message).toMatch(/invalid risk level/i)
  })

  it('a missing / mismatched target is rejected (vehicle_bolo needs a vehicle; person_bolo needs a person)', async () => {
    // vehicle_bolo carrying a person but no vehicle → the RPC nulls the person
    // and demands a vehicle. (The raw target CHECK is only reachable via a
    // direct insert, which the no-write-policy RLS denies — see next test.)
    const noVehicle = await lsb.rpc('mdt_export_propose', {
      p_kind: 'vehicle_bolo', p_person: personId, p_vehicle: null, p_snapshot: `No vehicle ${tag}`,
    })
    expect(noVehicle.error).not.toBeNull()
    expect(noVehicle.error!.message).toMatch(/vehicle BOLO needs a vehicle/i)

    const noPerson = await lsb.rpc('mdt_export_propose', {
      p_kind: 'person_bolo', p_person: null, p_vehicle: null, p_snapshot: `No person ${tag}`,
    })
    expect(noPerson.error).not.toBeNull()
    expect(noPerson.error!.message).toMatch(/person BOLO \/ caution needs a person/i)
  })

  it('anon cannot select mdt_exports; a direct client insert is denied (no write policy)', async () => {
    const read = await anon.from('mdt_exports').select('id').eq('id', exportIds[0])
    // Blanket anon revoke → permission error; either way no row leaks.
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true)
    expect(read.data ?? []).toHaveLength(0)

    // No INSERT policy → direct writes are denied even for an active member.
    const direct = await lsb.from('mdt_exports')
      .insert({ kind: 'caution', person_id: personId, subject_snapshot: 'direct write' }).select('id')
    expect(direct.error).not.toBeNull()
  })
})
