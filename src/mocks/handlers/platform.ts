/** Platform-upgrade mocks (migration 20261105120000_platform_upgrade; scratch
 *  upgrade_contract.md §2) — evidence integrity + custody, background jobs,
 *  case packets + manifests, document extraction + tools, external sources,
 *  the investigation graph, search authorization, semantic / hybrid search,
 *  feature flags and system health.
 *
 *  The CONTRACT of the server functions answered from the mock DB — never a
 *  second implementation of the server's authority model:
 *   · Fourteen RPC-only tables (`PLATFORM_RPC_ONLY_TABLES`): SELECT policies
 *     only, re-read here through `visiblePlatformRows` (postgrest.ts chains
 *     it); every client INSERT / UPDATE / DELETE is PostgREST's grant denial
 *     (403 / 42501). The service-role RPCs (`job_claim`, `*_result`, …) are
 *     refused the same way — a browser never holds that key.
 *   · Refusal style: AUTHORITY refusals raise through `private.perm_raise`
 *     (SQLSTATE P0403 → `PlatformRpcError` → PostgREST 400 below);
 *     VALIDATION refusals return `{ok:false, code, message}`.
 *   · Everything CI-related is excluded by construction: no handler here
 *     reads `confidential_informants` or `ci_*`; `graph_expand` has no CI
 *     arm; `search_authorize` drops a `{kind:'ci'}` hit; `external_source_link`
 *     refuses kind `ci` as `bad_request` (the CHECK vocabulary has no such
 *     kind). Restricted media never enter a packet snapshot, a page search
 *     hit, a chunk or a graph node.
 *   · Storage: the five private buckets answer supabase-js's wire shapes
 *     (upload → `{Id, Key}`, sign → `{signedURL}`, download → bytes, remove
 *     → `[]`) from an in-memory object map; the bucket policies are mirrored
 *     (path segment 1 = case / source / export, evidence uploads only under a
 *     media row the session owns, packets / snapshots / exports read-only).
 *   · `functions/v1/semantic-query` and `search-query` answer 503
 *     `{code:'unavailable'}` — the offline layer has no embedding provider
 *     and no Meilisearch; the client's fallbacks are what the tests cover.
 *  Anything richer is pinned with scenarios.rpcResult(). */
import { http, HttpResponse } from 'msw'
import type { Database, Json, Tables } from '@/lib/database.types'
import { urlStaticCheck } from '@/lib/urlPolicy'
import { supabaseBaseUrl } from '../env'
import {
  backgroundJobRow, casePacketRow, crawlerPolicyRow, documentExtractionRow, evidenceCustodyEventRow, externalSourceLinkRow,
  externalSourceRow, featureFlagRow,
} from '../fixtures/rows'
import { getDenial, getRows, mockId, seedRows, setRows, type MockRow, type MockTableName } from '../store'
import { actionNotify } from './action'
import { findRow, isActive, isCommand, isOwner, live, profile, uid } from './entity'
import { postgrestError, shapeNetwork } from './postgrest'
import { canReadCaseAs } from './reports'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type Profile = Tables<'profiles'>
type Media = Tables<'media'>
type Job = Tables<'background_jobs'>
type Source = Tables<'external_sources'>
type Refusal = { ok: false; code: string; message: string }

const str = (v: unknown): string => (v == null ? '' : String(v))
const blank = (v: unknown): string | null => str(v).trim() || null
const now = () => new Date().toISOString()
const HEX64 = /^[0-9a-f]{64}$/i
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const uuidOf = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null)

/** A server `raise` — the rpc route turns it into PostgREST's 400 error
 *  shape. `P0403` marks an AUTHORITY refusal (private.perm_raise). */
export class PlatformRpcError extends Error {
  code: string
  constructor(message: string, code = 'P0001') { super(message); this.code = code }
}
function deny(message: string): never { throw new PlatformRpcError(message, 'P0403') }
const refuse = (code: string, message: string): Refusal => ({ ok: false, code, message })

/* ── Vocabulary (§2) ────────────────────────────────────────────────────── */

