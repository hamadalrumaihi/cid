/** Personnel Management — the model behind the Command Center's member work
 *  list. The other half of the roster split.
 *
 *  The Division Directory (lib/directory) answers "who is in the division, and
 *  are they available"; every active member reads it. THIS answers "what does
 *  this account need from command", and only command reaches it. Keeping them
 *  apart is the point: a work list is not a directory with buttons, so nothing
 *  here tries to be browsable — it is sorted by what is waiting, searched by
 *  the identifiers command actually types, and filtered by account state.
 *
 *  Authority is unchanged and lives where it always did: every action these
 *  rows lead to is an audited SECURITY DEFINER RPC that re-checks
 *  `private.is_command()` / the assignment matrix. This module decides what to
 *  SHOW, never what may be done. */
import type { JusticeIdentity } from './justiceRoster'
import type { RosterProfile } from './profiles'
import { bureauLabel, bureauShort, roleLabel } from './roles'

/** The state of an account, as command needs to read it.
 *
 *  Four of these used to render as one amber "Pending", which is how an
 *  external Field Intelligence submitter ends up one click from being a CID
 *  detective, and how a member deliberately moved to the DOJ gets
 *  re-dual-roled. They are separate facts and they stay separate. */
export type PersonnelAccess =
  | 'active'
  | 'awaiting_approval'
  | 'denied'
  | 'field_officer'
  | 'moved_to_justice'
  | 'removed'

export const PERSONNEL_ACCESS_LABEL: Record<PersonnelAccess, string> = {
  active: 'Active',
  awaiting_approval: 'Awaiting approval',
  denied: 'Login denied',
  field_officer: 'Field Intelligence',
  moved_to_justice: 'Moved to DOJ / Judiciary',
  removed: 'Removed',
}

/** One-line explanation per state — what command is looking at, and why no
 *  button appears where none should. */
export const PERSONNEL_ACCESS_HINT: Record<PersonnelAccess, string> = {
  active: 'Signed up, approved and able to work.',
  awaiting_approval: 'Applied and waiting on a command decision.',
  denied: 'Access blocked at the door — the account and its history are intact.',
  field_officer: 'An outside agency submitter. They applied for no CID role and must not be approved into one.',
  moved_to_justice: 'Moved out of CID by an organization correction. Their CID membership is history, not a pending request.',
  removed: 'Permanently removed. A director can restore them, inactive, pending re-approval.',
}

export interface PersonnelContext {
  /** id → sign-in email (admin_member_emails; command-only). */
  emails: Record<string, string>
  /** Active DOJ/Judiciary identities keyed by CID user id. */
  justiceByUser: Record<string, JusticeIdentity>
  /** Field Intelligence submitter ids, or null while unloaded — null keeps the
   *  state honest rather than guessing that nobody is external. */
  fieldOfficerIds: ReadonlySet<string> | null
}

/** Read the account's state, strongest fact first. */
export function personnelAccess(p: RosterProfile, ctx: PersonnelContext): PersonnelAccess {
  if (p.removed_at) return 'removed'
  if (p.login_denied) return 'denied'
  if (ctx.justiceByUser[p.id] && !p.active) return 'moved_to_justice'
  if (ctx.fieldOfficerIds?.has(p.id) && !p.active) return 'field_officer'
  return p.active ? 'active' : 'awaiting_approval'
}

export interface PersonnelRow {
  id: string
  /* Identity */
  name: string
  email: string | null
  callsign: string
  /* Current assignment */
  rank: string | null
  rankLabel: string
  bureau: string | null
  bureauLabel: string
  /* Current access */
  access: PersonnelAccess
  accessLabel: string
  accessHint: string
  isOwner: boolean
  /* Availability */
  onLoa: boolean
  loaSince: string | null
  /* Is anything waiting on command? */
  needsDecision: boolean
  /** The underlying profile — the modal and the RPCs work from the row. */
  profile: RosterProfile
}

