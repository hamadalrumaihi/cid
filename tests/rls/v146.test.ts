/** v1.46 — gang roster lifecycle RPCs (migration
 *  20260807180000_gang_roster_lifecycle).
 *
 *  The roster edit path moved off a raw table UPDATE onto two RPCs so the
 *  lifecycle is server-enforced:
 *    • gang_member_update — the modal's Save: overwrites the relationship
 *      fields, stamps left_at on a 'Former member' departure and clears it on
 *      return, raises a readable error on a rejoin collision (not a bare 23505),
 *      and stamps reviewed_by/reviewed_at when p_mark_reviewed.
 *    • gang_member_review — the roster's one-click triage: stamps the review and
 *      optionally confirms status/confidence, refuses to retire a member, and
 *      keeps the other fields untouched.
 *
 *  Both are active-member gated (private.is_active) and denied to anon.
 *
 *  Fixtures: lsb (active detective), anon (denied). Fixture gang + person are
 *  purged by rls_test_cleanup in afterAll. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB }
const enabled = !!(ANON && PW.lsb)
if (!enabled) console.warn('[rls:v146] fixture password not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.46 — gang roster lifecycle (live)', () => {
  let lsb: C, anon: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let gangId = ''
  let personId = ''
  let memberId = ''

  beforeAll(async () => {
    lsb = mk(); anon = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)

    const g = await lsb.from('gangs').insert({ name: `[rls-test] v146 Gang ${tag}` }).select('id')
    expect(g.error, g.error?.message).toBeNull()
    gangId = g.data![0].id as string

    const p = await lsb.from('persons').insert({ name: `RLS Test V146 Person ${tag}` }).select('id')
    expect(p.error, p.error?.message).toBeNull()
    personId = p.data![0].id as string

    const add = await lsb.rpc('gang_member_add', { p_gang: gangId, p_person: personId, p_status: 'Under review' })
    expect(add.error, add.error?.message).toBeNull()
    memberId = add.data as string
  })

  afterAll(async () => {
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lsb, anon].map((c) => c.auth.signOut()))
  })

  it('gang_member_review stamps the reviewer and confirms status/confidence', async () => {
    const res = await lsb.rpc('gang_member_review', { p_member: memberId, p_status: 'Confirmed member', p_confidence: 'High' })
    expect(res.error, res.error?.message).toBeNull()
    const row = await lsb.from('gang_members').select('status,confidence,reviewed_by,reviewed_at').eq('id', memberId).maybeSingle()
    expect(row.data?.status).toBe('Confirmed member')
    expect(row.data?.confidence).toBe('High')
    expect(row.data?.reviewed_by).toBeTruthy()
    expect(row.data?.reviewed_at).toBeTruthy()
  })

  it('gang_member_review refuses to retire a member', async () => {
    const res = await lsb.rpc('gang_member_review', { p_member: memberId, p_status: 'Former member' })
    expect(res.error).not.toBeNull()
    expect(res.error?.message).toMatch(/use gang_member_update to retire/i)
  })

  it('gang_member_review rejects an invalid status', async () => {
    const res = await lsb.rpc('gang_member_review', { p_member: memberId, p_status: 'kingpin' })
    expect(res.error).not.toBeNull()
    expect(res.error?.message).toMatch(/invalid status/i)
  })

  it('gang_member_update stamps left_at on a Former-member departure', async () => {
    const res = await lsb.rpc('gang_member_update', { p_member: memberId, p_status: 'Former member' })
    expect(res.error, res.error?.message).toBeNull()
    const row = await lsb.from('gang_members').select('status,left_at').eq('id', memberId).maybeSingle()
    expect(row.data?.status).toBe('Former member')
    expect(row.data?.left_at).toBeTruthy() // defaulted to today
  })

  it('gang_member_update clears left_at on return to active and can set joined_at', async () => {
    const res = await lsb.rpc('gang_member_update', { p_member: memberId, p_status: 'Probable member', p_joined_at: '2025-01-15' })
    expect(res.error, res.error?.message).toBeNull()
    const row = await lsb.from('gang_members').select('status,left_at,joined_at').eq('id', memberId).maybeSingle()
    expect(row.data?.status).toBe('Probable member')
    expect(row.data?.left_at).toBeNull()
    expect(row.data?.joined_at).toBe('2025-01-15')
  })

  it('gang_member_update raises a readable error on a rejoin collision', async () => {
    // A second active membership for the same person+gang: retire the first,
    // add a fresh active row, then try to reactivate the retired one.
    await lsb.rpc('gang_member_update', { p_member: memberId, p_status: 'Former member' })
    const add2 = await lsb.rpc('gang_member_add', { p_gang: gangId, p_person: personId, p_status: 'Confirmed member' })
    expect(add2.error, add2.error?.message).toBeNull()
    const res = await lsb.rpc('gang_member_update', { p_member: memberId, p_status: 'Associate' })
    expect(res.error).not.toBeNull()
    expect(res.error?.message).toMatch(/already has an active membership/i)
  })

  it('denies an anonymous caller on both RPCs', async () => {
    const r1 = await anon.rpc('gang_member_review', { p_member: memberId })
    expect(r1.error).not.toBeNull()
    const r2 = await anon.rpc('gang_member_update', { p_member: memberId, p_status: 'Associate' })
    expect(r2.error).not.toBeNull()
  })
})
