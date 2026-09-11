/** The Guide Library — the data layer behind /guides and /guides/<slug>.
 *
 *  A guide is REFERENCE CONTENT. It reads no portal record, writes none, and
 *  nothing on it is live. The split this module expresses is the whole design:
 *
 *   · The LIBRARY lives in the database — which guides exist, what they are
 *     called, which category they sit in, whether they are published, who
 *     pinned or bookmarked them, and what optional imagery they carry.
 *   · The WRITTEN CONTENT lives in a typed module in the repository, named by
 *     guides.body_key and resolved through components/guides/guideRegistry.
 *     Guide prose is code-reviewed: it changes through a pull request, with
 *     the diff visible, not through a form.
 *
 *  Every write here is an RPC (guide_upsert, guide_publish, guide_set_pinned,
 *  guide_bookmark_toggle, guide_media_*). There is no client INSERT, UPDATE or
 *  DELETE grant on any of the three tables, so what this module can do is what
 *  the server allows — the client-side checks below are cosmetic, as always. */
import { list, rpc } from './db'
import { supabase } from './supabase'
import type { Tables } from './database.types'

export type GuideRow = Tables<'guides'>
export type GuideMediaRow = Tables<'guide_media'>

/** The bucket guide imagery lives in (private; read through signed URLs). */
export const GUIDE_BUCKET = 'guides'
/** Signed-URL lifetime for a guide image. Long enough to read a page. */
export const GUIDE_URL_TTL_S = 60 * 60

/** Upload limits — the same three rules the table CHECKs and the RPC enforce.
 *  Stated here so the picker can refuse before a byte is sent; the server is
 *  the authority either way. */
export const GUIDE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const GUIDE_IMAGE_MAX_BYTES = 10 * 1024 * 1024

export const GUIDE_CATEGORIES = ['systems', 'equipment', 'jobs', 'organizations', 'locations', 'general'] as const
export type GuideCategory = (typeof GUIDE_CATEGORIES)[number]

export const GUIDE_CATEGORY_LABEL: Record<GuideCategory, string> = {
  systems: 'Systems',
  equipment: 'Equipment',
  jobs: 'Jobs',
  organizations: 'Organizations',
  locations: 'Locations',
  general: 'General',
}

/** A category the client does not know about yet (the server grew one) is
 *  humanized rather than dropped — an unlabelled filter is worse than an
 *  ugly one. */
export function guideCategoryLabel(c: string | null | undefined): string {
  if (!c) return GUIDE_CATEGORY_LABEL.general
  if ((GUIDE_CATEGORIES as readonly string[]).includes(c)) return GUIDE_CATEGORY_LABEL[c as GuideCategory]
  return c.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

export const isPublished = (g: Pick<GuideRow, 'status'>): boolean => g.status === 'published'

/** The library's own ordering: pinned first, then most recently updated.
 *  Pure and copy-free so the view can sort a filtered array without
 *  disturbing the loaded rows. */
export function sortGuides(rows: readonly GuideRow[]): GuideRow[] {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const t = (b.updated_at ?? '').localeCompare(a.updated_at ?? '')
    return t !== 0 ? t : a.title.localeCompare(b.title)
  })
}

/** In-library search: title, summary, category label and address. Blank
 *  matches everything, so an empty box is not an empty library. */
export function matchGuides(rows: readonly GuideRow[], query: string): GuideRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...rows]
  return rows.filter((g) =>
    `${g.title} ${g.summary ?? ''} ${guideCategoryLabel(g.category)} ${g.slug}`.toLowerCase().includes(q))
}

/** The library. RLS decides what comes back: every active member sees the
 *  published guides, an editor also sees the drafts. Deleted rows never
 *  appear (list() filters them — guides is a SOFT_DELETE_KIND table). */
export async function listGuides(): Promise<GuideRow[]> {
  return sortGuides(await list('guides', { order: 'updated_at', ascending: false }))
}

/** The caller's own bookmarks. Nobody else's row is readable — not command's
 *  and not the Owner's — so this is always "mine". */
export async function listBookmarkedGuideIds(): Promise<Set<string>> {
  const rows = await list('guide_bookmarks', {})
  return new Set(rows.map((r) => r.guide_id))
}

/** One guide by its address. Returns null when the slug names nothing the
 *  caller may read — a draft looks exactly like a guide that does not exist,
 *  which is what makes drafting safe. */
