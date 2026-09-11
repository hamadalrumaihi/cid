/** The Guide Library (migrations 20261107120000 and 20261108120000).
 *
 *  The CONTRACT of the server functions, answered from the mock store — never
 *  a second implementation of the server's authority model:
 *   · every library table is SELECT-only for clients: each INSERT / UPDATE /
 *     DELETE is PostgREST's grant denial (403 / 42501), exactly as the
 *     `revoke all … grant select` in the migrations leaves it. Reads fall
 *     through to postgrest.ts.
 *   · Refusal style, as everywhere else: AUTHORITY refusals RAISE through
 *     `private.perm_raise` (SQLSTATE P0403 → 400 here); VALIDATION refusals
 *     RETURN `{ok:false, code, message}`.
 *   · The rules the UI is built on: a new guide lands as a DRAFT; the first
 *     publication date is kept across an unpublish/republish; a guide written
 *     in the editor cannot be published empty; a save carrying a stale
 *     `expected_updated_at` is a conflict rather than an overwrite; a
 *     bookmark and a reading position are the caller's own; and a guide image
 *     needs alternative text, one of four types and at most 10 MB.
 *
 *  Visibility here is deliberately shallow — published and not archived, or
 *  the caller may edit — because the real wall is RLS and tests/rls covers
 *  it. The AUDIENCE wall in particular is RLS's alone: nothing here should be
 *  read as the authority on who may see a restricted guide. */
import { http } from 'msw'
import type { Database, Tables } from '@/lib/database.types'
import { supabaseBaseUrl } from '../env'
import { getDenial, getRows, mockId, seedRows, setRows, type MockRow, type MockTableName } from '../store'
import { isActive, isCommand, isOwner, uid } from './entity'
import { postgrestError } from './postgrest'

type Fns = Database['public']['Functions']
type Args = Record<string, unknown>
type Guide = Tables<'guides'>
type GuideMedia = Tables<'guide_media'>
type GuideSection = Tables<'guide_sections'>
type Refusal = { ok: false; code: string; message: string }

const str = (v: unknown): string => (v == null ? '' : String(v))
const blank = (v: unknown): string | null => str(v).trim() || null
const now = () => new Date().toISOString()
const strArray = (v: unknown): string[] | null =>
  Array.isArray(v) ? (v as unknown[]).map(str) : null

/** A server `raise` — rpc.ts turns it into PostgREST's 400 error shape.
 *  `P0403` marks an AUTHORITY refusal (private.perm_raise). */
export class GuideRpcError extends Error {
  code: string
  constructor(message: string, code = 'P0001') { super(message); this.code = code }
}
function deny(message: string): never { throw new GuideRpcError(message, 'P0403') }
const refuse = (code: string, message: string): Refusal => ({ ok: false, code, message })

export const GUIDE_RPC_ONLY_TABLES: readonly MockTableName[] = [
  'guides', 'guide_media', 'guide_bookmarks', 'guide_categories', 'guide_sections',
  'guide_revisions', 'guide_progress', 'guide_feedback', 'guide_search_index',
]

/** The categories the library ships with, in the order they are offered.
 *  Administrators add more through `guide_category_upsert` — the server
 *  validates against the TABLE, not against this list, so the mock accepts a
 *  seeded category this array does not name. */
export const GUIDE_CATEGORIES = [
  'portal', 'investigations', 'reports-evidence', 'legal', 'organizations',
  'restricted-operations', 'command-admin', 'systems', 'troubleshooting',
] as const

/** Retired, but still valid: guides filed under them before the library was
 *  reorganized still resolve. */
export const GUIDE_CATEGORIES_RETIRED = ['equipment', 'jobs', 'locations', 'general'] as const

export const GUIDE_AUDIENCES = [
  'all', 'investigative', 'command', 'doj', 'sib', 'ci_handlers', 'owner', 'custom',
] as const
export const GUIDE_BODY_KINDS = ['module', 'sections'] as const
export const GUIDE_FEEDBACK_KINDS = ['helpful', 'broken_link', 'outdated', 'suggestion'] as const
export const GUIDE_FEEDBACK_STATUSES = ['new', 'reviewing', 'resolved', 'declined'] as const

