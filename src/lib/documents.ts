/** The case Documents tab's data layer (platform upgrade §5.2): the six
 *  sections — Reports, Evidence Documents, Legal Documents, Generated
 *  Documents, Case Packets, and the case's background jobs — plus the
 *  document tools vocabulary, page extraction / search and the viewer's
 *  `#page=N` deep link.
 *
 *  Everything reads through db.ts under RLS: a legal request the viewer
 *  cannot read, a restricted media row, a job somebody else created simply
 *  do not come back — no counts, no placeholders. Long work (extraction,
 *  tools, packets) is a `background_jobs` row the UI never waits on. */
import { list, rpc, type MutationResult } from './db'
import type { Database, Json, Tables } from './database.types'
import { supabase } from './supabase'
import { EVIDENCE_BUCKET, evidenceSignedUrl, logEvidenceAccess } from './evidence'
import { fetchCaseJobs, fetchPackets, unwrapJsonRpc, type BackgroundJobRow, type JsonRpcOutcome, type PacketRow } from './packets'

export type MediaRow = Tables<'media'>
export type ReportRow = Tables<'reports'>
export type LegalRequestRow = Tables<'legal_requests'>
export type DocumentExtractionRow = Tables<'document_extractions'>
export type DocumentSearchHit = Database['public']['Functions']['document_search']['Returns'][number]

/* ── Which media rows are documents ─────────────────────────────────────── */

/** MIME families the extraction pipeline understands (pdf / text / docx). */
const DOCUMENT_MIME = /^(application\/pdf|text\/|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/msword)/i

export const GENERATED_DERIVATIVE_TYPES = ['generated', 'converted', 'ocr', 'redacted', 'compressed'] as const

/** Derivative types that count toward the Documents tab pill (the contract's
 *  list — `compressed` is listed in the section but not in the count). */
export const COUNTED_DERIVATIVE_TYPES: readonly string[] = ['generated', 'converted', 'ocr', 'redacted']

type MediaLike = Pick<MediaRow, 'type' | 'mime' | 'derivative_type'>

export const isDocumentMedia = (m: MediaLike): boolean =>
  m.type === 'document' || (!!m.mime && DOCUMENT_MIME.test(m.mime))

export const isGeneratedMedia = (m: Pick<MediaRow, 'derivative_type'>): boolean =>
  !!m.derivative_type && (GENERATED_DERIVATIVE_TYPES as readonly string[]).includes(m.derivative_type)

/** An original document (not a derivative) — the Evidence Documents rows. */
export const isEvidenceDocument = (m: MediaLike & Pick<MediaRow, 'parent_media_id' | 'archived_at'>): boolean =>
  isDocumentMedia(m) && !m.parent_media_id && !m.archived_at

/** Media rows the tab pill counts: type document, or a counted derivative. */
export const countsAsDocument = (m: MediaLike): boolean =>
  m.type === 'document' || (!!m.derivative_type && COUNTED_DERIVATIVE_TYPES.includes(m.derivative_type))

/* ── Extraction state ───────────────────────────────────────────────────── */

export type ExtractionState = 'ready' | 'queued' | 'failed' | 'none'

export function extractionState(x: Pick<DocumentExtractionRow, 'status'> | null | undefined): ExtractionState {
  if (!x) return 'none'
  if (x.status === 'ready' || x.status === 'queued' || x.status === 'failed') return x.status
  return 'none'
}

export const EXTRACTION_LABEL: Record<ExtractionState, string> = {
  ready: 'Ready',
  queued: 'Queued',
  failed: 'Failed',
  none: 'Not processed',
}

export const EXTRACTION_TONE: Record<ExtractionState, 'good' | 'accent' | 'danger' | 'neutral'> = {
  ready: 'good',
  queued: 'accent',
  failed: 'danger',
  none: 'neutral',
}

/** A document the viewer may (re)process: never processed, or failed. A
 *  legacy external-host row (no storage_path) cannot be — nothing to read. */
export const canRequestExtraction = (m: Pick<MediaRow, 'storage_path'>, state: ExtractionState): boolean =>
  !!m.storage_path && (state === 'none' || state === 'failed')

/* ── Document tools (contract §2.5 document_tool_request) ───────────────── */

export type ToolNeeds = 'basic' | 'stirling'

