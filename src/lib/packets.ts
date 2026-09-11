/** Case packets — the SERVER-rendered court packet (platform upgrade §2.5).
 *  A request is one `case_packet_request` RPC: the database snapshots what
 *  the caller may see (restricted media without a fresh approval, sealed
 *  legal material and CI anything are excluded BEFORE the snapshot exists),
 *  enqueues a `packet.render` job and answers `{ok,id,job_id}`. The UI never
 *  waits: the packet row moves through queued → rendering → ready on the
 *  realtime-published `case_packets` table and the requester is notified
 *  (`case_packet_ready`). The bytes live in the private `case-packets`
 *  bucket next to `manifest.json` + `manifest.sha256`; downloads mint a
 *  300 s signed URL after `case_packet_access_log` records the access.
 *
 *  The older client-side export (`lib/packet.ts` — docx / md / pdf built in
 *  the browser) stays as "Quick export (this browser)"; this module is the
 *  audited, manifested one. */
import { list, rpc, type MutationResult } from './db'
import type { Json, Tables } from './database.types'
import { supabase } from './supabase'
import { humanizeError } from './toast'

// Shared readouts: byte sizes and bytea-hex come from lib/hash (Client A),
// job kind / tone / progress from lib/evidence — one vocabulary for the
// evidence cards, the Documents tab and the jobs tray.
export { formatBytes as fmtBytes, normalizeHex } from './hash'
export { jobKindLabel, jobProgressOf, jobStatusTone } from './evidence'

export type PacketRow = Tables<'case_packets'>
export type ExportManifestRow = Tables<'export_manifests'>
export type BackgroundJobRow = Tables<'background_jobs'>

export const PACKET_BUCKET = 'case-packets'
/** Signed-URL lifetime — the same 300 s the field-evidence bucket uses. */
export const PACKET_URL_TTL_S = 300

/* ── Vocabulary (mirrors the migration's CHECK constraints) ─────────────── */

export const PACKET_TYPES = [
  { id: 'full', label: 'Full case packet', description: 'Every section — the complete case record for command review or archive.' },
  { id: 'doj', label: 'DOJ / prosecution', description: 'Overview, persons, vehicles, evidence index, reports, charges and legal instruments.' },
  { id: 'command', label: 'Command brief', description: 'Cover, overview, summary, investigators, evidence index, timeline and signatures.' },
  { id: 'disclosure', label: 'Disclosure', description: 'Cover, overview, reports and the evidence index — the minimum a disclosure requires.' },
  { id: 'custom', label: 'Custom', description: 'Pick the sections yourself.' },
] as const
export type PacketType = (typeof PACKET_TYPES)[number]['id']

/** The 18 section ids in the order the renderer prints them. */
export const PACKET_SECTIONS = [
  { id: 'cover', label: 'Cover page' },
  { id: 'overview', label: 'Case overview' },
  { id: 'summary', label: 'Summary' },
  { id: 'investigators', label: 'Investigators' },
  { id: 'persons', label: 'Persons' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'gangs', label: 'Gangs' },
  { id: 'places', label: 'Places' },
  { id: 'narcotics', label: 'Narcotics' },
  { id: 'reports', label: 'Reports' },
  { id: 'evidence_index', label: 'Evidence index' },
  { id: 'evidence_images', label: 'Evidence images' },
  { id: 'charges', label: 'Charges' },
  { id: 'warrants', label: 'Warrants' },
  { id: 'subpoenas', label: 'Subpoenas' },
  { id: 'legal_decisions', label: 'Legal decisions' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'signatures', label: 'Signatures' },
] as const
export type PacketSectionId = (typeof PACKET_SECTIONS)[number]['id']
export const PACKET_SECTION_IDS: readonly PacketSectionId[] = PACKET_SECTIONS.map((s) => s.id)

/** The server's default sections per type (contract §2.5, verbatim). The
 *  dialog pre-fills the checklist from this; the RPC applies the same preset
 *  when `p_sections` is null, so the two can never disagree in what a type
 *  means. `custom` starts empty — "as given". */
export const DEFAULT_PACKET_SECTIONS: Record<PacketType, readonly PacketSectionId[]> = {
  full: PACKET_SECTION_IDS,
  doj: ['cover', 'overview', 'summary', 'persons', 'vehicles', 'evidence_index', 'reports', 'charges', 'warrants', 'subpoenas', 'legal_decisions', 'timeline'],
  command: ['cover', 'overview', 'summary', 'investigators', 'evidence_index', 'timeline', 'signatures'],
  disclosure: ['cover', 'overview', 'reports', 'evidence_index'],
  custom: [],
}