export const GUIDE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const GUIDE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const ANCHOR_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const GUIDE_MESSAGES = {
  notActive: 'not an active member',
  noEdit: 'you may not edit guides',
  noPublish: 'you may not publish guides',
  noPin: 'you may not pin guides',
  noImages: 'you may not add images to guides',
  noImageEdit: 'you may not edit guide images',
  noImageRemove: 'you may not remove guide images',
  notFound: 'guide not found',
  sectionNotFound: 'section not found',
  revisionNotFound: 'revision not found',
  feedbackNotFound: 'that feedback was not found',
  imageNotFound: 'image not found',
  needsFields: 'a new guide needs an address, a title and — for a module guide — a body key',
  badSlug: 'an address is lowercase words joined by hyphens',
  badAnchor: 'an anchor is lowercase words joined by hyphens',
  slugTaken: 'another guide already lives at that address',
  anchorTaken: 'another section of this guide already uses that anchor',
  badCategory: 'unknown category',
  badAudience: 'unknown audience',
  badBodyKind: 'unknown body kind',
  badReadMinutes: 'a reading time is between 1 and 600 minutes',
  badRating: 'an answer is yes, partly or no',
  badFeedbackKind: 'unknown feedback kind',
  badStatus: 'unknown status',
  conflict: 'someone else saved this guide while you were editing',
  emptyGuide: 'write at least one section before publishing',
  needsHeading: 'a section needs a heading',
  needsReason: 'say what is out of date',
  altRequired: 'describe what the image shows',
  badType: 'a guide image is a PNG, JPEG, WebP or GIF',
  tooLarge: 'a guide image is at most 10 MB',
} as const

/** private.can_edit_guides() — active AND (command OR owner). */
export const canEditGuides = (): boolean => isActive() && (isCommand() || isOwner())

const guideRows = (): MockRow[] => (getDenial('guides') ? [] : getRows('guides'))
const liveGuides = (): Guide[] => guideRows().filter((r) => r.deleted_at == null) as unknown as Guide[]
const mediaRows = (): GuideMedia[] => (getDenial('guide_media') ? [] : getRows('guide_media')) as unknown as GuideMedia[]
const sectionRows = (): GuideSection[] =>
  (getDenial('guide_sections') ? [] : getRows('guide_sections')) as unknown as GuideSection[]

/** What the caller may currently read: a published, unarchived guide, or any
 *  live guide when they may edit. The audience wall is RLS's. */
const readable = (id: unknown): Guide | null =>
  liveGuides().find((g) => g.id === str(id)
    && ((g.status === 'published' && g.archived_at == null) || canEditGuides())) ?? null

/** A category the server would accept: one that exists in the table. The mock
 *  falls back to the shipped vocabulary when nothing has been seeded. */
function knownCategory(slug: string): boolean {
  const seeded = getRows('guide_categories')
  if (seeded.length) return seeded.some((c) => c.slug === slug)
  return ([...GUIDE_CATEGORIES, ...GUIDE_CATEGORIES_RETIRED] as readonly string[]).includes(slug)
}

/** The next revision number for a guide, and the snapshot that goes with it.
 *  The real one stores the guide and its sections; so does this. */
function saveRevision(guideId: string, summary: string): number {
  const g = liveGuides().find((x) => x.id === guideId)
  if (!g) return 0
  const existing = getRows('guide_revisions').filter((r) => r.guide_id === guideId)
  const no = existing.reduce((n, r) => Math.max(n, Number(r.revision_no) + 1), 1)
  seedRows('guide_revisions', [{
    id: mockId(),
    guide_id: guideId,
    revision_no: no,
    snapshot: {
      guide: g as unknown as Record<string, unknown>,
      sections: sectionRows().filter((s) => s.guide_id === guideId),
    },
    summary,
    created_by: uid(),
    created_at: now(),
  } as unknown as Tables<'guide_revisions'>])
  return no
}

/** Patch one guide row in place, stamping the house `touch()` columns. */
function patchGuide(id: string, patch: MockRow): Guide | null {
  const rows = getRows('guides')
  const idx = rows.findIndex((r) => r.id === id && r.deleted_at == null)
  if (idx < 0) return null
  rows[idx] = { ...rows[idx], ...patch, updated_by: uid(), updated_at: now() }
  setRows('guides', rows)
  return rows[idx] as unknown as Guide
}

/* ── guide_upsert ───────────────────────────────────────────────────────── */

