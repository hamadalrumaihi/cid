/** v1.80 — Central permission module (P1-01,
 *  migration 20261005120000_permission_module.sql).
 *
 *  Two contracts, both READ-ONLY on the authority side:
 *
 *  public.my_permissions() — one definer call describing the CALLER only.
 *    Shape per fixture: detective → access_class 'member', rank 1, own
 *    bureau, no command scope; Bureau Lead → 'command' with a bureau-level
 *    scope; Director → 'command' with a division-level scope; inactive →
 *    'inactive' with active=false, role null, rank 0, bureau null; Owner
 *    (optional) → 'owner' with sib_standing 'owner'; AG / Judge (optional) →
 *    'justice' with the effective DOJ role. Nobody gets an error.
 *
 *  public.can_record(action, kind, id) — a per-record yes/no that MUST agree
 *    with the row policy that already governs the record. The suite creates
 *    one MCB case (lead = lsb), one report on it and one person, then asks
 *    the same question two ways — can_record and a plain SELECT — and
 *    asserts they agree for every fixture: bureau isolation (bcb sees
 *    nothing), command reach (lead / director see the case), deny-by-
 *    default (unknown action, unknown kind, unknown id, inactive account).
 *    Rank-and-reach: delete_child is true for the Lead, false for the
 *    detective and the other bureau. Archive / permanent delete are false
 *    for everyone on a live case (the Owner too — the case is not archived).
 *
 *  Also pinned: permission_catalog is Owner-only (policy-filtered for
 *  everyone else), private.perm_deny / perm_raise are unreachable through
 *  PostgREST, and public.perm_denied_ack writes ONE PERMISSION_DENIED row per
 *  actor/action/kind/id per minute (second call returns false), visible to
 *  the Owner with detail.source = 'client_ack'.
 *
 *  Fixtures (tests/rls/README.md): lsb, bcb, lead, director, inactive;
 *  owner, ag, judge optional. Self-skipping without credentials. Everything
 *  created is fixture-owned and purged by rls_test_cleanup() in afterAll
 *  (audit rows are append-only by design and stay). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  ag: process.env.RLS_TEST_PASSWORD_AG,
  judge: process.env.RLS_TEST_PASSWORD_JUDGE,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.director && PW.inactive)
if (!enabled) console.warn('[rls:v180] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Perms = {
  access_class: string; active: boolean; role: string | null; rank: number; bureau: string | null
  is_owner: boolean; sib_standing: string | null; department: string; doj_role: string | null
  is_field_officer: boolean; command_scope: { level: string; bureau: string | null } | null
  expiries: { doj_membership: string | null; joint_assignments: unknown[]; sib_temporary_access: unknown[] }
  flags: Record<string, boolean>
}

const perms = async (c: C): Promise<Perms> => {
  const r = await c.rpc('my_permissions')
  expect(r.error).toBeNull()
  return r.data as unknown as Perms
}
const can = async (c: C, action: string, kind: string, id: string): Promise<boolean> => {
  const r = await c.rpc('can_record', { p_action: action, p_kind: kind, p_id: id })
  expect(r.error, `${action}/${kind}`).toBeNull()
  return r.data as boolean
}
const RANDOM = '00000000-0000-4000-8000-000000000001'

describe.skipIf(!enabled)('v1.80 central permission module — my_permissions + can_record', () => {
  let lsb: C, bcb: C, lead: C, director: C, inactive: C
  let owner: C | null = null, ag: C | null = null, judge: C | null = null
  let lsbId = ''
  let caseId = '', reportId = '', personId = ''
  const tag = Date.now().toString(36)

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); director = mk(); inactive = mk()
    lsbId = await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    await signInWithRetry(lead, 'rls-test-lead@cidportal.test', PW.lead!)
    await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director!)
    await signInWithRetry(inactive, 'rls-test-inactive@cidportal.test', PW.inactive!)
    if (PW.owner) { owner = mk(); await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
    if (PW.ag) { ag = mk(); await signInWithRetry(ag, 'rls-test-ag@cidportal.test', PW.ag) }
    if (PW.judge) { judge = mk(); await signInWithRetry(judge, 'rls-test-judge@cidportal.test', PW.judge) }

    const c = await lsb.from('cases')
      .insert({ case_number: `PRM-${tag}`, title: '[rls-test] v180 permission module', bureau: 'major_crimes', lead_detective_id: lsbId })
      .select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
    const r = await lsb.from('reports')
      .insert({ case_id: caseId, template: 'initial', kind: 'initial', seq: 1, fields: {} })
      .select('id').single()
    if (r.error) throw new Error(`report insert failed: ${r.error.message}`)
    reportId = r.data!.id
    const p = await lsb.from('persons').insert({ name: `RLS Test v180 ${tag}` }).select('id').single()
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data!.id
  }, 90_000)

  afterAll(async () => {
    if (!lsb) return
    if (reportId) await lead.from('reports').delete().eq('id', reportId)
    if (personId) await lead.from('persons').delete().eq('id', personId)
    await lsb.rpc('rls_test_cleanup')
  })

  describe('my_permissions() — shape per standing', () => {
    it('a detective is a member of their bureau with no command scope', async () => {
      const p = await perms(lsb)
      expect(p.access_class).toBe('member')
      expect(p.active).toBe(true)
      expect(p.role).toBe('detective')
      expect(p.rank).toBe(1)
      expect(p.bureau).toBe('major_crimes')
      expect(p.is_owner).toBe(false)
      expect(p.command_scope).toBeNull()
      expect(p.doj_role).toBeNull()
      expect(p.is_field_officer).toBe(false)
      expect(Array.isArray(p.expiries.joint_assignments)).toBe(true)
      expect(Array.isArray(p.expiries.sib_temporary_access)).toBe(true)
      expect(typeof p.flags.sib_release_open).toBe('boolean')
      const q = await perms(bcb)
      expect(q.access_class).toBe('member')
      expect(q.bureau).toBe('street_crimes')
    })

    it('a Bureau Lead is command with a bureau-level scope', async () => {
      const p = await perms(lead)
      expect(p.access_class).toBe('command')
      expect(p.role).toBe('bureau_lead')
      expect(p.rank).toBe(3)
      expect(p.command_scope).toEqual({ level: 'bureau', bureau: 'major_crimes' })
    })

    it('a Director is command with a division-level scope', async () => {
      const p = await perms(director)
      expect(p.access_class).toBe('command')
      expect(p.role).toBe('director')
      expect(p.rank).toBe(5)
      expect(p.command_scope).toEqual({ level: 'division', bureau: null })
    })

    it('an inactive account is "inactive": no role, rank 0, no bureau — and no error', async () => {
      const p = await perms(inactive)
      expect(p.access_class).toBe('inactive')
      expect(p.active).toBe(false)
      expect(p.role).toBeNull()
      expect(p.rank).toBe(0)
      expect(p.bureau).toBeNull()
      expect(p.command_scope).toBeNull()
    })

    it('the Owner is "owner" with SIB standing owner (optional block)', async () => {
      if (!owner) return
      const p = await perms(owner)
      expect(p.access_class).toBe('owner')
      expect(p.is_owner).toBe(true)
      expect(p.sib_standing).toBe('owner')
      expect(p.flags.sib_may_switch).toBe(true)
    })

    it('a justice-only account is "justice" with its effective DOJ role (optional block)', async () => {
      if (ag) {
        const p = await perms(ag)
        expect(p.access_class).toBe('justice')
        expect(p.doj_role).toBe('attorney_general')
        expect(p.active).toBe(false)
      }
      if (judge) {
        const p = await perms(judge)
        expect(p.access_class).toBe('justice')
        expect(p.doj_role).toBe('judge')
      }
    })
  })

  describe('can_record() agrees with the row policy', () => {
    it('case read/access/edit: own bureau yes, other bureau no, command yes, inactive no', async () => {
      expect(await can(lsb, 'read', 'case', caseId)).toBe(true)
      expect(await can(lsb, 'access', 'case', caseId)).toBe(true)
      expect(await can(lsb, 'edit', 'case', caseId)).toBe(true)
      expect(await can(bcb, 'read', 'case', caseId)).toBe(false)
      expect(await can(bcb, 'access', 'case', caseId)).toBe(false)
      expect(await can(lead, 'read', 'case', caseId)).toBe(true)
      expect(await can(director, 'edit', 'case', caseId)).toBe(true)
      expect(await can(inactive, 'read', 'case', caseId)).toBe(false)
      // The same question through RLS: the row is visible exactly where can_record said yes.
      const seenByLsb = await lsb.from('cases').select('id').eq('id', caseId)
      const seenByBcb = await bcb.from('cases').select('id').eq('id', caseId)
      const seenByInactive = await inactive.from('cases').select('id').eq('id', caseId)
      expect(seenByLsb.data).toHaveLength(1)
      expect(seenByBcb.error).toBeNull(); expect(seenByBcb.data).toEqual([])
      expect(seenByInactive.error).toBeNull(); expect(seenByInactive.data).toEqual([])
    })

    it('grant_access follows can_grant_case: the lead detective and command, not another bureau', async () => {
      expect(await can(lsb, 'grant_access', 'case', caseId)).toBe(true) // lsb is lead_detective_id
      expect(await can(bcb, 'grant_access', 'case', caseId)).toBe(false)
      expect(await can(lead, 'grant_access', 'case', caseId)).toBe(true)
    })

    it('delete_child is rank AND reach: Lead yes, detective no, other bureau no', async () => {
      expect(await can(lead, 'delete_child', 'case', caseId)).toBe(true)
      expect(await can(director, 'delete_child', 'case', caseId)).toBe(true)
      expect(await can(lsb, 'delete_child', 'case', caseId)).toBe(false)
      expect(await can(bcb, 'delete_child', 'case', caseId)).toBe(false)
      // report.delete delegates to the parent case
      expect(await can(lead, 'delete', 'report', reportId)).toBe(true)
      expect(await can(lsb, 'delete', 'report', reportId)).toBe(false)
    })

    it('archive: command only on a live case; restore and permanent_delete are false on a live case for everyone', async () => {
      expect(await can(lsb, 'archive', 'case', caseId)).toBe(false)
      expect(await can(lead, 'archive', 'case', caseId)).toBe(true)
      expect(await can(director, 'restore', 'case', caseId)).toBe(false) // not archived
      expect(await can(director, 'permanent_delete', 'case', caseId)).toBe(false)
      if (owner) expect(await can(owner, 'permanent_delete', 'case', caseId)).toBe(false) // Owner, but the case is live
    })

    it('report read follows the parent case', async () => {
      expect(await can(lsb, 'read', 'report', reportId)).toBe(true)
      expect(await can(lsb, 'edit', 'report', reportId)).toBe(true)
      expect(await can(bcb, 'read', 'report', reportId)).toBe(false)
      const seenByBcb = await bcb.from('reports').select('id').eq('id', reportId)
      expect(seenByBcb.error).toBeNull(); expect(seenByBcb.data).toEqual([])
    })

    it('registry records: any active member reads and edits, command deletes, inactive nothing', async () => {
      expect(await can(lsb, 'read', 'person', personId)).toBe(true)
      expect(await can(bcb, 'edit', 'person', personId)).toBe(true) // registries are not bureau-scoped
      expect(await can(lsb, 'delete', 'person', personId)).toBe(false)
      expect(await can(lead, 'delete', 'person', personId)).toBe(true)
      expect(await can(inactive, 'read', 'person', personId)).toBe(false)
      const seenByInactive = await inactive.from('persons').select('id').eq('id', personId)
      expect(seenByInactive.error).toBeNull(); expect(seenByInactive.data).toEqual([])
    })

    it('deny by default: unknown action, unknown kind, unknown id, case-insensitive vocabulary', async () => {
      expect(await can(director, 'fly', 'case', caseId)).toBe(false)
      expect(await can(director, 'read', 'spaceship', caseId)).toBe(false)
      expect(await can(director, 'read', 'case', RANDOM)).toBe(false)
      expect(await can(director, 'read', 'person', RANDOM)).toBe(false)
      expect(await can(lsb, 'READ', 'Case', caseId)).toBe(true)
    })
  })

  describe('permission_catalog + the denial ledger', () => {
    it('permission_catalog is Owner-only: others get zero rows, not an error', async () => {
      for (const c of [lsb, lead, director]) {
        const r = await c.from('permission_catalog').select('action').limit(3)
        expect(r.error).toBeNull()
        expect(r.data).toEqual([])
      }
      if (owner) {
        const r = await owner.from('permission_catalog').select('action, kind').limit(50)
        expect(r.error).toBeNull()
        expect(r.data!.length).toBeGreaterThan(10)
      }
      const w = await director.from('permission_catalog').insert({ action: 'rls_test', kind: '*', area: 'x', rule: 'x', enforcing_object: 'x' })
      expect(w.error).not.toBeNull()
    })

    it('private.perm_deny / perm_raise are not reachable through PostgREST', async () => {
      const a = await director.rpc('perm_deny' as never, { p_action: 'x', p_kind: 'y', p_id: RANDOM } as never)
      expect(a.error).not.toBeNull()
      const b = await director.rpc('perm_raise' as never, { p_action: 'x', p_kind: 'y', p_id: RANDOM, p_reason: 'r', p_message: 'm' } as never)
      expect(b.error).not.toBeNull()
    })

    it('perm_denied_ack writes one row per minute per actor/action/kind/id, readable by the Owner only', async () => {
      const first = await lsb.rpc('perm_denied_ack', { p_action: 'edit', p_kind: 'case', p_id: caseId, p_reason: `rls-test v180 ${tag}` })
      expect(first.error).toBeNull()
      expect(first.data).toBe(true)
      const again = await lsb.rpc('perm_denied_ack', { p_action: 'edit', p_kind: 'case', p_id: caseId, p_reason: 'dup' })
      expect(again.error).toBeNull()
      expect(again.data).toBe(false) // deduplicated
      const asDetective = await lsb.from('audit_log').select('id').eq('action', 'PERMISSION_DENIED').eq('entity_id', caseId)
      expect(asDetective.error).toBeNull()
      expect(asDetective.data).toEqual([]) // audit_log stays Owner-only
      if (owner) {
        const rows = await owner.from('audit_log').select('actor_id, entity, detail')
          .eq('action', 'PERMISSION_DENIED').eq('entity_id', caseId)
        expect(rows.error).toBeNull()
        expect(rows.data).toHaveLength(1)
        expect(rows.data![0].actor_id).toBe(lsbId)
        expect(rows.data![0].entity).toBe('case')
        expect((rows.data![0].detail as { action: string; source: string }).action).toBe('edit')
        expect((rows.data![0].detail as { action: string; source: string }).source).toBe('client_ack')
      }
    })
  })
})
