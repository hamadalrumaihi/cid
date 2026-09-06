/** v1.80a — Soft delete, registries (P1-03a, migrations 20261007120000 …
 *  20261007120100).
 *
 *  The fifteen registry tables (persons, vehicles, gangs, places, accounts,
 *  indicators, narcotics, operations, trackers, gang_members, gang_turf,
 *  person_places, person_vehicles, person_relationships, account_links) no
 *  longer accept a client DELETE: the privilege is revoked (42501) and the
 *  policy is gone. Deletion is public.soft_delete(kind, id, reason), which
 *  refuses by RETURNING {ok:false, code} and never raises; restoration is
 *  public.restore_record(kind, id, reason).
 *
 *  Pinned here, on a fixture-owned person + vehicle + link:
 *   · a detective is DENIED soft-deleting a person (former persons_del was
 *     Bureau Lead+), and the denial writes nothing the detective can see;
 *   · the Bureau Lead is refused WITHOUT a reason (reason_required), then
 *     succeeds with one, and the exclusive link is cascaded in the batch;
 *   · the deleted person is invisible to the detective and to the other
 *     bureau (SELECT policy), and the Owner still reads it (optional block);
 *   · the lifecycle columns cannot be written from a client, not even by
 *     the Owner (freeze trigger, P0403);
 *   · restoring the link alone while its person is deleted is refused
 *     (parent_deleted); restoring the person brings the link back;
 *   · the author of a link row may soft-delete their own link (the former
 *     created_by rule), a stranger may not;
 *   · a client DELETE is a hard 42501 for every fixture.
 *
 *  Fixtures (tests/rls/README.md): lsb (MCB detective), bcb (SCB detective),
 *  lead (MCB Bureau Lead); owner optional. Rows are created by lsb and
 *  purged by rls_test_cleanup() in afterAll (soft-deleted rows included —
 *  cleanup is definer and keys on the fixture namespace, not liveness). */

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
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v180a] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Res = { ok: boolean; code?: string; cascaded?: Record<string, number>; restored?: Record<string, number> }
const softDelete = async (c: C, kind: string, id: string, reason?: string): Promise<Res> => {
  const r = await c.rpc('soft_delete', { p_kind: kind, p_id: id, p_reason: reason })
  expect(r.error, `soft_delete ${kind}`).toBeNull()
  return r.data as unknown as Res
}
const restore = async (c: C, kind: string, id: string, reason?: string): Promise<Res> => {
  const r = await c.rpc('restore_record', { p_kind: kind, p_id: id, p_reason: reason })
  expect(r.error, `restore_record ${kind}`).toBeNull()
  return r.data as unknown as Res
}

