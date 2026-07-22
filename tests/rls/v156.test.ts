/** v1.56 — returned-record extraction (Phase 4b), migration
 *  20260808260000_returned_record_extraction.
 *
 *  Exercises the ingest surface end-to-end against live RLS + the definer RPC:
 *   - an active member creates a record_extractions row on their case (plain RLS
 *     insert) and adds facts via public.extraction_add_fact;
 *   - an 'account' fact find-or-creates the account (dedup by platform +
 *     normalized handle), routes an 'account' indicator, and — with an owner —
 *     auto-links a person ownership link at ownership_confidence='suspected'
 *     (asserted NOT 'confirmed'); a second identical account fact REUSES the same
 *     account + link (no duplicates);
 *   - a phone fact routes a 'phone' indicator, an email fact routes an 'email'
 *     indicator (the kind CHECK now admits 'email');
 *   - source_location is required — a blank one is rejected and writes nothing;
 *   - a member with NO case access (bcb, a different-bureau detective) cannot add
 *     facts to the extraction (the RPC's can_access_case gate fires);
 *   - the auto-link is 'suspected', and the guard means a non-command member
 *     could not have reached 'confirmed' by any path;
 *   - anon is denied (read + RPC).
 *
 *  Fixtures (v154/v155 shape): lsb (active LSB detective — creates the case /
 *  extraction / facts, the non-command actor), bcb (active BCB detective — the
 *  no-case-access actor), lead (LSB bureau_lead = command — confirm probe),
 *  owner (teardown), anon (denied). Accounts are NOT swept by rls_test_cleanup,
 *  so teardown owner-deletes the created account (cascading account_links) and
 *  the extraction (cascading its facts); persons are swept, and the fixture case
 *  (with its indicators + extraction + facts, all case-cascade) is swept by
 *  rls_test_cleanup. */

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
if (!enabled) console.warn('[rls:v156] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

describe.skipIf(!enabled)('v1.56 — returned-record extraction (live)', () => {
  let lsb: C, bcb: C, lead: C, owner: C, anon: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const handleTag = `v156_${tag.toLowerCase()}`
  let caseId = ''
  let personId = ''
  let extractionId = ''
  let accountId = ''

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); owner = mk(); anon = mk()
    for (const [client, email, pw, key] of [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead, 'lead'],
      [owner, 'rls-test-owner@cidportal.test', PW.owner, 'owner'],
    ] as const) {
      ids[key] = await signInWithRetry(client, email, pw!)
    }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    // An LSB case (bcb, a BCB detective, cannot access it) + a person to own.
    const c = await lsb.from('cases').insert({ case_number: `V156-${tag}`, title: `[rls-test] v156 extraction case ${tag}`, bureau: 'LSB' }).select('id')
    if (c.error) throw new Error(`case insert: ${c.error.message}`)
    caseId = c.data![0].id as string
    const pe = await lsb.from('persons').insert({ name: `[rls-test] v156 person ${tag}` }).select('id')
    if (pe.error) throw new Error(`person insert: ${pe.error.message}`)
    personId = pe.data![0].id as string
  })

  afterAll(async () => {
    if (!owner) return
    // Accounts are not swept by rls_test_cleanup — owner-delete the created one
    // (cascades account_links). The extraction (cascades its facts) and the case
    // are swept by rls_test_cleanup via the case-cascade, but delete the
    // extraction explicitly per the teardown contract; persons are swept too.
    if (extractionId) { try { await owner.from('record_extractions').delete().eq('id', extractionId) } catch { /* best effort */ } }
    if (accountId) { try { await owner.from('accounts').delete().eq('id', accountId) } catch { /* best effort */ } }
    if (personId) { try { await owner.from('persons').delete().eq('id', personId) } catch { /* best effort */ } }
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lsb, bcb, lead, owner, anon].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ================= extraction create (plain RLS insert) ================= */

  it('an active member creates a record_extractions row on their case', async () => {
    const e = await lsb.from('record_extractions').insert({
      case_id: caseId, source_label: `Birdy return ${tag}`, source_kind: 'manual',
      source_ref: `ret-${tag}`, notes: 'v156 fixture return',
    }).select('id,case_id,source_kind,created_by')
    expect(e.error, e.error?.message).toBeNull()
    extractionId = e.data![0].id as string
    expect(e.data![0]).toMatchObject({ case_id: caseId, source_kind: 'manual', created_by: ids.lsb })
  })

  it('an invalid source_kind is rejected by the CHECK', async () => {
    const bad = await lsb.from('record_extractions').insert({
      case_id: caseId, source_label: `bad ${tag}`, source_kind: 'telepathy',
    }).select('id')
    expect(bad.error).not.toBeNull()
  })

  /* ================= account fact: dedup + indicator + suspected link ======= */

  it('an account fact find-or-creates the account, routes an indicator, and auto-links at SUSPECTED', async () => {
    const r = await lsb.rpc('extraction_add_fact', {
      p_extraction: extractionId, p_fact_type: 'account', p_value: `@${handleTag}`,
      p_source_location: 'Return p.3 §Accounts', p_platform: 'Birdy', p_owner_person: personId,
    })
    expect(r.error, r.error?.message).toBeNull()
    const fact = r.data as {
      id: string; fact_type: string; source_location: string
      linked_indicator_id: string | null; linked_account_id: string | null; linked_link_id: string | null
    }
    expect(fact.fact_type).toBe('account')
    expect(fact.source_location).toBe('Return p.3 §Accounts')
    expect(fact.linked_indicator_id).not.toBeNull()
    expect(fact.linked_account_id).not.toBeNull()
    expect(fact.linked_link_id).not.toBeNull()
    accountId = fact.linked_account_id!

    // The account was created by the RPC with the normalized handle.
    const acc = await lsb.from('accounts').select('platform,handle,handle_normalized,lifecycle').eq('id', accountId).maybeSingle()
    expect(acc.data).toMatchObject({ platform: 'Birdy', lifecycle: 'active' })
    expect(acc.data?.handle_normalized).toBe(`@${handleTag}`.toLowerCase())

    // The identifier was routed to the Indicators registry with kind='account'.
    const ind = await lsb.from('indicators').select('kind,value,case_id').eq('id', fact.linked_indicator_id!).maybeSingle()
    expect(ind.data).toMatchObject({ kind: 'account', value: `@${handleTag}`, case_id: caseId })

    // The ownership link is SUSPECTED — never confirmed — and not stamped.
    const link = await lsb.from('account_links')
      .select('ownership_confidence,subject_kind,person_id,confirmed_by,confirmed_at').eq('id', fact.linked_link_id!).maybeSingle()
    expect(link.data).toMatchObject({ ownership_confidence: 'suspected', subject_kind: 'person', person_id: personId })
    expect(link.data?.ownership_confidence).not.toBe('confirmed')
    expect(link.data?.confirmed_by).toBeNull()
    expect(link.data?.confirmed_at).toBeNull()
  })

  it('a second identical account fact REUSES the same account + link (dedup)', async () => {
    const r = await lsb.rpc('extraction_add_fact', {
      p_extraction: extractionId, p_fact_type: 'account', p_value: `@${handleTag.toUpperCase()}`,
      p_source_location: 'Return p.4 §Accounts', p_platform: 'Birdy', p_owner_person: personId,
    })
    expect(r.error, r.error?.message).toBeNull()
    const fact = r.data as { linked_account_id: string | null; linked_link_id: string | null }
    // Same normalized handle → same account; same (account, person) → same link.
    expect(fact.linked_account_id).toBe(accountId)

    const links = await lsb.from('account_links').select('id')
      .eq('account_id', accountId).eq('subject_kind', 'person').eq('subject_id', personId)
    expect(links.data ?? []).toHaveLength(1)
    // Still exactly one Birdy account for this handle.
    const accs = await lsb.from('accounts').select('id').eq('platform', 'Birdy').eq('handle_normalized', `@${handleTag}`.toLowerCase())
    expect(accs.data ?? []).toHaveLength(1)
  })

  /* ================= phone / email identifier routing ================= */

  it('a phone fact routes a phone indicator and an email fact routes an email indicator', async () => {
    const ph = await lsb.rpc('extraction_add_fact', {
      p_extraction: extractionId, p_fact_type: 'phone', p_value: `555-${tag}`,
      p_source_location: 'Return p.1 §Subscriber',
    })
    expect(ph.error, ph.error?.message).toBeNull()
    const phFact = ph.data as { linked_indicator_id: string | null; linked_account_id: string | null }
    expect(phFact.linked_account_id).toBeNull()
    const phInd = await lsb.from('indicators').select('kind').eq('id', phFact.linked_indicator_id!).maybeSingle()
    expect(phInd.data?.kind).toBe('phone')

    const em = await lsb.rpc('extraction_add_fact', {
      p_extraction: extractionId, p_fact_type: 'email', p_value: `${handleTag}@example.test`,
      p_source_location: 'Return p.1 §Subscriber',
    })
    expect(em.error, em.error?.message).toBeNull()
    const emFact = em.data as { linked_indicator_id: string | null }
    const emInd = await lsb.from('indicators').select('kind,value').eq('id', emFact.linked_indicator_id!).maybeSingle()
    expect(emInd.data).toMatchObject({ kind: 'email', value: `${handleTag}@example.test` })
  })

  /* ================= guardrails: source_location + access ================= */

  it('a blank source_location is rejected and writes no fact', async () => {
    const before = await lsb.from('record_extraction_facts').select('id').eq('extraction_id', extractionId)
    const r = await lsb.rpc('extraction_add_fact', {
      p_extraction: extractionId, p_fact_type: 'other', p_value: 'orphan fact', p_source_location: '   ',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/source location/i)
    const after = await lsb.from('record_extraction_facts').select('id').eq('extraction_id', extractionId)
    expect((after.data ?? []).length).toBe((before.data ?? []).length)
  })

  it('a member with no case access cannot add facts to the extraction', async () => {
    // bcb is a BCB detective; the extraction is on an LSB case it cannot access.
    const seen = await bcb.from('record_extractions').select('id').eq('id', extractionId)
    expect(seen.data ?? []).toHaveLength(0)
    const r = await bcb.rpc('extraction_add_fact', {
      p_extraction: extractionId, p_fact_type: 'other', p_value: 'bcb intrusion',
      p_source_location: 'p.9',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.message).toMatch(/access/i)
  })

  it('the auto-link stays suspected and a non-command member cannot confirm it', async () => {
    // The Phase-4a guard blocks a non-command member from confirming — proving
    // the extraction path (which hard-codes suspected) could never have confirmed.
    const up = await lsb.from('account_links').update({ ownership_confidence: 'confirmed' })
      .eq('account_id', accountId).eq('subject_kind', 'person').eq('subject_id', personId).select('id')
    expect(up.error).not.toBeNull()
    expect(up.error!.message).toMatch(/command|bureau lead/i)
    const still = await lsb.from('account_links').select('ownership_confidence')
      .eq('account_id', accountId).eq('subject_kind', 'person').eq('subject_id', personId).maybeSingle()
    expect(still.data?.ownership_confidence).toBe('suspected')
  })

  /* ================= anon denial ================= */

  it('anon is denied (read + rpc)', async () => {
    const read = await anon.from('record_extractions').select('id').eq('id', extractionId)
    expect(read.data ?? []).toHaveLength(0)
    const rpc = await anon.rpc('extraction_add_fact', {
      p_extraction: extractionId, p_fact_type: 'other', p_value: 'x', p_source_location: 'y',
    })
    expect(rpc.error).not.toBeNull()
  })
})