export const isPacketType = (s: string | null | undefined): s is PacketType =>
  !!s && PACKET_TYPES.some((t) => t.id === s)

export const isPacketSection = (s: string | null | undefined): s is PacketSectionId =>
  !!s && (PACKET_SECTION_IDS as readonly string[]).includes(s)

export function packetTypeLabel(type: string | null | undefined): string {
  return PACKET_TYPES.find((t) => t.id === type)?.label ?? (type || 'Packet')
}

export function sectionLabel(id: string): string {
  return PACKET_SECTIONS.find((s) => s.id === id)?.label ?? id.replace(/_/g, ' ')
}

/** Sections in renderer order, unknown ids dropped, duplicates collapsed —
 *  what the dialog submits regardless of click order. */
export function normalizeSections(ids: readonly string[]): PacketSectionId[] {
  const want = new Set(ids)
  return PACKET_SECTION_IDS.filter((id) => want.has(id))
}

/* ── Status ─────────────────────────────────────────────────────────────── */

export type PacketStatus = 'queued' | 'rendering' | 'ready' | 'failed' | 'cancelled'
export type PacketTone = 'neutral' | 'accent' | 'good' | 'warn' | 'danger'

const PACKET_STATUS: Record<PacketStatus, { label: string; tone: PacketTone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  rendering: { label: 'Rendering', tone: 'accent' },
  ready: { label: 'Ready', tone: 'good' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'warn' },
}

export function packetStatusLabel(status: string | null | undefined): string {
  return PACKET_STATUS[(status ?? '') as PacketStatus]?.label ?? (status || 'Unknown')
}

export function packetStatusTone(status: string | null | undefined): PacketTone {
  return PACKET_STATUS[(status ?? '') as PacketStatus]?.tone ?? 'neutral'
}

/** A packet the requester may still withdraw — only while nothing has
 *  claimed the job (the server's rule for `background_job_cancel`). */
export const packetCancellable = (p: Pick<PacketRow, 'status' | 'job_id'>): boolean =>
  p.status === 'queued' && !!p.job_id

/** A packet an Owner may re-queue (`background_job_retry`: failed/cancelled). */
export const packetRetryable = (p: Pick<PacketRow, 'status' | 'job_id'>): boolean =>
  (p.status === 'failed' || p.status === 'cancelled') && !!p.job_id

/* ── JSON RPC result folding ────────────────────────────────────────────── */

/** The platform RPCs answer jsonb `{ok:true, …}` or `{ok:false, code,
 *  message}` for validation refusals and RAISE (P0403) for authority ones.
 *  Both shapes fold into one result so every caller toasts the same way. */
export interface JsonRpcOutcome<T extends Record<string, unknown> = Record<string, unknown>> {
  ok: boolean
  message: string | null
  code: string | null
  data: T | null
}

export function unwrapJsonRpc<T extends Record<string, unknown> = Record<string, unknown>>(res: MutationResult<Json>): JsonRpcOutcome<T> {
  if (res.error) return { ok: false, message: humanizeError(res.error.message), code: res.error.code ?? null, data: null }
  const d = res.data
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, message: 'Unexpected server response.', code: null, data: null }
  const obj = d as Record<string, unknown>
  if (obj.ok === false) {
    return {
      ok: false,
      message: typeof obj.message === 'string' ? obj.message : 'The server refused this action.',
      code: typeof obj.code === 'string' ? obj.code : null,
      data: obj as T,
    }
  }
  return { ok: true, message: null, code: null, data: obj as T }
}

/* ── Data access ────────────────────────────────────────────────────────── */

export interface PacketRequestOptions {
  watermark?: string | null
  note?: string | null
}

export type PacketRequestResult = JsonRpcOutcome<{ id?: string; job_id?: string }>

/** Ask the server for a packet. `sections` null → the server's preset for
 *  the type. Never blocks on the render: the answer is the packet id. */
export async function requestPacket(
  caseId: string,
  type: PacketType,
  sections: readonly PacketSectionId[] | null,
  options: PacketRequestOptions = {},
): Promise<PacketRequestResult> {
  const p_options: Record<string, Json> = {}
  if (options.watermark?.trim()) p_options.watermark = options.watermark.trim()
  if (options.note?.trim()) p_options.note = options.note.trim()
  return unwrapJsonRpc(await rpc('case_packet_request', {
    p_case: caseId,
    p_type: type,
    p_sections: sections ? normalizeSections(sections) : null,
    p_options,
  }))
}

