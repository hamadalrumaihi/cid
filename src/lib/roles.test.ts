/** Table-tests for the client mirror of the server authority matrix
 *  (private.can_assign_cid_role, 20260718010000_unified_role_policy.sql).
 *  These helpers only shape UI options — the RPCs re-validate everything —
 *  but the two implementations must agree, so the matrix is pinned here. */
import { describe, expect, it } from 'vitest'
import * as rolesModule from './roles'
import {
  BUREAUS, BUREAU_SHORT, CASE_PREFIX, PERMANENT_BUREAUS, ROLE_ORDER,
  bureauLabel, bureauShort, canApproveRequestedRole, canAssignCidRole,
  canChangeRole, canDecideTransferSide, canRemoveMember, canRestoreMember, canTransfer, getAssignableRoles,
  getRequestableRoles, getValidDepartments, isSibBureau, type RoleParty,
} from './roles'

const mcbLead: RoleParty = { id: 'lead', role: 'bureau_lead', division: 'major_crimes', active: true, is_owner: false }
const deputy: RoleParty = { id: 'dd', role: 'deputy_director', division: 'street_crimes', active: true, is_owner: false }
const director: RoleParty = { id: 'dir', role: 'director', division: 'street_crimes', active: true, is_owner: false }
const owner: RoleParty = { id: 'own', role: 'detective', division: 'street_crimes', active: true, is_owner: true }
const inactiveDirector: RoleParty = { id: 'idir', role: 'director', division: 'street_crimes', active: false, is_owner: false }
const detective: RoleParty = { id: 'det', role: 'detective', division: 'major_crimes', active: true, is_owner: false }
const judgeLike: RoleParty = { id: 'j', role: 'detective', division: 'major_crimes', active: false, is_owner: false }

describe('bureau vocabulary — restructure model', () => {
  it('pins the bureau ids, labels, short codes, and case prefixes', () => {
    expect(Object.keys(BUREAUS).sort()).toEqual(['JTF', 'major_crimes', 'special_investigations', 'street_crimes'])
    expect(BUREAUS['major_crimes']).toBe('Major Crimes Bureau')
    expect(BUREAUS['street_crimes']).toBe('Street Crimes Bureau')
    expect(BUREAUS['special_investigations']).toBe('Special Investigations Bureau')
    expect(BUREAUS['JTF']).toBe('Joint Task Force')
    expect(BUREAU_SHORT).toEqual({ major_crimes: 'Major Crimes', street_crimes: 'Street Crimes', special_investigations: 'SIB', JTF: 'JTF' })
    expect(CASE_PREFIX).toEqual({ major_crimes: 'MCB', street_crimes: 'SCB', special_investigations: 'SIB', JTF: 'JTF' })
  })
  it('bureauShort/bureauLabel resolve ids and fall back to raw historical codes', () => {
    expect(bureauShort('major_crimes')).toBe('Major Crimes')
    expect(bureauShort('SAB')).toBe('SAB') // frozen historical value renders verbatim
    expect(bureauShort(null)).toBe('—')
    expect(bureauLabel('street_crimes')).toBe('Street Crimes Bureau')
    expect(bureauLabel('SAB')).toBe('SAB')
  })
  it('isSibBureau flags only special_investigations', () => {
    expect(isSibBureau('special_investigations')).toBe(true)
    expect(isSibBureau('major_crimes')).toBe(false)
    expect(isSibBureau(null)).toBe(false)
  })
  it('the LSPD/BCSO/SAHP agency mapping is deleted', () => {
    expect('deptLabel' in rolesModule).toBe(false)
    expect('DEPT_OF_BUREAU' in rolesModule).toBe(false)
  })
})

describe('policy lists', () => {
  it('every normal CID role is requestable; Owner never appears', () => {
    expect(getRequestableRoles('cid')).toEqual(ROLE_ORDER)
    expect(getRequestableRoles('cid')).not.toContain('owner')
    expect(getRequestableRoles('doj')).toHaveLength(0)
  })
  it('permanent departments are exactly Major/Street Crimes — no JTF, no SIB', () => {
    expect(PERMANENT_BUREAUS).toEqual(['major_crimes', 'street_crimes'])
    expect(getValidDepartments()).toEqual(PERMANENT_BUREAUS)
    expect(getValidDepartments()).not.toContain('JTF')
    expect(getValidDepartments()).not.toContain('special_investigations')
  })
})

