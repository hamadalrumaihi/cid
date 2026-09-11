/** Documents / packets / manifests / jobs mocks (platform upgrade §2.5) —
 *  the RPCs the case Documents tab calls, plus the signed-read routes of the
 *  `case-packets` and `case-documents` buckets. Contract only, never a
 *  second implementation of the server's authority model:
 *
 *   · `case_packet_request` seeds a queued `case_packets` row + its
 *     `packet.render` job (the server preset fills omitted sections);
 *   · `case_packet_access_log` answers true for a live, visible packet;
 *   · `manifest_verify` compares `[{path,size,sha256}]` with the stored
 *     manifest's `files[]` — the five outcomes, computed in the obvious way
 *     (a test that needs a specific verdict pins it with rpcResult);
 *   · `document_tool_request` / `document_extract_request` seed jobs (the
 *     extraction also upserts a queued `document_extractions` row);
 *   · `document_search` is a naive substring match over seeded
 *     `document_pages` returning the RPC's table shape with a `<b>` headline;
 *   · `background_job_cancel` / `background_job_retry` apply the status rules
 *     (creator while queued or Owner; Owner for retry).
 *  Refusals: validation → jsonb `{ok:false, code, message}`; authority →
 *  raised P0403 (mapped to PostgREST's 400 by the route). Registered as its
 *  own module beside ./platform.ts so the evidence and document maps never
 *  collide in one file. */
import { delay, http, HttpResponse } from 'msw'
import type { Database, Json, Tables } from '@/lib/database.types'
import { supabaseBaseUrl } from '../env'
import { getLatency, getRows, getRpcOverride, getSession, isOffline, mockId, seedRows } from '../store'
import { postgrestError } from './postgrest'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type MediaRow = Tables<'media'>
type PacketRow = Tables<'case_packets'>
type ManifestRow = Tables<'export_manifests'>
type JobRow = Tables<'background_jobs'>
type ExtractionRow = Tables<'document_extractions'>
type PageRow = Tables<'document_pages'>
type ProfileRow = Tables<'profiles'>

export class DocumentsRpcError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

const refuse = (code: string, message: string) => ({ ok: false, code, message })
const deny = (message: string): never => { throw new DocumentsRpcError('P0403', message) }
const uid = () => getSession()?.userId ?? null
const now = () => new Date().toISOString()
const isOwner = (): boolean => {
  const id = uid()
  return !!id && !!(getRows('profiles') as unknown as ProfileRow[]).find((p) => p.id === id)?.is_owner
}

/** Mirror of the server presets (lib/packets DEFAULT_PACKET_SECTIONS). */
export const PACKET_PRESETS: Record<string, string[]> = {
  full: ['cover', 'overview', 'summary', 'investigators', 'persons', 'vehicles', 'gangs', 'places', 'narcotics', 'reports', 'evidence_index', 'evidence_images', 'charges', 'warrants', 'subpoenas', 'legal_decisions', 'timeline', 'signatures'],
  doj: ['cover', 'overview', 'summary', 'persons', 'vehicles', 'evidence_index', 'reports', 'charges', 'warrants', 'subpoenas', 'legal_decisions', 'timeline'],
  command: ['cover', 'overview', 'summary', 'investigators', 'evidence_index', 'timeline', 'signatures'],
  disclosure: ['cover', 'overview', 'reports', 'evidence_index'],
  custom: [],
}
export const DOCUMENT_TOOL_IDS = [
  'merge', 'split', 'extract_pages', 'rearrange', 'rotate', 'crop', 'compress', 'ocr', 'image_to_pdf', 'pdf_to_images',
  'watermark', 'page_numbers', 'flatten', 'metadata_inspect', 'metadata_remove', 'sanitize', 'repair', 'compare', 'redact',
]

const caseExists = (id: unknown): boolean => getRows('cases').some((c) => c.id === String(id ?? '') && c.deleted_at == null)
const mediaById = (id: unknown): MediaRow | null =>
  (getRows('media') as unknown as MediaRow[]).find((m) => m.id === String(id ?? '') && m.deleted_at == null) ?? null

function enqueue(kind: string, queue: string, extra: Partial<JobRow>): JobRow {
  const t = now()
  const row: JobRow = {
    id: mockId(), queue, kind, idempotency_key: `${kind}:${mockId()}`, args: {}, case_id: null, subject_kind: null, subject_id: null,
    status: 'queued', priority: 100, run_after: t, attempts: 0, max_attempts: 5, claimed_by: null, claimed_at: null, lease_until: null,
    progress: {}, result: null, error: null, created_by: uid(), created_at: t, updated_at: t, started_at: null, finished_at: null,
    ...extra,
  }
  seedRows('background_jobs', [row])
  return row
}