export interface DocumentTool {
  id: DocumentToolId
  label: string
  description: string
  /** `basic` = the in-Supabase runner handles it (pdf-lib); `stirling` needs
   *  the optional document service (feature flag `stirling_pdf`). */
  needs: ToolNeeds
  /** Options the tool dialog offers. */
  options?: ReadonlyArray<'pages' | 'rotation' | 'watermark'>
  /** Minimum number of input documents (merge / compare need two). */
  minInputs?: number
}

export const DOCUMENT_TOOL_IDS = [
  'merge', 'split', 'extract_pages', 'rearrange', 'rotate', 'crop', 'compress', 'ocr', 'image_to_pdf', 'pdf_to_images',
  'watermark', 'page_numbers', 'flatten', 'metadata_inspect', 'metadata_remove', 'sanitize', 'repair', 'compare', 'redact',
] as const
export type DocumentToolId = (typeof DOCUMENT_TOOL_IDS)[number]

/** The six tools the built-in runner can do without Stirling. */
export const BASIC_TOOLS: ReadonlySet<DocumentToolId> = new Set<DocumentToolId>(['merge', 'split', 'rotate', 'page_numbers', 'watermark', 'metadata_remove'])

export const DOCUMENT_TOOLS: readonly DocumentTool[] = [
  { id: 'merge', label: 'Merge', description: 'Combine several PDFs into one, in the order you pick.', needs: 'basic', minInputs: 2 },
  { id: 'split', label: 'Split', description: 'Cut one PDF into separate files at the pages you name.', needs: 'basic', options: ['pages'] },
  { id: 'extract_pages', label: 'Extract pages', description: 'Pull a page range into a new PDF.', needs: 'stirling', options: ['pages'] },
  { id: 'rearrange', label: 'Rearrange', description: 'Reorder pages by a page list.', needs: 'stirling', options: ['pages'] },
  { id: 'rotate', label: 'Rotate', description: 'Rotate every page (or a range) by 90°, 180° or 270°.', needs: 'basic', options: ['pages', 'rotation'] },
  { id: 'crop', label: 'Crop', description: 'Trim page margins.', needs: 'stirling' },
  { id: 'compress', label: 'Compress', description: 'Reduce the file size for sharing; the original stays untouched.', needs: 'stirling' },
  { id: 'ocr', label: 'OCR', description: 'Recognise text in scanned pages so the document becomes searchable.', needs: 'stirling' },
  { id: 'image_to_pdf', label: 'Image to PDF', description: 'Wrap images as a PDF.', needs: 'stirling' },
  { id: 'pdf_to_images', label: 'PDF to images', description: 'Render each page as an image.', needs: 'stirling', options: ['pages'] },
  { id: 'watermark', label: 'Watermark', description: 'Stamp diagonal text on every page.', needs: 'basic', options: ['watermark'] },
  { id: 'page_numbers', label: 'Page numbers', description: 'Add page numbers to the footer.', needs: 'basic' },
  { id: 'flatten', label: 'Flatten', description: 'Bake form fields and annotations into the page.', needs: 'stirling' },
  { id: 'metadata_inspect', label: 'Inspect metadata', description: 'Report the document’s embedded metadata.', needs: 'stirling' },
  { id: 'metadata_remove', label: 'Remove metadata', description: 'Strip author, producer and other embedded metadata.', needs: 'basic' },
  { id: 'sanitize', label: 'Sanitise', description: 'Remove scripts, embedded files and links.', needs: 'stirling' },
  { id: 'repair', label: 'Repair', description: 'Rebuild a damaged PDF.', needs: 'stirling' },
  { id: 'compare', label: 'Compare', description: 'Show the text differences between two documents.', needs: 'stirling', minInputs: 2 },
  { id: 'redact', label: 'Redact', description: 'Black out the pages or terms you specify — a new redacted derivative.', needs: 'stirling', options: ['pages'] },
]

/** Cosmetic gate the grid renders; the RPC / runner decide for real. */
export const toolAvailable = (tool: Pick<DocumentTool, 'needs'>, stirlingOn: boolean): boolean =>
  tool.needs === 'basic' || stirlingOn

export const TOOL_UNAVAILABLE_HINT = 'Requires the document service'

export const ROTATIONS = [90, 180, 270] as const
export type Rotation = (typeof ROTATIONS)[number]

/** `1-3, 5, 8-` style page lists — kept as text for the server (Stirling and
 *  the runner both take the string); this only says whether it looks sane. */