/** The tables no client may write — every write is a definer RPC or the service role. */
export const PLATFORM_RPC_ONLY_TABLES: readonly MockTableName[] = [
  'feature_flags', 'background_jobs', 'evidence_custody_events', 'export_manifests', 'case_packets', 'document_pages',
  'document_extractions', 'crawler_policy', 'external_sources', 'external_source_versions', 'external_source_links',
  'search_index_queue', 'semantic_chunks', 'service_health_events',
]
/** Service-role-only RPCs — a client call is PostgREST's grant denial. */
export const PLATFORM_SERVICE_RPCS: readonly string[] = [
  'job_claim', 'job_heartbeat', 'job_complete', 'job_fail', 'evidence_verify_result', 'evidence_derivative_register',
  'case_packet_render_result', 'case_packet_failed', 'evidence_bundle_result', 'document_extract_result', 'document_extract_failed',
  'external_source_ingest', 'external_source_failed', 'semantic_chunks_replace',
]
export const FEATURE_FLAG_KEYS = [
  'stirling_pdf', 'crawl4ai', 'document_processing', 'advanced_graph', 'meilisearch', 'semantic_search', 'evidence_sealing', 'openfga',
  'advanced_editor', 'ai_assistant',
] as const
/** The three that need no external service ship on. */
const FLAGS_DEFAULT_ON = new Set(['advanced_graph', 'evidence_sealing', 'advanced_editor'])
export const JOB_QUEUES = ['pdf', 'crawler', 'documents', 'ocr', 'search', 'embeddings', 'evidence', 'exports', 'notifications', 'health'] as const
export const CUSTODY_EVENT_TYPES = [
  'COLLECTED', 'UPLOADED', 'REGISTERED', 'VIEWED', 'DOWNLOADED', 'TRANSFERRED', 'ASSIGNED', 'PROCESSED', 'DERIVATIVE_CREATED', 'OCR_PROCESSED',
  'REDACTED', 'EXPORTED', 'PACKET_INCLUDED', 'VERIFIED', 'SEALED', 'RELEASED', 'ARCHIVED', 'INTEGRITY_FAILURE',
] as const
export const PACKET_TYPES = ['full', 'doj', 'command', 'disclosure', 'custom'] as const
export const PACKET_SECTIONS = [
  'cover', 'overview', 'summary', 'investigators', 'persons', 'vehicles', 'gangs', 'places', 'narcotics', 'reports', 'evidence_index',
  'evidence_images', 'charges', 'warrants', 'subpoenas', 'legal_decisions', 'timeline', 'signatures',
] as const
export const PACKET_PRESETS: Record<string, readonly string[]> = {
  full: PACKET_SECTIONS,
  doj: ['cover', 'overview', 'summary', 'persons', 'vehicles', 'evidence_index', 'reports', 'charges', 'warrants', 'subpoenas', 'legal_decisions', 'timeline'],
  command: ['cover', 'overview', 'summary', 'investigators', 'evidence_index', 'timeline', 'signatures'],
  disclosure: ['cover', 'overview', 'reports', 'evidence_index'],
  custom: [],
}
export const DOCUMENT_TOOLS = [
  'merge', 'split', 'extract_pages', 'rearrange', 'rotate', 'crop', 'compress', 'ocr', 'image_to_pdf', 'pdf_to_images', 'watermark', 'page_numbers',
  'flatten', 'metadata_inspect', 'metadata_remove', 'sanitize', 'repair', 'compare', 'redact',
] as const
export const SOURCE_LINK_KINDS = ['case', 'person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'report', 'intel'] as const
export const SOURCE_VERIFICATION = ['unverified', 'verified', 'disputed', 'rejected'] as const
export const SOURCE_RELIABILITY = ['unknown', 'reliable', 'usually_reliable', 'unreliable', 'cannot_judge'] as const
export const GRAPH_NODE_KINDS = ['case', 'person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'report', 'account', 'external_source'] as const
export const HEALTH_SERVICES = ['supabase', 'redis', 'worker', 'stirling', 'crawl4ai', 'docling', 'meilisearch', 'embeddings', 'openfga', 'runner'] as const
export const STORAGE_BUCKETS = ['case-evidence', 'case-packets', 'case-documents', 'external-source-snapshots', 'exports'] as const

/** The contract's fixed wordings. */
export const PLATFORM_MESSAGES = {
  notActive: 'your account is not active',
  notVisible: 'that record is not available to you',
  externalHosted: 'external-hosted media cannot be hashed',
  alreadyRegistered: 'this media is already registered as evidence',
  integrityLocked: 'Integrity fields are set by the evidence service.',
  ownerOnly: 'only the Owner may do that',
  sealNeedsVerified: 'evidence must be integrity-verified before it can be sealed',
  sealFlagOff: 'evidence sealing is not enabled',
} as const

const REGISTRY_TABLE: Record<string, MockTableName> = {
  person: 'persons', vehicle: 'vehicles', gang: 'gangs', place: 'places', narcotic: 'narcotics', account: 'accounts',
  evidence: 'media', media: 'media', report: 'reports', case: 'cases', intel: 'field_submissions', external_source: 'external_sources',
}

/* ── Rows / session ─────────────────────────────────────────────────────── */

const rows = <T extends MockTableName>(table: T): Tables<T>[] =>
  (getDenial(table) ? [] : getRows(table)) as unknown as Tables<T>[]
const profileOf = (id: unknown): Profile | undefined => rows('profiles').find((p) => p.id === str(id))
const nameOf = (id: unknown): string => profileOf(id)?.display_name ?? 'Unknown'
const caseOf = (id: unknown): MockRow | undefined => findRow('cases', id)
const canReadCase = (caseId: unknown, p: Profile | null = profile()): boolean => canReadCaseAs(p, caseOf(caseId))
const caseWritable = (caseId: unknown): boolean => {
  const k = caseOf(caseId)
  return canReadCase(caseId) && !!k && k.archived_at == null && k.deleted_at == null
}
const SENIOR = new Set(['senior_detective', 'bureau_lead', 'deputy_director', 'director'])
const isSenior = (p = profile()) => isActive(p) && (!!p!.is_owner || SENIOR.has(p!.role ?? ''))
const mediaOf = (id: unknown): Media | undefined => rows('media').find((m) => m.id === str(id))

/** The mock's `private.perm_registry_visible('media', id)`: live, case
 *  readable (or no case + active), restricted only for command / Owner. */
export function mediaVisibleAs(m: Media | undefined, p: Profile | null = profile()): boolean {
  if (!m || !isActive(p) || m.deleted_at != null) return false
  if (m.case_id && !canReadCase(m.case_id, p)) return false
  if (m.restricted && !(p!.is_owner || isCommand(p))) return false
  return true
}
const mediaVisible = (id: unknown): boolean => mediaVisibleAs(mediaOf(id))

/** The mock's `private.external_source_visible`. */
export function sourceVisibleAs(s: Source | undefined, p: Profile | null = profile()): boolean {
  if (!s || !isActive(p)) return false
  if (s.deleted_at != null && !p!.is_owner) return false
  return s.case_id == null || canReadCase(s.case_id, p)
}
const sourceOf = (id: unknown): Source | undefined => rows('external_sources').find((s) => s.id === str(id))
const sourceVisible = (id: unknown): boolean => sourceVisibleAs(sourceOf(id))

/** The mock's `private.perm_registry_visible(kind, id)` for the graph / search / link kinds. */
export function registryVisible(kind: string, id: unknown): boolean {
  if (!isActive()) return false
  if (kind === 'case') return canReadCase(id)
  if (kind === 'media' || kind === 'evidence') return mediaVisible(id)
  if (kind === 'external_source') return sourceVisible(id)
  if (kind === 'report') { const r = findRow('reports', id); return !!r && r.deleted_at == null && canReadCase(r.case_id) }
  if (kind === 'intel') { const r = findRow('field_submissions', id); return !!r && r.deleted_at == null }
  const table = REGISTRY_TABLE[kind]
  if (!table) return false
  const row = findRow(table, id)
  return !!row && row.deleted_at == null && row.merged_into == null && row.lifecycle !== 'merged'
}

function labelOf(kind: string, id: unknown): { label: string; sublabel: string | null } {
  const table = REGISTRY_TABLE[kind]
  const row = table ? findRow(table, id) : undefined
  if (!row) return { label: 'Restricted record', sublabel: null }
  switch (kind) {
    case 'case': return { label: str(row.title || row.case_number), sublabel: str(row.case_number) || null }
    case 'person': return { label: str(row.name), sublabel: blank(row.alias) }
    case 'vehicle': return { label: str(row.plate || row.model || 'Vehicle'), sublabel: blank(row.model) }
    case 'gang': return { label: str(row.name), sublabel: null }
    case 'place': return { label: str(row.name || 'Place'), sublabel: blank(row.area) }
    case 'narcotic': return { label: str(row.name || 'Narcotic'), sublabel: null }
    case 'account': return { label: str(row.handle || row.display_name || 'Account'), sublabel: blank(row.platform) }
    case 'evidence': case 'media': return { label: str(row.title || 'Evidence'), sublabel: blank(row.evidence_number) }
    case 'report': return { label: str(row.title || row.kind || 'Report'), sublabel: null }
    case 'external_source': return { label: str(row.title || row.domain), sublabel: str(row.source_number) || null }
    default: return { label: str(row.name || row.title || kind), sublabel: null }
  }
}

function audit(action: string, entity: string, entityId: string | null, detail: Json | null = null): void {
  seedRows('audit_log', [{
    action, actor_id: uid(), created_at: now(), detail, entity, entity_id: entityId,
    id: getRows('audit_log').length + 1, prev_hash: null, row_hash: null,
  }])
}

/* ── §2.1 feature flags ─────────────────────────────────────────────────── */

/** The migration seeds ten keys — an empty mock store answers like the migrated DB. */
export function ensureFeatureFlags(): void {
  if (getRows('feature_flags').length) return
  seedRows('feature_flags', FEATURE_FLAG_KEYS.map((key) => featureFlagRow({ key, enabled: FLAGS_DEFAULT_ON.has(key) })))
}
export function ensureCrawlerPolicy(): void {
  if (getRows('crawler_policy').length) return
  seedRows('crawler_policy', [crawlerPolicyRow()])
}
export const flagOnMock = (key: string): boolean => {
  ensureFeatureFlags()
  return rows('feature_flags').some((f) => f.key === key && f.enabled)
}

export function featureFlagSet(args: Args): Fns['feature_flag_set']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  if (!isOwner()) deny(PLATFORM_MESSAGES.ownerOnly)
  ensureFeatureFlags()
  const key = str(args.p_key)
  const row = rows('feature_flags').find((f) => f.key === key)
  if (!row) return refuse('bad_request', 'unknown feature flag')
  const enabled = args.p_enabled === true
  Object.assign(row, { enabled, updated_at: now(), updated_by: uid() })
  audit('FEATURE_FLAG_SET', 'feature_flags', null, { key, enabled })
  return { ok: true, key, enabled }
}

/* ── §2.2 background jobs ───────────────────────────────────────────────── */

/** private.job_enqueue — idempotent on (kind, key). */
export function jobEnqueue(
  queue: string, kind: string, key: string, jobArgs: Json = {}, caseId: string | null = null, subjectKind: string | null = null,
  subjectId: string | null = null,
): Job {
  const existing = rows('background_jobs').find((j) => j.kind === kind && j.idempotency_key === key)
  if (existing) { existing.updated_at = now(); return existing }
  const [job] = seedRows('background_jobs', [backgroundJobRow({
    queue, kind, idempotency_key: key, args: jobArgs, case_id: caseId, subject_kind: subjectKind, subject_id: subjectId,
    created_by: uid(), created_at: now(), updated_at: now(), run_after: now(),
  })])
  return job
}
const jobOf = (id: unknown): Job | undefined => rows('background_jobs').find((j) => j.id === str(id))
const jobVisible = (j: Job | undefined): boolean => !!j && isActive() && (isOwner() || j.created_by === uid())

export function backgroundJobCancel(args: Args): Fns['background_job_cancel']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const job = jobOf(args.p_id)
  const mayCancel = !!job && (isOwner() || (job.created_by === uid() && job.status === 'queued'))
  if (!mayCancel) deny('you may not cancel this job')
  if (job!.status !== 'queued' && job!.status !== 'claimed' && job!.status !== 'running') return refuse('bad_state', 'this job has already finished')
  Object.assign(job!, { status: 'cancelled', error: blank(args.p_reason), finished_at: now(), updated_at: now() })
  audit('BACKGROUND_JOB_CANCELLED', 'background_jobs', job!.id, { kind: job!.kind })
  return { ok: true, id: job!.id, status: 'cancelled' }
}

export function backgroundJobRetry(args: Args): Fns['background_job_retry']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  if (!isOwner()) deny(PLATFORM_MESSAGES.ownerOnly)
  const job = jobOf(args.p_id)
  if (!job) deny('you may not retry this job')
  if (job.status !== 'failed' && job.status !== 'cancelled') return refuse('bad_state', 'only a failed or cancelled job can be retried')
  Object.assign(job, { status: 'queued', attempts: 0, error: null, finished_at: null, run_after: now(), updated_at: now() })
  audit('BACKGROUND_JOB_RETRIED', 'background_jobs', job.id, { kind: job.kind })
  return { ok: true, id: job.id, status: 'queued' }
}