export function guideUpsert(args: Args): Fns['guide_upsert']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const id = blank(args.p_id)
  const slug = blank(args.p_slug)?.toLowerCase() ?? null
  const title = blank(args.p_title)
  const body = blank(args.p_body_key)
  const category = blank(args.p_category)?.toLowerCase() ?? null
  const audience = blank(args.p_audience)?.toLowerCase() ?? null
  let kind = blank(args.p_body_kind)?.toLowerCase() ?? null
  const readMinutes = args.p_read_minutes == null ? null : Number(args.p_read_minutes)

  if (slug && !SLUG_RE.test(slug)) return refuse('bad_slug', GUIDE_MESSAGES.badSlug)
  if (category && !knownCategory(category)) return refuse('bad_request', GUIDE_MESSAGES.badCategory)
  if (audience && !(GUIDE_AUDIENCES as readonly string[]).includes(audience)) {
    return refuse('bad_value', GUIDE_MESSAGES.badAudience)
  }
  if (kind && !(GUIDE_BODY_KINDS as readonly string[]).includes(kind)) {
    return refuse('bad_value', GUIDE_MESSAGES.badBodyKind)
  }
  if (readMinutes !== null && (!(readMinutes > 0) || readMinutes > 600)) {
    return refuse('bad_value', GUIDE_MESSAGES.badReadMinutes)
  }
  if (slug && liveGuides().some((g) => g.slug === slug && g.id !== id)) {
    return refuse('slug_taken', GUIDE_MESSAGES.slugTaken)
  }

  if (!id) {
    // A 'module' guide is rendered from a code-reviewed module, so it needs a
    // body key; a 'sections' guide is written in the editor and does not.
    kind = kind ?? 'sections'
    if (!slug || !title || (kind === 'module' && !body)) {
      return refuse('bad_request', GUIDE_MESSAGES.needsFields)
    }
    // A new guide is ALWAYS a draft — there is no path here that publishes on
    // create, because there is none on the server either.
    const row: Guide = {
      id: mockId(), slug, title, summary: blank(args.p_summary),
      category: category ?? 'portal', status: 'draft', body_key: body ?? slug, pinned: false,
      body_kind: kind, audience: audience ?? 'all',
      custom_roles: strArray(args.p_custom_roles) ?? [], tags: strArray(args.p_tags) ?? [],
      keywords: blank(args.p_keywords), read_minutes: readMinutes, view_count: 0,
      content_owner: blank(args.p_content_owner) ?? uid(),
      last_reviewed_at: null, next_review_at: blank(args.p_next_review_at),
      archived_at: null, archived_by: null, publication_note: null,
      outdated_at: null, outdated_by: null, outdated_reason: null,
      published_at: null, created_by: uid(), updated_by: uid(),
      created_at: now(), updated_at: now(),
      deleted_at: null, deleted_by: null, delete_reason: null, delete_batch: null,
    }
    seedRows('guides', [row])
    saveRevision(row.id, 'Created')
    return { ok: true, id: row.id, slug: row.slug, status: row.status, updated_at: row.updated_at }
  }

  const current = liveGuides().find((g) => g.id === id)
  if (!current) return refuse('not_found', GUIDE_MESSAGES.notFound)
  // The conflict check: somebody else saved since this editor last read it.
  const expected = blank(args.p_expected_updated_at)
  if (expected && current.updated_at !== expected) {
    return {
      ok: false, code: 'conflict', message: GUIDE_MESSAGES.conflict,
      updated_at: current.updated_at, updated_by: current.updated_by,
    }
  }
  const patch: MockRow = {}
  if (slug) patch.slug = slug
  if (title) patch.title = title
  if (args.p_summary != null) patch.summary = blank(args.p_summary)
  if (category) patch.category = category
  if (body) patch.body_key = body
  if (kind) patch.body_kind = kind
  if (audience) patch.audience = audience
  if (args.p_custom_roles != null) patch.custom_roles = strArray(args.p_custom_roles) ?? []
  if (args.p_tags != null) patch.tags = strArray(args.p_tags) ?? []
  if (args.p_keywords != null) patch.keywords = blank(args.p_keywords)
  if (readMinutes !== null) patch.read_minutes = readMinutes
  if (args.p_content_owner != null) patch.content_owner = blank(args.p_content_owner)
  if (args.p_next_review_at != null) patch.next_review_at = blank(args.p_next_review_at)
  const next = patchGuide(id, patch)!
  return { ok: true, id: next.id, slug: next.slug, status: next.status, updated_at: next.updated_at }
}

/* ── guide_publish ──────────────────────────────────────────────────────── */

