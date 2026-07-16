/** Pure document-governance model for the SOPs & Reference Library — vocab,
 *  labels, projections, and derivations shared by the shelf, the reader, the
 *  Action Center loader, and Oversight. NO React, NO I/O (personIntel /
 *  membershipPending pattern) so every rule is unit-testable.
 *
 *  The database is the authority (20260801010000_document_governance):
 *  CHECK vocabularies, RLS visibility, and the workflow RPCs all enforce
 *  these rules server-side — everything here only decides what to SHOW. */
import type { Tables } from '@/lib/database.types'

export type DocRow = Tables<'documents'>

export type DocumentCategory = 'sops' | 'investigative' | 'command' | 'justice' | 'technical'
export type DocumentType =
  | 'sop' | 'policy' | 'guide' | 'checklist' | 'reference'
  | 'legal_guidance' | 'technical' | 'template'
export type DocumentStatus =
  | 'draft' | 'in_review' | 'approved' | 'published' | 'superseded' | 'archived'
export type DocumentClassification = 'internal' | 'restricted' | 'command' | 'justice' | 'owner'
export type SyncStatus =
  | 'synced' | 'pending' | 'source_newer' | 'portal_newer'
  | 'conflict' | 'disconnected' | 'error' | 'disabled'
export type ChangeType =
  | 'editorial' | 'clarification' | 'procedural' | 'legal'
  | 'emergency' | 'deprecation' | 'restore'

/** Narrow shelf projection — the library NEVER loads full bodies (the
 *  generated `excerpt` column carries the preview; the body loads only when
 *  a document opens). Keep in sync with ShelfDoc below. */
export const SHELF_COLS =
  'id,folder,name,kind,category,document_type,status,classification,owner_user_id,mandatory,acknowledgement_required,acknowledgement_deadline,approval_required,approved_by,effective_at,reviewed_at,review_due_at,expires_at,source_system,canonical_source,sync_status,last_synced_at,current_version_number,excerpt,updated_at,created_at,modified_label,tags' as const

export type ShelfDoc = Pick<DocRow,
  | 'id' | 'folder' | 'name' | 'kind' | 'category' | 'document_type' | 'status'
  | 'classification' | 'owner_user_id' | 'mandatory' | 'acknowledgement_required'
  | 'acknowledgement_deadline' | 'approval_required' | 'approved_by' | 'effective_at'
  | 'reviewed_at' | 'review_due_at' | 'expires_at' | 'source_system'
  | 'canonical_source' | 'sync_status' | 'last_synced_at' | 'current_version_number'
  | 'excerpt' | 'updated_at' | 'created_at' | 'modified_label' | 'tags'>

/** Strip legacy file extensions the Drive import left in names. */
export const docTitle = (name: string): string => name.replace(/\.(docx?|pdf|sheet)$/i, '')

/* ── Vocabulary labels (never color-alone; pair with Badge text) ─────────── */
export const CATEGORY_ORDER: DocumentCategory[] =
  ['sops', 'investigative', 'command', 'justice', 'technical']
export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  sops: 'Standard Operating Procedures',
  investigative: 'Investigative Reference',
  command: 'Command & Personnel',
  justice: 'Justice & Legal',
  technical: 'Technical & System',
}
export const CATEGORY_HINT: Record<DocumentCategory, string> = {
  sops: 'Division policy — how CID operates',
  investigative: 'Gang, person, vehicle and method reference',
  command: 'Roles, personnel movement, access control',
  justice: 'Warrant standards, DOJ routing, legal handling',
  technical: 'Portal use, incident response, runbooks',
}

