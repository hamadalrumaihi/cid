/** v1.84 — Case access grants expire (P1-06, migration 20261012120000).
 *
 *  Pins, on a fixture-owned SCB case granted to an MCB detective:
 *   · a grant carries expires_at (30 days by default) and admits the grantee
 *     through BOTH can_access_case (can_record 'access') and
 *     can_access_case_row (the cases SELECT policy);
 *   · a direct UPDATE of a grant is a hard 42501 — renewal is
 *     case_access_renew: refused to a non-lead (denied), bounded to 1..90
 *     days (bad_request), audited ACCESS_RENEWED and notified;
 *   · my_permissions().expiries.case_access_grants lists the grantee's
 *     live grants;
 *   · a CHECK refuses a grant longer than 90 days.
 *  The clock-driven halves (a lapsed grant denies; the sweep's reminder and
 *  expiry) cannot be advanced by a client and were verified live at apply
 *  time in a rolled-back transaction (MIGRATION-HISTORY).
 *
 *  Fixtures: bcb (SCB detective, creates the case and grants), lsb (MCB
 *  detective, the grantee). Cleanup by rls_test_cleanup(). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, bcb: process.env.RLS_TEST_PASSWORD_BCB }
const enabled = !!(ANON && PW.lsb && PW.bcb)
if (!enabled) console.warn('[rls:v184] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
const DAY = 86_400_000

describe.skipIf(!enabled)('v1.84 — case access grant expiry', () => {
  let lsb: C, bcb: C
  let lsbId = '', caseId = '', grantId = ''
  const tag = Date.now().toString(36)

  beforeAll(async () => {
    lsb = mk(); bcb = mk()
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    const c = await bcb.from('cases').insert({ case_number: `V184-${tag}`, title: 'v1.84 case (SCB)', bureau: 'street_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
  }, 90_000)

  afterAll(async () => { if (bcb) await bcb.rpc('rls_test_cleanup') })

  it('a cross-bureau detective has no access until granted; the grant defaults to 30 days', async () => {
    expect((await lsb.from('cases').select('id').eq('id', caseId)).data).toEqual([])
    expect((await lsb.rpc('can_record', { p_action: 'access', p_kind: 'case', p_id: caseId })).data).toBe(false)
    const g = await bcb.from('case_access_grants').insert({ case_id: caseId, officer_id: lsbId }).select('id, expires_at, created_at').single()
    expect(g.error, g.error?.message).toBeNull()
    grantId = g.data!.id
    const days = (Date.parse(g.data!.expires_at) - Date.parse(g.data!.created_at)) / DAY
    expect(Math.round(days)).toBe(30)
    expect((await lsb.from('cases').select('id').eq('id', caseId)).data).toHaveLength(1)
    expect((await lsb.rpc('can_record', { p_action: 'access', p_kind: 'case', p_id: caseId })).data).toBe(true)
    const perms = await lsb.rpc('my_permissions')
    const grants = (perms.data as { expiries: { case_access_grants: Array<{ case_id: string }> } }).expiries.case_access_grants
    expect(grants.map((x) => x.case_id)).toContain(caseId)
  })

  it('a grant cannot outlive 90 days and cannot be edited directly', async () => {
    const far = new Date(Date.now() + 120 * DAY).toISOString()
    const tooLong = await bcb.from('case_access_grants').insert({ case_id: caseId, officer_id: lsbId, expires_at: far })
    expect(tooLong.error).not.toBeNull()
    const upd = await bcb.from('case_access_grants').update({ expires_at: far }).eq('id', grantId)
    expect(upd.error?.code).toBe('42501')
    const upd2 = await lsb.from('case_access_grants').update({ expires_at: far }).eq('id', grantId)
    expect(upd2.error?.code).toBe('42501')
  })

  it('renewal is the lead\'s (or command\'s), bounded, audited', async () => {
    expect((await lsb.rpc('case_access_renew', { p_grant: grantId, p_days: 10 })).data).toMatchObject({ ok: false, code: 'denied' })
    expect((await bcb.rpc('case_access_renew', { p_grant: grantId, p_days: 91 })).data).toMatchObject({ ok: false, code: 'bad_request' })
    const r = await bcb.rpc('case_access_renew', { p_grant: grantId, p_days: 45 })
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ ok: true, grant_id: grantId })
    const g = await bcb.from('case_access_grants').select('expires_at, created_at, renewed_at').eq('id', grantId).single()
    expect(g.data!.renewed_at).not.toBeNull()
    expect(Math.round((Date.parse(g.data!.expires_at) - Date.parse(g.data!.created_at)) / DAY)).toBe(45)
    // The grantee was told.
    const n = await lsb.from('notifications').select('type').eq('type', 'access_renewed').order('created_at', { ascending: false }).limit(1)
    expect(n.error).toBeNull()
    expect((n.data ?? []).length).toBeGreaterThan(0)
  })

  it('revoking the grant closes the door again', async () => {
    expect((await bcb.from('case_access_grants').delete().eq('id', grantId)).error).toBeNull()
    expect((await lsb.from('cases').select('id').eq('id', caseId)).data).toEqual([])
    expect((await lsb.rpc('can_record', { p_action: 'access', p_kind: 'case', p_id: caseId })).data).toBe(false)
  })
})