export function backgroundJobsStats(): Fns['background_jobs_stats']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  if (!isOwner()) deny(PLATFORM_MESSAGES.ownerOnly)
  const all = rows('background_jobs')
  const byQueue: Record<string, Record<string, number>> = {}
  for (const j of all) { byQueue[j.queue] ??= {}; byQueue[j.queue][j.status] = (byQueue[j.queue][j.status] ?? 0) + 1 }
  const dayAgo = Date.now() - 86_400_000
  const queued = all.filter((j) => j.status === 'queued')
  const oldest = queued.reduce<number | null>((acc, j) => { const t = Date.parse(j.created_at); return acc == null || t < acc ? t : acc }, null)
  const active = new Set(all.filter((j) => j.claimed_by && j.claimed_at && Date.parse(j.claimed_at) > Date.now() - 300_000).map((j) => j.claimed_by))
  return {
    by_queue: byQueue,
    failed_24h: all.filter((j) => j.status === 'failed' && j.finished_at && Date.parse(j.finished_at) > dayAgo).length,
    oldest_queued_seconds: oldest == null ? 0 : Math.max(0, Math.round((Date.now() - oldest) / 1000)),
    active_workers: active.size,
  }
}

/* ── §2.4 evidence ──────────────────────────────────────────────────────── */

/** private.next_evidence_number — the series continues from the highest number in the store (resets with it). */
const nextEvidenceNumber = (): string => {
  const highest = rows('media').reduce((acc, m) => Math.max(acc, Number(/^EV-(\d+)$/.exec(m.evidence_number ?? '')?.[1] ?? 0)), 0)
  return `EV-${String(highest + 1).padStart(6, '0')}`
}

/** private.custody_event — append one hash-chained row (prev = the media's last hash). */
export function custodyEvent(
  media: Media, type: string, reason: string | null = null, prev: string | null = null, next: string | null = null,
  jobId: string | null = null, exportId: string | null = null, meta: Json = {},
): Tables<'evidence_custody_events'> {
  const last = rows('evidence_custody_events').filter((e) => e.media_id === media.id).sort((a, b) => a.id - b.id).at(-1)
  const [row] = seedRows('evidence_custody_events', [evidenceCustodyEventRow({
    media_id: media.id, case_id: media.case_id, event_type: type, actor_id: uid(), occurred_at: now(), reason,
    previous_custodian: prev, new_custodian: next, job_id: jobId, export_id: exportId, metadata: meta, prev_hash: last?.event_hash ?? null,
  })])
  return row
}

const mediaMayRegister = (m: Media): boolean => m.uploaded_by === uid() || (!!m.case_id && caseWritable(m.case_id)) || isCommand()

export function evidenceRegister(args: Args): Fns['evidence_register']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const m = mediaOf(args.p_media)
  if (!m || m.deleted_at != null || !mediaVisibleAs(m) || !mediaMayRegister(m)) deny(PLATFORM_MESSAGES.notVisible)
  if (m.evidence_number || m.sha256) return refuse('bad_state', PLATFORM_MESSAGES.alreadyRegistered)
  if (!m.storage_path) return refuse('bad_state', PLATFORM_MESSAGES.externalHosted)
  if (!m.storage_path.startsWith(`case/${m.case_id}/${m.id}/`)) return refuse('bad_request', 'storage path is not scoped to this media')
  const sha = str(args.p_sha256).toLowerCase()
  if (!HEX64.test(sha)) return refuse('bad_request', 'sha256 must be 64 hex characters')
  const size = Number(args.p_byte_size)
  if (!Number.isFinite(size) || size <= 0) return refuse('bad_request', 'byte_size must be positive')
  const mime = blank(args.p_mime) ?? 'application/octet-stream'
  const number = nextEvidenceNumber()
  Object.assign(m, {
    sha256: `\\x${sha}`, byte_size: size, mime, original_filename: blank(args.p_original_filename), evidence_number: number,
    classification: blank(args.p_classification) ?? 'unclassified', integrity_status: 'unverified', current_custodian: uid(),
    source: blank(args.p_source), collected_by: uuidOf(args.p_collected_by), collected_at: blank(args.p_collected_at),
    location_collected: blank(args.p_location), updated_at: now(),
  })
  if (m.collected_at) custodyEvent(m, 'COLLECTED', null, null, m.collected_by)
  custodyEvent(m, 'UPLOADED', null, null, uid())
  custodyEvent(m, 'REGISTERED', null, null, uid(), null, null, { evidence_number: number, sha256: sha })
  const minute = Math.floor(Date.now() / 60_000)
  const job = jobEnqueue('evidence', 'evidence.verify', `verify:${m.id}:${minute}`, { media_id: m.id }, m.case_id, 'media', m.id)
  if (/^image\//.test(mime) || mime === 'application/pdf') jobEnqueue('evidence', 'evidence.derive', `derive:${m.id}`, { media_id: m.id }, m.case_id, 'media', m.id)
  if (mime === 'application/pdf' || /wordprocessingml|msword/.test(mime) || /^text\//.test(mime)) {
    jobEnqueue('documents', 'document.extract', `extract:${m.id}`, { media_id: m.id }, m.case_id, 'media', m.id)
    if (!rows('document_extractions').some((d) => d.media_id === m.id)) seedRows('document_extractions', [documentExtractionRow({ media_id: m.id })])
  }
  audit('EVIDENCE_REGISTERED', 'media', m.id, { media_id: m.id, case_id: m.case_id, evidence_number: number })
  return { ok: true, evidence_number: number, job_id: job.id }
}

export function evidenceVerifyRequest(args: Args): Fns['evidence_verify_request']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const m = mediaOf(args.p_media)
  if (!mediaVisibleAs(m)) deny(PLATFORM_MESSAGES.notVisible)
  if (!m!.sha256) return refuse('bad_state', 'this media is not registered as evidence')
  const job = jobEnqueue('evidence', 'evidence.verify', `verify:${m!.id}:${Math.floor(Date.now() / 60_000)}`, { media_id: m!.id }, m!.case_id, 'media', m!.id)
  audit('EVIDENCE_VERIFY_REQUESTED', 'media', m!.id, { media_id: m!.id })
  return { ok: true, job_id: job.id }
}

export function evidenceCustodyTransfer(args: Args): Fns['evidence_custody_transfer']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const m = mediaOf(args.p_media)
  const me = uid()
  if (!mediaVisibleAs(m) || !(m!.current_custodian === me || m!.uploaded_by === me || isCommand())) deny('you are not the custodian of this evidence')
  const to = profileOf(args.p_to)
  if (!to || !to.active || to.removed_at != null) return refuse('bad_request', 'the new custodian must be an active member')
  if (m!.case_id && !canReadCase(m!.case_id, to)) return refuse('bad_request', 'that member cannot see this case')
  const reason = blank(args.p_reason)
  if (!reason) return refuse('bad_request', 'a reason is required')
  const prev = m!.current_custodian
  m!.current_custodian = to.id
  m!.updated_at = now()
  custodyEvent(m!, 'TRANSFERRED', reason, prev, to.id)
  actionNotify(to.id, 'evidence_custody_transfer', { media_id: m!.id, case_id: m!.case_id, evidence_number: m!.evidence_number })
  audit('EVIDENCE_CUSTODY_TRANSFERRED', 'media', m!.id, { from: prev, to: to.id })
  return { ok: true, media_id: m!.id, custodian: to.id }
}

export function evidenceAccessLog(args: Args): Fns['evidence_access_log']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const action = str(args.p_action)
  if (action !== 'viewed' && action !== 'downloaded') throw new PlatformRpcError('p_action must be viewed or downloaded')
  const m = mediaOf(args.p_media)
  if (!mediaVisibleAs(m)) deny(PLATFORM_MESSAGES.notVisible)
  const type = action === 'viewed' ? 'VIEWED' : 'DOWNLOADED'
  if (type === 'VIEWED') {
    const since = Date.now() - 600_000
    const dup = rows('evidence_custody_events').some((e) => e.media_id === m!.id && e.event_type === 'VIEWED' && e.actor_id === uid() && Date.parse(e.occurred_at) >= since)
    if (dup) return false
  }
  custodyEvent(m!, type)
  return true
}

export function evidenceChainVerify(args: Args): Fns['evidence_chain_verify']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const m = mediaOf(args.p_media)
  if (!mediaVisibleAs(m)) deny(PLATFORM_MESSAGES.notVisible)
  const events = rows('evidence_custody_events').filter((e) => e.media_id === m!.id).sort((a, b) => a.id - b.id)
  let prev: string | null = null
  let firstBad: number | null = null
  for (const e of events) { if (e.prev_hash !== prev) { firstBad = e.id; break } prev = e.event_hash }
  return { ok: firstBad == null, events: events.length, first_bad_id: firstBad }
}

