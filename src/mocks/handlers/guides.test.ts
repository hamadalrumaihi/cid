/** Pins for the Guide Library mock handlers (migration 20261107120000).
 *
 *  The mock is the OFFLINE contract of the eight RPCs, so what this file
 *  protects is the shape the UI is written against: a new guide is a draft;
 *  the first publication date survives an unpublish/republish; a bookmark is
 *  the caller's own; the three image rules; and the two refusal styles —
 *  authority raises P0403, validation returns `{ok:false, code}`.
 *
 *  Called directly against the mock store — no MSW server. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { GUIDE_CATEGORIES as CLIENT_CATEGORIES, GUIDE_IMAGE_TYPES as CLIENT_TYPES } from '@/lib/guides'
import { guideMediaRow, guideRow, profileRow, roleSession } from '../fixtures'
import { getRows, resetMockStore, seedRows, setSession } from '../store'
import { handlers } from './index'
import {
  GUIDE_CATEGORIES, GUIDE_IMAGE_MAX_BYTES, GUIDE_IMAGE_TYPES, GUIDE_RPC_ONLY_TABLES, GuideRpcError,
  canEditGuides, guideBookmarkToggle, guideHandlers, guideMediaAttach, guideMediaRemove,
  guideMediaReorder, guideMediaUpdate, guidePublish, guideSetPinned, guideUpsert,
} from './guides'

const asUser = (p: Tables<'profiles'> | null) =>
  setSession(p ? { userId: p.id, email: p.email ?? 'x@cid.test', password: 'mock-password' } : null)

/** An MCB detective (the session by default) and the MCB Bureau Lead. */
function cast() {
  const me = roleSession('detective')
  const [lead] = seedRows('profiles', [profileRow({ role: 'bureau_lead', display_name: 'Lt. Lead' })])
  return { me: me.profile, lead }
}

const raises = (fn: () => unknown, code = 'P0403') => {
  try { fn(); throw new Error('expected a refusal') } catch (e) {
    expect(e).toBeInstanceOf(GuideRpcError)
    expect((e as GuideRpcError).code).toBe(code)
  }
}

describe('guides — vocabulary mirrors the client', () => {
  it('the six categories and four image types are the same list the client ships', () => {
    expect([...GUIDE_CATEGORIES]).toEqual([...CLIENT_CATEGORIES])
    expect([...GUIDE_IMAGE_TYPES]).toEqual([...CLIENT_TYPES])
    expect(GUIDE_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024)
  })

  it('registers the write-refusal routes for all three tables, before the catch-all', () => {
    expect([...GUIDE_RPC_ONLY_TABLES]).toEqual(['guides', 'guide_media', 'guide_bookmarks'])
    // POST / PATCH / DELETE per table.
    expect(guideHandlers).toHaveLength(9)
    for (const h of guideHandlers) expect(handlers.indexOf(h)).toBeGreaterThanOrEqual(0)
  })
})

describe('guides — who may edit', () => {
  beforeEach(() => { resetMockStore() })

  it('an ordinary member is not an editor and every write raises P0403', () => {
    const c = cast()
    asUser(c.me)
    expect(canEditGuides()).toBe(false)
    raises(() => guideUpsert({ p_slug: 'x', p_title: 'X', p_body_key: 'undergrnd' }))
    raises(() => guidePublish({ p_id: 'x' }))
    raises(() => guideSetPinned({ p_id: 'x' }))
    raises(() => guideMediaAttach({ p_guide: 'x', p_alt: 'a', p_filename: 'a.png', p_mime: 'image/png', p_byte_size: 10 }))
    raises(() => guideMediaUpdate({ p_id: 'x', p_alt: 'a' }))
    raises(() => guideMediaReorder({ p_guide: 'x', p_ids: ['a'] }))
    raises(() => guideMediaRemove({ p_id: 'x' }))
  })

  it('command is', () => {
    const c = cast()
    asUser(c.lead)
    expect(canEditGuides()).toBe(true)
  })
})

