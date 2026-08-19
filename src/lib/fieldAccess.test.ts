/** Unit tests for Field Intelligence access.
 *
 *  Access is no longer requested: field_access_self_serve() creates the
 *  standing immediately, and the rules are in the database and were probed
 *  live — it refuses an active CID account, a second attempt, a removed account
 *  and above all a login-denied one, and the officer cannot afterwards edit the
 *  agency, callsign or rank that every submission snapshots.
 *  20260920120000_field_access_class.sql records those results, and the
 *  historical queue's rules are in
 *  20260916120000_field_access_and_jurisdiction.sql. Pinned here: the client's
 *  arithmetic and wording.
 */

import { describe, expect, it } from 'vitest'
import {
  FIELD_AGENCIES, REQUEST_STATUS_LABEL, ROSTER_STATUS_LABEL, requestLabel,
  requestProblem, rosterIdentity, rosterMatches, rosterOrigin, rosterStatus,
} from './fieldAccess'
import type { FieldRosterRow } from './fieldAccess'
import type { FieldAccessRequestRow } from './fieldAccess'
import { countPending, pendingFirst } from '@/components/field/FieldAccessQueue'
import {
  JURISDICTIONS, jurisdictionLabel, jurisdictionRouting,
} from './fieldSubmissions'

const req = (over: Partial<FieldAccessRequestRow> = {}): FieldAccessRequestRow => ({
  id: 'r1', user_id: 'u1', agency: 'SAHP', callsign: '924',
  officer_rank: 'Senior Trooper', unit: null, status: 'pending',
  decided_by: null, decided_at: null, decision_reason: null,
  created_at: '2026-08-19T00:00:00Z', updated_at: '2026-08-19T00:00:00Z',
  ...over,
})

describe('what the identity form needs before access can be created', () => {
  it('needs an agency, because the appointment is made in one', () => {
    expect(requestProblem('')).toMatch(/agency/)
    expect(requestProblem('FIB')).toMatch(/agency/)
  })

  it('accepts every agency Field Intelligence serves', () => {
    for (const a of FIELD_AGENCIES) expect(requestProblem(a), a).toBeNull()
  })

  it('does not demand a callsign or rank', () => {
    // The reviewer can see who the account is and fills these in on approval;
    // demanding them up front turns a reporting channel into a form.
    expect(requestProblem('SAHP')).toBeNull()
  })
})

describe('how an applicant reads in the queue', () => {
  it('joins only the parts that were given', () => {
    expect(requestLabel(req())).toBe('924 · SAHP · Senior Trooper')
    expect(requestLabel(req({ callsign: null, officer_rank: null, unit: null })))
      .toBe('SAHP')
  })

  it('has plain wording for every status the database allows', () => {
    for (const s of ['pending', 'approved', 'denied', 'withdrawn']) {
      expect(REQUEST_STATUS_LABEL[s], s).toBeTruthy()
    }
  })
})

describe('the queue order', () => {
  it('puts people who are still waiting first', () => {
    // A decided request is history; an undecided one is somebody who cannot
    // reach CID at all until it is answered.
    const rows = [
      req({ id: 'a', status: 'approved', created_at: '2026-08-19T05:00:00Z' }),
      req({ id: 'b', status: 'pending', created_at: '2026-08-19T01:00:00Z' }),
      req({ id: 'c', status: 'pending', created_at: '2026-08-19T03:00:00Z' }),
    ]
    expect(pendingFirst(rows).map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })

  it('never mutates the array it was given', () => {
    const rows = [req({ id: 'a', status: 'approved' }), req({ id: 'b' })]
    pendingFirst(rows)
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('counts only the ones waiting', () => {
    expect(countPending([req(), req({ status: 'denied' }), req({ status: 'pending' })])).toBe(2)
    expect(countPending([])).toBe(0)
  })
})

describe('where a report happened, and where that sends it', () => {
  it('names a bureau for every jurisdiction', () => {
    // A detective seeing "Los Santos / City" alone cannot tell whether the
    // report reached them because it is theirs.
    for (const j of JURISDICTIONS) {
      expect(jurisdictionRouting(j), j).toMatch(/ · (LSB|BCB)$/)
    }
  })

  it('says so plainly when the jurisdiction is missing', () => {
    // Only a draft can be in this state — a check constraint refuses a
    // submitted report without one.
    expect(jurisdictionLabel(null)).toBe('Not stated')
    expect(jurisdictionRouting(null)).toBe('Not stated')
  })
})

describe('the historical queue', () => {
  it('still reads correctly for rows filed before access became immediate', () => {
    // The table is kept: a filed request is a record, and a pending one can
    // still be answered. Nothing files a new one.
    expect(REQUEST_STATUS_LABEL.withdrawn).toBeTruthy()
    expect(pendingFirst([req({ status: 'withdrawn' }), req()])[0].status).toBe('pending')
  })
})

const rosterRow = (over: Partial<FieldRosterRow> = {}): FieldRosterRow => ({
  user_id: 'u1', display_name: 'Tom Wood', email: null,
  agency: 'BCSO', callsign: '412', officer_rank: 'Deputy', unit: 'Patrol',
  standing_active: true, self_served: true, appointed_by: null,
  appointed_at: '2026-08-19T00:00:00Z', ended_at: null, end_reason: null,
  removed_at: null, login_denied: false,
  first_seen: '2026-08-01T00:00:00Z', last_seen: null,
  submissions: 3, last_submission_at: '2026-08-19T00:00:00Z',
  ...over,
})

describe('the access roster', () => {
  it('reports the worst news first', () => {
    // A denied or removed account is not "active" just because the appointment
    // row still says true — the login is what they hit first, and the roster
    // should not tell a supervisor somebody has access when they cannot sign in.
    expect(rosterStatus(rosterRow())).toBe('active')
    expect(rosterStatus(rosterRow({ standing_active: false }))).toBe('former')
    expect(rosterStatus(rosterRow({ removed_at: '2026-08-19T00:00:00Z' }))).toBe('removed')
    expect(rosterStatus(rosterRow({ login_denied: true }))).toBe('denied')
    expect(rosterStatus(rosterRow({ login_denied: true, standing_active: true })))
      .toBe('denied')
  })

  it('labels every status', () => {
    for (const s of ['active', 'removed', 'denied', 'former'] as const) {
      expect(ROSTER_STATUS_LABEL[s], s).toBeTruthy()
    }
  })

  it('says how the access came about rather than leaving a blank', () => {
    // A blank would read as missing data; the fact is that nobody had to
    // approve it.
    expect(rosterOrigin(rosterRow())).toBe('Self-registered')
    expect(rosterOrigin(rosterRow({ self_served: false }))).toBe('Appointed by command')
  })

  it('joins only the identity parts that were given', () => {
    expect(rosterIdentity(rosterRow())).toBe('412 · BCSO · Deputy · Patrol')
    expect(rosterIdentity(rosterRow({ callsign: null, officer_rank: null, unit: null })))
      .toBe('BCSO')
  })

  it('searches the things somebody would actually type', () => {
    const r = rosterRow()
    expect(rosterMatches(r, '')).toBe(true)
    expect(rosterMatches(r, '412')).toBe(true)
    expect(rosterMatches(r, 'bcso')).toBe(true)
    expect(rosterMatches(r, 'wood')).toBe(true)
    expect(rosterMatches(r, 'lspd')).toBe(false)
  })
})
