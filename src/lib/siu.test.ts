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
  caseDepartment, maySwitchDepartment, termsFor, userDepartment,
  SIU_DESIGNATIONS, SIU_DESIGNATION_LABEL, SIU_INTEGRITY_NOTE_TYPES, SIU_NOTE_TYPES,
  SIU_OPERATION_CATEGORIES, SIU_PRIORITY_DESIGNATIONS,
  siuDesignationLabel, siuNoteTypeLabel, siuOperationCategoryLabel,
  siuAssignableClassifications, siuCanAppoint, siuCanAppointRole, siuCanReadCid,
  siuCanRemove, siuCaseAccess, siuIsAgent, siuIsCommand, siuOperates, siuStanding,
  siuAuditLabel, siuCallsign, siuClassificationLabel, siuRoleLabel,
  SIU_AUDIENCES, SIU_AUDIENCE_LABEL, SIU_AUDIENCE_SHORT, SIU_HANDLING,
  SIU_HANDLING_LABEL, SIU_RELEASE_ITEM_TYPES, SIU_RELEASE_ITEM_LABEL,
  siuAudienceLabel, siuHandlingLabel, siuReleaseItemLabel,
  SIU_SOURCE_STATUSES, SIU_SOURCE_STATUS_LABEL, SIU_RELIABILITY,
  SIU_RELIABILITY_LABEL, siuReliabilityLabel,
  SIU_UNDERCOVER_STATUSES, SIU_UNDERCOVER_STATUS_LABEL, siuUndercoverStatusLabel,
  SIU_ALLEGATIONS, SIU_ALLEGATION_LABEL, SIU_REVIEW_STATUSES, SIU_REVIEW_STATUS_LABEL,
  SIU_EXPORT_SCOPES, SIU_EXPORT_SCOPE_LABEL, SIU_EXPORT_ALWAYS_WITHHELD,
  SIU_WITHHELD_LABEL, siuExportScopeLabel,
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
  it('is null at every CID rank below Director', () => {
    // The Director is the ONE CID rank the SIU SOP names in the chain of
    // command; every rank beneath them derives nothing from seniority.
    for (const role of ROLE_ORDER.filter(r => r !== 'director')) {
      expect(siuStanding(live({ profile: profile({ role }) }))).toBeNull()
    }
  })

  it('gives the Director of CID oversight standing, never field standing', () => {
    // SOP chain: Commissioner's Office → Director of CID → X-1 → Agents. The
    // Director oversees the unit, so they resolve to 'oversight' — the same
    // standing the AG holds — and NOT to an agent role. Membership is still
    // the only route into the field.
    const director = live({ profile: profile({ role: 'director' }) })
    expect(siuStanding(director)).toBe('oversight')
    expect(siuIsAgent(director)).toBe(false)
    expect(siuIsCommand(director)).toBe(false)
    // Oversight is not a broad CID read grant from SIU — the Director already
    // reads CID through CID command, and SIU adds nothing to that.
    expect(siuCanReadCid(director)).toBe(false)
    expect(siuAssignableClassifications(director)).toEqual([])
  })

  it('resolves the appointed SIU role', () => {
    expect(siuStanding(live({ membership: member() }))).toBe('special_agent')
    expect(siuStanding(live({ membership: member({ siu_role: 'special_agent_in_charge', callsign: 'X-1' }) })))
      .toBe('special_agent_in_charge')
  })

  it('treats an oversight-only appointee, the AG and the Director as oversight', () => {
    expect(siuStanding(live({ membership: member({ oversight_only: true }) }))).toBe('oversight')
    expect(siuStanding(live({ justiceRole: 'attorney_general' }))).toBe('oversight')
    expect(siuStanding(live({ profile: profile({ role: 'director' }) }))).toBe('oversight')
  })

  it('prefers an appointed SIU role over the Director’s ex-officio oversight', () => {
    // A Director who is also appointed X-1 is X-1: membership wins, so the
    // resolver never downgrades real field authority to oversight.
    const both = live({
      profile: profile({ role: 'director' }),
      membership: member({ siu_role: 'special_agent_in_charge' }),
    })
    expect(siuStanding(both)).toBe('special_agent_in_charge')
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

describe('strict booleans (the NULL-guard invariant)', () => {
  // `siu_standing()` is nullable on BOTH sides of the mirror. On the server a
  // predicate written as `standing in (...)` yields NULL for an unauthorized
  // caller, and `if not <NULL> then raise` never fires — which silently
  // skipped the authorization guard in every SIU write RPC until the
  // predicates were coalesce()-pinned (hotfix f; the justice NULL-guard class,
  // migration 20260714070000). These assertions pin the same contract on the
  // client so the two cannot drift back apart: an unauthorized answer must be
  // exactly `false`, never null/undefined/NaN-ish.
  const unauthorized: SiuContext[] = [
    { profile: profile(), release: true },
    { profile: profile({ role: 'director' }), release: false },
    { profile: null, release: true },
    { profile: undefined, release: true },
    { profile: profile({ active: false, is_owner: true }), release: true },
  ]

  it('returns strict false — never a nullish value — for every unauthorized context', () => {
    for (const ctx of unauthorized) {
      for (const fn of [siuOperates, siuIsAgent, siuIsCommand, siuCanAppoint, siuCanReadCid]) {
        expect(fn(ctx)).toBe(false)
      }
      expect(siuCaseAccess(ctx, { siu_classification: 'siu' })).toBe(false)
      expect(siuCaseAccess(ctx, { siu_classification: 'siu_compartmented' }, { inCompartment: true })).toBe(false)
      expect(siuCanAppointRole(ctx, 'special_agent')).toBe(false)
      expect(siuCanRemove(ctx, member({ user_id: 'someone-else' }))).toBe(false)
    }
  })

  it('returns strict true — never a truthy non-boolean — when authorized', () => {
    const owner = live({ profile: profile({ is_owner: true }) })
    for (const fn of [siuOperates, siuIsAgent, siuIsCommand, siuCanAppoint, siuCanReadCid]) {
      expect(fn(owner)).toBe(true)
    }
    expect(siuCaseAccess(owner, { siu_classification: 'siu' })).toBe(true)
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
  it('admits the Owner, X-Ray 1, the Attorney General and the Director', () => {
    expect(siuCanAppoint(live({ profile: profile({ is_owner: true }) }))).toBe(true)
    expect(siuCanAppoint(live({ membership: member({ siu_role: 'special_agent_in_charge' }) }))).toBe(true)
    expect(siuCanAppoint(live({ justiceRole: 'attorney_general' }))).toBe(true)
    // The SOP puts SIU personnel under the Director of CID, so appointment
    // authority follows the chain of command.
    expect(siuCanAppoint(live({ profile: profile({ role: 'director' }) }))).toBe(true)
    // Everyone else, including a Special Agent and the rest of CID command.
    expect(siuCanAppoint(live({ membership: member() }))).toBe(false)
    expect(siuCanAppoint(live({ profile: profile({ role: 'deputy_director' }) }))).toBe(false)
    expect(siuCanAppoint(live({ profile: profile({ role: 'bureau_lead' }) }))).toBe(false)
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

  it('opens a plain SIU case to field agents and to oversight authority', () => {
    // "Standard" is the level at which the SOP's oversight actually works: the
    // Director and the AG oversee the unit's ordinary investigations.
    const c = { siu_classification: 'siu' }
    expect(siuCaseAccess(owner, c)).toBe(true)
    expect(siuCaseAccess(x1, c)).toBe(true)
    expect(siuCaseAccess(agent, c)).toBe(true)
    expect(siuCaseAccess(ag, c)).toBe(true)
    expect(siuCaseAccess(director, c)).toBe(true)
    // Nobody outside SIU standing, at any CID rank.
    expect(siuCaseAccess(detective, c)).toBe(false)
    expect(siuCaseAccess(live({ profile: profile({ role: 'deputy_director' }) }), c)).toBe(false)
  })

  it('limits siu_restricted to assigned agents, command, or an allow-list row', () => {
    const c = { siu_classification: 'siu_restricted' }
    expect(siuCaseAccess(agent, c)).toBe(false)
    expect(siuCaseAccess(agent, c, { assigned: true })).toBe(true)
    expect(siuCaseAccess(agent, c, { inCompartment: true })).toBe(true)
    expect(siuCaseAccess(x1, c)).toBe(true)
    // Oversight stops at the standard level — this is the escape hatch that
    // keeps the Director and the AG investigable (see §37 below).
    expect(siuCaseAccess(ag, c)).toBe(false)
    expect(siuCaseAccess(director, c)).toBe(false)
    expect(siuCaseAccess(director, c, { assigned: true })).toBe(false)
  })

  it('limits siu_command to SIU command, not to a Special Agent or oversight', () => {
    const c = { siu_classification: 'siu_command' }
    expect(siuCaseAccess(x1, c)).toBe(true)
    expect(siuCaseAccess(owner, c)).toBe(true)
    expect(siuCaseAccess(agent, c)).toBe(false)
    expect(siuCaseAccess(agent, c, { assigned: true })).toBe(false)
    expect(siuCaseAccess(agent, c, { inCompartment: true })).toBe(true)
    expect(siuCaseAccess(director, c)).toBe(false)
    expect(siuCaseAccess(ag, c)).toBe(false)
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

describe('the SOP chain of command', () => {
  // Commissioner's Office → Director of CID → X-Ray 1 → Special Agents.
  // The Commissioner's Office has no portal identity; the Portal Owner is the
  // platform's equivalent top authority.
  const director = live({ profile: profile({ role: 'director' }) })
  const x1 = live({ membership: member({ siu_role: 'special_agent_in_charge' }) })

  it('seats the Director above X-Ray 1 for personnel, and below for the field', () => {
    // Personnel: the Director may appoint and remove agents…
    expect(siuCanAppoint(director)).toBe(true)
    expect(siuCanRemove(director, member({ user_id: 'u9' }))).toBe(true)
    expect(siuCanRemove(director, member({ user_id: 'x1', siu_role: 'special_agent_in_charge' }))).toBe(true)
    // …but naming a new X-Ray 1 stays with the Owner alone.
    expect(siuCanAppointRole(director, 'special_agent')).toBe(true)
    expect(siuCanAppointRole(director, 'special_agent_in_charge')).toBe(false)
    // Field: X-1 works investigations the Director cannot.
    expect(siuIsCommand(x1)).toBe(true)
    expect(siuIsCommand(director)).toBe(false)
    expect(siuCaseAccess(x1, { siu_classification: 'siu_command' })).toBe(true)
    expect(siuCaseAccess(director, { siu_classification: 'siu_command' })).toBe(false)
  })

  it('keeps the whole chain investigable — the reason oversight stops at "siu"', () => {
    // An investigation INTO the Director, the AG, or X-1 is opened above the
    // standard level. Nothing in the chain grants a way in.
    const ag = live({ justiceRole: 'attorney_general' })
    for (const level of ['siu_restricted', 'siu_command', 'siu_compartmented']) {
      expect(siuCaseAccess(director, { siu_classification: level })).toBe(false)
      expect(siuCaseAccess(ag, { siu_classification: level })).toBe(false)
    }
    // Compartmented excludes X-1 too, so a case about X-1 is workable by the
    // agents on the allow-list and nobody above them.
    expect(siuCaseAccess(x1, { siu_classification: 'siu_compartmented' })).toBe(false)
    expect(siuCaseAccess(live({ membership: member() }), { siu_classification: 'siu_compartmented' },
      { inCompartment: true })).toBe(true)
  })

  it('grants the chain nothing while the build-phase gate is closed', () => {
    const closedDirector: SiuContext = { profile: profile({ role: 'director' }), release: false }
    expect(siuStanding(closedDirector)).toBeNull()
    expect(siuOperates(closedDirector)).toBe(false)
    expect(siuCanAppoint(closedDirector)).toBe(false)
    expect(siuCaseAccess(closedDirector, { siu_classification: 'siu' })).toBe(false)
  })
})

describe('department model — one platform, two departments', () => {
  it('puts everyone in CID while the release gate is closed', () => {
    // The build-phase invariant: appointing agents early must not strand them
    // between departments, and CID must keep working untouched.
    expect(userDepartment({ profile: profile(), membership: member(), release: false })).toBe('cid')
    expect(userDepartment({ profile: profile({ is_owner: true }), release: false })).toBe('cid')
  })

  it('moves an appointed agent into SIU once the gate opens', () => {
    expect(userDepartment(live({ membership: member() }))).toBe('siu')
    expect(userDepartment(live({ membership: member({ siu_role: 'senior_special_agent' }) }))).toBe('siu')
    expect(userDepartment(live({ membership: member({ siu_role: 'special_agent_in_charge' }) }))).toBe('siu')
  })

  it('keeps ordinary CID members — and the AG — in CID', () => {
    expect(userDepartment(live({ profile: profile({ role: 'director' }) }))).toBe('cid')
    // Oversight authority is NOT departmental membership (§18).
    expect(userDepartment(live({ justiceRole: 'attorney_general' }))).toBe('cid')
    expect(userDepartment(live({ membership: member({ oversight_only: true }) }))).toBe('cid')
    // An ended membership returns the member to CID.
    expect(userDepartment(live({ membership: member({ active: false }) }))).toBe('cid')
  })

  it('offers a deliberate switch ONLY to accounts holding both contexts', () => {
    expect(maySwitchDepartment(live({ profile: profile({ is_owner: true }) }))).toBe(true)
    expect(maySwitchDepartment(live({ justiceRole: 'attorney_general' }))).toBe(true)
    // The Director's home department stays CID; oversight of SIU is the second
    // context, which is exactly what the switch is for.
    expect(maySwitchDepartment(live({ profile: profile({ role: 'director' }) }))).toBe(true)
    expect(userDepartment(live({ profile: profile({ role: 'director' }) }))).toBe('cid')
    // Field agents hold exactly one context; normal CID members hold one too.
    expect(maySwitchDepartment(live({ membership: member() }))).toBe(false)
    expect(maySwitchDepartment(live({ membership: member({ siu_role: 'special_agent_in_charge' }) }))).toBe(false)
    expect(maySwitchDepartment(live({ profile: profile({ role: 'deputy_director' }) }))).toBe(false)
    expect(maySwitchDepartment({ profile: profile(), release: false })).toBe(false)
    expect(maySwitchDepartment({ profile: profile({ role: 'director' }), release: false })).toBe(false)
  })

  it('names a record by its OWNING department, not the viewer', () => {
    expect(caseDepartment({ case_authority: 'siu' })).toBe('siu')
    expect(caseDepartment({ case_authority: 'cid' })).toBe('cid')
    expect(caseDepartment({})).toBe('cid')

    expect(termsFor('siu').lead).toBe('Lead Agent')
    expect(termsFor('siu').caseHeading).toBe('SIU INVESTIGATION')
    expect(termsFor('cid').lead).toBe('Lead Detective')
    expect(termsFor('cid').caseHeading).toBe('CID CASE')
    // An unknown/absent authority reads as CID rather than throwing.
    expect(termsFor(null).lead).toBe('Lead Detective')
  })
})

describe('the senior agent tier', () => {
  it('is a field tier, never SIU command', () => {
    const senior = live({ membership: member({ siu_role: 'senior_special_agent' }) })
    expect(siuIsAgent(senior)).toBe(true)
    expect(siuCanReadCid(senior)).toBe(true)
    expect(siuIsCommand(senior)).toBe(false)
    expect(siuCanAppoint(senior)).toBe(false)
  })

  it('reaches a restricted investigation only when assigned', () => {
    const senior = live({ membership: member({ siu_role: 'senior_special_agent' }) })
    const c = { siu_classification: 'siu_restricted' }
    expect(siuCaseAccess(senior, c)).toBe(false)
    expect(siuCaseAccess(senior, c, { assigned: true })).toBe(true)
    expect(siuCaseAccess(senior, { siu_classification: 'siu' })).toBe(true)
    expect(siuCaseAccess(senior, { siu_classification: 'siu_command' })).toBe(false)
    expect(siuCaseAccess(senior, { siu_classification: 'siu_compartmented' }, { assigned: true })).toBe(false)
  })
})

describe('Phase 2 vocabulary', () => {
  it('keeps designations as investigative standing, not findings', () => {
    // Every designation must carry an explicit label — including 'unknown',
    // which is a real designation ("we don't yet know their standing") and
    // legitimately renders as "Unknown". "cleared" must exist so an
    // investigation can record that someone was ruled out.
    for (const d of SIU_DESIGNATIONS) {
      expect(SIU_DESIGNATION_LABEL, `${d} needs a label`).toHaveProperty(d)
      expect(siuDesignationLabel(d)).toBeTruthy()
    }
    expect(SIU_DESIGNATIONS).toContain('cleared')
    expect(SIU_DESIGNATIONS).toContain('person_of_interest')
    expect(siuDesignationLabel('priority_target')).toBe('Priority Target')
    // An unrecognised value degrades to Unknown rather than leaking the raw
    // token into the UI.
    expect(siuDesignationLabel('convicted')).toBe('Unknown')
    expect(siuDesignationLabel(null)).toBe('Unknown')
  })

  it('treats only genuine escalations as priority designations', () => {
    for (const d of SIU_PRIORITY_DESIGNATIONS) {
      expect(SIU_DESIGNATIONS as readonly string[]).toContain(d)
    }
    expect(SIU_PRIORITY_DESIGNATIONS).not.toContain('cleared')
    expect(SIU_PRIORITY_DESIGNATIONS).not.toContain('person_of_interest')
    expect(SIU_PRIORITY_DESIGNATIONS).not.toContain('source')
  })

  it('names every note type, and marks the integrity subset', () => {
    for (const t of SIU_NOTE_TYPES) expect(siuNoteTypeLabel(t)).not.toBe('')
    for (const t of SIU_INTEGRITY_NOTE_TYPES) {
      expect(SIU_NOTE_TYPES as readonly string[]).toContain(t)
    }
    // The integrity subset is what the dashboard counts against CID cases.
    expect(SIU_INTEGRITY_NOTE_TYPES).toContain('corruption_flag')
    expect(SIU_INTEGRITY_NOTE_TYPES).toContain('compromised_officer')
    expect(SIU_INTEGRITY_NOTE_TYPES).not.toContain('intelligence')
    expect(siuNoteTypeLabel('nonsense')).toBe('Intelligence')
  })

  it('names every operation category', () => {
    for (const c of SIU_OPERATION_CATEGORIES) {
      expect(siuOperationCategoryLabel(c)).not.toBe('Operation')
    }
    expect(siuOperationCategoryLabel('undercover')).toBe('Undercover Operation')
    expect(siuOperationCategoryLabel(null)).toBe('Operation')
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

describe('§15 release vocabulary', () => {
  it('offers exactly the four release routes', () => {
    // 'cid' | 'case_members' | 'investigator' are the audiences; "Release
    // Intelligence" is item_type 'intelligence' addressed to 'cid'.
    expect([...SIU_AUDIENCES]).toEqual(['cid', 'case_members', 'investigator'])
    for (const a of SIU_AUDIENCES) {
      expect(SIU_AUDIENCE_LABEL[a], `${a} needs a label`).toBeTruthy()
      expect(SIU_AUDIENCE_SHORT[a], `${a} needs a short form`).toBeTruthy()
    }
    expect(SIU_RELEASE_ITEM_TYPES).toContain('intelligence')
    expect(siuAudienceLabel('cid')).toBe('Share with CID')
  })

  it('labels every release item type and handling caveat', () => {
    for (const t of SIU_RELEASE_ITEM_TYPES) {
      expect(SIU_RELEASE_ITEM_LABEL[t], `${t} needs a label`).toBeTruthy()
    }
    for (const h of SIU_HANDLING) {
      expect(SIU_HANDLING_LABEL[h], `${h} needs a label`).toBeTruthy()
    }
    // An unknown token is echoed, never silently relabelled.
    expect(siuReleaseItemLabel('mystery')).toBe('mystery')
    expect(siuHandlingLabel(null)).toBe('—')
  })
})

describe('Phase 3 vocabulary', () => {
  it('labels every source status and reliability grade', () => {
    for (const s of SIU_SOURCE_STATUSES) expect(SIU_SOURCE_STATUS_LABEL[s]).toBeTruthy()
    for (const r of SIU_RELIABILITY) expect(SIU_RELIABILITY_LABEL[r]).toBeTruthy()
    expect(SIU_RELIABILITY).toContain('untested')
    expect(siuReliabilityLabel('untested')).toBe('Untested')
  })

  it('labels every undercover status, allegation and review disposition', () => {
    for (const s of SIU_UNDERCOVER_STATUSES) expect(SIU_UNDERCOVER_STATUS_LABEL[s]).toBeTruthy()
    for (const a of SIU_ALLEGATIONS) expect(SIU_ALLEGATION_LABEL[a]).toBeTruthy()
    for (const s of SIU_REVIEW_STATUSES) expect(SIU_REVIEW_STATUS_LABEL[s]).toBeTruthy()
    // 'compromised' must exist — a burnt deployment is a state the UI has to
    // be able to show, not something that gets folded into "concluded".
    expect(SIU_UNDERCOVER_STATUSES).toContain('compromised')
    expect(siuUndercoverStatusLabel('active')).toBe('Deployed')
  })

  it('names the three categories withheld from every export', () => {
    // These mirror siu_export_case()'s unconditional redaction. If the server
    // list ever grows, this is the test that should fail first.
    expect([...SIU_EXPORT_ALWAYS_WITHHELD]).toEqual([
      'confidential_source_identities', 'undercover_legends', 'intercept_content',
    ])
    for (const c of SIU_EXPORT_ALWAYS_WITHHELD) expect(SIU_WITHHELD_LABEL[c]).toBeTruthy()
    for (const s of SIU_EXPORT_SCOPES) expect(SIU_EXPORT_SCOPE_LABEL[s]).toBeTruthy()
    expect(siuExportScopeLabel('disclosure_packet')).toBe('Disclosure packet (court)')
  })
})

describe('§14/§15 audit vocabulary', () => {
  it('names every new audit action rather than echoing the raw token', () => {
    for (const a of [
      'SIU_CASE_ASSUMED', 'SIU_CASE_RETURNED', 'SIU_INTEL_RELEASED',
      'SIU_INTEL_REVOKED', 'SIU_INTEL_ACKNOWLEDGED', 'SIU_EXPORTED',
    ]) {
      expect(siuAuditLabel(a), `${a} needs human wording`).not.toBe(a)
    }
    // …and an action the client has never heard of still shows, unhidden.
    expect(siuAuditLabel('SIU_FUTURE_THING')).toBe('SIU_FUTURE_THING')
  })
})