export function guidePublish(args: Args): Fns['guide_publish']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noPublish)
  const want = args.p_published === false ? 'draft' : 'published'
  const id = str(args.p_id)
  const g = liveGuides().find((r) => r.id === id)
  if (!g) return refuse('not_found', GUIDE_MESSAGES.notFound)
  // An empty guide is worse than no guide: it looks like an answer.
  if (want === 'published' && g.body_kind === 'sections'
      && !sectionRows().some((s) => s.guide_id === id)) {
    return refuse('empty', GUIDE_MESSAGES.emptyGuide)
  }
  if (g.status === want) return { ok: true, id: g.id, status: g.status, unchanged: true }
  const note = blank(args.p_note)
  const revision = saveRevision(id, note ?? (want === 'published' ? 'Published' : 'Unpublished'))
  // published_at is the FIRST publication and is never rewritten.
  const next = patchGuide(id, want === 'published'
    ? {
      status: want, published_at: g.published_at ?? now(), publication_note: note,
      last_reviewed_at: now(), outdated_at: null, outdated_by: null, outdated_reason: null,
    }
    : { status: want })!
  return { ok: true, id: next.id, status: next.status, revision }
}

/* ── guide_set_pinned ───────────────────────────────────────────────────── */

export function guideSetPinned(args: Args): Fns['guide_set_pinned']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noPin)
  const pinned = args.p_pinned !== false
  const next = patchGuide(str(args.p_id), { pinned })
  if (!next) return refuse('not_found', GUIDE_MESSAGES.notFound)
  return { ok: true, id: next.id, pinned }
}

/* ── guide_archive / guide_duplicate ────────────────────────────────────── */

export function guideArchive(args: Args): Fns['guide_archive']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const archived = args.p_archived !== false
  const id = str(args.p_id)
  const g = liveGuides().find((r) => r.id === id)
  if (!g) return refuse('not_found', GUIDE_MESSAGES.notFound)
  // Archiving hides a guide from readers; restoring puts it back exactly as
  // it was, because nothing about it was destroyed.
  const next = patchGuide(id, archived
    ? { archived_at: now(), archived_by: uid(), status: 'draft' }
    : { archived_at: null, archived_by: null })!
  return { ok: true, id: next.id, archived }
}

export function guideDuplicate(args: Args): Fns['guide_duplicate']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const g = liveGuides().find((r) => r.id === str(args.p_id))
  if (!g) return refuse('not_found', GUIDE_MESSAGES.notFound)
  const slug = blank(args.p_slug)?.toLowerCase() ?? null
  if (!slug || !SLUG_RE.test(slug)) return refuse('bad_slug', GUIDE_MESSAGES.badSlug)
  if (liveGuides().some((x) => x.slug === slug)) return refuse('slug_taken', GUIDE_MESSAGES.slugTaken)
  // A copy is ALWAYS a fresh draft: publication state, reading counts and
  // review dates belong to the guide that earned them.
  const copy: Guide = {
    ...g,
    id: mockId(), slug, title: blank(args.p_title) ?? `${g.title} (copy)`,
    status: 'draft', pinned: false, published_at: null, publication_note: null,
    view_count: 0, archived_at: null, archived_by: null,
    last_reviewed_at: null, outdated_at: null, outdated_by: null, outdated_reason: null,
    created_by: uid(), updated_by: uid(), created_at: now(), updated_at: now(),
  }
  seedRows('guides', [copy])
  const clones = sectionRows().filter((s) => s.guide_id === g.id).map((s) => ({
    ...s, id: mockId(), guide_id: copy.id, created_at: now(), updated_at: now(),
  }))
  if (clones.length) seedRows('guide_sections', clones)
  saveRevision(copy.id, 'Duplicated')
  return { ok: true, id: copy.id, slug: copy.slug, status: copy.status }
}

/* ── content health ─────────────────────────────────────────────────────── */

export function guideMarkReviewed(args: Args): Fns['guide_mark_reviewed']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const next = patchGuide(str(args.p_id), {
    last_reviewed_at: now(),
    next_review_at: blank(args.p_next_review_at),
    outdated_at: null, outdated_by: null, outdated_reason: null,
  })
  if (!next) return refuse('not_found', GUIDE_MESSAGES.notFound)
  return { ok: true, id: next.id, last_reviewed_at: next.last_reviewed_at }
}

export function guideMarkOutdated(args: Args): Fns['guide_mark_outdated']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const reason = blank(args.p_reason)
  if (!reason) return refuse('bad_request', GUIDE_MESSAGES.needsReason)
  const next = patchGuide(str(args.p_id), {
    outdated_at: now(), outdated_by: uid(), outdated_reason: reason,
  })
  if (!next) return refuse('not_found', GUIDE_MESSAGES.notFound)
  return { ok: true, id: next.id, outdated_at: next.outdated_at }
}

/* ── categories ─────────────────────────────────────────────────────────── */

