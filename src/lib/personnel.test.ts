/** The Personnel Management model — what command acts on.
 *
 *  This is the other half of the roster split. The Division Directory answers
 *  "who is in the division"; Personnel Management answers "what does this
 *  member's account need from me". It is therefore NOT a second directory: it
 *  is a work list, and what it computes is the five facts a command decision
 *  turns on — identity, assignment, access, availability, and whether an
 *  action is waiting.
 *
 *  ACCESS is the one worth stating plainly, because four different states used
 *  to render as the same amber "Pending": a member awaiting approval, an
 *  external Field Intelligence submitter who applied for nothing, an account
 *  whose login was denied, and a member moved out to DOJ. Approving the second
 *  by reflex makes an outside officer a CID detective; approving the fourth
 *  re-dual-roles someone who was deliberately moved. They are separate states
 *  here and they read differently on screen.
 */
import { describe, expect, it } from 'vitest'
import {
  PERSONNEL_ACCESS_LABEL, filterPersonnel, personnelAccess, personnelRow, roleEventLine, sortPersonnel,
  type PersonnelContext, type PersonnelFilter, type RoleEventLite,
} from './personnel'
import type { RosterProfile } from './profiles'

const p = (over: Partial<RosterProfile> = {}): RosterProfile => ({
  id: 'p1', display_name: 'Dana Vance', avatar_url: null, badge_number: 'C-12',
  division: 'major_crimes', role: 'detective', active: true,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  loa: false, loa_since: null, discord_id: null, removed_at: null,
  is_owner: false, login_denied: false, is_system: false, ...over,
})

const ctx = (over: Partial<PersonnelContext> = {}): PersonnelContext => ({
  emails: {}, justiceByUser: {}, fieldOfficerIds: null, ...over,
})

describe('what state an account is in', () => {
  it('separates the four states that all used to read as "pending"', () => {
    expect(personnelAccess(p({ active: true }), ctx())).toBe('active')
    expect(personnelAccess(p({ active: false }), ctx())).toBe('awaiting_approval')
    expect(personnelAccess(p({ active: false }), ctx({ fieldOfficerIds: new Set(['p1']) }))).toBe('field_officer')
    expect(personnelAccess(p({ login_denied: true }), ctx())).toBe('denied')
    expect(personnelAccess(
      p({ active: false }),
      ctx({ justiceByUser: { p1: { agency: 'doj', justice_role: 'district_attorney' } } }),
    )).toBe('moved_to_justice')
  })

  it('reads a removal and a denial ahead of everything else', () => {
    expect(personnelAccess(p({ removed_at: '2026-02-01T00:00:00Z' }), ctx())).toBe('removed')
    // Denied beats active: the door is shut whatever the membership says.
    expect(personnelAccess(p({ active: true, login_denied: true }), ctx())).toBe('denied')
  })

  it('labels every state — no bare enum reaches the screen', () => {
    for (const state of Object.keys(PERSONNEL_ACCESS_LABEL)) {
      expect(PERSONNEL_ACCESS_LABEL[state as keyof typeof PERSONNEL_ACCESS_LABEL]).toBeTruthy()
    }
  })
})

describe('one row per member — the five facts a decision turns on', () => {
  it('carries identity, assignment, access, availability and what is waiting', () => {
    const row = personnelRow(p({ loa: true }), ctx({ emails: { p1: 'vance@cid.test' } }))
    expect(row).toMatchObject({
      id: 'p1',
      name: 'Dana Vance',
      email: 'vance@cid.test',
      callsign: 'C-12',
      rankLabel: 'Detective',
      bureauLabel: 'Major Crimes Bureau',
      access: 'active',
      accessLabel: 'Active',
      onLoa: true,
      needsDecision: false,
    })
  })

  it('flags the member who is actually waiting on command', () => {
    expect(personnelRow(p({ active: false }), ctx()).needsDecision).toBe(true)
    // …and not the external submitter, who applied for nothing.
    expect(personnelRow(p({ active: false }), ctx({ fieldOfficerIds: new Set(['p1']) })).needsDecision).toBe(false)
    // …nor the member deliberately moved out of CID.
    expect(personnelRow(
      p({ active: false }),
      ctx({ justiceByUser: { p1: { agency: 'doj', justice_role: 'judge' } } }),
    ).needsDecision).toBe(false)
    // …nor a denied account: that decision is already recorded.
    expect(personnelRow(p({ login_denied: true, active: false }), ctx()).needsDecision).toBe(false)
  })

  it('says the email is unknown rather than printing an empty column', () => {
    expect(personnelRow(p(), ctx()).email).toBeNull()
  })
})

