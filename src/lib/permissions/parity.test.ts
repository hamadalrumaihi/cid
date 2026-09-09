/** Parity suite (P1-08): the pure mirrors against the generated matrix and
 *  the server contract of my_permissions(). The matrix is rendered from the
 *  migrations' permission_catalog seed, so a mirror that disagrees with a
 *  ✓ / ✗ cell disagrees with the documented server rule. Cells that read
 *  as record-dependent ("case access", "bureau / global") are exactly the
 *  questions `canRecord()` exists for. */
import { describe, expect, it } from 'vitest'
import {
  NO_ACCESS, PERMISSIONS_MATRIX, SIGNOFF_AWAITING, canAssignIntel, canDecideCidTransfer, canDeleteIntel,
  canGrantCaseByRole, canOverrideSignoff, canReassignBureau, canReassignCaseWork, canRejectIntel, canRestoreIntel, canReviewSignoff,
  canUndeleteIntel, canValidateIntel, effectiveDojRole, isBureauCommandFor, isCommandRole, isDeputyOrDirector,
  isSignoffOwner, isSignoffReviewer, matrixCan, matrixColumnFor, normalizePermissions, type MyPermissions,
} from './index'

const perms = (over: Partial<MyPermissions>): MyPermissions => ({ ...NO_ACCESS, ...over })
const owner = perms({ access_class: 'owner', active: true, is_owner: true, role: 'director' })
const command = perms({ access_class: 'command', active: true, role: 'bureau_lead', bureau: 'major_crimes' })
const member = perms({ access_class: 'member', active: true, role: 'detective', bureau: 'major_crimes' })
const inactive = perms({ access_class: 'inactive' })

describe('matrix cells vs mirrors', () => {
  it('reads ✓ / ✗ cells as booleans and everything else as record-dependent', () => {
    expect(matrixCan(owner, 'delete', 'person')).toBe(true)
    expect(matrixCan(command, 'delete', 'person')).toBe(true)
    expect(matrixCan(member, 'delete', 'person')).toBe(false)
    expect(matrixCan(inactive, 'delete', 'person')).toBe(false)
    expect(matrixCan(member, 'read', 'case')).toBeNull()     // "case access"
    expect(matrixCan(member, 'no_such_action', 'person')).toBe(false)
  })
  it('falls back to the wildcard kind', () => {
    expect(matrixCan(owner, 'permanent_delete', 'vehicle')).toBe(true)   // ('permanent_delete','*')
    expect(matrixCan(command, 'permanent_delete', 'vehicle')).toBe(false)
    expect(matrixCan(member, 'read_history', 'person')).toBeNull()      // "read access"
  })
  it('maps every access class onto a matrix column', () => {
    expect(matrixColumnFor('owner')).toBe('owner')
    expect(matrixColumnFor('command')).toBe('command')
    expect(matrixColumnFor('member')).toBe('member')
    for (const c of ['justice', 'field', 'inactive', 'none'] as const) expect(matrixColumnFor(c)).toBe('inactive')
  })
  it('registry deletion: the ✓ column is exactly the command roles (isCommandRole)', () => {
    const row = PERMISSIONS_MATRIX.find((r) => r.key === 'delete/person')!
    expect(row.command.startsWith('✓')).toBe(true)
    expect(row.member.startsWith('✗')).toBe(true)
    expect(isCommandRole('bureau_lead')).toBe(true)
    expect(isCommandRole('detective')).toBe(false)
    expect(isCommandRole('command')).toBe(false) // retired value
  })
  it('grant_access: command by role, the lead per case', () => {
    const row = PERMISSIONS_MATRIX.find((r) => r.key === 'grant_access/case')!
    expect(row.command.startsWith('✓')).toBe(true)
    expect(canGrantCaseByRole({ role: 'bureau_lead' })).toBe(true)
    expect(canGrantCaseByRole({ role: 'detective' })).toBe(false)
    expect(canGrantCaseByRole({ role: 'detective', is_owner: true })).toBe(true)
  })
  it('reassign case work (Phase 7 §2.6): the case lead, command or the Owner — active only, never null', () => {
    const c = { lead_detective_id: 'lead' }
    expect(canReassignCaseWork(c, { id: 'lead', role: 'detective', active: true })).toBe(true)
    expect(canReassignCaseWork(c, { id: 'other', role: 'detective', active: true })).toBe(false)
    expect(canReassignCaseWork(c, { id: 'bl', role: 'bureau_lead', active: true })).toBe(true)
    expect(canReassignCaseWork(c, { id: 'dd', role: 'deputy_director', active: true })).toBe(true)
    expect(canReassignCaseWork(c, { id: 'o', role: 'detective', active: true, is_owner: true })).toBe(true)
    expect(canReassignCaseWork(c, { id: 'lead', role: 'detective', active: false })).toBe(false)
    expect(canReassignCaseWork(c, { id: 'bl', role: 'bureau_lead', active: false })).toBe(false)
    expect(canReassignCaseWork({ lead_detective_id: null }, { id: 'd', role: 'detective', active: true })).toBe(false)
    expect(canReassignCaseWork(c, null)).toBe(false)
    expect(canReassignCaseWork(c, { role: 'director', active: true })).toBe(false) // no id → no viewer
  })
})

