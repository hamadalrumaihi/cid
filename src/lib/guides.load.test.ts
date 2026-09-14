/** The two composed reads behind the Guide Library screens.
 *
 *  Both screens used to orchestrate their own fan-out: six parallel reads, a
 *  per-guide cover lookup, a signing pass and a `.catch(() => fallback)` on
 *  every optional part, written out twice. What is pinned here is the contract
 *  that replaced it — one call per screen, and specifically:
 *
 *   · the DOCUMENT is the hard part and nothing else is. A companion read that
 *     fails (categories, progress, bookmarks, imagery) degrades to its empty
 *     value and the guides still arrive, so a failing extra can never leave a
 *     screen loading forever;
 *   · the guide list itself failing is an ERROR, not an empty library — an
 *     empty library and a broken one must not look the same;
 *   · ordering, signing and the related-guides rule live here rather than in
 *     the views.
 *
 *  `list` and storage are mocked: what is under test is the composition, not
 *  the wire format of either call. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const list = vi.fn()
const createSignedUrl = vi.fn()

vi.mock('./db', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  list: (...a: unknown[]) => list(...a),
}))
vi.mock('./supabase', () => ({
  supabase: () => ({ storage: { from: () => ({ createSignedUrl }) } }),
  isConfigured: true,
}))

const { loadGuideLibrary, loadGuidePage } = await import('./guides')

type Row = Record<string, unknown>

const guide = (over: Row = {}): Row => ({
  id: 'g1', slug: 'undergrnd', title: 'UNDERGRND System Guide', summary: null,
  category: 'systems', status: 'published', body_key: 'undergrnd', pinned: false,
  audience: 'all', custom_roles: [], tags: [], keywords: null, body_kind: 'module',
  read_minutes: null, view_count: 0, content_owner: null, last_reviewed_at: null,
  next_review_at: null, archived_at: null, archived_by: null, publication_note: null,
  published_at: '2026-07-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-01T00:00:00Z', created_by: null, updated_by: null,
  deleted_at: null, deleted_by: null, delete_reason: null, delete_batch: null, ...over,
})

const media = (over: Row = {}): Row => ({
  id: 'm1', guide_id: 'g1', section: null, sort_order: 0,
  storage_path: 'g1/m1/cover.png', alt: 'A screenshot', caption: null,
  mime: 'image/png', byte_size: 10, created_by: null,
  created_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z', ...over,
})

/** Answer each table from a map; anything unnamed answers empty. A table
 *  whose value is an Error rejects, which is how a failing part is simulated. */
const serve = (tables: Record<string, Row[] | Error>) => {
  list.mockImplementation(async (table: string) => {
    const v = tables[table]
    if (v instanceof Error) throw v
    return v ?? []
  })
}

beforeEach(() => {
  list.mockReset()
  createSignedUrl.mockReset()
  createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/cover.png' }, error: null })
})

describe('loadGuideLibrary', () => {
  it('answers the whole screen in one call', async () => {
    serve({
      guides: [guide({ id: 'g2', slug: 'b', title: 'Beta', updated_at: '2026-07-02T00:00:00Z' }), guide()],
      guide_categories: [{ slug: 'systems', label: 'Systems', sort_order: 0 }],
      guide_bookmarks: [{ guide_id: 'g1' }],
      guide_progress: [{ guide_id: 'g1', completed_at: null, last_seen_at: '2026-07-01T00:00:00Z' }],
      guide_media: [media()],
    })

    const model = await loadGuideLibrary()

    expect(model.guides.map((g) => g.id)).toEqual(['g2', 'g1']) // sorted: newest first
    expect(model.categories[0].slug).toBe('systems')
    expect(model.bookmarks.has('g1')).toBe(true)
    expect(model.progress.get('g1')).toBeDefined()
    expect(model.covers.g1).toBe('https://signed/cover.png')
  })

  it('keeps the guides when a companion read fails — a broken extra is not a broken library', async () => {
    serve({
      guides: [guide()],
      guide_categories: new Error('categories unavailable'),
      guide_bookmarks: new Error('bookmarks unavailable'),
      guide_progress: new Error('progress unavailable'),
      guide_media: new Error('media unavailable'),
    })

    const model = await loadGuideLibrary()

    expect(model.guides).toHaveLength(1)
    expect(model.categories).toEqual([])
    expect(model.bookmarks.size).toBe(0)
    expect(model.progress.size).toBe(0)
    expect(model.covers).toEqual({})
  })

  it('surfaces a failure to read the guides themselves — an empty library must not look broken, or the reverse', async () => {
    serve({ guides: new Error('the library is unavailable') })
    await expect(loadGuideLibrary()).rejects.toThrow('the library is unavailable')
  })

  it('leaves a guide without a cover out of the map rather than inventing one', async () => {
    serve({ guides: [guide()], guide_media: [media({ section: 'overview' })] })
    const model = await loadGuideLibrary()
    expect(model.covers).toEqual({})
  })

  it('drops a cover whose object cannot be signed', async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: 'gone' } })
    serve({ guides: [guide()], guide_media: [media()] })
    expect((await loadGuideLibrary()).covers).toEqual({})
  })
})