export const TYPE_LABEL: Record<DocumentType, string> = {
  sop: 'SOP', policy: 'Policy', guide: 'Guide', checklist: 'Checklist',
  reference: 'Reference', legal_guidance: 'Legal guidance',
  technical: 'Technical', template: 'Template',
}

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: 'Draft', in_review: 'In review', approved: 'Approved',
  published: 'Published', superseded: 'Superseded', archived: 'Archived',
}
export const STATUS_TONE: Record<DocumentStatus, 'neutral' | 'accent' | 'good' | 'warn' | 'danger'> = {
  draft: 'neutral', in_review: 'warn', approved: 'accent',
  published: 'good', superseded: 'warn', archived: 'neutral',
}

export const CLASS_LABEL: Record<DocumentClassification, string> = {
  internal: 'Internal', restricted: 'Restricted', command: 'Command',
  justice: 'Justice', owner: 'Owner',
}

export const SYNC_LABEL: Record<SyncStatus, string> = {
  synced: 'Synced with Google Drive',
  pending: 'Sync pending',
  source_newer: 'Google Drive has newer changes',
  portal_newer: 'Portal edits not in Google Drive',
  conflict: 'Sync conflict — needs resolution',
  disconnected: 'Drive disconnected',
  error: 'Sync error',
  disabled: 'Sync disabled',
}
export const SYNC_TONE: Record<SyncStatus, 'neutral' | 'accent' | 'good' | 'warn' | 'danger'> = {
  synced: 'good', pending: 'neutral', source_newer: 'warn', portal_newer: 'warn',
  conflict: 'danger', disconnected: 'neutral', error: 'danger', disabled: 'neutral',
}
/** Sync states that deserve a warning surface (metric tile, Oversight). */
export const SYNC_WARN = new Set<SyncStatus>(['source_newer', 'portal_newer', 'conflict', 'error'])

export const CHANGE_TYPE_LABEL: Record<ChangeType, string> = {
  editorial: 'Editorial', clarification: 'Clarification', procedural: 'Procedural',
  legal: 'Legal', emergency: 'Emergency', deprecation: 'Deprecation', restore: 'Restore',
}
/** Material change types require a summary and normally reset acknowledgements. */
export const MATERIAL_CHANGE = new Set<ChangeType>(['procedural', 'legal', 'emergency', 'deprecation'])

export const REVIEW_OUTCOME_LABEL: Record<string, string> = {
  no_change: 'No change required',
  editorial_update: 'Editorial update required',
  material_update: 'Material update required',
  legal_review: 'Legal review required',
  supersede: 'Supersede',
  archive: 'Archive',
}

export const AUDIENCE_LABEL: Record<string, string> = {
  all: 'All CID', LSB: 'LSB', BCB: 'BCB', SAB: 'SAB', JTF: 'JTF',
  command: 'Command', detectives: 'Detectives',
  senior_detectives: 'Senior detectives', specific: 'Specific members',
}

/** Category for legacy rows whose column is somehow null — folder fallback
 *  mirrors the migration backfill, so old and new data group identically. */
export function docCategory(d: Pick<ShelfDoc, 'category' | 'folder'>): DocumentCategory {
  if (d.category && (CATEGORY_ORDER as string[]).includes(d.category)) return d.category as DocumentCategory
  switch (d.folder) {
    case 'SOPs': case 'Forms': return 'sops'
    case 'Personnel': return 'command'
    default: return 'investigative'
  }
}

/* ── Time-based derivations (pure; caller passes nowMs) ──────────────────── */
const DAY = 86_400_000

export type ReviewState = 'overdue' | 'due_soon' | null
/** due_soon = within 14 days of review_due_at; overdue = past it. */
export function reviewState(d: Pick<ShelfDoc, 'review_due_at' | 'status'>, nowMs: number): ReviewState {
  if (!d.review_due_at || d.status === 'archived' || d.status === 'superseded') return null
  const due = Date.parse(d.review_due_at)
  if (Number.isNaN(due)) return null
  if (due <= nowMs) return 'overdue'
  if (due - nowMs <= 14 * DAY) return 'due_soon'
  return null
}