export function personnelRow(p: RosterProfile, ctx: PersonnelContext): PersonnelRow {
  const access = personnelAccess(p, ctx)
  return {
    id: p.id,
    name: p.display_name,
    email: ctx.emails[p.id] || null,
    callsign: p.badge_number || '—',
    rank: p.role,
    rankLabel: roleLabel(p.role),
    bureau: p.division,
    bureauLabel: p.division ? bureauLabel(p.division) : 'Unassigned',
    access,
    accessLabel: PERSONNEL_ACCESS_LABEL[access],
    accessHint: PERSONNEL_ACCESS_HINT[access],
    isOwner: p.is_owner,
    onLoa: !!p.loa,
    loaSince: p.loa_since,
    // Only one state is a queue. A denied account, an external submitter and a
    // member moved to the DOJ each carry a decision that was already made.
    needsDecision: access === 'awaiting_approval',
    profile: p,
  }
}

/** What is waiting first, then who is away, then by name. A work list opens on
 *  the work. */
export function sortPersonnel(rows: readonly PersonnelRow[]): PersonnelRow[] {
  return [...rows].sort((a, b) =>
    (Number(b.needsDecision) - Number(a.needsDecision))
    || (Number(b.onLoa) - Number(a.onLoa))
    || a.name.localeCompare(b.name))
}

export interface PersonnelFilter {
  q: string
  /** An account state, `needs_decision` (the queue), or every row. */
  access: PersonnelAccess | 'needs_decision' | 'all'
}

export const EMPTY_PERSONNEL_FILTER: PersonnelFilter = { q: '', access: 'all' }

export function filterPersonnel(rows: readonly PersonnelRow[], filter: PersonnelFilter): PersonnelRow[] {
  const q = filter.q.trim().toLowerCase()
  return rows.filter((r) => {
    // The deletion tombstone is not a member and never appears in a work list.
    if (r.profile.is_system) return false
    if (filter.access === 'needs_decision' && !r.needsDecision) return false
    if (filter.access !== 'all' && filter.access !== 'needs_decision' && r.access !== filter.access) return false
    if (!q) return true
    return `${r.name} ${r.email ?? ''} ${r.callsign} ${r.rankLabel} ${r.bureauLabel}`.toLowerCase().includes(q)
  })
}

export const isFilteringPersonnel = (f: PersonnelFilter): boolean => !!f.q.trim() || f.access !== 'all'

/* ── Personnel history ──────────────────────────────────────────────────── */

/** The fields a `role_events` row needs for its one-line summary. Typed
 *  structurally so the modal, the Command Center overview and the tests all
 *  read the same rule rather than three copies of it. */
export interface RoleEventLite {
  source: string | null
  old_role: string | null
  new_role: string | null
  old_division: string | null
  new_division: string | null
  old_active: boolean | null
  new_active: boolean | null
  reason?: string | null
}

const EVENT_SOURCE_LABEL: Record<string, string> = {
  membership_approval: 'Membership approved',
  role_change: 'Role change',
  transfer: 'Transfer',
  activation: 'Status change',
}

/** One quiet line per recorded event — what changed, in plain words, and
 *  nothing that did not. A row whose "change" is the same value on both sides
 *  reads as "Assignment updated" rather than inventing a promotion. */
export function roleEventLine(e: RoleEventLite): string {
  const parts: string[] = []
  if (e.source && EVENT_SOURCE_LABEL[e.source]) parts.push(EVENT_SOURCE_LABEL[e.source])
  if (e.new_role && e.new_role !== e.old_role) parts.push(`${roleLabel(e.old_role)} → ${roleLabel(e.new_role)}`)
  if (e.new_division && e.new_division !== e.old_division) parts.push(`${bureauShort(e.old_division)} → ${bureauShort(e.new_division)}`)
  if (e.new_active !== null && e.new_active !== e.old_active) parts.push(e.new_active ? 'activated' : 'deactivated')
  return parts.join(' · ') || 'Assignment updated'
}
