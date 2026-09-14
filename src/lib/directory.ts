/** The Division Directory — the member-facing view of who is in CID.
 *
 *  WHAT THIS IS, AND WHAT IT IS NOT. The directory answers "who is in the
 *  division, where are they assigned, and are they available". It is not
 *  personnel administration: approvals, transfers, rank changes, account
 *  state, LOA administration and personnel history belong to the Command
 *  Center's Personnel Management, behind `private.is_command()`. Nothing in
 *  this module reads or exposes a command-only field — the input is the
 *  shared roster projection (lib/profiles `ROSTER_COLS`, which deliberately
 *  omits `profiles.email` because that column is granted to command alone)
 *  and the output carries a strict subset of it.
 *
 *  ONE SOURCE OF TRUTH. The rows come from `public.profiles` through the
 *  shared roster cache. There is no directory table, no copy, and no derived
 *  membership mirror: a bureau transfer is a change to `profiles.division`,
 *  and this model is recomputed from it rather than patched.
 *
 *  THE SIB BUREAU IS WITHHELD. `special_investigations` occupies a bureau
 *  value but SIB membership is not a bureau assignment (AUTHORIZATION §SIB),
 *  and the Command Center's readiness board has always excluded it. A
 *  division-wide directory that listed it would publish precisely what that
 *  board withholds, so it is excluded here too — silently, because a
 *  "members withheld" line is the same disclosure with extra steps. RLS is
 *  unchanged and remains the authority; this is presentation following the
 *  policy the portal already applies.
 *
 *  Pure functions only: no fetching, no React. The hook that composes this
 *  with the roster cache and realtime lives in components/directory. */
import type { RosterProfile } from './profiles'
import { BUREAU_SHORT, BUREAUS, ROLE_ORDER, roleLabel } from './roles'

/** The groups the directory draws, in order. `special_investigations` is
 *  deliberately absent (see the header); `unassigned` catches a member whose
 *  bureau has not been set yet — dropping them would lose a real member. */
export const DIRECTORY_BUREAUS = ['major_crimes', 'street_crimes', 'JTF', 'unassigned'] as const
export type DirectoryBureau = (typeof DIRECTORY_BUREAUS)[number]

/** Bureau values never shown in the division-wide directory. */
const WITHHELD_BUREAUS: ReadonlySet<string> = new Set(['special_investigations'])

const RANK_SENIORITY = new Map<string, number>(ROLE_ORDER.map((r, i) => [r, i]))

/** Where leadership starts in the canonical rank order. This is a DISPLAY
 *  grouping — it decides who sorts to the top of a bureau and wears the
 *  "Leadership" chip, and decides nothing about authority. What a member may
 *  actually do is answered by RLS, mirrored client-side by lib/permissions. */
const LEADERSHIP_FROM = ROLE_ORDER.indexOf('bureau_lead')
const isLeadershipRank = (role: string | null): boolean =>
  (RANK_SENIORITY.get(role ?? '') ?? -1) >= LEADERSHIP_FROM

export type DirectoryStatus = 'active' | 'loa' | 'inactive'

export const DIRECTORY_STATUS_LABEL: Record<DirectoryStatus, string> = {
  active: 'Active',
  loa: 'On LOA',
  inactive: 'Inactive',
}

/** Availability, in the order the facts override each other: a deactivated
 *  account reads as inactive even if an LOA flag is still set on it. */
export function directoryStatus(p: Pick<RosterProfile, 'active' | 'loa'>): DirectoryStatus {
  if (!p.active) return 'inactive'
  return p.loa ? 'loa' : 'active'
}

/** The member's assignment in words: the leadership post where one exists,
 *  otherwise the bureau they belong to. Rank is shown separately — this is
 *  the line that says what they DO. */
export function memberAssignment(role: string | null, bureau: string | null): string {
  if (role === 'director') return 'Director of CID'
  if (role === 'deputy_director') return 'Deputy Director'
  if (!bureau) return 'Awaiting assignment'
  if (role === 'bureau_lead') return `${BUREAU_SHORT[bureau] ?? bureau} Bureau Lead`
  return BUREAUS[bureau] ?? bureau
}

/** One directory entry. Every field here is already authorized for
 *  division-wide viewing; nothing else from the profile travels. */
export interface DirectoryMember {
  id: string
  name: string
  /** `badge_number` — what the division calls each other on the air. */
  callsign: string
  rank: string | null
  rankLabel: string
  bureau: DirectoryBureau
  bureauLabel: string
  assignment: string
  status: DirectoryStatus
  statusLabel: string
  avatarUrl: string | null
  /** Commendations awarded to this member — the compact recognition chip. */
  awards: number
  isLeadership: boolean
}

export interface DirectoryGroup {
  bureau: DirectoryBureau
  label: string
  short: string
  members: DirectoryMember[]
  /** Totals for the group as BUILT — a filtered view keeps them, so the
   *  header can say "2 of 9" rather than redefining the bureau's size. */
  total: number
  leadership: number
}

export interface DirectorySummary {
  active: number
  majorCrimes: number
  streetCrimes: number
  onLoa: number
}