export function evidenceSeal(args: Args): Fns['evidence_seal']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const m = mediaOf(args.p_media)
  if (!mediaVisibleAs(m) || !(isSenior() || m!.uploaded_by === uid())) deny('you may not seal this evidence')
  if (!flagOnMock('evidence_sealing')) return refuse('bad_state', PLATFORM_MESSAGES.sealFlagOff)
  if (m!.integrity_status !== 'verified') return refuse('bad_state', PLATFORM_MESSAGES.sealNeedsVerified)
  if (m!.sealed_at) return refuse('bad_state', 'this evidence is already sealed')
  Object.assign(m!, { sealed_at: now(), sealed_by: uid(), updated_at: now() })
  custodyEvent(m!, 'SEALED')
  audit('EVIDENCE_SEALED', 'media', m!.id, { evidence_number: m!.evidence_number })
  return { ok: true, media_id: m!.id, sealed_at: m!.sealed_at }
}

export function evidenceRelease(args: Args): Fns['evidence_release']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const m = mediaOf(args.p_media)
  if (!mediaVisibleAs(m) || !isCommand()) deny('only command may release evidence')
  const reason = blank(args.p_reason)
  if (!reason) return refuse('bad_request', 'a reason is required')
  custodyEvent(m!, 'RELEASED', reason, m!.current_custodian, null)
  audit('EVIDENCE_RELEASED', 'media', m!.id, { evidence_number: m!.evidence_number })
  return { ok: true, media_id: m!.id }
}

/* ── §2.5 packets, manifests, bundles, document tools, extraction ───────── */

/** private.case_packet_snapshot under the caller: labels and numbers only —
 *  restricted media are excluded and counted, CI anything never enters. */
function packetSnapshot(caseId: string, sections: string[]): Json {
  const kase = caseOf(caseId)!
  const media = live('media').filter((m) => m.case_id === caseId) as unknown as Media[]
  const approved = isCommand()
  const restrictedExcluded = media.filter((m) => m.restricted && !approved).length
  const included = media.filter((m) => !m.restricted || approved)
  const evidence = included.filter((m) => m.evidence_number).map((m) => ({
    media_id: m.id, evidence_number: m.evidence_number, title: m.title, sha256: m.sha256 ? m.sha256.replace(/^\\x/, '') : null,
    storage_path: m.storage_path, mime: m.mime,
  }))
  const persons = live('case_intel_links').filter((l) => l.case_id === caseId && l.kind === 'person' && registryVisible('person', l.ref_id))
    .map((l) => ({ id: l.ref_id, label: labelOf('person', l.ref_id).label }))
  const reports = live('reports').filter((r) => r.case_id === caseId).map((r) => ({ id: r.id, title: str(r.title || r.kind) }))
  return {
    case: { id: caseId, case_number: str(kase.case_number), title: str(kase.title) },
    sections,
    evidence: sections.includes('evidence_index') || sections.includes('evidence_images') ? evidence : [],
    persons: sections.includes('persons') ? persons : [],
    reports: sections.includes('reports') ? reports : [],
    excluded: { restricted_media: restrictedExcluded, sealed_legal: 0 },
    generated_by: { id: uid(), name: nameOf(uid()) },
  } as unknown as Json
}

export function casePacketRequest(args: Args): Fns['case_packet_request']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const caseId = uuidOf(args.p_case)
  if (!caseId || !canReadCase(caseId)) deny(PLATFORM_MESSAGES.notVisible)
  const type = str(args.p_type)
  if (!(PACKET_TYPES as readonly string[]).includes(type)) return refuse('bad_request', 'unknown packet type')
  const given = Array.isArray(args.p_sections) ? (args.p_sections as unknown[]).map(str) : null
  const sections = (given ?? PACKET_PRESETS[type]).filter((s) => (PACKET_SECTIONS as readonly string[]).includes(s))
  if (!sections.length) return refuse('bad_request', 'at least one section is required')
  const options = (args.p_options && typeof args.p_options === 'object' ? args.p_options : {}) as Record<string, Json>
  const [packet] = seedRows('case_packets', [casePacketRow({
    case_id: caseId, packet_type: type, sections, options, requested_by: uid(), created_at: now(),
    watermark: blank(options.watermark), snapshot: packetSnapshot(caseId, sections),
  })])
  const job = jobEnqueue('pdf', 'packet.render', `packet:${packet.id}`, { packet_id: packet.id }, caseId, 'case_packet', packet.id)
  packet.job_id = job.id
  audit('CASE_PACKET_REQUESTED', 'case_packets', packet.id, { case_id: caseId, packet_type: type })
  return { ok: true, id: packet.id, job_id: job.id }
}

const packetVisible = (p: Tables<'case_packets'> | undefined): boolean =>
  !!p && isActive() && canReadCase(p.case_id) && (p.deleted_at == null || isOwner())
  && (p.requested_by === uid() || isCommand() || isOwner())

export function casePacketAccessLog(args: Args): Fns['case_packet_access_log']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const p = rows('case_packets').find((r) => r.id === str(args.p_packet))
  if (!packetVisible(p)) deny(PLATFORM_MESSAGES.notVisible)
  audit('CASE_PACKET_DOWNLOADED', 'case_packets', p!.id, { case_id: p!.case_id })
  return true
}

type ManifestFile = { path: string; size: number; sha256: string }
const manifestFiles = (m: Json): ManifestFile[] => {
  const files = (m && typeof m === 'object' && !Array.isArray(m) ? (m as Record<string, Json>).files : null)
  return Array.isArray(files) ? (files as unknown[]).map((f) => {
    const o = (f ?? {}) as Record<string, unknown>
    return { path: str(o.path), size: Number(o.size), sha256: str(o.sha256).replace(/^\\x/, '').toLowerCase() }
  }) : []
}

/** manifest_verify — an invisible manifest is `missing` (a read that returns
 *  nothing, never an existence oracle); otherwise a per-file comparison. */
export function manifestVerify(args: Args): Fns['manifest_verify']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const m = rows('export_manifests').find((r) => r.id === str(args.p_manifest))
  if (!m || (m.case_id && !canReadCase(m.case_id))) return { status: 'missing', files: [] }
  const expected = manifestFiles(m.manifest)
  const supplied = manifestFiles({ files: (Array.isArray(args.p_files) ? args.p_files : []) as Json })
  const byPath = new Map(supplied.map((f) => [f.path, f]))
  const files: { path: string; status: string }[] = []
  let worst = 'verified'
  const rank: Record<string, number> = { verified: 0, modified: 1, unexpected: 2, missing: 3, hash_mismatch: 4 }
  const bump = (s: string) => { if ((rank[s] ?? 0) > rank[worst]) worst = s }
  for (const f of expected) {
    const got = byPath.get(f.path)
    let status = 'verified'
    if (!got) status = 'missing'
    else if (got.sha256 !== f.sha256) status = 'hash_mismatch'
    else if (got.size !== f.size) status = 'modified'
    files.push({ path: f.path, status }); bump(status)
    byPath.delete(f.path)
  }
  for (const extra of byPath.keys()) { files.push({ path: extra, status: 'unexpected' }); bump('unexpected') }
  audit('MANIFEST_VERIFIED', 'export_manifests', m.id, { status: worst })
  return { status: worst, files }
}

const mediaIdsOf = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(str).filter(Boolean) : [])

export function evidenceBundleRequest(args: Args): Fns['evidence_bundle_request']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const caseId = uuidOf(args.p_case)
  if (!caseId || !canReadCase(caseId)) deny(PLATFORM_MESSAGES.notVisible)
  const ids = mediaIdsOf(args.p_media)
  if (!ids.length) return refuse('bad_request', 'pick at least one evidence item')
  for (const id of ids) {
    const m = mediaOf(id)
    if (!mediaVisibleAs(m) || m!.case_id !== caseId) return refuse('bad_request', 'every item must be visible evidence of this case')
  }
  const purpose = blank(args.p_purpose)
  if (!purpose) return refuse('bad_request', 'a purpose is required')
  const job = jobEnqueue('exports', 'bundle.build', `bundle:${caseId}:${ids.slice().sort().join(',')}`, { case_id: caseId, media_ids: ids }, caseId, 'case', caseId)
  audit('EVIDENCE_BUNDLE_REQUESTED', 'cases', caseId, { media_ids: ids })
  return { ok: true, job_id: job.id }
}

export function documentToolRequest(args: Args): Fns['document_tool_request']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const caseId = uuidOf(args.p_case)
  if (!caseId || !canReadCase(caseId)) deny(PLATFORM_MESSAGES.notVisible)
  const tool = str(args.p_tool)
  if (!(DOCUMENT_TOOLS as readonly string[]).includes(tool)) return refuse('bad_request', 'unknown document tool')
  const inputs = (args.p_inputs && typeof args.p_inputs === 'object' ? args.p_inputs : {}) as Record<string, unknown>
  const ids = mediaIdsOf(inputs.media_ids)
  if (!ids.length) return refuse('bad_request', 'pick at least one document')
  for (const id of ids) {
    const m = mediaOf(id)
    if (!mediaVisibleAs(m) || m!.case_id !== caseId) return refuse('bad_request', 'every document must be visible media of this case')
  }
  const job = jobEnqueue('pdf', 'pdf.tool', `tool:${tool}:${ids.slice().sort().join(',')}:${Math.floor(Date.now() / 60_000)}`,
    { tool, media_ids: ids, options: (args.p_options ?? {}) as Json }, caseId, 'case', caseId)
  audit('DOCUMENT_TOOL_REQUESTED', 'cases', caseId, { tool, media_ids: ids })
  return { ok: true, job_id: job.id }
}

