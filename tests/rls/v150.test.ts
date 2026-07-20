/** v1.50 — Account registry (spec D1, migration 20260807220000_accounts_registry).
 *
 *  Social-media / online accounts become first-class, person-linked CID intel
 *  entities. Three tables with registry-style RLS (mirroring persons):
 *   - accounts            sel/ins/upd = is_active, del = can_delete (command);
 *   - account_handles     SELECT-only (is_active) — TRIGGER-WRITTEN only, no
 *                         client write policy;
 *   - account_links       sel/ins/upd/del = is_active.
 *
 *  Two triggers carry the behavior:
 *   - accounts_track_handle (AFTER INSERT/UPDATE) appends the initial current
 *     handle, and on a normalized-handle rename flips the old current to false
 *     and inserts the new current row (one-current-per-account partial-unique);
 *   - account_links_stamp (BEFORE INSERT/UPDATE) stamps confirmed_by/at when a
 *     link first reaches 'confirmed' and clears them when it drops back below.
 *
 *  The GENERATED STORED handle_normalized = lower(btrim(handle)) is the
 *  case-insensitive match key (never written directly).
 *
 *  This suite proves, on a fixture person:
 *   - lsb (active detective) inserts an account (Birdy / 'TestHandle') → row
 *     readable, handle_normalized == 'testhandle', and a current account_handles
 *     row was auto-created by the trigger;
 *   - renaming the handle appends a new current handle row and flips the old one
 *     (exactly one current at all times);
 *   - lsb links the account to the person ('suspected') → readable, confirmed_at
 *     null; raising to 'confirmed' stamps confirmed_by/at; dropping to 'probable'
 *     clears them;
 *   - a duplicate (account_id, person_id) link is rejected (UNIQUE);
 *   - a duplicate (platform, external_id) account is rejected when external_id is
 *     set (partial-unique);
 *   - an INACTIVE member cannot select or insert accounts (is_active gating);
 *   - anon is denied; a direct client insert into account_handles is denied
 *     (no write policy — trigger-only).
 *
 *  Fixtures: lsb (active detective — read/write), owner (is_owner, oversight
 *  read), anon (denied), inactive (a NON-active member, to prove is_active
 *  gating). The person is created by lsb, tagged '[rls-test] v150'.
 *
 *  CLEANUP: accounts_del is command-gated (private.can_delete() = bureau_lead+).
 *  The `lead` fixture is a bureau_lead, so afterAll deletes the created accounts
 *  as `lead` — which cascades their trigger-written account_handles and their
 *  account_links — leaving no leaked rows. (account_links also cascade from the
 *  person purge in rls_test_cleanup; accounts themselves have no created_by-based
 *  branch there, which is why the explicit `lead` delete matters.)
 *
 *  NOTE: the migration is not yet applied to the live project, so against the
 *  current DB this suite fails on the missing accounts/account_handles/
 *  account_links tables — "written, needs migration applied", not a defect
 *  (same posture as v147/v148/v149 before their migrations landed). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
}
const enabled = !!(ANON && PW.lsb && PW.owner && PW.inactive && PW.lead)
if (!enabled) console.warn('[rls:v150] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.50 — account registry (live)', () => {
  let lsb: C, owner: C, inactive: C, anon: C, lead: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  let personId = ''
  // Every account id created, so afterAll can attempt to delete each (cascades
  // handles + links). See the CLEANUP CAVEAT — command gating means the delete
  // usually no-ops with the available fixtures.
  const accountIds: string[] = []

  beforeAll(async () => {
    lsb = mk(); owner = mk(); inactive = mk(); anon = mk(); lead = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
      [inactive, 'rls-test-inactive@cidportal.test', PW.inactive, 'inactive'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    // Best-effort pre-clean so a crashed prior run doesn't collide.
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }

    const p = await lsb.from('persons').insert({ name: `[rls-test] v150 subject ${tag}` }).select('id')
    if (p.error) throw new Error(`person insert failed: ${p.error.message}`)
    personId = p.data![0].id as string
  })

  afterAll(async () => {
    // accounts_del is can_delete() (command). `lead` is bureau_lead, so it can
    // delete the accounts regardless of who created them — this cascades their
    // handles + links, leaving no leaked rows.
    for (const id of accountIds) {
      const r = await lead.from('accounts').delete().eq('id', id)
      if (r.error) console.warn(`[rls:v150] could not delete account ${id}: ${r.error.message}`)
    }
    // Purges the person (+ cascades any remaining account_links via person_id FK).
    try { await lsb.rpc('rls_test_cleanup') } catch (e) { console.warn('[rls:v150] rls_test_cleanup failed:', (e as Error).message) }
    await Promise.all([lsb, owner, inactive, anon, lead].filter(Boolean).map((c) => c.auth.signOut()))
  })

  it('lsb inserts an account → readable, handle_normalized normalized, current handle row auto-created', async () => {
    const ins = await lsb.from('accounts')
      .insert({ platform: 'Birdy', handle: 'TestHandle', display_name: `Subject ${tag}` })
      .select('id,platform,handle,handle_normalized,restricted,created_by')
    expect(ins.error, ins.error?.message).toBeNull()
    const acct = ins.data![0]
    accountIds.push(acct.id as string)
    expect(acct).toMatchObject({ platform: 'Birdy', handle: 'TestHandle', restricted: false })
    // GENERATED STORED column: lower(btrim(handle)).
    expect(acct.handle_normalized).toBe('testhandle')

    // Trigger appended the initial current handle-history row.
    const hist = await lsb.from('account_handles')
      .select('handle,handle_normalized,is_current,source').eq('account_id', acct.id)
    expect(hist.error, hist.error?.message).toBeNull()
    expect(hist.data).toHaveLength(1)
    expect(hist.data![0]).toMatchObject({ handle: 'TestHandle', handle_normalized: 'testhandle', is_current: true, source: 'initial' })
  })

  it('renaming the handle appends a new current row and flips the old one (exactly one current)', async () => {
    const acctId = accountIds[0]
    const upd = await lsb.from('accounts').update({ handle: 'NewHandle' }).eq('id', acctId).select('handle_normalized')
    expect(upd.error, upd.error?.message).toBeNull()
    expect(upd.data![0].handle_normalized).toBe('newhandle')

    const all = await lsb.from('account_handles')
      .select('handle,is_current,source').eq('account_id', acctId).order('observed_at', { ascending: true })
    expect(all.error, all.error?.message).toBeNull()
    expect(all.data).toHaveLength(2)
    const current = all.data!.filter((h) => h.is_current)
    expect(current).toHaveLength(1)
    expect(current[0]).toMatchObject({ handle: 'NewHandle', source: 'renamed' })
    const old = all.data!.find((h) => h.handle === 'TestHandle')
    expect(old?.is_current).toBe(false)
  })

  it('lsb links the account to the person (suspected) → readable, confirmed_at null', async () => {
    const r = await lsb.from('account_links')
      .insert({ account_id: accountIds[0], person_id: personId, ownership_confidence: 'suspected', source: 'observed' })
      .select('id,ownership_confidence,confirmed_by,confirmed_at,created_by')
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data![0]).toMatchObject({ ownership_confidence: 'suspected', confirmed_by: null, confirmed_at: null })
  })

  it('raising a link to confirmed stamps confirmed_by/at (trigger); dropping to probable clears them', async () => {
    const conf = await lsb.from('account_links')
      .update({ ownership_confidence: 'confirmed' })
      .eq('account_id', accountIds[0]).eq('person_id', personId)
      .select('ownership_confidence,confirmed_by,confirmed_at')
    expect(conf.error, conf.error?.message).toBeNull()
    expect(conf.data![0].ownership_confidence).toBe('confirmed')
    expect(conf.data![0].confirmed_by).toBe(ids.lsb)
    expect(conf.data![0].confirmed_at).not.toBeNull()

    const drop = await lsb.from('account_links')
      .update({ ownership_confidence: 'probable' })
      .eq('account_id', accountIds[0]).eq('person_id', personId)
      .select('ownership_confidence,confirmed_by,confirmed_at')
    expect(drop.error, drop.error?.message).toBeNull()
    expect(drop.data![0]).toMatchObject({ ownership_confidence: 'probable', confirmed_by: null, confirmed_at: null })
  })

  it('a duplicate (account_id, person_id) link is rejected (UNIQUE)', async () => {
    const dup = await lsb.from('account_links')
      .insert({ account_id: accountIds[0], person_id: personId, ownership_confidence: 'suspected' }).select('id')
    expect(dup.error).not.toBeNull()
  })

  it('a duplicate (platform, external_id) account is rejected when external_id is set', async () => {
    const ext = `EXT-${tag}`
    const a = await lsb.from('accounts').insert({ platform: 'InstaPic', external_id: ext, handle: `first_${tag}` }).select('id')
    expect(a.error, a.error?.message).toBeNull()
    accountIds.push(a.data![0].id as string)

    const b = await lsb.from('accounts').insert({ platform: 'InstaPic', external_id: ext, handle: `second_${tag}` }).select('id')
    expect(b.error).not.toBeNull()
    if (!b.error && b.data?.[0]) accountIds.push(b.data[0].id as string) // shouldn't happen; guard cleanup
  })

  it('an INACTIVE member cannot select or insert accounts (is_active gating)', async () => {
    const read = await inactive.from('accounts').select('id').eq('id', accountIds[0])
    // RLS SELECT gates on is_active(); an inactive member sees zero rows.
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true)
    expect(read.data ?? []).toHaveLength(0)

    const write = await inactive.from('accounts').insert({ platform: 'Birdy', handle: `inactive_${tag}` }).select('id')
    expect(write.error).not.toBeNull()
  })

  it('anon is denied; a direct client insert into account_handles is denied (no write policy)', async () => {
    const read = await anon.from('accounts').select('id').eq('id', accountIds[0])
    expect(read.error !== null || (read.data ?? []).length === 0).toBe(true)
    expect(read.data ?? []).toHaveLength(0)

    // account_handles is trigger-written only — no INSERT policy, so even an
    // active member's direct write is denied.
    const direct = await lsb.from('account_handles')
      .insert({ account_id: accountIds[0], handle: 'direct-write', is_current: false }).select('id')
    expect(direct.error).not.toBeNull()
  })
})