export function guideCategoryUpsert(args: Args): Fns['guide_category_upsert']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const slug = blank(args.p_slug)?.toLowerCase() ?? null
  if (!slug || !SLUG_RE.test(slug)) return refuse('bad_slug', GUIDE_MESSAGES.badSlug)
  const rows = getRows('guide_categories')
  const idx = rows.findIndex((r) => r.slug === slug)
  const label = blank(args.p_label)
  if (idx < 0) {
    if (!label) return refuse('bad_request', 'a new category needs a label')
    seedRows('guide_categories', [{
      slug, label, description: blank(args.p_description),
      sort_order: args.p_sort_order == null ? 100 : Number(args.p_sort_order),
      active: args.p_active !== false,
      created_at: now(), updated_at: now(),
    } as unknown as Tables<'guide_categories'>])
    return { ok: true, slug, created: true }
  }
  rows[idx] = {
    ...rows[idx],
    label: label ?? rows[idx].label,
    description: args.p_description === undefined ? rows[idx].description : blank(args.p_description),
    sort_order: args.p_sort_order == null ? rows[idx].sort_order : Number(args.p_sort_order),
    active: args.p_active == null ? rows[idx].active : args.p_active !== false,
    updated_at: now(),
  }
  setRows('guide_categories', rows)
  return { ok: true, slug, created: false }
}

/* ── sections ───────────────────────────────────────────────────────────── */

/** An anchor from a heading, the way the server derives one. */
const anchorFrom = (heading: string): string =>
  heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section'

export function guideSectionUpsert(args: Args): Fns['guide_section_upsert']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const guideId = str(args.p_guide)
  const g = liveGuides().find((r) => r.id === guideId)
  if (!g) return refuse('not_found', GUIDE_MESSAGES.notFound)
  const heading = blank(args.p_heading)
  const id = blank(args.p_id)
  const rows = getRows('guide_sections')

  if (!id) {
    if (!heading) return refuse('bad_request', GUIDE_MESSAGES.needsHeading)
    const anchor = blank(args.p_anchor)?.toLowerCase() ?? anchorFrom(heading)
    if (!ANCHOR_RE.test(anchor)) return refuse('bad_anchor', GUIDE_MESSAGES.badAnchor)
    if (rows.some((r) => r.guide_id === guideId && r.anchor === anchor)) {
      return refuse('anchor_taken', GUIDE_MESSAGES.anchorTaken)
    }
    const sort = rows.filter((r) => r.guide_id === guideId)
      .reduce((n, r) => Math.max(n, Number(r.sort_order) + 1), 0)
    const row = {
      id: mockId(), guide_id: guideId, anchor, heading, body: str(args.p_body),
      sort_order: sort, created_at: now(), updated_at: now(),
    } as unknown as GuideSection
    seedRows('guide_sections', [row])
    return { ok: true, id: row.id, anchor, updated_at: row.updated_at }
  }

  const idx = rows.findIndex((r) => r.id === id && r.guide_id === guideId)
  if (idx < 0) return refuse('not_found', GUIDE_MESSAGES.sectionNotFound)
  const expected = blank(args.p_expected_updated_at)
  if (expected && rows[idx].updated_at !== expected) {
    return {
      ok: false, code: 'conflict', message: GUIDE_MESSAGES.conflict,
      updated_at: str(rows[idx].updated_at),
    }
  }
  // The anchor is set once and never rewritten: a link to a section has to
  // keep working, and an editor renaming a heading must not break it.
  rows[idx] = {
    ...rows[idx],
    heading: heading ?? rows[idx].heading,
    body: args.p_body === undefined ? rows[idx].body : str(args.p_body),
    updated_at: now(),
  }
  setRows('guide_sections', rows)
  return { ok: true, id: str(rows[idx].id), anchor: str(rows[idx].anchor), updated_at: str(rows[idx].updated_at) }
}

export function guideSectionsReorder(args: Args): Fns['guide_sections_reorder']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const ids = strArray(args.p_ids) ?? []
  if (!ids.length) return refuse('bad_request', 'no sections were named')
  const guideId = str(args.p_guide)
  const rows = getRows('guide_sections')
  let moved = 0
  ids.forEach((id, i) => {
    const idx = rows.findIndex((r) => r.id === id && r.guide_id === guideId)
    if (idx < 0) return
    rows[idx] = { ...rows[idx], sort_order: i, updated_at: now() }
    moved += 1
  })
  setRows('guide_sections', rows)
  return { ok: true, guide_id: guideId, moved }
}

export function guideSectionRemove(args: Args): Fns['guide_section_remove']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const rows = getRows('guide_sections')
  const row = rows.find((r) => r.id === str(args.p_id))
  if (!row) return refuse('not_found', GUIDE_MESSAGES.sectionNotFound)
  // The revision is taken BEFORE the deletion, so the restore path can put
  // the section back.
  const revision = saveRevision(str(row.guide_id), `Removed section “${str(row.heading)}”`)
  setRows('guide_sections', rows.filter((r) => r.id !== row.id))
  return { ok: true, id: str(row.id), guide_id: str(row.guide_id), revision }
}

