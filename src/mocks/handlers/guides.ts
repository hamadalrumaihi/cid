/** The Guide Library (migration 20261107120000_guide_library).
 *
 *  The CONTRACT of the eight server functions, answered from the mock store —
 *  never a second implementation of the server's authority model:
 *   · `guides`, `guide_media` and `guide_bookmarks` are SELECT-only for
 *     clients: every INSERT / UPDATE / DELETE is PostgREST's grant denial
 *     (403 / 42501), exactly as the `revoke all … grant select` in the
 *     migration leaves it. Reads fall through to postgrest.ts.
 *   · Refusal style, as everywhere else: AUTHORITY refusals RAISE through
 *     `private.perm_raise` (SQLSTATE P0403 → 400 here); VALIDATION refusals
 *     RETURN `{ok:false, code, message}`.
 *   · The rules the UI is built on: a new guide lands as a DRAFT; the first
 *     publication date is kept across an unpublish/republish; a bookmark is
 *     the caller's own; and a guide image needs alternative text, one of four
 *     types and at most 10 MB.
 *
 *  Visibility here is deliberately shallow — published, or the caller may
 *  edit — because the real wall is RLS and tests/rls/v194a covers it. */
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
type Refusal = { ok: false; code: string; message: string }

const str = (v: unknown): string => (v == null ? '' : String(v))
const blank = (v: unknown): string | null => str(v).trim() || null
const now = () => new Date().toISOString()

/** A server `raise` — rpc.ts turns it into PostgREST's 400 error shape.
 *  `P0403` marks an AUTHORITY refusal (private.perm_raise). */
export class GuideRpcError extends Error {
  code: string
  constructor(message: string, code = 'P0001') { super(message); this.code = code }
}
function deny(message: string): never { throw new GuideRpcError(message, 'P0403') }
const refuse = (code: string, message: string): Refusal => ({ ok: false, code, message })

export const GUIDE_RPC_ONLY_TABLES: readonly MockTableName[] = ['guides', 'guide_media', 'guide_bookmarks']

export const GUIDE_CATEGORIES = ['systems', 'equipment', 'jobs', 'organizations', 'locations', 'general'] as const
export const GUIDE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export const GUIDE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const GUIDE_MESSAGES = {
  notActive: 'not an active member',
  noEdit: 'you may not edit guides',
  noPublish: 'you may not publish guides',
  noPin: 'you may not pin guides',
  noImages: 'you may not add images to guides',
  noImageEdit: 'you may not edit guide images',
  noImageRemove: 'you may not remove guide images',
  notFound: 'guide not found',
  imageNotFound: 'image not found',
  needsFields: 'a new guide needs an address, a title and a body key',
  badSlug: 'an address is lowercase words joined by hyphens',
  slugTaken: 'another guide already lives at that address',
  badCategory: 'unknown category',
  altRequired: 'describe what the image shows',
  badType: 'a guide image is a PNG, JPEG, WebP or GIF',
  tooLarge: 'a guide image is at most 10 MB',
} as const

/** private.can_edit_guides() — active AND (command OR owner). */
export const canEditGuides = (): boolean => isActive() && (isCommand() || isOwner())

const guideRows = (): MockRow[] => (getDenial('guides') ? [] : getRows('guides'))
const liveGuides = (): Guide[] => guideRows().filter((r) => r.deleted_at == null) as unknown as Guide[]
const mediaRows = (): GuideMedia[] => (getDenial('guide_media') ? [] : getRows('guide_media')) as unknown as GuideMedia[]

/** What the caller may currently read: a published guide, or any live guide
 *  when they may edit. */
const readable = (id: unknown): Guide | null =>
  liveGuides().find((g) => g.id === str(id) && (g.status === 'published' || canEditGuides())) ?? null

/* ── guide_upsert ───────────────────────────────────────────────────────── */

