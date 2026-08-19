/** Unit tests for asking for Field Intelligence access.
 *
 *  The rules are in the database and were probed live — the BEFORE INSERT
 *  trigger overwrites user_id with the caller, refuses an account that already
 *  has portal access, and a unique index allows one pending request per person;
 *  field_access_decide() refuses anybody who is not command and refuses a
 *  decline with no reason. 20260916120000_field_access_and_jurisdiction.sql
 *  records those results. What is pinned here is the client's arithmetic and
 *  wording.
 */

import { describe, expect, it } from 'vitest'
import { FIELD_AGENCIES, requestLabel, requestProblem, REQUEST_STATUS_LABEL } from './fieldAccess'
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

describe('what a request needs before it can be filed', () => {
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