export function guideRevisionRestore(args: Args): Fns['guide_revision_restore']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const rev = getRows('guide_revisions').find((r) => r.id === str(args.p_id))
  if (!rev) return refuse('not_found', GUIDE_MESSAGES.revisionNotFound)
  const snap = rev.snapshot as { guide?: MockRow; sections?: MockRow[] } | null
  const guideId = str(rev.guide_id)
  if (!snap?.guide) return refuse('bad_request', 'that revision holds nothing to restore')
  // What is there now becomes a revision of its own first — restoring is
  // never a way to lose work.
  saveRevision(guideId, `Replaced by revision ${str(rev.revision_no)}`)
  patchGuide(guideId, {
    title: snap.guide.title, summary: snap.guide.summary, category: snap.guide.category,
    audience: snap.guide.audience, tags: snap.guide.tags, keywords: snap.guide.keywords,
    body_key: snap.guide.body_key, body_kind: snap.guide.body_kind,
  })
  const others = getRows('guide_sections').filter((s) => s.guide_id !== guideId)
  setRows('guide_sections', [...others, ...(snap.sections ?? [])])
  return { ok: true, id: guideId, revision: Number(rev.revision_no) }
}

/* ── reader state ───────────────────────────────────────────────────────── */

export function guideBookmarkToggle(args: Args): Fns['guide_bookmark_toggle']['Returns'] {
  if (!uid() || !isActive()) deny(GUIDE_MESSAGES.notActive)
  const g = readable(args.p_id)
  if (!g) return refuse('not_found', GUIDE_MESSAGES.notFound)
  const rows = getRows('guide_bookmarks')
  const mine = (r: MockRow) => r.guide_id === g.id && r.user_id === uid()
  if (rows.some(mine)) {
    setRows('guide_bookmarks', rows.filter((r) => !mine(r)))
    return { ok: true, id: g.id, bookmarked: false }
  }
  seedRows('guide_bookmarks', [{ guide_id: g.id, user_id: uid()!, created_at: now() }])
  return { ok: true, id: g.id, bookmarked: true }
}

/** The caller's own progress row, created on first sight. */
function progressFor(guideId: string): { rows: MockRow[]; idx: number } {
  const rows = getRows('guide_progress')
  let idx = rows.findIndex((r) => r.guide_id === guideId && r.user_id === uid())
  if (idx < 0) {
    rows.push({
      guide_id: guideId, user_id: uid(), last_anchor: null, last_viewed_at: now(),
      seen_updated_at: null, completed_at: null, updated_at: now(),
    })
    idx = rows.length - 1
  }
  return { rows, idx }
}

export function guideView(args: Args): Fns['guide_view']['Returns'] {
  if (!uid() || !isActive()) deny(GUIDE_MESSAGES.notActive)
  const g = readable(args.p_id)
  if (!g) return refuse('not_found', GUIDE_MESSAGES.notFound)
  const rows = getRows('guides')
  const gi = rows.findIndex((r) => r.id === g.id)
  // The view counter is not `touch()`ed: counting a read must not make the
  // guide look edited.
  rows[gi] = { ...rows[gi], view_count: Number(rows[gi].view_count ?? 0) + 1 }
  setRows('guides', rows)
  const { rows: p, idx } = progressFor(g.id)
  const anchor = blank(args.p_anchor)
  p[idx] = {
    ...p[idx],
    last_anchor: anchor ?? p[idx].last_anchor,
    last_viewed_at: now(),
    seen_updated_at: g.updated_at,
    updated_at: now(),
  }
  setRows('guide_progress', p)
  return { ok: true, id: g.id }
}

export function guideMarkComplete(args: Args): Fns['guide_mark_complete']['Returns'] {
  if (!uid() || !isActive()) deny(GUIDE_MESSAGES.notActive)
  const g = readable(args.p_id)
  if (!g) return refuse('not_found', GUIDE_MESSAGES.notFound)
  const complete = args.p_complete !== false
  const { rows, idx } = progressFor(g.id)
  rows[idx] = { ...rows[idx], completed_at: complete ? now() : null, updated_at: now() }
  setRows('guide_progress', rows)
  return { ok: true, id: g.id, completed: complete }
}

/* ── feedback ───────────────────────────────────────────────────────────── */

