'use client'

/** Evidence — the client half of the `case-evidence` bucket + the evidence
 *  columns on `media` (20261105120000_platform_upgrade.sql §2.3 / §2.4).
 *
 *  ── The order of operations is the integrity story ──────────────────────
 *  The browser hashes the ORIGINAL bytes first, inserts the media row (which
 *  is what the bucket's insert policy checks: the row must exist, be ours,
 *  and name this exact object path), uploads with `upsert:false`, then calls
 *  `evidence_register`, which stores the digest, mints the EV number, writes
 *  the first custody events and queues the server-side re-hash. Nothing in
 *  this file is a check — RLS on `media`, the storage policies and the
 *  definer RPCs refuse regardless of what the client claims.
 *
 *  ── Legacy rows keep working ────────────────────────────────────────────
 *  A FiveManage row (`external_url`, no storage path) has no bytes we can
 *  hash, so it has no integrity status and no custody chain. The helpers
 *  here say so (`isExternalHosted`) and the UI shows a neutral line instead
 *  of a badge — never a fake "verified".
 *
 *  Data access goes through `src/lib/db.ts`; the only direct client use is
 *  `supabase().storage` for the object upload and signed reads (there is no
 *  db.ts wrapper for Storage, same as `fieldEvidence.ts`). */
import { useEffect, useState } from 'react'
import { insert, list, rpc, softDeleteRecord, type MutationResult } from './db'
import type { Database, Json, Tables } from './database.types'
import { normalizeHex, sha256Hex } from './hash'
import { supabase } from './supabase'
import { humanizeError } from './toast'

export type MediaRow = Tables<'media'>
export type MediaType = Database['public']['Enums']['media_type']
export type CustodyEventRow = Tables<'evidence_custody_events'>
export type BackgroundJobRow = Tables<'background_jobs'>
export type ExportManifestRow = Tables<'export_manifests'>

/* ── Constants (mirror the bucket, §2.3) ───────────────────────────────── */

export const EVIDENCE_BUCKET = 'case-evidence'

/** 100 MiB — the bucket's own limit. Larger files fall back to FiveManage
 *  when that host is configured (no hash, no custody), else are refused. */
export const MAX_EVIDENCE_BYTES = 100 * 1024 * 1024

/** Whole-family prefixes the bucket accepts (`image/*`, `audio/*`). */
export const EVIDENCE_MIME_PREFIXES = ['image/', 'audio/'] as const

