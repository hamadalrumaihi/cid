/** v1.57 — MDT & FiveM bridge expansion (Phase 5), migration
 *  20260808280000_mdt_bridge_expansion.
 *
 *  Exercises the expanded MDT outbox end-to-end against live RLS + the definer
 *  RPCs, and proves the bridge surface is DORMANT for the app:
 *   - lsb proposes a person_bolo through the widened mdt_export_propose — the
 *     pre-Phase-5 surface is intact (defaults: patrol_visible=true, no
 *     account_id, no expires_at);
 *   - SELF-APPROVAL is prohibited: lead proposing then approving their OWN
 *     export is rejected (/proposer/) and the row stays proposed, while lead
 *     approving LSB's proposal succeeds (proposer ≠ approver);
 *   - an 'account' export is the CID-only lane: patrol_visible is FORCED false
 *     even when proposed with p_patrol_visible=true, it targets an accounts
 *     row, and a second live export on the same account is refused (the new
 *     partial-unique);
 *   - the target/CID-only discipline holds via the RPC (account without an
 *     account, account carrying a person, person kinds carrying an account,
 *     vehicle kinds without a vehicle — all rejected), and the lane cannot be
 *     flipped by a direct client write (no write policy → 0 rows), so with the
 *     mdt_exports_account_cid_only CHECK an account row can NEVER satisfy the
 *     feed predicate;
 *   - expires_at round-trips through propose (reminder only — nothing here
 *     auto-clears);
 *   - mdt_patrol_feed is DENIED to authenticated (permission denied for lead
 *     AND lsb) and to anon — the app cannot reach the bridge (the "in code but
 *     not active" guarantee). The feed's row membership is asserted
 *     INDIRECTLY from the mdt_exports rows (its WHERE clause is
 *     status='exported' AND patrol_visible AND kind<>'account'): the exported
 *     person_bolo satisfies it, the account export cannot. The grants are NOT
 *     weakened to make the feed callable from here — service_role is a
 *     server-side secret the RLS suite deliberately does not hold.
 *
 *  Fixtures (v155/v156 shape): lsb (active LSB detective — proposes), lead
 *  (LSB bureau_lead = command — approves/clears, and the self-approval probe),
 *  owner (teardown), anon (denied). CLEANUP: rls_test_cleanup does NOT sweep
 *  mdt_exports or accounts, but mdt_exports' person_id/account_id FKs are ON
 *  DELETE CASCADE — so teardown lead-clears every export (best effort, keeps
 *  the live-unique indexes clean mid-run) and owner-deletes the account
 *  (cascading its export) and the person (cascading the person-kind exports);
 *  persons created by fixtures are additionally swept by rls_test_cleanup. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
}
const enabled = !!(ANON && PW.lsb && PW.lead && PW.owner)
if (!enabled) console.warn('[rls:v157] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.57 — MDT & FiveM bridge expansion (live)', () => {
  let lsb: C, lead: C, owner: C, anon: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const handleTag = `v157_${tag.toLowerCase()}`
  let personId = ''
  let accountId = ''
  let personBoloId = ''
  let leadOwnId = ''
  let accountExportId = ''
  let personRecordId = ''
  const exportIds: string[] = []

  beforeAll(async () => {
    lsb = mk(); lead = mk(); owner = mk(); anon = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    // A person to target and an account for the CID-only lane.
    const pe = await lsb.from('persons').insert({ name: `[rls-test] v157 person ${tag}` }).select('id')
    if (pe.error) throw new Error(`person insert: ${pe.error.message}`)
    personId = pe.data![0].id as string
    const acc = await lsb.from('accounts').insert({
      platform: 'Birdy', handle: `@${handleTag}`, display_name: `V157 Account ${tag}`,
    }).select('id')
    if (acc.error) throw new Error(`account insert: ${acc.error.message}`)
    accountId = acc.data![0].id as string
  })

  afterAll(async () => {
    if (!owner) return
    // mdt_exports rows are NOT swept by rls_test_cleanup: clear each export
    // (lead, best effort — frees the live-unique indexes) and rely on the ON
    // DELETE CASCADE from the person/account parents for the rows themselves.
    for (const id of exportIds) {
      try { await lead.rpc('mdt_export_clear', { p_export: id, p_reason: '[rls-test] v157 teardown' }) } catch { /* already cleared */ }
    }
    // Accounts are not swept — owner-deletes the account (cascades its export).
    if (accountId) { try { await owner.from('accounts').delete().eq('id', accountId) } catch { /* best effort */ } }
    // The person cascade removes the person-kind exports; persons authored by
    // fixtures are also swept by rls_test_cleanup.
    if (personId) { try { await owner.from('persons').delete().eq('id', personId) } catch { /* best effort */ } }
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lsb, lead, owner, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ================= existing surface intact ================= */

  it('lsb proposes a person_bolo — pre-Phase-5 behavior intact, new defaults inert', async () => {
    const r = await lsb.rpc('mdt_export_propose', {
      p_kind: 'person_bolo', p_person: personId, p_vehicle: null,
      p_snapshot: `V157 Subject ${tag}`, p_risk: 'high', p_instructions: 'Do not approach.',
    })
    expect(r.error, r.error?.message).toBeNull()
    personBoloId = r.data!.id as string
    exportIds.push(personBoloId)
    expect(r.data).toMatchObject({
      kind: 'person_bolo', person_id: personId, vehicle_id: null, account_id: null,
      status: 'proposed', proposed_by: ids.lsb, patrol_visible: true, expires_at: null,
    })
  })

  /* ================= self-approval guard ================= */

  it('lead cannot approve their OWN proposal (proposer ≠ approver)', async () => {
    const own = await lead.rpc('mdt_export_propose', {
      p_kind: 'caution', p_person: personId, p_vehicle: null,
      p_snapshot: `V157 Lead-own caution ${tag}`,
    })
    expect(own.error, own.error?.message).toBeNull()
    leadOwnId = own.data!.id as string
    exportIds.push(leadOwnId)

    const selfApprove = await lead.rpc('mdt_export_approve', { p_export: leadOwnId })
    expect(selfApprove.error).not.toBeNull()
    expect(selfApprove.error!.message).toMatch(/proposer/i)
    const still = await lead.from('mdt_exports').select('status,exported_by').eq('id', leadOwnId).maybeSingle()
    expect(still.data).toMatchObject({ status: 'proposed', exported_by: null })
  })

  it("lead approves LSB's proposal (a different proposer) → exported", async () => {
    const r = await lead.rpc('mdt_export_approve', { p_export: personBoloId })
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data).toMatchObject({ status: 'exported', exported_by: ids.lead, patrol_visible: true })
    expect(r.data!.exported_at).not.toBeNull()
  })

  /* ================= the accounts CID-only lane ================= */

  it('an account export FORCES patrol_visible=false even when proposed visible', async () => {
    const r = await lsb.rpc('mdt_export_propose', {
      p_kind: 'account', p_person: null, p_vehicle: null, p_account: accountId,
      p_snapshot: `Birdy @${handleTag}`, p_patrol_visible: true,
      p_instructions: 'CID-only account watch.',
    })
    expect(r.error, r.error?.message).toBeNull()
    accountExportId = r.data!.id as string
    exportIds.push(accountExportId)
    // The lane switch was overridden server-side; the target is the account.
    expect(r.data).toMatchObject({
      kind: 'account', account_id: accountId, person_id: null, vehicle_id: null,
      patrol_visible: false, status: 'proposed',
    })
  })

  it('a second live export on the same account is refused (one live per account)', async () => {
    const dup = await lsb.rpc('mdt_export_propose', {
      p_kind: 'account', p_person: null, p_vehicle: null, p_account: accountId,
      p_snapshot: `Dup @${handleTag}`,
    })
    expect(dup.error).not.toBeNull()
    expect(dup.error!.message).toMatch(/already has a live MDT export/i)
  })

  /* ================= target + lane discipline via the RPC ================= */

  it('bad kind/target combos are rejected by the RPC', async () => {
    // account kind without an account.
    const noAccount = await lsb.rpc('mdt_export_propose', {
      p_kind: 'account', p_person: null, p_vehicle: null, p_snapshot: `No account ${tag}`,
    })
    expect(noAccount.error).not.toBeNull()
    expect(noAccount.error!.message).toMatch(/needs an account/i)

    // account kind carrying a person.
    const accPlusPerson = await lsb.rpc('mdt_export_propose', {
      p_kind: 'account', p_person: personId, p_vehicle: null, p_account: accountId,
      p_snapshot: `Mixed target ${tag}`,
    })
    expect(accPlusPerson.error).not.toBeNull()
    expect(accPlusPerson.error!.message).toMatch(/not a person or vehicle/i)

    // A person kind (person_record) carrying an account.
    const recPlusAccount = await lsb.rpc('mdt_export_propose', {
      p_kind: 'person_record', p_person: personId, p_vehicle: null, p_account: accountId,
      p_snapshot: `Mixed record ${tag}`,
    })
    expect(recPlusAccount.error).not.toBeNull()
    expect(recPlusAccount.error!.message).toMatch(/not an account/i)

    // A vehicle kind (vehicle_record) without a vehicle.
    const noVehicle = await lsb.rpc('mdt_export_propose', {
      p_kind: 'vehicle_record', p_person: null, p_vehicle: null, p_snapshot: `No vehicle ${tag}`,
    })
    expect(noVehicle.error).not.toBeNull()
    expect(noVehicle.error!.message).toMatch(/needs a vehicle/i)
  })

  it('the lane cannot be flipped by a direct client write (no write policy)', async () => {
    // Writes are RPC-only; with the mdt_exports_account_cid_only CHECK this
    // means an account export can NEVER become patrol-visible by any path.
    for (const client of [lsb, lead]) {
      const up = await client.from('mdt_exports').update({ patrol_visible: true })
        .eq('id', accountExportId).select('id')
      expect(up.error !== null || (up.data ?? []).length === 0).toBe(true)
    }
    const still = await lsb.from('mdt_exports').select('patrol_visible').eq('id', accountExportId).maybeSingle()
    expect(still.data?.patrol_visible).toBe(false)
  })

  /* ================= expiry reminder ================= */

  it('expires_at round-trips through propose (reminder only — nothing auto-clears)', async () => {
    const expiry = new Date(Date.now() + 7 * 86400_000).toISOString()
    const r = await lsb.rpc('mdt_export_propose', {
      p_kind: 'person_record', p_person: personId, p_vehicle: null,
      p_snapshot: `V157 Record ${tag}`, p_expires_at: expiry,
    })
    expect(r.error, r.error?.message).toBeNull()
    personRecordId = r.data!.id as string
    exportIds.push(personRecordId)
    expect(r.data!.expires_at).not.toBeNull()
    expect(Date.parse(r.data!.expires_at as string)).toBe(Date.parse(expiry))
    expect(r.data).toMatchObject({ kind: 'person_record', status: 'proposed' })
  })

  /* ================= the bridge is unreachable from the app ================= */

  it('mdt_patrol_feed is DENIED to authenticated members — command included', async () => {
    for (const client of [lead, lsb]) {
      const r = await client.rpc('mdt_patrol_feed')
      expect(r.error).not.toBeNull()
      expect(r.error!.message).toMatch(/permission denied/i)
    }
  })

  it('mdt_patrol_feed (and the outbox) are denied to anon', async () => {
    const feed = await anon.rpc('mdt_patrol_feed')
    expect(feed.error).not.toBeNull()
    const read = await anon.from('mdt_exports').select('id').eq('id', personBoloId)
    expect(read.data ?? []).toHaveLength(0)
    const rpc = await anon.rpc('mdt_export_propose', {
      p_kind: 'person_bolo', p_person: personId, p_vehicle: null, p_snapshot: 'anon probe',
    })
    expect(rpc.error).not.toBeNull()
  })

  /* ================= feed membership, asserted indirectly ================= */

  it('feed membership is decidable from the rows: the exported BOLO is in, the account is out', async () => {
    // The feed's WHERE clause is status='exported' AND patrol_visible AND
    // kind <> 'account'. We cannot (and must not) call it without the
    // service_role key, so assert the predicate against the rows themselves.
    const bolo = await lsb.from('mdt_exports')
      .select('status,patrol_visible,kind').eq('id', personBoloId).maybeSingle()
    expect(bolo.data).toMatchObject({ status: 'exported', patrol_visible: true, kind: 'person_bolo' })

    // The account export fails the predicate on BOTH lanes it could enter by:
    // patrol_visible is false (forced), and the CHECK + no-write-policy above
    // proved it can never become true.
    const acc = await lsb.from('mdt_exports')
      .select('status,patrol_visible,kind').eq('id', accountExportId).maybeSingle()
    expect(acc.data?.kind).toBe('account')
    expect(acc.data?.patrol_visible).toBe(false)
  })
})