describe('normalizePermissions — deny by default', () => {
  it('reads a malformed or empty payload as NO_ACCESS', () => {
    expect(normalizePermissions(null)).toBe(NO_ACCESS)
    expect(normalizePermissions({})).toBe(NO_ACCESS)
    expect(normalizePermissions('nope')).toBe(NO_ACCESS)
  })
  it('fills missing sub-objects so consumers never null-check', () => {
    const p = normalizePermissions({ access_class: 'member', active: true, role: 'detective' })
    expect(p.expiries.case_access_grants).toEqual([])
    expect(p.flags.sib_may_switch).toBe(false)
    expect(p.doj_role).toBeNull()
  })
})

describe('consolidated CID predicates (formerly duplicated across components)', () => {
  it('Deputy Director+ or the Owner decide CID transfer stages and bureau reassignments', () => {
    for (const fn of [canDecideCidTransfer, canReassignBureau]) {
      expect(fn({ role: 'director' })).toBe(true)
      expect(fn({ role: 'deputy_director' })).toBe(true)
      expect(fn({ role: 'bureau_lead' })).toBe(false)
      expect(fn({ role: 'detective', is_owner: true })).toBe(true)
    }
    expect(isDeputyOrDirector('bureau_lead')).toBe(false)
  })
  it('bureau command over a case: the bureau\'s own Lead / Director, or a Deputy Director anywhere', () => {
    expect(isBureauCommandFor({ role: 'bureau_lead', division: 'major_crimes' }, 'major_crimes')).toBe(true)
    expect(isBureauCommandFor({ role: 'bureau_lead', division: 'street_crimes' }, 'major_crimes')).toBe(false)
    expect(isBureauCommandFor({ role: 'deputy_director', division: 'street_crimes' }, 'major_crimes')).toBe(true)
    expect(isBureauCommandFor({ role: 'director', division: 'street_crimes' }, 'major_crimes')).toBe(true)
    expect(isBureauCommandFor({ role: 'command', division: 'major_crimes' }, 'major_crimes')).toBe(false)
  })
  it('sign-off routing: the routed assignee or the rank the stage waits on', () => {
    const lead = { id: 'l1', role: 'bureau_lead', division: 'major_crimes' }
    expect(canReviewSignoff({ signoff_status: 'awaiting_bureau_lead', bureau: 'major_crimes' }, lead)).toBe(true)
    expect(canReviewSignoff({ signoff_status: 'awaiting_bureau_lead', bureau: 'street_crimes' }, lead)).toBe(false)
    expect(canReviewSignoff({ signoff_status: 'awaiting_deputy' }, { id: 'd', role: 'deputy_director' })).toBe(true)
    expect(canReviewSignoff({ signoff_status: 'awaiting_director', signoff_assignee_id: 'x' }, { id: 'x', role: 'detective' })).toBe(true)
    expect(canReviewSignoff({ signoff_status: 'approved_deputy' }, { id: 'd', role: 'deputy_director' })).toBe(true)
    expect(canReviewSignoff({ signoff_status: 'none' }, lead)).toBe(false)
    expect(canReviewSignoff({ signoff_status: 'awaiting_deputy' }, null)).toBe(false)
    expect([...SIGNOFF_AWAITING]).toEqual(['awaiting_bureau_lead', 'awaiting_deputy', 'awaiting_director'])
  })
  it('sign-off decision: assignee or any Director, never the owner; override is DD+/Owner, never a Lead', () => {
    const c = { signoff_stage: 'bureau_lead', signoff_assignee_id: 'a', lead_detective_id: 'lead', signoff_submitted_by: 'sub' }
    expect(isSignoffOwner(c, 'lead')).toBe(true)
    expect(isSignoffOwner(c, 'sub')).toBe(true)
    expect(isSignoffReviewer(c, { id: 'a', role: 'detective' })).toBe(true)
    expect(isSignoffReviewer(c, { id: 'dir', role: 'director' })).toBe(true)
    expect(isSignoffReviewer(c, { id: 'lead', role: 'director' })).toBe(false)
    expect(isSignoffReviewer({ ...c, signoff_stage: null }, { id: 'a' })).toBe(false)
    expect(canOverrideSignoff({ role: 'bureau_lead', active: true })).toBe(false)
    expect(canOverrideSignoff({ role: 'deputy_director', active: true })).toBe(true)
    expect(canOverrideSignoff({ role: 'detective', active: true, is_owner: true })).toBe(true)
    expect(canOverrideSignoff({ role: 'director', active: false })).toBe(false)
  })
  it('effective DOJ role: legacy ADA/DA titles act as prosecutor', () => {
    expect(effectiveDojRole('assistant_district_attorney')).toBe('prosecutor')
    expect(effectiveDojRole('district_attorney')).toBe('prosecutor')
    expect(effectiveDojRole('judge')).toBe('judge')
    expect(effectiveDojRole('attorney_general')).toBe('attorney_general')
    expect(effectiveDojRole('clerk')).toBeNull()
  })
})