/** Exact MIME types the bucket accepts beyond the prefixes above. */
export const EVIDENCE_MIME = [
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf', 'text/plain', 'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const

/** `<input accept>` string for the storage path. */
export const EVIDENCE_ACCEPT = ['image/*', 'audio/*', ...EVIDENCE_MIME].join(',')

export const CLASSIFICATIONS = ['unclassified', 'sensitive', 'restricted'] as const
export type Classification = (typeof CLASSIFICATIONS)[number]

export type IntegrityStatus = 'unverified' | 'verified' | 'failed'

/** Which host new uploads go to. Supabase Storage is the default; FiveManage
 *  only when the env says so explicitly (legacy deployments). */
export type EvidenceHost = 'supabase' | 'fivemanage'
export function evidenceHost(): EvidenceHost {
  return process.env.NEXT_PUBLIC_EVIDENCE_HOST === 'fivemanage' ? 'fivemanage' : 'supabase'
}

/* ── Pure helpers ──────────────────────────────────────────────────────── */

export function evidenceMimeAccepted(mime: string): boolean {
  const m = (mime || '').toLowerCase()
  if (!m) return false
  if (EVIDENCE_MIME_PREFIXES.some((p) => m.startsWith(p))) return true
  return (EVIDENCE_MIME as readonly string[]).includes(m)
}

/** Why this file cannot be uploaded to the evidence bucket, or null. Mirrors
 *  the bucket's own limits so the officer hears it before 100 MB moves. */
export function evidenceFileProblem(file: { size: number; type: string }): string | null {
  if (file.size === 0) return 'That file is empty.'
  if (!evidenceMimeAccepted(file.type)) {
    return 'That file type is not accepted. Use an image, audio, MP4/WebM/MOV video, PDF, text, ZIP, DOCX or XLSX file.'
  }
  if (file.size > MAX_EVIDENCE_BYTES) {
    return `That file is ${(file.size / 1048576).toFixed(0)} MB. The evidence limit is 100 MB.`
  }
  return null
}

/** media.type from a MIME type. The enum has no `audio` member — audio rows
 *  keep the historical `fivemanage` type the FiveManage pilot used, so every
 *  reader that already treats `fivemanage` as audio keeps working. */
export function mediaTypeForMime(mime: string): MediaType {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'fivemanage'
  return 'document'
}

/** `case/<case_id>/<media_id>/original.<ext>` — the storage policy reads the
 *  case id from segment 2 and the media id from segment 3; the prefix is
 *  not decoration. The extension is sanitised and bounded; `bin` when the
 *  name has none. */
export function evidencePath(caseId: string, mediaId: string, filename: string): string {
  const raw = filename.includes('.') ? filename.split('.').pop() ?? '' : ''
  const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin'
  return `case/${caseId}/${mediaId}/original.${ext}`
}

type HostShape = Pick<MediaRow, 'external_url' | 'storage_path'>

/** Bytes live in the `case-evidence` bucket (a path, not a URL). */
export function isStorageHosted(row: HostShape): boolean {
  return !!row.storage_path && !/^https?:\/\//i.test(row.storage_path)
}

/** Bytes live somewhere else (FiveManage / pasted link) — nothing to hash. */
export function isExternalHosted(row: HostShape): boolean {
  return !isStorageHosted(row)
}

/** The row is a derivative (preview, OCR, redaction…) of another media row. */
export function isDerivative(row: Pick<MediaRow, 'parent_media_id'>): boolean {
  return row.parent_media_id != null
}

/** Registered through `evidence_register` (has a minted EV number). */
export function isRegisteredEvidence(row: Pick<MediaRow, 'evidence_number'>): boolean {
  return !!row.evidence_number
}

/** Designated evidence of either generation: a registered EV number or the
 *  legacy `media_designate_evidence` reference. */
export function isEvidenceRow(row: Pick<MediaRow, 'evidence_number' | 'evidence_ref'>): boolean {
  return !!row.evidence_number || !!row.evidence_ref
}

export function evidenceNumberOf(row: Pick<MediaRow, 'evidence_number' | 'evidence_ref'>): string | null {
  return row.evidence_number ?? row.evidence_ref ?? null
}

/** Lower-case hex of the stored digest (PostgREST bytea → `\x…`). */
export function sha256HexOf(row: Pick<MediaRow, 'sha256'>): string {
  return normalizeHex(row.sha256)
}

/** The direct URL for an external row, or null when the bytes need signing. */
export function externalSrcOf(row: HostShape): string | null {
  if (row.external_url) return row.external_url
  if (row.storage_path && /^https?:\/\//i.test(row.storage_path)) return row.storage_path
  return null
}

/** Coerce a raw column value to the three integrity states the UI knows. */
export function integrityStatusOf(status: string | null | undefined): IntegrityStatus {
  return status === 'verified' || status === 'failed' ? status : 'unverified'
}

/** Badge text. Upper-case is deliberate: an integrity state is a semantic
 *  marking, not a section label (DESIGN-SYSTEM "Typography"). */
export function integrityLabel(status: string | null | undefined): string {
  switch (status) {
    case 'verified': return 'VERIFIED'
    case 'failed': return 'INTEGRITY FAILURE'
    default: return 'UNVERIFIED'
  }
}

/** Badge tone paired with the label — the label always renders, so colour
 *  is never the only signal. */
export function integrityTone(status: string | null | undefined): 'good' | 'danger' | 'warn' {
  switch (status) {
    case 'verified': return 'good'
    case 'failed': return 'danger'
    default: return 'warn'
  }
}

const CUSTODY_LABEL: Record<string, string> = {
  COLLECTED: 'Collected',
  UPLOADED: 'Uploaded',
  REGISTERED: 'Registered as evidence',
  VIEWED: 'Viewed',
  DOWNLOADED: 'Downloaded',
  TRANSFERRED: 'Custody transferred',
  ASSIGNED: 'Custodian assigned',
  PROCESSED: 'Processed',
  DERIVATIVE_CREATED: 'Derivative created',
  OCR_PROCESSED: 'Text extracted (OCR)',
  REDACTED: 'Redaction created',
  EXPORTED: 'Exported',
  PACKET_INCLUDED: 'Included in a case packet',
  VERIFIED: 'Integrity verified',
  SEALED: 'Sealed',
  RELEASED: 'Released',
  ARCHIVED: 'Archived',
  INTEGRITY_FAILURE: 'Integrity failure',
}

export function custodyEventLabel(type: string | null | undefined): string {
  if (!type) return 'Event'
  return CUSTODY_LABEL[type] ?? type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ')
}

const DERIVATIVE_LABEL: Record<string, string> = {
  preview: 'Preview', thumbnail: 'Thumbnail', ocr: 'OCR text', compressed: 'Compressed copy',
  redacted: 'Redacted copy', converted: 'Converted copy', packet: 'Packet render', generated: 'Generated document',
}
export function derivativeTypeLabel(type: string | null | undefined): string {
  if (!type) return 'Derivative'
  return DERIVATIVE_LABEL[type] ?? type
}

export function classificationLabel(c: string | null | undefined): string {
  switch (c) {
    case 'sensitive': return 'Sensitive'
    case 'restricted': return 'Restricted'
    case 'unclassified': return 'Unclassified'
    default: return 'Unclassified'
  }
}

const obj = (v: Json | null | undefined): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
const str = (o: Record<string, unknown>, k: string): string | null =>
  typeof o[k] === 'string' && o[k] ? (o[k] as string) : null

/** `{expected, actual}` from the most recent INTEGRITY_FAILURE event, if any. */
export function integrityFailureDetail(
  events: readonly Pick<CustodyEventRow, 'event_type' | 'metadata'>[],
): { expected: string | null; actual: string | null } | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].event_type !== 'INTEGRITY_FAILURE') continue
    const m = obj(events[i].metadata)
    return { expected: normalizeHex(str(m, 'expected')) || str(m, 'expected'), actual: normalizeHex(str(m, 'actual')) || str(m, 'actual') }
  }
  return null
}

