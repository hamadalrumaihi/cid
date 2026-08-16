/** SIU authority model — the client mirror of `private.siu_standing()` and
 *  `private.siu_case_access()` (migration 20260820120000_siu_phase1).
 *
 *  These are UX gates, so what they must prove is that the mirror does not
 *  DRIFT from the server: the same four standings, the same asymmetry
 *  (SIU → CID read, CID → SIU nothing), the same appointment matrix, and the
 *  same "no role is above investigation" property on a compartment. The live
 *  wall itself is asserted against the real database in tests/rls/v166.test.ts.
 */

import { describe, expect, it } from 'vitest'
import type { Profile } from './auth'
import { ROLE_ORDER } from './roles'
import {
  siuAssignableClassifications, siuCanAppoint, siuCanAppointRole, siuCanReadCid,
  siuCanRemove, siuCaseAccess, siuIsAgent, siuIsCommand, siuOperates, siuStanding,
  siuAuditLabel, siuCallsign, siuClassificationLabel, siuRoleLabel,
  type SiuContext, type SiuMembership,
} from './siu'

const profile = (over: Partial<Profile> = {}): Profile => ({
  id: 'u1', display_name: 'Officer', avatar_url: null, badge_number: '101',
  division: 'SAB', role: 'detective', active: true,
  created_at: '2026-01-01', updated_at: '2026-01-01',
  loa: false, loa_since: null, discord_id: null, is_owner: false,
  login_denied: false, login_denied_reason: null,
  ...over,
})

const member = (over: Partial<SiuMembership> = {}): SiuMembership => ({
  user_id: 'u1', siu_role: 'special_agent', callsign: 'X-2',
  oversight_only: false, active: true, ...over,
})

/** Production model = release gate open. */
const live = (over: Partial<SiuContext> = {}): SiuContext =>
  ({ profile: profile(), release: true, ...over })

describe('siuStanding — the single authority resolver', () => {
  it('is null for an ordinary detective, at every CID rank', () => {
    for (const role of ROLE_ORDER) {
      expect(siuStanding(live({ profile: profile({ role }) }))).toBeNull()
    }
  })

  it('never derives SIU standing from a CID role — a Director is not SIU', () => {
    const director = live({ profile: profile({ role: 'director' }) })
    expect(siuOperates(director)).toBe(false)
    expect(siuCanReadCid(director)).toBe(false)
    expect(siuCanAppoint(director)).toBe(false)
  })

  it('resolves the appointed SIU role', () => {
    expect(siuStanding(live({ membership: member() }))).toBe('special_agent')
    expect(siuStanding(live({ membership: member({ siu_role: 'special_agent_in_charge', callsign: 'X-1' }) })))
      .toBe('special_agent_in_charge')
  })

  it('treats an oversight-only appointee and the Attorney General as oversight', () => {
    expect(siuStanding(live({ membership: member({ oversight_only: true }) }))).toBe('oversight')
    expect(siuStanding(live({ justiceRole: 'attorney_general' }))).toBe('oversight')
  })

  it('ignores an ended membership and an inactive profile', () => {
    expect(siuStanding(live({ membership: member({ active: false }) }))).toBeNull()
    expect(siuStanding(live({ profile: profile({ active: false }), membership: member() }))).toBeNull()
  })
})

describe('the build-phase release gate', () => {
  const closed = (over: Partial<SiuContext> = {}): SiuContext =>
    ({ profile: profile(), release: false, ...over })

  it('gives the Portal Owner standing regardless of the gate', () => {
    expect(siuStanding(closed({ profile: profile({ is_owner: true }) }))).toBe('owner')
    expect(siuStanding(live({ profile: profile({ is_owner: true }) }))).toBe('owner')
  })

  it('hides SIU from EVERY non-owner account while the gate is closed', () => {
    const blocked: SiuContext[] = [
      closed({ membership: member() }),                                            // Special Agent
      closed({ membership: member({ siu_role: 'special_agent_in_charge' }) }),      // X-Ray 1
      closed({ membership: member({ oversight_only: true }) }),                     // oversight appointee
      closed({ justiceRole: 'attorney_general' }),                                  // Attorney General
      closed({ profile: profile({ role: 'director' }) }),                           // CID Director
      closed({ profile: profile({ role: 'deputy_director' }) }),
      closed({ profile: profile({ role: 'bureau_lead' }) }),
      closed({ justiceRole: 'prosecutor' }),
      closed({ justiceRole: 'judge' }),
    ]
    for (const ctx of blocked) {
      expect(siuStanding(ctx)).toBeNull()
      expect(siuOperates(ctx)).toBe(false)
      expect(siuCanAppoint(ctx)).toBe(false)
      expect(siuCanReadCid(ctx)).toBe(false)
      expect(siuAssignableClassifications(ctx)).toEqual([])
    }
  })

  it('turns the production model on with the flag alone — nothing else changes', () => {
    const agent = member({ siu_role: 'special_agent_in_charge' })
    expect(siuStanding({ profile: profile(), membership: agent, release: false })).toBeNull()
    expect(siuStanding({ profile: profile(), membership: agent, release: true })).toBe('special_agent_in_charge')
  })
})

