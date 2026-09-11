import { describe, expect, it } from 'vitest'
import {
  GUIDE_CATEGORIES, GUIDE_CATEGORY_LABEL, GUIDE_IMAGE_MAX_BYTES, GUIDE_IMAGE_TYPES,
  guideCategoryLabel, isPublished, matchGuides, sortGuides, validateGuideImage, type GuideRow,
} from './guides'
import { SOFT_DELETE_KIND, REASON_REQUIRED } from './db'

/** The library model. The categories mirror a CHECK constraint in
 *  20261107120000_guide_library.sql and the upload rules mirror three more —
 *  if the server grows a value and this module does not, the helpers must
 *  degrade gracefully rather than drop it. */

const guide = (over: Partial<GuideRow> = {}): GuideRow => ({
  id: 'g1',
  slug: 'undergrnd',
  title: 'UNDERGRND System Guide',
  summary: 'Contracts, equipment, daily objectives, milestones and recorded progression information.',
  category: 'systems',
  status: 'published',
  body_key: 'undergrnd',
  pinned: false,
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

describe('categories', () => {
  it('are exactly the six the CHECK constraint allows, and each has a label', () => {
    expect([...GUIDE_CATEGORIES]).toEqual(['systems', 'equipment', 'jobs', 'organizations', 'locations', 'general'])
    for (const c of GUIDE_CATEGORIES) expect(GUIDE_CATEGORY_LABEL[c], c).toBeTruthy()
  })

  it('humanizes a category the client does not know, and treats a blank as General', () => {
    expect(guideCategoryLabel('systems')).toBe('Systems')
    expect(guideCategoryLabel('field_craft')).toBe('Field Craft')
    expect(guideCategoryLabel(null)).toBe('General')
    expect(guideCategoryLabel(undefined)).toBe('General')
  })
})

describe('publication state', () => {
  it('only "published" is published — anything else is a draft', () => {
    expect(isPublished(guide())).toBe(true)
    expect(isPublished(guide({ status: 'draft' }))).toBe(false)
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