describe('canAssignCidRole — the matrix', () => {
  it('Bureau Lead: rank-and-file in own bureau only', () => {
    expect(canAssignCidRole(mcbLead, 'detective', 'major_crimes')).toBe(true)
    expect(canAssignCidRole(mcbLead, 'senior_detective', 'major_crimes')).toBe(true)
    expect(canAssignCidRole(mcbLead, 'detective', 'street_crimes')).toBe(false)
    expect(canAssignCidRole(mcbLead, 'bureau_lead', 'major_crimes')).toBe(false)
  })
  it('Deputy Director: up to Bureau Lead, any bureau', () => {
    expect(canAssignCidRole(deputy, 'detective', 'major_crimes')).toBe(true)
    expect(canAssignCidRole(deputy, 'bureau_lead', 'street_crimes')).toBe(true)
    expect(canAssignCidRole(deputy, 'deputy_director', 'street_crimes')).toBe(false)
    expect(canAssignCidRole(deputy, 'director', 'street_crimes')).toBe(false)
  })
  it('Director: up to Deputy Director; Director needs the Owner', () => {
    expect(canAssignCidRole(director, 'deputy_director', 'major_crimes')).toBe(true)
    expect(canAssignCidRole(director, 'director', 'major_crimes')).toBe(false)
    expect(canAssignCidRole(owner, 'director', 'major_crimes')).toBe(true)
  })
  it('inactive and non-command actors assign nothing', () => {
    expect(canAssignCidRole(inactiveDirector, 'detective', 'street_crimes')).toBe(false)
    expect(canAssignCidRole(detective, 'detective', 'major_crimes')).toBe(false)
    expect(canAssignCidRole(judgeLike, 'detective', 'major_crimes')).toBe(false)
    expect(canAssignCidRole(null, 'detective', 'major_crimes')).toBe(false)
  })
  it('retired/unknown roles are never assignable', () => {
    expect(canAssignCidRole(owner, 'supervisor', 'major_crimes')).toBe(false)
    expect(canAssignCidRole(owner, 'command', 'major_crimes')).toBe(false)
    expect(canApproveRequestedRole(owner, 'owner', 'major_crimes')).toBe(false)
  })
})

describe('canChangeRole / getAssignableRoles', () => {
  const target: RoleParty = { id: 't', role: 'detective', division: 'major_crimes', active: true }
  it('requires authority over both old and new role — never yourself', () => {
    expect(canChangeRole(mcbLead, target, 'senior_detective')).toBe(true)
    expect(canChangeRole(mcbLead, target, 'bureau_lead')).toBe(false)
    expect(canChangeRole(mcbLead, { ...target, id: 'lead' }, 'senior_detective')).toBe(false) // self
    // demoting a Director needs the Owner (authority over the OLD role)
    const dirTarget: RoleParty = { id: 'x', role: 'director', division: 'major_crimes', active: true }
    expect(canChangeRole(director, dirTarget, 'detective')).toBe(false)
    expect(canChangeRole(owner, dirTarget, 'detective')).toBe(true)
  })
  it('members without a permanent bureau (JTF sentinel, SIB) are not role-changeable', () => {
    expect(canChangeRole(owner, { id: 'y', role: 'detective', division: 'JTF', active: true }, 'senior_detective')).toBe(false)
    expect(canChangeRole(owner, { id: 'z', role: 'detective', division: 'special_investigations', active: true }, 'senior_detective')).toBe(false)
  })
  it('option list mirrors the matrix', () => {
    expect(getAssignableRoles(mcbLead, target)).toEqual(['senior_detective'])
    expect(getAssignableRoles(deputy, target)).toEqual(['senior_detective', 'bureau_lead'])
  })
})

