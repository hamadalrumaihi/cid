import { describe, expect, it } from 'vitest'
import {
  GUIDE_AUDIENCES, GUIDE_AUDIENCE_LABEL, GUIDE_IMAGE_MAX_BYTES, GUIDE_IMAGE_TYPES,
  categoryLabelFrom, guideAudienceLabel, humanizeSlug, isArchived, isNewToReader, isPublished,
  isRestrictedAudience, isUpdatedSinceSeen, matchGuides, sortGuides, validateGuideImage,
  type GuideCategoryRow, type GuideProgressRow, type GuideRow,
} from './guides'
import { SOFT_DELETE_KIND, REASON_REQUIRED } from './db'

/** The library model.
 *
 *  Categories are DATA now — public.guide_categories, which an administrator
 *  edits without a deploy — so what this file pins is that the helpers read
 *  whatever the table says and degrade sensibly when it says nothing. The
 *  audiences and the upload rules are still server constraints, and if the
 *  server grows a value and this module does not, the helpers must degrade
 *  gracefully rather than drop it. */

const guide = (over: Partial<GuideRow> = {}): GuideRow => ({
  id: 'g1',
  slug: 'undergrnd',
  title: 'UNDERGRND System Guide',
  summary: 'Contracts, equipment, daily objectives, milestones and recorded progression information.',
  category: 'systems',
  status: 'published',
  body_key: 'undergrnd',
  pinned: false,
  audience: 'all',
  custom_roles: [],
  tags: [],
  keywords: null,
  body_kind: 'module',
  read_minutes: null,
  view_count: 0,
  content_owner: null,
  last_reviewed_at: null,
  next_review_at: null,
  archived_at: null,
  archived_by: null,
  publication_note: null,
  outdated_at: null,
  outdated_by: null,
  outdated_reason: null,
  published_at: '2026-09-11T00:00:00.000Z',
  created_by: null,
  updated_by: null,
  created_at: '2026-09-11T00:00:00.000Z',
  updated_at: '2026-09-11T00:00:00.000Z',
  deleted_at: null,
  deleted_by: null,
  delete_reason: null,
  delete_batch: null,
  ...over,
})

const category = (slug: string, label: string): GuideCategoryRow => ({
  slug,
  label,
  description: null,
  sort_order: 10,
  active: true,
  created_at: '2026-09-11T00:00:00.000Z',
  updated_at: '2026-09-11T00:00:00.000Z',
})

describe('categories come from the table, not from the build', () => {
  const cats = [category('systems', 'Systems'), category('reports-evidence', 'Reports and Evidence')]

  it('labels a category from the rows the library loaded', () => {
    expect(categoryLabelFrom(cats, 'systems')).toBe('Systems')
    expect(categoryLabelFrom(cats, 'reports-evidence')).toBe('Reports and Evidence')
  })

  it('humanizes a category the table did not return rather than showing a raw slug', () => {
    expect(categoryLabelFrom(cats, 'field-craft')).toBe('Field Craft')
    expect(categoryLabelFrom([], 'systems')).toBe('Systems')
    expect(categoryLabelFrom(cats, null)).toBe('General')
    expect(categoryLabelFrom(cats, undefined)).toBe('General')
  })

  it('humanizeSlug reads both separators, because slugs use hyphens and columns use underscores', () => {
    expect(humanizeSlug('command-admin')).toBe('Command Admin')
    expect(humanizeSlug('ci_handlers')).toBe('Ci Handlers')
    // It humanizes; inventing a name for nothing is the caller's job.
    expect(humanizeSlug('')).toBe('')
  })
})

describe('audiences', () => {
  it('are the eight the server accepts, and each has a label', () => {
    expect([...GUIDE_AUDIENCES]).toEqual([
      'all', 'investigative', 'command', 'doj', 'sib', 'ci_handlers', 'owner', 'custom',
    ])
    for (const a of GUIDE_AUDIENCES) expect(GUIDE_AUDIENCE_LABEL[a], a).toBeTruthy()
  })

  it('the two ordinary audiences are open; every narrower one is restricted, known or not', () => {
    expect(isRestrictedAudience('all')).toBe(false)
    expect(isRestrictedAudience('investigative')).toBe(false)
    expect(isRestrictedAudience(null)).toBe(false)
    for (const a of GUIDE_AUDIENCES.filter((x) => x !== 'all' && x !== 'investigative')) {
      expect(isRestrictedAudience(a), a).toBe(true)
    }
    // An audience the build has never heard of is treated as the narrower
    // case, never as the open one.
    expect(isRestrictedAudience('task_force')).toBe(true)
    expect(guideAudienceLabel('task_force')).toBe('Task Force')
  })
})

