/** v1.58 — media follows case access (bureau scope), migration
 *  20260808300000_media_bureau_scope.
 *
 *  Cases have been bureau-isolated all along (private.can_access_case), but the
 *  media policies were portal-wide (is_active only). The migration adds one
 *  conjunct — (case_id is null OR can_access_case(case_id)) — to
 *  media_sel / media_ins / media_upd. This suite proves, live:
 *   - CASE-ATTACHED media is invisible across the bureau wall (a BCB detective
 *     sees 0 rows of an LSB case's media) while the owning bureau and command
 *     both see it;
 *   - UNATTACHED media (case_id null — the general vault / gang packages)
 *     stays visible to every active member, unchanged;
 *   - the wall blocks WRITES too: a cross-bureau INSERT attached to the case is
 *     refused, a cross-bureau UPDATE affects 0 rows, and re-pointing one's own
 *     vault media INTO an inaccessible case is refused (the WITH CHECK);
 *   - the RESTRICTED tier still applies ON TOP of case access: a restricted row
 *     on the member's OWN case stays hidden without narcotics privilege or a
 *     break-glass grant (D6 preserved);
 *   - anon reads nothing.
 *
 *  Fixtures (v156 shape): lsb (LSB detective — owning bureau), bcb (BCB
 *  detective — the cross-bureau probe), lead (bureau_lead = command,
 *  cross-bureau + deleter), owner (unused for writes; kept for shape), anon.
 *  media.case_id is ON DELETE SET NULL, so case deletion ORPHANS media into the
 *  vault — teardown lead-deletes every created media row explicitly before
 *  rls_test_cleanup sweeps the fixture case. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:v158] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.58 — media follows case access (live)', () => {
  let lsb: C, bcb: C, lead: C, owner: C, anon: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let caseMediaId = ''
  let vaultMediaId = ''
  let restrictedMediaId = ''
  let bcbVaultMediaId = ''

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); owner = mk(); anon = mk()
    for (const [client, email, pw] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb],
      [lead, 'rls-test-lead@cidportal.test', PW.lead],
      [owner, 'rls-test-owner@cidportal.test', PW.owner],
    ] as const) {
      await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    // An LSB case the BCB detective cannot access.
    const c = await lsb.from('cases').insert({ case_number: `V158-${tag}`, title: `[rls-test] v158 media-scope case ${tag}`, bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(`case insert: ${c.error.message}`)
    caseId = c.data![0].id as string
  })

  afterAll(async () => {
    if (!lead) return
    // media.case_id is ON DELETE SET NULL — orphaned rows would linger in the
    // vault, so delete every created media row explicitly (lead = can_delete;
    // the fixture case carries no hold).
    for (const id of [caseMediaId, vaultMediaId, restrictedMediaId, bcbVaultMediaId]) {
      if (id) { try { await lead.from('media').delete().eq('id', id) } catch { /* best effort */ } }
    }
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lsb, bcb, lead, owner, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ================= the bureau wall on reads ================= */

  it('case-attached media is visible to the owning bureau and command, invisible cross-bureau', async () => {
    const m = await lsb.from('media').insert({ title: `[rls-test] v158 case media ${tag}`, type: 'image', case_id: caseId }).select('id')
    expect(m.error, m.error?.message).toBeNull()
    caseMediaId = m.data![0].id as string

    const mine = await lsb.from('media').select('id').eq('id', caseMediaId)
    expect(mine.data ?? []).toHaveLength(1)
    const command = await lead.from('media').select('id').eq('id', caseMediaId)
    expect(command.data ?? []).toHaveLength(1)
    // The cross-bureau detective sees NOTHING — not an error, an empty set.
    const cross = await bcb.from('media').select('id').eq('id', caseMediaId)
    expect(cross.error, cross.error?.message).toBeNull()
    expect(cross.data ?? []).toHaveLength(0)
  })

  it('unattached vault media stays visible to every active member', async () => {
    const m = await lsb.from('media').insert({ title: `[rls-test] v158 vault media ${tag}`, type: 'image' }).select('id')
    expect(m.error, m.error?.message).toBeNull()
    vaultMediaId = m.data![0].id as string

    const fromLsb = await lsb.from('media').select('id').eq('id', vaultMediaId)
    expect(fromLsb.data ?? []).toHaveLength(1)
    const fromBcb = await bcb.from('media').select('id').eq('id', vaultMediaId)
    expect(fromBcb.data ?? []).toHaveLength(1)
  })

  /* ================= the bureau wall on writes ================= */

  it('a cross-bureau INSERT attached to the case is refused', async () => {
    const m = await bcb.from('media').insert({ title: `[rls-test] v158 intrusion ${tag}`, type: 'image', case_id: caseId }).select('id')
    expect(m.error).not.toBeNull()
  })

  it('a cross-bureau UPDATE affects 0 rows and changes nothing', async () => {
    const up = await bcb.from('media').update({ title: 'defaced' }).eq('id', caseMediaId).select('id')
    expect(up.error, up.error?.message).toBeNull()
    expect(up.data ?? []).toHaveLength(0)
    const still = await lsb.from('media').select('title').eq('id', caseMediaId).maybeSingle()
    expect(still.data?.title).toMatch(/v158 case media/)
  })

  it("re-pointing one's own vault media INTO an inaccessible case is refused (WITH CHECK)", async () => {
    const m = await bcb.from('media').insert({ title: `[rls-test] v158 bcb vault ${tag}`, type: 'image' }).select('id')
    expect(m.error, m.error?.message).toBeNull()
    bcbVaultMediaId = m.data![0].id as string

    const up = await bcb.from('media').update({ case_id: caseId }).eq('id', bcbVaultMediaId).select('id')
    expect(up.error).not.toBeNull()
    const still = await bcb.from('media').select('case_id').eq('id', bcbVaultMediaId).maybeSingle()
    expect(still.data?.case_id ?? null).toBeNull()
  })

  /* ================= restricted tier rides ON TOP of case access ============ */

  it('a restricted row on the OWN case stays hidden without narcotics privilege or break-glass', async () => {
    // media_ins has no restricted clause — lead attaches a restricted row.
    const m = await lead.from('media').insert({ title: `[rls-test] v158 restricted ${tag}`, type: 'image', case_id: caseId, restricted: true }).select('id')
    expect(m.error, m.error?.message).toBeNull()
    restrictedMediaId = m.data![0].id as string

    // lsb is a member of the owning bureau but a plain detective: case access
    // passes, the restricted gate does not — hidden (D6 preserved).
    const hidden = await lsb.from('media').select('id').eq('id', restrictedMediaId)
    expect(hidden.error, hidden.error?.message).toBeNull()
    expect(hidden.data ?? []).toHaveLength(0)
    // lead (narcotics-privileged command) still sees it.
    const seen = await lead.from('media').select('id').eq('id', restrictedMediaId)
    expect(seen.data ?? []).toHaveLength(1)
  })

  /* ================= anon ================= */

  it('anon reads nothing', async () => {
    const read = await anon.from('media').select('id').in('id', [caseMediaId, vaultMediaId].filter(Boolean))
    expect(read.data ?? []).toHaveLength(0)
  })
})
