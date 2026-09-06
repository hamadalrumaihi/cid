/** v1.84a — entity_suggest / entity_duplicates (P2-02, migrations
 *  20261014120000 + 20261015120000).
 *
 *  Both RPCs are SECURITY INVOKER: they answer under the caller's own RLS,
 *  which is the whole contract. Pins, on fixture persons / vehicles / gangs /
 *  accounts created by lsb:
 *   · an exact normalized hit (whole name, plate with separators, phone with
 *     punctuation, '@handle') comes back `exact = true` and first; a
 *     substring / alias / prefix hit comes back `exact = false`;
 *   · kind 'phone' spans persons (the hit's `kind` says 'person');
 *   · fewer than 2 characters and an unknown kind answer nothing;
 *   · bcb (another bureau) still sees the registry rows — registries are
 *     not bureau-walled — but NEVER a merged tombstone (lead merges a
 *     victim through entity_merge; the victim leaves suggest AND duplicates);
 *   · inactive gets zero rows, anon has no EXECUTE at all;
 *   · duplicates: strong on exact phone / name / name+dob / alias / plate /
 *     handle, soft (`name~`) on a near-name, and `exclude_id` omits the
 *     record being edited.
 *
 *  Fixtures: lsb (author), bcb (cross-bureau reader), lead (MCB Bureau Lead,
 *  the one merge), inactive, owner (teardown of the accounts, which
 *  rls_test_cleanup does not sweep — v155 precedent), anon. Everything else
 *  is swept by rls_test_cleanup(). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.inactive && PW.owner)
if (!enabled) console.warn('[rls:v184a] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Hit = { id: string; kind: string; label: string; sublabel: string | null; score: number; exact: boolean }
type Dup = { id: string; label: string; sublabel: string | null; signal: string; strength: 'strong' | 'soft'; score: number }

const suggest = async (c: C, kind: string, q: string, limit = 20): Promise<Hit[]> => {
  const r = await c.rpc('entity_suggest', { p_kind: kind, p_q: q, p_limit: limit })
  expect(r.error, r.error?.message).toBeNull()
  return (r.data ?? []) as Hit[]
}
const dups = async (c: C, kind: string, payload: Record<string, string>): Promise<Dup[]> => {
  const r = await c.rpc('entity_duplicates', { p_kind: kind, p_payload: payload })
  expect(r.error, r.error?.message).toBeNull()
  return (r.data ?? []) as Dup[]
}

describe.skipIf(!enabled)('v1.84a — entity_suggest / entity_duplicates under the caller\'s RLS', () => {
  let lsb: C, bcb: C, lead: C, inactive: C, owner: C, anon: C
  const tag = Date.now().toString(36)
  const tag4 = tag.slice(-4).toUpperCase()
  // A phone unlikely to collide with live data: 555 + seven digits from the clock.
  const digits = String(Date.now()).slice(-7)
  const phone = `555-${digits.slice(0, 3)}-${digits.slice(3)}`
  const phoneNorm = `555${digits}`
  const personName = `[rls-test] v184a Marcus Delgado ${tag}`
  const personAlias = `Ghost ${tag}`
  const victimName = `[rls-test] v184a Victim Delgado ${tag}`
  const plate = `V84A${tag4}`
  const gangName = `[rls-test] v184a Northside Kings ${tag}`
  const gangAlias = `NSK ${tag}`
  const handle = `v184a_${tag}_acct`
  let personId = '', victimId = '', vehicleId = '', gangId = '', accountId = ''

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); inactive = mk(); owner = mk(); anon = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    await signInWithRetry(inactive, 'rls-test-inactive@cidportal.test', PW.inactive!)
    await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner!)

    const p = await lsb.from('persons').insert({ name: personName, alias: personAlias, phone, dob: '1990-04-12' }).select('id, phone_normalized').single()
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data!.id
    if (p.data!.phone_normalized !== phoneNorm) throw new Error(`phone_normalized drifted: ${p.data!.phone_normalized}`)
    const v = await lsb.from('persons').insert({ name: victimName }).select('id').single()
    if (v.error) throw new Error(`victim insert failed: ${v.error.message}`)
    victimId = v.data!.id
    const veh = await lsb.from('vehicles').insert({ plate, model: 'v184a sedan', color: 'black' }).select('id').single()
    if (veh.error) throw new Error(`vehicle insert failed: ${veh.error.message}`)
    vehicleId = veh.data!.id
    const g = await lsb.from('gangs').insert({ name: gangName, aliases: gangAlias }).select('id').single()
    if (g.error) throw new Error(`gang insert failed: ${g.error.message}`)
    gangId = g.data!.id
    const a = await lsb.from('accounts').insert({ platform: 'Birdy', handle, display_name: `V184a Account ${tag}` }).select('id').single()
    if (a.error) throw new Error(`account insert failed: ${a.error.message}`)
    accountId = a.data!.id
  }, 90_000)

  afterAll(async () => {
    // Accounts are not swept by rls_test_cleanup — owner-delete (v155).
    if (owner && accountId) { try { await owner.from('accounts').delete().eq('id', accountId) } catch { /* best effort */ } }
    if (lsb) await lsb.rpc('rls_test_cleanup')
  })

  /* ── suggest: exact vs fuzzy ─────────────────────────────────────────── */

  it('person: the whole name is an exact hit and comes first; a substring is a fuzzy hit', async () => {
    const exact = await suggest(lsb, 'person', personName)
    expect(exact[0]).toMatchObject({ id: personId, kind: 'person', label: personName, exact: true })
    expect(exact[0].sublabel).toContain(personAlias)
    const fuzzy = await suggest(lsb, 'person', 'marcus delgado')
    const mine = fuzzy.find((h) => h.id === personId)
    expect(mine).toBeDefined()
    expect(mine!.exact).toBe(false)
    // The alias is a match surface too (exact when it is the whole alias).
    const byAlias = await suggest(lsb, 'person', personAlias)
    expect(byAlias.find((h) => h.id === personId)?.exact).toBe(true)
  })

  it('person by phone: punctuation is ignored (norm_phone), a leading 1 is dropped', async () => {
    const withPunct = await suggest(lsb, 'person', `+1 (555) ${digits.slice(0, 3)}-${digits.slice(3)}`)
    expect(withPunct.find((h) => h.id === personId)?.exact).toBe(true)
  })

  it('kind phone spans persons: the hit carries kind person; a prefix is not exact', async () => {
    const exact = await suggest(lsb, 'phone', phone)
    expect(exact.find((h) => h.id === personId)).toMatchObject({ kind: 'person', label: personName, exact: true })
    const prefix = await suggest(lsb, 'phone', phoneNorm.slice(0, 7))
    const mine = prefix.find((h) => h.id === personId)
    expect(mine).toBeDefined()
    expect(mine!.exact).toBe(false)
  })

  it('vehicle: the plate with separators is an exact hit (norm_plate); a plate prefix is fuzzy', async () => {
    const exact = await suggest(lsb, 'vehicle', `v84a-${tag4.toLowerCase()}`)
    expect(exact[0]).toMatchObject({ id: vehicleId, kind: 'vehicle', label: plate, exact: true })
    const fuzzy = await suggest(lsb, 'vehicle', plate.slice(0, 6))
    expect(fuzzy.find((h) => h.id === vehicleId)?.exact).toBe(false)
  })

  it('gang: the whole name is exact; the alias finds it without being exact', async () => {
    const exact = await suggest(lsb, 'gang', gangName)
    expect(exact[0]).toMatchObject({ id: gangId, kind: 'gang', exact: true })
    expect(exact[0].sublabel).toContain(gangAlias)
    const byAlias = await suggest(lsb, 'gang', gangAlias)
    expect(byAlias.find((h) => h.id === gangId)?.exact).toBe(false)
  })

  it('account: @handle (any case) is exact; part of the handle is fuzzy; the label carries the @', async () => {
    const exact = await suggest(lsb, 'account', `@${handle.toUpperCase()}`)
    expect(exact[0]).toMatchObject({ id: accountId, kind: 'account', label: `@${handle}`, exact: true })
    const fuzzy = await suggest(lsb, 'account', `v184a_${tag}`)
    expect(fuzzy.find((h) => h.id === accountId)?.exact).toBe(false)
  })

  it('fewer than two characters, an unknown kind, and the limit bound', async () => {
    expect(await suggest(lsb, 'person', 'm')).toEqual([])
    expect(await suggest(lsb, 'operation', personName)).toEqual([])
    expect((await suggest(lsb, 'person', 'rls-test', 1)).length).toBeLessThanOrEqual(1)
    expect((await suggest(lsb, 'person', 'rls-test', 500)).length).toBeLessThanOrEqual(50)
  })

  /* ── duplicates ──────────────────────────────────────────────────────── */

  it('duplicates: strong on phone / name+dob / alias / plate / handle', async () => {
    const byPhone = await dups(lsb, 'person', { phone: `(555) ${digits.slice(0, 3)}.${digits.slice(3)}` })
    expect(byPhone.find((d) => d.id === personId)).toMatchObject({ signal: 'phone', strength: 'strong' })
    const byNameDob = await dups(lsb, 'person', { name: personName.toUpperCase(), dob: '1990-04-12' })
    expect(byNameDob.find((d) => d.id === personId)).toMatchObject({ signal: 'name+dob', strength: 'strong' })
    const byAlias = await dups(lsb, 'person', { alias: personAlias })
    expect(byAlias.find((d) => d.id === personId)).toMatchObject({ signal: 'alias', strength: 'strong' })
    const byPlate = await dups(lsb, 'vehicle', { plate: `v84a ${tag4.toLowerCase()}` })
    expect(byPlate.find((d) => d.id === vehicleId)).toMatchObject({ signal: 'plate', strength: 'strong' })
    const byHandle = await dups(lsb, 'account', { handle: `@${handle}`, platform: 'birdy' })
    expect(byHandle.find((d) => d.id === accountId)).toMatchObject({ signal: 'handle', strength: 'strong' })
    expect((await dups(lsb, 'account', { handle, platform: 'Chirper' })).find((d) => d.id === accountId)).toBeUndefined()
  })

  it('duplicates: a near-name is a soft notice, never a strong warning', async () => {
    const soft = await dups(lsb, 'person', { name: `Marcus Delgado ${tag}` })
    expect(soft.find((d) => d.id === personId)).toMatchObject({ signal: 'name~', strength: 'soft' })
  })

  it('duplicates: exclude_id omits the record being edited; an empty payload answers nothing', async () => {
    const without = await dups(lsb, 'person', { name: personName, exclude_id: personId })
    expect(without.find((d) => d.id === personId)).toBeUndefined()
    expect(await dups(lsb, 'person', {})).toEqual([])
  })

  /* ── visibility ──────────────────────────────────────────────────────── */

  it('bcb (another bureau) sees the registry rows — registries are not bureau-walled', async () => {
    expect((await suggest(bcb, 'person', personName))[0]?.id).toBe(personId)
    expect((await suggest(bcb, 'vehicle', plate))[0]?.id).toBe(vehicleId)
    expect((await dups(bcb, 'person', { phone })).find((d) => d.id === personId)).toBeDefined()
  })

  it('a merged tombstone leaves suggest and duplicates for everyone', async () => {
    expect((await suggest(bcb, 'person', victimName))[0]?.id).toBe(victimId)
    const m = await lead.rpc('entity_merge', { p_kind: 'person', p_survivor: personId, p_victims: [victimId], p_reason: `[rls-test] v184a dedupe ${tag}` })
    expect(m.error, m.error?.message).toBeNull()
    expect(m.data).toMatchObject({ ok: true })
    for (const c of [bcb, lsb, lead]) {
      expect((await suggest(c, 'person', victimName)).find((h) => h.id === victimId)).toBeUndefined()
      expect((await dups(c, 'person', { name: victimName })).find((d) => d.id === victimId)).toBeUndefined()
    }
    // The survivor is still there.
    expect((await suggest(bcb, 'person', personName))[0]?.id).toBe(personId)
  })

  it('inactive gets zero rows from both; anon has no EXECUTE', async () => {
    expect(await suggest(inactive, 'person', personName)).toEqual([])
    expect(await suggest(inactive, 'vehicle', plate)).toEqual([])
    expect(await dups(inactive, 'person', { phone })).toEqual([])
    const s = await anon.rpc('entity_suggest', { p_kind: 'person', p_q: personName })
    expect(s.error).not.toBeNull()
    const d = await anon.rpc('entity_duplicates', { p_kind: 'person', p_payload: { name: personName } })
    expect(d.error).not.toBeNull()
  })
})