describe('intel triage mirrors (perm_dispatch kind field_submission, Phase 6 §8)', () => {
  const lead = { id: 'l', role: 'bureau_lead', active: true }
  const det = { id: 'd', role: 'detective', active: true }
  const owner = { id: 'o', role: 'detective', active: true, is_owner: true }
  const inactiveLead = { id: 'i', role: 'bureau_lead', active: false }

  it('reject: any active reviewer, on a submitted record that is still open to a decision', () => {
    for (const s of ['new', 'reviewing', 'needs_info', 'reviewed', 'actionable']) expect(canRejectIntel(s), s).toBe(true)
    for (const s of ['draft', 'archived', 'rejected', null, undefined]) expect(canRejectIntel(s), String(s)).toBe(false)
  })

  it('restore: from archived any active reviewer, from rejected a Bureau Lead or above (is_command — the Owner flag alone does not count)', () => {
    expect(canRestoreIntel('archived', det)).toBe(true)
    expect(canRestoreIntel('archived', inactiveLead)).toBe(false)
    expect(canRestoreIntel('rejected', det)).toBe(false)
    expect(canRestoreIntel('rejected', lead)).toBe(true)
    expect(canRestoreIntel('rejected', { id: 'x', role: 'director', active: true })).toBe(true)
    expect(canRestoreIntel('rejected', owner)).toBe(false)
    expect(canRestoreIntel('rejected', inactiveLead)).toBe(false)
    expect(canRestoreIntel('reviewing', lead)).toBe(false)
    expect(canRestoreIntel('archived', null)).toBe(false)
  })

  it('validate: never a draft, never a closed record', () => {
    for (const s of ['new', 'reviewing', 'needs_info', 'reviewed', 'actionable']) expect(canValidateIntel(s), s).toBe(true)
    for (const s of ['draft', 'archived', 'rejected', null]) expect(canValidateIntel(s), String(s)).toBe(false)
  })

  it('assign and delete are command; undelete is the Owner', () => {
    for (const fn of [canAssignIntel, canDeleteIntel]) {
      expect(fn(lead)).toBe(true)
      expect(fn(det)).toBe(false)
      expect(fn(owner)).toBe(false)
      expect(fn(inactiveLead)).toBe(false)
      expect(fn(null)).toBe(false)
    }
    expect(canUndeleteIntel(owner)).toBe(true)
    expect(canUndeleteIntel(lead)).toBe(false)
    expect(canUndeleteIntel(null)).toBe(false)
  })

  it('agrees with the generated matrix once the Phase 6 catalog rows land', () => {
    // The rows (reject … undelete on kind field_submission, sort 390–480) are
    // regenerated by `npm run gen:permissions` after the migration; until then
    // the lookups are simply absent and this assertion is vacuous.
    const cell = (action: string) => PERMISSIONS_MATRIX.find((r) => r.key === `${action}/field_submission`)
    const assign = cell('assign'); const undelete = cell('undelete'); const del = cell('delete')
    if (assign) { expect(assign.command.startsWith('✓')).toBe(true); expect(assign.member.startsWith('✗')).toBe(true) }
    if (del) { expect(del.command.startsWith('✓')).toBe(true); expect(del.member.startsWith('✗')).toBe(true) }
    if (undelete) { expect(undelete.owner.startsWith('✓')).toBe(true); expect(undelete.command.startsWith('✗')).toBe(true) }
  })
})