export function isExpired(d: Pick<ShelfDoc, 'expires_at' | 'status'>, nowMs: number): boolean {
  if (!d.expires_at || d.status === 'archived' || d.status === 'superseded') return false
  const t = Date.parse(d.expires_at)
  return !Number.isNaN(t) && t <= nowMs
}

export function isRecentlyUpdated(d: Pick<ShelfDoc, 'updated_at'>, nowMs: number, days = 7): boolean {
  const t = Date.parse(d.updated_at)
  return !Number.isNaN(t) && nowMs - t <= days * DAY
}

/* ── Acknowledgement state ───────────────────────────────────────────────── */
/** Map of document_id → acknowledged version numbers, built by the loader
 *  from the caller's OWN document_acknowledgements (embedded version row). */
export type MyAckVersions = Record<string, number[]>

export type AckState = 'not_required' | 'acknowledged' | 'reack_needed' | 'pending'
export function ackState(
  d: Pick<ShelfDoc, 'id' | 'acknowledgement_required' | 'current_version_number'>,
  myAcks: MyAckVersions,
): AckState {
  if (!d.acknowledgement_required) return 'not_required'
  const versions = myAcks[d.id] ?? []
  if (versions.includes(d.current_version_number)) return 'acknowledged'
  return versions.length ? 'reack_needed' : 'pending'
}
export const ACK_LABEL: Record<AckState, string> = {
  not_required: 'Reference',
  acknowledged: 'Acknowledged',
  reack_needed: 'Re-acknowledgement needed',
  pending: 'Acknowledgement required',
}

/* ── Client-side authority mirrors (UX only — RLS + RPCs re-decide) ──────── */
export interface DocViewer {
  userId: string | null
  active: boolean
  role: string | null
  isCommand: boolean
  isOwner: boolean
  justiceRole: string | null
}

export function canEditDoc(v: DocViewer, d: Pick<ShelfDoc, 'classification' | 'owner_user_id' | 'folder'>): boolean {
  const cls = d.classification ?? 'internal'
  if (cls === 'owner') return v.isOwner
  if (cls === 'justice') return v.isOwner || v.justiceRole === 'district_attorney' || v.justiceRole === 'attorney_general'
  if (cls === 'command') return v.isCommand || v.isOwner
  if (v.isCommand || v.isOwner) return true
  if (d.owner_user_id && d.owner_user_id === v.userId && v.active) return true
  return v.active && cls === 'internal'
    && !['SOPs', 'Resources', 'Personnel', 'Gang Intel'].includes(d.folder)
}

export function canApproveDoc(v: DocViewer, d: Pick<ShelfDoc, 'category' | 'classification' | 'folder'>): boolean {
  const cls = d.classification ?? 'internal'
  const cat = docCategory({ category: d.category, folder: d.folder })
  if (cls === 'owner') return v.isOwner
  if (cls === 'justice' || cat === 'justice')
    return v.isOwner || v.justiceRole === 'district_attorney' || v.justiceRole === 'attorney_general'
  if (cat === 'sops') return v.isCommand || v.isOwner
  return v.isOwner || v.role === 'deputy_director' || v.role === 'director'
}

/* ── Library views, filters, sorting ─────────────────────────────────────── */
export type LibraryView = 'library' | 'required' | 'recent' | 'checklists' | 'templates' | 'bookmarks'
export const VIEW_LABEL: Record<LibraryView, string> = {
  library: 'Library', required: 'Required Reading', recent: 'Recently Updated',
  checklists: 'Checklists', templates: 'Templates', bookmarks: 'Bookmarks',
}
export const VIEWS: LibraryView[] = ['library', 'required', 'recent', 'checklists', 'templates', 'bookmarks']

export interface DocFilters {
  category?: DocumentCategory | null
  type?: DocumentType | null
  status?: DocumentStatus | null
  classification?: DocumentClassification | null
  mandatory?: boolean
  ackRequired?: boolean
  unacked?: boolean
  reviewDue?: boolean
  expired?: boolean
  recent?: boolean
  synced?: boolean
  syncWarning?: boolean
  archived?: boolean
}

