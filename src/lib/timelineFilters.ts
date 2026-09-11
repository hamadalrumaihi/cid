/** Timeline filter chips — pure model behind the case Timeline tab's
 *  Investigation / Evidence / Custody / Legal / Intelligence / Documents row.
 *  Lanes (TimelineBand's `type`) are a rendering concern; GROUPS are what the
 *  officer filters by, and a lane can serve several groups (surveillance
 *  events ride the `task` lane but belong to Intelligence). No React, no
 *  storage access — the persistence helpers take the Storage instance so
 *  they are unit-testable in node. */

export const TIMELINE_GROUPS = [
  { id: 'investigation', label: 'Investigation' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'custody', label: 'Custody' },
  { id: 'legal', label: 'Legal' },
  { id: 'intelligence', label: 'Intelligence' },
  { id: 'documents', label: 'Documents' },
] as const

export type TimelineGroup = (typeof TIMELINE_GROUPS)[number]['id']

export const ALL_TIMELINE_GROUPS: readonly TimelineGroup[] = TIMELINE_GROUPS.map((g) => g.id)

/** Band lanes (TimelineBand `type`). */
export type TimelineLane =
  | 'opened' | 'followup' | 'evidence' | 'media' | 'report' | 'task' | 'signoff' | 'hold' | 'restricted'
  | 'custody' | 'packet' | 'source' | 'document'

/** Default group for a lane — the mapping the request spells out:
 *  Investigation (opened/followup/task/signoff/report), Evidence
 *  (evidence/media), Custody, Legal (hold/restricted), Intelligence
 *  (source), Documents (document/packet). Events that need a different
 *  group than their lane implies (surveillance on the task lane) carry an
 *  explicit `group`. */
export function laneGroup(lane: TimelineLane): TimelineGroup {
  switch (lane) {
    case 'evidence':
    case 'media':
      return 'evidence'
    case 'custody':
      return 'custody'
    case 'hold':
    case 'restricted':
      return 'legal'
    case 'source':
      return 'intelligence'
    case 'document':
    case 'packet':
      return 'documents'
    case 'opened':
    case 'followup':
    case 'task':
    case 'signoff':
    case 'report':
    default:
      return 'investigation'
  }
}

/** The group an event filters under: its explicit group, else its lane's. */
export function timelineGroupOf(ev: { type: TimelineLane; group?: TimelineGroup }): TimelineGroup {
  return ev.group ?? laneGroup(ev.type)
}

/** Keep the events whose group is enabled. An empty selection shows nothing
 *  (the chip row makes that state obvious); every group on = passthrough. */
export function filterTimelineEvents<T extends { type: TimelineLane; group?: TimelineGroup }>(
  events: readonly T[],
  enabled: ReadonlySet<TimelineGroup>,
): T[] {
  if (enabled.size >= ALL_TIMELINE_GROUPS.length) return [...events]
  return events.filter((e) => enabled.has(timelineGroupOf(e)))
}

export const TIMELINE_FILTER_STORAGE_KEY = 'cid:timeline-filters'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** Read the persisted selection; anything malformed or unknown falls back
 *  to "everything on" so a stale key can never blank the timeline. */
export function readTimelineFilters(storage: StorageLike | null | undefined): Set<TimelineGroup> {
  const all = new Set<TimelineGroup>(ALL_TIMELINE_GROUPS)
  if (!storage) return all
  try {
    const raw = storage.getItem(TIMELINE_FILTER_STORAGE_KEY)
    if (!raw) return all
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return all
    const known = parsed.filter((x): x is TimelineGroup => typeof x === 'string' && (ALL_TIMELINE_GROUPS as readonly string[]).includes(x))
    return new Set(known)
  } catch { return all }
}

export function writeTimelineFilters(storage: StorageLike | null | undefined, enabled: ReadonlySet<TimelineGroup>): void {
  if (!storage) return
  try { storage.setItem(TIMELINE_FILTER_STORAGE_KEY, JSON.stringify([...enabled])) } catch { /* quota / private mode — the session still works */ }
}

/** Toggle one group; returns a new set (never mutates the input). */
export function toggleTimelineGroup(enabled: ReadonlySet<TimelineGroup>, group: TimelineGroup): Set<TimelineGroup> {
  const next = new Set(enabled)
  if (next.has(group)) next.delete(group)
  else next.add(group)
  return next
}
