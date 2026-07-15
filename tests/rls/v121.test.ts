/** v1.21 — Sprint 1C: justice denial · orphan case_files · removal audit.
 *  LIVE project, rls-test accounts. Pins migration 20260723010000:
 *   - private.is_justice_active now respects profiles.login_denied — a
 *     login-denied ADA drops out of doj_bureau_coverage() (which filters
 *     prosecutors by is_justice_active); restoring login brings them back.
 *   - private.can_access_case_number's unknown-number branch is command-only:
 *     a detective can no longer read/write case_files under a nonexistent case
 *     number; command can (cleanup path); access to a real accessible case's
 *     files is unchanged.
 *   - admin_remove_member / admin_restore_member now write a role_events row
 *     (source=admin_remove_member / admin_restore_member) and an audit_log row.
 *
 *  Fixtures: lsb (LSB detective), director (command), owner (audit_log reader —
 *  owner-only), da (sets ADA coverage), adaLsb (LSB primary ADA, justice-active,
 *  CID-inactive by default), target (disposable removal subject). Same
 *  conventions as the sibling suites. Requires migration 20260723010000. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  da: process.env.RLS_TEST_PASSWORD_DA,
  adaLsb: process.env.RLS_TEST_PASSWORD_ADA_LSB,
  target: process.env.RLS_TEST_PASSWORD_TARGET,
}
const enabled = !!(ANON && PW.lsb && PW.director && PW.owner && PW.da && PW.adaLsb && PW.target)
if (!enabled) console.warn('[rls:v121] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
interface CoverageRow { bureau: string; primary_ada_id: string | null }
const lsbPrimary = (rows: unknown): string | null =>
  ((rows ?? []) as CoverageRow[]).find((r) => r.bureau === 'LSB')?.primary_ada_id ?? null

describe.skipIf(!enabled)('v1.21 — justice denial, orphan case_files, removal audit (live)', () => {
  let lsb: C, director: C, owner: C, da: C, adaLsb: C, target: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const orphanNum = `NOCASE-${tag}`
  const cfIds: string[] = []
  let realCaseNum = ''

  beforeAll(async () => {
    lsb = mk(); director = mk(); owner = mk(); da = mk(); adaLsb = mk(); target = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [da, 'rls-test-da@cidportal.test', PW.da, 'da'],
      [adaLsb, 'rls-test-ada-lsb@cidportal.test', PW.adaLsb, 'adaLsb'],
      [target, 'rls-test-target@cidportal.test', PW.target, 'target'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    // Ensure adaLsb is the LSB primary ADA so it appears in coverage.
    const cov = await da.rpc('set_primary_ada', { p_prosecutor: ids.adaLsb, p_bureau: 'LSB' })
    if (cov.error) throw new Error(`ADA coverage setup failed: ${cov.error.message}`)
    // A real, accessible LSB case for the case_files regression check.
    const c = await lsb.from('cases').insert({ case_number: `V121-${tag}`, title: 'v1.21 case_files case (LSB)', bureau: 'LSB' }).select('case_number')
    if (c.error) throw new Error(c.error.message)
    realCaseNum = c.data![0].case_number as string
  })

  afterAll(async () => {
    if (!lsb) return
    // Best-effort restore (these resolve with {error}; they never reject).
    // Make sure adaLsb's login block is cleared no matter where a test failed.
    await director.rpc('restore_member_login', { p_target: ids.adaLsb })
    // Restore the removal subject to its default (detective/LSB/active); clear removed_at.
    await director.rpc('admin_restore_member', { p_target: ids.target })
    await lsb.rpc('rls_test_reset_member', { p_target: ids.target, p_role: 'detective', p_division: 'LSB', p_active: true })
    // Remove the command-inserted orphan case_files rows.
    if (cfIds.length) await director.from('case_files').delete().in('id', cfIds)
    await director.from('case_files').delete().eq('case_number', realCaseNum)
    const clean = await lsb.rpc('rls_test_cleanup')
    if (clean.error) throw new Error(`rls_test_cleanup failed: ${clean.error.message}`)
    await Promise.all([lsb, director, owner, da, adaLsb, target].filter(Boolean).map((c) => c.auth.signOut()))
  })

  // ── 4.6 justice access respects login denial ───────────────────────────────
  it('baseline: the LSB primary ADA appears in DOJ bureau coverage', async () => {
    const cov = await director.rpc('doj_bureau_coverage')
    expect(cov.error).toBeNull()
    expect(lsbPrimary(cov.data)).toBe(ids.adaLsb)
  })

  it('a login-denied ADA loses justice standing — drops out of coverage', async () => {
    const deny = await director.rpc('deny_member_login', { p_target: ids.adaLsb, p_reason: '[rls-test] v121 denial' })
    expect(deny.error).toBeNull()
    const cov = await director.rpc('doj_bureau_coverage')
    expect(cov.error).toBeNull()
    expect(lsbPrimary(cov.data)).toBeNull()
  })

  it('restoring login returns the ADA to justice standing', async () => {
    const res = await director.rpc('restore_member_login', { p_target: ids.adaLsb })
    expect(res.error).toBeNull()
    const cov = await director.rpc('doj_bureau_coverage')
    expect(cov.error).toBeNull()
    expect(lsbPrimary(cov.data)).toBe(ids.adaLsb)
  })

  // ── 4.7 orphan case_files is command-only ──────────────────────────────────
  const cfRow = (num: string, uid: string) => ({
    case_number: num, drive_file_id: `v121-${tag}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'v121 test file', web_view_link: 'https://drive.example/v121', added_by: uid,
  })

  it('a detective can NOT create a case_file under a nonexistent case number', async () => {
    const res = await lsb.from('case_files').insert(cfRow(orphanNum, ids.lsb)).select('id')
    expect(res.error).not.toBeNull() // WITH CHECK / can_access_case_number now false
  })

  it('command CAN create a case_file under a nonexistent case number (cleanup path)', async () => {
    const res = await director.from('case_files').insert(cfRow(orphanNum, ids.director)).select('id')
    expect(res.error).toBeNull()
    cfIds.push(res.data![0].id as string)
  })

  it('a detective can NOT read an orphan case_file', async () => {
    const res = await lsb.from('case_files').select('id').eq('case_number', orphanNum)
    expect(res.data ?? []).toHaveLength(0)
  })

  it('regression: a detective still manages case_files for a real accessible case', async () => {
    const ins = await lsb.from('case_files').insert(cfRow(realCaseNum, ids.lsb)).select('id')
    expect(ins.error).toBeNull()
    const read = await lsb.from('case_files').select('id').eq('case_number', realCaseNum)
    expect((read.data ?? []).length).toBeGreaterThanOrEqual(1)
  })

  // ── removal / restore auditing ─────────────────────────────────────────────
  it('admin_remove_member writes a role_events row and an audit_log row', async () => {
    const res = await director.rpc('admin_remove_member', { p_target: ids.target, p_reason: '[rls-test] v121 removal' })
    expect(res.error).toBeNull()
    const re = await director.from('role_events')
      .select('source, reason, old_active, new_active, actor_id')
      .eq('target_id', ids.target).eq('source', 'admin_remove_member')
    expect((re.data ?? []).length).toBeGreaterThanOrEqual(1)
    expect(re.data![0]).toMatchObject({ source: 'admin_remove_member', new_active: false, actor_id: ids.director })
    expect(re.data![0].reason).toMatch(/v121 removal/)
    const al = await owner.from('audit_log').select('action, entity, actor_id')
      .eq('entity', 'profiles').eq('entity_id', ids.target).eq('action', 'REMOVE_MEMBER')
    expect((al.data ?? []).length).toBeGreaterThanOrEqual(1)
    expect(al.data![0].actor_id).toBe(ids.director)
  })

  it('admin_restore_member writes its own role_events + audit_log rows', async () => {
    const res = await director.rpc('admin_restore_member', { p_target: ids.target })
    expect(res.error).toBeNull()
    const re = await director.from('role_events').select('source').eq('target_id', ids.target).eq('source', 'admin_restore_member')
    expect((re.data ?? []).length).toBeGreaterThanOrEqual(1)
    const al = await owner.from('audit_log').select('action').eq('entity', 'profiles').eq('entity_id', ids.target).eq('action', 'RESTORE_MEMBER')
    expect((al.data ?? []).length).toBeGreaterThanOrEqual(1)
  })
})
