/** v1.61 — search hardening (migration 20260808400000_search_hardening).
 *
 *  search_all was re-emitted with index-served `<%` fuzzy operators (threshold
 *  pinned to 0.3 via a function-level SET — the GUC default is 0.6), multi-word
 *  AND token matching, and an account-handle history surface. This suite proves
 *  the client-observable behavior live:
 *   - MULTI-WORD AND: a query whose tokens land in DIFFERENT columns of the
 *     same case (title + summary) now matches. The old logic provably missed
 *     this fixture (verified against the 20260808240000 body on a scratch
 *     PG16+pg_trgm): no single searched column contains the full query
 *     substring, and the old fuzzy arm only saw case_number||' '||title — the
 *     summary token never participated (word_similarity ≈ 0.24 < 0.3; the
 *     summary token deliberately carries a tag DISJOINT from the case number
 *     so no trigram leaks through the concat).
 *   - TYPO TOLERANCE: 'Mortnsen' finds the fixture person 'Mortensen …'
 *     (word_similarity ≈ 0.58, measured — above the pinned 0.3, but BELOW the
 *     0.6 GUC default, so this also proves the function-level threshold SET
 *     took; a hit at the default would need ≥ 0.6).
 *   - INVOKER PRESERVED (mirrors v114's cross-visibility assertions): the same
 *     multi-word query that hits for the LSB creator returns NO case hit for a
 *     BCB detective — search follows the caller's own case RLS.
 *   - MERGED EXCLUSION: after person_merge, the victim tombstone stays out of
 *     search while the survivor still surfaces.
 *   - HANDLE HISTORY: after a client rename (accounts_track_handle flips the
 *     old row to is_current=false), searching the FORMER handle finds the
 *     account with a 'formerly @…' sublabel; searching the current handle does
 *     not carry the marker; a term matching both old and new handles returns
 *     the account exactly ONCE (dedupe by construction).
 *
 *  Fixtures (v155 shape): lsb (active LSB detective — creates the case/persons/
 *  account), bcb (the cross-bureau stranger), lead (command — person_merge),
 *  owner (teardown of the account: accounts are NOT swept by rls_test_cleanup,
 *  so the owner deletes it explicitly — account_handles cascade). Persons and
 *  the case are swept by rls_test_cleanup (created_by = fixture). Fixture-name
 *  trigram hygiene: TWO independent run tags (tag/tag2) keep the searched
 *  tokens unique against live data while sharing no trigrams with each other —
 *  tag2 rides the summary token and the renamed handle, tag rides everything
 *  else — so the old-fuzzy-miss and no-history-marker assertions can't be
 *  polluted by tag self-similarity (word_similarity between two strings
 *  sharing a 6-char tag measures ≈ 0.33 > 0.3). */

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
if (!enabled) console.warn('[rls:v161] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient

interface SearchHit { kind: string; id: string; label: string; sublabel: string }
const hitsOf = (rows: unknown, kind: string): SearchHit[] =>
  ((rows ?? []) as SearchHit[]).filter((h) => h.kind === kind)

describe.skipIf(!enabled)('v1.61 — search hardening (live)', () => {
  let lsb: C, bcb: C, lead: C, owner: C
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const tagL = tag.toLowerCase()
  const tag2 = Math.random().toString(36).slice(2, 8)
  // Multi-word fixture: token 1 ('pier') lives in the TITLE, token 2
  // ('pilferage<tag2>') in the SUMMARY — no single column contains both, and
  // tag2 shares no trigrams with the case number's tag.
  const multiQuery = `pier pilferage${tag2}`
  // Handle-history fixture: single alphanumeric words (no underscores — `_` is
  // an ILIKE wildcard) with DISJOINT tags, so the old handle never
  // fuzzy-matches the renamed account's current fields (and vice versa).
  const oldHandle = `w${tagL}orig`
  const newHandle = `zz${tag2}new`
  let caseId = ''
  let typoPersonId = ''
  let survivorId = ''
  let victimId = ''
  let accountId = ''

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk(); owner = mk()
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

    const c = await lsb.from('cases').insert({
      case_number: `V161-${tag}`,
      title: '[rls-test] v161 pier case',
      summary: `Cargo pilferage${tag2} logged dockside`,
      bureau: 'LSB',
    }).select('id')
    if (c.error) throw new Error(`case insert: ${c.error.message}`)
    caseId = c.data![0].id as string

    const typo = await lsb.from('persons').insert({ name: `[rls-test] v161 Mortensen ${tag}` }).select('id')
    if (typo.error) throw new Error(`typo person insert: ${typo.error.message}`)
    typoPersonId = typo.data![0].id as string
    const sur = await lsb.from('persons').insert({ name: `[rls-test] v161 Corbeille ${tag}` }).select('id')
    if (sur.error) throw new Error(`survivor insert: ${sur.error.message}`)
    survivorId = sur.data![0].id as string
    const vic = await lsb.from('persons').insert({ name: `[rls-test] v161 Corbeille dup ${tag}` }).select('id')
    if (vic.error) throw new Error(`victim insert: ${vic.error.message}`)
    victimId = vic.data![0].id as string

    // Account + rename: the accounts_track_handle trigger seeds the initial
    // current handle row, then flips it to history on the normalized rename.
    // Handles are stored bare (no '@') — the search label/sublabel prepend it.
    const a = await lsb.from('accounts').insert({
      platform: 'Birdy', handle: oldHandle, display_name: `V161 Account ${tag}`,
    }).select('id')
    if (a.error) throw new Error(`account insert: ${a.error.message}`)
    accountId = a.data![0].id as string
    const ren = await lsb.from('accounts').update({ handle: newHandle }).eq('id', accountId).select('id')
    if (ren.error) throw new Error(`account rename: ${ren.error.message}`)
  })

  afterAll(async () => {
    // Accounts are not swept by rls_test_cleanup — owner-delete (cascades
    // account_handles); persons/case are fixture-created and swept.
    if (accountId && owner) { try { await owner.from('accounts').delete().eq('id', accountId) } catch { /* best effort */ } }
    try { await lsb.rpc('rls_test_cleanup') } catch { /* best effort */ }
    await Promise.all([lsb, bcb, lead, owner].filter(Boolean).map((c) => c.auth.signOut()))
  })

  /* ================= multi-word AND ================= */

  it('a multi-word query matches tokens across title AND summary (old logic missed it)', async () => {
    // Construction guard: the premise of the "old logic missed it" claim — no
    // single searched column contains the contiguous query substring.
    for (const col of [`V161-${tag}`, '[rls-test] v161 pier case', `Cargo pilferage${tag2} logged dockside`]) {
      expect(col.toLowerCase()).not.toContain(multiQuery)
    }
    const r = await lsb.rpc('search_all', { q: multiQuery })
    expect(r.error, r.error?.message).toBeNull()
    const hit = hitsOf(r.data, 'case').find((h) => h.id === caseId)
    expect(hit, 'both tokens matched, in different columns').toBeTruthy()
    expect(hit!.label).toContain(`V161-${tag}`)
  })

  it('single-token behavior is intact: each token alone still finds the case for its column', async () => {
    const bySummaryToken = await lsb.rpc('search_all', { q: `pilferage${tag2}` })
    expect(bySummaryToken.error, bySummaryToken.error?.message).toBeNull()
    expect(hitsOf(bySummaryToken.data, 'case').some((h) => h.id === caseId)).toBe(true)
    const byNumber = await lsb.rpc('search_all', { q: `V161-${tag}` })
    expect(byNumber.error, byNumber.error?.message).toBeNull()
    expect(hitsOf(byNumber.data, 'case').some((h) => h.id === caseId)).toBe(true)
  })

  /* ================= typo tolerance (operator + pinned threshold) ================= */

  it("a typo'd query still finds the fixture person (0.3 threshold survived the operator move)", async () => {
    // word_similarity('mortnsen', '… mortensen …') ≈ 0.58 (measured on
    // PG16+pg_trgm): above the pinned 0.3 but below the 0.6 GUC default — a
    // hit here proves the function-level SET is in effect, not just that `<%`
    // matches exact text.
    const r = await lsb.rpc('search_all', { q: 'Mortnsen' })
    expect(r.error, r.error?.message).toBeNull()
    expect(hitsOf(r.data, 'person').some((h) => h.id === typoPersonId)).toBe(true)
  })

  /* ================= INVOKER: cross-bureau invisibility (mirrors v114) ================= */

  it('the SAME multi-word query returns no case hit for the other bureau (INVOKER preserved)', async () => {
    const r = await bcb.rpc('search_all', { q: multiQuery })
    expect(r.error, r.error?.message).toBeNull()
    expect(hitsOf(r.data, 'case').some((h) => h.id === caseId)).toBe(false)
    // Positive control alongside the negative: the creator's hit in the test
    // above shows the empty result here is a visibility decision, not an
    // indexing gap (v114's sealed-search pattern).
  })

  /* ================= merged tombstones stay excluded ================= */

  it('a merged person stays out of search; the survivor still surfaces', async () => {
    const m = await lead.rpc('person_merge', { p_survivor: survivorId, p_victims: [victimId], p_reason: `[rls-test] v161 dedupe ${tag}` })
    expect(m.error, m.error?.message).toBeNull()
    const r = await lsb.rpc('search_all', { q: `Corbeille ${tag}` })
    expect(r.error, r.error?.message).toBeNull()
    const persons = hitsOf(r.data, 'person')
    expect(persons.some((h) => h.id === survivorId)).toBe(true)
    expect(persons.some((h) => h.id === victimId)).toBe(false)
  })

  /* ================= account-handle history ================= */

  it("searching the FORMER handle finds the account with a 'formerly @…' sublabel", async () => {
    const r = await lsb.rpc('search_all', { q: oldHandle })
    expect(r.error, r.error?.message).toBeNull()
    const rows = hitsOf(r.data, 'account').filter((h) => h.id === accountId)
    expect(rows, 'exactly one row for the account').toHaveLength(1)
    expect(rows[0].sublabel).toContain(`formerly @${oldHandle}`)
    expect(rows[0].label).toContain(`@${newHandle}`)
  })

  it('searching the CURRENT handle carries no history marker', async () => {
    const r = await lsb.rpc('search_all', { q: newHandle })
    expect(r.error, r.error?.message).toBeNull()
    const rows = hitsOf(r.data, 'account').filter((h) => h.id === accountId)
    expect(rows).toHaveLength(1)
    expect(rows[0].sublabel).not.toContain('formerly')
  })

  it('a term matching BOTH current fields and the history returns the account exactly once (dedupe)', async () => {
    // tagL is a substring of the FORMER handle and of the CURRENT
    // display_name — two independent match paths, one row.
    const r = await lsb.rpc('search_all', { q: tagL })
    expect(r.error, r.error?.message).toBeNull()
    expect(hitsOf(r.data, 'account').filter((h) => h.id === accountId)).toHaveLength(1)
  })
})