export const isPageSpec = (s: string): boolean => /^\s*\d+\s*(-\s*\d*)?(\s*,\s*\d+\s*(-\s*\d*)?)*\s*$/.test(s)

export interface ToolOptions {
  pages?: string | null
  rotation?: Rotation | null
  watermark?: string | null
}

/** Build the RPC's `p_inputs` / `p_options` from the dialog state. */
export function toolRequestArgs(tool: DocumentToolId, mediaIds: readonly string[], options: ToolOptions = {}): { inputs: Json; options: Json } {
  const inputs: Record<string, Json> = { media_ids: [...mediaIds] }
  const opts: Record<string, Json> = {}
  if (options.pages?.trim()) inputs.pages = options.pages.trim()
  if (options.rotation) opts.rotation = options.rotation
  if (options.watermark?.trim()) opts.watermark = options.watermark.trim()
  void tool
  return { inputs, options: opts }
}

/* ── Search headline → safe segments ────────────────────────────────────── */

export interface HeadlineSegment { text: string; hit: boolean }

/** `ts_headline` marks hits with `<b>…</b>` (the platform RPCs and the
 *  index with `<mark>…</mark>`). Split into plain segments so
 *  the row can render `<mark>` without dangerouslySetInnerHTML; any other
 *  tag-looking text stays literal. */
export function splitHeadline(headline: string | null | undefined): HeadlineSegment[] {
  if (!headline) return []
  const out: HeadlineSegment[] = []
  const re = /<(b|mark)>([\s\S]*?)<\/\1>/g
  let last = 0
  for (let m = re.exec(headline); m; m = re.exec(headline)) {
    if (m.index > last) out.push({ text: headline.slice(last, m.index), hit: false })
    if (m[2]) out.push({ text: m[2], hit: true })
    last = m.index + m[0].length
  }
  if (last < headline.length) out.push({ text: headline.slice(last), hit: false })
  return out
}

/** The viewer deep link: PDF viewers honour `#page=N` on the URL. */
export function openPageUrl(signedUrl: string, page: number | null | undefined): string {
  const n = page && Number.isFinite(page) && page > 0 ? Math.floor(page) : null
  if (!n) return signedUrl
  const base = signedUrl.replace(/#.*$/, '')
  return `${base}#page=${n}`
}

/* ── Storage ────────────────────────────────────────────────────────────── */

export const DOCUMENTS_BUCKET = 'case-documents'
export const DOCUMENT_URL_TTL_S = 300

/** Which bucket a media row's bytes live in: derivatives (generated
 *  documents) go to `case-documents`, originals to `case-evidence`. */
export const mediaBucket = (m: Pick<MediaRow, 'derivative_type' | 'parent_media_id'>): string =>
  m.derivative_type || m.parent_media_id ? DOCUMENTS_BUCKET : EVIDENCE_BUCKET

/** A 300 s signed URL for a storage-backed row (originals through
 *  lib/evidence's cached signer, derivatives from `case-documents`, each
 *  falling back to the other bucket); legacy external rows return their URL
 *  as-is (the caller runs it through safeUrl). Null when neither. */
export async function documentUrl(m: Pick<MediaRow, 'storage_path' | 'external_url' | 'derivative_type' | 'parent_media_id'>): Promise<string | null> {
  if (m.storage_path) {
    const path = m.storage_path
    const fromDocuments = async (): Promise<string | null> => {
      const { data, error } = await supabase().storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, DOCUMENT_URL_TTL_S)
      return error ? null : (data?.signedUrl ?? null)
    }
    const order = mediaBucket(m) === DOCUMENTS_BUCKET
      ? [fromDocuments, () => evidenceSignedUrl(path)]
      : [() => evidenceSignedUrl(path), fromDocuments]
    for (const sign of order) {
      const url = await sign()
      if (url) return url
    }
    return null
  }
  return m.external_url ?? null
}

/** Custody event VIEWED / DOWNLOADED through lib/evidence (registered
 *  evidence only; restricted rows also log the break-glass view). Fire and
 *  forget: a refused log never blocks the open. */
export function logDocumentAccess(m: Pick<MediaRow, 'id' | 'restricted' | 'evidence_number'>, action: 'viewed' | 'downloaded'): void {
  logEvidenceAccess(m, action)
}

/* ── The six sections ───────────────────────────────────────────────────── */