export interface Directory {
  groups: DirectoryGroup[]
  summary: DirectorySummary
  /** Members listed across every group (after filtering, when filtered). */
  matches: number
}

const GROUP_LABEL: Record<DirectoryBureau, { label: string; short: string }> = {
  major_crimes: { label: BUREAUS.major_crimes, short: BUREAU_SHORT.major_crimes },
  street_crimes: { label: BUREAUS.street_crimes, short: BUREAU_SHORT.street_crimes },
  JTF: { label: BUREAUS.JTF, short: BUREAU_SHORT.JTF },
  unassigned: { label: 'Unassigned', short: 'Unassigned' },
}

const groupOf = (division: string | null): DirectoryBureau =>
  (DIRECTORY_BUREAUS as readonly string[]).includes(division ?? '')
    ? (division as DirectoryBureau)
    : 'unassigned'

/** Leadership first, then canonical rank order (Director highest), then name.
 *  Order is information: the shape of a bureau should be readable without
 *  reading every row, and a promotion should visibly move someone. */
function bySeniority(a: DirectoryMember, b: DirectoryMember): number {
  return (Number(b.isLeadership) - Number(a.isLeadership))
    || ((RANK_SENIORITY.get(b.rank ?? '') ?? -1) - (RANK_SENIORITY.get(a.rank ?? '') ?? -1))
    || a.name.localeCompare(b.name)
}

/** Build the directory from the canonical roster rows plus the commendation
 *  rows that decorate them. Recomputed on every change — never patched. */
export function buildDirectory(
  rows: readonly RosterProfile[],
  commendations: readonly { recipient_id: string | null }[] = [],
): Directory {
  const awards = new Map<string, number>()
  for (const c of commendations) {
    if (c.recipient_id) awards.set(c.recipient_id, (awards.get(c.recipient_id) ?? 0) + 1)
  }

  const listed = rows.filter((p) =>
    !p.removed_at && !p.is_system && !WITHHELD_BUREAUS.has(p.division ?? ''))

  const members: DirectoryMember[] = listed.map((p) => {
    const bureau = groupOf(p.division)
    return {
      id: p.id,
      name: p.display_name,
      callsign: p.badge_number || '—',
      rank: p.role,
      rankLabel: roleLabel(p.role),
      bureau,
      bureauLabel: GROUP_LABEL[bureau].short,
      assignment: memberAssignment(p.role, p.division),
      status: directoryStatus(p),
      statusLabel: DIRECTORY_STATUS_LABEL[directoryStatus(p)],
      avatarUrl: p.avatar_url,
      awards: awards.get(p.id) ?? 0,
      isLeadership: isLeadershipRank(p.role),
    }
  })

  const groups: DirectoryGroup[] = DIRECTORY_BUREAUS.map((bureau) => {
    const inGroup = members.filter((m) => m.bureau === bureau).sort(bySeniority)
    return {
      bureau,
      label: GROUP_LABEL[bureau].label,
      short: GROUP_LABEL[bureau].short,
      members: inGroup,
      total: inGroup.length,
      leadership: inGroup.filter((m) => m.isLeadership).length,
    }
  })

  const active = members.filter((m) => m.status !== 'inactive')
  return {
    groups,
    summary: {
      active: active.length,
      majorCrimes: active.filter((m) => m.bureau === 'major_crimes').length,
      streetCrimes: active.filter((m) => m.bureau === 'street_crimes').length,
      onLoa: members.filter((m) => m.status === 'loa').length,
    },
    matches: members.length,
  }
}

export interface DirectoryFilters {
  q: string
  bureau: DirectoryBureau | 'all'
  rank: string
  status: DirectoryStatus | 'all'
}

export const EMPTY_DIRECTORY_FILTERS: DirectoryFilters = { q: '', bureau: 'all', rank: 'all', status: 'all' }

const matchesQuery = (m: DirectoryMember, q: string): boolean =>
  `${m.name} ${m.callsign} ${m.rankLabel} ${m.bureauLabel} ${m.assignment}`.toLowerCase().includes(q)

/** Apply the header's controls. Groups are KEPT even when they match nothing,
 *  so filtering narrows a stable shape instead of rearranging the page — and
 *  the summary keeps the division's real totals, so "0 of 12" is sayable. */
export function filterDirectory(directory: Directory, filters: DirectoryFilters): Directory {
  const q = filters.q.trim().toLowerCase()
  const groups = directory.groups.map((g) => ({
    ...g,
    members: g.members.filter((m) =>
      (!q || matchesQuery(m, q))
      && (filters.bureau === 'all' || m.bureau === filters.bureau)
      && (filters.rank === 'all' || m.rank === filters.rank)
      && (filters.status === 'all' || m.status === filters.status)),
  }))
  return {
    groups,
    summary: directory.summary,
    matches: groups.reduce((n, g) => n + g.members.length, 0),
  }
}

/** True when any control is narrowing the list — the screen says "0 of N"
 *  rather than "the division is empty". */
export const isFiltering = (f: DirectoryFilters): boolean =>
  !!f.q.trim() || f.bureau !== 'all' || f.rank !== 'all' || f.status !== 'all'
