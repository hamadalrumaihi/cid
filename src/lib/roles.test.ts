/** Table-tests for the client mirror of the server authority matrix
 *  (private.can_assign_cid_role, 20260718010000_unified_role_policy.sql).
 *  These helpers only shape UI options — the RPCs re-validate everything —
 *  but the two implementations must agree, so the matrix is pinned here. */
import { describe, expect, it } from 'vitest'
import {
  PERMANENT_BUREAUS, ROLE_ORDER, canApproveRequestedRole, canAssignCidRole,
  canChangeRole, canDecideTransferSide, canTransfer, getAssignableRoles,
  getRequestableRoles, getValidDepartments, type RoleParty,
} from './roles'

const lsbLead: RoleParty = { id: 'lead', role: 'bureau_lead', division: 'LSB', active: true, is_owner: false }
const deputy: RoleParty = { id: 'dd', role: 'deputy_director', division: 'SAB', active: true, is_owner: false }
const director: RoleParty = { id: 'dir', role: 'director', division: 'SAB', active: true, is_owner: false }
const owner: RoleParty = { id: 'own', role: 'detective', division: 'SAB', active: true, is_owner: true }
const inactiveDirector: RoleParty = { id: 'idir', role: 'director', division: 'SAB', active: false, is_owner: false }
const detective: RoleParty = { id: 'det', role: 'detective', division: 'LSB', active: true, is_owner: false }
const judgeLike: RoleParty = { id: 'j', role: 'detective', division: 'LSB', active: false, is_owner: false }

describe('policy lists', () => {
  it('every normal CID role is requestable; Owner never appears', () => {
    expect(getRequestableRoles('cid')).toEqual(ROLE_ORDER)
    expect(getRequestableRoles('cid')).not.toContain('owner')
    expect(getRequestableRoles('doj')).toHaveLength(0)
  })
  it('permanent departments exclude JTF', () => {
    expect(getValidDepartments()).toEqual(PERMANENT_BUREAUS)
    expect(getValidDepartments()).not.toContain('JTF')
  })
})

describe('canAssignCidRole — the matrix', () => {
  it('Bureau Lead: rank-and-file in own bureau only', () => {
    expect(canAssignCidRole(lsbLead, 'detective', 'LSB')).toBe(true)
    expect(canAssignCidRole(lsbLead, 'senior_detective', 'LSB')).toBe(true)
    expect(canAssignCidRole(lsbLead, 'detective', 'BCB')).toBe(false)
    expect(canAssignCidRole(lsbLead, 'bureau_lead', 'LSB')).toBe(false)
  })
  it('Deputy Director: up to Bureau Lead, any bureau', () => {
    expect(canAssignCidRole(deputy, 'detective', 'LSB')).toBe(true)
    expect(canAssignCidRole(deputy, 'bureau_lead', 'BCB')).toBe(true)
    expect(canAssignCidRole(deputy, 'deputy_director', 'SAB')).toBe(false)
    expect(canAssignCidRole(deputy, 'director', 'SAB')).toBe(false)
  })
  it('Director: up to Deputy Director; Director needs the Owner', () => {
    expect(canAssignCidRole(director, 'deputy_director', 'LSB')).toBe(true)
    expect(canAssignCidRole(director, 'director', 'LSB')).toBe(false)
    expect(canAssignCidRole(owner, 'director', 'LSB')).toBe(true)
  })
  it('inactive and non-command actors assign nothing', () => {
    expect(canAssignCidRole(inactiveDirector, 'detective', 'SAB')).toBe(false)
    expect(canAssignCidRole(detective, 'detective', 'LSB')).toBe(false)
    expect(canAssignCidRole(judgeLike, 'detective', 'LSB')).toBe(false)
    expect(canAssignCidRole(null, 'detective', 'LSB')).toBe(false)
  })
  it('retired/unknown roles are never assignable', () => {
    expect(canAssignCidRole(owner, 'supervisor', 'LSB')).toBe(false)
    expect(canAssignCidRole(owner, 'command', 'LSB')).toBe(false)
    expect(canApproveRequestedRole(owner, 'owner', 'LSB')).toBe(false)
  })
})

describe('canChangeRole / getAssignableRoles', () => {
  const target: RoleParty = { id: 't', role: 'detective', division: 'LSB', active: true }
  it('requires authority over both old and new role — never yourself', () => {
    expect(canChangeRole(lsbLead, target, 'senior_detective')).toBe(true)
    expect(canChangeRole(lsbLead, target, 'bureau_lead')).toBe(false)
    expect(canChangeRole(lsbLead, { ...target, id: 'lead' }, 'senior_detective')).toBe(false) // self
    // demoting a Director needs the Owner (authority over the OLD role)
    const dirTarget: RoleParty = { id: 'x', role: 'director', division: 'LSB', active: true }
    expect(canChangeRole(director, dirTarget, 'detective')).toBe(false)
    expect(canChangeRole(owner, dirTarget, 'detective')).toBe(true)
  })
  it('members without a permanent bureau (JTF sentinel) are not role-changeable', () => {
    expect(canChangeRole(owner, { id: 'y', role: 'detective', division: 'JTF', active: true }, 'senior_detective')).toBe(false)
  })
  it('option list mirrors the matrix', () => {
    expect(getAssignableRoles(lsbLead, target)).toEqual(['senior_detective'])
    expect(getAssignableRoles(deputy, target)).toEqual(['senior_detective', 'bureau_lead'])
  })
})

describe('canTransfer / canDecideTransferSide', () => {
  const det: RoleParty = { id: 't', role: 'detective', division: 'LSB', active: true }
  it('Bureau Lead may initiate when one side is their bureau, rank-and-file only', () => {
    expect(canTransfer(lsbLead, det, 'LSB', 'BCB')).toBe(true)  // outbound
    expect(canTransfer(lsbLead, { ...det, division: 'BCB' }, 'BCB', 'LSB')).toBe(true) // inbound request
    expect(canTransfer(lsbLead, { ...det, division: 'BCB' }, 'BCB', 'SAB')).toBe(false) // neither side
    expect(canTransfer(lsbLead, { id: 'c', role: 'bureau_lead', division: 'LSB', active: true }, 'LSB', 'BCB')).toBe(false) // command staff
  })
  it('JTF is never a source or destination; never yourself', () => {
    expect(canTransfer(owner, det, 'LSB', 'JTF')).toBe(false)
    expect(canTransfer(owner, { ...det, division: 'JTF' }, 'JTF', 'LSB')).toBe(false)
    expect(canTransfer(lsbLead, { ...det, id: 'lead' }, 'LSB', 'BCB')).toBe(false)
  })
  it("higher command may initiate anywhere; sides are decided by that bureau's lead or DD+", () => {
    expect(canTransfer(deputy, det, 'LSB', 'BCB')).toBe(true)
    expect(canDecideTransferSide(lsbLead, 'LSB')).toBe(true)
    expect(canDecideTransferSide(lsbLead, 'BCB')).toBe(false)
    expect(canDecideTransferSide(director, 'BCB')).toBe(true)
    expect(canDecideTransferSide(detective, 'LSB')).toBe(false)
  })
})