export function guideFeedbackSubmit(args: Args): Fns['guide_feedback_submit']['Returns'] {
  if (!uid() || !isActive()) deny(GUIDE_MESSAGES.notActive)
  const g = readable(args.p_id)
  if (!g) return refuse('not_found', GUIDE_MESSAGES.notFound)
  const kind = blank(args.p_kind)?.toLowerCase() ?? 'helpful'
  if (!(GUIDE_FEEDBACK_KINDS as readonly string[]).includes(kind)) {
    return refuse('bad_value', GUIDE_MESSAGES.badFeedbackKind)
  }
  const rating = blank(args.p_rating)?.toLowerCase() ?? null
  if (rating && !['yes', 'partly', 'no'].includes(rating)) {
    return refuse('bad_value', GUIDE_MESSAGES.badRating)
  }
  const id = mockId()
  seedRows('guide_feedback', [{
    id, guide_id: g.id, anchor: blank(args.p_anchor), kind, rating,
    comment: blank(args.p_comment), status: 'new', resolved_by: null, resolved_at: null,
    resolution_note: null, created_by: uid(), created_at: now(), updated_at: now(),
  } as unknown as Tables<'guide_feedback'>])
  return { ok: true, id }
}

export function guideFeedbackResolve(args: Args): Fns['guide_feedback_resolve']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const status = blank(args.p_status)?.toLowerCase() ?? null
  if (!status || !(GUIDE_FEEDBACK_STATUSES as readonly string[]).includes(status)) {
    return refuse('bad_value', GUIDE_MESSAGES.badStatus)
  }
  const rows = getRows('guide_feedback')
  const idx = rows.findIndex((r) => r.id === str(args.p_id))
  if (idx < 0) return refuse('not_found', GUIDE_MESSAGES.feedbackNotFound)
  const settled = status === 'resolved' || status === 'declined'
  rows[idx] = {
    ...rows[idx],
    status,
    resolution_note: blank(args.p_note) ?? rows[idx].resolution_note,
    resolved_by: settled ? uid() : null,
    resolved_at: settled ? now() : null,
    updated_at: now(),
  }
  setRows('guide_feedback', rows)
  return { ok: true, id: str(rows[idx].id), status }
}

/* ── search ─────────────────────────────────────────────────────────────── */

/** guides_search — section-level, and permission-respecting by construction:
 *  it can only return a row whose guide the caller may already read. */
export function guidesSearch(args: Args): Fns['guides_search']['Returns'] {
  const q = blank(args.p_query)?.toLowerCase() ?? null
  if (!q) return []
  const limit = args.p_limit == null ? 20 : Number(args.p_limit)
  const index = getDenial('guide_search_index') ? [] : getRows('guide_search_index')
  const out: Fns['guides_search']['Returns'] = []
  for (const r of index) {
    const g = readable(r.guide_id)
    if (!g) continue
    const hay = `${g.title} ${g.summary ?? ''} ${str(r.heading)} ${str(r.terms)} ${(g.tags ?? []).join(' ')} ${g.keywords ?? ''}`.toLowerCase()
    if (!hay.includes(q)) continue
    const body = str(r.terms)
    const at = body.toLowerCase().indexOf(q)
    out.push({
      guide_id: g.id,
      slug: g.slug,
      title: g.title,
      summary: g.summary,
      category: g.category,
      anchor: str(r.anchor),
      heading: str(r.heading),
      snippet: at >= 0 ? body.slice(Math.max(0, at - 40), at + 120) : (g.summary ?? str(r.heading)),
      rank: g.title.toLowerCase().includes(q) ? 1 : 0.5,
    })
  }
  return out.sort((a, b) => b.rank - a.rank || a.title.localeCompare(b.title)).slice(0, limit)
}

/* ── guide_media_* ──────────────────────────────────────────────────────── */

export function guideMediaAttach(args: Args): Fns['guide_media_attach']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noImages)
  const g = liveGuides().find((x) => x.id === str(args.p_guide))
  if (!g) return refuse('not_found', GUIDE_MESSAGES.notFound)
  const alt = blank(args.p_alt)
  if (!alt) return refuse('alt_required', GUIDE_MESSAGES.altRequired)
  const mime = blank(args.p_mime)?.toLowerCase() ?? null
  if (!mime || !(GUIDE_IMAGE_TYPES as readonly string[]).includes(mime)) {
    return refuse('bad_type', GUIDE_MESSAGES.badType)
  }
  const size = args.p_byte_size == null ? 0 : Number(args.p_byte_size)
  if (!(size > 0) || size > GUIDE_IMAGE_MAX_BYTES) return refuse('too_large', GUIDE_MESSAGES.tooLarge)

  const section = blank(args.p_section)
  const id = mockId()
  const name = str(args.p_filename).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 120)
    .replace(/^[-.]+|[-.]+$/g, '') || 'image'
  const sort = mediaRows().filter((m) => m.guide_id === g.id && m.section === section)
    .reduce((n, m) => Math.max(n, m.sort_order + 1), 0)
  const path = `${g.id}/${id}/${name}`
  const row: GuideMedia = {
    id, guide_id: g.id, section, sort_order: sort, storage_path: path,
    alt, caption: blank(args.p_caption), mime, byte_size: size,
    created_by: uid(), created_at: now(), updated_at: now(),
  }
  seedRows('guide_media', [row])
  return { ok: true, media_id: id, storage_path: path, bucket: 'guides', sort_order: sort }
}

