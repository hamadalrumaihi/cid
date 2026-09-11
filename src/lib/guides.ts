/** The Guide Library — the data layer behind /guides and /guides/<slug>.
 *
 *  A guide is REFERENCE CONTENT. It reads no portal record, writes none, and
 *  nothing on it is live. Two splits run through this module:
 *
 *   · LIBRARY vs PROSE. The library lives in the database — which guides
 *     exist, what they are called, which category and audience they carry,
 *     whether they are published, who pinned or bookmarked them, how far each
 *     reader got. The prose of a repository guide lives in a typed module
 *     named by `body_key` (components/guides/guideRegistry), because
 *     code-reviewed prose changes through a pull request with the diff
 *     visible. A guide written in the editor keeps its prose in
 *     public.guide_sections instead; both render through the same page.
 *
 *   · READ vs WRITE. Reads are plain selects under the policies — RLS is the
 *     authority, and the AUDIENCE wall is inside the SELECT policy, so a guide
 *     outside your audience does not come back at all: not its title, not its
 *     summary, not its tags, and not in any count. Every write is an RPC that
 *     re-checks server-side, so the client-side checks here are cosmetic. */
import { list, rpc } from './db'
import { supabase } from './supabase'
import type { Tables } from './database.types'

export type GuideRow = Tables<'guides'>
export type GuideMediaRow = Tables<'guide_media'>
export type GuideCategoryRow = Tables<'guide_categories'>
export type GuideSectionRow = Tables<'guide_sections'>
export type GuideProgressRow = Tables<'guide_progress'>
export type GuideFeedbackRow = Tables<'guide_feedback'>
export type GuideRevisionRow = Tables<'guide_revisions'>

/** The bucket guide imagery lives in (private; read through signed URLs). */
export const GUIDE_BUCKET = 'guides'
export const GUIDE_URL_TTL_S = 60 * 60

/** Upload limits — the same three rules the table CHECKs and the RPC enforce.
 *  Stated here so the picker can refuse before a byte is sent; the server is
 *  the authority either way. */
export const GUIDE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const GUIDE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

/* ---- audience ------------------------------------------------------------ */

export const GUIDE_AUDIENCES = [
  'all', 'investigative', 'command', 'doj', 'sib', 'ci_handlers', 'owner', 'custom',
] as const
export type GuideAudience = (typeof GUIDE_AUDIENCES)[number]

export const GUIDE_AUDIENCE_LABEL: Record<GuideAudience, string> = {
  all: 'All authorized users',
  investigative: 'Investigative personnel',
  command: 'Command',
  doj: 'DOJ / Judiciary',
  sib: 'SIB',
  ci_handlers: 'Informant handlers',
  owner: 'Owner',
  custom: 'Custom roles',
}

/** An audience beyond the two ordinary ones is RESTRICTED: the server does not
 *  return such a guide to anyone outside it, and the card that does reach an
 *  authorized reader says so. */
export const isRestrictedAudience = (a: string | null | undefined): boolean =>
  !!a && a !== 'all' && a !== 'investigative'

