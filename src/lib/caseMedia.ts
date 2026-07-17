/** Case Photos & Media — pure helpers behind the case `media` tab, its
 *  category pills, and the timeline's derived media events. No React, no db:
 *  plain rows in, plain values out, so the filtering and grouping rules are
 *  unit-testable and shared by every consumer without drift. */

/** media.category vocabulary (nullable column — null shows under All only). */
export const CASE_MEDIA_CATEGORIES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'scene', label: 'Scene' },
  { id: 'people', label: 'People' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'places', label: 'Places' },
  { id: 'surveillance', label: 'Surveillance' },
  { id: 'documents', label: 'Documents & Screenshots' },
  { id: 'report_media', label: 'Report Media' },
  { id: 'other', label: 'Other' },
]

export function caseMediaCategoryLabel(category: string | null | undefined): string {
  if (!category) return 'Uncategorized'
  return CASE_MEDIA_CATEGORIES.find((c) => c.id === category)?.label ?? category
}

export interface CaseMediaFilter {
  /** 'all' or a CASE_MEDIA_CATEGORIES id. */
  category: string
  /** Archived rows are hidden by default; the toggle reveals them inline. */
  showArchived: boolean
}

/** Category + archived filtering for the gallery grid. Rules:
 *  - 'all' shows every category INCLUDING uncategorized (null) rows;
 *  - a category pill matches media.category exactly (null matches nothing);
 *  - archived rows (archived_at set) only appear when showArchived is on. */
export function filterCaseMedia<T extends { category: string | null; archived_at: string | null }>(
  rows: readonly T[],
  filter: CaseMediaFilter,
): T[] {
  return rows.filter((m) => {
    if (!filter.showArchived && m.archived_at) return false
    if (filter.category === 'all') return true
    return m.category === filter.category
  })
}

/* ── Derived timeline events ───────────────────────────────────────────────
 * Media has no event table — added/archived/featured events are derived from
 * the row's own columns. Bulk uploads (same uploader, same hour) collapse to
 * one expandable "added N case photos" event so a 20-photo dump doesn't bury
 * the rest of the timeline. */

export interface MediaEventInput {
  id: string
  title: string
  created_at: string
  updated_at: string
  archived_at: string | null
  featured: boolean
  uploaded_by: string | null
}

export interface MediaTimelineEvent {
  kind: 'added' | 'archived' | 'featured'
  at: string
  label: string
  sub?: string
  /** Titles inside a collapsed bulk-upload group (absent for single events). */
  items?: string[]
}

export function mediaTimelineEvents(
  rows: readonly MediaEventInput[],
  nameOf: (id: string | null) => string | null = () => null,
): MediaTimelineEvent[] {
  const events: MediaTimelineEvent[] = []

  // Added — group by uploader + hour; a group of one stays a plain event.
  const buckets = new Map<string, MediaEventInput[]>()
  for (const m of rows) {
    const key = `${m.uploaded_by ?? ''}|${m.created_at.slice(0, 13)}`
    const b = buckets.get(key)
    if (b) b.push(m)
    else buckets.set(key, [m])
  }
  for (const group of buckets.values()) {
    const who = nameOf(group[0].uploaded_by)
    if (group.length === 1) {
      const m = group[0]
      events.push({ kind: 'added', at: m.created_at, label: `Photo added: ${m.title}`, sub: who ?? undefined })
    } else {
      const latest = group.reduce((a, b) => (a.created_at > b.created_at ? a : b))
      events.push({
        kind: 'added',
        at: latest.created_at,
        label: `${who || 'An officer'} added ${group.length} case photos`,
        items: group.map((m) => m.title),
      })
    }
  }

  // Archived — exact timestamp from the column.
  for (const m of rows) {
    if (m.archived_at) events.push({ kind: 'archived', at: m.archived_at, label: `Photo archived: ${m.title}` })
  }

  // Featured — no featured_at column exists; updated_at is the closest
  // derivable timestamp (approximate by design — columns only, no event table).
  for (const m of rows) {
    if (m.featured) events.push({ kind: 'featured', at: m.updated_at, label: `Photo featured: ${m.title}` })
  }

  return events
}

/** Legacy-evidence provenance riding in media.tags.legacy_evidence — written
 *  by the evidence→media migration. Tolerant of a plain "EV-012" string or an
 *  object carrying item_code; anything else reads as no provenance. */
export function legacyEvidenceRef(tags: unknown): string | null {
  if (!tags || typeof tags !== 'object' || Array.isArray(tags)) return null
  const v = (tags as Record<string, unknown>).legacy_evidence
  if (typeof v === 'string' && v.trim()) return v.trim()
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const code = (v as Record<string, unknown>).item_code
    if (typeof code === 'string' && code.trim()) return code.trim()
  }
  return null
}
