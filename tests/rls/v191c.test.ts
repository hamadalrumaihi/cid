/** v1.91c — Confidential Informants: the leak surfaces, export, sanitize /
 *  release and the case counts (migration
 *  20261103120000_confidential_informants; scratch ci_contract.md §2–§4).
 *  Security cases 22–29, 33, 34.
 *
 *  A CI relationship is discoverable ONLY through the compartment's own
 *  tables. Every shared surface the portal already has must answer as if the
 *  person were an ordinary person. What the CID fixtures prove (lsb — the MCB
 *  detective, the handler; bcb — the SCB detective, the normal detective who
 *  can READ the fixture JTF case; lead — the MCB Bureau Lead, full access):
 *   · #22 `search_all('CI-')` returns nothing that names the CI for anyone —
 *     the server search has no CI arm (the palette adds `ci_search` only for
 *     an involved caller), and `search_all(<ci number>)` is empty for bcb;
 *   · #23 `search_all(<person name>)` still finds the PERSON for bcb, and no
 *     hit — for bcb or for lsb — carries the CI number, the CI id or the word
 *     "informant";
 *   · #24 `entity_suggest('person', <name>)` finds the person and reveals no
 *     CI; #25 `entity_crossref('person', id)` carries no CI edge;
 *   · #26 `case_audit_feed(case)` carries no `confidential_informants` /
 *     `ci_%` entity for bcb, lsb or the lead — CI RPCs never write audit_log;
 *   · #27 bcb has no `ci_*` / `case_intel_released` notification; every
 *     `ci_*` payload written to lsb / the lead carries ids only; the registry
 *     (`src/lib/notificationTitles.json`) marks every `ci_*` kind
 *     `destination: 'portal'` in category `informants` — the Discord edge
 *     function never DMs them — while `case_intel_released` (names no CI) has
 *     no portal destination;
 *   · #28 `ci_events` is zero rows for bcb and ids-only rows for lsb (keys ⊆
 *     id / ci_id / user_id / kind / at); a client INSERT is 42501;
 *   · #29 `ci_export(ci)` answers the handler their own CI (audited
 *     `CI_EXPORTED`), null for bcb, and the roster (`p_ci` null) only for
 *     full access;
 *   · #33 `ci_release` is full-only (lsb → P0403); a body naming the CI
 *     number, the person or the alias → `{ok:false, code:'unsanitized',
 *     message:'The text names the source — remove the CI number, name, alias
 *     or handler.'}`; a clean release is readable by bcb through the case
 *     (`case_intel_releases` — title, body, handling; no CI column) while
 *     `ci_releases` stays zero rows for bcb and one row for lsb; the original
 *     `ci_intelligence` row is untouched; `release_count` 1 for the handler;
 *   · #34 `ci_case_counts([case, other])` shows only the permitted n: `[]` for
 *     bcb, `[{case, n}]` for lsb and the lead — never a row for a case
 *     without permitted intelligence.
 *
 *  Fixtures: one person and one JTF case inserted by lsb (`[rls-test] v191c
 *  <tag> …`), the CI designated by the lead with lsb as primary, one
 *  intelligence row filed by lsb on the case. `rls_test_cleanup` (spliced by
 *  20261103120000) sweeps the CI, the release pair, the audit and the shadow
 *  rows. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'
import titles from '../../src/lib/notificationTitles.json'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v191c] fixture passwords not set — suite skipped')

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>
type Registry = Record<string, { title: string; category: string; destination?: string }>
const UNSANITIZED = 'The text names the source — remove the CI number, name, alias or handler.'
const CI_KINDS = ['ci_assigned', 'ci_handler_changed', 'ci_handler_removed', 'ci_contact_overdue', 'ci_intel_added', 'ci_compromised', 'ci_capacity_request', 'ci_request_decided'] as const
const ID_KEYS = new Set(['ci_id', 'intel_id', 'request_id', 'case_id', 'release_id', 'actor_id', 'actor_name', 'detail'])

describe.skipIf(!enabled)('v1.91c — Confidential Informants: no leak through search, entities, the case feed, notifications, realtime; export, release, counts', () => {
  let lsb: C, bcb: C, lead: C
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v191c ${tag}`
  const personName = `${stamp} Source Person`
  const alias = `Harbor-${tag}`
  let personId = ''
  let caseId = ''
  let caseNumber = ''
  let ciId = ''
  let ciNumber = ''
  let intelId = ''
  let releaseId = ''

  const jsonRpc = async (c: C, fn: string, args: Json): Promise<Json> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn}: ${r.error?.message}`).toBeNull()
    return r.data as Json
  }
  const tableRpc = async (c: C, fn: string, args: Json): Promise<Json[]> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn}: ${r.error?.message}`).toBeNull()
    return (r.data ?? []) as Json[]
  }
  const expectP0403 = async (c: C, fn: string, args: Json) => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn} should raise`).not.toBeNull()
    expect(r.error!.code, `${fn}: ${r.error!.message}`).toBe('P0403')
  }
  /** Nothing in `v` names the CI — not its number, not its id. */
  const revealsNothing = (v: unknown, where: string) => {
    const s = JSON.stringify(v ?? null)
    expect(s.includes(ciNumber), `${where} names ${ciNumber}`).toBe(false)
    expect(s.includes(ciId), `${where} carries the CI id`).toBe(false)
    expect(/informant/i.test(s), `${where} says "informant"`).toBe(false)
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    // Sweeps notifications too, so the "none for bcb" leg is not masked by an older run.
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)
    const preB = await bcb.rpc('rls_test_cleanup')
    if (preB.error) throw new Error(`pre-run cleanup (bcb) failed: ${preB.error.message}`)

    const p = await lsb.from('persons').insert({ name: personName }).select('id').single()
    if (p.error) throw new Error(`person: ${p.error.message}`)
    personId = p.data!.id
    const c = await lsb.from('cases').insert({ case_number: `V191C-${tag}`, title: `${stamp} joint case`, bureau: 'JTF', lead_detective_id: ids.lsb }).select('id, case_number').single()
    if (c.error) throw new Error(`case: ${c.error.message}`)
    caseId = c.data!.id; caseNumber = c.data!.case_number
    const created = await lead.rpc('ci_create', { p_person: personId, p_alias: alias, p_bureau: 'major_crimes', p_primary_handler: ids.lsb, p_status: 'active' })
    if (created.error) throw new Error(`ci_create: ${created.error.message}`)
    const out = created.data as Json
    if (out.ok !== true) throw new Error(`ci_create refused: ${JSON.stringify(out)}`)
    ciId = String(out.id); ciNumber = String(out.ci_number)
    const intel = await lsb.rpc('ci_intel_create', { p_ci: ciId, p_summary: `${stamp} shipment Friday at the pier`, p_body: `${stamp} body`, p_case: caseId })
    if (intel.error) throw new Error(`ci_intel_create: ${intel.error.message}`)
    const io = intel.data as Json
    if (io.ok !== true) throw new Error(`ci_intel_create refused: ${JSON.stringify(io)}`)
    intelId = String(io.id)
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v191c] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead].map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ #22–#25 search and the entity layer ============ */

  it('#22 search_all("CI-") and search_all(<ci number>) name no CI for anyone; the server search has no CI arm', async () => {
    for (const [c, who] of [[bcb, 'bcb'], [lsb, 'lsb'], [lead, 'lead']] as const) {
      const hits = await tableRpc(c, 'search_all', { q: 'CI-' })
      revealsNothing(hits, `search_all('CI-') for ${who}`)
      expect(hits.some((h) => /^ci$|informant/i.test(String(h.kind))), `${who}: a CI kind in search_all`).toBe(false)
    }
    const exact = await tableRpc(bcb, 'search_all', { q: ciNumber })
    expect(exact).toEqual([])
  })

  it('#23 search_all(<person name>) still finds the PERSON for the normal detective, and no hit for anyone names the CI', async () => {
    const forBcb = await tableRpc(bcb, 'search_all', { q: personName })
    const person = forBcb.find((h) => h.kind === 'person' && h.id === personId)
    expect(person, 'the person is an ordinary search hit for bcb').toBeTruthy()
    revealsNothing(forBcb, 'search_all(person) for bcb')
    revealsNothing(await tableRpc(lsb, 'search_all', { q: personName }), 'search_all(person) for lsb')
    revealsNothing(await tableRpc(lead, 'search_all', { q: personName }), 'search_all(person) for the lead')
    // The alias is a CI attribute, not a person attribute: searching it finds nothing for bcb.
    expect(await tableRpc(bcb, 'search_all', { q: alias })).toEqual([])
  })

  it('#24 entity_suggest("person", <name>) finds the person and reveals no CI; #25 entity_crossref("person", id) carries no CI edge', async () => {
    for (const [c, who] of [[bcb, 'bcb'], [lsb, 'lsb']] as const) {
      const suggest = await tableRpc(c, 'entity_suggest', { p_kind: 'person', p_q: personName })
      expect(suggest.some((h) => h.id === personId), `${who}: the person is suggested`).toBe(true)
      revealsNothing(suggest, `entity_suggest for ${who}`)
      const crossref = await tableRpc(c, 'entity_crossref', { p_kind: 'person', p_id: personId })
      revealsNothing(crossref, `entity_crossref for ${who}`)
      expect(crossref.some((r) => /^ci|informant|confidential/i.test(`${r.kind ?? ''} ${r.table ?? ''} ${r.source ?? ''}`)), `${who}: a CI edge in entity_crossref`).toBe(false)
    }
    // Nor does the person dossier's own RPC answer anything for bcb.
    const status = await bcb.rpc('ci_person_status', { p_person: personId })
    expect(status.error, status.error?.message).toBeNull()
    expect(status.data ?? null).toBeNull()
  })

  /* ============ #26 the case feed ============ */

  it('#26 case_audit_feed(case) carries no confidential_informants / ci_% entity for anyone — CI RPCs never write audit_log', async () => {
    for (const [c, who] of [[bcb, 'bcb'], [lsb, 'lsb'], [lead, 'lead']] as const) {
      const feed = await tableRpc(c, 'case_audit_feed', { p_case: caseId })
      expect(feed.some((r) => String(r.entity) === 'confidential_informants' || /^ci_/.test(String(r.entity)) || /^CI_/.test(String(r.action))), `${who}: a CI row in the case feed`).toBe(false)
      revealsNothing(feed, `case_audit_feed for ${who}`)
    }
  })

  /* ============ #27 notifications + the registry ============ */

  it('#27 the normal detective has no ci_* / case_intel_released notification; every ci_* payload written carries ids only; the registry marks every ci_* kind portal-only (never a Discord DM)', async () => {
    const forBcb = await bcb.from('notifications').select('type').or(`type.in.(${CI_KINDS.join(',')}),type.eq.case_intel_released`)
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data ?? []).toEqual([])
    // lsb was told ci_assigned by the lead's designation; that payload is ids only.
    const forLsb = await lsb.from('notifications').select('type, payload').in('type', [...CI_KINDS]).order('created_at', { ascending: false }).limit(20)
    expect(forLsb.error, forLsb.error?.message).toBeNull()
    const assigned = (forLsb.data ?? []).find((n) => n.type === 'ci_assigned' && (n.payload as Json)?.ci_id === ciId)
    expect(assigned, 'ci_assigned to the handler').toBeTruthy()
    for (const n of forLsb.data ?? []) {
      for (const k of Object.keys((n.payload ?? {}) as Json)) expect(ID_KEYS.has(k), `${n.type} payload key ${k}`).toBe(true)
      revealsNothing({ ...(n.payload as Json), ci_id: undefined }, `${n.type} payload`)
    }
    // The registry: ci_* kinds are `informants`, destination portal; case_intel_released names no CI and may DM.
    const reg = titles as Registry
    for (const kind of CI_KINDS) {
      expect(reg[kind], `${kind} in the registry`).toBeTruthy()
      expect(reg[kind].category, kind).toBe('informants')
      expect(reg[kind].destination, `${kind} is portal-only`).toBe('portal')
      expect(/informant|source/i.test(reg[kind].title), `${kind} title is generic`).toBe(true)
      expect(/CI-\d/.test(reg[kind].title), `${kind} title names no CI number`).toBe(false)
    }
    expect(reg.case_intel_released).toMatchObject({ category: 'intel' })
    expect(reg.case_intel_released.destination).toBeUndefined()
    expect(Object.entries(reg).filter(([, v]) => v.category === 'informants').every(([, v]) => v.destination === 'portal'), 'the informants category is entirely portal-only').toBe(true)
  })

  /* ============ #28 realtime ============ */

  it('#28 ci_events is zero rows for the normal detective and ids-only rows for the handler; a client INSERT is 42501', async () => {
    const forBcb = await bcb.from('ci_events').select('*').limit(50)
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data ?? []).toEqual([])
    const forLsb = await lsb.from('ci_events').select('*').eq('ci_id', ciId).limit(50)
    expect(forLsb.error, forLsb.error?.message).toBeNull()
    expect((forLsb.data ?? []).length).toBeGreaterThan(0)
    expect((forLsb.data ?? []).map((e) => e.kind)).toEqual(expect.arrayContaining(['created', 'intel']))
    for (const e of forLsb.data ?? []) expect(Object.keys(e).sort()).toEqual(['at', 'ci_id', 'id', 'kind', 'user_id'])
    const forged = await bcb.from('ci_events').insert({ kind: 'forged', ci_id: ciId }).select('id')
    expect(forged.error).not.toBeNull()
    expect(forged.error!.code).toBe('42501')
  })

  /* ============ #29 export ============ */

  it('#29 ci_export answers the handler their own CI (audited CI_EXPORTED), null for the normal detective; the roster only for full access', async () => {
    const own = await lsb.rpc('ci_export', { p_ci: ciId })
    expect(own.error, own.error?.message).toBeNull()
    expect(own.data).not.toBeNull()
    expect(JSON.stringify(own.data)).toContain(ciNumber)
    const forBcb = await bcb.rpc('ci_export', { p_ci: ciId })
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data ?? null).toBeNull()
    const rosterForHandler = await lsb.rpc('ci_export', { p_ci: null, p_scope: 'roster' })
    expect(rosterForHandler.error, rosterForHandler.error?.message).toBeNull()
    expect(rosterForHandler.data ?? null).toBeNull()
    const roster = await lead.rpc('ci_export', { p_ci: null, p_scope: 'roster' })
    expect(roster.error, roster.error?.message).toBeNull()
    expect(roster.data).not.toBeNull()
    expect(JSON.stringify(roster.data)).toContain(ciNumber)
    const audit = await tableRpc(lsb, 'ci_audit_list', { p_ci: ciId })
    const exported = audit.filter((a) => a.action === 'CI_EXPORTED')
    expect(exported.length).toBeGreaterThanOrEqual(1)
    expect(exported.some((a) => a.actor_id === ids.lsb)).toBe(true)
    expect(await tableRpc(bcb, 'ci_audit_list', { p_ci: ciId })).toEqual([])
  })

  /* ============ #33 sanitize / release ============ */

  it('#33 ci_release is full-only; naming the CI number, the person or the alias is unsanitized; a clean release is visible to the case reader as case_intel_releases while ci_releases stays restricted', async () => {
    await expectP0403(lsb, 'ci_release', { p_intel: intelId, p_title: `${stamp} release`, p_body: 'A shipment arrives Friday at the pier.' })
    await expectP0403(bcb, 'ci_release', { p_intel: intelId, p_title: `${stamp} release`, p_body: 'A shipment arrives Friday at the pier.' })
    for (const body of [`Per ${ciNumber}, a shipment arrives Friday.`, `${personName} says a shipment arrives Friday.`, `${alias} reports a shipment Friday.`]) {
      const r = await jsonRpc(lead, 'ci_release', { p_intel: intelId, p_title: `${stamp} release`, p_body: body })
      expect(r, body).toEqual({ ok: false, code: 'unsanitized', message: UNSANITIZED })
    }
    const before = await bcb.from('case_intel_releases').select('id').eq('case_id', caseId)
    expect(before.error, before.error?.message).toBeNull()
    expect(before.data ?? []).toEqual([])
    const out = await jsonRpc(lead, 'ci_release', { p_intel: intelId, p_title: `${stamp} Shipment expected`, p_body: 'A shipment arrives Friday at the pier.', p_handling: 'law_enforcement_sensitive' })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    releaseId = String(out.id)
    // bcb reads the case → reads the sanitized release; the row has no CI column and names no CI.
    const forBcb = await bcb.from('case_intel_releases').select('*').eq('case_id', caseId)
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data).toHaveLength(1)
    expect(forBcb.data![0]).toMatchObject({ id: releaseId, case_id: caseId, title: `${stamp} Shipment expected`, body: 'A shipment arrives Friday at the pier.', handling: 'law_enforcement_sensitive', released_by: ids.lead, revoked_at: null })
    expect(Object.keys(forBcb.data![0]).some((k) => /(^|_)ci(_|$)|intel_id/.test(k)), 'case_intel_releases carries no CI / intel column').toBe(false)
    revealsNothing(forBcb.data, 'case_intel_releases for bcb')
    // The restricted link: zero rows for bcb, one for the handler and the lead.
    const linkBcb = await bcb.from('ci_releases').select('*')
    expect(linkBcb.error, linkBcb.error?.message).toBeNull()
    expect(linkBcb.data ?? []).toEqual([])
    const linkLsb = await lsb.from('ci_releases').select('intel_id, ci_id, case_release_id').eq('case_release_id', releaseId)
    expect(linkLsb.error, linkLsb.error?.message).toBeNull()
    expect(linkLsb.data).toEqual([{ intel_id: intelId, ci_id: ciId, case_release_id: releaseId }])
    // The original intelligence is untouched and still invisible to bcb; the handler sees release_count 1.
    const intelBcb = await bcb.from('ci_intelligence').select('id').eq('id', intelId)
    expect(intelBcb.error, intelBcb.error?.message).toBeNull()
    expect(intelBcb.data ?? []).toEqual([])
    const intelLsb = await lsb.from('ci_intelligence').select('id, summary, deleted_at').eq('id', intelId).single()
    expect(intelLsb.error, intelLsb.error?.message).toBeNull()
    expect(intelLsb.data).toMatchObject({ summary: `${stamp} shipment Friday at the pier`, deleted_at: null })
    const caseIntel = await tableRpc(lsb, 'ci_case_intel', { p_case: caseId })
    expect(caseIntel.find((r) => r.id === intelId)?.release_count).toBe(1)
    // Audit: CI_INTEL_RELEASED in the compartment; the case feed still carries no CI row.
    expect((await tableRpc(lsb, 'ci_audit_list', { p_ci: ciId })).some((a) => a.action === 'CI_INTEL_RELEASED')).toBe(true)
    const feed = await tableRpc(bcb, 'case_audit_feed', { p_case: caseId })
    revealsNothing(feed, 'case_audit_feed after the release')
    // Revoke is full-only; a revoked release disappears for the case reader and stays for full access.
    await expectP0403(lsb, 'ci_release_revoke', { p_release: releaseId, p_reason: `${stamp} revoke try` })
    const revoked = await jsonRpc(lead, 'ci_release_revoke', { p_release: releaseId, p_reason: `${stamp} superseded` })
    expect(revoked.ok, JSON.stringify(revoked)).toBe(true)
    const gone = await bcb.from('case_intel_releases').select('id').eq('id', releaseId)
    expect(gone.error, gone.error?.message).toBeNull()
    expect(gone.data ?? []).toEqual([])
    const kept = await lead.from('case_intel_releases').select('id, revoked_at').eq('id', releaseId).single()
    expect(kept.error, kept.error?.message).toBeNull()
    expect(kept.data!.revoked_at).toBeTruthy()
  })

  /* ============ #34 case counts ============ */

  it('#34 ci_case_counts shows only the permitted n — nothing for the normal detective, the case for the handler and the lead, never a row for a case without permitted intelligence', async () => {
    const other = await lsb.from('cases').insert({ case_number: `V191C2-${tag}`, title: `${stamp} empty case`, bureau: 'JTF', lead_detective_id: ids.lsb }).select('id').single()
    expect(other.error, other.error?.message).toBeNull()
    const forBcb = await tableRpc(bcb, 'ci_case_counts', { p_cases: [caseId, other.data!.id] })
    expect(forBcb).toEqual([])
    const forLsb = await tableRpc(lsb, 'ci_case_counts', { p_cases: [caseId, other.data!.id, randomUUID()] })
    expect(forLsb).toHaveLength(1)
    expect(forLsb[0].case_id).toBe(caseId)
    expect(Number(forLsb[0].n)).toBeGreaterThan(0)
    const forLead = await tableRpc(lead, 'ci_case_counts', { p_cases: [caseId, other.data!.id] })
    expect(forLead.map((r) => r.case_id)).toEqual([caseId])
    expect(Number(forLead[0].n)).toBe(Number(forLsb[0].n))
    // The case number is still the case's — nothing about the count names the CI.
    expect(caseNumber).toBe(`V191C-${tag}`)
    revealsNothing(forLsb, 'ci_case_counts')
  })
})
