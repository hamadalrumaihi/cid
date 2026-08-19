/** Unit tests for the field-officer client mirror.
 *
 *  Everything that matters about this feature is enforced in the database, and
 *  is tested there — 20260910120000_field_officers.sql records a live probe of
 *  37 tables as an appointed officer. What is pinned here is the small amount
 *  of client judgement that sits in front of it: which accounts are offered for
 *  appointment, and how an appointment is described.
 *
 *  These are UX guards. None of them is a security boundary, and a test here
 *  passing says nothing about whether RLS holds.
 */

import { describe, expect, it } from 'vitest'
import {
  FIELD_AGENCIES, FIELD_AGENCY_NAME, appointmentProblem, fieldOfficerLabel,
} from './fieldOfficers'
import type { FieldOfficerRow } from './fieldOfficers'

const row = (over: Partial<FieldOfficerRow> = {}): FieldOfficerRow => ({
  id: 'f1', user_id: 'u1', agency: 'SAHP', callsign: '924',
  officer_rank: 'Senior Trooper', unit: null, active: true,
  appointed_by: null, appointed_at: '2026-08-19T00:00:00Z',
  ended_by: null, ended_at: null, end_reason: null,
  created_at: '2026-08-19T00:00:00Z', updated_at: '2026-08-19T00:00:00Z',
  ...over,
})

describe('agencies', () => {
  it('names every agency the check constraint allows', () => {
    // If the constraint gains an agency and this map does not, the portal
    // renders a bare code where a force name belongs.
    for (const a of FIELD_AGENCIES) expect(FIELD_AGENCY_NAME[a]).toBeTruthy()
    expect(FIELD_AGENCIES).toEqual(['SAHP', 'BCSO', 'LSPD'])
  })
})

describe('appointment guards', () => {
  const inactive = [{ id: 'u1', active: false }]

  it('accepts an account that has signed in and holds no CID standing', () => {
    expect(appointmentProblem('u1', 'SAHP', inactive)).toBeNull()
  })

  it('refuses an account that does not exist yet', () => {
    // handle_new_user() creates the profile on first sign-in, so a missing row
    // means the officer has never logged in -- appointing would fail in the RPC.
    expect(appointmentProblem('nobody', 'SAHP', inactive))
      .toMatch(/has not signed in/)
  })

  it('refuses an unknown agency rather than letting the constraint catch it', () => {
    expect(appointmentProblem('u1', 'FIB', inactive)).toMatch(/Choose an agency/)
    expect(appointmentProblem('u1', '', inactive)).toMatch(/Choose an agency/)
  })

  it('requires an account to be chosen', () => {
    expect(appointmentProblem('', 'SAHP', inactive)).toMatch(/Choose the account/)
  })

  it('warns that appointing an active CID member achieves nothing', () => {
    // CID wins at the gate, so such an account would get the investigative
    // portal either way. This is almost always the wrong account picked, not a
    // deliberate dual identity -- and saying so beats a silent no-op.
    const problem = appointmentProblem('u2', 'SAHP', [{ id: 'u2', active: true }])
    expect(problem).toMatch(/active CID account/)
  })
})

describe('describing an appointment', () => {
  it('joins only the parts that are known', () => {
    expect(fieldOfficerLabel(row())).toBe('924 · SAHP · Senior Trooper')
    expect(fieldOfficerLabel(row({ callsign: null, officer_rank: null }))).toBe('SAHP')
    expect(fieldOfficerLabel(row({ unit: 'Highway Patrol' })))
      .toBe('924 · SAHP · Senior Trooper · Highway Patrol')
  })

  it('never renders a bare separator for a sparse appointment', () => {
    // Only the agency is NOT NULL, so every other field can legitimately be
    // absent; the label must not come out as " ·  · ".
    const label = fieldOfficerLabel(row({ callsign: null, officer_rank: null, unit: null }))
    expect(label).not.toMatch(/·/)
    expect(label).toBe('SAHP')
  })
})
