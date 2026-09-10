/** v1.91a — Confidential Informants, the compartment: the access model
 *  (migration 20261103120000_confidential_informants; scratch
 *  ci_contract.md §1–§3). Security cases 1–6, 13–21, 30–32, 35.
 *
 *  Canonical rule: **canAccessCI = hasFullCIAccess(user) || isAssignedHandler(user, ci)**.
 *  A caller who is not authorized gets NOTHING — null, zero rows — never a
 *  placeholder, a lock, a count or a "no permission" text.
 *
 *  What the CID fixtures prove (lsb — the MCB detective, handler A; bcb — the
 *  SCB detective, the NORMAL detective until they become handler B; lead —
 *  the MCB Bureau Lead, full access; director optional — the second
 *  full-access role; owner optional — audit_log reads; inactive optional —
 *  deny-by-default):
 *   · #1 bcb's `ci_context()` is exactly `{full_access:false, is_handler:false}`
 *     — no counts; #2 bcb reads zero rows on every one of the fourteen CI
 *     tables; #3 `ci_get` / `ci_person_status` / `ci_case_intel` answer null
 *     / zero rows; #4 the moment the lead designates CI A with lsb as primary,
 *     lsb reads exactly that CI (list, row, context 1 / 6) and bcb still
 *     nothing;
 *   · #5 the person stays a plain person: bcb reads the persons row by id,
 *     the row carries no CI column, and lsb's read of it is the same row;
 *   · #6 the full-access roles (the lead, the director) read the CI, its
 *     handlers and `ci_stats()`; `ci_stats()` is null for the handler;
 *   · #13 case access ≠ CI access: bcb can read the fixture JTF case and
 *     still `ci_case_intel(case)` → zero rows; #14 the handler's intelligence
 *     is inside the case for the handler and full access (`ci_case_intel`
 *     with ci_number / handler / corroboration); #15 no tab data for others —
 *     `ci_case_counts([case])` is empty for bcb and carries n > 0 for lsb;
 *   · #16 handler B: the lead designates CI B with bcb as primary → bcb reads
 *     exactly CI B, lsb exactly CI A, the lead both;
 *   · #17 no client write path: an INSERT into each of the fourteen tables
 *     and an UPDATE of the handler's own CI row are refused (42501, or zero
 *     rows for the UPDATE);
 *   · #18 demotion through `rls_test_reset_member`: the lead (made secondary
 *     handler of CI A first) is set to detective → `full_access` false,
 *     `is_handler` true, the roster shrinks to CI A, `ci_get(CI B)` null,
 *     `ci_stats()` null; #19 restored to bureau_lead the roster is back;
 *   · #20 `ci_set_status(retired)` by the lead frees lsb's capacity by
 *     derivation (`active_count` 0, `is_handler` still true) while the
 *     history stays restricted — bcb reads neither the row nor its audit;
 *     #21 the status change is full-only: lsb → P0403, bcb → P0403;
 *   · #30 a direct-id `ci_get` by bcb is null for CI A and for a random id
 *     alike; #31 CI audit lives in `ci_audit_events` (readable through the CI
 *     by its handler, invisible to bcb) and NEVER in `audit_log` (the Owner
 *     reads no CI entity there); #32 an unauthorized write and a write against
 *     an unknown id answer the same P0403 wording; #35 the inactive fixture
 *     reads nothing and `ci_context()` is the same `{false,false}`.
 *
 *  Fixtures: two persons and one JTF case inserted by lsb (`[rls-test] v191a
 *  <tag> …`), the CIs designated by the lead. `rls_test_cleanup` (spliced by
 *  20261103120000 before the reports anchor) sweeps `ci_events`,
 *  `ci_releases`, `case_intel_releases`, `ci_audit_events`,
 *  `ci_capacity_requests`, `ci_handler_capacity` and the fixtures' CIs
 *  (cascading handlers / intel / contacts) before the persons purge. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { signInWithRetry } from './auth'

const URL = process.env.RLS_TEST_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jhxuflzmqspidkvjckox.supabase.co'
const ANON = process.env.RLS_TEST_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const PW = {
  lsb: process.env.RLS_TEST_PASSWORD_LSB,
  bcb: process.env.RLS_TEST_PASSWORD_BCB,
  lead: process.env.RLS_TEST_PASSWORD_LEAD,
  director: process.env.RLS_TEST_PASSWORD_DIRECTOR,
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v191a] fixture passwords not set — suite skipped')
const hasDirector = !!PW.director
const hasOwner = !!PW.owner

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>
type ListRow = { id: string; ci_number: string; status: string; primary_handler_id: string | null; person_id: string }
const NO_CI = { full_access: false, is_handler: false }
/** The fourteen RPC-only tables (§2). */
const CI_TABLES = [
  'confidential_informants', 'ci_handlers', 'ci_handler_capacity', 'ci_capacity_requests', 'ci_intelligence', 'ci_intelligence_links',
  'ci_contacts', 'ci_assessments', 'ci_payments', 'ci_case_links', 'case_intel_releases', 'ci_releases', 'ci_audit_events', 'ci_events',
] as const

