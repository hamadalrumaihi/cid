/** The Division Directory model — who the division shows to itself.
 *
 *  The directory is the PUBLIC face of the roster: every active member may
 *  read it, which is exactly why what it computes is worth pinning. Three
 *  rules carry weight here.
 *
 *  1. MEMBER-SAFE ONLY. The model is built from the shared roster projection
 *     (lib/profiles ROSTER_COLS — no email, no login-denial reason), and it
 *     carries nothing else. Command-only material (account administration,
 *     personnel history, membership requests) belongs to Personnel Management
 *     and never travels through here.
 *  2. THE SIB BUREAU IS NOT PUBLIC. The Command Center's readiness board has
 *     always excluded `special_investigations` — its roster is compartmented.
 *     A division-wide directory that listed it would publish exactly what that
 *     board withholds, so the directory excludes it too, silently: an
 *     "N members hidden" line would be the same disclosure with extra steps.
 *  3. ORDER IS INFORMATION. Leadership first, then canonical rank order
 *     (Director highest), then name — so the shape of a bureau is readable at
 *     a glance and a rank change visibly re-sorts.
 */
import { describe, expect, it } from 'vitest'
import {
  DIRECTORY_BUREAUS, buildDirectory, directoryStatus, filterDirectory, memberAssignment,
  type DirectoryFilters,
} from './directory'
import type { RosterProfile } from './profiles'

const p = (over: Partial<RosterProfile> = {}): RosterProfile => ({
  id: 'p1', display_name: 'Zoe Adams', avatar_url: null, badge_number: 'C-11',
  division: 'major_crimes', role: 'detective', active: true,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  loa: false, loa_since: null, discord_id: null, removed_at: null,
  is_owner: false, login_denied: false, is_system: false, ...over,
})

const noFilters: DirectoryFilters = { q: '', bureau: 'all', rank: 'all', status: 'all' }
const build = (rows: RosterProfile[], awards: { recipient_id: string | null }[] = []) =>
  buildDirectory(rows, awards)
const idsIn = (rows: RosterProfile[], bureau: string) =>
  build(rows).groups.find((g) => g.bureau === bureau)?.members.map((m) => m.id) ?? []

describe('who appears at all', () => {
  it('lists active members, members on LOA, and deactivated members', () => {
    const rows = [p({ id: 'a' }), p({ id: 'b', loa: true }), p({ id: 'c', active: false })]
    expect(idsIn(rows, 'major_crimes')).toEqual(['a', 'b', 'c'])
  })

  it('never lists a removed member or the deletion tombstone', () => {
    const rows = [
      p({ id: 'a' }),
      p({ id: 'gone', removed_at: '2026-02-01T00:00:00Z' }),
      p({ id: 'tombstone', display_name: 'Deleted Member', is_system: true }),
    ]
    expect(idsIn(rows, 'major_crimes')).toEqual(['a'])
  })

  it('never lists the SIB bureau, and does not announce that it withheld anything', () => {
    const rows = [p({ id: 'a' }), p({ id: 'sib', division: 'special_investigations' })]
    const d = build(rows)
    expect(d.groups.map((g) => String(g.bureau))).not.toContain('special_investigations')
    expect(JSON.stringify(d)).not.toContain('sib')
    // The summary counts what it shows — no "hidden" line, and no SIB total.
    expect(d.summary.active).toBe(1)
    expect(Object.keys(d.summary)).not.toContain('sib')
  })

  it('groups a member with no bureau under Unassigned rather than dropping them', () => {
    expect(idsIn([p({ id: 'n', division: null })], 'unassigned')).toEqual(['n'])
  })

  it('keeps the bureau groups in a fixed order, including empty ones', () => {
    const d = build([p()])
    expect(d.groups.map((g) => g.bureau)).toEqual([...DIRECTORY_BUREAUS])
  })
})

describe('order inside a bureau', () => {
  it('puts leadership first, then rank order, then name', () => {
    const rows = [
      p({ id: 'det-z', display_name: 'Zeller', role: 'detective' }),
      p({ id: 'lead', display_name: 'Okonkwo', role: 'bureau_lead' }),
      p({ id: 'det-a', display_name: 'Abara', role: 'detective' }),
      p({ id: 'snr', display_name: 'Prasad', role: 'senior_detective' }),
      p({ id: 'dir', display_name: 'Vance', role: 'director' }),
    ]
    expect(idsIn(rows, 'major_crimes')).toEqual(['dir', 'lead', 'snr', 'det-a', 'det-z'])
  })

  it('re-sorts as soon as a rank changes — the model is recomputed, not cached', () => {
    const before = [p({ id: 'a', display_name: 'Abara' }), p({ id: 'b', display_name: 'Bell' })]
    expect(idsIn(before, 'major_crimes')).toEqual(['a', 'b'])
    const after = before.map((r) => (r.id === 'b' ? { ...r, role: 'bureau_lead' as const } : r))
    expect(idsIn(after, 'major_crimes')).toEqual(['b', 'a'])
  })

  it('counts leadership per bureau', () => {
    const d = build([p({ id: 'l', role: 'bureau_lead' }), p({ id: 'd' })])
    const mc = d.groups.find((g) => g.bureau === 'major_crimes')!
    expect(mc.total).toBe(2)
    expect(mc.leadership).toBe(1)
  })
})

