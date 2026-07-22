/** v1.55 — accounts expansion (Phase 4a), migration
 *  20260808220000_accounts_expansion.
 *
 *  Exercises the new account surface end-to-end against live RLS + triggers:
 *   - any active member creates an account and a suspected/probable ownership
 *     link; a NON-command member trying to set ownership_confidence='confirmed'
 *     is REJECTED by private.account_link_guard_confirm, while a command member
 *     (lead) CAN confirm (and the confirm-stamp fills confirmed_by/at);
 *   - a POLYMORPHIC non-person link (subject_kind='gang') is created carrying NO
 *     person_id, and the person_id mirror CHECK holds (a person link with no
 *     person_id, and a non-person link WITH a person_id, are both rejected);
 *   - account_merge by a non-command member is refused; by lead it tombstones the
 *     victim (lifecycle='merged', merged_into=survivor), repoints the links, and
 *     the victim stops surfacing in search_all;
 *   - an account_merge that would repoint a case_intel_links 'account' link under
 *     an ACTIVE hold is aborted at the hold chokepoint, and completes cleanly once
 *     the hold is lifted;
 *   - anon is denied throughout.
 *
 *  Fixtures (v153/v154 shape): lsb (active detective — creates accounts/links,
 *  the non-command actor), lead (LSB bureau_lead = command — confirms, merges,
 *  places/lifts holds), owner (teardown), anon (denied). Accounts/links are NOT
 *  swept by rls_test_cleanup, so teardown owner-deletes the accounts (cascading
 *  account_links + account_handles); the fixture case (and its case_intel_links)
 *  is swept by rls_test_cleanup. */

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
if (!enabled) console.warn('[rls:v155] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.55 — accounts expansion (live)', () => {
  let lsb: C, lead: C, owner: C, anon: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const handleTag = `v155_${tag.toLowerCase()}`
  let caseId = ''
  let personId = ''
  let gangId = ''
  let survivorId = ''
  let victimId = ''
  let holdId = ''

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

    // A case + a person + a gang to hang links on.
    const c = await lsb.from('cases').insert({ case_number: `V155-${tag}`, title: `[rls-test] v155 accounts case ${tag}`, bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(`case insert: ${c.error.message}`)
    caseId = c.data![0].id as string
    const pe = await lsb.from('persons').insert({ name: `[rls-test] v155 person ${tag}` }).select('id')
    if (pe.error) throw new Error(`person insert: ${pe.error.message}`)
    personId = pe.data![0].id as string
    const g = await lsb.from('gangs').insert({ name: `[rls-test] v155 gang ${tag}` }).select('id')
    if (g.error) throw new Error(`gang insert: ${g.error.message}`)
    gangId = g.data![0].id as string
  })

  afterAll(async () => {
    if (!owner) return
    if (holdId) {
      try { await lead.rpc('legal_hold_lift', { p_hold: holdId, p_reason: '[rls-test] v155 teardown lift' }) } catch { /* already lifted */ }
    }
    // Accounts are not swept by rls_test_cleanup — owner-delete them (cascades
    // account_links + account_handles). Order: survivor last is irrelevant, both
    // go. victim is a merged tombstone but still deletable by command/owner.
    for (const aid of [survivorId, victimId]) {
      if (aid) { try { await owner.from('accounts').delete().eq('id', aid) } catch { /* best effort */ } }
    }
    if (personId) { try { await owner.from('persons').delete().eq('id', personId) } catch { /* best effort */ } }
    if (gangId) { try { await owner.from('gangs').delete().eq('id', gangId) } catch { /* best effort */ } }
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lsb, lead, owner, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ================= create + confirm gate ================= */

  it('any active member creates an account and a suspected person link', async () => {
    const a = await lsb.from('accounts').insert({
      platform: 'Birdy', handle: `@${handleTag}_survivor`, display_name: `V155 Survivor ${tag}`,
      category: 'person', state: 'active',
    }).select('id,category,state,lifecycle,operator_unknown')
    expect(a.error, a.error?.message).toBeNull()
    survivorId = a.data![0].id as string
    expect(a.data![0]).toMatchObject({ category: 'person', state: 'active', lifecycle: 'active', operator_unknown: false })

    const link = await lsb.from('account_links').insert({
      account_id: survivorId, subject_kind: 'person', subject_id: personId, person_id: personId,
      ownership_confidence: 'probable',
    }).select('id,ownership_confidence,person_id,subject_kind,confirmed_by')
    expect(link.error, link.error?.message).toBeNull()
    expect(link.data![0]).toMatchObject({ ownership_confidence: 'probable', person_id: personId, subject_kind: 'person' })
    expect(link.data![0].confirmed_by).toBeNull()
  })

  it('a NON-command member cannot set ownership_confidence=confirmed (guard rejects)', async () => {
    // Try to confirm the existing probable link as plain detective.
    const up = await lsb.from('account_links').update({ ownership_confidence: 'confirmed' })
      .eq('account_id', survivorId).eq('subject_kind', 'person').eq('subject_id', personId).select('id')
    expect(up.error).not.toBeNull()
    expect(up.error!.message).toMatch(/command|bureau lead/i)
    const still = await lsb.from('account_links').select('ownership_confidence')
      .eq('account_id', survivorId).eq('subject_kind', 'person').eq('subject_id', personId).maybeSingle()
    expect(still.data?.ownership_confidence).toBe('probable')
  })

  it('a command member (lead) CAN confirm, and the stamp fills confirmed_by/at', async () => {
    const up = await lead.from('account_links').update({ ownership_confidence: 'confirmed' })
      .eq('account_id', survivorId).eq('subject_kind', 'person').eq('subject_id', personId)
      .select('ownership_confidence,confirmed_by,confirmed_at')
    expect(up.error, up.error?.message).toBeNull()
    expect(up.data![0]).toMatchObject({ ownership_confidence: 'confirmed', confirmed_by: ids.lead })
    expect(up.data![0].confirmed_at).not.toBeNull()
  })

  /* ================= polymorphic subject + mirror CHECK ================= */

  it('a polymorphic gang link carries no person_id, and the mirror CHECK holds', async () => {
    const gl = await lsb.from('account_links').insert({
      account_id: survivorId, subject_kind: 'gang', subject_id: gangId, ownership_confidence: 'suspected',
    }).select('id,subject_kind,person_id')
    expect(gl.error, gl.error?.message).toBeNull()
    expect(gl.data![0]).toMatchObject({ subject_kind: 'gang', person_id: null })

    // A person link WITHOUT person_id violates the mirror CHECK.
    const badPerson = await lsb.from('account_links').insert({
      account_id: survivorId, subject_kind: 'person', subject_id: personId,
    }).select('id')
    expect(badPerson.error).not.toBeNull()

    // A non-person link WITH a person_id violates the mirror CHECK too.
    const badGang = await lsb.from('account_links').insert({
      account_id: survivorId, subject_kind: 'gang', subject_id: gangId, person_id: personId,
    }).select('id')
    expect(badGang.error).not.toBeNull()
  })

  /* ================= merge: gate + tombstone + search + hold ================= */

  it('sets up a victim account, a duplicate link, and a case account-link', async () => {
    const a = await lsb.from('accounts').insert({
      platform: 'Birdy', handle: `@${handleTag}_victim`, display_name: `V155 Victim ${tag}`,
      summary: 'victim summary to fold', is_impersonation: true,
    }).select('id')
    expect(a.error, a.error?.message).toBeNull()
    victimId = a.data![0].id as string

    // Victim links to the SAME person (a duplicate the merge must collapse) and
    // to the gang (a distinct subject the merge must repoint).
    const dup = await lsb.from('account_links').insert({
      account_id: victimId, subject_kind: 'person', subject_id: personId, person_id: personId,
    }).select('id')
    expect(dup.error, dup.error?.message).toBeNull()

    // A case_intel_links 'account' link to the victim — the merge repoint target.
    const cil = await lsb.from('case_intel_links').insert({ case_id: caseId, kind: 'account', ref_id: victimId }).select('id')
    expect(cil.error, cil.error?.message).toBeNull()
  })

  it('account_merge by a non-command member is refused', async () => {
    const m = await lsb.rpc('account_merge', { p_survivor: survivorId, p_victims: [victimId], p_reason: '[rls-test] v155 nope' })
    expect(m.error).not.toBeNull()
    expect(m.error!.message).toMatch(/command|bureau lead/i)
    const still = await lsb.from('accounts').select('lifecycle').eq('id', victimId).maybeSingle()
    expect(still.data?.lifecycle).toBe('active')
  })

  it('account_merge under an ACTIVE hold aborts at the case_intel_links chokepoint', async () => {
    const place = await lead.rpc('legal_hold_place', { p_case: caseId, p_legal_request: null, p_reason: `[rls-test] v155 hold ${tag}` })
    expect(place.error, place.error?.message).toBeNull()
    holdId = (place.data as { id: string }).id

    const m = await lead.rpc('account_merge', { p_survivor: survivorId, p_victims: [victimId], p_reason: '[rls-test] v155 held merge' })
    expect(m.error).not.toBeNull()
    expect(m.error!.message).toMatch(/legal hold/i)
    // Victim survives, un-merged; its case link is intact.
    const still = await lead.from('accounts').select('lifecycle').eq('id', victimId).maybeSingle()
    expect(still.data?.lifecycle).toBe('active')
  })

  it('after the hold lifts, lead account_merge tombstones the victim and repoints links', async () => {
    const lift = await lead.rpc('legal_hold_lift', { p_hold: holdId, p_reason: '[rls-test] v155 released' })
    expect(lift.error, lift.error?.message).toBeNull()
    holdId = ''

    const m = await lead.rpc('account_merge', { p_survivor: survivorId, p_victims: [victimId], p_reason: '[rls-test] v155 merge' })
    expect(m.error, m.error?.message).toBeNull()

    // Victim is a tombstone pointing at the survivor.
    const v = await lead.from('accounts').select('lifecycle,merged_into,is_impersonation').eq('id', victimId).maybeSingle()
    expect(v.data).toMatchObject({ lifecycle: 'merged', merged_into: survivorId })

    // The descriptor was OR-folded onto the survivor.
    const s = await lead.from('accounts').select('is_impersonation').eq('id', survivorId).maybeSingle()
    expect(s.data?.is_impersonation).toBe(true)

    // The duplicate person link collapsed (survivor keeps exactly one person
    // link); the case_intel_links 'account' link now points at the survivor.
    const personLinks = await lead.from('account_links').select('id')
      .eq('account_id', survivorId).eq('subject_kind', 'person').eq('subject_id', personId)
    expect(personLinks.data ?? []).toHaveLength(1)
    const victimLinks = await lead.from('account_links').select('id').eq('account_id', victimId)
    expect(victimLinks.data ?? []).toHaveLength(0)
    const cil = await lead.from('case_intel_links').select('ref_id').eq('case_id', caseId).eq('kind', 'account')
    expect((cil.data ?? []).every((r: { ref_id: string }) => r.ref_id === survivorId)).toBe(true)
  })

  it('the merged victim no longer surfaces in search_all', async () => {
    const r = await lead.rpc('search_all', { q: `${handleTag}_victim` })
    expect(r.error, r.error?.message).toBeNull()
    const hits = (r.data ?? []).filter((row: { kind: string; id: string }) => row.kind === 'account' && row.id === victimId)
    expect(hits).toHaveLength(0)
    // The survivor still surfaces for its own handle.
    const rs = await lead.rpc('search_all', { q: `${handleTag}_survivor` })
    expect((rs.data ?? []).some((row: { kind: string; id: string }) => row.kind === 'account' && row.id === survivorId)).toBe(true)
  })

  /* ================= anon denial ================= */

  it('anon is denied throughout (read + write + rpc)', async () => {
    const read = await anon.from('accounts').select('id').eq('id', survivorId)
    expect(read.data ?? []).toHaveLength(0)
    const write = await anon.from('accounts').insert({ platform: 'Birdy', handle: `@${handleTag}_anon` }).select('id')
    expect(write.error).not.toBeNull()
    const rpc = await anon.rpc('account_merge', { p_survivor: survivorId, p_victims: [victimId], p_reason: 'x' })
    expect(rpc.error).not.toBeNull()
  })
})
