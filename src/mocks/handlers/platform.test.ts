/** Pins for the platform-upgrade mock handlers (scratch upgrade_contract.md
 *  §2): the vocabulary, the feature-flag seed and the Owner gate, evidence
 *  register-once with the hash-chained custody ledger and the queued jobs,
 *  the two `bad_state` refusals, custody transfer (+ ids-only notification,
 *  P0403 for an outsider), the access-log dedupe, chain verify, the seal
 *  rule, the packet snapshot excluding and counting restricted media with no
 *  CI-shaped key, `manifest_verify` outcomes, tool validation, the SSRF
 *  classes as `bad_url`, source links (kind `ci` refused), `graph_expand`
 *  edges + clamps with a designated CI never surfacing, `search_authorize`
 *  stripping a forged `ci` hit, the table read walls, `system_health` for
 *  the Owner only, and the storage object map hooks. The RPCs are called
 *  directly against the mock store — no MSW server. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import {
  caseRow, confidentialInformantRow, exportManifestRow, externalSourceRow, externalSourceVersionRow, mediaRow, personRow, profileRow, roleSession,
  searchIndexQueueRow, semanticChunkRow, serviceHealthEventRow,
} from '../fixtures'
import { getRows, readRows, resetMockStore, seedRows, setRows, setSession } from '../store'
import {
  CUSTODY_EVENT_TYPES, DOCUMENT_TOOLS, FEATURE_FLAG_KEYS, HEALTH_SERVICES, JOB_QUEUES, PLATFORM_MESSAGES, PLATFORM_RPCS, PLATFORM_RPC_ONLY_TABLES,
  PLATFORM_SERVICE_RPCS, PlatformRpcError, STORAGE_BUCKETS, casePacketRequest, crawlerPolicySet, documentToolRequest, ensureFeatureFlags,
  evidenceAccessLog, evidenceChainVerify, evidenceCustodyTransfer, evidenceRegister, evidenceSeal, externalSourceLink, externalSourceSubmit,
  externalSourceUnlink, featureFlagSet, graphExpand, manifestVerify, mockStorageObjects, resetMockStorage, searchAuthorize, systemHealth,
  visiblePlatformRows,
} from './platform'

type Out = Record<string, unknown>
const SHA_A = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const asUser = (p: Tables<'profiles'> | null) => setSession(p ? { userId: p.id, email: p.email ?? 'x@cid.test', password: 'mock-password' } : null)
const expectDeny = (fn: () => unknown) => {
  try { fn() } catch (e) {
    expect(e).toBeInstanceOf(PlatformRpcError)
    expect((e as PlatformRpcError).code).toBe('P0403')
    return
  }
  throw new Error('expected a P0403 raise')
}

/** An MCB detective (the session), an SCB detective, the MCB lead and the Owner. */
function cast() {
  const me = roleSession('detective')
  const [other, lead, owner] = seedRows('profiles', [
    profileRow({ display_name: 'Det. Other', division: 'street_crimes' }),
    profileRow({ role: 'bureau_lead', display_name: 'Lt. Lead' }),
    profileRow({ is_owner: true, display_name: 'The Owner' }),
  ])
  const [kase] = seedRows('cases', [caseRow({ case_number: 'MCB-4000901', lead_detective_id: me.profile.id, created_by: me.profile.id })])
  return { me: me.profile, other, lead, owner, kase }
}
type Cast = ReturnType<typeof cast>

function storageMedia(c: Cast, title = 'Scene photo', mime = 'image/png') {
  const [m] = seedRows('media', [mediaRow({ title, type: mime === 'application/pdf' ? 'document' : 'image', case_id: c.kase.id, uploaded_by: c.me.id, external_url: null, mime, byte_size: 3 })])
  m.storage_path = `case/${c.kase.id}/${m.id}/file.bin`
  return m
}
const register = (m: Tables<'media'>, extra: Out = {}) =>
  evidenceRegister({ p_media: m.id, p_sha256: SHA_A, p_byte_size: 3, p_mime: m.mime ?? 'image/png', p_original_filename: 'file.bin', ...extra }) as Out

