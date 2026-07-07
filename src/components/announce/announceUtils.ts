/** Announcements vocabulary + pure helpers — vanilla collab.js §15.
 *  mentions/links are loose Json in the DB (vanilla wrote plain strings before
 *  it wrote {target,label} objects), so everything normalizes here. */
import type { Json, Tables } from '@/lib/database.types'
import { officerName } from '@/lib/profiles'
import { ROLE_LABEL } from '@/lib/roles'

export type AnnouncementRow = Tables<'announcements'>

export interface Mention { target: string; label?: string }
export interface AnnLink { type: string; id: string; label?: string }

/** Record-link chip vocabulary (collab.js REC_LINK). */
export const REC_LINK: Record<string, { icon: string; tab: string }> = {
  case: { icon: '🗂️', tab: 'cases' },
  person: { icon: '🧑‍⚖️', tab: 'persons' },
  evidence: { icon: '🧾', tab: 'cases' },
  report: { icon: '📝', tab: 'reports' },
}

export function parseMentions(j: Json): Mention[] {
  if (!Array.isArray(j)) return []
  return j
    .map((x) => (typeof x === 'string' ? { target: x } : x && typeof x === 'object' && 'target' in x ? (x as unknown as Mention) : null))
    .filter((x): x is Mention => !!x && typeof x.target === 'string')
}

export function parseLinks(j: Json): AnnLink[] {
  if (!Array.isArray(j)) return []
  return j
    .map((x) => (x && typeof x === 'object' && 'id' in x ? (x as unknown as AnnLink) : null))
    .filter((x): x is AnnLink => !!x && typeof x.id === 'string')
}

/** '@All Officers' / '@All Bureau Leads' / '@<name>' (collab.js mentionLabel). */
export function mentionLabel(t: string): string {
  if (t === 'all') return 'All Officers'
  if (t.startsWith('role:')) return `All ${ROLE_LABEL[t.slice(5)] || t.slice(5)}s`
  return officerName(t) || 'Officer'
}

/** Audience + dismissal filter with pinned-first sort (collab.js:240-246). */
export function visibleAnnouncements(
  rows: AnnouncementRow[],
  myDivision: string | null,
  dismissed: ReadonlySet<string>,
  includeDismissed: boolean,
): AnnouncementRow[] {
  return rows
    .filter((a) => a.audience === 'all' || a.audience === myDivision)
    .filter((a) => includeDismissed || !dismissed.has(a.id))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

/** Audience label for the '<dept> only' meta suffix. */
export const AUDIENCE_OPTIONS: [string, string][] = [
  ['all', 'All divisions'], ['LSB', 'LSPD'], ['BCB', 'BCSO'], ['SAB', 'SAHP'], ['JTF', 'JTF'],
]