describe('canTransfer / canDecideTransferSide', () => {
  const det: RoleParty = { id: 't', role: 'detective', division: 'major_crimes', active: true }
  it('Bureau Lead may initiate when one side is their bureau, rank-and-file only', () => {
    expect(canTransfer(mcbLead, det, 'major_crimes', 'street_crimes')).toBe(true)  // outbound
    expect(canTransfer(mcbLead, { ...det, division: 'street_crimes' }, 'street_crimes', 'major_crimes')).toBe(true) // inbound request
    expect(canTransfer(mcbLead, { ...det, division: 'street_crimes' }, 'street_crimes', 'JTF')).toBe(false) // neither side
    expect(canTransfer(mcbLead, { id: 'c', role: 'bureau_lead', division: 'major_crimes', active: true }, 'major_crimes', 'street_crimes')).toBe(false) // command staff
  })
  it('JTF is a valid source and destination; unknown bureaus and yourself are not', () => {
    expect(canTransfer(owner, det, 'major_crimes', 'JTF')).toBe(true)
    expect(canTransfer(owner, { ...det, division: 'JTF' }, 'JTF', 'major_crimes')).toBe(true)
    expect(canTransfer(deputy, { ...det, division: 'JTF' }, 'JTF', 'street_crimes')).toBe(true)
    expect(canTransfer(owner, det, 'major_crimes', 'major_crimes')).toBe(false)     // same department
    expect(canTransfer(owner, det, 'major_crimes', 'DOJ')).toBe(false)              // not a CID department
    expect(canTransfer(mcbLead, { ...det, id: 'lead' }, 'major_crimes', 'street_crimes')).toBe(false) // never yourself
  })
  it('SIB is never a transfer side — membership moves only via the SIB appointment workflow', () => {
    expect(canTransfer(owner, det, 'major_crimes', 'special_investigations')).toBe(false)
    expect(canTransfer(owner, { ...det, division: 'special_investigations' }, 'special_investigations', 'major_crimes')).toBe(false)
    expect(canTransfer(director, det, 'special_investigations', 'JTF')).toBe(false)
  })
  it("higher command may initiate anywhere; sides are decided by that bureau's lead or DD+", () => {
    expect(canTransfer(deputy, det, 'major_crimes', 'street_crimes')).toBe(true)
    expect(canDecideTransferSide(mcbLead, 'major_crimes')).toBe(true)
    expect(canDecideTransferSide(mcbLead, 'street_crimes')).toBe(false)
    expect(canDecideTransferSide(director, 'street_crimes')).toBe(true)
    expect(canDecideTransferSide(detective, 'major_crimes')).toBe(false)
  })
})

describe('canRemoveMember / canRestoreMember — the admin_remove/restore matrix', () => {
  const scbDet: RoleParty = { id: 'bdet', role: 'detective', division: 'street_crimes', active: true }
  it('Bureau Lead: own-bureau rank-and-file only; never restore', () => {
    expect(canRemoveMember(mcbLead, detective)).toBe(true)
    expect(canRemoveMember(mcbLead, scbDet)).toBe(false)                                   // other bureau
    expect(canRemoveMember(mcbLead, { ...detective, role: 'bureau_lead' })).toBe(false)    // command target
    expect(canRestoreMember(mcbLead)).toBe(false)
  })
  it('Deputy Director: anyone below Deputy; Director: anyone but owners', () => {
    expect(canRemoveMember(deputy, { ...scbDet, role: 'bureau_lead' })).toBe(true)
    expect(canRemoveMember(deputy, { id: 'x', role: 'director', division: 'street_crimes', active: true })).toBe(false)
    expect(canRemoveMember(director, { id: 'x', role: 'deputy_director', division: 'major_crimes', active: true })).toBe(true)
    expect(canRemoveMember(director, owner)).toBe(false)                                   // owner target
    expect(canRemoveMember(owner, director)).toBe(true)
  })
  it('never yourself, never system accounts; restore is Director+', () => {
    expect(canRemoveMember(director, director)).toBe(false)
    expect(canRemoveMember(owner, { id: 'sys', role: 'detective', active: true, is_system: true })).toBe(false)
    expect(canRestoreMember(director)).toBe(true)
    expect(canRestoreMember(owner)).toBe(true)
    expect(canRestoreMember(deputy)).toBe(false)
  })
})