export function guideMediaUpdate(args: Args): Fns['guide_media_update']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noImageEdit)
  const alt = blank(args.p_alt)
  if (args.p_alt != null && !alt) return refuse('alt_required', GUIDE_MESSAGES.altRequired)
  const rows = getRows('guide_media')
  const idx = rows.findIndex((r) => r.id === str(args.p_id))
  if (idx < 0) return refuse('not_found', GUIDE_MESSAGES.imageNotFound)
  rows[idx] = {
    ...rows[idx],
    alt: alt ?? rows[idx].alt,
    caption: args.p_caption === undefined ? rows[idx].caption : blank(args.p_caption),
    updated_at: now(),
  }
  setRows('guide_media', rows)
  return { ok: true, id: str(rows[idx].id) }
}

export function guideMediaReorder(args: Args): Fns['guide_media_reorder']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noImageEdit)
  const ids = strArray(args.p_ids) ?? []
  if (!ids.length) return refuse('bad_request', 'no images were named')
  const section = blank(args.p_section)
  const rows = getRows('guide_media')
  let moved = 0
  ids.forEach((id, i) => {
    const idx = rows.findIndex((r) => r.id === id && r.guide_id === str(args.p_guide) && (r.section ?? null) === section)
    if (idx < 0) return
    rows[idx] = { ...rows[idx], sort_order: i, updated_at: now() }
    moved += 1
  })
  setRows('guide_media', rows)
  return { ok: true, guide_id: str(args.p_guide), moved }
}

export function guideMediaRemove(args: Args): Fns['guide_media_remove']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noImageRemove)
  const rows = getRows('guide_media')
  const row = rows.find((r) => r.id === str(args.p_id))
  if (!row) return refuse('not_found', GUIDE_MESSAGES.imageNotFound)
  // Removing an image removes the image and nothing else: the guide's written
  // content is untouched.
  setRows('guide_media', rows.filter((r) => r.id !== row.id))
  return { ok: true, id: str(row.id), guide_id: str(row.guide_id) }
}

/* ── Registry ───────────────────────────────────────────────────────────── */

export const GUIDE_RPCS: Record<string, (args: Args) => unknown> = {
  guide_upsert: guideUpsert,
  guide_publish: guidePublish,
  guide_set_pinned: guideSetPinned,
  guide_archive: guideArchive,
  guide_duplicate: guideDuplicate,
  guide_mark_reviewed: guideMarkReviewed,
  guide_mark_outdated: guideMarkOutdated,
  guide_category_upsert: guideCategoryUpsert,
  guide_section_upsert: guideSectionUpsert,
  guide_sections_reorder: guideSectionsReorder,
  guide_section_remove: guideSectionRemove,
  guide_revision_restore: guideRevisionRestore,
  guide_bookmark_toggle: guideBookmarkToggle,
  guide_view: guideView,
  guide_mark_complete: guideMarkComplete,
  guide_feedback_submit: guideFeedbackSubmit,
  guide_feedback_resolve: guideFeedbackResolve,
  guides_search: guidesSearch,
  guide_media_attach: guideMediaAttach,
  guide_media_update: guideMediaUpdate,
  guide_media_reorder: guideMediaReorder,
  guide_media_remove: guideMediaRemove,
}

const refuseTable = (table: MockTableName) => () =>
  postgrestError(403, '42501', `permission denied for table ${table}`)

/** Every client write to the library tables is the grant denial; reads fall
 *  through to postgrest.ts. */
export const guideHandlers = GUIDE_RPC_ONLY_TABLES.flatMap((table) => {
  const url = `${supabaseBaseUrl()}/rest/v1/${table}`
  return [http.post(url, refuseTable(table)), http.patch(url, refuseTable(table)), http.delete(url, refuseTable(table))]
})