describe('field standing vs oversight', () => {
  it('gives broad CID read to field agents only', () => {
    expect(siuCanReadCid(live({ membership: member() }))).toBe(true)
    expect(siuCanReadCid(live({ membership: member({ siu_role: 'special_agent_in_charge' }) }))).toBe(true)
    expect(siuCanReadCid(live({ profile: profile({ is_owner: true }) }))).toBe(true)
    // Legal oversight is not a licence to read every CID investigation.
    expect(siuCanReadCid(live({ justiceRole: 'attorney_general' }))).toBe(false)
    expect(siuCanReadCid(live({ membership: member({ oversight_only: true }) }))).toBe(false)
  })

  it('keeps the Attorney General out of field authority but inside appointment authority', () => {
    const ag = live({ justiceRole: 'attorney_general' })
    expect(siuCanAppoint(ag)).toBe(true)
    expect(siuIsAgent(ag)).toBe(false)
    expect(siuIsCommand(ag)).toBe(false)
    expect(siuAssignableClassifications(ag)).toEqual([])
  })
})

describe('appointment authority', () => {
  it('admits exactly the Owner, X-Ray 1 and the Attorney General', () => {
    expect(siuCanAppoint(live({ profile: profile({ is_owner: true }) }))).toBe(true)
    expect(siuCanAppoint(live({ membership: member({ siu_role: 'special_agent_in_charge' }) }))).toBe(true)
    expect(siuCanAppoint(live({ justiceRole: 'attorney_general' }))).toBe(true)
    // Everyone else, including a Special Agent and all of CID command.
    expect(siuCanAppoint(live({ membership: member() }))).toBe(false)
    expect(siuCanAppoint(live({ profile: profile({ role: 'director' }) }))).toBe(false)
    expect(siuCanAppoint(live({ justiceRole: 'prosecutor' }))).toBe(false)
    expect(siuCanAppoint(live({ justiceRole: 'judge' }))).toBe(false)
  })

  it('reserves the X-Ray 1 appointment for the Owner', () => {
    const x1 = live({ membership: member({ siu_role: 'special_agent_in_charge' }) })
    const ag = live({ justiceRole: 'attorney_general' })
    const owner = live({ profile: profile({ is_owner: true }) })
    expect(siuCanAppointRole(x1, 'special_agent')).toBe(true)
    expect(siuCanAppointRole(x1, 'special_agent_in_charge')).toBe(false)
    expect(siuCanAppointRole(ag, 'special_agent_in_charge')).toBe(false)
    expect(siuCanAppointRole(owner, 'special_agent_in_charge')).toBe(true)
  })

  it('lets X-1 remove an agent but not a peer X-1, and never themselves', () => {
    const x1 = live({ profile: profile({ id: 'x1' }), membership: member({ user_id: 'x1', siu_role: 'special_agent_in_charge' }) })
    expect(siuCanRemove(x1, member({ user_id: 'u9' }))).toBe(true)
    expect(siuCanRemove(x1, member({ user_id: 'u9', siu_role: 'special_agent_in_charge' }))).toBe(false)
    expect(siuCanRemove(x1, member({ user_id: 'x1', siu_role: 'special_agent_in_charge' }))).toBe(false)
  })

  it('lets the Owner and the Attorney General end an X-Ray 1', () => {
    const owner = live({ profile: profile({ id: 'o1', is_owner: true }) })
    const ag = live({ profile: profile({ id: 'ag' }), justiceRole: 'attorney_general' })
    const target = member({ user_id: 'x1', siu_role: 'special_agent_in_charge' })
    expect(siuCanRemove(owner, target)).toBe(true)
    expect(siuCanRemove(ag, target)).toBe(true)
  })

  it('never removes an already-inactive membership', () => {
    const owner = live({ profile: profile({ id: 'o1', is_owner: true }) })
    expect(siuCanRemove(owner, member({ user_id: 'u9', active: false }))).toBe(false)
  })
})