export async function getGuideBySlug(slug: string): Promise<GuideRow | null> {
  const rows = await list('guides', { eq: { slug }, limit: 1 })
  return rows[0] ?? null
}

/** A guide's imagery, in the editor's order. `section` is a section id, or
 *  null for the cover. An empty result is the normal case: imagery is
 *  optional and a guide without it renders no imagery and no placeholder. */
export async function listGuideMedia(guideId: string): Promise<GuideMediaRow[]> {
  const rows = await list('guide_media', { eq: { guide_id: guideId } })
  return [...rows].sort((a, b) =>
    (a.section ?? '').localeCompare(b.section ?? '') || a.sort_order - b.sort_order)
}

/** A readable URL for one stored image. Null when the object is gone or the
 *  caller may not read it — callers render nothing rather than a broken
 *  picture. */
export async function guideImageUrl(storagePath: string, expiresIn = GUIDE_URL_TTL_S): Promise<string | null> {
  const { data, error } = await supabase().storage.from(GUIDE_BUCKET).createSignedUrl(storagePath, expiresIn)
  return error ? null : (data?.signedUrl ?? null)
}

/** Add or remove the caller's bookmark. Returns the new state, or null if the
 *  server refused (it answers not_found for a guide the caller cannot read). */
export async function toggleGuideBookmark(guideId: string): Promise<boolean | null> {
  const { data, error } = await rpc('guide_bookmark_toggle', { p_id: guideId })
  if (error) return null
  const r = data as { ok?: boolean; bookmarked?: boolean } | null
  return r?.ok ? !!r.bookmarked : null
}

/** Publish or unpublish. Editors only — the RPC raises P0403 for everyone
 *  else, and db.rpc() acknowledges the refusal for the audit trail. */
export async function setGuidePublished(guideId: string, published: boolean): Promise<boolean> {
  const { data, error } = await rpc('guide_publish', { p_id: guideId, p_published: published })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

/** Pin or unpin. A pin is the division's statement about what matters; a
 *  bookmark is the reader's own. */
export async function setGuidePinned(guideId: string, pinned: boolean): Promise<boolean> {
  const { data, error } = await rpc('guide_set_pinned', { p_id: guideId, p_pinned: pinned })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

/* ---- imagery (editors) --------------------------------------------------- */

/** Client-side validation of a chosen file — the same three rules the RPC and
 *  the table CHECK constraints apply. Returns the reason to refuse, or null.
 *  This exists to say no before a 10 MB upload, not to decide anything: the
 *  server refuses the same file for the same reasons. */
export function validateGuideImage(file: { type: string; size: number }): string | null {
  if (!(GUIDE_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'A guide image is a PNG, JPEG, WebP or GIF.'
  }
  if (file.size <= 0 || file.size > GUIDE_IMAGE_MAX_BYTES) return 'A guide image is at most 10 MB.'
  return null
}

export interface GuideImageUpload {
  guideId: string
  /** A section id, or null for the guide's cover. */
  section: string | null
  alt: string
  caption?: string
  file: File
}

/** Reserve the row, then upload the bytes to the path it returns.
 *
 *  The order matters and is not an implementation detail: the storage policy
 *  admits an object only when a guide_media row already names that exact path,
 *  belongs to that guide, and was created by the caller. An upload that races
 *  ahead of its row is refused by the bucket. */
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

/** Correct an image's alternative text or caption. Replacing the picture
 *  itself is remove + add: an uploaded object is immutable. */
export async function updateGuideImage(id: string, alt: string, caption: string | null): Promise<boolean> {
  const { data, error } = await rpc('guide_media_update', { p_id: id, p_alt: alt, p_caption: caption })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

/** Set the order of one slot's images. `ids` is the new order. */
export async function reorderGuideImages(guideId: string, ids: string[], section: string | null): Promise<boolean> {
  const { data, error } = await rpc('guide_media_reorder', { p_guide: guideId, p_ids: ids, p_section: section })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}

/** Take an image off a guide. The written content is untouched — that is the
 *  whole reason imagery lives in its own table. */
export async function removeGuideImage(id: string): Promise<boolean> {
  const { data, error } = await rpc('guide_media_remove', { p_id: id })
  return !error && !!(data as { ok?: boolean } | null)?.ok
}
