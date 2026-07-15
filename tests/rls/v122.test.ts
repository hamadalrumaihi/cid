/** v1.22 — Gang intelligence additive schema (migration 20260724010000).
 *  Pins:
 *   - gang_places link table: active users insert/select/update; delete is
 *     command-only (can_delete); unique (gang_id, place_id) blocks duplicates.
 *   - new controlled-vocabulary CHECKs on gangs (status) and gang_turf reject
 *     invalid values but admit the real ones.
 *   - gang_turf is now audited (audit_log INSERT row, readable by owner) —
 *     closing the previously-untracked turf trail.
 *
 *  Fixtures: lsb (active detective), director (command / can_delete), owner
 *  (audit_log reader). Same conventions as the sibling suites. Requires
 *  migration 20260724010000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.director && PW.owner)
if (!enabled) console.warn('[rls:v122] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.22 — gang intelligence schema (live)', () => {
  let lsb: C, director: C, owner: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let gangId = ''
  let placeId = ''
  let linkId = ''

  beforeAll(async () => {
    lsb = mk(); director = mk(); owner = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)

    const g = await lsb.from('gangs').insert({ name: `V122 Gang ${tag}`, threat_level: 'low' }).select('id')
    if (g.error) throw new Error(`gang setup: ${g.error.message}`)
    gangId = g.data![0].id as string
    const p = await lsb.from('places').insert({ name: `V122 Place ${tag}`, type: 'stash_house' }).select('id')
    if (p.error) throw new Error(`place setup: ${p.error.message}`)
    placeId = p.data![0].id as string
  })

  afterAll(async () => {
    if (!director) return
    await director.from('gang_places').delete().eq('gang_id', gangId)
    await director.from('gang_turf').delete().eq('gang_id', gangId)
    await director.from('places').delete().eq('id', placeId)
    await director.from('gangs').delete().eq('id', gangId)
    await Promise.all([lsb, director, owner].filter(Boolean).map((c) => c.auth.signOut()))
  })

  // ── gang_places link table ─────────────────────────────────────────────────
  it('an active user can link a place to a gang', async () => {
    const res = await lsb.from('gang_places').insert({ gang_id: gangId, place_id: placeId, role: 'stash', confidence: 'probable', provenance: 'reported' }).select('id')
    expect(res.error).toBeNull()
    linkId = res.data![0].id as string
  })

  it('the link is selectable and updatable by an active user', async () => {
    const sel = await lsb.from('gang_places').select('id, role').eq('id', linkId)
    expect(sel.error).toBeNull()
    expect((sel.data ?? []).length).toBe(1)
    const upd = await lsb.from('gang_places').update({ role: 'clubhouse' }).eq('id', linkId).select('role')
    expect(upd.error).toBeNull()
    expect(upd.data![0].role).toBe('clubhouse')
  })

  it('a duplicate (gang, place) link is rejected by the unique constraint', async () => {
    const res = await lsb.from('gang_places').insert({ gang_id: gangId, place_id: placeId }).select('id')
    expect(res.error).not.toBeNull()
    expect(res.error!.code).toBe('23505')
  })

  it('an invalid confidence value is rejected by the CHECK constraint', async () => {
    const res = await lsb.from('gang_places').update({ confidence: 'bogus' }).eq('id', linkId).select('id')
    expect(res.error).not.toBeNull()
    expect(res.error!.code).toBe('23514')
  })

  it('a non-command user cannot delete a gang_places link (can_delete)', async () => {
    await lsb.from('gang_places').delete().eq('id', linkId)
    // Delete is command-only, so the row survives — director still sees it.
    const still = await director.from('gang_places').select('id').eq('id', linkId)
    expect((still.data ?? []).length).toBe(1)
  })

  it('command CAN delete a gang_places link', async () => {
    const res = await director.from('gang_places').delete().eq('id', linkId).select('id')
    expect(res.error).toBeNull()
    const gone = await director.from('gang_places').select('id').eq('id', linkId)
    expect((gone.data ?? []).length).toBe(0)
  })

  // ── new gang CHECK vocab ────────────────────────────────────────────────────
  it('gangs.status accepts a real lifecycle value but rejects an invalid one', async () => {
    const ok = await lsb.from('gangs').update({ status: 'dormant' }).eq('id', gangId).select('status')
    expect(ok.error).toBeNull()
    expect(ok.data![0].status).toBe('dormant')
    const bad = await lsb.from('gangs').update({ status: 'bogus' }).eq('id', gangId).select('id')
    expect(bad.error).not.toBeNull()
    expect(bad.error!.code).toBe('23514')
  })

  // ── gang_turf is now audited ────────────────────────────────────────────────
  it('inserting turf writes an audit_log row (readable by owner)', async () => {
    const t = await lsb.from('gang_turf').insert({ gang_id: gangId, block: `V122 block ${tag}`, density: 'low', status: 'claimed' }).select('id')
    expect(t.error).toBeNull()
    const turfId = t.data![0].id as string
    const al = await owner.from('audit_log').select('action, entity').eq('entity', 'gang_turf').eq('entity_id', turfId)
    expect(al.error).toBeNull()
    expect((al.data ?? []).some((r) => r.action === 'INSERT')).toBe(true)
  })
})
