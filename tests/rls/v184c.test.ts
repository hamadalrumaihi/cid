/** v1.84c — the merge ledger and the generic merge / unmerge (P2-04,
 *  migration 20261017120000).
 *
 *  Pins, on two fixture persons that share a case link and a place (so the
 *  victim's rows would collide with the survivor's under repoint) plus a
 *  vehicle the victim owns:
 *   · a Detective is refused with {ok:false, code:'denied'}; a blank reason
 *     is reason_required; nothing moves on a refusal;
 *   · entity_merge_preview answers the manifest WITHOUT writing;
 *   · a linked case under an active legal hold refuses with `held` (and
 *     names the case) — v155's chokepoint, checked before anything moves;
 *   · with the hold lifted a Bureau Lead merges: the victim becomes a
 *     tombstone (lifecycle 'merged' + merged_into), the vehicle is repointed,
 *     the colliding case link and person_place are DROPPED and named in the
 *     manifest, the entity_merges row is readable by lead and Owner;
 *   · entity_unmerge (command, reason) restores the tombstone, repoints the
 *     vehicle back and re-inserts the dropped rows; a second unmerge is
 *     already_reversed; a Detective is denied.
 *
 *  Fixtures: lsb (author), lead (MCB Bureau Lead — merges, holds, unmerges),
 *  owner (reads the ledger). rls_test_cleanup() sweeps the case (+ its
 *  links), persons (+ person_places), the place and the vehicle. The
 *  entity_merges row has no FK and is not swept (see the report). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, lead: process.env.RLS_TEST_PASSWORD_LEAD, owner: process.env.RLS_TEST_PASSWORD_OWNER }
const enabled = !!(ANON && PW.lsb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:v184c] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Dropped = { table: string; why: string; row: Record<string, unknown> }
type Victim = { id: string; repointed: Record<string, number>; repointed_ids: Record<string, string[]>; dropped: Dropped[]; tombstone: string }
type Manifest = { survivor: { id: string; label: string }; victims: Victim[]; added_aliases: unknown[] }
type MergeAnswer = { ok: boolean; code?: string; merge_id?: string; manifest?: Manifest; hold_cases?: string[]; restored?: number }

describe.skipIf(!enabled)('v1.84c — entity_merge / preview / unmerge', () => {
  let lsb: C, lead: C, owner: C
  let leadId = ''
  let caseId = '', survivorId = '', victimId = '', placeId = '', vehicleId = '', holdId = '', mergeId = ''
  let victimLinkId = '', victimPlaceId = ''
  const tag = Date.now().toString(36)

  beforeAll(async () => {
    lsb = mk(); lead = mk(); owner = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    leadId = await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)

    const c = await lsb.from('cases').insert({ case_number: `V184C-${tag.toUpperCase()}`, title: `[rls-test] v184c merge case ${tag}`, bureau: 'major_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
    const s = await lsb.from('persons').insert({ name: `[rls-test] v184c Survivor ${tag}` }).select('id').single()
    if (s.error) throw new Error(`survivor insert failed: ${s.error.message}`)
    survivorId = s.data!.id
    const v = await lsb.from('persons').insert({ name: `[rls-test] v184c Victim ${tag}`, alias: `Vic ${tag}` }).select('id').single()
    if (v.error) throw new Error(`victim insert failed: ${v.error.message}`)
    victimId = v.data!.id
    const pl = await lsb.from('places').insert({ name: `[rls-test] v184c place ${tag}`, type: 'stash_house', area: 'Docks' }).select('id').single()
    if (pl.error) throw new Error(`place insert failed: ${pl.error.message}`)
    placeId = pl.data!.id
    const veh = await lsb.from('vehicles').insert({ plate: `V84C${tag.slice(-4).toUpperCase()}`, owner_id: victimId }).select('id').single()
    if (veh.error) throw new Error(`vehicle insert failed: ${veh.error.message}`)
    vehicleId = veh.data!.id
    // The collisions: both persons on the same case and at the same place.
    const links = await lsb.from('case_intel_links').insert([
      { case_id: caseId, kind: 'person', ref_id: survivorId },
      { case_id: caseId, kind: 'person', ref_id: victimId },
    ]).select('id, ref_id')
    if (links.error) throw new Error(`link insert failed: ${links.error.message}`)
    victimLinkId = links.data!.find((r) => r.ref_id === victimId)!.id
    const pp = await lsb.from('person_places').insert([
      { person_id: survivorId, place_id: placeId, role: 'residence' },
      { person_id: victimId, place_id: placeId, role: 'residence' },
    ]).select('id, person_id')
    if (pp.error) throw new Error(`person_places insert failed: ${pp.error.message}`)
    victimPlaceId = pp.data!.find((r) => r.person_id === victimId)!.id
  }, 90_000)

  afterAll(async () => {
    if (lead && holdId) { try { await lead.rpc('legal_hold_lift', { p_hold: holdId, p_reason: '[rls-test] v184c teardown lift' }) } catch { /* already lifted */ } }
    if (lsb) await lsb.rpc('rls_test_cleanup')
  })

  const victimState = async () => (await lead.from('persons').select('lifecycle, merged_into').eq('id', victimId).single()).data
  const vehicleOwner = async () => (await lead.from('vehicles').select('owner_id').eq('id', vehicleId).single()).data?.owner_id

  it('a Detective is refused with denied; a blank reason is reason_required; nothing moves', async () => {
    const d = await lsb.rpc('entity_merge', { p_kind: 'person', p_survivor: survivorId, p_victims: [victimId], p_reason: `[rls-test] v184c ${tag}` })
    expect(d.error).toBeNull()
    expect(d.data).toMatchObject({ ok: false, code: 'denied' })
    const r = await lead.rpc('entity_merge', { p_kind: 'person', p_survivor: survivorId, p_victims: [victimId], p_reason: '   ' })
    expect(r.data).toMatchObject({ ok: false, code: 'reason_required' })
    const self = await lead.rpc('entity_merge', { p_kind: 'person', p_survivor: survivorId, p_victims: [survivorId], p_reason: 'x' })
    expect(self.data).toMatchObject({ ok: false, code: 'bad_request' })
    expect(await victimState()).toMatchObject({ lifecycle: 'active', merged_into: null })
  })

  it('entity_merge_preview names the repoint and the drops without writing', async () => {
    const p = await lead.rpc('entity_merge_preview', { p_kind: 'person', p_survivor: survivorId, p_victims: [victimId] })
    expect(p.error, p.error?.message).toBeNull()
    const a = p.data as MergeAnswer
    expect(a.ok).toBe(true)
    const v = a.manifest!.victims[0]
    expect(v.id).toBe(victimId)
    expect(v.tombstone).toBe('lifecycle')
    expect(v.repointed['vehicles.owner_id']).toBe(1)
    expect(v.dropped.map((d) => d.table).sort()).toEqual(['case_intel_links', 'person_places'])
    expect(v.dropped.every((d) => d.why.startsWith('unique:'))).toBe(true)
    // Nothing was written.
    expect(await victimState()).toMatchObject({ lifecycle: 'active', merged_into: null })
    expect(await vehicleOwner()).toBe(victimId)
    expect((await lead.from('case_intel_links').select('id').eq('id', victimLinkId)).data).toHaveLength(1)
    expect((await lead.from('entity_merges').select('id').eq('survivor_id', survivorId)).data).toEqual([])
    // A Detective cannot preview either.
    expect((await lsb.rpc('entity_merge_preview', { p_kind: 'person', p_survivor: survivorId, p_victims: [victimId] })).data).toMatchObject({ ok: false, code: 'denied' })
  })

  it('a linked case under an active legal hold refuses with held, naming the case', async () => {
    const place = await lead.rpc('legal_hold_place', { p_case: caseId, p_legal_request: null, p_reason: `[rls-test] v184c hold ${tag}` })
    expect(place.error, place.error?.message).toBeNull()
    holdId = (place.data as { id: string }).id
    const m = await lead.rpc('entity_merge', { p_kind: 'person', p_survivor: survivorId, p_victims: [victimId], p_reason: `[rls-test] v184c held ${tag}` })
    expect(m.error).toBeNull()
    expect(m.data).toMatchObject({ ok: false, code: 'held' })
    expect((m.data as MergeAnswer).hold_cases).toContain(caseId)
    expect(await victimState()).toMatchObject({ lifecycle: 'active', merged_into: null })
    const lift = await lead.rpc('legal_hold_lift', { p_hold: holdId, p_reason: '[rls-test] v184c released' })
    expect(lift.error, lift.error?.message).toBeNull()
    holdId = ''
  })

  it('a Bureau Lead merges: tombstone, repoint, drops named in the manifest, ledger readable', async () => {
    const m = await lead.rpc('entity_merge', { p_kind: 'person', p_survivor: survivorId, p_victims: [victimId], p_reason: `[rls-test] v184c duplicate ${tag}` })
    expect(m.error, m.error?.message).toBeNull()
    const a = m.data as MergeAnswer
    expect(a.ok).toBe(true)
    mergeId = a.merge_id!
    expect(await victimState()).toEqual({ lifecycle: 'merged', merged_into: survivorId })
    // The survivor adopted the victim's alias (fill-the-gaps).
    expect((await lead.from('persons').select('alias').eq('id', survivorId).single()).data?.alias).toBe(`Vic ${tag}`)
    expect(await vehicleOwner()).toBe(survivorId)
    const links = await lead.from('case_intel_links').select('ref_id').eq('case_id', caseId).eq('kind', 'person')
    expect(links.data!.map((r) => r.ref_id)).toEqual([survivorId])
    expect((await lead.from('person_places').select('id').eq('person_id', victimId)).data).toEqual([])
    expect((await lead.from('person_places').select('id').eq('person_id', survivorId)).data).toHaveLength(1)

    for (const c of [lead, owner]) {
      const row = await c.from('entity_merges').select('id, kind, survivor_id, victim_ids, manifest, actor_id, reversed_at').eq('id', mergeId).single()
      expect(row.error, row.error?.message).toBeNull()
      expect(row.data).toMatchObject({ kind: 'person', survivor_id: survivorId, victim_ids: [victimId], actor_id: leadId, reversed_at: null })
      const dropped = (row.data!.manifest as Manifest).victims[0].dropped
      expect(dropped.map((d) => d.table).sort()).toEqual(['case_intel_links', 'person_places'])
      expect(dropped.find((d) => d.table === 'case_intel_links')!.row.id).toBe(victimLinkId)
      expect(dropped.find((d) => d.table === 'person_places')!.row.id).toBe(victimPlaceId)
    }
    // Merged twice is refused.
    const again = await lead.rpc('entity_merge', { p_kind: 'person', p_survivor: survivorId, p_victims: [victimId], p_reason: 'again' })
    expect(again.data).toMatchObject({ ok: false, code: 'already_merged' })
  })

  it('entity_unmerge: command + reason restores the tombstone, the repoint and the dropped rows', async () => {
    expect((await lsb.rpc('entity_unmerge', { p_merge_id: mergeId, p_reason: 'x' })).data).toMatchObject({ ok: false, code: 'denied' })
    expect((await lead.rpc('entity_unmerge', { p_merge_id: mergeId, p_reason: ' ' })).data).toMatchObject({ ok: false, code: 'reason_required' })
    const u = await lead.rpc('entity_unmerge', { p_merge_id: mergeId, p_reason: `[rls-test] v184c reversed ${tag}` })
    expect(u.error, u.error?.message).toBeNull()
    expect(u.data).toMatchObject({ ok: true, merge_id: mergeId, restored: 1 })
    expect(await victimState()).toEqual({ lifecycle: 'active', merged_into: null })
    expect(await vehicleOwner()).toBe(victimId)
    // The survivor's borrowed alias goes back.
    expect((await lead.from('persons').select('alias').eq('id', survivorId).single()).data?.alias).toBeNull()
    const links = await lead.from('case_intel_links').select('ref_id').eq('case_id', caseId).eq('kind', 'person')
    expect(links.data!.map((r) => r.ref_id).sort()).toEqual([survivorId, victimId].sort())
    expect((await lead.from('case_intel_links').select('id').eq('id', victimLinkId)).data).toHaveLength(1)
    expect((await lead.from('person_places').select('id').eq('id', victimPlaceId)).data).toHaveLength(1)
    const ledger = await lead.from('entity_merges').select('reversed_at, reversed_by').eq('id', mergeId).single()
    expect(ledger.data?.reversed_at).not.toBeNull()
    expect(ledger.data?.reversed_by).toBe(leadId)
  })

  it('a second unmerge is already_reversed; an unknown merge is not_found', async () => {
    expect((await lead.rpc('entity_unmerge', { p_merge_id: mergeId, p_reason: 'twice' })).data).toMatchObject({ ok: false, code: 'already_reversed' })
    expect((await lead.rpc('entity_unmerge', { p_merge_id: '00000000-0000-4000-8000-000000000001', p_reason: 'x' })).data).toMatchObject({ ok: false, code: 'not_found' })
  })
})