describe.skipIf(!enabled)('v1.91a — Confidential Informants: canAccessCI = full || handler, nothing for anyone else', () => {
  let lsb: C, bcb: C, lead: C, director: C | null = null, owner: C | null = null, inactive: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v191a ${tag}`
  let personA = ''     // CI A's person (lsb-created)
  let personB = ''     // CI B's person
  let caseId = ''      // lsb's JTF case — readable by bcb, the "case ≠ CI" leg
  let ciA = ''         // lsb primary
  let ciANumber = ''
  let ciB = ''         // bcb primary (created in the handler-B leg)
  let intelId = ''

  const ctx = async (c: C): Promise<Json> => {
    const r = await c.rpc('ci_context')
    expect(r.error, r.error?.message).toBeNull()
    return r.data as Json
  }
  const list = async (c: C, filters: Json = {}): Promise<ListRow[]> => {
    const r = await c.rpc('ci_list', { p_filters: filters })
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? []) as ListRow[]
  }
  const get = async (c: C, id: string): Promise<Json | null> => {
    const r = await c.rpc('ci_get', { p_ci: id })
    expect(r.error, r.error?.message).toBeNull()
    return (r.data ?? null) as Json | null
  }
  const rowsOf = async (c: C, table: string): Promise<Json[]> => {
    const r = await c.from(table).select('*').limit(50)
    expect(r.error, `${table}: ${r.error?.message}`).toBeNull()
    return (r.data ?? []) as Json[]
  }
  const jsonRpc = async (c: C, fn: string, args: Json): Promise<Json> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn}: ${r.error?.message}`).toBeNull()
    return r.data as Json
  }
  const expectP0403 = async (c: C, fn: string, args: Json): Promise<string> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn} should raise`).not.toBeNull()
    expect(r.error!.code, `${fn}: ${r.error!.message}`).toBe('P0403')
    return r.error!.message
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    if (PW.director) { director = mk(); ids.director = await signInWithRetry(director, 'rls-test-director@cidportal.test', PW.director) }
    if (PW.owner) { owner = mk(); ids.owner = await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
    if (PW.inactive) { inactive = mk(); ids.inactive = await signInWithRetry(inactive, 'rls-test-inactive@cidportal.test', PW.inactive) }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const pA = await lsb.from('persons').insert({ name: `${stamp} person A` }).select('id').single()
    if (pA.error) throw new Error(`person A: ${pA.error.message}`)
    personA = pA.data!.id
    const pB = await lsb.from('persons').insert({ name: `${stamp} person B` }).select('id').single()
    if (pB.error) throw new Error(`person B: ${pB.error.message}`)
    personB = pB.data!.id
    const c = await lsb.from('cases').insert({ case_number: `V191A-${tag}`, title: `${stamp} joint case`, bureau: 'JTF', lead_detective_id: ids.lsb }).select('id').single()
    if (c.error) throw new Error(`case: ${c.error.message}`)
    caseId = c.data!.id
    // The lead designates CI A with lsb as primary handler (the compartment's ordinary designation path).
    const created = await lead.rpc('ci_create', { p_person: personA, p_alias: `${tag}-A`, p_bureau: 'major_crimes', p_primary_handler: ids.lsb, p_status: 'active', p_motive_primary: 'money' })
    if (created.error) throw new Error(`ci_create A: ${created.error.message}`)
    const out = created.data as Json
    if (out.ok !== true) throw new Error(`ci_create A refused: ${JSON.stringify(out)}`)
    ciA = String(out.id); ciANumber = String(out.ci_number)
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    // Belt and braces: the lead is always restored to its baseline before the sweep.
    if (lead && ids.lead) await lsb.rpc('rls_test_reset_member', { p_target: ids.lead, p_role: 'bureau_lead', p_division: 'major_crimes', p_active: true })
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v191a] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, director, owner, inactive].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ #1–#4 the normal detective gets nothing; the handler gets exactly their CI ============ */

  it('#1 the normal detective\'s ci_context() is exactly {full_access:false, is_handler:false} — no counts, no error', async () => {
    expect(await ctx(bcb)).toEqual(NO_CI)
  })

  it('#2 the normal detective reads zero rows on every one of the fourteen CI tables', async () => {
    for (const t of CI_TABLES) expect(await rowsOf(bcb, t), t).toEqual([])
  })

  it('#3 ci_get / ci_person_status / ci_case_intel answer null / zero rows for the normal detective', async () => {
    expect(await get(bcb, ciA)).toBeNull()
    expect((await bcb.rpc('ci_person_status', { p_person: personA })).data ?? null).toBeNull()
    const intel = await bcb.rpc('ci_case_intel', { p_case: caseId })
    expect(intel.error, intel.error?.message).toBeNull()
    expect(intel.data ?? []).toEqual([])
    expect(await list(bcb)).toEqual([])
    // Self-recruitment is for a caller already inside the compartment: the normal detective's ci_create for CI A's
    // person and for a random id raise the same P0403 — ci_create is not a "is this person a source?" oracle.
    const live = await expectP0403(bcb, 'ci_create', { p_person: personA, p_bureau: 'street_crimes', p_primary_handler: ids.bcb })
    const rand = await expectP0403(bcb, 'ci_create', { p_person: randomUUID(), p_bureau: 'street_crimes', p_primary_handler: ids.bcb })
    expect(live).toBe(rand)
  })

  it('#4 immediate protection: the handler reads exactly the designated CI (list, row, context 1 / 6); the normal detective still nothing', async () => {
    const mine = await list(lsb)
    expect(mine.map((r) => r.id)).toEqual([ciA])
    expect(mine[0]).toMatchObject({ ci_number: ciANumber, status: 'active', primary_handler_id: ids.lsb, person_id: personA })
    const rows = await rowsOf(lsb, 'confidential_informants')
    expect(rows.map((r) => r.id)).toEqual([ciA])
    expect(await ctx(lsb)).toMatchObject({ full_access: false, is_handler: true, active_count: 1, capacity: 6 })
    const row = await get(lsb, ciA)
    expect(row).not.toBeNull()
    expect(row!.ci_number).toBe(ciANumber)
    expect((row!.handlers as Json[]).map((h) => h.user_id)).toEqual([ids.lsb])
    expect((await lsb.rpc('ci_person_status', { p_person: personA })).data).toMatchObject({ ci_id: ciA, ci_number: ciANumber, status: 'active' })
    expect(await rowsOf(bcb, 'confidential_informants')).toEqual([])
    expect(await ctx(bcb)).toEqual(NO_CI)
  })

  /* ============ #5 the person stays usable ============ */

  it('#5 the person is still a plain person: the normal detective reads the persons row, it carries no CI column, and the handler reads the same row', async () => {
    const forBcb = await bcb.from('persons').select('*').eq('id', personA).maybeSingle()
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data, 'the person is readable by any active member').toBeTruthy()
    expect(forBcb.data!.name).toBe(`${stamp} person A`)
    const keys = Object.keys(forBcb.data!)
    expect(keys.some((k) => /(^|_)ci(_|$)|informant/i.test(k)), `persons carries no CI column: ${keys.join(',')}`).toBe(false)
    expect(JSON.stringify(forBcb.data)).not.toContain(ciANumber)
    const forLsb = await lsb.from('persons').select('id, name').eq('id', personA).single()
    expect(forLsb.error, forLsb.error?.message).toBeNull()
    expect(forLsb.data).toEqual({ id: personA, name: `${stamp} person A` })
  })

  /* ============ #6 the full-access roles ============ */

  it('#6 the lead (full access) reads the CI, its handlers and ci_stats(); ci_stats() is null for the handler', async () => {
    const forLead = await list(lead)
    expect(forLead.some((r) => r.id === ciA)).toBe(true)
    const row = await get(lead, ciA)
    expect(row).not.toBeNull()
    expect((row!.handlers as Json[]).map((h) => h.user_id)).toEqual([ids.lsb])
    const stats = await jsonRpc(lead, 'ci_stats', {})
    expect(stats).not.toBeNull()
    expect(typeof stats.active).toBe('number')
    const me = (stats.handlers as Json[]).find((h) => h.user_id === ids.lsb)
    expect(me, 'the handler appears in the stats roster').toBeTruthy()
    expect(me).toMatchObject({ active_count: 1, capacity: 6 })
    expect((me!.ci_ids as string[])).toContain(ciA)
    expect(await ctx(lead)).toMatchObject({ full_access: true })
    const forHandler = await lsb.rpc('ci_stats')
    expect(forHandler.error, forHandler.error?.message).toBeNull()
    expect(forHandler.data ?? null).toBeNull()
  })

  it.skipIf(!hasDirector)('#6 the director (full access) reads the same CI and the stats', async () => {
    expect((await list(director!)).some((r) => r.id === ciA)).toBe(true)
    expect(await get(director!, ciA)).not.toBeNull()
    expect(await jsonRpc(director!, 'ci_stats', {})).not.toBeNull()
    expect(await ctx(director!)).toMatchObject({ full_access: true })
  })

  /* ============ #13–#15 case access ≠ CI access ============ */

  it('#13/#14 the handler files intelligence on a case both detectives can read: the intelligence is inside the case for the handler and the lead only', async () => {
    // bcb can read the JTF case (the case wall) — the precondition of the whole leg.
    const kase = await bcb.from('cases').select('id').eq('id', caseId).maybeSingle()
    expect(kase.error, kase.error?.message).toBeNull()
    expect(kase.data?.id, 'bcb reads the JTF case').toBe(caseId)
    const created = await jsonRpc(lsb, 'ci_intel_create', { p_ci: ciA, p_summary: `${stamp} shipment Friday`, p_case: caseId, p_reliability: 'moderate' })
    expect(created.ok, JSON.stringify(created)).toBe(true)
    intelId = String(created.id)
    const forLsb = await lsb.rpc('ci_case_intel', { p_case: caseId })
    expect(forLsb.error, forLsb.error?.message).toBeNull()
    const rows = (forLsb.data ?? []) as Json[]
    expect(rows.map((r) => r.id)).toContain(intelId)
    expect(rows.find((r) => r.id === intelId)).toMatchObject({ ci_number: ciANumber, handler_id: ids.lsb, corroboration: 'unverified', reliability: 'moderate', release_count: 0 })
    const forLead = await lead.rpc('ci_case_intel', { p_case: caseId })
    expect(forLead.error, forLead.error?.message).toBeNull()
    expect(((forLead.data ?? []) as Json[]).map((r) => r.id)).toContain(intelId)
    // The case link was created for the handler to see.
    const links = await rowsOf(lsb, 'ci_case_links')
    expect(links.some((l) => l.ci_id === ciA && l.case_id === caseId)).toBe(true)
    // Case access ≠ CI access.
    const forBcb = await bcb.rpc('ci_case_intel', { p_case: caseId })
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data ?? []).toEqual([])
    expect(await rowsOf(bcb, 'ci_intelligence')).toEqual([])
    expect(await rowsOf(bcb, 'ci_case_links')).toEqual([])
  })

  it('#15 no tab data for others: ci_case_counts([case]) is empty for the normal detective and carries n > 0 for the handler and the lead', async () => {
    const forBcb = await bcb.rpc('ci_case_counts', { p_cases: [caseId] })
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data ?? []).toEqual([])
    const forLsb = await lsb.rpc('ci_case_counts', { p_cases: [caseId, randomUUID()] })
    expect(forLsb.error, forLsb.error?.message).toBeNull()
    const rows = (forLsb.data ?? []) as { case_id: string; n: number }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].case_id).toBe(caseId)
    expect(rows[0].n).toBeGreaterThan(0)
    const forLead = await lead.rpc('ci_case_counts', { p_cases: [caseId] })
    expect(forLead.error, forLead.error?.message).toBeNull()
    expect(((forLead.data ?? []) as { n: number }[])[0]?.n).toBeGreaterThan(0)
  })

  /* ============ #16 handler B ============ */

  it('#16 the lead designates CI B with bcb as primary: bcb reads exactly CI B, lsb exactly CI A, the lead both', async () => {
    const created = await jsonRpc(lead, 'ci_create', { p_person: personB, p_alias: `${tag}-B`, p_bureau: 'street_crimes', p_primary_handler: ids.bcb, p_status: 'active' })
    expect(created.ok, JSON.stringify(created)).toBe(true)
    ciB = String(created.id)
    expect((await list(bcb)).map((r) => r.id)).toEqual([ciB])
    expect(await ctx(bcb)).toMatchObject({ full_access: false, is_handler: true, active_count: 1, capacity: 6 })
    expect(await get(bcb, ciA)).toBeNull()
    expect((await list(lsb)).map((r) => r.id)).toEqual([ciA])
    expect(await get(lsb, ciB)).toBeNull()
    expect((await list(lead)).map((r) => r.id).filter((id) => id === ciA || id === ciB).sort()).toEqual([ciA, ciB].sort())
    // The designated handler is told with an ids-only payload; the designating lead is not.
    const told = await bcb.from('notifications').select('type, payload').eq('type', 'ci_assigned').order('created_at', { ascending: false }).limit(5)
    expect(told.error, told.error?.message).toBeNull()
    const mine = (told.data ?? []).find((n) => (n.payload as Json)?.ci_id === ciB)
    expect(mine, 'ci_assigned to the new handler').toBeTruthy()
    for (const k of Object.keys(mine!.payload as Json)) expect(['ci_id', 'actor_id', 'actor_name']).toContain(k)
  })

  /* ============ #17 no client write path ============ */

  it('#17 every CI table refuses a client INSERT (42501); the handler\'s UPDATE of their own CI row matches nothing', async () => {
    const inserts: Record<string, Json> = {
      confidential_informants: { ci_number: `CI-${tag}`, person_id: personA, bureau: 'major_crimes' },
      ci_handlers: { ci_id: ciA, user_id: ids.bcb, role: 'secondary' },
      ci_handler_capacity: { user_id: ids.lsb, limit_override: 30, reason: stamp, approved_by: ids.lsb },
      ci_capacity_requests: { kind: 'capacity', requester_id: ids.lsb, current_count: 1, requested_capacity: 30, reason: stamp },
      ci_intelligence: { ci_id: ciA, handler_id: ids.lsb, summary: stamp },
      ci_intelligence_links: { intel_id: intelId, kind: 'person', target_id: personB },
      ci_contacts: { ci_id: ciA, handler_id: ids.lsb, occurred_at: new Date().toISOString(), method: 'phone', summary: stamp },
      ci_assessments: { ci_id: ciA },
      ci_payments: { ci_id: ciA, amount: 1, paid_at: new Date().toISOString().slice(0, 10), handler_id: ids.lsb, reason: stamp },
      ci_case_links: { ci_id: ciA, case_id: caseId },
      case_intel_releases: { case_id: caseId, title: stamp, body: stamp },
      ci_releases: { intel_id: intelId, ci_id: ciA, case_release_id: randomUUID() },
      ci_audit_events: { action: 'FORGED', entity: 'confidential_informants', ci_id: ciA },
      ci_events: { kind: 'forged', ci_id: ciA },
    }
    for (const t of CI_TABLES) {
      for (const [c, who] of [[lsb, 'lsb'], [bcb, 'bcb']] as const) {
        const r = await c.from(t).insert(inserts[t]).select('*')
        expect(r.error, `${who} INSERT ${t} must be refused`).not.toBeNull()
        expect(r.error!.code, `${who} INSERT ${t}: ${r.error!.message}`).toBe('42501')
      }
    }
    const upd = await lsb.from('confidential_informants').update({ alias: 'forged' }).eq('id', ciA).select('id')
    if (upd.error) expect(upd.error.code).toBe('42501')
    else expect(upd.data ?? []).toEqual([])
    const still = await get(lsb, ciA)
    expect(still!.alias).toBe(`${tag}-A`)
    const del = await lsb.from('ci_intelligence').delete().eq('id', intelId).select('id')
    if (del.error) expect(del.error.code).toBe('42501')
    else expect(del.data ?? []).toEqual([])
  })

  /* ============ #21 / #20 status is full-only; retiring keeps the history restricted ============ */

  it('#21 ci_set_status is full-only: the handler and the normal detective are refused with P0403; the lead needs a reason', async () => {
    await expectP0403(lsb, 'ci_set_status', { p_ci: ciA, p_status: 'retired', p_reason: `${stamp} done` })
    await expectP0403(bcb, 'ci_set_status', { p_ci: ciA, p_status: 'retired', p_reason: `${stamp} done` })
    const noReason = await jsonRpc(lead, 'ci_set_status', { p_ci: ciA, p_status: 'retired', p_reason: 'x' })
    expect(noReason.ok).toBe(false)
    expect((await get(lsb, ciA))!.status).toBe('active')
  })

  it('#20 the lead retires CI A: the handler\'s capacity is freed by derivation, the row and its audit stay restricted to the handler and full access', async () => {
    const out = await jsonRpc(lead, 'ci_set_status', { p_ci: ciA, p_status: 'retired', p_reason: `${stamp} source relocated` })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    const row = await get(lsb, ciA)
    expect(row).toMatchObject({ status: 'retired', status_reason: `${stamp} source relocated` })
    expect(await ctx(lsb)).toMatchObject({ full_access: false, is_handler: true, active_count: 0, capacity: 6 })
    expect((await list(lsb)).map((r) => r.status)).toEqual(['retired'])
    // History: the handler reads CI_STATUS_CHANGED through ci_audit_list; bcb reads nothing.
    const audit = await lsb.rpc('ci_audit_list', { p_ci: ciA })
    expect(audit.error, audit.error?.message).toBeNull()
    const actions = ((audit.data ?? []) as Json[]).map((a) => a.action)
    expect(actions).toContain('CI_STATUS_CHANGED')
    expect(actions).toContain('CI_CREATED')
    const changed = ((audit.data ?? []) as Json[]).find((a) => a.action === 'CI_STATUS_CHANGED')!
    expect(changed.detail).toMatchObject({ from: 'active', to: 'retired' })
    const forBcb = await bcb.rpc('ci_audit_list', { p_ci: ciA })
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data ?? []).toEqual([])
    expect(await get(bcb, ciA)).toBeNull()
    expect((await rowsOf(bcb, 'ci_audit_events')).filter((a) => a.ci_id === ciA)).toEqual([])
  })

  /* ============ #18 / #19 demotion ============ */

  it('#18/#19 a demoted Bureau Lead who also handles CI A keeps exactly CI A (full_access false, is_handler true) and gets the roster back on restore', async () => {
    const assigned = await jsonRpc(lead, 'ci_handler_set', { p_ci: ciA, p_user: ids.lead, p_role: 'secondary', p_reason: `${stamp} supervising` })
    expect(assigned.ok, JSON.stringify(assigned)).toBe(true)
    expect((await list(lead)).map((r) => r.id)).toEqual(expect.arrayContaining([ciA, ciB]))
    const demote = await lsb.rpc('rls_test_reset_member', { p_target: ids.lead, p_role: 'detective', p_division: 'major_crimes', p_active: true })
    expect(demote.error, demote.error?.message).toBeNull()
    try {
      expect(await ctx(lead)).toMatchObject({ full_access: false, is_handler: true })
      expect((await list(lead)).map((r) => r.id)).toEqual([ciA])
      expect(await get(lead, ciB)).toBeNull()
      expect((await rowsOf(lead, 'confidential_informants')).map((r) => r.id)).toEqual([ciA])
      const stats = await lead.rpc('ci_stats')
      expect(stats.error, stats.error?.message).toBeNull()
      expect(stats.data ?? null).toBeNull()
      // A former-full-access handler has no full-only authority left.
      await expectP0403(lead, 'ci_set_status', { p_ci: ciA, p_status: 'dormant', p_reason: `${stamp} demoted try` })
    } finally {
      const restore = await lsb.rpc('rls_test_reset_member', { p_target: ids.lead, p_role: 'bureau_lead', p_division: 'major_crimes', p_active: true })
      expect(restore.error, restore.error?.message).toBeNull()
    }
    expect(await ctx(lead)).toMatchObject({ full_access: true })
    expect((await list(lead)).map((r) => r.id)).toEqual(expect.arrayContaining([ciA, ciB]))
    const removed = await jsonRpc(lead, 'ci_handler_remove', { p_ci: ciA, p_user: ids.lead, p_reason: `${stamp} leg done` })
    expect(removed.ok, JSON.stringify(removed)).toBe(true)
  })

  /* ============ #30–#32 direct ids, audit, indistinguishable refusals ============ */

  it('#30 a direct-id ci_get by the normal detective is null for a real CI and for a random id alike; ci_search finds nothing', async () => {
    expect(await get(bcb, ciA)).toBeNull()
    expect(await get(bcb, randomUUID())).toBeNull()
    expect((await bcb.rpc('ci_person_status', { p_person: personA })).data ?? null).toBeNull()
    const search = await bcb.rpc('ci_search', { p_q: ciANumber })
    expect(search.error, search.error?.message).toBeNull()
    expect(search.data ?? []).toEqual([])
    const own = await lsb.rpc('ci_search', { p_q: ciANumber })
    expect(own.error, own.error?.message).toBeNull()
    expect(((own.data ?? []) as Json[]).map((r) => r.id)).toEqual([ciA])
  })

  it('#32 an unauthorized write and a write against an unknown id answer the same P0403 wording — existence is never confirmed', async () => {
    const real = await expectP0403(bcb, 'ci_contact_log', { p_ci: ciA, p_occurred_at: new Date().toISOString(), p_method: 'phone', p_summary: `${stamp} forged` })
    const fake = await expectP0403(bcb, 'ci_contact_log', { p_ci: randomUUID(), p_occurred_at: new Date().toISOString(), p_method: 'phone', p_summary: `${stamp} forged` })
    expect(real).toBe(fake)
    const realIntel = await expectP0403(bcb, 'ci_intel_create', { p_ci: ciA, p_summary: `${stamp} forged` })
    const fakeIntel = await expectP0403(bcb, 'ci_intel_create', { p_ci: randomUUID(), p_summary: `${stamp} forged` })
    expect(realIntel).toBe(fakeIntel)
    // The handler may update their own CI; a bureau change is full-only.
    const ok = await jsonRpc(lsb, 'ci_update', { p_ci: ciA, p_patch: { recruitment_notes: `${stamp} notes` } })
    expect(ok.ok, JSON.stringify(ok)).toBe(true)
    await expectP0403(lsb, 'ci_update', { p_ci: ciA, p_patch: { bureau: 'street_crimes' } })
    expect((await get(lsb, ciA))!.bureau).toBe('major_crimes')
  })

  it('#31 CI audit lives in ci_audit_events (the handler reads their CI\'s rows, the normal detective none) and never in audit_log', async () => {
    const own = await rowsOf(lsb, 'ci_audit_events')
    expect(own.filter((a) => a.ci_id === ciA).map((a) => a.action)).toEqual(expect.arrayContaining(['CI_CREATED', 'CI_HANDLER_ASSIGNED', 'CI_INTEL_CREATED', 'CI_STATUS_CHANGED', 'CI_UPDATED']))
    expect(own.some((a) => a.ci_id === ciB)).toBe(false)
    expect(await rowsOf(bcb, 'ci_audit_events').then((r) => r.filter((a) => a.ci_id === ciA))).toEqual([])
    // Immutable: no client UPDATE / DELETE.
    const first = own[0]
    const upd = await lsb.from('ci_audit_events').update({ action: 'FORGED' }).eq('id', first.id as number).select('id')
    if (upd.error) expect(['42501', 'P0403']).toContain(upd.error.code)
    else expect(upd.data ?? []).toEqual([])
    if (owner) {
      const log = await owner.from('audit_log').select('id, entity, action').or('entity.eq.confidential_informants,entity.like.ci\\_%').order('created_at', { ascending: false }).limit(20)
      expect(log.error, log.error?.message).toBeNull()
      expect(log.data ?? [], 'no CI entity ever reaches audit_log').toEqual([])
      const byAction = await owner.from('audit_log').select('id').like('action', 'CI\\_%').limit(5)
      expect(byAction.error, byAction.error?.message).toBeNull()
      expect(byAction.data ?? []).toEqual([])
    }
  })

  it.skipIf(!hasOwner)('#31 the Owner (full access) reads both CIs and the CI audit through the compartment, not through audit_log', async () => {
    expect((await list(owner!)).map((r) => r.id)).toEqual(expect.arrayContaining([ciA, ciB]))
    const audit = await owner!.rpc('ci_audit_list', { p_ci: ciA })
    expect(audit.error, audit.error?.message).toBeNull()
    expect(((audit.data ?? []) as Json[]).map((a) => a.action)).toContain('CI_CREATED')
  })

  /* ============ #35 deny-by-default ============ */

  it.skipIf(!PW.inactive)('#35 the inactive fixture reads nothing and its ci_context() is the same {false,false}', async () => {
    expect(await ctx(inactive!)).toEqual(NO_CI)
    expect(await list(inactive!)).toEqual([])
    expect(await get(inactive!, ciA)).toBeNull()
    for (const t of CI_TABLES) expect(await rowsOf(inactive!, t), t).toEqual([])
  })
})