describe('guide_upsert', () => {
  beforeEach(() => { resetMockStore() })

  it('a new guide lands as a DRAFT with no publication date', () => {
    const c = cast(); asUser(c.lead)
    const out = guideUpsert({ p_slug: 'radio-procedure', p_title: 'Radio Procedure', p_body_key: 'radio' })
    expect(out).toMatchObject({ ok: true, status: 'draft' })
    const row = getRows('guides')[0]
    expect(row.status).toBe('draft')
    expect(row.published_at).toBeNull()
    expect(row.category).toBe('general')
  })

  it('validates the address and the category rather than leaving them to a CHECK', () => {
    const c = cast(); asUser(c.lead)
    seedRows('guides', [guideRow({ slug: 'undergrnd' })])
    expect(guideUpsert({ p_slug: 'Not A Slug', p_title: 'X', p_body_key: 'b' })).toMatchObject({ code: 'bad_slug' })
    expect(guideUpsert({ p_slug: 'undergrnd', p_title: 'X', p_body_key: 'b' })).toMatchObject({ code: 'slug_taken' })
    expect(guideUpsert({ p_slug: 'ok-slug', p_title: 'X', p_category: 'weapons', p_body_key: 'b' })).toMatchObject({ code: 'bad_request' })
    expect(guideUpsert({ p_slug: 'ok-slug', p_title: 'X' })).toMatchObject({ code: 'bad_request' })
  })

  it('an edit changes only what it names, and an unknown id is not_found', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow({ slug: 'undergrnd', summary: 'Before.' })])
    expect(guideUpsert({ p_id: g.id, p_title: 'A New Title' })).toMatchObject({ ok: true })
    const row = getRows('guides')[0]
    expect(row.title).toBe('A New Title')
    expect(row.summary).toBe('Before.')
    expect(row.slug).toBe('undergrnd')
    expect(guideUpsert({ p_id: 'nope', p_title: 'X' })).toMatchObject({ code: 'not_found' })
  })
})

describe('guide_publish — the first publication date is a fact, not a toggle', () => {
  beforeEach(() => { resetMockStore() })

  it('publishes, unpublishes and keeps published_at across the round trip', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow({ status: 'draft', published_at: null })])
    expect(guidePublish({ p_id: g.id, p_published: true })).toMatchObject({ ok: true, status: 'published' })
    const first = getRows('guides')[0].published_at as string
    expect(first).toBeTruthy()
    expect(guidePublish({ p_id: g.id, p_published: false })).toMatchObject({ ok: true, status: 'draft' })
    expect(getRows('guides')[0].published_at).toBe(first)
    expect(guidePublish({ p_id: g.id, p_published: true })).toMatchObject({ ok: true, status: 'published' })
    expect(getRows('guides')[0].published_at).toBe(first)
    // Asking for the state it is already in is a no-op, not an error.
    expect(guidePublish({ p_id: g.id, p_published: true })).toMatchObject({ ok: true, unchanged: true })
  })
})

