/** Announcements vocabulary + pure helpers — port of vanilla collab.js.
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

/** Who is looking at the list — mirrors the server RLS inputs. Legacy callers
 *  (nav badge) still pass just the division string; identity-dependent checks
 *  then fall back to trusting what RLS returned. */
export interface AnnounceViewer {
  id?: string | null
  division?: string | null
  role?: string | null
  isCommand?: boolean
  isOwner?: boolean
}

/** Audience + dismissal filter with pinned-first sort (collab.js:240-246).
 *  Client complement to the server-enforced RLS: 'all' and own-division rows
 *  for everyone, 'command' for command, 'specific_members' only when mentioned (or the
 *  author), and command/owner see everything (oversight). */
export function visibleAnnouncements(
  rows: AnnouncementRow[],
  viewer: AnnounceViewer | string | null,
  dismissed: ReadonlySet<string>,
  includeDismissed: boolean,
): AnnouncementRow[] {
  const v: AnnounceViewer = viewer === null || typeof viewer === 'string' ? { division: viewer } : viewer
  const mentioned = (a: AnnouncementRow) =>
    !v.id || // identity unknown (legacy caller) — RLS only returns mentioned/authored rows
    a.author_id === v.id ||
    parseMentions(a.mentions).some((m) =>
      m.target === 'all' || m.target === v.id || (!!v.role && m.target === `role:${v.role}`))
  const visible = (a: AnnouncementRow): boolean => {
    if (a.audience === 'all' || v.isCommand || v.isOwner) return true
    if (a.audience === v.division) return true
    if (a.audience === 'command') return v.isCommand ?? true // undefined = legacy caller, trust RLS
    if (a.audience === 'specific_members') return mentioned(a)
    return false
  }
  return rows
    .filter(visible)
    .filter((a) => includeDismissed || !dismissed.has(a.id))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
}

/** Audience vocabulary — every CHECK-allowed announcements.audience value. */
export const AUDIENCE_LABEL: Record<string, string> = {
  all: 'Everyone', command: 'Command', specific_members: 'Specific members',
  LSB: 'LSPD', BCB: 'BCSO', SAB: 'SAHP', JTF: 'JTF',
}
export const audienceLabel = (a?: string | null) => (a && AUDIENCE_LABEL[a]) || a || '—'
