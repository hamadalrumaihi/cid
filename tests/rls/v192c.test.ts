/** v1.92c — Platform upgrade, external sources, the investigation graph,
 *  search authorization and THE CI PROOF across every new surface
 *  (migration 20261105120000_platform_upgrade; scratch upgrade_contract.md
 *  §0, §2.6–§2.9; the request's §19). Catalog test_id `v192c`.
 *
 *  What the CID fixtures prove (lsb — the MCB detective, the submitter; bcb —
 *  the SCB detective, THE PLAIN DETECTIVE of the CI proof — reads the JTF
 *  case, is neither a handler nor CI command; lead — the MCB Bureau Lead,
 *  full CI access, designates the source; owner optional — the Owner-only
 *  RPCs' positive path; inactive optional):
 *   · #1 `external_source_submit('https://example.org/…')` → `{ok, id,
 *     source_number SRC-000000, job_id}`: a `pending` row, a `source.fetch`
 *     job on the `crawler` queue; #2 every blocked class is `bad_url`
 *     (localhost, loopback, 10/8, 172.16/12, 192.168/16, link-local +
 *     169.254.169.254, CGNAT + 100.100.100.200, `metadata.google.internal`,
 *     `.internal`, `::1`, `file:`, `ftp:`, `data:`, `javascript:`,
 *     userinfo) — validation, never a raise, nothing inserted;
 *   · #3 a source pinned to the MCB case is invisible to the other bureau
 *     (zero rows, P0403 on verify / recrawl / update), a case-less source is
 *     visible to every active member; #4 `external_source_verify` sets
 *     status + reliability (bad values `bad_request`); #5
 *     `external_source_link` needs a visible target (a hidden case →
 *     refused, a kind `ci` → `bad_request`: the vocabulary has no such kind),
 *     the link reads for the submitter, `external_source_unlink` removes it;
 *     #6 versions are immutable and RPC-only (INSERT 42501; UPDATE /
 *     DELETE P0403 or nothing); #7 `external_source_search` is empty-safe;
 *   · #8 `graph_expand('person', P)` returns the root at depth 0, the
 *     person → case `involved_in` edge and the person → gang `member_of`
 *     edge, clamps depth (9 → ≤ 3) and limit, filters `p_kinds`, and
 *     refuses (or empties) the inactive fixture;
 *   · #9 THE CI PROOF: the lead designates person P (linked to the JTF case
 *     both detectives read) a confidential informant through the existing
 *     `ci_create`. As the plain detective: `graph_expand` from the person
 *     and from the case never returns a `ci` node kind, a `ci*` edge kind,
 *     or the CI number in any label; `document_search`, `external_source_search`
 *     and `hybrid_search` of the CI number return nothing; `search_authorize`
 *     with a forged `{kind:'ci'}` hit returns it stripped; `search_all` of
 *     the number has no hit and the person hit carries no CI text;
 *     `case_packet_request` on the case produces a snapshot whose text
 *     contains neither the CI number nor the CI id; `trash_list()` names no
 *     CI; `ci_get` is null. Then the lead retires the CI and every one of
 *     those answers is unchanged for the detective;
 *   · #10 the Owner-only RPCs: `system_health`, `feature_flag_set`,
 *     `crawler_policy_set`, `background_jobs_stats` → P0403 for the
 *     detective and the lead; the ten `feature_flags` rows read for every
 *     active member (a key is never written from the client); the Owner
 *     (optional) reads the health object and re-sets a flag to its current
 *     value (audited, nothing changed).
 *
 *  Fixtures: one JTF case and one MCB case by lsb (`[rls-test] v192c <tag>
 *  …`), one person + one gang by lsb, the person linked to the JTF case
 *  (`case_intel_links`) and to the gang (`persons.gang_id`), the sources by
 *  lsb; the CI designated by the lead with the lead as primary handler so
 *  neither detective is ever inside the compartment. `rls_test_cleanup`
 *  (spliced by 20261105120000 and 20261103120000) sweeps sources, links,
 *  jobs, the CI, the person, the gang and the cases. */

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
  owner: process.env.RLS_TEST_PASSWORD_OWNER,
  inactive: process.env.RLS_TEST_PASSWORD_INACTIVE,
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v192c] fixture passwords not set — suite skipped')
const hasOwner = !!PW.owner
const hasInactive = !!PW.inactive

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>
type GraphRow = { node_kind: string; node_id: string; label: string; sublabel: string | null; depth: number; edge_kind: string | null; from_kind: string | null; from_id: string | null; to_kind: string | null; to_id: string | null }
const SOURCE_NUMBER = /^SRC-\d{6}$/
const FLAG_KEYS = ['stirling_pdf', 'crawl4ai', 'document_processing', 'advanced_graph', 'meilisearch', 'semantic_search', 'evidence_sealing', 'openfga', 'advanced_editor', 'ai_assistant']
const BLOCKED_URLS = [
  'http://localhost/admin', 'http://127.0.0.1/', 'http://127.1/', 'http://10.0.0.8/', 'http://172.16.5.5/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/',
  'http://100.100.100.200/latest/', 'http://100.64.0.1/', 'http://0.0.0.0/', 'http://metadata.google.internal/computeMetadata/v1/', 'http://db.internal/', 'http://nas.local/',
  'http://[::1]/', 'http://[fe80::1]/', 'http://[fd00::1]/', 'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd', 'ftp://example.org/x', 'data:text/html,hi', 'javascript:alert(1)',
  'https://user:pw@example.org/', 'example.org/no-scheme',
]