export function documentExtractRequest(args: Args): Fns['document_extract_request']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const m = mediaOf(args.p_media)
  if (!mediaVisibleAs(m)) deny(PLATFORM_MESSAGES.notVisible)
  const job = jobEnqueue('documents', 'document.extract', `extract:${m!.id}`, { media_id: m!.id, notify: true }, m!.case_id, 'media', m!.id)
  const ex = rows('document_extractions').find((d) => d.media_id === m!.id)
  if (ex) Object.assign(ex, { status: 'queued', error: null, updated_at: now() })
  else seedRows('document_extractions', [documentExtractionRow({ media_id: m!.id })])
  return { ok: true, job_id: job.id }
}

const terms = (q: unknown): string[] => str(q).toLowerCase().split(/\s+/).map((t) => t.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean)
const headline = (text: string, ts: string[]): string => {
  const low = text.toLowerCase()
  const at = ts.map((t) => low.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - 40)
  return text.slice(start, start + 160)
}
const matches = (text: string, ts: string[]): boolean => { const low = text.toLowerCase(); return ts.length > 0 && ts.every((t) => low.includes(t)) }

/** document_search — INVOKER: only pages of media the session can read. */
export function documentSearch(args: Args): Fns['document_search']['Returns'] {
  if (!isActive()) return []
  const ts = terms(args.p_q)
  if (!ts.length) return []
  const caseId = uuidOf(args.p_case)
  const limit = Math.min(Math.max(Number(args.p_limit) || 30, 1), 200)
  const out: Fns['document_search']['Returns'] = []
  for (const page of rows('document_pages')) {
    const m = mediaOf(page.media_id)
    if (!mediaVisibleAs(m)) continue
    if (caseId && m!.case_id !== caseId) continue
    const text = page.text ?? ''
    if (!matches(text, ts)) continue
    out.push({ media_id: m!.id, case_id: m!.case_id, title: m!.title, evidence_number: m!.evidence_number, page_no: page.page_no, headline: headline(text, ts), rank: 1 })
  }
  return out.slice(0, limit)
}

/* ── §2.6 external sources ──────────────────────────────────────────────── */

/** private.external_source_seq — the series continues from the highest number in the store. */
const nextSourceNumber = (): string => {
  const highest = rows('external_sources').reduce((acc, s) => Math.max(acc, Number(/^SRC-(\d+)$/.exec(s.source_number)?.[1] ?? 0)), 0)
  return `SRC-${String(highest + 1).padStart(6, '0')}`
}

export function externalSourceSubmit(args: Args): Fns['external_source_submit']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  ensureCrawlerPolicy()
  const policy = rows('crawler_policy')[0]
  const check = urlStaticCheck(str(args.p_url), policy)
  if (!check.ok) return refuse('bad_url', check.message)
  const caseId = uuidOf(args.p_case)
  if (args.p_case != null && !caseId) return refuse('bad_request', 'case id is not valid')
  if (caseId && !canReadCase(caseId)) deny(PLATFORM_MESSAGES.notVisible)
  const [source] = seedRows('external_sources', [externalSourceRow({
    submitted_by: uid()!, url: str(args.p_url).trim(), canonical_url: check.canonical, domain: check.host!, case_id: caseId,
    analyst_notes: blank(args.p_notes), source_number: nextSourceNumber(), created_at: now(), updated_at: now(),
  })])
  const job = jobEnqueue('crawler', 'source.fetch', `fetch:${source.id}:1`, { source_id: source.id }, caseId, 'external_source', source.id)
  audit('EXTERNAL_SOURCE_SUBMITTED', 'external_sources', source.id, { domain: source.domain, case_id: caseId })
  return { ok: true, id: source.id, source_number: source.source_number, job_id: job.id }
}

export function externalSourceRecrawl(args: Args): Fns['external_source_recrawl']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const s = sourceOf(args.p_source)
  if (!sourceVisibleAs(s)) deny(PLATFORM_MESSAGES.notVisible)
  const job = jobEnqueue('crawler', 'source.fetch', `fetch:${s!.id}:${s!.version_count + 1}`, { source_id: s!.id }, s!.case_id, 'external_source', s!.id)
  Object.assign(s!, { status: 'fetching', updated_at: now() })
  return { ok: true, job_id: job.id }
}

export function externalSourceVerify(args: Args): Fns['external_source_verify']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const s = sourceOf(args.p_source)
  if (!sourceVisibleAs(s)) deny(PLATFORM_MESSAGES.notVisible)
  const status = str(args.p_status)
  if (!(SOURCE_VERIFICATION as readonly string[]).includes(status)) return refuse('bad_request', 'unknown verification status')
  const reliability = blank(args.p_reliability)
  if (reliability && !(SOURCE_RELIABILITY as readonly string[]).includes(reliability)) return refuse('bad_request', 'unknown reliability')
  Object.assign(s!, {
    verification_status: status, reliability: reliability ?? s!.reliability, verified_by: uid(), verified_at: now(),
    analyst_notes: blank(args.p_notes) ?? s!.analyst_notes, updated_at: now(),
  })
  audit('EXTERNAL_SOURCE_VERIFIED', 'external_sources', s!.id, { status, reliability })
  return { ok: true, id: s!.id, verification_status: status }
}

export function externalSourceLink(args: Args): Fns['external_source_link']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const s = sourceOf(args.p_source)
  if (!sourceVisibleAs(s)) deny(PLATFORM_MESSAGES.notVisible)
  const kind = str(args.p_kind)
  // The CHECK vocabulary has no `ci` — a link to a source's informant is not a thing the schema can express.
  if (!(SOURCE_LINK_KINDS as readonly string[]).includes(kind)) return refuse('bad_request', 'unknown link kind')
  const ref = uuidOf(args.p_ref)
  if (!ref || !registryVisible(kind, ref)) return refuse('bad_request', 'that record is not available to you')
  const existing = rows('external_source_links').find((l) => l.source_id === s!.id && l.kind === kind && l.ref_id === ref)
  if (existing) return { ok: true, id: existing.id }
  const [link] = seedRows('external_source_links', [externalSourceLinkRow({ source_id: s!.id, kind, ref_id: ref, note: blank(args.p_note), created_by: uid(), created_at: now() })])
  audit('EXTERNAL_SOURCE_LINKED', 'external_sources', s!.id, { kind, ref_id: ref })
  return { ok: true, id: link.id }
}

export function externalSourceUnlink(args: Args): Fns['external_source_unlink']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const link = rows('external_source_links').find((l) => l.id === str(args.p_link))
  if (!link || !sourceVisible(link.source_id) || !(link.created_by === uid() || isCommand() || sourceOf(link.source_id)?.submitted_by === uid())) deny(PLATFORM_MESSAGES.notVisible)
  setRows('external_source_links', getRows('external_source_links').filter((l) => l.id !== link.id))
  audit('EXTERNAL_SOURCE_UNLINKED', 'external_sources', link.source_id, { kind: link.kind, ref_id: link.ref_id })
  return { ok: true, id: link.id }
}

export function externalSourceUpdate(args: Args): Fns['external_source_update']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const s = sourceOf(args.p_source)
  if (!sourceVisibleAs(s) || !(s!.submitted_by === uid() || isCommand())) deny(PLATFORM_MESSAGES.notVisible)
  const patch = (args.p_patch && typeof args.p_patch === 'object' ? args.p_patch : {}) as Record<string, unknown>
  const applied: string[] = []
  if ('classification' in patch) { s!.classification = str(patch.classification) || 'unclassified'; applied.push('classification') }
  if ('analyst_notes' in patch) { s!.analyst_notes = blank(patch.analyst_notes); applied.push('analyst_notes') }
  if ('case_id' in patch) {
    const c = uuidOf(patch.case_id)
    if (c && !canReadCase(c)) return refuse('bad_request', 'that case is not available to you')
    s!.case_id = c; applied.push('case_id')
  }
  s!.updated_at = now()
  return { ok: true, id: s!.id, applied }
}

/** external_source_search — INVOKER FTS over the current version of visible sources. */
export function externalSourceSearch(args: Args): Fns['external_source_search']['Returns'] {
  if (!isActive()) return []
  const ts = terms(args.p_q)
  if (!ts.length) return []
  const limit = Math.min(Math.max(Number(args.p_limit) || 20, 1), 100)
  const out: Fns['external_source_search']['Returns'] = []
  for (const s of rows('external_sources')) {
    if (!sourceVisibleAs(s)) continue
    const v = rows('external_source_versions').filter((x) => x.source_id === s.id).sort((a, b) => b.version_no - a.version_no)[0]
    const text = `${v?.title ?? s.title ?? ''} ${v?.text ?? ''}`
    if (!matches(text, ts)) continue
    out.push({ source_id: s.id, source_number: s.source_number, title: v?.title ?? s.title, domain: s.domain, headline: headline(text, ts), rank: 1 })
  }
  return out.slice(0, limit)
}