export function guideAudienceLabel(a: string | null | undefined): string {
  if (!a) return GUIDE_AUDIENCE_LABEL.all
  if ((GUIDE_AUDIENCES as readonly string[]).includes(a)) return GUIDE_AUDIENCE_LABEL[a as GuideAudience]
  return a.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

/* ---- categories ---------------------------------------------------------- */

/** A category the client does not know about is humanized rather than dropped
 *  — categories are data now, so the client should never be the limit. */
export function humanizeSlug(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

export async function listGuideCategories(): Promise<GuideCategoryRow[]> {
  const rows = await list('guide_categories', { order: 'sort_order', ascending: true })
  return rows
}

/** A category's label, from the rows the library loaded. A category the table
 *  did not return is humanized rather than shown as a raw slug, and a guide
 *  with no category at all is filed under General rather than under nothing. */
export const categoryLabelFrom = (cats: readonly GuideCategoryRow[], slug: string | null | undefined): string =>
  cats.find((c) => c.slug === slug)?.label || humanizeSlug(slug) || 'General'

/* ---- state ---------------------------------------------------------------- */

export const isPublished = (g: Pick<GuideRow, 'status'>): boolean => g.status === 'published'
export const isArchived = (g: Pick<GuideRow, 'archived_at'>): boolean => g.archived_at !== null

/** "Updated since you last read it" — true only when the reader has actually
 *  read it before, so a guide nobody has opened is never marked as changed. */
export function isUpdatedSinceSeen(g: GuideRow, p: GuideProgressRow | undefined): boolean {
  if (!p?.seen_updated_at) return false
  return new Date(g.updated_at).getTime() > new Date(p.seen_updated_at).getTime()
}

/** New enough to be worth a badge: published within the last fortnight and
 *  never opened by this reader. */
export function isNewToReader(g: GuideRow, p: GuideProgressRow | undefined, now = Date.now()): boolean {
  if (p) return false
  if (!g.published_at) return false
  return now - new Date(g.published_at).getTime() < 14 * 24 * 60 * 60 * 1000
}

/* ---- ordering and filtering ---------------------------------------------- */

export const GUIDE_SORTS = ['updated', 'alphabetical', 'views'] as const
export type GuideSort = (typeof GUIDE_SORTS)[number]

export const GUIDE_SORT_LABEL: Record<GuideSort, string> = {
  updated: 'Recently updated',
  alphabetical: 'A–Z',
  views: 'Most read',
}

/** Pinned first, then the chosen order. Pure and copy-free so a view can sort
 *  a filtered array without disturbing the loaded rows. */
export function sortGuides(rows: readonly GuideRow[], sort: GuideSort = 'updated'): GuideRow[] {
  const by = (a: GuideRow, b: GuideRow): number => {
    if (sort === 'alphabetical') return a.title.localeCompare(b.title)
    if (sort === 'views') return (b.view_count ?? 0) - (a.view_count ?? 0) || a.title.localeCompare(b.title)
    return (b.updated_at ?? '').localeCompare(a.updated_at ?? '') || a.title.localeCompare(b.title)
  }
  return [...rows].sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : by(a, b)))
}

/** In-library search over what the library itself holds. Blank matches
 *  everything, so an empty box is not an empty library. */
export function matchGuides(rows: readonly GuideRow[], query: string): GuideRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...rows]
  return rows.filter((g) =>
    `${g.title} ${g.summary ?? ''} ${g.slug} ${g.category} ${(g.tags ?? []).join(' ')} ${g.keywords ?? ''}`
      .toLowerCase().includes(q))
}

/* ---- reads ---------------------------------------------------------------- */

/** The library. RLS decides what comes back: published guides within the
 *  reader's audience, plus drafts and archived guides for an editor. */
export async function listGuides(): Promise<GuideRow[]> {
  return sortGuides(await list('guides', { order: 'updated_at', ascending: false }))
}

export async function listBookmarkedGuideIds(): Promise<Set<string>> {
  const rows = await list('guide_bookmarks', {})
  return new Set(rows.map((r) => r.guide_id))
}

/** The caller's own progress, keyed by guide. Nobody else's row is readable. */
export async function listGuideProgress(): Promise<Map<string, GuideProgressRow>> {
  const rows = await list('guide_progress', {})
  return new Map(rows.map((r) => [r.guide_id, r]))
}

/** One guide by its address. Null when the slug names nothing the caller may
 *  read — a draft, an archived guide, a guide outside their audience and a
 *  slug that never existed are deliberately one outcome. */
export async function getGuideBySlug(slug: string): Promise<GuideRow | null> {
  const rows = await list('guides', { eq: { slug }, limit: 1 })
  return rows[0] ?? null
}

/** A guide's sections, for a guide written in the editor. Empty for a
 *  repository guide, whose prose is in its module. */
export async function listGuideSections(guideId: string): Promise<GuideSectionRow[]> {
  const rows = await list('guide_sections', { eq: { guide_id: guideId } })
  return [...rows].sort((a, b) => a.sort_order - b.sort_order)
}

