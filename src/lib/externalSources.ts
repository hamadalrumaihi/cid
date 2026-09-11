/** External sources — the client model for crawled web intelligence
 *  (contract §2.6). Three tables (`external_sources`, immutable
 *  `external_source_versions`, `external_source_links`) and a handful of
 *  RPCs; every read is the viewer's RLS-scoped client (a source is visible
 *  when active and, if case-bound, the case is readable), every write is an
 *  RPC that audits itself.
 *
 *  The one rule this module keeps repeating: a crawled page is UNVERIFIED
 *  INTELLIGENCE until an analyst verifies it, and even then nothing here
 *  updates a registry record automatically — a source is linked TO records,
 *  it never writes them.
 *
 *  Pure helpers (labels, diff summary, domain) sit at the top and are unit
 *  tested; the data functions below them go through lib/db only. */
import type { Json, Tables } from './database.types'
import { list, rpc, type MutationResult } from './db'
import { reportTitle } from './forms'
import { CrawlerService } from './services/crawler/crawler-service'
import type { CrawlResult } from './services/crawler/types'
import { humanizeError } from './toast'

export type SourceRow = Tables<'external_sources'>
export type SourceVersionRow = Tables<'external_source_versions'>
export type SourceLinkRow = Tables<'external_source_links'>

/* ── Vocabulary (mirrors the CHECK constraints) ─────────────────────────── */

export const SOURCE_STATUSES = ['pending', 'fetching', 'ready', 'changed', 'failed'] as const
export type SourceStatus = (typeof SOURCE_STATUSES)[number]

export const VERIFICATION_STATUSES = ['unverified', 'verified', 'disputed', 'rejected'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export const RELIABILITIES = ['unknown', 'reliable', 'usually_reliable', 'unreliable', 'cannot_judge'] as const
export type Reliability = (typeof RELIABILITIES)[number]

export const SOURCE_CLASSIFICATIONS = ['unclassified', 'sensitive', 'restricted'] as const

/** What a source may be linked to (`external_source_links.kind`). */
export const SOURCE_LINK_KINDS = ['case', 'person', 'vehicle', 'gang', 'place', 'narcotic', 'evidence', 'report', 'intel'] as const
export type SourceLinkKind = (typeof SOURCE_LINK_KINDS)[number]

export const SOURCE_LINK_KIND_LABEL: Record<SourceLinkKind, string> = {
  case: 'Case', person: 'Person', vehicle: 'Vehicle', gang: 'Gang', place: 'Place', narcotic: 'Narcotic',
  evidence: 'Evidence', report: 'Report', intel: 'Field intelligence',
}

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'danger'

export function sourceStatusLabel(s: string | null | undefined): string {
  switch (s) {
    case 'pending': return 'Pending'
    case 'fetching': return 'Fetching'
    case 'ready': return 'Ready'
    case 'changed': return 'Changed'
    case 'failed': return 'Failed'
    default: return s ? s.replace(/_/g, ' ') : '—'
  }
}

export function sourceStatusTone(s: string | null | undefined): Tone {
  switch (s) {
    case 'ready': return 'good'
    case 'changed': return 'warn'
    case 'failed': return 'danger'
    case 'fetching': return 'accent'
    default: return 'neutral'
  }
}

/** The wording is deliberate: an unverified source is called out as
 *  UNVERIFIED INTELLIGENCE everywhere it appears, never as merely "pending". */
export const UNVERIFIED_LABEL = 'UNVERIFIED INTELLIGENCE'

export function verificationLabel(v: string | null | undefined): string {
  switch (v) {
    case 'verified': return 'Verified'
    case 'disputed': return 'Disputed'
    case 'rejected': return 'Rejected'
    case 'unverified':
    case null:
    case undefined:
    case '':
      return UNVERIFIED_LABEL
    default: return v.replace(/_/g, ' ')
  }
}

export function verificationTone(v: string | null | undefined): Tone {
  switch (v) {
    case 'verified': return 'good'
    case 'disputed': return 'warn'
    case 'rejected': return 'danger'
    default: return 'warn'
  }
}

export const isVerified = (v: string | null | undefined): boolean => v === 'verified'

export function reliabilityLabel(r: string | null | undefined): string {
  switch (r) {
    case 'reliable': return 'Reliable'
    case 'usually_reliable': return 'Usually reliable'
    case 'unreliable': return 'Unreliable'
    case 'cannot_judge': return 'Cannot be judged'
    case 'unknown':
    case null:
    case undefined:
    case '':
      return 'Unknown reliability'
    default: return r.replace(/_/g, ' ')
  }
}

export function reliabilityTone(r: string | null | undefined): Tone {
  switch (r) {
    case 'reliable': return 'good'
    case 'usually_reliable': return 'accent'
    case 'unreliable': return 'danger'
    default: return 'neutral'
  }
}

/** The server's line-set diff (`external_source_ingest`): added/removed
 *  counts, modified = min(added, removed), plus up to five sample lines each.
 *  Tolerant of absent keys — an older row without a summary renders as 0s. */
export interface DiffSummary {
  added: number
  removed: number
  modified: number
  addedSamples: string[]
  removedSamples: string[]
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 5) : [])