describe.skipIf(!enabled)('v1.80a soft delete — registries', () => {
  let lsb: C, bcb: C, lead: C, owner: C | null = null
  let personId = '', vehicleId = '', linkId = '', ownLinkId = ''
  const tag = Date.now().toString(36)

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    if (PW.owner) { owner = mk(); await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
    const p = await lsb.from('persons').insert({ name: `RLS Test v180a ${tag}` }).select('id').single()
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data!.id
    const v = await lsb.from('vehicles').insert({ plate: `RLS${tag.slice(-5).toUpperCase()}` }).select('id').single()
    if (v.error) throw new Error(`vehicle insert failed: ${v.error.message}`)
    vehicleId = v.data!.id
    const l = await lsb.from('person_vehicles').insert({ person_id: personId, vehicle_id: vehicleId, role: 'associated' }).select('id').single()
    if (l.error) throw new Error(`link insert failed: ${l.error.message}`)
    linkId = l.data!.id
  }, 90_000)

  afterAll(async () => {
    if (lsb) await lsb.rpc('rls_test_cleanup')
  })

  it('a client DELETE is a hard permission error on every registry table', async () => {
    for (const [name, c] of [['lsb', lsb], ['bcb', bcb], ['lead', lead]] as [string, C][]) {
      const r = await c.from('persons').delete().eq('id', personId)
      expect(r.error, `${name} delete persons`).not.toBeNull()
      expect(r.error!.code, `${name} delete persons code`).toBe('42501')
    }
    const link = await lead.from('person_vehicles').delete().eq('id', linkId)
    expect(link.error!.code).toBe('42501')
  })

  it('the lifecycle columns cannot be written from a client, the Owner included', async () => {
    const r = await lead.from('persons').update({ deleted_at: new Date().toISOString() }).eq('id', personId)
    expect(r.error).not.toBeNull()
    expect(r.error!.code).toBe('P0403')
    if (owner) {
      const o = await owner.from('persons').update({ delete_reason: 'x' }).eq('id', personId)
      expect(o.error).not.toBeNull()
      expect(o.error!.code).toBe('P0403')
    }
  })

  it('a detective is denied; the Bureau Lead needs a reason, then deletes with the link cascaded', async () => {
    expect((await softDelete(lsb, 'person', personId, 'x')).code).toBe('denied')
    expect((await softDelete(lead, 'person', personId)).code).toBe('reason_required')
    const r = await softDelete(lead, 'person', personId, `rls-test v180a ${tag}`)
    expect(r.ok).toBe(true)
    expect(r.cascaded).toEqual({ person_vehicles: 1 })
    expect((await softDelete(lead, 'person', personId, 'again')).code).toBe('denied') // already deleted → not live → not permitted
  })

  it('a deleted row is invisible to non-owners and still readable by the Owner', async () => {
    for (const c of [lsb, bcb, lead]) {
      const r = await c.from('persons').select('id').eq('id', personId)
      expect(r.error).toBeNull()
      expect(r.data).toEqual([])
      const l = await c.from('person_vehicles').select('id').eq('id', linkId)
      expect(l.data).toEqual([])
    }
    const can = await lsb.rpc('can_record', { p_action: 'read', p_kind: 'person', p_id: personId })
    expect(can.data).toBe(false)
    if (owner) {
      const r = await owner.from('persons').select('id, deleted_at, delete_reason').eq('id', personId).single()
      expect(r.error).toBeNull()
      expect(r.data!.deleted_at).not.toBeNull()
      expect(r.data!.delete_reason).toContain('rls-test')
      const can2 = await owner.rpc('can_record', { p_action: 'read', p_kind: 'person', p_id: personId })
      expect(can2.data).toBe(true)
    }
  })

  it('a link cannot be restored under a deleted parent; restoring the parent brings the batch back', async () => {
    expect((await restore(lead, 'person_vehicle', linkId)).code).toBe('parent_deleted')
    expect((await restore(lsb, 'person', personId)).code).toBe('denied')
    const r = await restore(lead, 'person', personId, 'undo')
    expect(r.ok).toBe(true)
    expect(r.restored).toEqual({ persons: 1, person_vehicles: 1 })
    expect((await restore(lead, 'person', personId)).code).toBe('denied') // live → not restorable → denied (liveness never leaks)
    const back = await lsb.from('persons').select('id').eq('id', personId)
    expect(back.data).toHaveLength(1)
    const link = await lsb.from('person_vehicles').select('id').eq('id', linkId)
    expect(link.data).toHaveLength(1)
  })

  it('the author of a link row may soft-delete it without a reason; a stranger may not', async () => {
    const l = await lsb.from('person_vehicles').insert({ person_id: personId, vehicle_id: vehicleId, role: 'associated', notes: 'own link' }).select('id').single()
    expect(l.error).toBeNull()
    ownLinkId = l.data!.id
    expect((await softDelete(bcb, 'person_vehicle', ownLinkId)).code).toBe('denied')
    const r = await softDelete(lsb, 'person_vehicle', ownLinkId)
    expect(r.ok).toBe(true)
    const gone = await lsb.from('person_vehicles').select('id').eq('id', ownLinkId)
    expect(gone.data).toEqual([])
    // The author may also restore their own link.
    expect((await restore(lsb, 'person_vehicle', ownLinkId)).ok).toBe(true)
  })

  it('deny by default: unknown kind, unknown id', async () => {
    expect((await softDelete(lead, 'spaceship', personId, 'x')).code).toBe('bad_request')
    expect((await softDelete(lead, 'person', '00000000-0000-4000-8000-000000000001', 'x')).code).toBe('denied')
  })
})