export interface EvidenceDocument {
  media: MediaRow
  extraction: DocumentExtractionRow | null
  state: ExtractionState
}

export interface CaseDocuments {
  reports: ReportRow[]
  evidenceDocs: EvidenceDocument[]
  legal: LegalRequestRow[]
  generated: MediaRow[]
  packets: PacketRow[]
  jobs: BackgroundJobRow[]
}

/** Pure grouping — exported for the unit test; fetchCaseDocuments feeds it. */
export function groupCaseDocuments(input: {
  reports: ReportRow[]
  media: MediaRow[]
  extractions: DocumentExtractionRow[]
  legal: LegalRequestRow[]
  packets: PacketRow[]
  jobs: BackgroundJobRow[]
}): CaseDocuments {
  const byMedia = new Map(input.extractions.map((x) => [x.media_id, x]))
  const evidenceDocs = input.media
    .filter(isEvidenceDocument)
    .map((media) => {
      const extraction = byMedia.get(media.id) ?? null
      return { media, extraction, state: extractionState(extraction) }
    })
  const generated = input.media.filter((m) => isGeneratedMedia(m) && !m.archived_at)
  return { reports: input.reports, evidenceDocs, legal: input.legal, generated, packets: input.packets, jobs: input.jobs }
}

/** One read per section. Throws like list() so the tab shows an
 *  ErrorNotice — never an empty state — when a query fails. The two tables
 *  whose visibility is narrower by design (legal requests, jobs) are read
 *  with the same RLS the rest use; zero rows there is the honest answer. */
export async function fetchCaseDocuments(caseId: string): Promise<CaseDocuments> {
  const [reports, media, legal, packets, jobs] = await Promise.all([
    list('reports', { eq: { case_id: caseId }, order: 'created_at', ascending: false }),
    list('media', { eq: { case_id: caseId }, order: 'created_at', ascending: false }),
    list('legal_requests', { eq: { case_id: caseId }, order: 'created_at', ascending: false }),
    fetchPackets(caseId),
    fetchCaseJobs(caseId),
  ])
  const docIds = media.filter(isEvidenceDocument).map((m) => m.id)
  const extractions = docIds.length ? await list('document_extractions', { in: { media_id: docIds } }) : []
  return groupCaseDocuments({ reports, media, extractions, legal, packets, jobs })
}

/** The tab pill: live packets + media rows that count as documents. Two
 *  cheap projections instead of an `or` filter (the mock PostgREST and the
 *  typed ListOptions both prefer it). */
export async function countCaseDocuments(caseId: string): Promise<number> {
  const [packets, docs, derived] = await Promise.all([
    list('case_packets', { select: 'id', eq: { case_id: caseId }, is: { deleted_at: null } }),
    list('media', { select: 'id', eq: { case_id: caseId, type: 'document' } }),
    list('media', { select: 'id', eq: { case_id: caseId }, in: { derivative_type: COUNTED_DERIVATIVE_TYPES } }),
  ])
  const ids = new Set<string>()
  for (const m of docs) ids.add(m.id)
  for (const m of derived) ids.add(m.id)
  return packets.length + ids.size
}

/* ── Requests ───────────────────────────────────────────────────────────── */

export async function requestExtraction(mediaId: string): Promise<JsonRpcOutcome<{ job_id?: string }>> {
  return unwrapJsonRpc(await rpc('document_extract_request', { p_media: mediaId }))
}

export async function requestTool(
  caseId: string,
  tool: DocumentToolId,
  mediaIds: readonly string[],
  options: ToolOptions = {},
): Promise<JsonRpcOutcome<{ job_id?: string }>> {
  const args = toolRequestArgs(tool, mediaIds, options)
  return unwrapJsonRpc(await rpc('document_tool_request', { p_case: caseId, p_tool: tool, p_inputs: args.inputs, p_options: args.options }))
}

/** Full-text search over extracted pages (RLS through the policies on
 *  document_pages → media). Returns `{data,error}` like every mutation
 *  helper so the box can show a humanised failure. */
export async function searchDocumentPages(q: string, caseId: string | null, limit = 30): Promise<MutationResult<DocumentSearchHit[]>> {
  const term = q.trim()
  if (!term) return { data: [], error: null }
  const res = await rpc('document_search', { p_q: term, p_case: caseId, p_limit: limit })
  return { data: res.data ?? null, error: res.error }
}