describe('the work list', () => {
  const people = [
    p({ id: 'a', display_name: 'Abara', active: false }),
    p({ id: 'b', display_name: 'Bell', badge_number: 'K-09', division: 'street_crimes' }),
    p({ id: 'c', display_name: 'Cruz', loa: true, role: 'bureau_lead' }),
    p({ id: 'd', display_name: 'Diaz', login_denied: true }),
    p({ id: 'e', display_name: 'Ellis', removed_at: '2026-03-01T00:00:00Z' }),
  ]
  const rows = people.map((x) => personnelRow(x, ctx({ emails: { b: 'bell@cid.test' } })))
  const ids = (f: Partial<PersonnelFilter>) =>
    filterPersonnel(rows, { q: '', access: 'all', ...f }).map((r) => r.id)

  it('puts what needs a decision at the top, then LOA, then name', () => {
    expect(sortPersonnel(rows).map((r) => r.id)).toEqual(['a', 'c', 'b', 'd', 'e'])
  })

  it('searches identity, assignment and email — command looks people up by any of them', () => {
    expect(ids({ q: 'bell' })).toEqual(['b'])
    expect(ids({ q: 'K-09' })).toEqual(['b'])
    expect(ids({ q: 'bell@cid.test' })).toEqual(['b'])
    expect(ids({ q: 'street' })).toEqual(['b'])
    expect(ids({ q: 'bureau lead' })).toEqual(['c'])
  })

  it('filters to one account state', () => {
    expect(ids({ access: 'awaiting_approval' })).toEqual(['a'])
    expect(ids({ access: 'denied' })).toEqual(['d'])
    expect(ids({ access: 'removed' })).toEqual(['e'])
  })

  it('has a filter for the only queue that is really a queue', () => {
    expect(ids({ access: 'needs_decision' })).toEqual(['a'])
  })

  it('never lists the deletion tombstone', () => {
    const withSystem = [...people, p({ id: 'sys', display_name: 'Deleted Member', is_system: true })]
    const built = withSystem.map((x) => personnelRow(x, ctx()))
    expect(filterPersonnel(built, { q: '', access: 'all' }).map((r) => r.id)).not.toContain('sys')
  })
})

describe('personnel history — one quiet line per recorded event', () => {
  const ev = (over: Partial<RoleEventLite> = {}): RoleEventLite => ({
    source: null, old_role: null, new_role: null, old_division: null,
    new_division: null, old_active: null, new_active: null, reason: null, ...over,
  })

  it('says what actually changed, in the division’s own words', () => {
    expect(roleEventLine(ev({ source: 'role_change', old_role: 'detective', new_role: 'senior_detective' })))
      .toBe('Role change · Detective → Senior Detective')
    expect(roleEventLine(ev({ source: 'transfer', old_division: 'major_crimes', new_division: 'street_crimes' })))
      .toBe('Transfer · Major Crimes → Street Crimes')
    expect(roleEventLine(ev({ source: 'activation', old_active: false, new_active: true })))
      .toBe('Status change · activated')
    expect(roleEventLine(ev({ old_active: true, new_active: false }))).toBe('deactivated')
    expect(roleEventLine(ev({ source: 'membership_approval', old_active: false, new_active: true })))
      .toBe('Membership approved · activated')
  })

  it('never claims a change that did not happen', () => {
    expect(roleEventLine(ev({ old_role: 'detective', new_role: 'detective' }))).toBe('Assignment updated')
    expect(roleEventLine(ev({ old_active: true, new_active: true }))).toBe('Assignment updated')
  })

  it('combines a role and a bureau move recorded together', () => {
    expect(roleEventLine(ev({
      old_role: 'detective', new_role: 'bureau_lead',
      old_division: 'major_crimes', new_division: 'street_crimes',
    }))).toBe('Detective → Bureau Lead · Major Crimes → Street Crimes')
  })
})