/** Does this manifest (export_manifests.manifest) reference the media row —
 *  through `files[].source.id` or the `source_evidence_ids` list? */
export function manifestIncludesMedia(manifest: Json | null | undefined, mediaId: string): boolean {
  const m = obj(manifest)
  const ids = Array.isArray(m.source_evidence_ids) ? (m.source_evidence_ids as unknown[]) : []
  if (ids.includes(mediaId)) return true
  const files = Array.isArray(m.files) ? (m.files as unknown[]) : []
  return files.some((f) => {
    const src = obj(obj(f as Json).source as Json)
    return (src.kind === 'media' || src.kind === undefined) && src.id === mediaId
  })
}

export interface JobProgress { pct: number | null; step: string | null; message: string | null }
export function jobProgressOf(job: Pick<BackgroundJobRow, 'progress'>): JobProgress {
  const p = obj(job.progress)
  const pct = typeof p.pct === 'number' && Number.isFinite(p.pct) ? Math.max(0, Math.min(100, p.pct)) : null
  return { pct, step: str(p, 'step'), message: str(p, 'message') }
}

export function jobKindLabel(kind: string): string {
  switch (kind) {
    case 'evidence.verify': return 'Integrity verification'
    case 'evidence.derive': return 'Derivative generation'
    case 'document.extract': return 'Document extraction'
    case 'pdf.tool': return 'Document tool'
    case 'search.sync': return 'Search index sync'
    case 'embeddings.generate': return 'Embeddings'
    default: return kind
  }
}

export function jobStatusTone(status: string): 'neutral' | 'accent' | 'good' | 'warn' | 'danger' {
  switch (status) {
    case 'succeeded': return 'good'
    case 'failed': return 'danger'
    case 'cancelled': return 'neutral'
    case 'running':
    case 'claimed': return 'accent'
    default: return 'warn'
  }
}

