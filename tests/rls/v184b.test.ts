/** v1.84b — SIB-hidden collisions: siu_hidden_flag, the live-only plate
 *  uniqueness and the SIB reconcile queue (P2-03, migration 20261016120000).
 *
 *  The leak this closes (C11): a CID officer creating a vehicle whose plate
 *  the Special Investigations Bureau has compartmented used to get a UNIQUE
 *  violation — and so learn the plate exists. Now:
 *   · the CID insert SUCCEEDS silently (vehicles_plate_live_key ignores a
 *     hidden or trashed plate); the same LIVE CID plate twice is still 23505;
 *   · the collision lands in siu_reconcile_queue, which CID cannot read
 *     (0 rows, no error) and SIB standing can;
 *   · the queued audit row names no actor (the officer never "touched" an
 *     SIB matter);
 *   · siu_reconcile_resolve answers {ok:false, code:'denied'} to CID, lets
 *     SIB dismiss, and refuses a second resolution (already_resolved);
 *   · siu_hidden_flag is maintained only by the visibility triggers — a
 *     direct client write is refused with P0403, for CID and for the Owner
 *     alike.
 *
 *  There is no SIB-agent fixture: rls-test-owner carries `is_owner`, and
 *  private.siu_standing() answers 'owner' for it (v175's contract), which
 *  satisfies siu_may_control_visibility / siu_is_agent / siu_is_command. The
 *  Owner compartments through siu_restrict(mode 'record', acknowledged —
 *  v176's recipe), which flips the flag through the siu_visibility trigger.
 *
 *  Fixtures: owner (SIB actor, creates the hidden vehicle), lsb (the CID
 *  officer). Both vehicles are swept by rls_test_cleanup(); the visibility
 *  ledger row follows the hidden vehicle (siu_visibility_forget). The
 *  resolved queue row has no FK and is not swept (see the report). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, owner: process.env.RLS_TEST_PASSWORD_OWNER }
const enabled = !!(ANON && PW.lsb && PW.owner)
if (!enabled) console.warn('[rls:v184b] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Queue = { id: string; kind: string; cid_record_id: string; hidden_record_id: string; signal: string; resolved_at: string | null; resolved_by: string | null; resolution: string | null }

describe.skipIf(!enabled)('v1.84b — SIB reconcile queue and the live-only plate key', () => {
  let lsb: C, owner: C
  let ownerId = ''
  let hiddenId = '', cidId = '', personId = '', queueId = ''
  const tag = Date.now().toString(36)
  const plate = `V84B${tag.slice(-4).toUpperCase()}`

  beforeAll(async () => {
    lsb = mk(); owner = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    ownerId = await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)

    const h = await owner.from('vehicles').insert({ plate, model: 'v184b hidden', notes: `[rls-test] v184b ${tag}` }).select('id').single()
    if (h.error) throw new Error(`hidden vehicle insert failed: ${h.error.message}`)
    hiddenId = h.data!.id
    const r = await owner.rpc('siu_restrict', {
      p_type: 'vehicle', p_id: hiddenId, p_mode: 'record',
      p_reason: `[rls-test] v184b compartmenting this vehicle for the reconcile test ${tag}`,
      p_acknowledge_cid_impact: true,
    })
    if (r.error) throw new Error(`siu_restrict failed: ${r.error.message}`)
    const p = await lsb.from('persons').insert({ name: `[rls-test] v184b person ${tag}` }).select('id').single()
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data!.id
  }, 90_000)

  afterAll(async () => { if (lsb) await lsb.rpc('rls_test_cleanup') })

  it('the compartmented vehicle is gone from CID and carries the flag for SIB', async () => {
    expect((await lsb.from('vehicles').select('id').eq('id', hiddenId)).data).toEqual([])
    const mine = await owner.from('vehicles').select('id, siu_hidden_flag').eq('id', hiddenId).single()
    expect(mine.error, mine.error?.message).toBeNull()
    expect(mine.data).toMatchObject({ id: hiddenId, siu_hidden_flag: true })
  })

  it('a CID create of the hidden plate succeeds silently; the same LIVE plate twice is still 23505', async () => {
    const c = await lsb.from('vehicles').insert({ plate, model: 'v184b cid copy' }).select('id, siu_hidden_flag').single()
    expect(c.error, c.error?.message).toBeNull()
    expect(c.data!.siu_hidden_flag).toBe(false)
    cidId = c.data!.id
    const dup = await lsb.from('vehicles').insert({ plate: plate.toLowerCase(), model: 'v184b live duplicate' }).select('id')
    expect(dup.error).not.toBeNull()
    expect(dup.error!.code).toBe('23505')
  })

  it('CID cannot read the queue (0 rows, no error); SIB reads the collision', async () => {
    const cid = await lsb.from('siu_reconcile_queue').select('id').eq('cid_record_id', cidId)
    expect(cid.error).toBeNull()
    expect(cid.data).toEqual([])
    const sib = await owner.from('siu_reconcile_queue')
      .select('id, kind, cid_record_id, hidden_record_id, signal, resolved_at, resolved_by, resolution')
      .eq('cid_record_id', cidId)
    expect(sib.error, sib.error?.message).toBeNull()
    expect(sib.data).toHaveLength(1)
    const q = sib.data![0] as Queue
    expect(q).toMatchObject({ kind: 'vehicle', cid_record_id: cidId, hidden_record_id: hiddenId, signal: 'plate', resolved_at: null, resolution: null })
    queueId = q.id
  })

  it('the queued audit row names no actor', async () => {
    const a = await owner.from('audit_log').select('actor_id, action').eq('entity', 'siu').eq('entity_id', queueId)
    expect(a.error, a.error?.message).toBeNull()
    expect(a.data).toHaveLength(1)
    expect(a.data![0]).toEqual({ actor_id: null, action: 'SIU_RECONCILE_QUEUED' })
  })

  it('siu_reconcile_resolve: CID is denied; SIB dismisses; a second resolution is refused', async () => {
    const cid = await lsb.rpc('siu_reconcile_resolve', { p_id: queueId, p_resolution: 'dismiss' })
    expect(cid.error).toBeNull()
    expect(cid.data).toMatchObject({ ok: false, code: 'denied' })
    const bad = await owner.rpc('siu_reconcile_resolve', { p_id: queueId, p_resolution: 'ignore' })
    expect(bad.data).toMatchObject({ ok: false, code: 'bad_request' })
    const ok = await owner.rpc('siu_reconcile_resolve', { p_id: queueId, p_resolution: 'dismiss', p_note: `[rls-test] v184b dismissed ${tag}` })
    expect(ok.error, ok.error?.message).toBeNull()
    expect(ok.data).toMatchObject({ ok: true, id: queueId, resolution: 'dismiss' })
    const after = await owner.from('siu_reconcile_queue').select('resolved_by, resolution').eq('id', queueId).single()
    expect(after.data).toMatchObject({ resolved_by: ownerId, resolution: 'dismiss' })
    const again = await owner.rpc('siu_reconcile_resolve', { p_id: queueId, p_resolution: 'link' })
    expect(again.data).toMatchObject({ ok: false, code: 'already_resolved' })
    // The CID copy is untouched by a dismissal.
    expect((await lsb.from('vehicles').select('id').eq('id', cidId)).data).toHaveLength(1)
  })

  it('siu_hidden_flag is trigger-maintained: a direct write is refused with P0403 — CID and Owner alike', async () => {
    const p = await lsb.from('persons').update({ siu_hidden_flag: true }).eq('id', personId).select('id')
    expect(p.error).not.toBeNull()
    expect(p.error!.code).toBe('P0403')
    const v = await lsb.from('vehicles').update({ siu_hidden_flag: true }).eq('id', cidId).select('id')
    expect(v.error?.code).toBe('P0403')
    const o = await owner.from('vehicles').update({ siu_hidden_flag: false }).eq('id', hiddenId).select('id')
    expect(o.error?.code).toBe('P0403')
    const born = await lsb.from('vehicles').insert({ plate: `${plate}X`, siu_hidden_flag: true }).select('id')
    expect(born.error?.code).toBe('P0403')
    expect((await owner.from('vehicles').select('siu_hidden_flag').eq('id', hiddenId).single()).data?.siu_hidden_flag).toBe(true)
  })
})
