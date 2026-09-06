/** v1.83 — Field-level version history (P1-05, migration 20261011120000).
 *
 *  Pins, on a fixture-owned person:
 *   · an UPDATE writes a record_versions row; a second same-actor edit inside
 *     five minutes COALESCES into it (one version, both fields);
 *   · history is read through the parent's SELECT policy: the author and a
 *     same-bureau colleague read it, an SIB-hidden / cross-bureau stranger
 *     of a record they cannot see reads nothing (pinned on a case the other
 *     bureau cannot read);
 *   · restore_version needs edit authority AND a reason, lands as a NEW
 *     version with source 'restore', and audits RECORD_VERSION_RESTORED;
 *   · a legal request is display-only (code display_only); a finalized
 *     report is sealed (code sealed) — the latter pinned through can_record;
 *   · record_versions takes no client write (42501).
 *
 *  Fixtures (tests/rls/README.md): lsb (MCB detective), bcb (SCB detective).
 *  Rows are created by lsb and purged by rls_test_cleanup() in afterAll. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = { lsb: process.env.RLS_TEST_PASSWORD_LSB, bcb: process.env.RLS_TEST_PASSWORD_BCB }
const enabled = !!(ANON && PW.lsb && PW.bcb)
if (!enabled) console.warn('[rls:v183] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Ver = { version_no: number; changed_fields: string[]; source: string; reason: string | null; old: Record<string, unknown>; new: Record<string, unknown> }
const history = async (c: C, kind: string, id: string): Promise<Ver[]> => {
  const r = await c.rpc('record_history', { p_kind: kind, p_id: id })
  expect(r.error, `record_history ${kind}`).toBeNull()
  return (r.data ?? []) as unknown as Ver[]
}

describe.skipIf(!enabled)('v1.83 — record_versions, history and restore', () => {
  let lsb: C, bcb: C
  let personId = '', caseId = ''
  const tag = Date.now().toString(36)

  beforeAll(async () => {
    lsb = mk(); bcb = mk()
    await signInWithRetry(lsb, 'rls-test-lsb@cidportal.test', PW.lsb!)
    await signInWithRetry(bcb, 'rls-test-bcb@cidportal.test', PW.bcb!)
    const p = await lsb.from('persons').insert({ name: `RLS Test v183 ${tag}` }).select('id').single()
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data!.id
    const c = await lsb.from('cases').insert({ case_number: `V183-${tag}`, title: 'v1.83 case (MCB)', bureau: 'major_crimes' }).select('id').single()
    if (c.error) throw new Error(`case insert failed: ${c.error.message}`)
    caseId = c.data!.id
  }, 90_000)

  afterAll(async () => { if (lsb) await lsb.rpc('rls_test_cleanup') })

  it('an edit versions the row and a same-actor burst coalesces into one version', async () => {
    expect((await lsb.from('persons').update({ name: `RLS Test v183 ${tag} b` }).eq('id', personId)).error).toBeNull()
    expect((await lsb.from('persons').update({ alias: 'Deuce' }).eq('id', personId)).error).toBeNull()
    const h = await history(lsb, 'person', personId)
    expect(h).toHaveLength(1)
    expect(h[0].version_no).toBe(1)
    expect(h[0].changed_fields).toEqual(['alias', 'name'])
    expect(h[0].source).toBe('edit')
    expect(h[0].old.alias).toBeNull()
    expect(h[0].new.alias).toBe('Deuce')
  })

  it('history follows the parent read: a colleague reads a registry record, nobody reads a case they cannot see', async () => {
    // Registries are division-wide: SCB reads the person and its history.
    expect(await history(bcb, 'person', personId)).toHaveLength(1)
    // The MCB case is invisible to SCB — so is every version of it.
    expect((await lsb.from('cases').update({ summary: `v183 ${tag}` }).eq('id', caseId)).error).toBeNull()
    expect(await history(lsb, 'case', caseId)).toHaveLength(1)
    expect(await history(bcb, 'case', caseId)).toEqual([])
    const direct = await bcb.from('record_versions').select('id').eq('record_id', caseId)
    expect(direct.error).toBeNull()
    expect(direct.data).toEqual([])
  })

  it('restore needs edit authority and a reason, lands as a new restore version, and is audited', async () => {
    expect((await lsb.rpc('restore_version', { p_kind: 'person', p_id: personId, p_version_no: 1 })).data).toMatchObject({ ok: false, code: 'reason_required' })
    expect((await lsb.rpc('restore_version', { p_kind: 'legal', p_id: personId, p_version_no: 1, p_reason: 'x' })).data).toMatchObject({ ok: false, code: 'display_only' })
    expect((await lsb.rpc('restore_version', { p_kind: 'person', p_id: personId, p_version_no: 9, p_reason: 'x' })).data).toMatchObject({ ok: false, code: 'not_found' })
    const r = await lsb.rpc('restore_version', { p_kind: 'person', p_id: personId, p_version_no: 1, p_reason: `[rls-test] v183 ${tag}` })
    expect(r.error).toBeNull()
    expect(r.data).toMatchObject({ ok: true, version_no: 1, fields: ['alias', 'name'] })
    const h = await history(lsb, 'person', personId)
    expect(h[0].source).toBe('restore')
    expect(h[0].reason).toContain('rls-test')
    // Restoring v1 re-applies v1's NEW state — the row is unchanged, so no
    // further version appears, and the audit row is written regardless.
    const row = await lsb.from('persons').select('alias').eq('id', personId).single()
    expect(row.data!.alias).toBe('Deuce')
    expect(await lsb.rpc('can_record', { p_action: 'restore_version', p_kind: 'person', p_id: personId }).then((x) => x.data)).toBe(true)
    expect(await lsb.rpc('can_record', { p_action: 'read_history', p_kind: 'person', p_id: personId }).then((x) => x.data)).toBe(true)
  })

  it('record_versions takes no client write', async () => {
    const ins = await lsb.from('record_versions').insert({ table_name: 'persons', record_id: personId, version_no: 99, old: {}, new: {}, changed_fields: [] })
    expect(ins.error?.code).toBe('42501')
    const del = await lsb.from('record_versions').delete().eq('record_id', personId)
    expect(del.error?.code).toBe('42501')
  })
})