/* ── RPC outcomes ──────────────────────────────────────────────────────── */

/** Definer RPCs answer two ways: a raise (authority → P0403, surfaced as
 *  `error`) or a jsonb `{ok:false, code, message}` for validation. Both
 *  collapse to one shape the UI can toast. */
export interface RpcOutcome<T extends Record<string, unknown> = Record<string, unknown>> {
  ok: boolean
  message: string | null
  data: T | null
}

function jsonOutcome<T extends Record<string, unknown>>(res: MutationResult<Json>): RpcOutcome<T> {
  if (res.error) return { ok: false, message: humanizeError(res.error.message), data: null }
  const d = obj(res.data)
  if (d.ok === false) return { ok: false, message: str(d, 'message') ?? str(d, 'code') ?? 'Refused', data: d as T }
  return { ok: true, message: null, data: d as T }
}

/* ── Upload ────────────────────────────────────────────────────────────── */

export type UploadPhase = 'hashing' | 'saving' | 'uploading' | 'registering'

export const UPLOAD_PHASE_LABEL: Record<UploadPhase, string> = {
  hashing: 'Hashing…', saving: 'Saving…', uploading: 'Uploading…', registering: 'Registering…',
}

export interface UploadEvidenceArgs {
  caseId: string
  file: File
  /** Falls back to the filename without its extension. */
  title?: string
  category?: string | null
  restricted?: boolean
  uploaderId: string | null
  collectedBy?: string | null
  collectedAt?: string | null
  location?: string | null
  source?: string | null
  classification?: Classification | null
}

export interface UploadEvidenceResult {
  mediaId: string
  evidenceNumber: string | null
  jobId: string | null
  row: MediaRow
}

/** Hash + row + object, staged for registration. Returned so a failed
 *  `registerEvidence` can be retried without moving the bytes again. */
export interface StagedEvidence { mediaId: string; sha256: string; row: MediaRow; file: File }

/** Validate → hash → insert row → upload object. Throws an Error with an
 *  officer-readable message on any failure; a failed OBJECT upload rolls
 *  the row back (it is ours, and a row without bytes is worse than no row). */
export async function stageEvidence(
  args: UploadEvidenceArgs,
  onProgress?: (phase: UploadPhase) => void,
): Promise<StagedEvidence> {
  const { file } = args
  const problem = evidenceFileProblem(file)
  if (problem) throw new Error(problem)

  onProgress?.('hashing')
  const sha = await sha256Hex(file)

  const mediaId = crypto.randomUUID()
  const path = evidencePath(args.caseId, mediaId, file.name)
  const title = (args.title ?? '').trim() || file.name.replace(/\.[a-z0-9]+$/i, '') || file.name

  onProgress?.('saving')
  const ins = await insert('media', {
    id: mediaId,
    case_id: args.caseId,
    title,
    type: mediaTypeForMime(file.type),
    storage_path: path,
    mime: file.type,
    byte_size: file.size,
    original_filename: file.name,
    uploaded_by: args.uploaderId,
    category: args.category ?? null,
    restricted: args.restricted ?? false,
    tags: { source_filename: file.name } as Json,
  })
  if (ins.error || !ins.data?.[0]) throw new Error(ins.error?.message || 'Could not save the media record.')
  const row = ins.data[0]

  onProgress?.('uploading')
  const up = await supabase().storage.from(EVIDENCE_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false, // originals are immutable — never overwrite an object another row names
  })
  if (up.error) {
    await softDeleteRecord('media', mediaId, 'Upload failed — the object never arrived').catch(() => undefined)
    throw new Error(up.error.message)
  }
  return { mediaId, sha256: sha, row, file }
}

/** `evidence_register`: stores the digest, mints the EV number, writes the
 *  first custody events and queues the server-side re-hash. Throws on
 *  refusal — the row + object stay (the bytes are safe; retry registers). */
