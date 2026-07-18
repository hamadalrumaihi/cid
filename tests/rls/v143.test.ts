/** v1.43 — case archive model + owner-only permanent deletion + merge repoints
 *  (migrations 20260807130000_case_archive_owner_delete,
 *   20260807140000_merge_rpc_extensions).
 *
 *  Case deletion used to be a client-side cascade catastrophe (audit
 *  BUG-001): command could destroy reports/evidence/custody behind an Undo
 *  that restored an empty shell. The model is now archive-first:
 *   - command ARCHIVES (audited, restorable, nothing destroyed) and
 *     RESTORES; a plain detective can do neither;
 *   - the archive columns are frozen against direct client writes (the
 *     profiles_block_privileged revert pattern);
 *   - only the Owner previews and permanently deletes; the preview's
 *     destroyed-list comes from the FK catalog so it cannot drift; a reason
 *     is required and the audit row carries the destroyed-row counts.
 *  Plus the merge extension: person_merge now moves narcotic_persons links
 *  to the survivor instead of stranding them on the tombstone.
 *
 *  Fixtures: lsb (detective — creates the case, negative archiver), lead
 *  (LSB bureau_lead — archives/restores), director (negative for the
 *  owner-only surface; merges persons), owner (preview + delete). Cleanup
 *  sweeps fixture cases; the test persons and provisional narcotic are
 *  deleted in-test / afterAll. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.director && PW.owner)
if (!enabled) console.warn('[rls:v143] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.43 — case archive + owner-only deletion + merge repoints (live)', () => {
  let lsb: C, lead: C, director: C, owner: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let caseId = ''
  let survivorId = ''
  let victimId = ''
  let narcId = ''

  beforeAll(async () => {
    lsb = mk(); lead = mk(); director = mk(); owner = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [director, 'rls-test-director@cidportal.test', PW.director, 'director'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await director.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const c = await lsb.from('cases').insert({ case_number: `V143-${tag}`, title: '[rls-test] v143 archive case', bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(c.error.message)
    caseId = c.data![0].id
    const t = await lsb.from('case_tasks').insert({ case_id: caseId, title: '[rls-test] v143 task' }).select('id')
    if (t.error) throw new Error(t.error.message)
  })

  afterAll(async () => {
    if (!director) return
    const clean = await director.rpc('rls_test_cleanup')
    if (clean.error) throw new Error(`rls_test_cleanup failed: ${clean.error.message}`)
    for (const pid of [victimId, survivorId]) {
      if (!pid) continue
      const del = await director.from('persons').delete().eq('id', pid)
      if (del.error) console.warn('[rls:v143] person cleanup failed:', del.error.message)
    }
    if (narcId) {
      const del = await director.from('narcotics').delete().eq('id', narcId)
      if (del.error) console.warn('[rls:v143] narcotic cleanup failed:', del.error.message)
    }
    await Promise.all([lsb, lead, director, owner].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ── archive lifecycle ── */

  it('a plain detective cannot archive', async () => {
    const r = await lsb.rpc('case_archive', { p_case: caseId })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/command action/i)
  })

  it('command archives (audited); direct client writes of the archive columns are frozen', async () => {
    const r = await lead.rpc('case_archive', { p_case: caseId, p_note: '[rls-test] v143 shelved' })
    expect(r.error).toBeNull()
    expect((r.data as { archived_at: string | null }).archived_at).not.toBeNull()

    // Direct un-archive attempt: RLS lets the UPDATE through, the trigger
    // silently reverts the guarded columns.
    const direct = await lead.from('cases').update({ archived_at: null }).eq('id', caseId).select('archived_at')
    if (!direct.error) expect(direct.data![0].archived_at).not.toBeNull()
  })

  it('command restores; double-restore is a clean error', async () => {
    const r = await lead.rpc('case_restore', { p_case: caseId })
    expect(r.error).toBeNull()
    expect((r.data as { archived_at: string | null }).archived_at).toBeNull()
    const again = await lead.rpc('case_restore', { p_case: caseId })
    expect(again.error).not.toBeNull()
    expect(again.error!.message).toMatch(/not archived/i)
  })

  /* ── owner-only permanent deletion ── */

  it('the preview and the delete are owner-only; the preview lists catalog-derived children', async () => {
    const dir = await director.rpc('case_delete_preview', { p_case: caseId })
    expect(dir.error).not.toBeNull()
    expect(dir.error!.message).toMatch(/restricted to the owner/i)

    const pv = await owner.rpc('case_delete_preview', { p_case: caseId })
    expect(pv.error).toBeNull()
    const preview = pv.data as { items: { table: string; rows: number }[]; deletable: boolean }
    expect(preview.deletable).toBe(true)
    expect(preview.items.some((i) => i.table === 'public.case_tasks' && i.rows >= 1)).toBe(true)
  })

  it('owner deletion requires a reason, destroys the case, and audits the counts', async () => {
    const bare = await owner.rpc('case_permanent_delete', { p_case: caseId, p_reason: '  ' })
    expect(bare.error).not.toBeNull()
    const del = await owner.rpc('case_permanent_delete', { p_case: caseId, p_reason: '[rls-test] v143 teardown' })
    expect(del.error).toBeNull()
    const gone = await lead.from('cases').select('id').eq('id', caseId)
    expect(gone.data ?? []).toHaveLength(0)
    const audit = await owner.from('audit_log').select('action,detail').eq('entity_id', caseId).eq('action', 'CASE_PERMANENT_DELETE')
    expect(audit.error).toBeNull()
    expect(audit.data ?? []).toHaveLength(1)
  })

  /* ── person_merge moves narcotics links (20260807140000) ── */

  it('person_merge repoints narcotic_persons to the survivor', async () => {
    const a = await lsb.from('persons').insert({ name: `RLS Test V143 Survivor ${tag}` }).select('id')
    expect(a.error).toBeNull()
    survivorId = a.data![0].id
    const b = await lsb.from('persons').insert({ name: `RLS Test V143 Victim ${tag}` }).select('id')
    expect(b.error).toBeNull()
    victimId = b.data![0].id
    const n = await lsb.from('narcotics').insert({ name: `RLS Test V143 Substance ${tag}` }).select('id')
    expect(n.error).toBeNull()
    narcId = n.data![0].id
    const link = await director.from('narcotic_persons').insert({ narcotic_id: narcId, person_id: victimId, role: 'seller' }).select('narcotic_id')
    expect(link.error).toBeNull()

    const merge = await director.rpc('person_merge', { p_survivor: survivorId, p_victims: [victimId], p_reason: `[rls-test] v143 dedupe ${tag}` })
    expect(merge.error).toBeNull()

    const moved = await director.from('narcotic_persons').select('person_id').eq('narcotic_id', narcId)
    expect(moved.error).toBeNull()
    expect(moved.data![0].person_id).toBe(survivorId)
  })
})
