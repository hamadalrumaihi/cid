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
  siuCanRemove, siuCaseAccess, siuCaseReadOnly, siuIsAgent, siuIsCommand, siuOperates, siuStanding,
  siuMayRequestAccess, siuAccessStatusLabel,
  SIU_ACCESS_REQUEST_STATUSES, SIU_ACCESS_REQUEST_STATUS_LABEL,
  siuAuditLabel, siuCallsign, siuClassificationLabel, siuRoleLabel,
  SIU_AUDIENCES, SIU_AUDIENCE_LABEL, SIU_AUDIENCE_SHORT, SIU_HANDLING,
  SIU_HANDLING_LABEL, SIU_RELEASE_ITEM_TYPES, SIU_RELEASE_ITEM_LABEL,
  siuAudienceLabel, siuHandlingLabel, siuReleaseItemLabel,
  SIU_CASE_CATEGORIES, SIU_CASE_CATEGORY_LABEL, SIU_CLOSURE_REASONS,
  SIU_CLOSURE_REASON_LABEL, SIU_CONFLICT_RESOLUTIONS, SIU_CONFLICT_STATUSES,
  SIU_CONFLICT_STATUS_LABEL, SIU_REFERRAL_CATEGORIES, SIU_REFERRAL_CATEGORY_LABEL,
  SIU_REFERRAL_DISPOSITIONS, SIU_REFERRAL_STATUSES, SIU_REFERRAL_STATUS_LABEL,
  SIU_STAGES, SIU_STAGE_HINT, SIU_STAGE_LABEL,
  isPreliminaryInquiry, siuCanResolveConflict, siuCanReviewReferrals,
  siuCaseCategoryLabel, siuClosureReasonLabel, siuConflictStatusLabel,
  siuRecusesAccess, siuReferralCategoryLabel, siuReferralStatusLabel, siuStageLabel,
  SIU_CREDIBILITY, SIU_CREDIBILITY_LABEL, SIU_SOURCE_TYPES, SIU_SOURCE_TYPE_LABEL,
  SIU_REVIEW_OUTCOME_LABEL, SIU_TEMP_ACCESS_MAX_DAYS, SIU_WATCH_MAX_DAYS,
  SIU_WATCH_ENTITY_TYPES, SIU_WATCH_ENTITY_LABEL, SIU_WATCH_PRIORITIES,
  SIU_OPENABLE_DESIGNATIONS, SIU_TARGET_PRIORITIES, SIU_TARGET_PRIORITY_LABEL,
  SIU_WATCH_PRIORITY_LABEL, SIU_WATCH_LIVE_STATUSES, SIU_WATCH_REGISTRY_TYPES,
  SIU_WATCH_STATUS_LABEL, siuWatchStatusLabel, siuLinkStrength,
  SIU_LINK_STRENGTH_LABEL, isUngraded, reviewOverdue, siuCredibilityLabel,
  siuSourceTypeLabel, siuWatchEntityLabel, tempAccessLive, watchExpiringWithin, watchLive,
  SIU_SOURCE_STATUSES, SIU_SOURCE_STATUS_LABEL, SIU_RELIABILITY,
  SIU_RELIABILITY_LABEL, siuReliabilityLabel,
  SIU_UNDERCOVER_STATUSES, SIU_UNDERCOVER_STATUS_LABEL, siuUndercoverStatusLabel,
  SIU_ALLEGATIONS, SIU_ALLEGATION_LABEL, SIU_REVIEW_STATUSES, SIU_REVIEW_STATUS_LABEL,
  SIU_EXPORT_SCOPES, SIU_EXPORT_SCOPE_LABEL, SIU_EXPORT_ALWAYS_WITHHELD,
  SIU_WITHHELD_LABEL, siuExportScopeLabel,
  type SiuContext, type SiuMembership, type SiuWatchEntry,
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
  it('is null at EVERY CID rank, the Director included', () => {
    // No CID rank confers SIU standing. Seniority inside CID buys nothing
    // inside SIU — that is the whole separation.
    for (const role of ROLE_ORDER) {
      expect(siuStanding(live({ profile: profile({ role }) })), `${role} must get nothing`).toBeNull()
    }
  })

  it('gives the Director of CID NOTHING — CID command does not command SIU', () => {
    // This reverses the earlier SOP reading (migration 20260823120000), which
    // put the Director in the SIU chain. Oversight is not a passive label:
    // siuCanAppoint() includes it and siu_remove() lets it end an X-1's
    // membership, so a Director holding it could dissolve the unit
    // investigating CID.
    const director = live({ profile: profile({ role: 'director' }) })
    expect(siuStanding(director)).toBeNull()
    expect(siuOperates(director)).toBe(false)
    expect(siuIsAgent(director)).toBe(false)
    expect(siuIsCommand(director)).toBe(false)
    expect(siuCanAppoint(director)).toBe(false)
    expect(siuCanReadCid(director)).toBe(false)
    expect(siuAssignableClassifications(director)).toEqual([])
    // …and no SIU case is readable at any classification.
    for (const c of ['siu', 'siu_restricted', 'siu_command', 'siu_compartmented']) {
      expect(siuCaseAccess(director, { siu_classification: c })).toBe(false)
    }
  })

  it('still admits a Director who is genuinely APPOINTED to SIU', () => {
    // The rule removed is "role confers standing", not "a Director may never
    // serve". Appointment is deliberate and still works.
    const appointed = live({
      profile: profile({ role: 'director' }),
      membership: member({ oversight_only: true }),
    })
    expect(siuStanding(appointed)).toBe('oversight')
  })

  it('resolves the appointed SIU role', () => {
    expect(siuStanding(live({ membership: member() }))).toBe('special_agent')
    expect(siuStanding(live({ membership: member({ siu_role: 'special_agent_in_charge', callsign: 'X-1' }) })))
      .toBe('special_agent_in_charge')
  })

  it('treats an oversight-only appointee and the AG as oversight', () => {
    expect(siuStanding(live({ membership: member({ oversight_only: true }) }))).toBe('oversight')
    // The AG is SIU's reporting line, so this one stays ex officio.
    expect(siuStanding(live({ justiceRole: 'attorney_general' }))).toBe('oversight')
    // The Director of CID is NOT oversight. See the dedicated test above.
    expect(siuStanding(live({ profile: profile({ role: 'director' }) }))).toBeNull()
  })

  it('prefers an appointed SIU role over ex-officio oversight', () => {
    // An AG who is also appointed X-1 is X-1: membership wins, so the resolver
    // never downgrades real field authority to oversight.
    const both = live({
      justiceRole: 'attorney_general',
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
  it('admits the Owner, X-Ray 1 and the Attorney General — and NO CID rank', () => {
    expect(siuCanAppoint(live({ profile: profile({ is_owner: true }) }))).toBe(true)
    expect(siuCanAppoint(live({ membership: member({ siu_role: 'special_agent_in_charge' }) }))).toBe(true)
    expect(siuCanAppoint(live({ justiceRole: 'attorney_general' }))).toBe(true)
    // The Director of CID appoints nobody to SIU. Appointment authority is the
    // sharp end of this: siu_remove() lets an appointer end an X-1's
    // membership, so a CID Director holding it could dissolve the unit.
    expect(siuCanAppoint(live({ profile: profile({ role: 'director' }) }))).toBe(false)
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
    // "Standard" is the level at which oversight actually works: the Attorney
    // General oversees the unit's ordinary investigations.
    const c = { siu_classification: 'siu' }
    expect(siuCaseAccess(owner, c)).toBe(true)
    expect(siuCaseAccess(x1, c)).toBe(true)
    expect(siuCaseAccess(agent, c)).toBe(true)
    expect(siuCaseAccess(ag, c)).toBe(true)
    // Nobody outside SIU standing, at any CID rank — the Director included.
    expect(siuCaseAccess(director, c)).toBe(false)
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

describe('the SIU chain of command', () => {
  // Attorney General → X-Ray 1 → Senior Special Agent → Special Agent.
  // The Director of CID is NOT in it. The Portal Owner sits above as the
  // platform's build-phase authority.
  const director = live({ profile: profile({ role: 'director' }) })
  const ag = live({ justiceRole: 'attorney_general' })
  const x1 = live({ membership: member({ siu_role: 'special_agent_in_charge' }) })

  it('seats the AG above X-Ray 1 for personnel, and below for the field', () => {
    // Personnel: the AG may appoint and remove agents…
    expect(siuCanAppoint(ag)).toBe(true)
    expect(siuCanRemove(ag, member({ user_id: 'u9' }))).toBe(true)
    expect(siuCanRemove(ag, member({ user_id: 'x1', siu_role: 'special_agent_in_charge' }))).toBe(true)
    // …but naming a new X-Ray 1 stays with the Owner alone.
    expect(siuCanAppointRole(ag, 'special_agent')).toBe(true)
    expect(siuCanAppointRole(ag, 'special_agent_in_charge')).toBe(false)
    // Field: X-1 works investigations oversight cannot.
    expect(siuIsCommand(x1)).toBe(true)
    expect(siuIsCommand(ag)).toBe(false)
    expect(siuCaseAccess(x1, { siu_classification: 'siu_command' })).toBe(true)
    expect(siuCaseAccess(ag, { siu_classification: 'siu_command' })).toBe(false)
  })

  it('leaves the Director of CID entirely outside the chain', () => {
    // The reversal of 20260823120000, pinned. CID command does not command SIU.
    expect(siuStanding(director)).toBeNull()
    expect(siuCanAppoint(director)).toBe(false)
    expect(siuCanRemove(director, member({ user_id: 'u9' }))).toBe(false)
    expect(siuCanAppointRole(director, 'special_agent')).toBe(false)
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
    // The Director of CID holds ONE context now, so there is nothing to switch
    // to and no switch is offered.
    expect(maySwitchDepartment(live({ profile: profile({ role: 'director' }) }))).toBe(false)
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

describe('§15 — a preliminary inquiry is invisible to oversight', () => {
  const agent = live({ membership: member() })
  const sac = live({ membership: member({ siu_role: 'special_agent_in_charge', callsign: 'X-1' }) })
  const director = live({ profile: profile({ role: 'director' }) })
  const ag = live({ justiceRole: 'attorney_general' })

  it('hides an inquiry from BOTH oversight holders, at standard classification', () => {
    // Standard 'siu' classification is the weakest there is — the one an
    // oversight holder normally reads. The stage alone is what closes it.
    const inquiry = { siu_classification: 'siu', siu_stage: 'preliminary_inquiry' }
    expect(siuCaseAccess(director, inquiry)).toBe(false)
    expect(siuCaseAccess(ag, inquiry)).toBe(false)
    // …while field access is completely unaffected. An inquiry is a normal
    // piece of work for the people doing it.
    expect(siuCaseAccess(agent, inquiry)).toBe(true)
    expect(siuCaseAccess(sac, inquiry)).toBe(true)
  })

  it('opens to oversight the moment it is promoted', () => {
    // Promotion is the ONE thing that changes, and it changes exactly this.
    // Oversight here means the Attorney General; the Director of CID holds no
    // SIU standing at all and never sees either stage.
    for (const ctx of [ag]) {
      expect(siuCaseAccess(ctx, { siu_classification: 'siu', siu_stage: 'investigation' })).toBe(true)
      // A case with no stage recorded at all is an ordinary investigation —
      // never accidentally treated as an inquiry.
      expect(siuCaseAccess(ctx, { siu_classification: 'siu' })).toBe(true)
    }
  })

  it('does not let the stage widen anything above standard classification', () => {
    // Promoting must never become a back door: a restricted/command/
    // compartmented case stays shut to oversight at EITHER stage.
    for (const cls of ['siu_restricted', 'siu_command', 'siu_compartmented']) {
      for (const stage of ['preliminary_inquiry', 'investigation']) {
        expect(siuCaseAccess(director, { siu_classification: cls, siu_stage: stage })).toBe(false)
      }
    }
  })

  it('reads a missing stage as a full investigation', () => {
    expect(isPreliminaryInquiry({})).toBe(false)
    expect(isPreliminaryInquiry({ siu_stage: null })).toBe(false)
    expect(isPreliminaryInquiry({ siu_stage: 'preliminary_inquiry' })).toBe(true)
    expect(siuStageLabel(null)).toBe('Full investigation')
    for (const s of SIU_STAGES) {
      expect(SIU_STAGE_LABEL[s], `${s} needs a label`).toBeTruthy()
      expect(SIU_STAGE_HINT[s], `${s} needs a hint`).toBeTruthy()
    }
  })
})

describe('§17 — a declared conflict beats every grant', () => {
  it('vetoes access at every standing and classification, owner included', () => {
    // This is the property the server probe caught the first implementation
    // failing: rank-based access ignored the declaration entirely. If the
    // mirror ever regains a branch that outranks the veto, this fails.
    const everyone = [
      live({ profile: profile({ is_owner: true }) }),
      live({ membership: member({ siu_role: 'special_agent_in_charge' }) }),
      live({ membership: member({ siu_role: 'senior_special_agent' }) }),
      live({ membership: member() }),
      live({ profile: profile({ role: 'director' }) }),
      live({ justiceRole: 'attorney_general' }),
    ]
    for (const ctx of everyone) {
      for (const cls of ['siu', 'siu_restricted', 'siu_command', 'siu_compartmented']) {
        expect(
          siuCaseAccess(ctx, { siu_classification: cls }, { assigned: true, inCompartment: true, recused: true }),
          `${cls} must stay shut to a recused account`,
        ).toBe(false)
      }
    }
  })

  it('only "cleared" lifts the recusal', () => {
    // 'reassigned' means the conflict was real and the case moved on — that is
    // not a reason to hand the file back.
    expect(siuRecusesAccess('declared')).toBe(true)
    expect(siuRecusesAccess('acknowledged')).toBe(true)
    expect(siuRecusesAccess('reassigned')).toBe(true)
    expect(siuRecusesAccess('cleared')).toBe(false)
  })

  it('refuses to let an agent clear their own conflict', () => {
    const sac = live({
      profile: profile({ id: 'x1' }),
      membership: member({ user_id: 'x1', siu_role: 'special_agent_in_charge' }),
    })
    expect(siuCanResolveConflict(sac, { agent_id: 'someone-else' })).toBe(true)
    expect(siuCanResolveConflict(sac, { agent_id: 'x1' })).toBe(false)
    // …and resolving is a command act regardless of whose conflict it is.
    expect(siuCanResolveConflict(live({ membership: member() }), { agent_id: 'other' })).toBe(false)
  })

  it('offers every resolution except the declaring state itself', () => {
    expect(SIU_CONFLICT_RESOLUTIONS).not.toContain('declared')
    expect([...SIU_CONFLICT_RESOLUTIONS]).toEqual(['acknowledged', 'reassigned', 'cleared'])
    for (const s of SIU_CONFLICT_STATUSES) expect(SIU_CONFLICT_STATUS_LABEL[s]).toBeTruthy()
    expect(siuConflictStatusLabel('mystery')).toBe('mystery')
  })
})

describe('§14 — the intake queue is a field function', () => {
  it('is closed to oversight standing, which may name its own subject', () => {
    // The sharp case: a referral can be ABOUT the Director. Giving the
    // Director the queue would hand a subject the allegations against them.
    expect(siuCanReviewReferrals(live({ profile: profile({ role: 'director' }) }))).toBe(false)
    expect(siuCanReviewReferrals(live({ justiceRole: 'attorney_general' }))).toBe(false)
    // Field standing at every rank may work it.
    for (const r of ['special_agent', 'senior_special_agent', 'special_agent_in_charge']) {
      expect(siuCanReviewReferrals(live({ membership: member({ siu_role: r }) }))).toBe(true)
    }
    expect(siuCanReviewReferrals(live({ profile: profile({ is_owner: true }) }))).toBe(true)
    expect(siuCanReviewReferrals(live())).toBe(false)
  })

  it('cannot set a referral back to the arrival state by reviewing it', () => {
    expect(SIU_REFERRAL_DISPOSITIONS).not.toContain('submitted')
    expect(SIU_REFERRAL_STATUSES).toContain('submitted')
  })

  it('labels every referral category and status', () => {
    for (const c of SIU_REFERRAL_CATEGORIES) expect(SIU_REFERRAL_CATEGORY_LABEL[c]).toBeTruthy()
    for (const s of SIU_REFERRAL_STATUSES) expect(SIU_REFERRAL_STATUS_LABEL[s]).toBeTruthy()
    expect(siuReferralCategoryLabel('mystery')).toBe('mystery')
    expect(siuReferralStatusLabel(null)).toBe('—')
  })
})

describe('§32/§33 — category and closure', () => {
  it('keeps subject matter separate from sensitivity', () => {
    // The two lists must not overlap. The moment a "category" doubles as a
    // classification, units start over-classifying by subject.
    const classifications = ['siu', 'siu_restricted', 'siu_command', 'siu_compartmented']
    for (const c of SIU_CASE_CATEGORIES) expect(classifications).not.toContain(c)
    for (const c of SIU_CASE_CATEGORIES) expect(SIU_CASE_CATEGORY_LABEL[c]).toBeTruthy()
    expect(siuCaseCategoryLabel(null)).toBe('—')
  })

  it('offers a closure reason for the outcomes that are not wins', () => {
    // A list that only describes successes pushes people to mislabel; these
    // three are the ones that keep the register honest.
    for (const r of ['unfounded', 'insufficient_evidence', 'inactive']) {
      expect(SIU_CLOSURE_REASONS).toContain(r)
    }
    for (const r of SIU_CLOSURE_REASONS) expect(SIU_CLOSURE_REASON_LABEL[r]).toBeTruthy()
    expect(siuClosureReasonLabel('mystery')).toBe('mystery')
  })
})

describe('Delivery A audit vocabulary', () => {
  it('names every lifecycle action rather than echoing the raw token', () => {
    for (const a of [
      'SIU_REFERRAL_SUBMITTED', 'SIU_REFERRAL_REVIEWED', 'SIU_INQUIRY_PROMOTED',
      'SIU_CATEGORY_SET', 'SIU_CASE_CLOSED', 'SIU_CONFLICT_DECLARED',
      'SIU_CONFLICT_RESOLVED',
    ]) {
      expect(siuAuditLabel(a), `${a} needs human wording`).not.toBe(a)
    }
  })
})

describe('§20/§21 — grading asks two questions, not one', () => {
  it('keeps source reliability and information credibility as separate scales', () => {
    // The whole point of the Admiralty pairing. If these two ever merge into
    // one "confidence" value, a reliable source passing on a rumour starts
    // reading as trustworthy — which is the classic way an assessment gets
    // over-trusted.
    for (const r of SIU_RELIABILITY) expect(SIU_CREDIBILITY).not.toContain(r)
    for (const c of SIU_CREDIBILITY) expect(SIU_RELIABILITY).not.toContain(c)
    for (const c of SIU_CREDIBILITY) expect(SIU_CREDIBILITY_LABEL[c]).toBeTruthy()
    for (const t of SIU_SOURCE_TYPES) expect(SIU_SOURCE_TYPE_LABEL[t]).toBeTruthy()
    expect(siuSourceTypeLabel(null)).toBe('—')
  })

  it('treats ungraded as ungraded, never as neutral-good', () => {
    // A missing grade must never read as a pass. This is the client half of
    // the server rule that the columns are nullable with no default.
    expect(isUngraded({})).toBe(true)
    expect(isUngraded({ info_credibility: null })).toBe(true)
    expect(isUngraded({ info_credibility: 'cannot_judge' })).toBe(false)
    expect(siuCredibilityLabel(null)).toBe('Ungraded')
    expect(siuCredibilityLabel(undefined)).toBe('Ungraded')
    // …and 'cannot_judge' is a DELIBERATE grade, distinct from never assessed.
    expect(SIU_CREDIBILITY).toContain('cannot_judge')
    expect(siuCredibilityLabel('cannot_judge')).not.toBe('Ungraded')
  })

  it('offers the downgrade outcomes, not just revalidation', () => {
    for (const o of ['revalidated', 'downgraded', 'superseded', 'withdrawn']) {
      expect(SIU_REVIEW_OUTCOME_LABEL[o], `${o} needs a label`).toBeTruthy()
    }
  })
})

describe('§23 — review dates', () => {
  const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()

  it('counts a past due date as overdue, and a resolved note as not', () => {
    expect(reviewOverdue({ review_due_at: iso(-86_400_000) })).toBe(true)
    expect(reviewOverdue({ review_due_at: iso(86_400_000) })).toBe(false)
    // Resolved wins: a withdrawn note is not an outstanding chore.
    expect(reviewOverdue({ review_due_at: iso(-86_400_000), resolved_at: iso(-1000) })).toBe(false)
    // No date at all is "never graded", which the UI surfaces separately via
    // isUngraded rather than pretending it is a scheduled review.
    expect(reviewOverdue({})).toBe(false)
  })
})

describe('§25 — a watch always ends', () => {
  const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()
  // Shaped like a row of siu_watchlist_live(), which is what the UI now reads:
  // `display_name` is joined from the registry on every call and the watch row
  // itself holds no copy of the subject's name.
  const entry = (over: Partial<SiuWatchEntry> = {}): SiuWatchEntry => ({
    id: 'w1', entity_type: 'person', entity_id: 'p1',
    display_name: 'Subject', secondary: null,
    reason: 'r', priority: 'routine', status: 'active',
    classification: null, source: null, notes: null,
    case_id: null, case_number: null,
    assigned_agent: null, assigned_agent_name: null,
    expires_at: iso(30 * 86_400_000), review_due_at: null,
    created_at: iso(0), created_by: null,
    removed_at: null, removal_reason: null,
    review_overdue: false, days_left: 30, ...over,
  })

  it('reads expiry off the CLOCK, not off the status column', () => {
    // A stale 'active' row must never keep a watch alive past its end date —
    // mirrors private.siu_watch_live(), which is deliberately time-based so no
    // sweeper job has to run for expiry to bite.
    expect(watchLive(entry())).toBe(true)
    expect(watchLive(entry({ expires_at: iso(-1000) }))).toBe(false)
    expect(watchLive(entry({ status: 'cleared' }))).toBe(false)
    expect(watchLive(entry({ status: 'archived' }))).toBe(false)
    expect(watchLive({ status: 'active' })).toBe(false)
    // 'removed' is the OLD vocabulary and no longer exists. Treating an
    // unrecognised status as live would quietly resurrect every closed watch
    // the day somebody adds a status the client has not heard of.
    expect(watchLive(entry({ status: 'removed' }))).toBe(false)
  })

  it('counts every LIVE status, not just active', () => {
    // A watch stepped down to monitoring is still being monitored. This is the
    // client half of the bug fixed in 20260903140000, where deconfliction and
    // the dashboards matched status = 'active' alone and silently lost them.
    for (const status of SIU_WATCH_LIVE_STATUSES) {
      expect(watchLive(entry({ status })), `${status} is live`).toBe(true)
    }
  })

  it('flags an entry about to lapse', () => {
    expect(watchExpiringWithin(entry({ expires_at: iso(3 * 86_400_000) }), 14)).toBe(true)
    expect(watchExpiringWithin(entry({ expires_at: iso(30 * 86_400_000) }), 14)).toBe(false)
    // An already-dead watch is not "expiring" — it has expired.
    expect(watchExpiringWithin(entry({ expires_at: iso(-1000) }), 14)).toBe(false)
  })

  it('caps a single grant at a year, and mirrors the server exactly', () => {
    expect(SIU_WATCH_MAX_DAYS).toBe(365)
    for (const t of SIU_WATCH_ENTITY_TYPES) expect(SIU_WATCH_ENTITY_LABEL[t]).toBeTruthy()
    for (const p of SIU_WATCH_PRIORITIES) expect(SIU_WATCH_PRIORITY_LABEL[p]).toBeTruthy()
    for (const st of Object.keys(SIU_WATCH_STATUS_LABEL)) {
      expect(siuWatchStatusLabel(st)).toBeTruthy()
    }
    expect(siuWatchEntityLabel('mystery')).toBe('mystery')
  })

  it('drops `organization`, which no registry could satisfy', () => {
    // It had no table to point at, so under siu_watchlist_reference_check a
    // watch of that type is unconstructible. Leaving it in the picker would
    // offer a choice the database refuses.
    expect(SIU_WATCH_ENTITY_TYPES).not.toContain('organization')
  })

  it('keeps `unknown` out of the registry picker', () => {
    // Every registry type resolves to a real table; `unknown` is the escape
    // hatch for a subject not yet recorded anywhere and has to be chosen
    // deliberately, or it becomes the easy default and the duplicate address
    // book grows back.
    expect(SIU_WATCH_REGISTRY_TYPES).not.toContain('unknown')
    for (const t of SIU_WATCH_REGISTRY_TYPES) {
      expect(SIU_WATCH_ENTITY_TYPES as readonly string[]).toContain(t)
    }
    expect(SIU_WATCH_ENTITY_TYPES).toContain('unknown')
  })
})

describe('a designation is opened, never opened as already-cleared', () => {
  it('offers every designation except `cleared`', () => {
    // `cleared` is an OUTCOME recorded by siu_clear_target(). Offering it as an
    // opening position would let an agent create a row saying the unit looked
    // and cleared somebody when it never looked. The server refuses it too;
    // this list is the UI half of the same rule, and the two must not drift.
    expect(SIU_OPENABLE_DESIGNATIONS).not.toContain('cleared')
    for (const d of SIU_DESIGNATIONS) {
      if (d === 'cleared') continue
      expect(SIU_OPENABLE_DESIGNATIONS, `${d} must still be openable`).toContain(d)
    }
    expect(SIU_OPENABLE_DESIGNATIONS).toHaveLength(SIU_DESIGNATIONS.length - 1)
  })

  it('has wording for every designation, cleared included', () => {
    // Cleared is not offered in the picker but is very much displayed, so it
    // still needs a label — dropping it from the map would render a raw token
    // on exactly the rows somebody was exonerated on.
    for (const d of SIU_DESIGNATIONS) expect(SIU_DESIGNATION_LABEL[d]).toBeTruthy()
    expect(SIU_DESIGNATION_LABEL.cleared).toBeTruthy()
  })

  it('keeps target priority distinct from watch priority', () => {
    // siu_targets uses low|medium|high|critical and siu_watchlist uses
    // routine|priority|high_priority|critical. They are different check
    // constraints on different tables; collapsing them in the client would send
    // a value one of the two servers refuses.
    expect(SIU_TARGET_PRIORITIES).toEqual(['low', 'medium', 'high', 'critical'])
    for (const p of SIU_TARGET_PRIORITIES) expect(SIU_TARGET_PRIORITY_LABEL[p]).toBeTruthy()
    expect(SIU_TARGET_PRIORITIES as readonly string[]).not.toContain('routine')
    expect(SIU_WATCH_PRIORITIES as readonly string[]).not.toContain('medium')
  })
})

describe('fact and intelligence are told apart, using the registry\'s own columns', () => {
  it('treats an unqualified link as unproven, never as fact', () => {
    // The default matters more than the mapping: a link with nothing recorded
    // about how well it is held is exactly the one nobody should read as
    // confirmed.
    expect(siuLinkStrength({})).toBe('unconfirmed')
    expect(siuLinkStrength({ confidence: null, link_status: null })).toBe('unconfirmed')
  })

  it('reads confirmation off link_status, confidence or ownership_confidence', () => {
    // Three registries spell the same idea three ways —  person_vehicles and
    // person_places use link_status/confidence, account_links uses
    // ownership_confidence — so one helper has to understand all of them.
    expect(siuLinkStrength({ link_status: 'confirmed' })).toBe('confirmed')
    expect(siuLinkStrength({ confidence: 'high' })).toBe('confirmed')
    expect(siuLinkStrength({ ownership_confidence: 'confirmed' })).toBe('confirmed')
    expect(siuLinkStrength({ confidence: 'probable' })).toBe('probable')
    expect(siuLinkStrength({ ownership_confidence: 'medium' })).toBe('probable')
  })

  it('never promotes a refuted or severed link, however confident it once was', () => {
    // The status is the later fact. A link recorded at high confidence and
    // since refuted must not keep the confident chip.
    expect(siuLinkStrength({ link_status: 'refuted', confidence: 'high' })).toBe('unconfirmed')
    expect(siuLinkStrength({ rel_status: 'severed', confidence: 'confirmed' })).toBe('unconfirmed')
  })

  it('has wording for every strength it can produce', () => {
    for (const s of ['confirmed', 'probable', 'unconfirmed'] as const) {
      expect(SIU_LINK_STRENGTH_LABEL[s]).toBeTruthy()
    }
  })
})

describe('§30 — supporting access is time-boxed', () => {
  const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()

  it('is dead once expired or revoked, whatever else is true', () => {
    expect(tempAccessLive({ expires_at: iso(86_400_000) })).toBe(true)
    expect(tempAccessLive({ expires_at: iso(-1000) })).toBe(false)
    expect(tempAccessLive({ expires_at: iso(86_400_000), revoked_at: iso(-1000) })).toBe(false)
    expect(tempAccessLive({})).toBe(false)
  })

  it('caps a grant at 30 days — much shorter than a watch, deliberately', () => {
    // A supporting officer is borrowed for a task, not seconded to the unit.
    expect(SIU_TEMP_ACCESS_MAX_DAYS).toBe(30)
    expect(SIU_TEMP_ACCESS_MAX_DAYS).toBeLessThan(SIU_WATCH_MAX_DAYS)
  })
})

describe('Delivery B audit vocabulary', () => {
  it('names every new action rather than echoing the raw token', () => {
    for (const a of [
      'SIU_INTEL_GRADED', 'SIU_INTEL_REVIEWED', 'SIU_WATCH_ADDED',
      'SIU_WATCH_EXTENDED', 'SIU_WATCH_REMOVED',
      'SIU_TEMP_ACCESS_GRANTED', 'SIU_TEMP_ACCESS_REVOKED',
    ]) {
      expect(siuAuditLabel(a), `${a} needs human wording`).not.toBe(a)
    }
  })
})

describe('cross-department write gates — read is not write', () => {
  const cidCase = { case_authority: 'cid' }
  const siuCase = { case_authority: 'siu' }

  it('no longer makes a CID case read-only for an SIU member', () => {
    // It used to, mirroring can_access_case()'s `not is_siu_department()`.
    // That conjunct is gone, so an SIU member works CID like anyone else and a
    // read-only badge here would contradict a database that accepts the edit.
    const agent = { department: 'siu' as const, standing: 'special_agent' as const }
    expect(siuCaseReadOnly(agent, cidCase)).toBe(false)
    expect(siuCaseReadOnly(agent, siuCase)).toBe(false)
  })

  it('makes every SIU investigation read-only for oversight', () => {
    // The Director of CID and the AG read the unit's standard investigations
    // and work none of them — siu_case_access() admits only owner/field.
    const oversight = { department: 'cid' as const, standing: 'oversight' as const }
    expect(siuCaseReadOnly(oversight, siuCase)).toBe(true)
    // Oversight standing is a CID role holder: their CID rights are unchanged.
    expect(siuCaseReadOnly(oversight, cidCase)).toBe(false)
  })

  it('leaves an ordinary CID member entirely alone', () => {
    // The gate must NARROW, never widen, and must be inert for the 99% case.
    const cid = { department: 'cid' as const, standing: null }
    expect(siuCaseReadOnly(cid, cidCase)).toBe(false)
    expect(siuCaseReadOnly(cid, siuCase)).toBe(false)
    // A missing authority reads as CID, like caseDepartment() everywhere else.
    expect(siuCaseReadOnly(cid, {})).toBe(false)
    // A missing authority reads as a CID case, which is now editable by an
    // SIU member like any other.
    expect(siuCaseReadOnly({ department: 'siu', standing: 'special_agent' }, {})).toBe(false)
  })

  it('keeps the owner writing CID cases while they browse the SIU workspace', () => {
    // The owner holds SIU 'owner' standing but their DEPARTMENT is still cid
    // (userDepartment excludes oversight-only and unappointed accounts), so
    // switching workspace must not cost them their CID write rights.
    const owner = { department: 'cid' as const, standing: 'owner' as const }
    expect(siuCaseReadOnly(owner, cidCase)).toBe(false)
    expect(siuCaseReadOnly(owner, siuCase)).toBe(false)
  })

  it('lets every active SIU rank work a CID case', () => {
    // It used to be read-only: can_access_case() excluded the SIU department,
    // so an SIU member would edit a CID case and match zero rows. The exclusion
    // is gone (siu_members_work_cid), so the control is real.
    for (const r of ['special_agent', 'senior_special_agent', 'special_agent_in_charge', 'owner'] as const) {
      expect(siuCaseReadOnly({ department: 'siu', standing: r }, cidCase), r).toBe(false)
    }
  })

  it('keeps oversight out of SIU work without touching their CID rights', () => {
    // The Attorney General supervises SIU and works none of its
    // investigations. Their CID rights come from their own CID role, and this
    // gate must not quietly strip them.
    expect(siuCaseReadOnly({ department: 'cid', standing: 'oversight' }, siuCase)).toBe(true)
    expect(siuCaseReadOnly({ department: 'cid', standing: 'oversight' }, cidCase)).toBe(false)
  })
})

describe('Director access requests — the right to ASK, not to see', () => {
  const director = live({ profile: profile({ role: 'director' }) })

  it('gives the Director the ask, and nothing else', () => {
    // This is the ONE place a CID role confers something in the SIU model, and
    // what it confers is a request. It must not leak back into standing.
    expect(siuMayRequestAccess(director)).toBe(true)
    expect(siuStanding(director)).toBeNull()
    expect(siuOperates(director)).toBe(false)
    expect(siuCanAppoint(director)).toBe(false)
    expect(siuCaseAccess(director, { siu_classification: 'siu' })).toBe(false)
  })

  it('is offered to nobody else', () => {
    for (const role of ROLE_ORDER.filter((r) => r !== 'director')) {
      expect(siuMayRequestAccess(live({ profile: profile({ role }) })), `${role}`).toBe(false)
    }
    // Not to SIU's own people either — they reach investigations directly.
    expect(siuMayRequestAccess(live({ membership: member() }))).toBe(false)
    expect(siuMayRequestAccess(live({ justiceRole: 'attorney_general' }))).toBe(false)
    // An inactive Director asks for nothing.
    expect(siuMayRequestAccess(live({ profile: profile({ role: 'director', active: false }) }))).toBe(false)
  })

  it('labels every request state', () => {
    for (const st of SIU_ACCESS_REQUEST_STATUSES) {
      expect(SIU_ACCESS_REQUEST_STATUS_LABEL[st], `${st} needs a label`).toBeTruthy()
    }
    // "Awaiting X-1" names who is actually holding it — the §38 principle.
    expect(siuAccessStatusLabel('pending')).toBe('Awaiting X-1')
    expect(siuAccessStatusLabel(null)).toBe('—')
  })

  it('names the new audit actions', () => {
    for (const a of ['SIU_ACCESS_REQUESTED', 'SIU_ACCESS_DECIDED', 'SIU_ACCESS_WITHDRAWN']) {
      expect(siuAuditLabel(a), `${a} needs human wording`).not.toBe(a)
    }
  })
})