export async function registerEvidence(staged: StagedEvidence, args: Omit<UploadEvidenceArgs, 'file'>): Promise<UploadEvidenceResult> {
  const { file, mediaId, row } = staged
  const reg = jsonOutcome<{ evidence_number?: string; job_id?: string }>(await rpc('evidence_register', {
    p_media: mediaId,
    p_sha256: staged.sha256,
    p_byte_size: file.size,
    p_mime: file.type,
    p_original_filename: file.name,
    p_collected_by: args.collectedBy ?? null,
    p_collected_at: args.collectedAt ?? null,
    p_location: args.location ?? null,
    p_source: args.source ?? null,
    p_classification: args.classification ?? null,
  }))
  if (!reg.ok) throw new Error(`Uploaded, but not registered as evidence — ${reg.message ?? 'refused'}`)
  const evidenceNumber = reg.data?.evidence_number ?? null
  return {
    mediaId,
    evidenceNumber,
    jobId: reg.data?.job_id ?? null,
    row: { ...row, evidence_number: evidenceNumber, sha256: staged.sha256, integrity_status: 'unverified', current_custodian: args.uploaderId },
  }
}


/* ── Signed reads ──────────────────────────────────────────────────────── */

const SIGNED_TTL_S = 300
const CACHE_TTL_MS = 4 * 60 * 1000 // re-sign a minute before the URL expires
const signedCache = new Map<string, { url: string; exp: number }>()

function peekSigned(path: string): string | null {
  const hit = signedCache.get(path)
  if (hit && hit.exp > Date.now()) return hit.url
  if (hit) signedCache.delete(path)
  return null
}

/** A short-lived URL for one object. Null when the storage policy refuses —
 *  that decision is the server's, not this function's. */
export async function evidenceSignedUrl(storagePath: string, seconds = SIGNED_TTL_S): Promise<string | null> {
  if (seconds === SIGNED_TTL_S) {
    const hit = peekSigned(storagePath)
    if (hit) return hit
  }
  const { data, error } = await supabase().storage.from(EVIDENCE_BUCKET).createSignedUrl(storagePath, seconds)
  const url = error ? null : (data?.signedUrl ?? null)
  if (url && seconds === SIGNED_TTL_S) signedCache.set(storagePath, { url, exp: Date.now() + CACHE_TTL_MS })
  return url
}

/** A signed URL that makes the browser SAVE the object under its original
 *  name (Content-Disposition), for the Download action. Never cached. */
export async function evidenceDownloadUrl(row: Pick<MediaRow, 'storage_path' | 'original_filename' | 'title'>): Promise<string | null> {
  if (!row.storage_path) return null
  const { data, error } = await supabase().storage
    .from(EVIDENCE_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_TTL_S, { download: row.original_filename || row.title || true })
  return error ? null : (data?.signedUrl ?? null)
}

/** The displayable source for a row: its external URL, or a signed URL for
 *  a storage-hosted object (cached 4 min). Null while signing or when the
 *  policy refused. */
export function useMediaSrc(row: HostShape | null | undefined): string | null {
  const external = row ? externalSrcOf(row) : null
  const path = row && isStorageHosted(row) ? row.storage_path : null
  const cached = path ? peekSigned(path) : null
  const [signed, setSigned] = useState<{ path: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!path || peekSigned(path)) return
    let alive = true
    void evidenceSignedUrl(path).then((url) => { if (alive) setSigned({ path, url }) })
    return () => { alive = false }
  }, [path])
  if (external) return external
  if (!path) return null
  return cached ?? (signed?.path === path ? signed.url : null)
}

/* ── Access + custody RPCs ─────────────────────────────────────────────── */

/** Fire-and-forget access trail. Registered evidence gets a custody event
 *  (server de-dupes VIEWED per actor / 10 min); restricted rows ALSO keep
 *  the pre-existing restricted-access log the D6 audit reads. */
export function logEvidenceAccess(
  row: Pick<MediaRow, 'id' | 'restricted' | 'evidence_number'>,
  action: 'viewed' | 'downloaded',
): void {
  if (isRegisteredEvidence(row)) {
    void rpc('evidence_access_log', { p_media: row.id, p_action: action }).catch(() => undefined)
  }
  if (row.restricted) {
    void rpc('log_restricted_view', {
      p_entity_type: 'media', p_entity: row.id, ...(action === 'downloaded' ? { p_action: 'download' } : {}),
    }).catch(() => undefined)
  }
}

