import { describe, expect, it } from 'vitest'
import { pendingMembership, type ProfileLite, type RequestLite } from './membershipPending'

const profile = (over: Partial<ProfileLite> & { id: string }): ProfileLite => ({
  display_name: 'Applicant', active: false, removed_at: null, is_system: false, ...over,
})

const request = (over: Partial<RequestLite> & { id: string; applicant_id: string }): RequestLite => ({
  display_name: 'Applicant', status: 'pending', requested_bureau: 'LSB',
  requested_role: 'detective', submitted_at: '2026-07-10T12:00:00Z',
  updated_at: '2026-07-10T12:00:00Z', ...over,
})

const NO_JUSTICE: Record<string, unknown> = {}

describe('null requests (not loaded / not authorized)', () => {
  it('derives sign-ins from profiles alone and flags requestsLoaded=false', () => {
    const pm = pendingMembership([profile({ id: 'a' }), profile({ id: 'b' })], null, NO_JUSTICE)
    expect(pm.requestsLoaded).toBe(false)
    expect(pm.submitted).toEqual([])
    expect(pm.corrections).toEqual([])
    expect(pm.ghosts).toEqual([])
    expect(pm.signIns.map((s) => s.profile.id)).toEqual(['a', 'b'])
    expect(pm.signIns.every((s) => s.actionable && s.requestStatus === null && s.request === null)).toBe(true)
    expect(pm.awaitingCount).toBe(2)
  })

  it('still excludes active, removed, system and justice-moved profiles', () => {
    const pm = pendingMembership([
      profile({ id: 'active', active: true }),
      profile({ id: 'removed', removed_at: '2026-07-01T00:00:00Z' }),
      profile({ id: 'system', is_system: true }),
      profile({ id: 'justice' }),
      profile({ id: 'real' }),
    ], null, { justice: { agency: 'doj' } })
    expect(pm.signIns.map((s) => s.profile.id)).toEqual(['real'])
    expect(pm.awaitingCount).toBe(1)
  })
})

describe('submitted', () => {
  it('an inactive applicant with a pending request lands in submitted, not signIns', () => {
    const pm = pendingMembership(
      [profile({ id: 'a' })],
      [request({ id: 'r1', applicant_id: 'a' })],
      NO_JUSTICE,
    )
    expect(pm.submitted.map((x) => x.request.id)).toEqual(['r1'])
    expect(pm.signIns).toEqual([])
    expect(pm.requestsLoaded).toBe(true)
    expect(pm.awaitingCount).toBe(1)
  })
})

describe('corrections', () => {
  it('correction_requested with an inactive applicant waits on the applicant — not counted', () => {
    const pm = pendingMembership(
      [profile({ id: 'a' })],
      [request({ id: 'r1', applicant_id: 'a', status: 'correction_requested' })],
      NO_JUSTICE,
    )
    expect(pm.corrections.map((r) => r.id)).toEqual(['r1'])
    expect(pm.submitted).toEqual([])
    expect(pm.signIns).toEqual([]) // the request flow is live — no quick approve
    expect(pm.awaitingCount).toBe(0)
  })
})

describe('signIns annotation', () => {
  it('no request at all → requestStatus null, actionable', () => {
    const pm = pendingMembership([profile({ id: 'a' })], [], NO_JUSTICE)
    expect(pm.signIns).toEqual([{ profile: profile({ id: 'a' }), requestStatus: null, request: null, actionable: true }])
    expect(pm.awaitingCount).toBe(1)
  })

  it('a rejected request annotates the sign-in and blocks the quick approve', () => {
    const r = request({ id: 'r1', applicant_id: 'a', status: 'rejected' })
    const pm = pendingMembership([profile({ id: 'a' })], [r], NO_JUSTICE)
    expect(pm.signIns).toEqual([{ profile: profile({ id: 'a' }), requestStatus: 'rejected', request: r, actionable: false }])
    expect(pm.awaitingCount).toBe(0) // already decided — not awaiting review
  })

  it('a withdrawn request likewise blocks; drafts stay actionable', () => {
    const pm = pendingMembership(
      [profile({ id: 'w' }), profile({ id: 'd' })],
      [
        request({ id: 'r1', applicant_id: 'w', status: 'withdrawn' }),
        request({ id: 'r2', applicant_id: 'd', status: 'draft' }),
      ],
      NO_JUSTICE,
    )
    const byId = new Map(pm.signIns.map((s) => [s.profile.id, s]))
    expect(byId.get('w')).toMatchObject({ requestStatus: 'withdrawn', actionable: false })
    expect(byId.get('d')).toMatchObject({ requestStatus: 'draft', actionable: true })
    expect(pm.awaitingCount).toBe(1)
  })
})

