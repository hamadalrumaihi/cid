/** v1.45 — person-first gang roster (migration
 *  20260807170000_gang_roster_person_first).
 *
 *  The roster used to be free-text: gang_members.name was NOT NULL and
 *  person_id an optional afterthought, so a member could be a typed name with
 *  no link to the Persons registry. The new model makes identity come from the
 *  Person: gang_member_add() resolves the name snapshot from the Person,
 *  refuses a merged tombstone, and refuses a second active membership (also
 *  enforced by a partial unique index), so "adding the member" and "linking
 *  the person" are one step. Status uses a fixed relationship vocabulary.
 *
 *  Fixtures: lsb (active detective — adds members), director (merges the
 *  tombstone person), anon (denied). Fixture gang + persons are purged by
 *  rls_test_cleanup in afterAll. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
}
const enabled = !!(ANON && PW.lsb && PW.director)
if (!enabled) console.warn('[rls:v145] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.45 — person-first gang roster (live)', () => {
  let lsb: C, director: C, anon: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let gangId = ''
  let personId = ''
  let victimId = ''

  beforeAll(async () => {
    lsb = mk(); director = mk(); anon = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)

    const g = await lsb.from('gangs').insert({ name: `[rls-test] v145 Gang ${tag}` }).select('id')
    expect(g.error, g.error?.message).toBeNull()
    gangId = g.data![0].id as string

    const p = await lsb.from('persons').insert({ name: `RLS Test V145 Person ${tag}` }).select('id')
    expect(p.error, p.error?.message).toBeNull()
    personId = p.data![0].id as string

    const v = await lsb.from('persons').insert({ name: `RLS Test V145 Victim ${tag}` }).select('id')
    expect(v.error, v.error?.message).toBeNull()
    victimId = v.data![0].id as string
  })

  afterAll(async () => {
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lsb, director, anon].map((c) => c.auth.signOut()))
  })

  it('links a person and snapshots their name (identity from the Person)', async () => {
    const res = await lsb.rpc('gang_member_add', {
      p_gang: gangId, p_person: personId, p_status: 'Confirmed member', p_rank: 'Soldier',
    })
    expect(res.error, res.error?.message).toBeNull()
    const memberId = res.data as string

    const row = await lsb.from('gang_members').select('person_id,name,status,created_by').eq('id', memberId).maybeSingle()
    expect(row.data?.person_id).toBe(personId)
    expect(row.data?.name).toBe(`RLS Test V145 Person ${tag}`) // snapshot resolved from the Person
    expect(row.data?.status).toBe('Confirmed member')
    expect(row.data?.created_by).toBeTruthy()
  })

  it('refuses a second active membership for the same person + gang', async () => {
    const res = await lsb.rpc('gang_member_add', { p_gang: gangId, p_person: personId })
    expect(res.error).not.toBeNull()
    expect(res.error?.message).toMatch(/already on the gang roster/i)
  })

  it('refuses a merged person', async () => {
    const merge = await director.rpc('person_merge', {
      p_survivor: personId, p_victims: [victimId], p_reason: 'v145 tombstone test',
    })
    expect(merge.error, merge.error?.message).toBeNull()
    const res = await lsb.rpc('gang_member_add', { p_gang: gangId, p_person: victimId })
    expect(res.error).not.toBeNull()
    expect(res.error?.message).toMatch(/not found or merged/i)
  })

  it('refuses an invalid status', async () => {
    // A fresh gang so the person-dup guard is not what trips it.
    const g2 = await lsb.from('gangs').insert({ name: `[rls-test] v145 Gang2 ${tag}` }).select('id')
    const res = await lsb.rpc('gang_member_add', { p_gang: g2.data![0].id as string, p_person: personId, p_status: 'kingpin' })
    expect(res.error).not.toBeNull()
    expect(res.error?.message).toMatch(/invalid status/i)
  })

  it('denies an anonymous caller', async () => {
    const res = await anon.rpc('gang_member_add', { p_gang: gangId, p_person: personId })
    expect(res.error).not.toBeNull()
  })

  it('the unique index blocks a direct duplicate active membership row', async () => {
    const dup = await lsb.from('gang_members').insert({
      gang_id: gangId, person_id: personId, name: 'dupe', status: 'Under review',
    })
    expect(dup.error?.code).toBe('23505')
  })
})