export type DocSort = 'updated' | 'title' | 'effective' | 'review_due' | 'ack_deadline'
export const SORT_LABEL: Record<DocSort, string> = {
  updated: 'Recently updated', title: 'Title', effective: 'Effective date',
  review_due: 'Review due', ack_deadline: 'Acknowledgement deadline',
}

/** Default shelf excludes archived + superseded unless asked for. */
export function applyDocFilters(
  rows: readonly ShelfDoc[], f: DocFilters, myAcks: MyAckVersions,
  bookmarks: ReadonlySet<string>, view: LibraryView, nowMs: number,
): ShelfDoc[] {
  return rows.filter((d) => {
    if (view === 'required' && ackState(d, myAcks) === 'not_required') return false
    if (view === 'recent' && !isRecentlyUpdated(d, nowMs)) return false
    if (view === 'checklists' && d.document_type !== 'checklist') return false
    if (view === 'templates' && d.document_type !== 'template') return false
    if (view === 'bookmarks' && !bookmarks.has(d.id)) return false
    if (!f.archived && !f.status && (d.status === 'archived' || d.status === 'superseded')) return false
    if (f.archived && d.status !== 'archived') return false
    if (f.category && docCategory(d) !== f.category) return false
    if (f.type && d.document_type !== f.type) return false
    if (f.status && d.status !== f.status) return false
    if (f.classification && d.classification !== f.classification) return false
    if (f.mandatory && !d.mandatory) return false
    if (f.ackRequired && !d.acknowledgement_required) return false
    if (f.unacked && !['pending', 'reack_needed'].includes(ackState(d, myAcks))) return false
    if (f.reviewDue && !reviewState(d, nowMs)) return false
    if (f.expired && !isExpired(d, nowMs)) return false
    if (f.recent && !isRecentlyUpdated(d, nowMs)) return false
    if (f.synced && d.source_system !== 'google_drive') return false
    if (f.syncWarning && !(d.sync_status && SYNC_WARN.has(d.sync_status as SyncStatus))) return false
    return true
  })
}

export function sortDocs(rows: ShelfDoc[], sort: DocSort): ShelfDoc[] {
  const t = (s: string | null) => (s ? Date.parse(s) || 0 : 0)
  return [...rows].sort((a, b) => {
    switch (sort) {
      case 'title': return docTitle(a.name).localeCompare(docTitle(b.name))
      case 'effective': return t(b.effective_at) - t(a.effective_at)
      case 'review_due': return (t(a.review_due_at) || Infinity) - (t(b.review_due_at) || Infinity)
      case 'ack_deadline':
        return (t(a.acknowledgement_deadline) || Infinity) - (t(b.acknowledgement_deadline) || Infinity)
      default: return t(b.updated_at) - t(a.updated_at)
    }
  })
}

/* ── Landing metrics (every tile is a filter) ────────────────────────────── */
export interface LibraryMetrics {
  published: number
  required: number
  awaitingAck: number
  reviewDue: number
  recent: number
  syncWarnings: number
}
export function buildLibraryMetrics(
  rows: readonly ShelfDoc[], myAcks: MyAckVersions, nowMs: number,
): LibraryMetrics {
  let published = 0, required = 0, awaitingAck = 0, reviewDue = 0, recent = 0, syncWarnings = 0
  for (const d of rows) {
    if (d.status === 'published') published++
    const ack = ackState(d, myAcks)
    if (ack !== 'not_required') required++
    if (ack === 'pending' || ack === 'reack_needed') awaitingAck++
    if (reviewState(d, nowMs)) reviewDue++
    if (isRecentlyUpdated(d, nowMs)) recent++
    if (d.sync_status && SYNC_WARN.has(d.sync_status as SyncStatus)) syncWarnings++
  }
  return { published, required, awaitingAck, reviewDue, recent, syncWarnings }
}