describe('publication state', () => {
  const progress = (over: Partial<GuideProgressRow> = {}): GuideProgressRow => ({
    guide_id: 'g1',
    user_id: 'u1',
    last_anchor: null,
    last_viewed_at: '2026-09-01T00:00:00.000Z',
    seen_updated_at: '2026-09-01T00:00:00.000Z',
    completed_at: null,
    updated_at: '2026-09-01T00:00:00.000Z',
    ...over,
  })

  it('only "published" is published — anything else is a draft', () => {
    expect(isPublished(guide())).toBe(true)
    expect(isPublished(guide({ status: 'draft' }))).toBe(false)
  })

  it('archived is its own state: a guide can be published and still archived', () => {
    expect(isArchived(guide())).toBe(false)
    expect(isArchived(guide({ archived_at: '2026-09-05T00:00:00.000Z' }))).toBe(true)
  })

  it('"updated since you last read it" needs a previous read — a guide nobody opened is never marked changed', () => {
    const g = guide({ updated_at: '2026-09-10T00:00:00.000Z' })
    expect(isUpdatedSinceSeen(g, undefined)).toBe(false)
    expect(isUpdatedSinceSeen(g, progress({ seen_updated_at: null }))).toBe(false)
    expect(isUpdatedSinceSeen(g, progress())).toBe(true)
    expect(isUpdatedSinceSeen(g, progress({ seen_updated_at: '2026-09-10T00:00:00.000Z' }))).toBe(false)
  })

  it('"new" is recently published AND never opened by this reader', () => {
    const at = Date.parse('2026-09-11T00:00:00.000Z')
    const fresh = guide({ published_at: '2026-09-08T00:00:00.000Z' })
    expect(isNewToReader(fresh, undefined, at)).toBe(true)
    expect(isNewToReader(fresh, progress(), at)).toBe(false)
    expect(isNewToReader(guide({ published_at: '2026-07-01T00:00:00.000Z' }), undefined, at)).toBe(false)
    expect(isNewToReader(guide({ published_at: null }), undefined, at)).toBe(false)
  })
})

describe('sortGuides — pinned first, then most recently updated', () => {
  it('orders the library and never mutates the input', () => {
    const input = [
      guide({ id: 'old', title: 'Old', updated_at: '2026-08-01T00:00:00.000Z' }),
      guide({ id: 'pin-old', title: 'Pinned old', pinned: true, updated_at: '2026-07-01T00:00:00.000Z' }),
      guide({ id: 'new', title: 'New', updated_at: '2026-09-10T00:00:00.000Z' }),
      guide({ id: 'pin-new', title: 'Pinned new', pinned: true, updated_at: '2026-09-01T00:00:00.000Z' }),
    ]
    const frozen = input.map((g) => g.id)
    expect(sortGuides(input).map((g) => g.id)).toEqual(['pin-new', 'pin-old', 'new', 'old'])
    expect(input.map((g) => g.id)).toEqual(frozen)
  })

  it('falls back to the title so the order is stable for two guides saved at once', () => {
    const at = '2026-09-01T00:00:00.000Z'
    const rows = [guide({ id: 'b', title: 'Beta', updated_at: at }), guide({ id: 'a', title: 'Alpha', updated_at: at })]
    expect(sortGuides(rows).map((g) => g.title)).toEqual(['Alpha', 'Beta'])
  })
})

describe('matchGuides — the library search', () => {
  const rows = [
    guide({ id: 'u', title: 'UNDERGRND System Guide', summary: 'Contracts and equipment.', category: 'systems', slug: 'undergrnd' }),
    guide({ id: 'r', title: 'Radio Procedure', summary: 'Callsigns and channels.', category: 'general', slug: 'radio' }),
  ]

  it('matches on title, summary, address and the CATEGORY LABEL, not just the raw value', () => {
    expect(matchGuides(rows, 'undergrnd').map((g) => g.id)).toEqual(['u'])
    expect(matchGuides(rows, 'callsigns').map((g) => g.id)).toEqual(['r'])
    expect(matchGuides(rows, 'radio').map((g) => g.id)).toEqual(['r'])
    expect(matchGuides(rows, 'Systems').map((g) => g.id)).toEqual(['u'])
  })

  it('is case-insensitive, and a blank query is the whole library rather than none of it', () => {
    expect(matchGuides(rows, 'SYSTEM').map((g) => g.id)).toEqual(['u'])
    expect(matchGuides(rows, '').map((g) => g.id)).toEqual(['u', 'r'])
    expect(matchGuides(rows, '   ').map((g) => g.id)).toEqual(['u', 'r'])
    expect(matchGuides(rows, 'nothing here')).toEqual([])
  })
})

describe('validateGuideImage — the same three rules the table CHECKs', () => {
  it('accepts the four image types and refuses everything else', () => {
    for (const type of GUIDE_IMAGE_TYPES) {
      expect(validateGuideImage({ type, size: 1024 }), type).toBeNull()
    }
    expect(validateGuideImage({ type: 'image/svg+xml', size: 1024 })).toMatch(/PNG, JPEG, WebP or GIF/)
    expect(validateGuideImage({ type: 'application/pdf', size: 1024 })).toMatch(/PNG, JPEG, WebP or GIF/)
    expect(validateGuideImage({ type: '', size: 1024 })).toMatch(/PNG, JPEG, WebP or GIF/)
  })

  it('caps the size at 10 MB and refuses an empty file', () => {
    expect(validateGuideImage({ type: 'image/png', size: GUIDE_IMAGE_MAX_BYTES })).toBeNull()
    expect(validateGuideImage({ type: 'image/png', size: GUIDE_IMAGE_MAX_BYTES + 1 })).toMatch(/10 MB/)
    expect(validateGuideImage({ type: 'image/png', size: 0 })).toMatch(/10 MB/)
  })
})

describe('a guide deletes like every other record', () => {
  it("is registered as the soft-delete kind 'guide', and deleting one needs a reason", () => {
    expect(SOFT_DELETE_KIND.guides).toBe('guide')
    expect(REASON_REQUIRED.has('guide')).toBe(true)
  })
})