describe('guide_bookmark_toggle — one person’s list', () => {
  beforeEach(() => { resetMockStore() })

  it('an ordinary member bookmarks a published guide and un-bookmarks it', () => {
    const c = cast(); asUser(c.me)
    const [g] = seedRows('guides', [guideRow()])
    expect(guideBookmarkToggle({ p_id: g.id })).toMatchObject({ ok: true, bookmarked: true })
    expect(getRows('guide_bookmarks')).toHaveLength(1)
    expect(getRows('guide_bookmarks')[0].user_id).toBe(c.me.id)
    expect(guideBookmarkToggle({ p_id: g.id })).toMatchObject({ ok: true, bookmarked: false })
    expect(getRows('guide_bookmarks')).toHaveLength(0)
  })

  it('a draft is not_found for a member — the same answer as a guide that does not exist', () => {
    const c = cast(); asUser(c.me)
    const [g] = seedRows('guides', [guideRow({ status: 'draft', published_at: null })])
    expect(guideBookmarkToggle({ p_id: g.id })).toMatchObject({ ok: false, code: 'not_found' })
    expect(guideBookmarkToggle({ p_id: 'nope' })).toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe('guide imagery', () => {
  beforeEach(() => { resetMockStore() })

  it('needs alt text, one of four types and at most 10 MB, and binds the path to the guide and the row', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow()])
    expect(guideMediaAttach({ p_guide: g.id, p_alt: '  ', p_filename: 'a.png', p_mime: 'image/png', p_byte_size: 10 }))
      .toMatchObject({ code: 'alt_required' })
    expect(guideMediaAttach({ p_guide: g.id, p_alt: 'A tag', p_filename: 'a.svg', p_mime: 'image/svg+xml', p_byte_size: 10 }))
      .toMatchObject({ code: 'bad_type' })
    expect(guideMediaAttach({ p_guide: g.id, p_alt: 'A tag', p_filename: 'a.png', p_mime: 'image/png', p_byte_size: GUIDE_IMAGE_MAX_BYTES + 1 }))
      .toMatchObject({ code: 'too_large' })
    expect(guideMediaAttach({ p_guide: 'nope', p_alt: 'A tag', p_filename: 'a.png', p_mime: 'image/png', p_byte_size: 10 }))
      .toMatchObject({ code: 'not_found' })

    const ok = guideMediaAttach({
      p_guide: g.id, p_alt: 'A tag on a shutter', p_filename: 'Photo 1.PNG',
      p_section: 'u-gear', p_mime: 'image/png', p_byte_size: 4096,
    }) as { ok: boolean; media_id: string; storage_path: string; bucket: string; sort_order: number }
    expect(ok).toMatchObject({ ok: true, bucket: 'guides', sort_order: 0 })
    expect(ok.storage_path).toBe(`${g.id}/${ok.media_id}/photo-1.png`)
  })

  it('continues a slot’s numbering from the images already there', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow()])
    seedRows('guide_media', [
      guideMediaRow({ guide_id: g.id, section: 'u-gear', sort_order: 0, alt: 'first' }),
      guideMediaRow({ guide_id: g.id, section: 'u-gear', sort_order: 1, alt: 'second' }),
      // The cover is its own slot and must not shift the section's numbering.
      guideMediaRow({ guide_id: g.id, section: null, sort_order: 0, alt: 'cover' }),
    ])
    const next = guideMediaAttach({
      p_guide: g.id, p_alt: 'third', p_filename: 'c.png', p_section: 'u-gear',
      p_mime: 'image/png', p_byte_size: 100,
    }) as { sort_order: number }
    expect(next.sort_order).toBe(2)
    const cover = guideMediaAttach({
      p_guide: g.id, p_alt: 'second cover', p_filename: 'd.png',
      p_mime: 'image/png', p_byte_size: 100,
    }) as { sort_order: number }
    expect(cover.sort_order).toBe(1)
  })

  it('numbers each slot from zero, reorders within a slot only, and removing leaves the guide untouched', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow()])
    const add = (section: string | null, alt: string) => guideMediaAttach({
      p_guide: g.id, p_alt: alt, p_filename: `${alt}.png`, p_section: section, p_mime: 'image/png', p_byte_size: 100,
    }) as { media_id: string; sort_order: number }
    const a = add('u-gear', 'a')
    const b = add('u-gear', 'b')
    const cover = add(null, 'cover')
    expect([a.sort_order, b.sort_order, cover.sort_order]).toEqual([0, 1, 0])

    expect(guideMediaReorder({ p_guide: g.id, p_ids: [b.media_id, a.media_id], p_section: 'u-gear' }))
      .toMatchObject({ ok: true, moved: 2 })
    const order = getRows('guide_media').filter((m) => m.section === 'u-gear')
      .sort((x, y) => (x.sort_order as number) - (y.sort_order as number)).map((m) => m.id)
    expect(order).toEqual([b.media_id, a.media_id])
    // An id from another slot is ignored rather than moved out of its section.
    expect(guideMediaReorder({ p_guide: g.id, p_ids: [cover.media_id], p_section: 'u-gear' }))
      .toMatchObject({ ok: true, moved: 0 })
    expect(guideMediaReorder({ p_guide: g.id, p_ids: [] })).toMatchObject({ code: 'bad_request' })

    expect(guideMediaUpdate({ p_id: a.media_id, p_alt: '   ' })).toMatchObject({ code: 'alt_required' })
    expect(guideMediaUpdate({ p_id: a.media_id, p_alt: 'a, re-described' })).toMatchObject({ ok: true })
    expect(getRows('guide_media').find((m) => m.id === a.media_id)!.alt).toBe('a, re-described')

    const before = { ...getRows('guides')[0] }
    expect(guideMediaRemove({ p_id: a.media_id })).toMatchObject({ ok: true })
    expect(getRows('guide_media').some((m) => m.id === a.media_id)).toBe(false)
    expect(getRows('guides')[0]).toEqual(before)
    expect(guideMediaRemove({ p_id: 'nope' })).toMatchObject({ code: 'not_found' })
  })
})