describe('platform — vocabulary', () => {
  beforeEach(() => { resetMockStore(); resetMockStorage() })

  it('the contract\'s lists are complete', () => {
    expect(PLATFORM_RPC_ONLY_TABLES).toHaveLength(14)
    expect(PLATFORM_SERVICE_RPCS).toHaveLength(14)
    expect(Object.keys(PLATFORM_RPCS)).toHaveLength(31)
    expect(FEATURE_FLAG_KEYS).toHaveLength(10)
    expect(JOB_QUEUES).toHaveLength(10)
    expect(CUSTODY_EVENT_TYPES).toHaveLength(18)
    expect(DOCUMENT_TOOLS).toHaveLength(19)
    expect(HEALTH_SERVICES).toHaveLength(10)
    expect(STORAGE_BUCKETS).toEqual(['case-evidence', 'case-packets', 'case-documents', 'external-source-snapshots', 'exports'])
    expect(mockStorageObjects()).toEqual([])
  })

  it('the flag seed: ten keys, three on; the Owner sets a flag (audited), a detective is P0403', () => {
    const c = cast()
    ensureFeatureFlags()
    const flags = readRows('feature_flags')
    expect(flags.map((f) => f.key).sort()).toEqual([...FEATURE_FLAG_KEYS].sort())
    expect(flags.filter((f) => f.enabled).map((f) => f.key).sort()).toEqual(['advanced_editor', 'advanced_graph', 'evidence_sealing'])
    expectDeny(() => featureFlagSet({ p_key: 'openfga', p_enabled: true }))
    asUser(c.owner)
    expect(featureFlagSet({ p_key: 'openfga', p_enabled: true })).toMatchObject({ ok: true, key: 'openfga', enabled: true })
    expect(featureFlagSet({ p_key: 'nope', p_enabled: true })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(readRows('audit_log').map((a) => a.action)).toContain('FEATURE_FLAG_SET')
    expect(crawlerPolicySet({ p_patch: { max_pages: 3 } })).toMatchObject({ ok: true, applied: ['max_pages'] })
    expect(crawlerPolicySet({ p_patch: { nope: 1 } })).toMatchObject({ ok: false, code: 'bad_request' })
  })
})

describe('platform — evidence', () => {
  beforeEach(() => { resetMockStore(); resetMockStorage() })

  it('registers once: series number, UPLOADED → REGISTERED chained, verify + derive jobs, audit; second is bad_state; external is bad_state', () => {
    const c = cast()
    const m = storageMedia(c)
    const out = register(m)
    expect(out).toMatchObject({ ok: true, evidence_number: 'EV-000001' })
    expect(out.job_id).toBeTruthy()
    expect(m).toMatchObject({ evidence_number: 'EV-000001', integrity_status: 'unverified', current_custodian: c.me.id, sha256: `\\x${SHA_A}` })
    const chain = readRows('evidence_custody_events').filter((e) => e.media_id === m.id)
    expect(chain.map((e) => e.event_type)).toEqual(['UPLOADED', 'REGISTERED'])
    expect(chain[0].prev_hash).toBeNull()
    expect(chain[1].prev_hash).toBe(chain[0].event_hash)
    expect(readRows('background_jobs').map((j) => `${j.queue}/${j.kind}`).sort()).toEqual(['evidence/evidence.derive', 'evidence/evidence.verify'])
    expect(readRows('audit_log').map((a) => a.action)).toContain('EVIDENCE_REGISTERED')
    expect(register(m)).toMatchObject({ ok: false, code: 'bad_state', message: PLATFORM_MESSAGES.alreadyRegistered })
    const [legacy] = seedRows('media', [mediaRow({ case_id: c.kase.id, uploaded_by: c.me.id })])
    expect(register(legacy)).toMatchObject({ ok: false, code: 'bad_state', message: PLATFORM_MESSAGES.externalHosted })
    expect(register(storageMedia(c, 'B'), { p_sha256: 'nope' })).toMatchObject({ ok: false, code: 'bad_request' })
    // A PDF also queues extraction and opens an extraction row.
    const pdf = storageMedia(c, 'Statement', 'application/pdf')
    expect((register(pdf) as Out).ok).toBe(true)
    expect(readRows('background_jobs').some((j) => j.kind === 'document.extract' && j.subject_id === pdf.id)).toBe(true)
    expect(readRows('document_extractions').some((d) => d.media_id === pdf.id && d.status === 'queued')).toBe(true)
    // COLLECTED leads the chain when a collection time is given.
    const m2 = storageMedia(c, 'C')
    register(m2, { p_collected_at: '2026-11-01T10:00:00Z', p_collected_by: c.me.id })
    expect(readRows('evidence_custody_events').filter((e) => e.media_id === m2.id).map((e) => e.event_type)).toEqual(['COLLECTED', 'UPLOADED', 'REGISTERED'])
  })

  it('custody transfer moves the custodian, notifies ids only, refuses an outsider; access log dedupes; chain verifies; seal needs verified', () => {
    const c = cast()
    const m = storageMedia(c)
    register(m)
    const out = evidenceCustodyTransfer({ p_media: m.id, p_to: c.lead.id, p_reason: 'handing over' }) as Out
    expect(out.ok).toBe(true)
    expect(m.current_custodian).toBe(c.lead.id)
    const t = readRows('evidence_custody_events').filter((e) => e.media_id === m.id).at(-1)!
    expect(t).toMatchObject({ event_type: 'TRANSFERRED', previous_custodian: c.me.id, new_custodian: c.lead.id, reason: 'handing over' })
    const told = readRows('notifications').find((n) => n.user_id === c.lead.id && n.type === 'evidence_custody_transfer')!
    expect(Object.keys(told.payload as Out).sort()).toEqual(['actor_id', 'actor_name', 'case_id', 'evidence_number', 'media_id'])
    asUser(c.other)
    expectDeny(() => evidenceCustodyTransfer({ p_media: m.id, p_to: c.other.id, p_reason: 'grab' }))
    expectDeny(() => evidenceAccessLog({ p_media: m.id, p_action: 'viewed' }))
    asUser(c.me)
    expect(evidenceAccessLog({ p_media: m.id, p_action: 'viewed' })).toBe(true)
    expect(evidenceAccessLog({ p_media: m.id, p_action: 'viewed' })).toBe(false)
    expect(evidenceAccessLog({ p_media: m.id, p_action: 'downloaded' })).toBe(true)
    expect(evidenceChainVerify({ p_media: m.id })).toMatchObject({ ok: true, events: 5, first_bad_id: null })
    expect(evidenceSeal({ p_media: m.id })).toMatchObject({ ok: false, code: 'bad_state', message: PLATFORM_MESSAGES.sealNeedsVerified })
    m.integrity_status = 'verified'
    expect(evidenceSeal({ p_media: m.id })).toMatchObject({ ok: true })
    expect(m.sealed_by).toBe(c.me.id)
    expect(readRows('evidence_custody_events').filter((e) => e.media_id === m.id).at(-1)!.event_type).toBe('SEALED')
  })
})

describe('platform — packets, manifests, tools', () => {
  beforeEach(() => { resetMockStore(); resetMockStorage() })

  it('the packet snapshot excludes and counts the restricted photo, names the registered item, carries no CI-shaped key; outsider P0403', () => {
    const c = cast()
    const m = storageMedia(c)
    register(m)
    seedRows('media', [mediaRow({ title: 'RESTRICTED secret photo', case_id: c.kase.id, restricted: true, uploaded_by: c.lead.id, storage_path: `case/${c.kase.id}/x/secret.png` })])
    const out = casePacketRequest({ p_case: c.kase.id, p_type: 'doj', p_options: { watermark: 'COPY' } }) as Out
    expect(out.ok).toBe(true)
    const packet = readRows('case_packets').find((p) => p.id === out.id)!
    expect(packet).toMatchObject({ status: 'queued', packet_type: 'doj', watermark: 'COPY', requested_by: c.me.id, job_id: out.job_id })
    expect(packet.sections).toContain('evidence_index')
    const text = JSON.stringify(packet.snapshot)
    expect(text).toContain('EV-000001')
    expect(text).not.toContain('RESTRICTED secret photo')
    expect(text).not.toContain('secret.png')
    expect((packet.snapshot as Out).excluded).toEqual({ restricted_media: 1, sealed_legal: 0 })
    const keys: string[] = []
    const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Out)) { keys.push(k); walk(x) } }
    walk(packet.snapshot)
    expect(keys.filter((k) => /(^|_)ci(_|$)|informant/i.test(k))).toEqual([])
    expect(readRows('background_jobs').some((j) => j.kind === 'packet.render' && j.queue === 'pdf')).toBe(true)
    expect(casePacketRequest({ p_case: c.kase.id, p_type: 'affidavit' })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(casePacketRequest({ p_case: c.kase.id, p_type: 'custom', p_sections: [] })).toMatchObject({ ok: false, code: 'bad_request' })
    asUser(c.other)
    expectDeny(() => casePacketRequest({ p_case: c.kase.id, p_type: 'full' }))
    expect(visiblePlatformRows('case_packets', getRows('case_packets'))).toEqual([])
    asUser(c.lead)
    expect(visiblePlatformRows('case_packets', getRows('case_packets'))).toHaveLength(1)
  })

  it('manifest_verify: unknown → missing; per-file verified / hash_mismatch / modified / missing / unexpected', () => {
    const c = cast()
    expect(manifestVerify({ p_manifest: '00000000-0000-4000-a000-999999999999', p_files: [] })).toEqual({ status: 'missing', files: [] })
    const [m] = seedRows('export_manifests', [exportManifestRow({
      case_id: c.kase.id, manifest: { manifest_version: 1, files: [{ path: 'packet.pdf', size: 10, sha256: SHA_A }, { path: 'a.png', size: 3, sha256: SHA_A }] },
    })])
    expect(manifestVerify({ p_manifest: m.id, p_files: [{ path: 'packet.pdf', size: 10, sha256: SHA_A }, { path: 'a.png', size: 3, sha256: SHA_A.toUpperCase() }] })).toEqual({ status: 'verified', files: [{ path: 'packet.pdf', status: 'verified' }, { path: 'a.png', status: 'verified' }] })
    expect(manifestVerify({ p_manifest: m.id, p_files: [{ path: 'packet.pdf', size: 10, sha256: '0'.repeat(64) }, { path: 'a.png', size: 4, sha256: SHA_A }] })).toMatchObject({ status: 'hash_mismatch', files: [{ path: 'packet.pdf', status: 'hash_mismatch' }, { path: 'a.png', status: 'modified' }] })
    expect(manifestVerify({ p_manifest: m.id, p_files: [{ path: 'packet.pdf', size: 10, sha256: SHA_A }, { path: 'extra.txt', size: 1, sha256: SHA_A }] })).toMatchObject({ status: 'missing', files: [{ path: 'packet.pdf', status: 'verified' }, { path: 'a.png', status: 'missing' }, { path: 'extra.txt', status: 'unexpected' }] })
    asUser(c.other)
    expect(manifestVerify({ p_manifest: m.id, p_files: [] })).toEqual({ status: 'missing', files: [] })
  })

  it('document_tool_request validates the tool and the inputs, then queues pdf.tool', () => {
    const c = cast()
    const m = storageMedia(c, 'Doc', 'application/pdf')
    expect(documentToolRequest({ p_case: c.kase.id, p_tool: 'teleport', p_inputs: { media_ids: [m.id] } })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(documentToolRequest({ p_case: c.kase.id, p_tool: 'merge', p_inputs: { media_ids: [] } })).toMatchObject({ ok: false, code: 'bad_request' })
    const [foreign] = seedRows('cases', [caseRow({ case_number: 'MCB-4000902', lead_detective_id: c.me.id })])
    const [fm] = seedRows('media', [mediaRow({ case_id: foreign.id, uploaded_by: c.me.id })])
    expect(documentToolRequest({ p_case: c.kase.id, p_tool: 'merge', p_inputs: { media_ids: [m.id, fm.id] } })).toMatchObject({ ok: false, code: 'bad_request' })
    const out = documentToolRequest({ p_case: c.kase.id, p_tool: 'page_numbers', p_inputs: { media_ids: [m.id] } }) as Out
    expect(out.ok).toBe(true)
    expect(readRows('background_jobs').find((j) => j.id === out.job_id)).toMatchObject({ queue: 'pdf', kind: 'pdf.tool', case_id: c.kase.id })
  })
})

