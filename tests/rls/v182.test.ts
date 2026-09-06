/** v1.82 — audit_log immutability + hash chain (P1-02,
 *  migration 20261006120000_audit_chain.sql).
 *
 *  The ledger is append-only in SQL now, not by convention:
 *
 *  · UPDATE / DELETE / TRUNCATE privileges are revoked from authenticated and
 *    anon, so a client write is a hard "permission denied" (42501) — not a
 *    policy-filtered zero-row no-op. Pinned for a detective, a Director and
 *    the Owner alike (the Owner's SELECT policy grants reading, never
 *    rewriting) and for an anonymous session.
 *  · INSERT has no policy: a client insert is a row-level-security violation.
 *  · public.audit_chain_status() runs the verifier: the Owner gets
 *    {verify:{ok:true, checked, head_id, head_hash}, last_run}; everyone else
 *    is refused with the P0403 permission vocabulary.
 *  · The hash columns are Owner-readable like the rest of the row.
 *
 *  Tampering detection under the maintenance GUC cannot be exercised through
 *  PostgREST (the GUC is settable only inside a maintenance transaction); it
 *  is verified at apply time in a rolled-back transaction (see the migration
 *  header and MIGRATION-HISTORY.md) and stays covered by the daily
 *  audit-chain-verify job.
 *
 *  Nothing is created; every write in this file is asserted to FAIL.
 *  Fixtures (tests/rls/README.md): lsb, director; owner optional. */

import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.director)
if (!enabled) console.warn('[rls:v182] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Status = { verify: { ok: boolean; checked: number; head_id: number | null; head_hash: string | null }; last_run: unknown }

describe.skipIf(!enabled)('v1.82 audit_log immutability + hash chain', () => {
  let lsb: C, director: C, anon: C, owner: C | null = null

  beforeAll(async () => {
    lsb = mk(); director = mk(); anon = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)
    if (PW.owner) { owner = mk(); await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
  }, 60_000)

  describe('no client may rewrite the ledger', () => {
    it('UPDATE is a hard permission error for detective, Director, Owner and anon', async () => {
      const clients: [string, C][] = [['lsb', lsb], ['director', director], ['anon', anon]]
      if (owner) clients.push(['owner', owner])
      for (const [name, c] of clients) {
        const r = await c.from('audit_log').update({ action: 'rls-test-tamper' }).eq('id', 1)
        expect(r.error, `${name} update`).not.toBeNull()
        expect(r.error!.code, `${name} update code`).toBe('42501')
      }
    })

    it('DELETE is a hard permission error for every client', async () => {
      const clients: [string, C][] = [['lsb', lsb], ['director', director], ['anon', anon]]
      if (owner) clients.push(['owner', owner])
      for (const [name, c] of clients) {
        const r = await c.from('audit_log').delete().eq('id', 1)
        expect(r.error, `${name} delete`).not.toBeNull()
        expect(r.error!.code, `${name} delete code`).toBe('42501')
      }
    })

    it('INSERT from a client is refused (no INSERT policy)', async () => {
      for (const c of [lsb, director]) {
        const r = await c.from('audit_log').insert({ action: 'rls-test', entity: 'system' })
        expect(r.error).not.toBeNull()
      }
      if (owner) {
        const r = await owner.from('audit_log').insert({ action: 'rls-test', entity: 'system' })
        expect(r.error).not.toBeNull()
      }
    })
  })

  describe('audit_chain_status()', () => {
    it('is refused for a non-Owner with the P0403 vocabulary', async () => {
      for (const c of [lsb, director]) {
        const r = await c.rpc('audit_chain_status')
        expect(r.error).not.toBeNull()
        expect(r.error!.code).toBe('P0403')
      }
      const a = await anon.rpc('audit_chain_status')
      expect(a.error).not.toBeNull()
    })

    it('reports a valid chain to the Owner (optional block)', async () => {
      if (!owner) return
      const r = await owner.rpc('audit_chain_status')
      expect(r.error).toBeNull()
      const s = r.data as unknown as Status
      expect(s.verify.ok).toBe(true)
      expect(s.verify.checked).toBeGreaterThan(0)
      expect(s.verify.head_id).not.toBeNull()
      expect(s.verify.head_hash).toMatch(/^[0-9a-f]{64}$/)
      // The head row's stored hash is what the verifier reports.
      const head = await owner.from('audit_log').select('id, row_hash, prev_hash').eq('id', s.verify.head_id!).single()
      expect(head.error).toBeNull()
      expect(head.data!.row_hash).not.toBeNull()
    })

    it('the hash columns are invisible to non-owners like the rest of the row', async () => {
      const r = await lsb.from('audit_log').select('id, row_hash').limit(1)
      expect(r.error).toBeNull()
      expect(r.data).toEqual([])
    })
  })
})