const POLICY_KEYS = new Set(['allow_domains', 'block_domains', 'max_pages', 'max_depth', 'timeout_ms', 'max_bytes', 'rate_per_min', 'recheck_hours'])
export function crawlerPolicySet(args: Args): Fns['crawler_policy_set']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  if (!isOwner()) deny(PLATFORM_MESSAGES.ownerOnly)
  ensureCrawlerPolicy()
  const policy = rows('crawler_policy')[0]
  const patch = (args.p_patch && typeof args.p_patch === 'object' ? args.p_patch : {}) as Record<string, unknown>
  const applied: string[] = []
  for (const [k, v] of Object.entries(patch)) {
    if (!POLICY_KEYS.has(k)) return refuse('bad_request', `unknown policy key ${k}`)
    if (k === 'allow_domains' || k === 'block_domains') {
      if (!Array.isArray(v)) return refuse('bad_request', `${k} must be a list of domains`)
      policy[k] = (v as unknown[]).map(str).map((d) => d.trim().toLowerCase()).filter(Boolean)
    } else {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) return refuse('bad_request', `${k} must be a non-negative number`)
      ;(policy as unknown as Record<string, unknown>)[k] = Math.round(n)
    }
    applied.push(k)
  }
  Object.assign(policy, { updated_at: now(), updated_by: uid() })
  audit('CRAWLER_POLICY_SET', 'crawler_policy', null, { applied })
  return { ok: true, applied }
}

/* ── §2.7 graph ─────────────────────────────────────────────────────────── */

type GraphRow = Fns['graph_expand']['Returns'][number]
interface Edge { kind: string; fromKind: string; fromId: string; toKind: string; toId: string; confidence: string | null; provenance: string | null; label: string | null }

/** Every edge the mock knows, each already filtered by its link kind's
 *  visibility (soft-deleted / merged rows excluded). NEVER a CI arm. */
function allEdges(): Edge[] {
  const out: Edge[] = []
  const visiblePair = (e: Edge) => registryVisible(e.fromKind, e.fromId) && registryVisible(e.toKind, e.toId)
  const push = (e: Edge) => { if (visiblePair(e)) out.push(e) }
  const CASE_EDGE: Record<string, string> = { person: 'involved_in', vehicle: 'involved_in', gang: 'involved_in', place: 'involved_in', narcotic: 'involved_in', account: 'involved_in' }
  for (const l of live('case_intel_links')) {
    const kind = str(l.kind)
    if (!(kind in CASE_EDGE)) continue
    const role = str(l.role)
    const edgeKind = role === 'suspect' ? 'suspect_in' : role === 'witness' ? 'witness_in' : role === 'victim' ? 'victim_in' : CASE_EDGE[kind]
    push({ kind: edgeKind, fromKind: kind, fromId: str(l.ref_id), toKind: 'case', toId: str(l.case_id), confidence: null, provenance: 'manually_confirmed', label: blank(l.role) })
  }
  for (const p of live('persons')) if (p.gang_id) push({ kind: 'member_of', fromKind: 'person', fromId: str(p.id), toKind: 'gang', toId: str(p.gang_id), confidence: null, provenance: null, label: null })
  for (const gm of live('gang_members')) if (gm.person_id) push({ kind: 'member_of', fromKind: 'person', fromId: str(gm.person_id), toKind: 'gang', toId: str(gm.gang_id), confidence: blank(gm.confidence), provenance: blank(gm.provenance), label: blank(gm.rank) })
  for (const pv of live('person_vehicles')) push({ kind: pv.role === 'driver' ? 'drives' : 'owns', fromKind: 'person', fromId: str(pv.person_id), toKind: 'vehicle', toId: str(pv.vehicle_id), confidence: blank(pv.confidence), provenance: blank(pv.provenance), label: blank(pv.role) })
  for (const pp of live('person_places')) push({ kind: 'located_at', fromKind: 'person', fromId: str(pp.person_id), toKind: 'place', toId: str(pp.place_id), confidence: blank(pp.confidence), provenance: blank(pp.provenance), label: blank(pp.role) })
  for (const pr of live('person_relationships')) push({ kind: 'associated_with', fromKind: 'person', fromId: str(pr.person_a), toKind: 'person', toId: str(pr.person_b), confidence: blank(pr.confidence), provenance: blank(pr.provenance), label: blank(pr.relationship) })
  for (const m of live('media')) if (m.case_id && m.evidence_number) push({ kind: 'evidence_of', fromKind: 'evidence', fromId: str(m.id), toKind: 'case', toId: str(m.case_id), confidence: null, provenance: null, label: null })
  for (const r of live('reports')) push({ kind: 'mentioned_in', fromKind: 'case', fromId: str(r.case_id), toKind: 'report', toId: str(r.id), confidence: null, provenance: null, label: null })
  for (const l of rows('external_source_links')) {
    const kind = l.kind === 'evidence' ? 'evidence' : l.kind === 'intel' ? null : l.kind
    if (!kind) continue
    push({ kind: 'source_for', fromKind: 'external_source', fromId: l.source_id, toKind: kind, toId: l.ref_id, confidence: null, provenance: null, label: blank(l.note) })
  }
  for (const cl of live('case_links')) push({ kind: 'related_case', fromKind: 'case', fromId: str(cl.case_id), toKind: 'case', toId: str(cl.related_case_id), confidence: null, provenance: null, label: blank(cl.kind) })
  return out.filter((e) => e.fromId && e.toId)
}

/** graph_expand — INVOKER, active guard, depth clamped 1–3, limit ≤ 500, row 0 the root. */
export function graphExpand(args: Args): Fns['graph_expand']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  const kind = str(args.p_kind)
  const id = uuidOf(args.p_id)
  if (!(GRAPH_NODE_KINDS as readonly string[]).includes(kind) || !id) return []
  if (!registryVisible(kind, id)) return []
  const depth = Math.min(Math.max(Number(args.p_depth) || 1, 1), 3)
  const limit = Math.min(Math.max(Number(args.p_limit) || 200, 1), 500)
  const kinds = Array.isArray(args.p_kinds) && (args.p_kinds as unknown[]).length ? new Set((args.p_kinds as unknown[]).map(str)) : null
  const edges = allEdges()
  const root = labelOf(kind, id)
  const out: GraphRow[] = [{ node_kind: kind, node_id: id, label: root.label, sublabel: root.sublabel, depth: 0, edge_kind: null, from_kind: null, from_id: null, to_kind: null, to_id: null, confidence: null, provenance: null, edge_label: null }]
  const seen = new Set([`${kind}:${id}`])
  let frontier = [{ kind, id }]
  for (let d = 1; d <= depth && out.length < limit; d++) {
    const next: { kind: string; id: string }[] = []
    for (const node of frontier) {
      for (const e of edges) {
        const other = e.fromKind === node.kind && e.fromId === node.id ? { kind: e.toKind, id: e.toId }
          : e.toKind === node.kind && e.toId === node.id ? { kind: e.fromKind, id: e.fromId } : null
        if (!other) continue
        if (kinds && !kinds.has(other.kind)) continue
        const key = `${other.kind}:${other.id}`
        if (seen.has(key)) continue
        seen.add(key)
        const lab = labelOf(other.kind, other.id)
        out.push({ node_kind: other.kind, node_id: other.id, label: lab.label, sublabel: lab.sublabel, depth: d, edge_kind: e.kind, from_kind: e.fromKind, from_id: e.fromId, to_kind: e.toKind, to_id: e.toId, confidence: e.confidence, provenance: e.provenance, edge_label: e.label })
        next.push(other)
        if (out.length >= limit) break
      }
      if (out.length >= limit) break
    }
    frontier = next
  }
  return out
}

/* ── §2.8 search ────────────────────────────────────────────────────────── */

/** search_authorize — INVOKER: keeps only hits whose row is visible; a
 *  `ci` (or any unknown) kind is dropped, never labelled. */
export function searchAuthorize(args: Args): Fns['search_authorize']['Returns'] {
  if (!isActive()) return []
  const hits = Array.isArray(args.p_hits) ? (args.p_hits as unknown[]) : []
  const out: Json[] = []
  for (const h of hits) {
    const o = (h && typeof h === 'object' ? h : {}) as Record<string, unknown>
    const kind = str(o.kind)
    const id = uuidOf(o.id)
    if (!id) continue
    let label: string | null = null
    let caseId: string | null = null
    if (kind === 'document_page') {
      const m = mediaOf(id)
      if (!mediaVisibleAs(m)) continue
      label = m!.title; caseId = m!.case_id
    } else if (kind === 'external_source') {
      const s = sourceOf(id)
      if (!sourceVisibleAs(s)) continue
      label = s!.title ?? s!.domain; caseId = s!.case_id
    } else if (kind === 'report') {
      if (!registryVisible('report', id)) continue
      const r = findRow('reports', id)!
      label = str(r.title || r.kind); caseId = str(r.case_id)
    } else continue
    out.push({ kind, id, page_no: o.page_no == null ? null : Number(o.page_no), score: Number(o.score) || 0, highlight: blank(o.highlight), label, case_id: caseId })
  }
  return out
}