function casePacketRequest(args: Args): Fns['case_packet_request']['Returns'] {
  const caseId = String(args.p_case ?? '')
  if (!caseExists(caseId)) return refuse('not_found', 'case not found')
  const type = String(args.p_type ?? '')
  if (!(type in PACKET_PRESETS)) return refuse('bad_request', 'unknown packet type')
  const given = Array.isArray(args.p_sections) ? (args.p_sections as unknown[]).map(String) : null
  const sections = given ?? PACKET_PRESETS[type]
  if (sections.length === 0) return refuse('bad_request', 'at least one section is required')
  const bad = sections.find((s) => !PACKET_PRESETS.full.includes(s))
  if (bad) return refuse('bad_request', `unknown section ${bad}`)
  const options = (args.p_options && typeof args.p_options === 'object' ? args.p_options : {}) as Record<string, unknown>
  const id = mockId()
  const job = enqueue('packet.render', 'pdf', { idempotency_key: `packet:${id}`, args: { packet_id: id }, case_id: caseId, subject_kind: 'case_packet', subject_id: id })
  const row: PacketRow = {
    id, case_id: caseId, packet_type: type, sections, options: options as Json, status: 'queued', job_id: job.id, requested_by: uid(),
    snapshot: { excluded: { restricted_media: 0, sealed_legal: 0 } }, storage_path: null, sha256: null, byte_size: null, page_count: null,
    manifest_id: null, watermark: typeof options.watermark === 'string' ? options.watermark : null, error: null,
    created_at: now(), finished_at: null, deleted_at: null, deleted_by: null, delete_reason: null, delete_batch: null,
  }
  seedRows('case_packets', [row])
  return { ok: true, id, job_id: job.id }
}

function casePacketAccessLog(args: Args): Fns['case_packet_access_log']['Returns'] {
  const p = (getRows('case_packets') as unknown as PacketRow[]).find((r) => r.id === String(args.p_packet ?? '') && r.deleted_at == null)
  return !!p && caseExists(p.case_id)
}

type FileEntry = { path: string; size: number; sha256: string }
const fileEntries = (v: unknown): FileEntry[] => (Array.isArray(v) ? v : [])
  .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
  .map((f) => ({ path: String(f.path ?? ''), size: Number(f.size ?? 0), sha256: String(f.sha256 ?? '').replace(/^\\x/, '').toLowerCase() }))

function manifestVerify(args: Args): Fns['manifest_verify']['Returns'] {
  const m = (getRows('export_manifests') as unknown as ManifestRow[]).find((r) => r.id === String(args.p_manifest ?? ''))
  if (!m || (m.case_id && !caseExists(m.case_id))) return refuse('not_found', 'manifest not found')
  const expected = fileEntries((m.manifest as Record<string, unknown> | null)?.files)
  const given = fileEntries(args.p_files)
  const files: { path: string; status: string }[] = []
  for (const e of expected) {
    const g = given.find((x) => x.path === e.path)
    if (!g) { files.push({ path: e.path, status: 'missing' }); continue }
    if (g.sha256 !== e.sha256) files.push({ path: e.path, status: g.size !== e.size ? 'modified' : 'hash_mismatch' })
    else files.push({ path: e.path, status: 'verified' })
  }
  for (const g of given) if (!expected.some((e) => e.path === g.path)) files.push({ path: g.path, status: 'unexpected' })
  const order = ['hash_mismatch', 'modified', 'missing', 'unexpected']
  const status = order.find((s) => files.some((f) => f.status === s)) ?? 'verified'
  return { status, files }
}

function documentToolRequest(args: Args): Fns['document_tool_request']['Returns'] {
  const caseId = String(args.p_case ?? '')
  if (!caseExists(caseId)) return refuse('not_found', 'case not found')
  const tool = String(args.p_tool ?? '')
  if (!DOCUMENT_TOOL_IDS.includes(tool)) return refuse('bad_request', 'unknown tool')
  const inputs = (args.p_inputs && typeof args.p_inputs === 'object' ? args.p_inputs : {}) as Record<string, unknown>
  const ids = Array.isArray(inputs.media_ids) ? (inputs.media_ids as unknown[]).map(String) : []
  if (ids.length === 0) return refuse('bad_request', 'at least one input document is required')
  for (const id of ids) {
    const m = mediaById(id)
    if (!m || m.case_id !== caseId) return refuse('bad_request', 'every input must be a visible document of this case')
  }
  const job = enqueue('pdf.tool', 'pdf', { idempotency_key: `tool:${tool}:${mockId()}`, args: { tool, media_ids: ids, options: (args.p_options ?? {}) as Json }, case_id: caseId, subject_kind: 'media', subject_id: ids[0] })
  return { ok: true, job_id: job.id }
}

function documentExtractRequest(args: Args): Fns['document_extract_request']['Returns'] {
  const m = mediaById(args.p_media)
  if (!m) return refuse('not_found', 'media not found')
  if (!m.storage_path) return refuse('bad_state', 'external-hosted media cannot be extracted')
  const existing = (getRows('document_extractions') as unknown as ExtractionRow[]).find((x) => x.media_id === m.id)
  if (existing) Object.assign(existing, { status: 'queued', error: null, updated_at: now() })
  else seedRows('document_extractions', [{ id: mockId(), media_id: m.id, status: 'queued', service: null, service_version: null, page_count: null, structure: null, tables: null, error: null, created_at: now(), updated_at: now() }])
  const job = enqueue('document.extract', 'documents', { idempotency_key: `extract:${m.id}:${mockId()}`, args: { media_id: m.id, notify: true }, case_id: m.case_id, subject_kind: 'media', subject_id: m.id })
  return { ok: true, job_id: job.id }
}