export async function listGuideMedia(guideId: string): Promise<GuideMediaRow[]> {
  const rows = await list('guide_media', { eq: { guide_id: guideId } })
  return [...rows].sort((a, b) =>
    (a.section ?? '').localeCompare(b.section ?? '') || a.sort_order - b.sort_order)
}

export async function listGuideRevisions(guideId: string): Promise<GuideRevisionRow[]> {
  const rows = await list('guide_revisions', { eq: { guide_id: guideId } })
  return [...rows].sort((a, b) => b.revision_no - a.revision_no)
}

/** The feedback queue. RLS returns the caller's own rows plus, for an editor,
 *  everything on guides they can read. */
export async function listGuideFeedback(): Promise<GuideFeedbackRow[]> {
  const rows = await list('guide_feedback', { order: 'created_at', ascending: false })
  return rows
}

/** A readable URL for one stored image. Null when the object is gone or the
 *  caller may not read it — callers render nothing rather than a broken
 *  picture. */
export async function guideImageUrl(storagePath: string, expiresIn = GUIDE_URL_TTL_S): Promise<string | null> {
  const { data, error } = await supabase().storage.from(GUIDE_BUCKET).createSignedUrl(storagePath, expiresIn)
  return error ? null : (data?.signedUrl ?? null)
}

/* ---- search --------------------------------------------------------------- */

export interface GuideSearchHit {
  guide_id: string
  slug: string
  title: string
  summary: string | null
  category: string
  anchor: string
  heading: string
  snippet: string
  rank: number
}

/** Library search that answers "which guide, and which section of it", so a
 *  result can open at the match rather than at the top. The RPC is SECURITY
 *  INVOKER over the policies, so a restricted guide cannot appear here even
 *  as a title. */
export async function searchGuides(query: string, limit = 20): Promise<GuideSearchHit[]> {
  const q = query.trim()
  if (!q) return []
  const { data, error } = await rpc('guides_search', { p_query: q, p_limit: limit })
  if (error) return []
  return (data ?? []) as unknown as GuideSearchHit[]
}

/* ---- reader writes -------------------------------------------------------- */

export async function toggleGuideBookmark(guideId: string): Promise<boolean | null> {
  const { data, error } = await rpc('guide_bookmark_toggle', { p_id: guideId })
  if (error) return null
  const r = data as { ok?: boolean; bookmarked?: boolean } | null
  return r?.ok ? !!r.bookmarked : null
}

/** Record the view and where the reader is. Fire-and-forget: failing to count
 *  a view is never a reason to interrupt someone reading. */
export async function recordGuideView(guideId: string, anchor?: string | null): Promise<void> {
  await rpc('guide_view', { p_id: guideId, p_anchor: anchor ?? null }).catch(() => undefined)
}