describe('a transfer moves the member, it does not copy them', () => {
  it('leaves the old bureau and joins the new one in the same pass', () => {
    const before = [p({ id: 'a', division: 'major_crimes' })]
    expect(idsIn(before, 'major_crimes')).toEqual(['a'])
    const after = [p({ id: 'a', division: 'street_crimes' })]
    expect(idsIn(after, 'major_crimes')).toEqual([])
    expect(idsIn(after, 'street_crimes')).toEqual(['a'])
    // …and appears exactly once across the whole directory.
    const everywhere = build(after).groups.flatMap((g) => g.members.map((m) => m.id))
    expect(everywhere.filter((id) => id === 'a')).toHaveLength(1)
  })
})

describe('what each entry says', () => {
  it('carries the member-safe fields and nothing else', () => {
    const [m] = build([p({ badge_number: 'C-42', avatar_url: 'https://x/y.png' })])
      .groups.find((g) => g.bureau === 'major_crimes')!.members
    expect(m).toMatchObject({
      id: 'p1', name: 'Zoe Adams', callsign: 'C-42', rank: 'detective',
      rankLabel: 'Detective', bureau: 'major_crimes', bureauLabel: 'Major Crimes',
      status: 'active', avatarUrl: 'https://x/y.png', awards: 0,
    })
    // Nothing that belongs to Personnel Management rides along.
    for (const key of ['email', 'login_denied', 'discord_id', 'removed_at', 'is_owner']) {
      expect(Object.keys(m)).not.toContain(key)
    }
  })

  it('shows a callsign placeholder rather than a blank column', () => {
    const [m] = build([p({ badge_number: null })]).groups[0].members
    expect(m.callsign).toBe('—')
  })

  it('names the leadership assignment, and the bureau for everyone else', () => {
    expect(memberAssignment('director', 'major_crimes')).toBe('Director of CID')
    expect(memberAssignment('deputy_director', 'major_crimes')).toBe('Deputy Director')
    expect(memberAssignment('bureau_lead', 'street_crimes')).toBe('Street Crimes Bureau Lead')
    expect(memberAssignment('detective', 'major_crimes')).toBe('Major Crimes Bureau')
    expect(memberAssignment('detective', null)).toBe('Awaiting assignment')
  })

  it('counts a member’s commendations as their compact recognition chip', () => {
    const d = build([p({ id: 'a' }), p({ id: 'b' })], [
      { recipient_id: 'a' }, { recipient_id: 'a' }, { recipient_id: 'b' }, { recipient_id: null },
    ])
    const members = d.groups.flatMap((g) => g.members)
    expect(members.find((m) => m.id === 'a')!.awards).toBe(2)
    expect(members.find((m) => m.id === 'b')!.awards).toBe(1)
  })
})

describe('availability', () => {
  it('reads LOA first, then deactivation', () => {
    expect(directoryStatus(p())).toBe('active')
    expect(directoryStatus(p({ loa: true }))).toBe('loa')
    expect(directoryStatus(p({ active: false }))).toBe('inactive')
    // A member on LOA who is also deactivated reads as inactive: the account
    // state is the stronger fact.
    expect(directoryStatus(p({ loa: true, active: false }))).toBe('inactive')
  })

  it('summarises the division without becoming a second Command Center', () => {
    const d = build([
      p({ id: 'a' }), p({ id: 'b', loa: true }),
      p({ id: 'c', division: 'street_crimes' }), p({ id: 'd', active: false }),
    ])
    expect(d.summary).toEqual({ active: 3, majorCrimes: 2, streetCrimes: 1, onLoa: 1 })
  })
})

describe('search and filters', () => {
  const rows = [
    p({ id: 'a', display_name: 'Abara', badge_number: 'C-01', role: 'bureau_lead' }),
    p({ id: 'b', display_name: 'Bell', badge_number: 'C-02', division: 'street_crimes', loa: true }),
    p({ id: 'c', display_name: 'Cruz', badge_number: 'K-09', active: false }),
  ]
  const ids = (f: Partial<DirectoryFilters>) =>
    filterDirectory(build(rows), { ...noFilters, ...f }).groups.flatMap((g) => g.members.map((m) => m.id))

  it('matches name, callsign, rank and bureau', () => {
    expect(ids({ q: 'bell' })).toEqual(['b'])
    expect(ids({ q: 'K-09' })).toEqual(['c'])
    expect(ids({ q: 'bureau lead' })).toEqual(['a'])
    expect(ids({ q: 'street' })).toEqual(['b'])
  })

  it('filters by bureau, rank and status', () => {
    expect(ids({ bureau: 'street_crimes' })).toEqual(['b'])
    expect(ids({ rank: 'bureau_lead' })).toEqual(['a'])
    expect(ids({ status: 'loa' })).toEqual(['b'])
    expect(ids({ status: 'inactive' })).toEqual(['c'])
  })

  it('reports that a search matched nothing — distinct from an empty division', () => {
    const filtered = filterDirectory(build(rows), { ...noFilters, q: 'nobody' })
    expect(filtered.matches).toBe(0)
    expect(filtered.groups.every((g) => g.members.length === 0)).toBe(true)
    // The unfiltered totals survive, so the screen can say "0 of 3".
    expect(filtered.summary.active).toBe(2)
  })

  it('keeps a bureau group visible with zero matches so the shape stays readable', () => {
    const filtered = filterDirectory(build(rows), { ...noFilters, bureau: 'street_crimes' })
    expect(filtered.groups.map((g) => g.bureau)).toEqual([...DIRECTORY_BUREAUS])
  })
})
