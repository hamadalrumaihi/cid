import { describe, expect, it } from 'vitest'
import { caseMediaCategoryLabel, filterCaseMedia, legacyEvidenceRef, mediaTimelineEvents, type MediaEventInput } from './caseMedia'

const row = (over: Partial<{ id: string; category: string | null; archived_at: string | null }> = {}) => ({
  id: 'm1', category: null, archived_at: null, ...over,
})

describe('filterCaseMedia — category pills + archived toggle', () => {
  const rows = [
    row({ id: 'a', category: 'scene' }),
    row({ id: 'b', category: 'documents' }),
    row({ id: 'c', category: null }),
    row({ id: 'd', category: 'scene', archived_at: '2026-07-01T00:00:00Z' }),
  ]

  it('All shows every non-archived row, including uncategorized (null)', () => {
    expect(filterCaseMedia(rows, { category: 'all', showArchived: false }).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('a category pill matches media.category exactly — null rows appear under All only', () => {
    expect(filterCaseMedia(rows, { category: 'scene', showArchived: false }).map((r) => r.id)).toEqual(['a'])
    expect(filterCaseMedia(rows, { category: 'documents', showArchived: false }).map((r) => r.id)).toEqual(['b'])
    expect(filterCaseMedia(rows, { category: 'other', showArchived: false })).toHaveLength(0)
  })

  it('archived rows are hidden by default and revealed by the toggle', () => {
    expect(filterCaseMedia(rows, { category: 'scene', showArchived: true }).map((r) => r.id)).toEqual(['a', 'd'])
    expect(filterCaseMedia(rows, { category: 'all', showArchived: true })).toHaveLength(4)
  })
})

describe('caseMediaCategoryLabel', () => {
  it('labels known categories and falls back gracefully', () => {
    expect(caseMediaCategoryLabel('documents')).toBe('Documents & Screenshots')
    expect(caseMediaCategoryLabel('report_media')).toBe('Report Media')
    expect(caseMediaCategoryLabel(null)).toBe('Uncategorized')
    expect(caseMediaCategoryLabel('mystery')).toBe('mystery')
  })
})

describe('mediaTimelineEvents — derived from columns only', () => {
  const m = (over: Partial<MediaEventInput>): MediaEventInput => ({
    id: 'x', title: 'Photo', created_at: '2026-07-14T10:05:00Z', updated_at: '2026-07-14T10:05:00Z',
    archived_at: null, featured: false, uploaded_by: 'u1', ...over,
  })
  const nameOf = (id: string | null) => (id === 'u1' ? 'Det. Reyes' : null)

  it('groups a bulk upload (same uploader + same hour) into one expandable event', () => {
    const rows = [
      m({ id: '1', title: 'Front door', created_at: '2026-07-14T10:05:00Z' }),
      m({ id: '2', title: 'Back alley', created_at: '2026-07-14T10:40:00Z' }),
      m({ id: '3', title: 'Plate closeup', created_at: '2026-07-14T10:59:00Z' }),
    ]
    const events = mediaTimelineEvents(rows, nameOf)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'added', label: 'Det. Reyes added 3 case photos' })
    expect(events[0].items).toEqual(['Front door', 'Back alley', 'Plate closeup'])
    // The grouped event sits at the newest timestamp in the batch.
    expect(events[0].at).toBe('2026-07-14T10:59:00Z')
  })

  it('different uploader or different hour breaks the group', () => {
    const rows = [
      m({ id: '1', created_at: '2026-07-14T10:05:00Z' }),
      m({ id: '2', created_at: '2026-07-14T11:05:00Z' }),
      m({ id: '3', created_at: '2026-07-14T10:06:00Z', uploaded_by: 'u2' }),
    ]
    const events = mediaTimelineEvents(rows, nameOf)
    expect(events.filter((e) => e.kind === 'added')).toHaveLength(3)
    expect(events.every((e) => !e.items)).toBe(true)
  })

  it('a single photo stays a plain "Photo added" event with the uploader as sub', () => {
    const [e] = mediaTimelineEvents([m({ title: 'Front door' })], nameOf)
    expect(e).toMatchObject({ kind: 'added', label: 'Photo added: Front door', sub: 'Det. Reyes' })
  })

  it('archived rows also emit an archived event at archived_at', () => {
    const events = mediaTimelineEvents([m({ archived_at: '2026-07-15T09:00:00Z' })], nameOf)
    expect(events.find((e) => e.kind === 'archived')).toMatchObject({ at: '2026-07-15T09:00:00Z', label: 'Photo archived: Photo' })
    // The add event is still present — archiving never erases history.
    expect(events.find((e) => e.kind === 'added')).toBeTruthy()
  })

  it('featured rows emit a featured event (updated_at — best derivable column)', () => {
    const events = mediaTimelineEvents([m({ featured: true, updated_at: '2026-07-16T12:00:00Z' })], nameOf)
    expect(events.find((e) => e.kind === 'featured')).toMatchObject({ at: '2026-07-16T12:00:00Z' })
  })
})

describe('legacyEvidenceRef — migration provenance in tags', () => {
  it('reads a plain string ref', () => {
    expect(legacyEvidenceRef({ legacy_evidence: 'EV-012' })).toBe('EV-012')
  })
  it('reads an object carrying item_code', () => {
    expect(legacyEvidenceRef({ legacy_evidence: { item_code: 'EV-003' } })).toBe('EV-003')
  })
  it('anything else is no provenance', () => {
    expect(legacyEvidenceRef(null)).toBeNull()
    expect(legacyEvidenceRef({})).toBeNull()
    expect(legacyEvidenceRef({ legacy_evidence: 42 })).toBeNull()
    expect(legacyEvidenceRef('EV-001')).toBeNull()
  })
})