const chunkVisible = (c: Tables<'semantic_chunks'>): boolean => {
  if (c.source_kind === 'document' || c.source_kind === 'evidence') return mediaVisible(c.media_id ?? c.source_id)
  if (c.source_kind === 'report') return registryVisible('report', c.source_id)
  if (c.source_kind === 'external_source') return sourceVisible(c.source_id)
  if (c.source_kind === 'case_summary') return canReadCase(c.case_id ?? c.source_id)
  return false
}

/** semantic_search — INVOKER; the mock has no vectors, so every visible embedded chunk scores 0.5. */
export function semanticSearch(args: Args): Fns['semantic_search']['Returns'] {
  if (!isActive()) return []
  if (!blank(args.p_embedding)) return []
  const caseId = uuidOf(args.p_case)
  const limit = Math.min(Math.max(Number(args.p_limit) || 20, 1), 100)
  return rows('semantic_chunks').filter((c) => c.embedding != null && chunkVisible(c) && (!caseId || c.case_id === caseId)).slice(0, limit)
    .map((c) => ({ source_kind: c.source_kind, source_id: c.source_id, case_id: c.case_id, media_id: c.media_id, page_no: c.page_no, content: c.content, similarity: 0.5 }))
}

/** hybrid_search — reciprocal-rank fusion of the exact searches (+ semantic when an embedding is given). */
export function hybridSearch(args: Args): Fns['hybrid_search']['Returns'] {
  if (!isActive()) return []
  const limit = Math.min(Math.max(Number(args.p_limit) || 20, 1), 100)
  const K = 60
  type Acc = { row: Fns['hybrid_search']['Returns'][number]; exact: boolean; semantic: boolean }
  const acc = new Map<string, Acc>()
  const add = (key: string, row: Fns['hybrid_search']['Returns'][number], rank: number, mode: 'exact' | 'semantic') => {
    const cur = acc.get(key) ?? { row: { ...row, score: 0 }, exact: false, semantic: false }
    cur.row.score += 1 / (K + rank)
    if (mode === 'exact') cur.exact = true; else cur.semantic = true
    acc.set(key, cur)
  }
  documentSearch({ p_q: args.p_q, p_case: args.p_case, p_limit: limit }).forEach((d, i) =>
    add(`document_page:${d.media_id}:${d.page_no}`, { kind: 'document_page', id: d.media_id, case_id: d.case_id, page_no: d.page_no, title: d.title, snippet: d.headline, score: 0, mode: 'exact' }, i + 1, 'exact'))
  externalSourceSearch({ p_q: args.p_q, p_limit: limit }).forEach((s, i) =>
    add(`external_source:${s.source_id}`, { kind: 'external_source', id: s.source_id, case_id: sourceOf(s.source_id)?.case_id ?? null, page_no: null, title: s.title ?? s.domain, snippet: s.headline, score: 0, mode: 'exact' }, i + 1, 'exact'))
  semanticSearch({ p_embedding: args.p_embedding, p_case: args.p_case, p_limit: limit }).forEach((c, i) =>
    add(`${c.source_kind}:${c.source_id}:${c.page_no ?? ''}`, { kind: c.source_kind === 'document' ? 'document_page' : c.source_kind, id: c.media_id ?? c.source_id, case_id: c.case_id, page_no: c.page_no, title: labelOf(c.source_kind === 'document' ? 'media' : c.source_kind, c.media_id ?? c.source_id).label, snippet: c.content.slice(0, 160), score: 0, mode: 'semantic' }, i + 1, 'semantic'))
  return [...acc.values()].map((a) => ({ ...a.row, mode: a.exact && a.semantic ? 'both' : a.exact ? 'exact' : 'semantic' }))
    .sort((a, b) => b.score - a.score).slice(0, limit)
}

/* ── §2.9 health ────────────────────────────────────────────────────────── */

export function systemHealth(): Fns['system_health']['Returns'] {
  if (!isActive()) deny(PLATFORM_MESSAGES.notActive)
  if (!isOwner()) deny(PLATFORM_MESSAGES.ownerOnly)
  const latest = new Map<string, Tables<'service_health_events'>>()
  for (const e of rows('service_health_events').slice().sort((a, b) => Date.parse(a.checked_at) - Date.parse(b.checked_at))) latest.set(e.service, e)
  const failures = rows('background_jobs').filter((j) => j.status === 'failed').sort((a, b) => Date.parse(b.finished_at ?? b.updated_at) - Date.parse(a.finished_at ?? a.updated_at)).slice(0, 20)
  return {
    services: [...latest.values()].map((e) => ({ service: e.service, status: e.status, latency_ms: e.latency_ms, checked_at: e.checked_at })),
    jobs: backgroundJobsStats(),
    cron: rows('scheduled_job_runs').slice(-20).map((r) => ({ job: r.job, status: r.status, started_at: r.started_at, finished_at: r.finished_at })),
    failures: failures.map((j) => ({ id: j.id, kind: j.kind, error: j.error, finished_at: j.finished_at })),
  }
}

/* ── Read walls (the generic table handler runs the new tables through this) ── */

const PLATFORM_TABLES = new Set<MockTableName>(PLATFORM_RPC_ONLY_TABLES)

export function visiblePlatformRows(table: MockTableName, list: MockRow[]): MockRow[] {
  if (!PLATFORM_TABLES.has(table)) return list
  if (!isActive()) return []
  if (table === 'feature_flags') { ensureFeatureFlags(); return getRows('feature_flags') }
  if (table === 'crawler_policy') { ensureCrawlerPolicy(); return getRows('crawler_policy') }
  if (table === 'search_index_queue') return []
  if (table === 'service_health_events') return isOwner() ? list : []
  if (table === 'background_jobs') return list.filter((r) => jobVisible(r as unknown as Job))
  if (table === 'evidence_custody_events' || table === 'document_pages' || table === 'document_extractions') return list.filter((r) => mediaVisible(r.media_id))
  if (table === 'export_manifests') return list.filter((r) => r.case_id == null || canReadCase(r.case_id))
  if (table === 'case_packets') return list.filter((r) => packetVisible(r as unknown as Tables<'case_packets'>))
  if (table === 'external_sources') return list.filter((r) => sourceVisibleAs(r as unknown as Source))
  if (table === 'external_source_versions') return list.filter((r) => sourceVisible(r.source_id))
  if (table === 'external_source_links') return list.filter((r) => sourceVisible(r.source_id) && registryVisible(str(r.kind), r.ref_id))
  if (table === 'semantic_chunks') return list.filter((r) => chunkVisible(r as unknown as Tables<'semantic_chunks'>))
  return list
}

/* ── RPC registry ───────────────────────────────────────────────────────── */

export const PLATFORM_RPCS: Record<string, (args: Args) => unknown> = {
  feature_flag_set: featureFlagSet,
  background_job_cancel: backgroundJobCancel,
  background_job_retry: backgroundJobRetry,
  background_jobs_stats: backgroundJobsStats,
  evidence_register: evidenceRegister,
  evidence_verify_request: evidenceVerifyRequest,
  evidence_custody_transfer: evidenceCustodyTransfer,
  evidence_access_log: evidenceAccessLog,
  evidence_chain_verify: evidenceChainVerify,
  evidence_seal: evidenceSeal,
  evidence_release: evidenceRelease,
  manifest_verify: manifestVerify,
  case_packet_request: casePacketRequest,
  case_packet_access_log: casePacketAccessLog,
  evidence_bundle_request: evidenceBundleRequest,
  document_tool_request: documentToolRequest,
  document_extract_request: documentExtractRequest,
  document_search: documentSearch,
  external_source_submit: externalSourceSubmit,
  external_source_recrawl: externalSourceRecrawl,
  external_source_verify: externalSourceVerify,
  external_source_link: externalSourceLink,
  external_source_unlink: externalSourceUnlink,
  external_source_update: externalSourceUpdate,
  external_source_search: externalSourceSearch,
  crawler_policy_set: crawlerPolicySet,
  graph_expand: graphExpand,
  search_authorize: searchAuthorize,
  semantic_search: semanticSearch,
  hybrid_search: hybridSearch,
  system_health: systemHealth,
}

/* ── Storage (the five private buckets) ─────────────────────────────────── */

