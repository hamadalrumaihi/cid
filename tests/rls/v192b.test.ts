/** v1.92b — Platform upgrade, documents and case packets: the server-side
 *  snapshot, manifests, extraction, document search, document tools and the
 *  job visibility they ride on (migration 20261105120000_platform_upgrade;
 *  scratch upgrade_contract.md §2.2, §2.5). Catalog test_id `v192b`.
 *
 *  What the CID fixtures prove (lsb — the MCB detective, the requester; bcb —
 *  the SCB detective, the other bureau; lead — the MCB Bureau Lead, who may
 *  insert a RESTRICTED media row; owner optional — `audit_log`):
 *   · #1 `case_packet_request(case, 'doj')` → `{ok, id, job_id}`: a
 *     `case_packets` row `queued` with the DOJ preset sections, a
 *     `packet.render` job on the `pdf` queue, `CASE_PACKET_REQUESTED`
 *     audited; `custom` needs sections (`bad_request`), an unknown type is
 *     `bad_request`;
 *   · #2 the snapshot is built under the caller BEFORE the job exists: the
 *     restricted media's path and title never appear in it and
 *     `excluded.restricted_media` counts it; the visible registered item
 *     appears by evidence number; no key of the snapshot is named like a
 *     confidential informant;
 *   · #3 the other bureau: `case_packet_request` on the MCB case → P0403,
 *     zero `case_packets` rows for the packet id, `case_packet_access_log`
 *     → P0403; #4 the requester's `case_packet_access_log` is true and
 *     `CASE_PACKET_DOWNLOADED` is audited (Owner);
 *   · #5 `manifest_verify` on an id the caller cannot see is a refusal that
 *     discloses nothing — `{status:'missing'}` or P0403 (the migration
 *     picks one; both are accepted, a 42501 or a stack trace is not); an
 *     `export_manifests` row is never client-writable (42501);
 *   · #6 `document_search` is INVOKER + empty-safe: no rows, no error, for
 *     a nonsense query, for a query scoped to a case the caller cannot read,
 *     and for the other bureau; `document_pages` / `document_extractions`
 *     read zero rows for bcb on the MCB item and refuse every client write;
 *   · #7 `document_tool_request` validates: an unknown tool → `bad_request`,
 *     a media of another case → `bad_request`, the other bureau → P0403; a
 *     valid pdf-lib-capable tool (`page_numbers`) on the case's own document
 *     → `{ok, job_id}` on the `pdf` queue, `DOCUMENT_TOOL_REQUESTED` audited;
 *   · #8 `document_extract_request` on the requester's own document →
 *     `{ok, job_id}` with a `document.extract` job and a `queued`
 *     `document_extractions` row visible to lsb, zero rows for bcb;
 *   · #9 `evidence_bundle_request` refuses an item of another case
 *     (`bad_request`) and an empty list, accepts the case's registered item
 *     (`bundle.build` on `exports`); #10 `case_packets` and the new tables
 *     refuse every direct client write (42501); soft delete goes through
 *     `soft_delete('case_packet', …)` by the requester and the packet leaves
 *     the list for its reader and appears in `trash_list('case_packet')`;
 *   · #11 (review fix, PART 6) a row whose `storage_path` names another
 *     folder is refused by `document_extract_request` and
 *     `document_tool_request` (`bad_request`) — the service only ever fetches
 *     `case/<case_id>/<media_id>/…`.
 *
 *  Fixtures: one MCB case by lsb, one registered PDF (`document`) + one
 *  registered photo by lsb, one RESTRICTED photo by the lead (all with
 *  client-chosen ids so the storage path names them; no object is uploaded).
 *  `rls_test_cleanup` (spliced by 20261105120000) sweeps packets, jobs,
 *  extractions and the media with the case. */

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
}
const enabled = !!(ANON && PW.lsb && PW.bcb && PW.lead)
if (!enabled) console.warn('[rls:v192b] fixture passwords not set — suite skipped')
const hasOwner = !!PW.owner

const mk = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
type C = SupabaseClient
type Json = Record<string, unknown>
const SHA_A = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const SHA_B = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const DOJ_SECTIONS = ['cover', 'overview', 'summary', 'persons', 'vehicles', 'evidence_index', 'reports', 'charges', 'warrants', 'subpoenas', 'legal_decisions', 'timeline']
const CI_KEY = /(^|_)ci(_|$)|informant/i
const PLATFORM_TABLES = ['case_packets', 'export_manifests', 'document_pages', 'document_extractions', 'background_jobs'] as const

