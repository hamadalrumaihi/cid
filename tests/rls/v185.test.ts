/** v1.85 — Generalised permanent deletion (P1-07, migration 20261013120000).
 *
 *  The member protocol's shape (v125), now for every soft-deletable record:
 *   · preview / arm / execute are OWNER-ONLY — a Bureau Lead is refused;
 *   · a LIVE record is not eligible (it must be in the Trash);
 *   · a record with live dependants is refused with the dependant named
 *     (a person with a live photo);
 *   · once the dependants are in the Trash too, arm needs a non-blank reason
 *     and issues a token; execute needs the exact 'DELETE <label>';
 *   · a used token is refused; the ledger row is Owner-readable and names
 *     the batch that went with the record;
 *   · can_record('permanent_delete', …) answers only the Owner, only for a
 *     record in the Trash.
 *  Session freshness: the fixtures sign in at suite start, so every call
 *  runs on a fresh session (the positive path). The stale-session refusal
 *  is private.assert_fresh_session's (pinned by v125's reasoning).
 *
 *  Fixtures: owner, lead (MCB Bureau Lead, soft-deletes the material), lsb
 *  (author). Nothing survives the suite: the record is destroyed by the
 *  protocol under test; rls_test_cleanup() sweeps the rest. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, lead: process.env.RLS_TEST_PASSWORD_LEAD, owner: process.env.RLS_TEST_PASSWORD_OWNER }
const enabled = !!(ANON && PW.lsb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:v185] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Preview = { eligible: boolean; ineligible_reasons: string[]; blockers: Record<string, number>; destroyed: Record<string, number>; target: { label: string } }

describe.skipIf(!enabled)('v1.85 — permanent deletion: preview → arm → execute', () => {
  let lsb: C, lead: C, owner: C
  let personId = '', vehicleId = '', mediaId = '', token = '', label = ''
  const tag = Date.now().toString(36)

  beforeAll(async () => {
    lsb = mk(); lead = mk(); owner = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)
    label = `RLS Test v185 ${tag}`
    const p = await lsb.from('persons').insert({ name: label }).select('id').single()
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data!.id
    const v = await lsb.from('vehicles').insert({ plate: `V185${tag.slice(-4).toUpperCase()}` }).select('id').single()
    if (v.error) throw new Error(`vehicle insert failed: ${v.error.message}`)
    vehicleId = v.data!.id
    const l = await lsb.from('person_vehicles').insert({ person_id: personId, vehicle_id: vehicleId, role: 'associated' })
    if (l.error) throw new Error(`link insert failed: ${l.error.message}`)
    const m = await lsb.from('media').insert({ title: `[rls-test] v185 ${tag}`, type: 'image', person_id: personId, external_url: 'https://example.invalid/v185.png' }).select('id').single()
    if (m.error) throw new Error(`media insert failed: ${m.error.message}`)
    mediaId = m.data!.id
  }, 90_000)

  afterAll(async () => { if (lsb) await lsb.rpc('rls_test_cleanup') })

  it('preview, arm and execute are owner-only', async () => {
    expect((await lead.rpc('permanent_delete_record_preview', { p_kind: 'person', p_id: personId })).error?.message).toMatch(/owner/i)
    expect((await lead.rpc('permanent_delete_record_arm', { p_kind: 'person', p_id: personId, p_reason: 'x' })).error?.message).toMatch(/owner/i)
    expect((await lead.rpc('permanent_delete_record_execute', { p_token: '00000000-0000-4000-8000-000000000001', p_confirm: 'x' })).error?.message).toMatch(/owner/i)
  })

  it('a live record is not eligible; a trashed record with live dependants names them', async () => {
    const live = await owner.rpc('permanent_delete_record_preview', { p_kind: 'person', p_id: personId })
    expect(live.error).toBeNull()
    expect((live.data as Preview).eligible).toBe(false)
    expect((live.data as Preview).ineligible_reasons).toContain('the record is not in the Trash')
    expect((await owner.rpc('can_record', { p_action: 'permanent_delete', p_kind: 'person', p_id: personId })).data).toBe(false)
    expect((await lead.rpc('soft_delete', { p_kind: 'person', p_id: personId, p_reason: `[rls-test] v185 ${tag}` })).data).toMatchObject({ ok: true })
    const blocked = await owner.rpc('permanent_delete_record_preview', { p_kind: 'person', p_id: personId })
    expect((blocked.data as Preview).eligible).toBe(false)
    expect((blocked.data as Preview).blockers['media.person_id']).toBe(1)
    expect((await owner.rpc('permanent_delete_record_arm', { p_kind: 'person', p_id: personId, p_reason: 'x' })).error?.message).toMatch(/blocked/i)
    expect((await owner.rpc('can_record', { p_action: 'permanent_delete', p_kind: 'person', p_id: personId })).data).toBe(true)
    expect((await lead.rpc('can_record', { p_action: 'permanent_delete', p_kind: 'person', p_id: personId })).data).toBe(false)
  })

  it('with the dependants in the Trash, arm needs a reason and issues a single-use token', async () => {
    // The photo has no case: its author (lsb) trashes it directly.
    const photo = await lsb.rpc('soft_delete', { p_kind: 'media', p_id: mediaId, p_reason: `[rls-test] v185 ${tag}` })
    expect(photo.data, JSON.stringify(photo.data)).toMatchObject({ ok: true })
    const ok = await owner.rpc('permanent_delete_record_preview', { p_kind: 'person', p_id: personId })
    expect((ok.data as Preview).eligible, JSON.stringify(ok.data)).toBe(true)
    expect((ok.data as Preview).destroyed['person_vehicles.person_id']).toBe(1)
    expect((ok.data as Preview).target.label).toBe(label)
    expect((await owner.rpc('permanent_delete_record_arm', { p_kind: 'person', p_id: personId, p_reason: '   ' })).error?.message).toMatch(/reason/i)
    const armed = await owner.rpc('permanent_delete_record_arm', { p_kind: 'person', p_id: personId, p_reason: `[rls-test] v185 ${tag}` })
    expect(armed.error, armed.error?.message).toBeNull()
    const a = armed.data as { token: string; confirm: string }
    token = a.token
    expect(a.confirm).toBe(`DELETE ${label}`)
  })

  it('execute needs the exact confirmation, destroys the batch, writes the ledger, and burns the token', async () => {
    expect((await owner.rpc('permanent_delete_record_execute', { p_token: token, p_confirm: 'DELETE wrong' })).error?.message).toMatch(/confirmation/i)
    const done = await owner.rpc('permanent_delete_record_execute', { p_token: token, p_confirm: `DELETE ${label}` })
    expect(done.error, done.error?.message).toBeNull()
    expect(done.data).toMatchObject({ kind: 'person', label, destroyed: { 'person_vehicles.person_id': 1 } })
    expect((await owner.from('persons').select('id').eq('id', personId)).data).toEqual([])
    expect((await owner.from('person_vehicles').select('id').eq('person_id', personId)).data).toEqual([])
    // The shared vehicle stays.
    expect((await lsb.from('vehicles').select('id').eq('id', vehicleId)).data).toHaveLength(1)
    const ledger = await owner.from('deleted_record_ledger').select('kind, label, external_assets').eq('record_id', personId).single()
    expect(ledger.error).toBeNull()
    expect(ledger.data).toMatchObject({ kind: 'person', label })
    expect((await lead.from('deleted_record_ledger').select('id').eq('record_id', personId)).data).toEqual([])
    expect((await owner.rpc('permanent_delete_record_execute', { p_token: token, p_confirm: `DELETE ${label}` })).error?.message).toMatch(/already used|already permanently deleted/i)
  })
})