describe('ghosts — the Osborne case', () => {
  it('a pending request whose applicant is already ACTIVE is a ghost, not submitted', () => {
    const r = request({ id: 'r1', applicant_id: 'osborne', display_name: 'William Osborne' })
    const pm = pendingMembership([profile({ id: 'osborne', active: true })], [r], NO_JUSTICE)
    expect(pm.ghosts).toEqual([r])
    expect(pm.submitted).toEqual([])
    expect(pm.signIns).toEqual([])
    expect(pm.awaitingCount).toBe(1) // needs human reconciliation
  })

  it('correction_requested for an active applicant is a ghost, not a correction', () => {
    const r = request({ id: 'r1', applicant_id: 'a', status: 'correction_requested' })
    const pm = pendingMembership([profile({ id: 'a', active: true })], [r], NO_JUSTICE)
    expect(pm.ghosts).toEqual([r])
    expect(pm.corrections).toEqual([])
  })

  it('open requests without a viable applicant (unknown / removed / system) are dropped', () => {
    const pm = pendingMembership(
      [
        profile({ id: 'removed', removed_at: '2026-07-01T00:00:00Z' }),
        profile({ id: 'system', is_system: true, active: true }),
      ],
      [
        request({ id: 'r1', applicant_id: 'nobody' }),
        request({ id: 'r2', applicant_id: 'removed' }),
        request({ id: 'r3', applicant_id: 'system' }),
      ],
      NO_JUSTICE,
    )
    expect(pm.ghosts).toEqual([])
    expect(pm.submitted).toEqual([])
    expect(pm.awaitingCount).toBe(0)
  })
})

describe('exclusions with requests loaded', () => {
  it('a justice-moved inactive member never surfaces — even with a pending request row it is not a sign-in', () => {
    const pm = pendingMembership(
      [profile({ id: 'moved' })],
      [request({ id: 'r1', applicant_id: 'moved', status: 'rejected' })],
      { moved: { agency: 'doj' } },
    )
    expect(pm.signIns).toEqual([])
    expect(pm.submitted).toEqual([])
    expect(pm.awaitingCount).toBe(0)
  })

  it('is_system profiles are excluded from every bucket', () => {
    const pm = pendingMembership(
      [profile({ id: 'sys', is_system: true })],
      [request({ id: 'r1', applicant_id: 'sys' })],
      NO_JUSTICE,
    )
    expect(pm.submitted).toEqual([])
    expect(pm.signIns).toEqual([])
    expect(pm.ghosts).toEqual([])
    expect(pm.awaitingCount).toBe(0)
  })
})

describe('request precedence per applicant', () => {
  it('an OPEN request wins over a newer terminal one; among terminals the latest wins', () => {
    const open = request({ id: 'r-open', applicant_id: 'a', updated_at: '2026-07-01T00:00:00Z' })
    const rejectedNewer = request({ id: 'r-rej', applicant_id: 'a', status: 'rejected', updated_at: '2026-07-12T00:00:00Z' })
    const withOpen = pendingMembership([profile({ id: 'a' })], [rejectedNewer, open], NO_JUSTICE)
    expect(withOpen.submitted.map((x) => x.request.id)).toEqual(['r-open'])

    const older = request({ id: 'r-old', applicant_id: 'b', status: 'withdrawn', updated_at: '2026-06-01T00:00:00Z' })
    const newer = request({ id: 'r-new', applicant_id: 'b', status: 'rejected', updated_at: '2026-07-01T00:00:00Z' })
    const terminals = pendingMembership([profile({ id: 'b' })], [older, newer], NO_JUSTICE)
    expect(terminals.signIns[0]).toMatchObject({ requestStatus: 'rejected', actionable: false })
  })
})

describe('awaitingCount — the audited live scenario', () => {
  // Two real applicants with no request rows + Osborne (ACTIVE, pending
  // request). Old surfaces disagreed (AC: 1, badge/tile: 2, queue: 0) — the
  // shared number is 3 with requests loaded and 2 profiles-only.
  const profiles = [
    profile({ id: 'p1', display_name: 'Applicant One' }),
    profile({ id: 'p2', display_name: 'Applicant Two' }),
    profile({ id: 'osborne', display_name: 'William Osborne', active: true }),
  ]
  const requests = [request({ id: 'r-ghost', applicant_id: 'osborne', display_name: 'William Osborne' })]

  it('with requests loaded: 2 sign-ins + 0 submitted + 1 ghost = 3', () => {
    const pm = pendingMembership(profiles, requests, NO_JUSTICE)
    expect(pm.signIns).toHaveLength(2)
    expect(pm.submitted).toHaveLength(0)
    expect(pm.ghosts).toHaveLength(1)
    expect(pm.awaitingCount).toBe(3)
  })

  it('profiles-only (nav badge): the 2 inactive applicants, ghosts unknowable', () => {
    const pm = pendingMembership(profiles, null, NO_JUSTICE)
    expect(pm.awaitingCount).toBe(2)
    expect(pm.requestsLoaded).toBe(false)
  })

  it('formula: submitted + actionable signIns + ghosts (rejected sign-ins excluded)', () => {
    const pm = pendingMembership(
      [...profiles, profile({ id: 'rej' }), profile({ id: 'sub' })],
      [
        ...requests,
        request({ id: 'r-rej', applicant_id: 'rej', status: 'rejected' }),
        request({ id: 'r-sub', applicant_id: 'sub' }),
      ],
      NO_JUSTICE,
    )
    expect(pm.submitted).toHaveLength(1)
    expect(pm.signIns.filter((s) => s.actionable)).toHaveLength(2)
    expect(pm.signIns.filter((s) => !s.actionable)).toHaveLength(1)
    expect(pm.ghosts).toHaveLength(1)
    expect(pm.awaitingCount).toBe(4)
  })
})