/** The case's live packets, newest first. `case_packets` is not in db.ts's
 *  SOFT_DELETE_KIND yet, so the live filter is explicit here. RLS scopes
 *  the rows (can_read_case); an Owner also sees deleted ones — we hide them. */
export function fetchPackets(caseId: string): Promise<PacketRow[]> {
  return list('case_packets', { eq: { case_id: caseId }, is: { deleted_at: null }, order: 'created_at', ascending: false })
}

/** A 300 s signed URL for the rendered PDF, or null when the packet has no
 *  file yet / the bucket refuses (the storage policy re-checks can_read_case). */
export async function packetSignedUrl(packet: Pick<PacketRow, 'storage_path'>, expiresIn = PACKET_URL_TTL_S): Promise<string | null> {
  if (!packet.storage_path) return null
  const { data, error } = await supabase().storage.from(PACKET_BUCKET).createSignedUrl(packet.storage_path, expiresIn)
  return error ? null : (data?.signedUrl ?? null)
}

/** Sibling object of the packet PDF (`manifest.json` / `manifest.sha256`)
 *  as a signed URL — the same folder, the same policy. */
export async function packetSiblingUrl(packet: Pick<PacketRow, 'storage_path'>, file: 'manifest.json' | 'manifest.sha256', expiresIn = PACKET_URL_TTL_S): Promise<string | null> {
  if (!packet.storage_path) return null
  const dir = packet.storage_path.replace(/[^/]*$/, '')
  const { data, error } = await supabase().storage.from(PACKET_BUCKET).createSignedUrl(`${dir}${file}`, expiresIn)
  return error ? null : (data?.signedUrl ?? null)
}

/** Record the download (audit CASE_PACKET_DOWNLOADED) — call BEFORE opening
 *  the signed URL; a refusal means the viewer may not have the file either. */
export async function logPacketAccess(packetId: string): Promise<MutationResult<boolean>> {
  return rpc('case_packet_access_log', { p_packet: packetId })
}

export async function fetchManifest(id: string): Promise<ExportManifestRow | null> {
  const rows = await list('export_manifests', { eq: { id }, limit: 1 })
  return rows[0] ?? null
}

/** Withdraw a queued job (creator while queued, or Owner). */
export async function cancelJob(jobId: string, reason: string): Promise<JsonRpcOutcome> {
  return unwrapJsonRpc(await rpc('background_job_cancel', { p_id: jobId, p_reason: reason }))
}

/** Owner: re-queue a failed / cancelled job with attempts reset. */
export async function retryJob(jobId: string): Promise<JsonRpcOutcome> {
  return unwrapJsonRpc(await rpc('background_job_retry', { p_id: jobId }))
}

/** The case's jobs the viewer may see (RLS: Owner, or the creator). */
export function fetchCaseJobs(caseId: string): Promise<BackgroundJobRow[]> {
  return list('background_jobs', { eq: { case_id: caseId }, order: 'created_at', ascending: false, limit: 50 })
}

/* ── Jobs vocabulary (shared by the JobsTray) ───────────────────────────── */

export type JobStatus = 'queued' | 'claimed' | 'running' | 'succeeded' | 'failed' | 'cancelled'

const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: 'Queued', claimed: 'Starting', running: 'Running', succeeded: 'Done', failed: 'Failed', cancelled: 'Cancelled',
}

export function jobStatusLabel(status: string | null | undefined): string {
  return JOB_STATUS_LABEL[(status ?? '') as JobStatus] ?? (status || 'Unknown')
}

/** Whether THIS viewer may withdraw the job from the client (cosmetic — the
 *  RPC re-checks): Owner any time it is still queued, creator while queued. */
export const jobCancellable = (j: Pick<BackgroundJobRow, 'status' | 'created_by'>, viewerId: string | null, isOwner: boolean): boolean =>
  j.status === 'queued' && (isOwner || (!!viewerId && j.created_by === viewerId))

export const jobRetryable = (j: Pick<BackgroundJobRow, 'status'>, isOwner: boolean): boolean =>
  isOwner && (j.status === 'failed' || j.status === 'cancelled')

/** A job still doing (or about to do) work. */
export const jobActive = (j: Pick<BackgroundJobRow, 'status'>): boolean =>
  j.status === 'queued' || j.status === 'claimed' || j.status === 'running'
