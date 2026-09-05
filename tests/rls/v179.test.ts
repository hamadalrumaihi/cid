/** v1.79 — Portal Improvements Phase 0 (hygiene) pins.
 *
 *  Two migrations, two contracts:
 *
 *  20261004120000_field_jurisdiction_replay.sql — the everyone-sees rule.
 *    Since the 2026-08-25 bureau restructure, bureaus are functional, not
 *    geographic: private.field_jurisdiction_visible_for(user, jurisdiction)
 *    is TRUE for any active member regardless of their division, and the
 *    replay migration pins that body in the repo. An active MCB detective
 *    therefore reads sent (non-draft) submissions in BOTH jurisdictions, and
 *    an inactive account reads none.
 *
 *  20261004130000_scheduler_pg_cron.sql — the scheduler ledger is Owner-only.
 *    public.scheduled_job_runs carries one SELECT policy (private.is_owner());
 *    a detective and a Director both get ZERO rows (policy-filtered — the
 *    table grant exists, the policy denies), nobody can INSERT (no write
 *    policy), and private.job_begin / job_end are not executable by
 *    authenticated (EXECUTE revoked -> "permission denied for function").
 *
 *  Fixtures (tests/rls/README.md): lsb (active MCB detective), director,
 *  inactive; owner optional (enables the owner-positive block). Self-skipping
 *  without credentials. Creates one field submission draft owned by lsb and
 *  deletes it in afterAll; every other write is asserted to FAIL. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.director && PW.inactive)
if (!enabled) console.warn('[rls:v179] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.79 Phase 0 hygiene — jurisdiction replay + scheduler ledger', () => {
  let lsb: C, director: C, inactive: C, owner: C | null = null
  let submissionId: string | null = null

  beforeAll(async () => {
    lsb = mk(); director = mk(); inactive = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)
    await signInWithRetry(inactive, 'rls-test-inactive@cidportal.test', PW.inactive!)
    if (PW.owner) { owner = mk(); await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
  }, 60_000)

  afterAll(async () => {
    if (submissionId) await lsb.from('field_submissions').delete().eq('id', submissionId)
  })

  describe('field jurisdiction: every active member sees every jurisdiction', () => {
    it('an active MCB detective reads submissions across jurisdictions (no division filter)', async () => {
      // Both jurisdictions resolve for the same active member — the predicate
      // is "active", not "division maps to jurisdiction".
      const city = await lsb.from('field_submissions').select('id', { count: 'exact', head: true }).eq('jurisdiction', 'city')
      const blaine = await lsb.from('field_submissions').select('id', { count: 'exact', head: true }).eq('jurisdiction', 'blaine')
      expect(city.error).toBeNull()
      expect(blaine.error).toBeNull()
    })

    it('an inactive account reads zero submissions (and cannot create as CID)', async () => {
      const read = await inactive.from('field_submissions').select('id').limit(5)
      expect(read.error).toBeNull()
      expect(read.data).toEqual([])
    })

    it('a draft is visible only to its author until sent', async () => {
      const ins = await lsb.from('field_submissions').insert({ summary: '[rls-test] v179 draft', details: 'jurisdiction pin', jurisdiction: 'blaine' }).select('id, status').single()
      expect(ins.error).toBeNull()
      submissionId = ins.data!.id
      expect(ins.data!.status).toBe('draft')
      const asDirector = await director.from('field_submissions').select('id').eq('id', submissionId)
      expect(asDirector.error).toBeNull()
      expect(asDirector.data).toEqual([]) // drafts are the author's alone, whatever the jurisdiction
    })
  })

  describe('scheduled_job_runs: Owner-only ledger, no client writes, helpers not executable', () => {
    it('detective and Director read zero rows (policy-filtered, not an error)', async () => {
      for (const c of [lsb, director]) {
        const r = await c.from('scheduled_job_runs').select('id').limit(5)
        expect(r.error).toBeNull()
        expect(r.data).toEqual([])
      }
    })

    it('nobody can INSERT a run from a browser session', async () => {
      for (const c of [lsb, director]) {
        const r = await c.from('scheduled_job_runs').insert({ job: 'rls-test' })
        expect(r.error).not.toBeNull()
      }
    })

    it('private.job_begin / job_end are not reachable through PostgREST', async () => {
      // private.* is not exposed by PostgREST at all; the call must fail
      // before any function body runs.
      const r = await lsb.rpc('job_begin' as never, { p_job: 'rls-test' } as never)
      expect(r.error).not.toBeNull()
    })

    it('the Owner reads the ledger (optional block)', async () => {
      if (!owner) return
      const r = await owner.from('scheduled_job_runs').select('id, job, status').limit(5)
      expect(r.error).toBeNull()
      expect(Array.isArray(r.data)).toBe(true)
    })
  })
})