export function guideUpsert(args: Args): Fns['guide_upsert']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noEdit)
  const id = blank(args.p_id)
  const slug = blank(args.p_slug)?.toLowerCase() ?? null
  const title = blank(args.p_title)
  const body = blank(args.p_body_key)
  const category = blank(args.p_category)?.toLowerCase() ?? null

  if (!id && (!slug || !title || !body)) return refuse('bad_request', GUIDE_MESSAGES.needsFields)
  if (slug && !SLUG_RE.test(slug)) return refuse('bad_slug', GUIDE_MESSAGES.badSlug)
  if (category && !(GUIDE_CATEGORIES as readonly string[]).includes(category)) {
    return refuse('bad_request', GUIDE_MESSAGES.badCategory)
  }
  if (slug && liveGuides().some((g) => g.slug === slug && g.id !== id)) {
    return refuse('slug_taken', GUIDE_MESSAGES.slugTaken)
  }

  if (!id) {
    // A new guide is ALWAYS a draft — there is no path here that publishes on
    // create, because there is none on the server either.
    const row: Guide = {
      id: mockId(), slug: slug!, title: title!, summary: blank(args.p_summary),
      category: category ?? 'general', status: 'draft', body_key: body!, pinned: false,
      published_at: null, created_by: uid(), updated_by: uid(),
      created_at: now(), updated_at: now(),
      deleted_at: null, deleted_by: null, delete_reason: null, delete_batch: null,
    }
    seedRows('guides', [row])
    return { ok: true, id: row.id, slug: row.slug, status: row.status }
  }

  const rows = getRows('guides')
  const idx = rows.findIndex((r) => r.id === id && r.deleted_at == null)
  if (idx < 0) return refuse('not_found', GUIDE_MESSAGES.notFound)
  const next = { ...rows[idx] }
  if (slug) next.slug = slug
  if (title) next.title = title
  if (args.p_summary !== undefined) next.summary = blank(args.p_summary)
  if (category) next.category = category
  if (body) next.body_key = body
  next.updated_by = uid()
  next.updated_at = now()
  rows[idx] = next
  setRows('guides', rows)
  return { ok: true, id: str(next.id), slug: str(next.slug), status: str(next.status) }
}

/* ── guide_publish ──────────────────────────────────────────────────────── */

export function guidePublish(args: Args): Fns['guide_publish']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noPublish)
  const want = args.p_published === false ? 'draft' : 'published'
  const rows = getRows('guides')
  const idx = rows.findIndex((r) => r.id === str(args.p_id) && r.deleted_at == null)
  if (idx < 0) return refuse('not_found', GUIDE_MESSAGES.notFound)
  if (rows[idx].status === want) return { ok: true, id: str(rows[idx].id), status: want, unchanged: true }
  // published_at is the FIRST publication and is never rewritten.
  rows[idx] = {
    ...rows[idx],
    status: want,
    published_at: want === 'published' ? (rows[idx].published_at ?? now()) : rows[idx].published_at,
    updated_by: uid(),
    updated_at: now(),
  }
  setRows('guides', rows)
  return { ok: true, id: str(rows[idx].id), status: want }
}

/* ── guide_set_pinned ───────────────────────────────────────────────────── */

export function guideSetPinned(args: Args): Fns['guide_set_pinned']['Returns'] {
  if (!uid() || !canEditGuides()) deny(GUIDE_MESSAGES.noPin)
  const rows = getRows('guides')
  const idx = rows.findIndex((r) => r.id === str(args.p_id) && r.deleted_at == null)
  if (idx < 0) return refuse('not_found', GUIDE_MESSAGES.notFound)
  const pinned = args.p_pinned !== false
  rows[idx] = { ...rows[idx], pinned, updated_by: uid(), updated_at: now() }
  setRows('guides', rows)
  return { ok: true, id: str(rows[idx].id), pinned }
}

/* ── guide_bookmark_toggle ──────────────────────────────────────────────── */

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
  const ids = Array.isArray(args.p_ids) ? (args.p_ids as unknown[]).map(str) : []
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
  setRows('guide_media', rows.filter((r) => r.id !== row.id))
  return { ok: true, id: str(row.id), guide_id: str(row.guide_id) }
}

/* ── Registry ───────────────────────────────────────────────────────────── */

export const GUIDE_RPCS: Record<string, (args: Args) => unknown> = {
  guide_upsert: guideUpsert,
  guide_publish: guidePublish,
  guide_set_pinned: guideSetPinned,
  guide_bookmark_toggle: guideBookmarkToggle,
  guide_media_attach: guideMediaAttach,
  guide_media_update: guideMediaUpdate,
  guide_media_reorder: guideMediaReorder,
  guide_media_remove: guideMediaRemove,
}

const refuseTable = (table: MockTableName) => () =>
  postgrestError(403, '42501', `permission denied for table ${table}`)

/** Every client write to the three tables is the grant denial; reads fall
 *  through to postgrest.ts. */
export const guideHandlers = GUIDE_RPC_ONLY_TABLES.flatMap((table) => {
  const url = `${supabaseBaseUrl()}/rest/v1/${table}`
  return [http.post(url, refuseTable(table)), http.patch(url, refuseTable(table)), http.delete(url, refuseTable(table))]
})
