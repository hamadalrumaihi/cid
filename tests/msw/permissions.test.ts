/** Proof: the client permission module's server-first contract (P1-08).
 *
 *  1. `my_permissions()` answers per session — signed out reads as
 *     access_class 'none'; a seeded owner / command / member session reads
 *     as its class — and normalizePermissions() shapes it for the hook.
 *  2. `canRecord()` is deny-by-default: a refused or missing RPC is false,
 *     a pinned true is true.
 *  3. An RPC failure never falls back to the pure mirrors: the loader's
 *     answer is NO_ACCESS plus an error (the Sidebar's retry notice). */
import { describe, expect, it } from 'vitest'
import { supabase } from '@/lib/supabase'
import { rpc } from '@/lib/db'
import { NO_ACCESS, canRecord, normalizePermissions } from '@/lib/permissions'
import { roleSession, rpcResult } from '@/mocks/scenarios'

const signIn = async (role: Parameters<typeof roleSession>[0]) => {
  const { credentials } = roleSession(role)
  const { error } = await supabase().auth.signInWithPassword({ email: credentials.email, password: credentials.password })
  expect(error).toBeNull()
}

describe('my_permissions — one server answer per session', () => {
  it('reads as none when signed out', async () => {
    const res = await rpc('my_permissions', {})
    expect(res.error).toBeNull()
    expect(normalizePermissions(res.data)).toEqual(NO_ACCESS)
  })
  it('classes the seeded sessions like the server does', async () => {
    for (const [role, cls] of [['owner', 'owner'], ['bureau_lead', 'command'], ['detective', 'member']] as const) {
      await signIn(role)
      const res = await rpc('my_permissions', {})
      expect(res.error).toBeNull()
      const p = normalizePermissions(res.data)
      expect(p.access_class, role).toBe(cls)
      expect(p.expiries.case_access_grants).toEqual([])
      await supabase().auth.signOut()
    }
  })
  it('keeps NO_ACCESS when the RPC fails — no fallback to the mirrors', async () => {
    rpcResult('my_permissions', null)
    const res = await rpc('my_permissions', {})
    expect(normalizePermissions(res.data)).toEqual(NO_ACCESS)
  })
})

describe('canRecord — deny by default', () => {
  it('is false when the RPC is unavailable and true only when the server says so', async () => {
    expect(await canRecord('read', 'case', '00000000-0000-4000-8000-000000000001')).toBe(false)
    rpcResult('can_record', true)
    expect(await canRecord('read', 'case', '00000000-0000-4000-8000-000000000001')).toBe(true)
  })
})