export async function requestVerify(mediaId: string): Promise<RpcOutcome<{ job_id?: string }>> {
  return jsonOutcome(await rpc('evidence_verify_request', { p_media: mediaId }))
}

export async function transferCustody(mediaId: string, to: string, reason: string): Promise<RpcOutcome> {
  return jsonOutcome(await rpc('evidence_custody_transfer', { p_media: mediaId, p_to: to, p_reason: reason }))
}

export async function sealEvidence(mediaId: string): Promise<RpcOutcome> {
  return jsonOutcome(await rpc('evidence_seal', { p_media: mediaId }))
}

export async function releaseEvidence(mediaId: string, reason: string): Promise<RpcOutcome> {
  return jsonOutcome(await rpc('evidence_release', { p_media: mediaId, p_reason: reason }))
}

export interface ChainVerifyResult { ok: boolean; events: number; first_bad_id: number | null }

/** Recompute the custody hash chain server-side. Null on a transport error. */
export async function verifyChain(mediaId: string): Promise<ChainVerifyResult | null> {
  const res = await rpc('evidence_chain_verify', { p_media: mediaId })
  if (res.error) return null
  const d = obj(res.data)
  return {
    ok: d.ok === true,
    events: typeof d.events === 'number' ? d.events : 0,
    first_bad_id: typeof d.first_bad_id === 'number' ? d.first_bad_id : null,
  }
}

/* ── Reads ─────────────────────────────────────────────────────────────── */

/** Append-only custody trail, oldest first (id order = chain order). */
export async function fetchCustody(mediaId: string): Promise<CustodyEventRow[]> {
  return list('evidence_custody_events', { eq: { media_id: mediaId }, order: 'id' })
}

export async function fetchDerivatives(parentId: string): Promise<MediaRow[]> {
  return list('media', { eq: { parent_media_id: parentId }, order: 'created_at' })
}

/** Jobs about this media row. RLS returns the creator's own jobs (and
 *  everything for the Owner) — absence here is the permission answer. */
export async function fetchMediaJobs(mediaId: string): Promise<BackgroundJobRow[]> {
  return list('background_jobs', { eq: { subject_kind: 'media', subject_id: mediaId }, order: 'created_at', ascending: false })
}

/** Manifests of the case that reference this media (filtered client-side —
 *  the manifest is jsonb and the list per case is small). */
export async function fetchExportHistory(caseId: string, mediaId: string): Promise<ExportManifestRow[]> {
  const rows = await list('export_manifests', { eq: { case_id: caseId }, order: 'created_at', ascending: false })
  return rows.filter((r) => manifestIncludesMedia(r.manifest, mediaId))
}

/** Reports that reference this media through the report-entities table. */
export async function fetchRelatedReportIds(mediaId: string): Promise<string[]> {
  const rows = await list('report_entities', { select: 'report_id', eq: { kind: 'media', ref_id: mediaId } })
  return [...new Set((rows as unknown as { report_id: string }[]).map((r) => r.report_id).filter(Boolean))]
}

/** `feature_flags` read for one key, with the documented env override
 *  (`NEXT_PUBLIC_ENABLE_<KEY>=on|off` wins over the row). Interim: the
 *  shared `useFeatureFlags()` store (Client D) supersedes this hook. */
export function useEvidenceSealingFlag(): boolean {
  const env = process.env.NEXT_PUBLIC_ENABLE_EVIDENCE_SEALING
  const forced = env === 'on' ? true : env === 'off' ? false : null
  const [row, setRow] = useState<boolean | null>(null)
  useEffect(() => {
    if (forced !== null) return
    let alive = true
    void list('feature_flags', { eq: { key: 'evidence_sealing' } })
      .then((rows) => { if (alive) setRow(rows[0]?.enabled === true) })
      .catch(() => { if (alive) setRow(false) })
    return () => { alive = false }
  }, [forced])
  return forced ?? row ?? false
}