function documentSearch(args: Args): Fns['document_search']['Returns'] {
  const q = String(args.p_q ?? '').trim().toLowerCase()
  if (!q) return []
  const caseId = args.p_case ? String(args.p_case) : null
  const limit = Math.max(1, Math.min(200, Number(args.p_limit ?? 30)))
  const out: Fns['document_search']['Returns'] = []
  for (const page of getRows('document_pages') as unknown as PageRow[]) {
    const text = page.text ?? ''
    const at = text.toLowerCase().indexOf(q)
    if (at < 0) continue
    const m = mediaById(page.media_id)
    if (!m || (caseId && m.case_id !== caseId)) continue
    const start = Math.max(0, at - 40)
    const end = Math.min(text.length, at + q.length + 40)
    const headline = `${start > 0 ? '…' : ''}${text.slice(start, at)}<b>${text.slice(at, at + q.length)}</b>${text.slice(at + q.length, end)}${end < text.length ? '…' : ''}`
    out.push({ media_id: m.id, case_id: m.case_id, title: m.title, evidence_number: m.evidence_number, page_no: page.page_no, headline, rank: 1 })
    if (out.length >= limit) break
  }
  return out
}

const jobById = (id: unknown): JobRow | null => (getRows('background_jobs') as unknown as JobRow[]).find((j) => j.id === String(id ?? '')) ?? null

function backgroundJobCancel(args: Args): Fns['background_job_cancel']['Returns'] {
  const j = jobById(args.p_id)
  if (!j) return refuse('not_found', 'job not found')
  const owner = isOwner()
  if (!owner && j.created_by !== uid()) deny('only the requester or an Owner may cancel a job')
  if (!owner && j.status !== 'queued') return refuse('bad_state', 'only a queued job can be cancelled')
  if (j.status === 'succeeded' || j.status === 'failed' || j.status === 'cancelled') return refuse('bad_state', 'the job has already finished')
  Object.assign(j, { status: 'cancelled', error: String(args.p_reason ?? '') || null, finished_at: now(), updated_at: now() })
  const packet = (getRows('case_packets') as unknown as PacketRow[]).find((p) => p.job_id === j.id)
  if (packet) Object.assign(packet, { status: 'cancelled', finished_at: now() })
  return { ok: true }
}

function backgroundJobRetry(args: Args): Fns['background_job_retry']['Returns'] {
  if (!isOwner()) deny('only an Owner may retry a job')
  const j = jobById(args.p_id)
  if (!j) return refuse('not_found', 'job not found')
  if (j.status !== 'failed' && j.status !== 'cancelled') return refuse('bad_state', 'only a failed or cancelled job can be retried')
  Object.assign(j, { status: 'queued', attempts: 0, error: null, finished_at: null, run_after: now(), updated_at: now() })
  const packet = (getRows('case_packets') as unknown as PacketRow[]).find((p) => p.job_id === j.id)
  if (packet) Object.assign(packet, { status: 'queued', error: null, finished_at: null })
  return { ok: true }
}

export const DOCUMENT_RPCS: Record<string, (args: Args) => unknown> = {
  case_packet_request: casePacketRequest,
  case_packet_access_log: casePacketAccessLog,
  manifest_verify: manifestVerify,
  document_tool_request: documentToolRequest,
  document_extract_request: documentExtractRequest,
  document_search: documentSearch,
  background_job_cancel: backgroundJobCancel,
  background_job_retry: backgroundJobRetry,
}

const shape = async (): Promise<Response | null> => {
  if (isOffline()) return HttpResponse.error()
  const ms = getLatency()
  if (ms > 0) await delay(ms)
  return null
}

const signRoute = (bucket: string) =>
  http.post(`${supabaseBaseUrl()}/storage/v1/object/sign/${bucket}/*`, async ({ request }) => {
    const shaped = await shape()
    if (shaped) return shaped
    const path = new URL(request.url).pathname.split(`/storage/v1/object/sign/${bucket}/`)[1] ?? ''
    return HttpResponse.json({ signedURL: `/object/sign/${bucket}/${path}?token=mock-signed-token` })
  })

export const documentHandlers = [
  ...Object.entries(DOCUMENT_RPCS).map(([fn, impl]) =>
    http.post(`${supabaseBaseUrl()}/rest/v1/rpc/${fn}`, async ({ request }) => {
      const shaped = await shape()
      if (shaped) return shaped
      const override = getRpcOverride(fn)
      if (override.hit) return HttpResponse.json(override.result as Parameters<typeof HttpResponse.json>[0])
      const args = (await request.json().catch(() => ({}))) as Args
      try {
        return HttpResponse.json(impl(args) as Parameters<typeof HttpResponse.json>[0])
      } catch (e) {
        if (e instanceof DocumentsRpcError) return postgrestError(400, e.code, e.message)
        throw e
      }
    }),
  ),
  signRoute('case-packets'),
  signRoute('case-documents'),
]