describe('platform — sources, graph, search, walls', () => {
  beforeEach(() => { resetMockStore(); resetMockStorage() })

  it('external_source_submit numbers the source and queues the fetch; every SSRF class is bad_url; links refuse kind ci', () => {
    const c = cast()
    const out = externalSourceSubmit({ p_url: 'https://Example.org/a#frag' }) as Out
    expect(out).toMatchObject({ ok: true, source_number: 'SRC-000001' })
    const s = readRows('external_sources')[0]
    expect(s).toMatchObject({ domain: 'example.org', canonical_url: 'https://example.org/a', status: 'pending', submitted_by: c.me.id })
    expect(readRows('background_jobs').some((j) => j.kind === 'source.fetch' && j.queue === 'crawler')).toBe(true)
    for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://10.1.1.1/', 'http://169.254.169.254/', 'http://metadata.google.internal/', 'http://[::1]/', 'file:///etc/passwd', 'https://u:p@example.org/']) {
      expect(externalSourceSubmit({ p_url: url }), url).toMatchObject({ ok: false, code: 'bad_url' })
    }
    expect(readRows('external_sources')).toHaveLength(1)
    const [p] = seedRows('persons', [personRow({ name: 'Quiet Person' })])
    expect(externalSourceLink({ p_source: s.id, p_kind: 'ci', p_ref: p.id })).toMatchObject({ ok: false, code: 'bad_request' })
    expect(externalSourceLink({ p_source: s.id, p_kind: 'person', p_ref: '00000000-0000-4000-a000-999999999999' })).toMatchObject({ ok: false, code: 'bad_request' })
    const link = externalSourceLink({ p_source: s.id, p_kind: 'person', p_ref: p.id }) as Out
    expect(link.ok).toBe(true)
    expect((externalSourceLink({ p_source: s.id, p_kind: 'person', p_ref: p.id }) as Out).id).toBe(link.id)
    asUser(c.other)
    expectDeny(() => externalSourceUnlink({ p_link: String(link.id) }))
    asUser(c.me)
    expect(externalSourceUnlink({ p_link: String(link.id) })).toMatchObject({ ok: true })
    expect(readRows('external_source_links')).toEqual([])
  })

  it('graph_expand: root, case edge, gang edge, source edge; clamps; a designated CI never surfaces; search_authorize strips a ci hit', () => {
    const c = cast()
    setRows('gangs', [{ id: '00000000-0000-4000-a000-000000000777', name: 'The Lost', deleted_at: null, merged_into: null }])
    const [p] = seedRows('persons', [personRow({ name: 'Quiet Person', gang_id: '00000000-0000-4000-a000-000000000777' })])
    seedRows('case_intel_links', [{ case_id: c.kase.id, created_at: '2026-11-01T00:00:00Z', created_by: c.me.id, delete_batch: null, delete_reason: null, deleted_at: null, deleted_by: null, id: '00000000-0000-4000-a000-000000000778', kind: 'person', note: null, ref_id: p.id, role: 'suspect' }])
    const [ci] = seedRows('confidential_informants', [confidentialInformantRow({ person_id: p.id, ci_number: 'CI-0042', created_by: c.lead.id })])
    const src = externalSourceSubmit({ p_url: 'https://example.org/a' }) as Out
    externalSourceLink({ p_source: String(src.id), p_kind: 'person', p_ref: p.id })
    const rows = graphExpand({ p_kind: 'person', p_id: p.id, p_depth: 9, p_limit: 100_000 })
    expect(rows[0]).toMatchObject({ node_kind: 'person', node_id: p.id, depth: 0, label: 'Quiet Person' })
    expect(rows.find((r) => r.node_kind === 'case')).toMatchObject({ node_id: c.kase.id, edge_kind: 'suspect_in', depth: 1 })
    expect(rows.find((r) => r.node_kind === 'gang')).toMatchObject({ edge_kind: 'member_of', label: 'The Lost' })
    expect(rows.find((r) => r.node_kind === 'external_source')).toMatchObject({ edge_kind: 'source_for' })
    expect(Math.max(...rows.map((r) => r.depth))).toBeLessThanOrEqual(3)
    const text = JSON.stringify(rows)
    expect(text).not.toContain('CI-0042')
    expect(text).not.toContain(ci.id)
    expect(rows.some((r) => r.node_kind === 'ci')).toBe(false)
    expect(graphExpand({ p_kind: 'person', p_id: p.id, p_kinds: ['gang'] }).slice(1).every((r) => r.node_kind === 'gang')).toBe(true)
    expect(graphExpand({ p_kind: 'ci', p_id: p.id })).toEqual([])
    asUser(c.other)
    expect(graphExpand({ p_kind: 'case', p_id: c.kase.id })).toEqual([])
    expect(graphExpand({ p_kind: 'person', p_id: p.id }).some((r) => r.node_kind === 'case')).toBe(false)
    asUser(c.me)
    const m = storageMedia(c)
    const authorized = searchAuthorize({ p_hits: [{ kind: 'ci', id: ci.id, score: 1 }, { kind: 'document_page', id: m.id, page_no: 2, score: 0.5, highlight: 'x' }, { kind: 'report', id: '00000000-0000-4000-a000-999999999999', score: 1 }] }) as Out[]
    expect(authorized).toHaveLength(1)
    expect(authorized[0]).toMatchObject({ kind: 'document_page', id: m.id, page_no: 2, label: 'Scene photo', case_id: c.kase.id })
  })

  it('the read walls: jobs private to creator / Owner, health Owner-only, the index queue nobody, chunks / versions through their source; system_health is Owner-only', () => {
    const c = cast()
    const m = storageMedia(c)
    register(m)
    const [pinned] = seedRows('external_sources', [externalSourceRow({ submitted_by: c.me.id, case_id: c.kase.id })])
    seedRows('external_source_versions', [externalSourceVersionRow({ source_id: pinned.id })])
    seedRows('semantic_chunks', [semanticChunkRow({ source_kind: 'external_source', source_id: pinned.id })])
    seedRows('search_index_queue', [searchIndexQueueRow({ kind: 'external_source', ref_id: pinned.id })])
    seedRows('service_health_events', [serviceHealthEventRow({ service: 'runner' }), serviceHealthEventRow({ service: 'supabase', status: 'degraded', latency_ms: 900 })])
    const wall = (table: Parameters<typeof visiblePlatformRows>[0]) => visiblePlatformRows(table, getRows(table)).length
    expect(wall('background_jobs')).toBe(2)
    expect(wall('external_source_versions')).toBe(1)
    expect(wall('semantic_chunks')).toBe(1)
    expect(wall('search_index_queue')).toBe(0)
    expect(wall('service_health_events')).toBe(0)
    expectDeny(() => systemHealth())
    asUser(c.other)
    for (const t of ['background_jobs', 'evidence_custody_events', 'external_sources', 'external_source_versions', 'semantic_chunks', 'service_health_events'] as const) expect(wall(t), t).toBe(0)
    expect(wall('feature_flags')).toBe(10)
    asUser(c.owner)
    expect(wall('background_jobs')).toBe(2)
    expect(wall('service_health_events')).toBe(2)
    const health = systemHealth() as Out
    expect((health.services as Out[]).map((s) => s.service).sort()).toEqual(['runner', 'supabase'])
    expect((health.jobs as Out).oldest_queued_seconds).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(health.failures)).toBe(true)
    asUser(null)
    expect(wall('feature_flags')).toBe(0)
  })
})