describe('loadGuidePage', () => {
  it('answers the whole page in one call, with the images signed', async () => {
    serve({
      guides: [guide()],
      guide_sections: [
        { id: 's2', guide_id: 'g1', anchor: 'b', heading: 'Second', body: 'x', sort_order: 1 },
        { id: 's1', guide_id: 'g1', anchor: 'a', heading: 'First', body: 'y', sort_order: 0 },
      ],
      guide_media: [media(), media({ id: 'm2', section: 'overview', sort_order: 1, storage_path: 'g1/m2/x.png' })],
      guide_bookmarks: [{ guide_id: 'g1' }],
      guide_progress: [{ guide_id: 'g1', completed_at: null, last_anchor: 'a' }],
      guide_categories: [{ slug: 'systems', label: 'Systems', sort_order: 0 }],
    })

    const model = await loadGuidePage('undergrnd')

    expect(model.guide?.id).toBe('g1')
    expect(model.sections.map((s) => s.id)).toEqual(['s1', 's2']) // by sort_order
    expect(model.media).toHaveLength(2)
    expect(model.images.map((i) => i.id)).toEqual(['m1', 'm2'])
    expect(model.images[0]).toMatchObject({ src: 'https://signed/cover.png', alt: 'A screenshot', section: null })
    expect(model.bookmarked).toBe(true)
    // The progress row as it stood BEFORE this visit — the "updated since you
    // last read it" banner has nothing to compare against otherwise.
    expect(model.progress?.last_anchor).toBe('a')
    expect(model.categories).toHaveLength(1)
  })

  it('drops an image that cannot be signed instead of rendering it broken', async () => {
    createSignedUrl.mockImplementation(async (path: string) =>
      path === 'g1/m1/cover.png' ? { data: null, error: { message: 'gone' } } : { data: { signedUrl: 'https://signed/x.png' }, error: null })
    serve({ guides: [guide()], guide_media: [media(), media({ id: 'm2', storage_path: 'g1/m2/x.png' })] })

    const model = await loadGuidePage('undergrnd')
    expect(model.media).toHaveLength(2) // the editor still sees both rows
    expect(model.images.map((i) => i.id)).toEqual(['m2'])
  })

  it('relates only guides the reader already has, in the same category, at most four', async () => {
    serve({
      guides: [
        guide(),
        guide({ id: 'g2', slug: 'b', title: 'Beta' }),
        guide({ id: 'g3', slug: 'c', title: 'Gamma', status: 'draft' }),
        guide({ id: 'g4', slug: 'd', title: 'Delta', archived_at: '2026-07-01T00:00:00Z' }),
        guide({ id: 'g5', slug: 'e', title: 'Epsilon', category: 'workflows' }),
        guide({ id: 'g6', slug: 'f', title: 'Zeta' }),
        guide({ id: 'g7', slug: 'g', title: 'Eta' }),
        guide({ id: 'g8', slug: 'h', title: 'Theta' }),
        guide({ id: 'g9', slug: 'i', title: 'Iota' }),
      ],
    })
    const model = await loadGuidePage('undergrnd')
    const ids = model.related.map((g) => g.id)
    expect(ids).not.toContain('g1') // never itself
    expect(ids).not.toContain('g3') // a draft is not "related", it is unpublished
    expect(ids).not.toContain('g4') // nor is an archived one
    expect(ids).not.toContain('g5') // nor another category
    expect(ids).toHaveLength(4)
  })

  it('answers a slug that names nothing without reading anything else', async () => {
    serve({ guides: [] })
    const model = await loadGuidePage('no-such-guide')
    expect(model.guide).toBeNull()
    expect(model.sections).toEqual([])
    expect(model.media).toEqual([])
    expect(model.images).toEqual([])
    expect(model.related).toEqual([])
    expect(model.bookmarked).toBe(false)
    expect(list).toHaveBeenCalledTimes(1) // the lookup, and nothing after it
  })

  it('keeps the guide when its decoration fails', async () => {
    serve({
      guides: [guide()],
      guide_sections: new Error('sections unavailable'),
      guide_media: new Error('media unavailable'),
      guide_bookmarks: new Error('bookmarks unavailable'),
      guide_progress: new Error('progress unavailable'),
      guide_categories: new Error('categories unavailable'),
    })
    const model = await loadGuidePage('undergrnd')
    expect(model.guide?.id).toBe('g1')
    expect(model.sections).toEqual([])
    expect(model.images).toEqual([])
    expect(model.bookmarked).toBe(false)
  })

  it('surfaces a failure to look the guide up at all', async () => {
    serve({ guides: new Error('the library is unavailable') })
    await expect(loadGuidePage('undergrnd')).rejects.toThrow('the library is unavailable')
  })
})