describe('siuCaseAccess — classification levels', () => {
  const owner = live({ profile: profile({ is_owner: true }) })
  const x1 = live({ membership: member({ siu_role: 'special_agent_in_charge' }) })
  const agent = live({ membership: member() })
  const ag = live({ justiceRole: 'attorney_general' })
  const detective = live({ profile: profile({ role: 'detective' }) })
  const director = live({ profile: profile({ role: 'director' }) })

  it('opens a plain SIU case to any field agent and to nobody else', () => {
    const c = { siu_classification: 'siu' }
    expect(siuCaseAccess(owner, c)).toBe(true)
    expect(siuCaseAccess(x1, c)).toBe(true)
    expect(siuCaseAccess(agent, c)).toBe(true)
    expect(siuCaseAccess(ag, c)).toBe(false)
    expect(siuCaseAccess(detective, c)).toBe(false)
    expect(siuCaseAccess(director, c)).toBe(false)
  })

  it('limits siu_restricted to assigned agents, command, or an allow-list row', () => {
    const c = { siu_classification: 'siu_restricted' }
    expect(siuCaseAccess(agent, c)).toBe(false)
    expect(siuCaseAccess(agent, c, { assigned: true })).toBe(true)
    expect(siuCaseAccess(agent, c, { inCompartment: true })).toBe(true)
    expect(siuCaseAccess(x1, c)).toBe(true)
  })

  it('limits siu_command to SIU command, not to a Special Agent', () => {
    const c = { siu_classification: 'siu_command' }
    expect(siuCaseAccess(x1, c)).toBe(true)
    expect(siuCaseAccess(owner, c)).toBe(true)
    expect(siuCaseAccess(agent, c)).toBe(false)
    expect(siuCaseAccess(agent, c, { assigned: true })).toBe(false)
    expect(siuCaseAccess(agent, c, { inCompartment: true })).toBe(true)
  })

  it('treats a missing classification as the base SIU level', () => {
    expect(siuCaseAccess(agent, {})).toBe(true)
    expect(siuCaseAccess(agent, { siu_classification: null })).toBe(true)
    expect(siuCaseAccess(detective, {})).toBe(false)
  })
})

describe('no role is above investigation', () => {
  const c = { siu_classification: 'siu_compartmented' }

  it('admits ONLY allow-listed accounts to a compartmented investigation', () => {
    // Every standing, excluded by default — including the two that would
    // otherwise be able to see everything.
    const excluded: Array<[string, SiuContext]> = [
      ['Portal Owner', live({ profile: profile({ is_owner: true }) })],
      ['X-Ray 1', live({ membership: member({ siu_role: 'special_agent_in_charge' }) })],
      ['Special Agent', live({ membership: member() })],
      ['Attorney General', live({ justiceRole: 'attorney_general' })],
      ['CID Director', live({ profile: profile({ role: 'director' }) })],
    ]
    for (const [, ctx] of excluded) expect(siuCaseAccess(ctx, c)).toBe(false)
    // Assignment is not a compartment key either.
    for (const [, ctx] of excluded) expect(siuCaseAccess(ctx, c, { assigned: true })).toBe(false)
    // The allow-list row is the only key — and it works for a plain agent.
    expect(siuCaseAccess(live({ membership: member() }), c, { inCompartment: true })).toBe(true)
  })

  it('still denies a compartment member with no SIU standing at all', () => {
    // A revoked agent keeps nothing: standing gates the compartment check.
    const removed = live({ membership: member({ active: false }) })
    expect(siuCaseAccess(removed, c, { inCompartment: true })).toBe(false)
    expect(siuCaseAccess(removed, { siu_classification: 'siu' })).toBe(false)
  })
})

describe('display helpers', () => {
  it('never invents a value it does not have', () => {
    expect(siuCallsign(null)).toBe('—')
    expect(siuCallsign('  ')).toBe('—')
    expect(siuCallsign('X-7')).toBe('X-7')
    expect(siuRoleLabel(null)).toBe('—')
  })

  it('does not hard-code the X-2/X-3 callsigns', () => {
    // Future callsigns must need no code change.
    expect(siuCallsign('X-14')).toBe('X-14')
    expect(siuCallsign('X-RAY 9')).toBe('X-RAY 9')
  })

  it('falls back to the base level for an unknown classification', () => {
    expect(siuClassificationLabel('siu_restricted')).toBe('SIU Restricted')
    expect(siuClassificationLabel('nonsense')).toBe('SIU')
    expect(siuClassificationLabel(null)).toBe('SIU')
  })

  it('shows an unrecognised audit action rather than dropping the row', () => {
    expect(siuAuditLabel('SIU_APPOINTED')).toBe('Agent appointed')
    expect(siuAuditLabel('SIU_FUTURE_ACTION')).toBe('SIU_FUTURE_ACTION')
  })
})
