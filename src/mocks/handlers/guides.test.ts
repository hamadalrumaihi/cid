/** Pins for the Guide Library mock handlers (20261107120000, 20261108120000).
 *
 *  The mock is the OFFLINE contract of the library's RPCs, so what this file
 *  protects is the shape the UI is written against: a new guide is a draft; a
 *  guide written in the editor cannot be published empty; the first
 *  publication date survives an unpublish/republish; a stale save is a
 *  conflict rather than an overwrite; an anchor is permanent; a bookmark, a
 *  reading position and a completion mark are the caller's own; the three
 *  image rules; and the two refusal styles — authority raises P0403,
 *  validation returns `{ok:false, code}`.
 *
 *  Called directly against the mock store — no MSW server. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { GUIDE_AUDIENCES as CLIENT_AUDIENCES, GUIDE_IMAGE_TYPES as CLIENT_TYPES } from '@/lib/guides'
import {
  guideCategoryRow, guideMediaRow, guideRow, guideSearchIndexRow, guideSectionRow, profileRow,
  roleSession,
} from '../fixtures'
import { getRows, resetMockStore, seedRows, setSession } from '../store'
import { handlers } from './index'
import {
  GUIDE_AUDIENCES, GUIDE_IMAGE_MAX_BYTES, GUIDE_IMAGE_TYPES, GUIDE_RPC_ONLY_TABLES, GuideRpcError,
  canEditGuides, guideArchive, guideBookmarkToggle, guideDuplicate, guideFeedbackResolve,
  guideCategoryUpsert, guideFeedbackSubmit, guideHandlers, guideMarkComplete, guideMarkOutdated,
  guideMediaAttach,
  guideMediaRemove, guideMediaReorder, guideMediaUpdate, guidePublish, guideSectionUpsert,
  guideSetPinned, guideUpsert, guideView, guidesSearch,
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
  it('the eight audiences and four image types are the same lists the client ships', () => {
    expect([...GUIDE_AUDIENCES]).toEqual([...CLIENT_AUDIENCES])
    expect([...GUIDE_IMAGE_TYPES]).toEqual([...CLIENT_TYPES])
    expect(GUIDE_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024)
  })

  it('registers the write-refusal routes for every library table, before the catch-all', () => {
    expect([...GUIDE_RPC_ONLY_TABLES]).toEqual([
      'guides', 'guide_media', 'guide_bookmarks', 'guide_categories', 'guide_sections',
      'guide_revisions', 'guide_progress', 'guide_feedback', 'guide_search_index',
    ])
    // POST / PATCH / DELETE per table.
    expect(guideHandlers).toHaveLength(GUIDE_RPC_ONLY_TABLES.length * 3)
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
    raises(() => guideArchive({ p_id: 'x' }))
    raises(() => guideDuplicate({ p_id: 'x', p_slug: 'y' }))
    raises(() => guideMarkOutdated({ p_id: 'x', p_reason: 'stale' }))
    raises(() => guideSectionUpsert({ p_guide: 'x', p_heading: 'H' }))
    raises(() => guideFeedbackResolve({ p_id: 'x', p_status: 'resolved' }))
  })

  it('command is', () => {
    const c = cast()
    asUser(c.lead)
    expect(canEditGuides()).toBe(true)
  })
})

describe('guide_upsert', () => {
  beforeEach(() => { resetMockStore() })

  it('a new guide lands as a DRAFT with no publication date, filed under Portal', () => {
    const c = cast(); asUser(c.lead)
    const out = guideUpsert({ p_slug: 'radio-procedure', p_title: 'Radio Procedure', p_body_key: 'radio' })
    expect(out).toMatchObject({ ok: true, status: 'draft' })
    const row = getRows('guides')[0]
    expect(row.status).toBe('draft')
    expect(row.published_at).toBeNull()
    expect(row.category).toBe('portal')
    expect(row.audience).toBe('all')
    // No body key was named, so the guide is written in the editor.
    expect(row.body_kind).toBe('sections')
  })

  it('validates the address, the category, the audience and the body kind', () => {
    const c = cast(); asUser(c.lead)
    seedRows('guides', [guideRow({ slug: 'undergrnd' })])
    expect(guideUpsert({ p_slug: 'Not A Slug', p_title: 'X' })).toMatchObject({ code: 'bad_slug' })
    expect(guideUpsert({ p_slug: 'undergrnd', p_title: 'X' })).toMatchObject({ code: 'slug_taken' })
    expect(guideUpsert({ p_slug: 'ok-slug', p_title: 'X', p_category: 'weapons' })).toMatchObject({ code: 'bad_request' })
    expect(guideUpsert({ p_slug: 'ok-slug', p_title: 'X', p_audience: 'everyone' })).toMatchObject({ code: 'bad_value' })
    expect(guideUpsert({ p_slug: 'ok-slug', p_title: 'X', p_body_kind: 'pdf' })).toMatchObject({ code: 'bad_value' })
    expect(guideUpsert({ p_slug: 'ok-slug', p_title: 'X', p_read_minutes: 0 })).toMatchObject({ code: 'bad_value' })
    // A module guide is rendered from code, so it needs the key that names it.
    expect(guideUpsert({ p_slug: 'ok-slug', p_title: 'X', p_body_kind: 'module' })).toMatchObject({ code: 'bad_request' })
    expect(guideUpsert({ p_slug: 'ok-slug' })).toMatchObject({ code: 'bad_request' })
  })

  it('an edit changes only what it names, and an unknown id is not_found', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow({ slug: 'undergrnd', summary: 'Before.' })])
    expect(guideUpsert({ p_id: g.id, p_title: 'A New Title' })).toMatchObject({ ok: true })
    const row = getRows('guides')[0]
    expect(row.title).toBe('A New Title')
    expect(row.summary).toBe('Before.')
    expect(row.slug).toBe('undergrnd')
    expect(row.category).toBe('systems')
    expect(guideUpsert({ p_id: 'nope', p_title: 'X' })).toMatchObject({ code: 'not_found' })
  })

  it('a save carrying a stale updated_at is a CONFLICT, and nothing is written', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow({ title: 'Theirs' })])
    const stale = '2020-01-01T00:00:00.000Z'
    const out = guideUpsert({ p_id: g.id, p_title: 'Mine', p_expected_updated_at: stale })
    expect(out).toMatchObject({ ok: false, code: 'conflict' })
    expect(getRows('guides')[0].title).toBe('Theirs')
    // The current value is handed back so the editor can re-read and retry.
    const fresh = (out as { updated_at: string }).updated_at
    expect(guideUpsert({ p_id: g.id, p_title: 'Mine', p_expected_updated_at: fresh })).toMatchObject({ ok: true })
    expect(getRows('guides')[0].title).toBe('Mine')
  })
})

describe('categories are rows, so the library is reorganized without a deploy', () => {
  beforeEach(() => { resetMockStore() })

  it('accepts a category the TABLE knows, refuses one it does not, and retires without hiding guides', () => {
    const c = cast(); asUser(c.lead)
    seedRows('guide_categories', [
      guideCategoryRow({ slug: 'portal', label: 'Portal' }),
      guideCategoryRow({ slug: 'field-craft', label: 'Field Craft' }),
    ])
    expect(guideUpsert({ p_slug: 'a-guide', p_title: 'A Guide', p_category: 'field-craft' }))
      .toMatchObject({ ok: true })
    expect(guideUpsert({ p_slug: 'b-guide', p_title: 'B Guide', p_category: 'weapons' }))
      .toMatchObject({ code: 'bad_request' })

    expect(guideCategoryUpsert({ p_slug: 'weapons', p_label: 'Weapons' })).toMatchObject({ ok: true, created: true })
    expect(guideUpsert({ p_slug: 'b-guide', p_title: 'B Guide', p_category: 'weapons' })).toMatchObject({ ok: true })

    // Retiring a shelf must not take the books: the guide keeps its category
    // and stays exactly as readable as it was.
    expect(guideCategoryUpsert({ p_slug: 'field-craft', p_active: false })).toMatchObject({ ok: true, created: false })
    expect(getRows('guide_categories').find((r) => r.slug === 'field-craft')!.active).toBe(false)
    expect(getRows('guides').find((r) => r.slug === 'a-guide')!.category).toBe('field-craft')

    expect(guideCategoryUpsert({ p_slug: 'Not A Slug', p_label: 'X' })).toMatchObject({ code: 'bad_slug' })
    raises(() => { asUser(c.me); return guideCategoryUpsert({ p_slug: 'x', p_label: 'X' }) })
  })
})

describe('guide_section_upsert — an anchor is permanent', () => {
  beforeEach(() => { resetMockStore() })

  it('derives an anchor from the heading, numbers sections from zero and refuses a duplicate', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow({ body_kind: 'sections' })])
    const first = guideSectionUpsert({ p_guide: g.id, p_heading: 'Getting Started', p_body: 'Open the portal.' })
    expect(first).toMatchObject({ ok: true, anchor: 'getting-started' })
    const second = guideSectionUpsert({ p_guide: g.id, p_heading: 'Next Steps' })
    expect(second).toMatchObject({ ok: true, anchor: 'next-steps' })
    expect(getRows('guide_sections').map((s) => s.sort_order)).toEqual([0, 1])
    expect(guideSectionUpsert({ p_guide: g.id, p_heading: 'Getting started' }))
      .toMatchObject({ code: 'anchor_taken' })
    expect(guideSectionUpsert({ p_guide: g.id })).toMatchObject({ code: 'bad_request' })
  })

  it('renaming a heading leaves the anchor alone, so an existing link still lands', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow({ body_kind: 'sections' })])
    const [s] = seedRows('guide_sections', [guideSectionRow({ guide_id: g.id, anchor: 'evidence' })])
    expect(guideSectionUpsert({ p_guide: g.id, p_id: s.id, p_heading: 'Evidence and media' }))
      .toMatchObject({ ok: true, anchor: 'evidence' })
    expect(getRows('guide_sections')[0].heading).toBe('Evidence and media')
    expect(getRows('guide_sections')[0].anchor).toBe('evidence')
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

  it('refuses to publish a guide written in the editor that has no sections yet', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow({ body_kind: 'sections', status: 'draft', published_at: null })])
    expect(guidePublish({ p_id: g.id })).toMatchObject({ ok: false, code: 'empty' })
    seedRows('guide_sections', [guideSectionRow({ guide_id: g.id })])
    expect(guidePublish({ p_id: g.id })).toMatchObject({ ok: true, status: 'published' })
    // Every publication records what the guide said at that moment.
    expect(getRows('guide_revisions')).toHaveLength(1)
  })

  it('archiving hides a guide and restoring puts it back — nothing is destroyed either way', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow()])
    expect(guideArchive({ p_id: g.id })).toMatchObject({ ok: true, archived: true })
    expect(getRows('guides')[0].archived_at).toBeTruthy()
    expect(getRows('guides')[0].status).toBe('draft')
    expect(guideArchive({ p_id: g.id, p_archived: false })).toMatchObject({ ok: true, archived: false })
    expect(getRows('guides')[0].archived_at).toBeNull()
  })

  it('a duplicate is a fresh DRAFT: no pin, no publication date, no reading count, its own sections', () => {
    const c = cast(); asUser(c.lead)
    const [g] = seedRows('guides', [guideRow({ pinned: true, view_count: 40 })])
    seedRows('guide_sections', [guideSectionRow({ guide_id: g.id, heading: 'Original' })])
    const out = guideDuplicate({ p_id: g.id, p_slug: 'undergrnd-draft' }) as { ok: boolean; id: string }
    expect(out).toMatchObject({ ok: true, status: 'draft' })
    const copy = getRows('guides').find((r) => r.id === out.id)!
    expect(copy.pinned).toBe(false)
    expect(copy.published_at).toBeNull()
    expect(copy.view_count).toBe(0)
    expect(getRows('guide_sections').filter((s) => s.guide_id === out.id)).toHaveLength(1)
    expect(guideDuplicate({ p_id: g.id, p_slug: 'undergrnd' })).toMatchObject({ code: 'slug_taken' })
  })
})

describe('reading progress is the reader’s own', () => {
  beforeEach(() => { resetMockStore() })

  it('records the view, remembers the section and counts the read without touching updated_at', () => {
    const c = cast(); asUser(c.me)
    const [g] = seedRows('guides', [guideRow()])
    const before = getRows('guides')[0].updated_at
    expect(guideView({ p_id: g.id, p_anchor: 'cases' })).toMatchObject({ ok: true })
    expect(getRows('guides')[0].view_count).toBe(1)
    // Counting a read must not make the guide look edited.
    expect(getRows('guides')[0].updated_at).toBe(before)
    const p = getRows('guide_progress')[0]
    expect(p.user_id).toBe(c.me.id)
    expect(p.last_anchor).toBe('cases')
    expect(p.seen_updated_at).toBe(before)
  })

  it('marks a guide read and unread, and a draft is not_found for a member', () => {
    const c = cast(); asUser(c.me)
    const [g] = seedRows('guides', [guideRow()])
    expect(guideMarkComplete({ p_id: g.id })).toMatchObject({ ok: true, completed: true })
    expect(getRows('guide_progress')[0].completed_at).toBeTruthy()
    expect(guideMarkComplete({ p_id: g.id, p_complete: false })).toMatchObject({ ok: true, completed: false })
    expect(getRows('guide_progress')[0].completed_at).toBeNull()
    const [d] = seedRows('guides', [guideRow({ slug: 'draft-guide', status: 'draft', published_at: null })])
    expect(guideView({ p_id: d.id })).toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe('feedback goes to a queue, not to anyone’s notifications', () => {
  beforeEach(() => { resetMockStore() })

  it('takes an answer and a report, validates both, and lands as new', () => {
    const c = cast(); asUser(c.me)
    const [g] = seedRows('guides', [guideRow()])
    expect(guideFeedbackSubmit({ p_id: g.id, p_kind: 'helpful', p_rating: 'partly' })).toMatchObject({ ok: true })
    expect(getRows('guide_feedback')[0]).toMatchObject({ kind: 'helpful', rating: 'partly', status: 'new' })
    expect(guideFeedbackSubmit({ p_id: g.id, p_kind: 'helpful', p_rating: 'maybe' })).toMatchObject({ code: 'bad_value' })
    expect(guideFeedbackSubmit({ p_id: g.id, p_kind: 'complaint' })).toMatchObject({ code: 'bad_value' })
    expect(guideFeedbackSubmit({
      p_id: g.id, p_kind: 'broken_link', p_comment: 'The evidence link 404s.', p_anchor: 'evidence',
    })).toMatchObject({ ok: true })
    expect(getRows('guide_feedback')).toHaveLength(2)
  })

  it('only an editor settles a report, and settling stamps who and when', () => {
    const c = cast(); asUser(c.me)
    const [g] = seedRows('guides', [guideRow()])
    const out = guideFeedbackSubmit({ p_id: g.id, p_kind: 'suggestion', p_comment: 'Add a worked example.' }) as { id: string }
    raises(() => guideFeedbackResolve({ p_id: out.id, p_status: 'resolved' }))
    asUser(c.lead)
    expect(guideFeedbackResolve({ p_id: out.id, p_status: 'nope' })).toMatchObject({ code: 'bad_value' })
    expect(guideFeedbackResolve({ p_id: out.id, p_status: 'resolved', p_note: 'Added.' })).toMatchObject({ ok: true })
    const row = getRows('guide_feedback')[0]
    expect(row.status).toBe('resolved')
    expect(row.resolved_by).toBe(c.lead.id)
    expect(row.resolved_at).toBeTruthy()
  })
})

describe('guides_search — section level, and only what the caller may read', () => {
  beforeEach(() => { resetMockStore() })

  it('returns the matching SECTION so the link opens there, and skips a draft for a member', () => {
    const c = cast(); asUser(c.me)
    const [g] = seedRows('guides', [guideRow({ slug: 'user-guide', title: 'Portal User Guide' })])
    const [d] = seedRows('guides', [guideRow({ slug: 'secret-draft', title: 'Draft Guide', status: 'draft', published_at: null })])
    seedRows('guide_search_index', [
      guideSearchIndexRow({ guide_id: g.id, anchor: 'evidence', heading: 'Evidence and media', terms: 'Attach evidence to a report.' }),
      guideSearchIndexRow({ guide_id: d.id, anchor: 'hidden', heading: 'Hidden', terms: 'Attach evidence to a report.' }),
    ])
    const found = guidesSearch({ p_query: 'attach evidence' })
    // Both index rows carry the phrase; only the readable guide comes back,
    // and the draft's title, heading and anchor never appear.
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ slug: 'user-guide', anchor: 'evidence', heading: 'Evidence and media' })
    expect(JSON.stringify(found)).not.toContain('Draft Guide')
    // A blank query is no search at all, not the whole library.
    expect(guidesSearch({ p_query: '   ' })).toEqual([])
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