interface StoredObject { bucket: string; path: string; bytes: Uint8Array; contentType: string; owner: string | null }
const objects = new Map<string, StoredObject>()
const objectKey = (bucket: string, path: string) => `${bucket}/${path}`
/** Test hook: the object map is module state (the store has no bucket concept). */
export function resetMockStorage(): void { objects.clear() }
export function mockStorageObjects(): StoredObject[] { return [...objects.values()] }

/** kind → the media column that must name the entity in the registry path. */
const REGISTRY_MEDIA_COLUMN: Record<string, 'gang_id' | 'person_id' | 'place_id' | 'vehicle_id' | 'narcotic_id' | undefined> = {
  gang: 'gang_id', person: 'person_id', place: 'place_id', vehicle: 'vehicle_id', narcotic: 'narcotic_id',
}

const storageError = (status: number, message: string, error = 'InvalidRequest') =>
  HttpResponse.json({ statusCode: String(status), error, message }, { status })

/** The bucket policies (§2.3) for the session. */
function storageRead(bucket: string, path: string): boolean {
  const seg = path.split('/')
  if (!isActive()) return false
  // registry/<kind>/<entity_id>/<media_id>/<file> (20261106120000): the second
  // prefix the case-evidence bucket accepts — registry INTELLIGENCE, read
  // through the media row's own visibility like any other private object.
  if (bucket === 'case-evidence' && seg[0] === 'registry') return mediaVisible(seg[3])
  if (bucket === 'case-evidence' || bucket === 'case-documents') return seg[0] === 'case' && mediaVisible(seg[2])
  if (bucket === 'case-packets') return seg[0] === 'case' && packetVisible(rows('case_packets').find((p) => p.id === seg[2]))
  if (bucket === 'external-source-snapshots') return seg[0] === 'source' && sourceVisible(seg[1])
  if (bucket === 'exports') return seg[0] === 'export' && seg[1] === uid()
  return false
}
function storageWrite(bucket: string, path: string): boolean {
  const seg = path.split('/')
  if (!isActive()) return false
  if (bucket !== 'case-evidence' && bucket !== 'case-documents') return false
  // The registry arm binds the object to a live, CASE-LESS, caller-owned media
  // row that already names this exact path and points at the entity in the
  // path — so the prefix cannot be used to plant an object in another
  // record's namespace or to smuggle a case object past the case rules.
  if (bucket === 'case-evidence' && seg[0] === 'registry') {
    const m = mediaOf(seg[3])
    const column = REGISTRY_MEDIA_COLUMN[seg[1] ?? '']
    return !!m && !!column && m.deleted_at == null && m.case_id == null
      && m.uploaded_by === uid() && m.storage_path === path && str(m[column]) === seg[2]
  }
  if (seg[0] !== 'case' || !caseWritable(seg[1])) return false
  const m = mediaOf(seg[2])
  return !!m && m.deleted_at == null && m.uploaded_by === uid() && m.case_id === seg[1] && (m.storage_path == null || m.storage_path === path)
}

const bucketPattern = `(${STORAGE_BUCKETS.join('|')})`
const storageHandlers = [
  // upload → { Id, Key }
  http.post(new RegExp(`^${supabaseBaseUrl().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/storage/v1/object/${bucketPattern}/(.+)$`), async ({ request }) => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    const [, bucket, path] = new RegExp(`/storage/v1/object/${bucketPattern}/(.+)$`).exec(new URL(request.url).pathname) ?? []
    if (!bucket || !path) return storageError(400, 'bad path')
    if (!storageWrite(bucket, path)) return storageError(403, 'new row violates row-level security policy', 'Unauthorized')
    if (objects.has(objectKey(bucket, path)) && request.headers.get('x-upsert') !== 'true') return storageError(409, 'The resource already exists', 'Duplicate')
    let bytes: Uint8Array
    const ct = request.headers.get('content-type') ?? ''
    if (ct.startsWith('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('')
      bytes = new Uint8Array(file instanceof Blob ? await file.arrayBuffer() : new TextEncoder().encode(str(file)))
    } else bytes = new Uint8Array(await request.arrayBuffer())
    objects.set(objectKey(bucket, path), { bucket, path, bytes, contentType: ct, owner: uid() })
    return HttpResponse.json({ Id: mockId(), Key: objectKey(bucket, path) })
  }),
  // sign → { signedURL }
  http.post(new RegExp(`/storage/v1/object/sign/${bucketPattern}/(.+)$`), async ({ request }) => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    const [, bucket, path] = new RegExp(`/storage/v1/object/sign/${bucketPattern}/(.+)$`).exec(new URL(request.url).pathname) ?? []
    if (!bucket || !path) return storageError(400, 'bad path')
    if (!storageRead(bucket, path)) return storageError(404, 'Object not found', 'not_found')
    return HttpResponse.json({ signedURL: `/object/sign/${bucket}/${path}?token=mock-${Date.now()}` })
  }),
  // download (signed or authenticated) → bytes
  http.get(new RegExp(`/storage/v1/object/(?:sign/|authenticated/)?${bucketPattern}/(.+)$`), async ({ request }) => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    const [, bucket, path] = new RegExp(`/storage/v1/object/(?:sign/|authenticated/)?${bucketPattern}/(.+)$`).exec(new URL(request.url).pathname) ?? []
    if (!bucket || !path) return storageError(400, 'bad path')
    const obj = objects.get(objectKey(bucket, path))
    if (!obj || !storageRead(bucket, path)) return storageError(404, 'Object not found', 'not_found')
    return new HttpResponse(obj.bytes, { status: 200, headers: { 'Content-Type': obj.contentType || 'application/octet-stream' } })
  }),
  // remove → the bucket policies grant no authenticated delete on any of the five.
  http.delete(new RegExp(`/storage/v1/object/${bucketPattern}$`), async () => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    return storageError(403, 'new row violates row-level security policy', 'Unauthorized')
  }),
  http.post(new RegExp(`/storage/v1/object/list/${bucketPattern}$`), async ({ request }) => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    const [, bucket] = new RegExp(`/storage/v1/object/list/${bucketPattern}$`).exec(new URL(request.url).pathname) ?? []
    const body = (await request.json().catch(() => ({}))) as { prefix?: string }
    const prefix = str(body.prefix)
    const names = [...objects.values()].filter((o) => o.bucket === bucket && o.path.startsWith(prefix) && storageRead(bucket!, o.path))
    return HttpResponse.json(names.map((o) => ({ name: o.path.slice(prefix.length), id: mockId(), metadata: { size: o.bytes.length, mimetype: o.contentType } })))
  }),
]

/* ── Handlers ───────────────────────────────────────────────────────────── */

const refuseTable = (table: string) => () =>
  HttpResponse.json({ code: '42501', details: null, hint: null, message: `permission denied for table ${table}` }, { status: 403 })

export const platformHandlers = [
  // Explicit /rest/v1/rpc/<fn> routes — before the generic rpc catch-all so they win the match.
  ...Object.keys(PLATFORM_RPCS).map((fn) =>
    http.post(`${supabaseBaseUrl()}/rest/v1/rpc/${fn}`, async ({ request }) => {
      const shaped = await shapeNetwork()
      if (shaped) return shaped
      const args = (await request.json().catch(() => ({}))) as Args
      try {
        return HttpResponse.json(PLATFORM_RPCS[fn](args) as Parameters<typeof HttpResponse.json>[0])
      } catch (e) {
        if (e instanceof PlatformRpcError) return postgrestError(400, e.code, e.message)
        throw e
      }
    })),
  // The service-role RPCs — a browser session is refused like any revoked EXECUTE.
  ...PLATFORM_SERVICE_RPCS.map((fn) =>
    http.post(`${supabaseBaseUrl()}/rest/v1/rpc/${fn}`, async () => {
      const shaped = await shapeNetwork()
      if (shaped) return shaped
      return postgrestError(403, '42501', `permission denied for function ${fn}`)
    })),
  // RPC-only tables: every client write is PostgREST's grant denial; reads fall through to postgrest.ts + visiblePlatformRows.
  ...PLATFORM_RPC_ONLY_TABLES.flatMap((table) => {
    const url = `${supabaseBaseUrl()}/rest/v1/${table}`
    return [http.post(url, refuseTable(table)), http.patch(url, refuseTable(table)), http.delete(url, refuseTable(table))]
  }),
  ...storageHandlers,
  // The two query edge functions: no provider in the offline layer → 503 unavailable.
  http.post(`${supabaseBaseUrl()}/functions/v1/semantic-query`, async () => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    return HttpResponse.json({ code: 'unavailable', message: 'no embedding provider is configured' }, { status: 503 })
  }),
  http.post(`${supabaseBaseUrl()}/functions/v1/search-query`, async () => {
    const shaped = await shapeNetwork()
    if (shaped) return shaped
    return HttpResponse.json({ code: 'unavailable', message: 'the search index is not configured' }, { status: 503 })
  }),
]