describe.skipIf(!enabled)('v1.92c — sources, graph, search: SSRF classes refused, the graph is RLS-scoped, and a CI is invisible on every new surface', () => {
  let lsb: C, bcb: C, lead: C, owner: C | null = null, inactive: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v192c ${tag}`
  let jtfCase = ''      // readable by both detectives — the CI proof's case
  let mcbCase = ''      // lsb's own bureau — invisible to bcb
  let personId = ''     // the person who becomes the CI
  let gangId = ''
  let openSource = ''   // case-less — visible to every active member
  let openNumber = ''
  let mcbSource = ''    // pinned to the MCB case — invisible to bcb
  let ciId = ''
  let ciNumber = ''

  const jsonRpc = async (c: C, fn: string, args: Json): Promise<Json> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn}: ${r.error?.message}`).toBeNull()
    return r.data as Json
  }
  const listRpc = async <T = Json>(c: C, fn: string, args: Json): Promise<T[]> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn}: ${r.error?.message}`).toBeNull()
    return (r.data ?? []) as T[]
  }
  const expectP0403 = async (c: C, fn: string, args: Json): Promise<string> => {
    const r = await c.rpc(fn, args)
    expect(r.error, `${fn} should raise`).not.toBeNull()
    expect(r.error!.code, `${fn}: ${r.error!.message}`).toBe('P0403')
    return r.error!.message
  }
  const rowsOf = async (c: C, table: string, col: string, val: string): Promise<Json[]> => {
    const r = await c.from(table).select('*').eq(col, val).limit(50)
    expect(r.error, `${table}: ${r.error?.message}`).toBeNull()
    return (r.data ?? []) as Json[]
  }
  const graph = (c: C, kind: string, id: string, extra: Json = {}) => listRpc<GraphRow>(c, 'graph_expand', { p_kind: kind, p_id: id, ...extra })
  /** Every assertion of "nothing about the CI" for the plain detective, reused before and after retirement. */
  const assertNoCiFor = async (c: C, who: string) => {
    for (const rows of [await graph(c, 'person', personId, { p_depth: 3 }), await graph(c, 'case', jtfCase, { p_depth: 3 })]) {
      expect(rows.length, `${who}: the graph still answers`).toBeGreaterThan(0)
      const text = JSON.stringify(rows)
      expect(rows.some((r) => r.node_kind === 'ci' || /^ci(_|$)|informant/i.test(r.node_kind)), `${who}: no ci node kind`).toBe(false)
      expect(rows.some((r) => !!r.edge_kind && /(^|_)ci(_|$)|informant|handler|source_of_ci/i.test(r.edge_kind)), `${who}: no ci edge kind`).toBe(false)
      expect(text, `${who}: no CI number in the graph`).not.toContain(ciNumber)
      expect(text, `${who}: no CI id in the graph`).not.toContain(ciId)
    }
    for (const fn of ['document_search', 'external_source_search'] as const) {
      const hits = await listRpc(c, fn, { p_q: ciNumber })
      expect(hits, `${who}: ${fn}(${ciNumber})`).toEqual([])
    }
    expect(await listRpc(c, 'hybrid_search', { p_q: ciNumber }), `${who}: hybrid_search`).toEqual([])
    const authorized = await listRpc(c, 'search_authorize', { p_hits: [{ kind: 'ci', id: ciId, score: 1, highlight: ciNumber }, { kind: 'ci', id: randomUUID(), score: 1 }] })
    expect(authorized, `${who}: a forged ci hit is stripped`).toEqual([])
    const all = await listRpc<{ id: string; kind: string; label: string; sublabel: string }>(c, 'search_all', { q: ciNumber })
    expect(all.filter((h) => h.kind === 'ci' || h.label.includes(ciNumber) || (h.sublabel ?? '').includes(ciNumber)), `${who}: search_all(${ciNumber})`).toEqual([])
    const byName = await listRpc<{ id: string; kind: string; label: string; sublabel: string }>(c, 'search_all', { q: `${stamp} person` })
    const person = byName.find((h) => h.id === personId)
    if (person) expect(JSON.stringify(person), `${who}: the person hit carries no CI text`).not.toMatch(new RegExp(`${ciNumber}|informant`, 'i'))
    const packet = await jsonRpc(c, 'case_packet_request', { p_case: jtfCase, p_type: 'full' })
    expect(packet.ok, `${who}: ${JSON.stringify(packet)}`).toBe(true)
    const rows = await rowsOf(c, 'case_packets', 'id', String(packet.id))
    expect(rows).toHaveLength(1)
    const snapshot = JSON.stringify(rows[0].snapshot ?? {})
    expect(snapshot, `${who}: the packet snapshot names no CI number`).not.toContain(ciNumber)
    expect(snapshot, `${who}: the packet snapshot names no CI id`).not.toContain(ciId)
    expect(snapshot).not.toMatch(/informant/i)
    const trash = await listRpc<{ kind: string; label: string | null }>(c, 'trash_list', {})
    expect(trash.filter((t) => /^ci(_|$)/.test(t.kind) || (t.label ?? '').includes(ciNumber)), `${who}: trash_list names no CI`).toEqual([])
    const get = await c.rpc('ci_get', { p_ci: ciId })
    expect(get.error, `${who}: ci_get ${get.error?.message}`).toBeNull()
    expect(get.data ?? null, `${who}: ci_get is null`).toBeNull()
  }

  beforeAll(async () => {
    lsb = mk(); bcb = mk(); lead = mk()
    const logins: [C, string, string, string][] = [
      [lsb, 'rls-test-lsb@cidportal.test', PW.lsb!, 'lsb'],
      [bcb, 'rls-test-bcb@cidportal.test', PW.bcb!, 'bcb'],
      [lead, 'rls-test-lead@cidportal.test', PW.lead!, 'lead'],
    ]
    for (const [client, email, pw, key] of logins) ids[key] = await signInWithRetry(client, email, pw)
    if (PW.owner) { owner = mk(); ids.owner = await signInWithRetry(owner, 'rls-test-owner@cidportal.test', PW.owner) }
    if (PW.inactive) { inactive = mk(); ids.inactive = await signInWithRetry(inactive, 'rls-test-inactive@cidportal.test', PW.inactive) }
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c1 = await lsb.from('cases').insert({ case_number: `V192C-${tag}-J`, title: `${stamp} JTF case`, bureau: 'JTF', lead_detective_id: ids.lsb }).select('id').single()
    if (c1.error) throw new Error(`jtf case: ${c1.error.message}`)
    jtfCase = c1.data!.id
    const c2 = await lsb.from('cases').insert({ case_number: `V192C-${tag}`, title: `${stamp} MCB case`, bureau: 'major_crimes', lead_detective_id: ids.lsb }).select('id').single()
    if (c2.error) throw new Error(`mcb case: ${c2.error.message}`)
    mcbCase = c2.data!.id
    const g = await lsb.from('gangs').insert({ name: `${stamp} gang` }).select('id').single()
    if (g.error) throw new Error(`gang: ${g.error.message}`)
    gangId = g.data!.id
    const p = await lsb.from('persons').insert({ name: `${stamp} person`, gang_id: gangId }).select('id').single()
    if (p.error) throw new Error(`person: ${p.error.message}`)
    personId = p.data!.id
    const link = await lsb.from('case_intel_links').insert({ case_id: jtfCase, kind: 'person', ref_id: personId, role: 'suspect' }).select('id').single()
    if (link.error) throw new Error(`case_intel_link: ${link.error.message}`)
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    // The CI is swept by the compartment's splice; belt and braces: retire it first so nothing active outlives the run.
    if (ciId && lead) await lead.rpc('ci_set_status', { p_ci: ciId, p_status: 'retired', p_reason: `${stamp} suite teardown` })
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v192c] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, owner, inactive].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ #1–#2 submit and the SSRF wall ============ */

  it('#1 external_source_submit(https://example.org/…) → a numbered pending source and a source.fetch job', async () => {
    const out = await jsonRpc(lsb, 'external_source_submit', { p_url: `https://example.org/${tag}/article`, p_notes: `${stamp} open source` })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    openSource = String(out.id); openNumber = String(out.source_number)
    expect(openNumber).toMatch(SOURCE_NUMBER)
    const rows = await rowsOf(lsb, 'external_sources', 'id', openSource)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source_number: openNumber, domain: 'example.org', submitted_by: ids.lsb, case_id: null, verification_status: 'unverified', reliability: 'unknown', version_count: 0 })
    expect(['pending', 'fetching', 'ready', 'failed']).toContain(String(rows[0].status))
    const job = await lsb.from('background_jobs').select('queue, kind, subject_kind, subject_id, created_by').eq('id', String(out.job_id)).maybeSingle()
    expect(job.error, job.error?.message).toBeNull()
    expect(job.data).toMatchObject({ queue: 'crawler', kind: 'source.fetch', subject_kind: 'external_source', subject_id: openSource, created_by: ids.lsb })
    // A second source, pinned to the MCB case, for the isolation legs.
    const pinned = await jsonRpc(lsb, 'external_source_submit', { p_url: `https://example.org/${tag}/mcb-only`, p_case: mcbCase })
    expect(pinned.ok, JSON.stringify(pinned)).toBe(true)
    mcbSource = String(pinned.id)
    expect(Number(String(pinned.source_number).slice(4))).toBeGreaterThan(Number(openNumber.slice(4)))
    // A case the caller cannot read is a refusal.
    const foreignCase = await bcb.rpc('external_source_submit', { p_url: `https://example.org/${tag}/foreign`, p_case: mcbCase })
    if (foreignCase.error) expect(foreignCase.error.code).toBe('P0403')
    else expect((foreignCase.data as Json).ok).toBe(false)
  })

  it('#2 every blocked URL class is bad_url — validation, never a raise, nothing inserted', async () => {
    const before = (await lsb.from('external_sources').select('id', { count: 'exact', head: true }).eq('submitted_by', ids.lsb)).count ?? 0
    for (const url of BLOCKED_URLS) {
      const out = await jsonRpc(lsb, 'external_source_submit', { p_url: url })
      expect(out.ok, url).toBe(false)
      expect(String(out.code), `${url}: ${JSON.stringify(out)}`).toMatch(/^bad_(url|request)$/)
      expect(String(out.message).length).toBeGreaterThan(3)
    }
    const after = (await lsb.from('external_sources').select('id', { count: 'exact', head: true }).eq('submitted_by', ids.lsb)).count ?? 0
    expect(after).toBe(before)
    // Length above 2048 is refused too.
    expect((await jsonRpc(lsb, 'external_source_submit', { p_url: `https://example.org/${'a'.repeat(2100)}` })).ok).toBe(false)
  })

  /* ============ #3–#7 visibility, verify, link, versions, search ============ */

  it('#3 a source pinned to the MCB case is invisible to the other bureau; a case-less source is visible to every active member', async () => {
    expect(await rowsOf(bcb, 'external_sources', 'id', mcbSource)).toEqual([])
    expect((await rowsOf(bcb, 'external_sources', 'id', openSource)).length).toBe(1)
    expect((await rowsOf(lead, 'external_sources', 'id', mcbSource)).length).toBe(1)
    const hidden = await expectP0403(bcb, 'external_source_verify', { p_source: mcbSource, p_status: 'verified' })
    const random = await expectP0403(bcb, 'external_source_verify', { p_source: randomUUID(), p_status: 'verified' })
    expect(hidden).toBe(random)
    await expectP0403(bcb, 'external_source_recrawl', { p_source: mcbSource })
    await expectP0403(bcb, 'external_source_update', { p_source: mcbSource, p_patch: { analyst_notes: 'x' } })
    // An outsider cannot edit the open source either — the submitter or command may.
    await expectP0403(bcb, 'external_source_update', { p_source: openSource, p_patch: { analyst_notes: 'x' } })
    const mine = await jsonRpc(lsb, 'external_source_update', { p_source: openSource, p_patch: { analyst_notes: `${stamp} note`, classification: 'sensitive' } })
    expect(mine.ok, JSON.stringify(mine)).toBe(true)
    expect((await rowsOf(lsb, 'external_sources', 'id', openSource))[0]).toMatchObject({ analyst_notes: `${stamp} note`, classification: 'sensitive' })
    // Moving it onto a case the caller cannot read is refused.
    const move = await bcb.rpc('external_source_update', { p_source: openSource, p_patch: { case_id: mcbCase } })
    if (move.error) expect(move.error.code).toBe('P0403')
    else expect((move.data as Json).ok).toBe(false)
  })

  it('#4 external_source_verify sets status + reliability and audits; bad values are bad_request', async () => {
    expect(await jsonRpc(lsb, 'external_source_verify', { p_source: openSource, p_status: 'gospel' })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(await jsonRpc(lsb, 'external_source_verify', { p_source: openSource, p_status: 'verified', p_reliability: 'trust-me' })).toMatchObject({ ok: false, code: 'bad_request' })
    const out = await jsonRpc(lsb, 'external_source_verify', { p_source: openSource, p_status: 'verified', p_reliability: 'reliable', p_notes: `${stamp} checked` })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    const row = (await rowsOf(lsb, 'external_sources', 'id', openSource))[0]
    expect(row).toMatchObject({ verification_status: 'verified', reliability: 'reliable', verified_by: ids.lsb })
    expect(row.verified_at).toBeTruthy()
  })

  it('#5 external_source_link needs a visible target; kind ci is bad_request; the link reads and unlinks', async () => {
    // A hidden case as the target — refused, not linked.
    const hidden = await bcb.rpc('external_source_link', { p_source: openSource, p_kind: 'case', p_ref: mcbCase })
    if (hidden.error) expect(hidden.error.code).toBe('P0403')
    else expect((hidden.data as Json).ok).toBe(false)
    const unknown = await jsonRpc(lsb, 'external_source_link', { p_source: openSource, p_kind: 'person', p_ref: randomUUID() })
    expect(unknown.ok).toBe(false)
    const ci = await jsonRpc(lsb, 'external_source_link', { p_source: openSource, p_kind: 'ci', p_ref: randomUUID() })
    expect(ci).toMatchObject({ ok: false })
    expect(String(ci.code)).toMatch(/^bad_/)
    const out = await jsonRpc(lsb, 'external_source_link', { p_source: openSource, p_kind: 'person', p_ref: personId, p_note: `${stamp} names the subject` })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    const linkId = String(out.id)
    const links = await rowsOf(lsb, 'external_source_links', 'source_id', openSource)
    expect(links.map((l) => l.id)).toContain(linkId)
    expect(links.find((l) => l.id === linkId)).toMatchObject({ kind: 'person', ref_id: personId, created_by: ids.lsb })
    // The same link twice is idempotent (the unique key), never a raise.
    const again = await jsonRpc(lsb, 'external_source_link', { p_source: openSource, p_kind: 'person', p_ref: personId })
    expect(again.ok).toBe(true)
    expect((await rowsOf(lsb, 'external_source_links', 'source_id', openSource)).filter((l) => l.kind === 'person' && l.ref_id === personId)).toHaveLength(1)
    // A link to the JTF case — visible to bcb through both walls.
    const caseLink = await jsonRpc(lsb, 'external_source_link', { p_source: openSource, p_kind: 'case', p_ref: jtfCase })
    expect(caseLink.ok).toBe(true)
    expect((await rowsOf(bcb, 'external_source_links', 'source_id', openSource)).map((l) => l.kind).sort()).toEqual(['case', 'person'])
    // Direct writes are refused; unlink is the RPC.
    const ins = await lsb.from('external_source_links').insert({ source_id: openSource, kind: 'gang', ref_id: gangId }).select('id')
    expect(ins.error, 'INSERT must be refused').not.toBeNull()
    expect(ins.error!.code).toBe('42501')
    await expectP0403(bcb, 'external_source_unlink', { p_link: linkId })
    const gone = await jsonRpc(lsb, 'external_source_unlink', { p_link: linkId })
    expect(gone.ok, JSON.stringify(gone)).toBe(true)
    expect((await rowsOf(lsb, 'external_source_links', 'source_id', openSource)).map((l) => l.id)).not.toContain(linkId)
  })

  it('#6 external_source_versions are immutable and RPC-only', async () => {
    const ins = await lsb.from('external_source_versions').insert({ source_id: openSource, version_no: 99, retrieved_at: new Date().toISOString(), content_hash: `\\x${'a'.repeat(64)}`, title: 'forged' }).select('id')
    expect(ins.error, 'INSERT must be refused').not.toBeNull()
    expect(ins.error!.code, ins.error!.message).toBe('42501')
    const upd = await lsb.from('external_source_versions').update({ title: 'forged' }).eq('source_id', openSource).select('id')
    if (upd.error) expect(['P0403', '42501']).toContain(upd.error.code)
    else expect(upd.data ?? []).toEqual([])
    const del = await lsb.from('external_source_versions').delete().eq('source_id', openSource).select('id')
    if (del.error) expect(['P0403', '42501']).toContain(del.error.code)
    else expect(del.data ?? []).toEqual([])
    // The source row itself never takes a direct write either.
    const src = await lsb.from('external_sources').update({ verification_status: 'rejected' }).eq('id', openSource).select('id')
    if (src.error) expect(['P0403', '42501']).toContain(src.error.code)
    else expect(src.data ?? []).toEqual([])
    expect((await rowsOf(lsb, 'external_sources', 'id', openSource))[0].verification_status).toBe('verified')
    // Versions of the MCB source (if the runner fetched any) are invisible to bcb.
    expect(await rowsOf(bcb, 'external_source_versions', 'source_id', mcbSource)).toEqual([])
  })

  it('#7 external_source_search is INVOKER and empty-safe', async () => {
    for (const [c, who] of [[lsb, 'lsb'], [bcb, 'bcb']] as const) {
      const hits = await listRpc(c, 'external_source_search', { p_q: `zzqx-${tag}-nothing`, p_limit: 10 })
      expect(hits, who).toEqual([])
    }
    const crawler = await lsb.from('crawler_policy').select('id, max_pages, max_depth').limit(1)
    // The policy singleton may or may not be client-readable — either way it is never client-writable.
    if (!crawler.error) {
      const upd = await lsb.from('crawler_policy').update({ max_pages: 999 }).eq('id', 1).select('id')
      if (upd.error) expect(['P0403', '42501']).toContain(upd.error.code)
      else expect(upd.data ?? []).toEqual([])
    }
  })

  /* ============ #8 the graph ============ */

  it('#8 graph_expand from the person: the root at depth 0, the case edge and the gang edge; depth and limit clamp; kinds filter; inactive refused', async () => {
    const rows = await graph(bcb, 'person', personId)
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows[0]).toMatchObject({ node_kind: 'person', node_id: personId, depth: 0 })
    expect(rows[0].label).toBe(`${stamp} person`)
    const caseEdge = rows.find((r) => r.node_kind === 'case' && r.node_id === jtfCase)
    expect(caseEdge, 'person → case').toBeTruthy()
    expect(caseEdge!.depth).toBe(1)
    expect(['involved_in', 'suspect_in']).toContain(caseEdge!.edge_kind)
    const gangEdge = rows.find((r) => r.node_kind === 'gang' && r.node_id === gangId)
    expect(gangEdge, 'person → gang').toBeTruthy()
    expect(gangEdge!.edge_kind).toBe('member_of')
    // Clamps: depth 9 → no row deeper than 3; limit 100000 → ≤ 500 rows.
    const deep = await graph(bcb, 'person', personId, { p_depth: 9, p_limit: 100_000 })
    expect(Math.max(...deep.map((r) => r.depth))).toBeLessThanOrEqual(3)
    expect(deep.length).toBeLessThanOrEqual(500)
    // p_kinds filters the neighbours, never the root.
    const onlyGangs = await graph(bcb, 'person', personId, { p_kinds: ['gang'] })
    expect(onlyGangs[0].node_id).toBe(personId)
    expect(onlyGangs.slice(1).every((r) => r.node_kind === 'gang')).toBe(true)
    // The MCB case is not in bcb's graph; it is in lsb's (rooted at the case).
    expect(rows.some((r) => r.node_id === mcbCase)).toBe(false)
    const fromCase = await graph(lsb, 'case', jtfCase)
    expect(fromCase[0]).toMatchObject({ node_kind: 'case', node_id: jtfCase, depth: 0 })
    expect(fromCase.some((r) => r.node_kind === 'person' && r.node_id === personId)).toBe(true)
    // A root the caller cannot see is an empty answer, not a description of it.
    expect(await graph(bcb, 'case', mcbCase)).toEqual([])
    expect(await graph(bcb, 'case', randomUUID())).toEqual([])
    // An unknown kind is empty / refused — never a stack trace.
    const badKind = await bcb.rpc('graph_expand', { p_kind: 'ci', p_id: personId })
    if (badKind.error) expect(['P0403', 'P0001', '22023']).toContain(badKind.error.code)
    else expect(badKind.data ?? []).toEqual([])
  })

  it.skipIf(!hasInactive)('#8 the inactive fixture is refused (P0403) or gets nothing', async () => {
    const r = await inactive!.rpc('graph_expand', { p_kind: 'person', p_id: personId })
    if (r.error) expect(r.error.code, r.error.message).toBe('P0403')
    else expect(r.data ?? []).toEqual([])
    for (const t of ['external_sources', 'external_source_links', 'feature_flags'] as const) {
      const rows = await inactive!.from(t).select('*').limit(5)
      expect(rows.error, `${t}: ${rows.error?.message}`).toBeNull()
      expect(rows.data ?? [], t).toEqual([])
    }
    await expectP0403(inactive!, 'external_source_submit', { p_url: 'https://example.org/' })
  })

  /* ============ #9 THE CI PROOF ============ */

  it('#9 the lead designates the person a CI; the plain detective sees nothing about it on any new surface — before and after retirement', async () => {
    // Precondition: bcb reads the person and the JTF case (the case wall is open; the CI wall is what is tested).
    const seen = await bcb.from('persons').select('id').eq('id', personId).maybeSingle()
    expect(seen.error, seen.error?.message).toBeNull()
    expect(seen.data?.id).toBe(personId)
    const created = await jsonRpc(lead, 'ci_create', { p_person: personId, p_alias: `${tag}-SRC`, p_bureau: 'major_crimes', p_primary_handler: ids.lead, p_status: 'active', p_motive_primary: 'money' })
    expect(created.ok, JSON.stringify(created)).toBe(true)
    ciId = String(created.id); ciNumber = String(created.ci_number)
    expect(ciNumber).toMatch(/^CI-\d+$/)
    // The lead (full access) sees the CI — the surfaces are gated, not broken.
    const forLead = await lead.rpc('ci_get', { p_ci: ciId })
    expect(forLead.error, forLead.error?.message).toBeNull()
    expect((forLead.data as Json)?.ci_number).toBe(ciNumber)

    await assertNoCiFor(bcb, 'bcb (active CI)')
    await assertNoCiFor(lsb, 'lsb (active CI)')
    // The person row is still a plain person for both, with no CI column.
    const row = await bcb.from('persons').select('*').eq('id', personId).single()
    expect(row.error, row.error?.message).toBeNull()
    expect(Object.keys(row.data!).some((k) => /(^|_)ci(_|$)|informant/i.test(k))).toBe(false)
    expect(JSON.stringify(row.data)).not.toContain(ciNumber)
    // A link from a source to the person is allowed and says nothing about the CI.
    const link = await jsonRpc(lsb, 'external_source_link', { p_source: openSource, p_kind: 'person', p_ref: personId })
    expect(link.ok).toBe(true)
    const links = await rowsOf(bcb, 'external_source_links', 'source_id', openSource)
    expect(JSON.stringify(links)).not.toContain(ciNumber)

    // Retire the CI: nothing changes for the detective — a retired source's rows stay restricted, and the person stays plain.
    const retired = await jsonRpc(lead, 'ci_set_status', { p_ci: ciId, p_status: 'retired', p_reason: `${stamp} source relocated` })
    expect(retired.ok, JSON.stringify(retired)).toBe(true)
    await assertNoCiFor(bcb, 'bcb (retired CI)')
    await assertNoCiFor(lsb, 'lsb (retired CI)')
    // The graph still has the person → case and person → gang edges (retirement declassifies nothing and removes nothing).
    const rows = await graph(bcb, 'person', personId)
    expect(rows.some((r) => r.node_kind === 'case' && r.node_id === jtfCase)).toBe(true)
    expect(rows.some((r) => r.node_kind === 'gang' && r.node_id === gangId)).toBe(true)
  }, 120_000)

  /* ============ #10 the Owner-only RPCs and the flags ============ */

  it('#10 system_health / feature_flag_set / crawler_policy_set / background_jobs_stats are P0403 for the detective and the lead; the flags read for everyone', async () => {
    for (const c of [lsb, bcb, lead]) {
      await expectP0403(c, 'system_health', {})
      await expectP0403(c, 'feature_flag_set', { p_key: 'advanced_graph', p_enabled: true })
      await expectP0403(c, 'crawler_policy_set', { p_patch: { max_pages: 1 } })
      await expectP0403(c, 'background_jobs_stats', {})
    }
    const flags = await lsb.from('feature_flags').select('key, enabled').order('key')
    expect(flags.error, flags.error?.message).toBeNull()
    const keys = (flags.data ?? []).map((f) => f.key)
    for (const k of FLAG_KEYS) expect(keys, k).toContain(k)
    expect((flags.data ?? []).every((f) => typeof f.enabled === 'boolean')).toBe(true)
    const upd = await lsb.from('feature_flags').update({ enabled: true }).eq('key', 'openfga').select('key')
    if (upd.error) expect(['P0403', '42501']).toContain(upd.error.code)
    else expect(upd.data ?? []).toEqual([])
    const ins = await lsb.from('feature_flags').insert({ key: 'forged_flag', enabled: true }).select('key')
    expect(ins.error, 'INSERT must be refused').not.toBeNull()
    expect(ins.error!.code).toBe('42501')
    for (const t of ['service_health_events', 'search_index_queue', 'semantic_chunks'] as const) {
      const r = await lsb.from(t).select('id').limit(5)
      expect(r.error, `${t}: ${r.error?.message}`).toBeNull()
      expect(r.data ?? [], `${t} reads nothing for a detective`).toEqual([])
    }
  })

  it.skipIf(!hasOwner)('#10 the Owner reads system_health and re-sets a flag to its current value (audited, nothing changed)', async () => {
    const health = await jsonRpc(owner!, 'system_health', {})
    expect(health).toBeTruthy()
    expect(Array.isArray(health.services)).toBe(true)
    expect(health.jobs).toBeTruthy()
    const before = await owner!.from('feature_flags').select('key, enabled').eq('key', 'advanced_graph').single()
    expect(before.error, before.error?.message).toBeNull()
    const out = await jsonRpc(owner!, 'feature_flag_set', { p_key: 'advanced_graph', p_enabled: before.data!.enabled })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    const after = await owner!.from('feature_flags').select('enabled').eq('key', 'advanced_graph').single()
    expect(after.data!.enabled).toBe(before.data!.enabled)
    expect(await jsonRpc(owner!, 'feature_flag_set', { p_key: 'no_such_flag', p_enabled: true })).toMatchObject({ ok: false })
    const audit = await owner!.from('audit_log').select('action').eq('action', 'FEATURE_FLAG_SET').order('created_at', { ascending: false }).limit(1)
    expect(audit.error, audit.error?.message).toBeNull()
    expect(audit.data?.length).toBe(1)
    const bad = await jsonRpc(owner!, 'crawler_policy_set', { p_patch: { not_a_key: 1 } })
    expect(bad.ok).toBe(false)
  })
})