export async function markGuideComplete(guideId: string, complete: boolean): Promise<boolean> {
  const { data, error } = await rpc('guide_mark_complete', { p_id: guideId, p_complete: complete })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

export type GuideFeedbackKind = 'helpful' | 'broken_link' | 'outdated' | 'suggestion'

/** Returns null on success, or the message to show. */
export async function submitGuideFeedback(args: {
  guideId: string
  kind: GuideFeedbackKind
  rating?: 'yes' | 'partly' | 'no'
  comment?: string
  anchor?: string | null
}): Promise<string | null> {
  const { data, error } = await rpc('guide_feedback_submit', {
    p_id: args.guideId,
    p_kind: args.kind,
    p_rating: args.rating ?? null,
    p_comment: args.comment ?? null,
    p_anchor: args.anchor ?? null,
  })
  if (error) return error.message
  const r = data as { ok?: boolean; message?: string } | null
  return r?.ok ? null : (r?.message ?? 'that could not be sent')
}

export async function markGuideOutdated(guideId: string, reason: string): Promise<string | null> {
  const { data, error } = await rpc('guide_mark_outdated', { p_id: guideId, p_reason: reason })
  if (error) return error.message
  const r = data as { ok?: boolean; message?: string } | null
  return r?.ok ? null : (r?.message ?? 'that could not be recorded')
}

/* ---- editor writes -------------------------------------------------------- */

export async function setGuidePublished(guideId: string, published: boolean, note?: string): Promise<boolean> {
  const { data, error } = await rpc('guide_publish', {
    p_id: guideId, p_published: published, p_note: note ?? null,
  })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

export async function setGuidePinned(guideId: string, pinned: boolean): Promise<boolean> {
  const { data, error } = await rpc('guide_set_pinned', { p_id: guideId, p_pinned: pinned })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

export async function setGuideArchived(guideId: string, archived: boolean, reason?: string): Promise<string | null> {
  const { data, error } = await rpc('guide_archive', {
    p_id: guideId, p_archived: archived, p_reason: reason ?? null,
  })
  if (error) return error.message
  const r = data as { ok?: boolean; message?: string } | null
  return r?.ok ? null : (r?.message ?? 'that could not be changed')
}

export interface GuideMetaPatch {
  id?: string | null
  slug?: string
  title?: string
  summary?: string
  category?: string
  bodyKey?: string
  bodyKind?: 'module' | 'sections'
  audience?: GuideAudience
  customRoles?: string[]
  tags?: string[]
  keywords?: string
  readMinutes?: number | null
  nextReviewAt?: string | null
  /** The `updated_at` the editor last saw. The server refuses the write if the
   *  row has moved on, so two editors never silently overwrite each other. */
  expectedUpdatedAt?: string | null
}

export type GuideSaveResult =
  | { ok: true; id: string; slug: string; updatedAt: string }
  | { ok: false; code: string; message: string; updatedAt?: string }

export async function saveGuide(patch: GuideMetaPatch): Promise<GuideSaveResult> {
  const { data, error } = await rpc('guide_upsert', {
    p_id: patch.id ?? null,
    p_slug: patch.slug ?? null,
    p_title: patch.title ?? null,
    p_summary: patch.summary ?? null,
    p_category: patch.category ?? null,
    p_body_key: patch.bodyKey ?? null,
    p_audience: patch.audience ?? null,
    p_custom_roles: patch.customRoles ?? null,
    p_tags: patch.tags ?? null,
    p_keywords: patch.keywords ?? null,
    p_body_kind: patch.bodyKind ?? null,
    p_read_minutes: patch.readMinutes ?? null,
    p_content_owner: null,
    p_next_review_at: patch.nextReviewAt ?? null,
    p_expected_updated_at: patch.expectedUpdatedAt ?? null,
  })
  if (error) return { ok: false, code: 'error', message: error.message }
  const r = data as { ok?: boolean; id?: string; slug?: string; code?: string; message?: string; updated_at?: string } | null
  if (r?.ok) return { ok: true, id: r.id!, slug: r.slug!, updatedAt: r.updated_at! }
  return { ok: false, code: r?.code ?? 'error', message: r?.message ?? 'that could not be saved', updatedAt: r?.updated_at }
}

export async function saveGuideSection(args: {
  guideId: string
  id?: string | null
  heading?: string
  body?: string
  anchor?: string
  expectedUpdatedAt?: string | null
}): Promise<GuideSaveResult> {
  const { data, error } = await rpc('guide_section_upsert', {
    p_guide: args.guideId,
    p_id: args.id ?? null,
    p_heading: args.heading ?? null,
    p_body: args.body ?? null,
    p_anchor: args.anchor ?? null,
    p_expected_updated_at: args.expectedUpdatedAt ?? null,
  })
  if (error) return { ok: false, code: 'error', message: error.message }
  const r = data as { ok?: boolean; id?: string; anchor?: string; code?: string; message?: string; updated_at?: string } | null
  if (r?.ok) return { ok: true, id: r.id!, slug: r.anchor!, updatedAt: r.updated_at! }
  return { ok: false, code: r?.code ?? 'error', message: r?.message ?? 'that could not be saved', updatedAt: r?.updated_at }
}

export async function reorderGuideSections(guideId: string, ids: string[]): Promise<boolean> {
  const { data, error } = await rpc('guide_sections_reorder', { p_guide: guideId, p_ids: ids })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

export async function removeGuideSection(id: string): Promise<boolean> {
  const { data, error } = await rpc('guide_section_remove', { p_id: id })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

export async function duplicateGuide(id: string, slug: string, title?: string): Promise<GuideSaveResult> {
  const { data, error } = await rpc('guide_duplicate', { p_id: id, p_slug: slug, p_title: title ?? null })
  if (error) return { ok: false, code: 'error', message: error.message }
  const r = data as { ok?: boolean; id?: string; slug?: string; code?: string; message?: string } | null
  if (r?.ok) return { ok: true, id: r.id!, slug: r.slug!, updatedAt: '' }
  return { ok: false, code: r?.code ?? 'error', message: r?.message ?? 'that could not be duplicated' }
}

export async function restoreGuideRevision(revisionId: string): Promise<boolean> {
  const { data, error } = await rpc('guide_revision_restore', { p_id: revisionId })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

export async function markGuideReviewed(guideId: string, nextReviewAt?: string | null): Promise<boolean> {
  const { data, error } = await rpc('guide_mark_reviewed', {
    p_id: guideId, p_next_review_at: nextReviewAt ?? null,
  })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

export async function resolveGuideFeedback(id: string, status: string, note?: string): Promise<boolean> {
  const { data, error } = await rpc('guide_feedback_resolve', { p_id: id, p_status: status, p_note: note ?? null })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

export async function saveGuideCategory(args: {
  slug: string; label?: string; description?: string; sortOrder?: number; active?: boolean
}): Promise<string | null> {
  const { data, error } = await rpc('guide_category_upsert', {
    p_slug: args.slug,
    p_label: args.label ?? null,
    p_description: args.description ?? null,
    p_sort_order: args.sortOrder ?? null,
    p_active: args.active ?? null,
  })
  if (error) return error.message
  const r = data as { ok?: boolean; message?: string } | null
  return r?.ok ? null : (r?.message ?? 'that could not be saved')
}

/* ---- imagery (editors) ---------------------------------------------------- */

/** Client-side validation of a chosen file — the same three rules the RPC and
 *  the table CHECK constraints apply. Returns the reason to refuse, or null.
 *  This exists to say no before a 10 MB upload, not to decide anything. */
export function validateGuideImage(file: { type: string; size: number }): string | null {
  if (!(GUIDE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'A guide image is a PNG, JPEG, WebP or GIF.'
  }
  if (file.size <= 0 || file.size > GUIDE_IMAGE_MAX_BYTES) return 'A guide image is at most 10 MB.'
  return null
}

export interface GuideImageUpload {
  guideId: string
  /** A section anchor, or null for the guide's cover. */
  section: string | null
  alt: string
  caption?: string
  file: File
}

/** Reserve the row, then upload the bytes to the path it returns.
 *
 *  The order matters and is not an implementation detail: the storage policy
 *  admits an object only when a guide_media row already names that exact path,
 *  belongs to that guide, and was created by the caller. */
export async function addGuideImage(u: GuideImageUpload): Promise<string | null> {
  const bad = validateGuideImage(u.file)
  if (bad) return bad
  const { data, error } = await rpc('guide_media_attach', {
    p_guide: u.guideId,
    p_alt: u.alt,
    p_filename: u.file.name,
    p_section: u.section,
    p_caption: u.caption ?? null,
    p_mime: u.file.type,
    p_byte_size: u.file.size,
  })
  if (error) return error.message
  const r = data as { ok?: boolean; message?: string; storage_path?: string } | null
  if (!r?.ok || !r.storage_path) return r?.message ?? 'the image was refused'
  const up = await supabase().storage.from(GUIDE_BUCKET).upload(r.storage_path, u.file, {
    contentType: u.file.type,
    upsert: false,
  })
  return up.error ? up.error.message : null
}

export async function updateGuideImage(id: string, alt: string, caption: string | null): Promise<boolean> {
  const { data, error } = await rpc('guide_media_update', { p_id: id, p_alt: alt, p_caption: caption })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

export async function reorderGuideImages(guideId: string, ids: string[], section: string | null): Promise<boolean> {
  const { data, error } = await rpc('guide_media_reorder', { p_guide: guideId, p_ids: ids, p_section: section })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

export async function removeGuideImage(id: string): Promise<boolean> {
  const { data, error } = await rpc('guide_media_remove', { p_id: id })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}