export function parseDiffSummary(raw: Json | null | undefined): DiffSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  const added = num(d.added ?? d.added_count ?? d.lines_added)
  const removed = num(d.removed ?? d.removed_count ?? d.lines_removed)
  const modified = d.modified === undefined ? Math.min(added, removed) : num(d.modified)
  return {
    added, removed, modified,
    addedSamples: strs(d.added_samples ?? d.added_sample ?? d.samples_added),
    removedSamples: strs(d.removed_samples ?? d.removed_sample ?? d.samples_removed),
  }
}

/** "+12 −3 ~3 lines" — the compact chip text; '' when there is no summary. */
export function diffSummaryText(raw: Json | DiffSummary | null | undefined): string {
  const d = raw && typeof raw === 'object' && 'addedSamples' in (raw as object)
    ? (raw as DiffSummary)
    : parseDiffSummary(raw as Json | null | undefined)
  if (!d) return ''
  if (d.added === 0 && d.removed === 0 && d.modified === 0) return 'no line changes'
  return `+${d.added} −${d.removed} ~${d.modified} lines`
}

/** Lower-cased host of a URL without a leading `www.`; '' when unparseable
 *  or not http(s). Display only — the server computes the stored `domain`. */
export function domainOf(url: string | null | undefined): string {
  if (!url) return ''
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** Client-side sanity check before submitting (the server is the authority —
 *  `url_static_check` refuses far more). Returns a reason or null. */
export function urlProblem(url: string): string | null {
  const s = url.trim()
  if (!s) return 'Enter a URL.'
  if (s.length > 2048) return 'URLs are limited to 2048 characters.'
  let u: URL
  try { u = new URL(s) } catch { return 'Enter a full URL, starting with http:// or https://.' }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http and https pages can be fetched.'
  if (u.username || u.password) return 'URLs with credentials are not accepted.'
  if (!u.hostname || u.hostname === 'localhost' || /\.(localhost|local|internal|lan|home|arpa|corp)$/i.test(u.hostname)) {
    return 'Internal or local addresses cannot be fetched.'
  }
  return null
}

/* ── RPC result shaping ─────────────────────────────────────────────────── */

export type SourceResult<T = Record<string, unknown>> = { ok: true; data: T } | { ok: false; code: string; message: string }

function shape<T = Record<string, unknown>>(res: MutationResult<Json>): SourceResult<T> {
  if (res.error) return { ok: false, code: res.error.code ?? 'error', message: humanizeError(res.error.message) }
  const d = (res.data ?? {}) as { ok?: boolean; code?: string; message?: string }
  if (d && typeof d === 'object' && d.ok === false) {
    return { ok: false, code: d.code ?? 'refused', message: d.message ?? 'The server refused this change.' }
  }
  return { ok: true, data: (res.data ?? {}) as T }
}

/* ── Writes (RPC only) ──────────────────────────────────────────────────── */

export const submitSource = (url: string, caseId?: string | null, notes?: string | null): Promise<CrawlResult> =>
  CrawlerService.submit(url, caseId ?? null, notes ?? null)

export const recrawl = (sourceId: string): Promise<CrawlResult> => CrawlerService.recrawl(sourceId)

export async function verifySource(
  id: string, status: VerificationStatus, reliability: Reliability | null, notes: string | null,
): Promise<SourceResult> {
  return shape(await rpc('external_source_verify', {
    p_source: id, p_status: status, p_reliability: reliability ?? null, p_notes: notes?.trim() || null,
  }))
}

export async function linkSource(id: string, kind: SourceLinkKind, refId: string, note: string | null): Promise<SourceResult<{ id?: string }>> {
  return shape(await rpc('external_source_link', { p_source: id, p_kind: kind, p_ref: refId, p_note: note?.trim() || null }))
}

export async function unlinkSource(linkId: string): Promise<SourceResult> {
  return shape(await rpc('external_source_unlink', { p_link: linkId }))
}

export interface SourcePatch {
  classification?: string
  analyst_notes?: string | null
  case_id?: string | null
}

export async function updateSource(id: string, patch: SourcePatch): Promise<SourceResult> {
  return shape(await rpc('external_source_update', { p_source: id, p_patch: patch as unknown as Json }))
}

/* ── Reads (RLS-scoped) ─────────────────────────────────────────────────── */

export interface SourceFilters {
  status?: SourceStatus | ''
  verification?: VerificationStatus | ''
  /** Only sources this profile submitted. */
  mine?: string | null
  caseId?: string | null
  limit?: number
}

/** Live (not deleted) sources, newest first. `list()` throws on error. */
export async function fetchSources(filters: SourceFilters = {}): Promise<SourceRow[]> {
  const eq: Partial<Record<keyof SourceRow, unknown>> = {}
  if (filters.status) eq.status = filters.status
  if (filters.verification) eq.verification_status = filters.verification
  if (filters.mine) eq.submitted_by = filters.mine
  if (filters.caseId) eq.case_id = filters.caseId
  return list('external_sources', {
    is: { deleted_at: null }, eq, order: 'created_at', ascending: false, limit: filters.limit ?? 500,
  })
}

/** The columns the versions list needs — the text bodies are fetched per
 *  selected version (fetchVersionText) so a 30-version source stays cheap. */
export type SourceVersionLite = Pick<SourceVersionRow,
  'id' | 'source_id' | 'version_no' | 'retrieved_at' | 'retrieved_by' | 'http_status' | 'content_type' | 'title'
  | 'byte_size' | 'diff_summary' | 'service' | 'service_version' | 'content_hash'>

const VERSION_LITE = 'id,source_id,version_no,retrieved_at,retrieved_by,http_status,content_type,title,byte_size,diff_summary,service,service_version,content_hash'

export interface SourceDetail {
  source: SourceRow
  versions: SourceVersionLite[]
  links: SourceLinkRow[]
}

/** One source with its version list (newest first) and links. null when the
 *  viewer cannot read it (RLS) — the caller renders the restricted stub. */
export async function fetchSource(id: string): Promise<SourceDetail | null> {
  const rows = await list('external_sources', { eq: { id }, limit: 1 })
  const source = rows[0]
  if (!source) return null
  const [versions, links] = await Promise.all([
    list('external_source_versions', { select: VERSION_LITE, eq: { source_id: id }, order: 'version_no', ascending: false })
      .then((r) => r as unknown as SourceVersionLite[]),
    list('external_source_links', { eq: { source_id: id }, order: 'created_at', ascending: false }),
  ])
  return { source, versions, links }
}

/** Plain text of one version (the `text` column; markdown when text is
 *  empty). Always rendered as text — crawled content is never HTML here. */
export async function fetchVersionText(versionId: string): Promise<string> {
  const rows = await list('external_source_versions', { select: 'id,text,markdown', eq: { id: versionId }, limit: 1 })
    .then((r) => r as unknown as Pick<SourceVersionRow, 'id' | 'text' | 'markdown'>[])
  const v = rows[0]
  return v?.text?.trim() ? v.text : v?.markdown ?? ''
}


/** Sources attached to a case — bound by `case_id` OR by a link of kind
 *  `case`. Bounded `in:` lookups on the referenced ids only. */
export async function fetchCaseSources(caseId: string): Promise<SourceRow[]> {
  const [own, links] = await Promise.all([
    fetchSources({ caseId, limit: 200 }),
    list('external_source_links', { eq: { kind: 'case', ref_id: caseId } }).catch(() => [] as SourceLinkRow[]),
  ])
  const have = new Set(own.map((s) => s.id))
  const extra = [...new Set(links.map((l) => l.source_id))].filter((id) => !have.has(id))
  const linked = extra.length
    ? await list('external_sources', { is: { deleted_at: null }, in: { id: extra } }).catch(() => [] as SourceRow[])
    : []
  return [...own, ...linked].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/** Bounded label resolution for a source's links — one `in:` lookup per
 *  kind over just the referenced ids. A target the viewer cannot read keeps
 *  no label (the caller shows the restricted stub, never the raw id). */
export async function resolveLinkLabels(links: readonly SourceLinkRow[]): Promise<Record<string, string>> {
  const idsOf = (k: SourceLinkKind) => [...new Set(links.filter((l) => l.kind === k).map((l) => l.ref_id))]
  const out: Record<string, string> = {}
  const put = (rows: Array<{ id: string; label: string }>) => { for (const r of rows) if (r.label) out[r.id] = r.label }
  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])
  const named = async (table: 'persons' | 'gangs' | 'places' | 'narcotics', kind: SourceLinkKind) => {
    const ids = idsOf(kind)
    if (!ids.length) return
    const rows = await safe(list(table, { select: 'id,name', in: { id: ids } })) as unknown as { id: string; name: string | null }[]
    put(rows.map((r) => ({ id: r.id, label: r.name ?? '' })))
  }
  await Promise.all([
    named('persons', 'person'), named('gangs', 'gang'), named('places', 'place'), named('narcotics', 'narcotic'),
    (async () => {
      const ids = idsOf('vehicle')
      if (!ids.length) return
      const rows = await safe(list('vehicles', { select: 'id,plate,model', in: { id: ids } })) as unknown as { id: string; plate: string | null; model: string | null }[]
      put(rows.map((r) => ({ id: r.id, label: [r.plate, r.model].filter(Boolean).join(' · ') })))
    })(),
    (async () => {
      const ids = idsOf('case')
      if (!ids.length) return
      const rows = await safe(list('cases', { select: 'id,case_number,title', in: { id: ids } })) as unknown as { id: string; case_number: string; title: string | null }[]
      put(rows.map((r) => ({ id: r.id, label: r.title ? `${r.case_number} — ${r.title}` : r.case_number })))
    })(),
    (async () => {
      const ids = idsOf('evidence')
      if (!ids.length) return
      const rows = await safe(list('media', { select: 'id,title,evidence_number', in: { id: ids } })) as unknown as { id: string; title: string | null; evidence_number: string | null }[]
      put(rows.map((r) => ({ id: r.id, label: [r.evidence_number, r.title].filter(Boolean).join(' · ') })))
    })(),
    (async () => {
      const ids = idsOf('report')
      if (!ids.length) return
      const rows = await safe(list('reports', { select: 'id,template,kind,seq', in: { id: ids } })) as unknown as { id: string; template: string | null; kind: string | null; seq: number | null }[]
      put(rows.map((r) => ({ id: r.id, label: reportTitle(r) })))
    })(),
  ])
  return out
}