describe.skipIf(!enabled)('v1.92b — packets snapshot only what the caller may see; documents and tools validate; the other bureau gets nothing', () => {
  let lsb: C, bcb: C, lead: C, owner: C | null = null
  const ids: Record<string, string> = {}
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase()
  const stamp = `[rls-test] v192b ${tag}`
  let mcbCase = ''
  let otherCase = ''            // a second MCB case — "media of another case" for the tools / bundle legs
  const docMedia = randomUUID()   // registered PDF on mcbCase
  const photoMedia = randomUUID() // registered photo on mcbCase
  const restrictedMedia = randomUUID() // the lead's restricted photo on mcbCase
  const otherMedia = randomUUID()  // photo on otherCase
  const restrictedTitle = `${stamp} RESTRICTED confidential photo`
  let docNumber = ''
  let photoNumber = ''
  let packetId = ''
  let packetJob = ''

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
  const rowsOf = async (c: C, table: string, col: string, val: string): Promise<Json[]> => {
    const r = await c.from(table).select('*').eq(col, val).limit(50)
    expect(r.error, `${table}: ${r.error?.message}`).toBeNull()
    return (r.data ?? []) as Json[]
  }
  const insertMedia = async (c: C, row: Json) => {
    const r = await c.from('media').insert(row).select('id').single()
    if (r.error) throw new Error(`media insert (${row.title}): ${r.error.message}`)
    return r.data!.id as string
  }
  const register = async (media: string, sha: string, mime: string, name: string): Promise<string> => {
    const out = await jsonRpc(lsb, 'evidence_register', { p_media: media, p_sha256: sha, p_byte_size: 3, p_mime: mime, p_original_filename: name })
    if (out.ok !== true) throw new Error(`evidence_register ${name}: ${JSON.stringify(out)}`)
    return String(out.evidence_number)
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
    const pre = await lsb.rpc('rls_test_cleanup')
    if (pre.error) throw new Error(`pre-run cleanup failed: ${pre.error.message}`)

    const c1 = await lsb.from('cases').insert({ case_number: `V192B-${tag}`, title: `${stamp} MCB case`, bureau: 'major_crimes', lead_detective_id: ids.lsb }).select('id').single()
    if (c1.error) throw new Error(`mcb case: ${c1.error.message}`)
    mcbCase = c1.data!.id
    const c2 = await lsb.from('cases').insert({ case_number: `V192B-${tag}-2`, title: `${stamp} other MCB case`, bureau: 'major_crimes', lead_detective_id: ids.lsb }).select('id').single()
    if (c2.error) throw new Error(`other case: ${c2.error.message}`)
    otherCase = c2.data!.id
    await insertMedia(lsb, { id: docMedia, title: `${stamp} statement.pdf`, type: 'document', case_id: mcbCase, storage_path: `case/${mcbCase}/${docMedia}/statement.pdf`, mime: 'application/pdf', byte_size: 3, original_filename: 'statement.pdf' })
    await insertMedia(lsb, { id: photoMedia, title: `${stamp} scene photo`, type: 'image', case_id: mcbCase, storage_path: `case/${mcbCase}/${photoMedia}/scene.png`, mime: 'image/png', byte_size: 3, original_filename: 'scene.png' })
    await insertMedia(lsb, { id: otherMedia, title: `${stamp} other-case photo`, type: 'image', case_id: otherCase, storage_path: `case/${otherCase}/${otherMedia}/other.png`, mime: 'image/png', byte_size: 3, original_filename: 'other.png' })
    // Restricted rows are inserted by the can_edit_narcotics_intel audience (the lead), mirroring v138.
    await insertMedia(lead, { id: restrictedMedia, title: restrictedTitle, type: 'image', case_id: mcbCase, restricted: true, storage_path: `case/${mcbCase}/${restrictedMedia}/restricted.png`, mime: 'image/png', byte_size: 3, original_filename: 'restricted.png' })
    docNumber = await register(docMedia, SHA_A, 'application/pdf', 'statement.pdf')
    photoNumber = await register(photoMedia, SHA_B, 'image/png', 'scene.png')
  }, 150_000)

  afterAll(async () => {
    if (!lsb) return
    const { data, error } = await lsb.rpc('rls_test_cleanup')
    if (error) throw new Error(`rls_test_cleanup (lsb) failed: ${error.message}`)
    console.info('[rls:v192b] cleanup (lsb):', JSON.stringify(data))
    await Promise.all([lsb, bcb, lead, owner].filter((c): c is C => !!c).map((c) => c.auth.signOut()))
  }, 60_000)

  /* ============ #1–#2 the request and its snapshot ============ */

  it('#1 case_packet_request(doj): a queued packet with the preset sections, a packet.render job, an audit row; bad types and empty custom refused', async () => {
    const out = await jsonRpc(lsb, 'case_packet_request', { p_case: mcbCase, p_type: 'doj', p_options: { watermark: 'RLS TEST' } })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    packetId = String(out.id)
    packetJob = String(out.job_id)
    const rows = await rowsOf(lsb, 'case_packets', 'id', packetId)
    expect(rows).toHaveLength(1)
    const p = rows[0]
    expect(p).toMatchObject({ case_id: mcbCase, packet_type: 'doj', requested_by: ids.lsb, job_id: packetJob })
    expect(['queued', 'rendering', 'ready', 'failed']).toContain(String(p.status))
    expect(p.sections).toEqual(DOJ_SECTIONS)
    expect(p.deleted_at).toBeNull()
    const job = await lsb.from('background_jobs').select('queue, kind, case_id, subject_kind, subject_id, created_by').eq('id', packetJob).maybeSingle()
    expect(job.error, job.error?.message).toBeNull()
    expect(job.data).toMatchObject({ queue: 'pdf', kind: 'packet.render', case_id: mcbCase, subject_kind: 'case_packet', subject_id: packetId, created_by: ids.lsb })
    // Validation refusals return, never raise.
    expect(await jsonRpc(lsb, 'case_packet_request', { p_case: mcbCase, p_type: 'affidavit' })).toMatchObject({ ok: false, code: 'bad_request' })
    const custom = await jsonRpc(lsb, 'case_packet_request', { p_case: mcbCase, p_type: 'custom', p_sections: [] })
    expect(custom.ok).toBe(false)
    const unknownSections = await jsonRpc(lsb, 'case_packet_request', { p_case: mcbCase, p_type: 'custom', p_sections: ['nonsense'] })
    expect(unknownSections.ok).toBe(false)
  })

  it.skipIf(!hasOwner)('#1 CASE_PACKET_REQUESTED is audited with ids only (Owner)', async () => {
    const r = await owner!.from('audit_log').select('action, entity_id, detail').eq('action', 'CASE_PACKET_REQUESTED').eq('entity_id', packetId).limit(1)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data?.length).toBe(1)
    expect(JSON.stringify(r.data![0].detail)).not.toContain(restrictedTitle)
  })

  it('#2 the snapshot is built under the caller: the restricted photo is excluded and counted, the registered items appear by number, no CI-shaped key', async () => {
    const rows = await rowsOf(lsb, 'case_packets', 'id', packetId)
    const snapshot = rows[0].snapshot as Json
    expect(snapshot, 'snapshot present').toBeTruthy()
    const text = JSON.stringify(snapshot)
    expect(text).not.toContain(restrictedTitle)
    expect(text).not.toContain(`/${restrictedMedia}/`)
    expect(text).not.toContain(restrictedMedia)
    expect(text).toContain(docNumber)
    expect(text).toContain(photoNumber)
    const excluded = (snapshot.excluded ?? {}) as Json
    expect(Number(excluded.restricted_media), 'excluded.restricted_media counts the lead\'s row').toBeGreaterThanOrEqual(1)
    const keys = new Set<string>()
    const walk = (v: unknown) => {
      if (Array.isArray(v)) { v.forEach(walk); return }
      if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Json)) { keys.add(k); walk(x) }
    }
    walk(snapshot)
    expect([...keys].filter((k) => CI_KEY.test(k)), 'no key named like a confidential informant').toEqual([])
  })

  /* ============ #3–#4 who reads / downloads a packet ============ */

  it('#3 the other bureau: request → P0403, zero rows for the packet, access log → P0403; a random id and the hidden id answer the same', async () => {
    await expectP0403(bcb, 'case_packet_request', { p_case: mcbCase, p_type: 'full' })
    expect(await rowsOf(bcb, 'case_packets', 'id', packetId)).toEqual([])
    expect(await rowsOf(bcb, 'case_packets', 'case_id', mcbCase)).toEqual([])
    const hidden = await expectP0403(bcb, 'case_packet_access_log', { p_packet: packetId })
    const random = await expectP0403(bcb, 'case_packet_access_log', { p_packet: randomUUID() })
    expect(hidden).toBe(random)
    const jobs = await bcb.from('background_jobs').select('id').eq('id', packetJob)
    expect(jobs.error, jobs.error?.message).toBeNull()
    expect(jobs.data ?? []).toEqual([])
  })

  it('#4 the requester logs a download (true) and the lead, who reads the case, may too', async () => {
    const mine = await lsb.rpc('case_packet_access_log', { p_packet: packetId })
    expect(mine.error, mine.error?.message).toBeNull()
    expect(mine.data).toBe(true)
    const theirs = await lead.rpc('case_packet_access_log', { p_packet: packetId })
    expect(theirs.error, theirs.error?.message).toBeNull()
    expect(theirs.data).toBe(true)
    expect((await rowsOf(lead, 'case_packets', 'id', packetId)).length).toBe(1)
  })

  it.skipIf(!hasOwner)('#4 CASE_PACKET_DOWNLOADED is audited for the requester (Owner)', async () => {
    const r = await owner!.from('audit_log').select('actor_id').eq('action', 'CASE_PACKET_DOWNLOADED').eq('entity_id', packetId)
    expect(r.error, r.error?.message).toBeNull()
    expect((r.data ?? []).map((a) => a.actor_id)).toContain(ids.lsb)
  })

  /* ============ #5 manifests ============ */

  it('#5 manifest_verify on an invisible or unknown manifest discloses nothing; export_manifests is never client-writable', async () => {
    const r = await lsb.rpc('manifest_verify', { p_manifest: randomUUID(), p_files: [{ path: 'packet.pdf', size: 1, sha256: SHA_A }] })
    if (r.error) expect(r.error.code, r.error.message).toBe('P0403')
    else {
      const out = (r.data ?? {}) as Json
      expect(['missing', 'unexpected']).toContain(String(out.status))
      expect(Array.isArray(out.files) ? (out.files as Json[]).every((f) => f.status !== 'verified') : true).toBe(true)
    }
    const ins = await lsb.from('export_manifests').insert({
      kind: 'case_packet', case_id: mcbCase, bundle_id: randomUUID(), storage_path: `case/${mcbCase}/x/manifest.json`, manifest: { manifest_version: 1 }, manifest_sha256: `\\x${SHA_A}`,
    }).select('id')
    expect(ins.error, 'INSERT must be refused').not.toBeNull()
    expect(ins.error!.code, ins.error!.message).toBe('42501')
    // A manifest the packet's renderer wrote (if the runner already ran) reads through the case wall only.
    const forBcb = await bcb.from('export_manifests').select('id').eq('case_id', mcbCase)
    expect(forBcb.error, forBcb.error?.message).toBeNull()
    expect(forBcb.data ?? []).toEqual([])
  })

  /* ============ #6 document search and the page tables ============ */

  it('#6 document_search is INVOKER and empty-safe; pages / extractions read through the media wall and refuse client writes', async () => {
    for (const [c, who] of [[lsb, 'lsb'], [bcb, 'bcb']] as const) {
      const r = await c.rpc('document_search', { p_q: `zzqx-${tag}-nothing` })
      expect(r.error, `${who}: ${r.error?.message}`).toBeNull()
      expect(r.data ?? [], who).toEqual([])
    }
    const scoped = await bcb.rpc('document_search', { p_q: 'statement', p_case: mcbCase, p_limit: 10 })
    expect(scoped.error, scoped.error?.message).toBeNull()
    expect(scoped.data ?? []).toEqual([])
    // Whatever pages exist for the MCB document, bcb reads none of them; lsb reads only its own case's.
    expect(await rowsOf(bcb, 'document_pages', 'media_id', docMedia)).toEqual([])
    expect(await rowsOf(bcb, 'document_extractions', 'media_id', docMedia)).toEqual([])
    for (const m of await rowsOf(lsb, 'document_pages', 'media_id', docMedia)) expect(m.media_id).toBe(docMedia)
    const insPage = await lsb.from('document_pages').insert({ media_id: docMedia, page_no: 99, text: 'forged page' }).select('id')
    expect(insPage.error, 'INSERT document_pages must be refused').not.toBeNull()
    expect(insPage.error!.code, insPage.error!.message).toBe('42501')
    const insEx = await lsb.from('document_extractions').insert({ media_id: photoMedia, status: 'ready' }).select('id')
    expect(insEx.error, 'INSERT document_extractions must be refused').not.toBeNull()
    expect(insEx.error!.code, insEx.error!.message).toBe('42501')
    // The other search surfaces are just as empty-safe.
    const hybrid = await bcb.rpc('hybrid_search', { p_q: `zzqx-${tag}-nothing` })
    expect(hybrid.error, hybrid.error?.message).toBeNull()
    expect(hybrid.data ?? []).toEqual([])
  })

  /* ============ #7–#9 tools, extraction, bundles ============ */

  it('#7 document_tool_request: unknown tool → bad_request, another case\'s media → bad_request, other bureau → P0403; page_numbers on the document → a pdf job', async () => {
    expect(await jsonRpc(lsb, 'document_tool_request', { p_case: mcbCase, p_tool: 'teleport', p_inputs: { media_ids: [docMedia] } })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(await jsonRpc(lsb, 'document_tool_request', { p_case: mcbCase, p_tool: 'merge', p_inputs: { media_ids: [docMedia, otherMedia] } })).toMatchObject({ ok: false, code: 'bad_request' })
    expect((await jsonRpc(lsb, 'document_tool_request', { p_case: mcbCase, p_tool: 'merge', p_inputs: { media_ids: [] } })).ok).toBe(false)
    await expectP0403(bcb, 'document_tool_request', { p_case: mcbCase, p_tool: 'page_numbers', p_inputs: { media_ids: [docMedia] } })
    const out = await jsonRpc(lsb, 'document_tool_request', { p_case: mcbCase, p_tool: 'page_numbers', p_inputs: { media_ids: [docMedia] }, p_options: { position: 'bottom-right' } })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    const job = await lsb.from('background_jobs').select('queue, kind, case_id, created_by, args').eq('id', String(out.job_id)).maybeSingle()
    expect(job.error, job.error?.message).toBeNull()
    expect(job.data).toMatchObject({ queue: 'pdf', kind: 'pdf.tool', case_id: mcbCase, created_by: ids.lsb })
    // Args are ids / metadata only — never bytes.
    expect(JSON.stringify(job.data!.args).length).toBeLessThan(2_000)
  })

  it.skipIf(!hasOwner)('#7 DOCUMENT_TOOL_REQUESTED is audited (Owner)', async () => {
    const r = await owner!.from('audit_log').select('detail').eq('action', 'DOCUMENT_TOOL_REQUESTED').eq('entity_id', mcbCase).order('created_at', { ascending: false }).limit(1)
    expect(r.error, r.error?.message).toBeNull()
    expect(r.data?.length).toBe(1)
  })

  it('#8 document_extract_request on the requester\'s own document → a document.extract job and a queued extraction row; zero rows for the other bureau', async () => {
    const out = await jsonRpc(lsb, 'document_extract_request', { p_media: docMedia })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    const job = await lsb.from('background_jobs').select('queue, kind, subject_id').eq('id', String(out.job_id)).maybeSingle()
    expect(job.error, job.error?.message).toBeNull()
    expect(job.data).toMatchObject({ queue: 'documents', kind: 'document.extract', subject_id: docMedia })
    const ex = await rowsOf(lsb, 'document_extractions', 'media_id', docMedia)
    expect(ex.length).toBe(1)
    expect(['queued', 'ready', 'failed']).toContain(String(ex[0].status))
    expect(await rowsOf(bcb, 'document_extractions', 'media_id', docMedia)).toEqual([])
    await expectP0403(bcb, 'document_extract_request', { p_media: docMedia })
  })

  it('#11 a media row pointing at another folder is refused by extraction and by the document tools (bad_request) — the service never fetches a client-chosen path', async () => {
    // Review fix (PART 6): an unregistered row's storage_path is client-chosen;
    // only case/<case_id>/<media_id>/… is ever handed to the runner / worker.
    const strayId = randomUUID()
    await insertMedia(lsb, {
      id: strayId, case_id: mcbCase, title: `[rls-test] v192b ${tag} stray path`, type: 'document', mime: 'application/pdf', byte_size: 10,
      storage_path: `case/${randomUUID()}/${randomUUID()}/other.pdf`,
    })
    const ex = await jsonRpc(lsb, 'document_extract_request', { p_media: strayId })
    expect(ex).toMatchObject({ ok: false, code: 'bad_request' })
    const tool = await jsonRpc(lsb, 'document_tool_request', { p_case: mcbCase, p_tool: 'page_numbers', p_inputs: { media_ids: [strayId] } })
    expect(tool).toMatchObject({ ok: false, code: 'bad_request' })
    expect(await rowsOf(lsb, 'document_extractions', 'media_id', strayId)).toEqual([])
  })

  it('#9 evidence_bundle_request: another case\'s item and an empty list are bad_request; the case\'s registered items build a bundle', async () => {
    expect(await jsonRpc(lsb, 'evidence_bundle_request', { p_case: mcbCase, p_media: [docMedia, otherMedia], p_purpose: 'court' })).toMatchObject({ ok: false, code: 'bad_request' })
    expect((await jsonRpc(lsb, 'evidence_bundle_request', { p_case: mcbCase, p_media: [], p_purpose: 'court' })).ok).toBe(false)
    // The restricted row is not visible to the detective — asking for it is the same bad_request, never a hint.
    expect(await jsonRpc(lsb, 'evidence_bundle_request', { p_case: mcbCase, p_media: [docMedia, restrictedMedia], p_purpose: 'court' })).toMatchObject({ ok: false, code: 'bad_request' })
    await expectP0403(bcb, 'evidence_bundle_request', { p_case: mcbCase, p_media: [docMedia], p_purpose: 'court' })
    const out = await jsonRpc(lsb, 'evidence_bundle_request', { p_case: mcbCase, p_media: [docMedia, photoMedia], p_purpose: `${stamp} disclosure` })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    const job = await lsb.from('background_jobs').select('queue, kind, case_id').eq('id', String(out.job_id)).maybeSingle()
    expect(job.error, job.error?.message).toBeNull()
    expect(job.data).toMatchObject({ queue: 'exports', kind: 'bundle.build', case_id: mcbCase })
  })

  /* ============ #10 no client writes; soft delete through the registry ============ */

  it('#10 every new table refuses direct client writes; a packet is soft-deleted through soft_delete(case_packet) and lands in the Trash', async () => {
    for (const t of PLATFORM_TABLES) {
      const upd = await lsb.from(t).update({ status: 'ready' }).eq('id', t === 'background_jobs' ? packetJob : packetId).select('id')
      if (upd.error) expect(upd.error.code, `${t} UPDATE: ${upd.error.message}`).toMatch(/^(42501|P0403)$/)
      else expect(upd.data ?? [], `${t} UPDATE matched nothing`).toEqual([])
      const del = await lsb.from(t).delete().eq('id', t === 'background_jobs' ? packetJob : packetId).select('id')
      if (del.error) expect(del.error.code, `${t} DELETE: ${del.error.message}`).toMatch(/^(42501|P0403)$/)
      else expect(del.data ?? [], `${t} DELETE matched nothing`).toEqual([])
    }
    expect((await rowsOf(lsb, 'case_packets', 'id', packetId)).length, 'the packet survived the direct writes').toBe(1)
    // The other bureau cannot soft-delete what it cannot see.
    const foreign = await jsonRpc(bcb, 'soft_delete', { p_kind: 'case_packet', p_id: packetId, p_reason: 'grab' })
    expect(foreign.ok).toBe(false)
    const out = await jsonRpc(lsb, 'soft_delete', { p_kind: 'case_packet', p_id: packetId, p_reason: `${stamp} superseded` })
    expect(out.ok, JSON.stringify(out)).toBe(true)
    expect(await rowsOf(lead, 'case_packets', 'id', packetId), 'a deleted packet leaves the reader\'s list').toEqual([])
    const trash = await lsb.rpc('trash_list', { p_kind: 'case_packet' })
    expect(trash.error, trash.error?.message).toBeNull()
    const mine = ((trash.data ?? []) as Json[]).find((r) => r.id === packetId)
    expect(mine, 'the packet is in the requester\'s Trash').toBeTruthy()
    expect(String(mine!.label)).toMatch(/packet/i)
    expect(String(mine!.label)).not.toContain(restrictedTitle)
    const restored = await jsonRpc(lsb, 'restore_record', { p_kind: 'case_packet', p_id: packetId })
    expect(restored.ok, JSON.stringify(restored)).toBe(true)
    expect((await rowsOf(lead, 'case_packets', 'id', packetId)).length).toBe(1)
  })
})
