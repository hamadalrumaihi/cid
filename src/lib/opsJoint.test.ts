/** Pins for the pure Joint/JTF-operations model — the client mirrors of the
 *  20260810120000 server rules. History-vs-access separation is the core
 *  contract: markers never disappear on closure/removal; access always does. */
import { describe, expect, it } from 'vitest'
import {
  activeBureaus, canLinkCaseToOp, canManageOperation, canUnlinkCaseFromOp,
  caseJointInfo, isOpEnded, jointReasonText, operationTimeline, type OpViewer,
} from './opsJoint'

const T0 = '2026-08-01T00:00:00Z'
const T1 = '2026-08-02T00:00:00Z'
const T2 = '2026-08-03T00:00:00Z'

const caseBase = { is_joint_case: false, joint_case_ended_at: null }
const ops = new Map([
  ['op1', { id: 'op1', name: 'Black Cross', status: 'active', op_type: 'jtf' }],
  ['op2', { id: 'op2', name: 'Street Sweep', status: 'resolved', op_type: 'jtf' }],
  ['op3', { id: 'op3', name: 'Quiet Harbor', status: 'active', op_type: 'normal' }],
])

describe('caseJointInfo', () => {
  it('an active link to an active JTF op is joint via that operation', () => {
    const info = caseJointInfo(caseBase, [
      { operation_id: 'op1', removed_at: null, added_at: T1, was_jtf: true },
    ], ops)
    expect(info.activeVia?.opId).toBe('op1')
    expect(info.everJoint).toBe(true)
  })

  it('normal-operation links are coordination, not joint', () => {
    const info = caseJointInfo(caseBase, [
      { operation_id: 'op3', removed_at: null, added_at: T1, was_jtf: false },
    ], ops)
    expect(info.activeVia).toBeNull()
    expect(info.operations).toHaveLength(0)
    expect(info.everJoint).toBe(false)
  })

  it('operation resolution ends ACCESS but the historical marker stays', () => {
    const info = caseJointInfo(caseBase, [
      { operation_id: 'op2', removed_at: null, added_at: T1, was_jtf: true },
    ], ops)
    expect(info.activeVia).toBeNull()             // no active joint scope
    expect(info.operations[0]).toMatchObject({ opId: 'op2', linked: true, active: false })
    expect(info.everJoint).toBe(true)             // JOINT badge persists
  })

  it('manual removal from the op keeps the permanent participation record', () => {
    const info = caseJointInfo(caseBase, [
      { operation_id: 'op1', removed_at: T2, added_at: T1, was_jtf: true },
    ], ops)
    expect(info.activeVia).toBeNull()
    expect(info.operations[0]).toMatchObject({ linked: false })
    expect(info.everJoint).toBe(true)
  })

  it('manual joint-case flag and operation joint compose without overwriting', () => {
    const info = caseJointInfo({ is_joint_case: true, joint_case_ended_at: null }, [
      { operation_id: 'op2', removed_at: null, added_at: T1, was_jtf: true },
    ], ops)
    expect(info.manualJoint).toBe(true)
    expect(info.operations).toHaveLength(1)
    const text = jointReasonText(info)
    expect(text).toContain('Street Sweep')
    expect(text).toContain('Designated joint case')
  })

  it('an ended manual joint case still reads as historically joint', () => {
    const info = caseJointInfo({ is_joint_case: false, joint_case_ended_at: T2 }, [], ops)
    expect(info.manualJointEnded).toBe(true)
    expect(info.everJoint).toBe(true)
  })

  it('dedupes repeat participations per operation, newest first', () => {
    const info = caseJointInfo(caseBase, [
      { operation_id: 'op1', removed_at: T1, added_at: T0, was_jtf: true },
      { operation_id: 'op1', removed_at: null, added_at: T2, was_jtf: true },
    ], ops)
    expect(info.operations).toHaveLength(1)
    expect(info.operations[0].linked).toBe(true)
  })
})

describe('authority mirrors', () => {
  const det = (division: string, userId = 'u1'): OpViewer =>
    ({ userId, active: true, role: 'detective', division, isCommand: false, isOwner: false })
  const lead = (division: string): OpViewer =>
    ({ userId: 'u2', active: true, role: 'bureau_lead', division, isCommand: true, isOwner: false })
  const director: OpViewer =
    { userId: 'u3', active: true, role: 'director', division: 'SAB', isCommand: true, isOwner: false }

  const jtfOp = { op_type: 'jtf', status: 'active', bureau: null }
  const parts = ['SAB', 'LSB']

  it('canManageOperation: participating bureau_lead yes, foreign lead no, director always', () => {
    expect(canManageOperation(lead('LSB'), jtfOp, parts)).toBe(true)
    expect(canManageOperation(lead('BCB'), jtfOp, parts)).toBe(false)
    expect(canManageOperation(director, jtfOp, parts)).toBe(true)
    expect(canManageOperation(det('LSB'), jtfOp, parts)).toBe(false)
  })

  it('canManageOperation: bureau-owned normal op is own-bureau or command; legacy is open', () => {
    const owned = { op_type: 'normal', bureau: 'LSB' as const }
    expect(canManageOperation(det('LSB'), owned, [])).toBe(true)
    expect(canManageOperation(det('BCB'), owned, [])).toBe(false)
    expect(canManageOperation(lead('BCB'), owned, [])).toBe(true)
    expect(canManageOperation(det('BCB'), { op_type: 'normal', bureau: null }, [])).toBe(true)
  })

  it('canLinkCaseToOp: participating bureau + case lead/creator/command only', () => {
    const myCase = { bureau: 'LSB' as const, lead_detective_id: 'u1', created_by: 'u1', operation_id: null }
    expect(canLinkCaseToOp(det('LSB'), myCase, jtfOp, parts)).toBe(true)
    // Same bureau, but not the case lead/creator → no.
    expect(canLinkCaseToOp(det('LSB', 'u9'), myCase, jtfOp, parts)).toBe(false)
    // Non-participating bureau's case → no, even for its lead/creator.
    const bcbCase = { ...myCase, bureau: 'BCB' as const }
    expect(canLinkCaseToOp(det('BCB'), bcbCase, jtfOp, parts)).toBe(false)
    // Ended operation → no new links.
    expect(canLinkCaseToOp(det('LSB'), myCase, { op_type: 'jtf', status: 'resolved' }, parts)).toBe(false)
    // Already linked elsewhere → no.
    expect(canLinkCaseToOp(det('LSB'), { ...myCase, operation_id: 'x' }, jtfOp, parts)).toBe(false)
    // Normal operation keeps today's behavior.
    expect(canLinkCaseToOp(det('BCB', 'u9'), { ...bcbCase, lead_detective_id: 'z', created_by: 'z' }, { op_type: 'normal', status: 'active' }, [])).toBe(true)
  })

  it('canUnlinkCaseFromOp mirrors the jtf management rule', () => {
    const c = { lead_detective_id: 'u1', created_by: 'u5' }
    expect(canUnlinkCaseFromOp(det('LSB'), c, { op_type: 'jtf' })).toBe(true)
    expect(canUnlinkCaseFromOp(det('LSB', 'u9'), c, { op_type: 'jtf' })).toBe(false)
    expect(canUnlinkCaseFromOp(det('LSB', 'u9'), c, { op_type: 'normal' })).toBe(true)
  })
})

describe('helpers', () => {
  it('activeBureaus filters left rows and keeps join order', () => {
    expect(activeBureaus([
      { bureau: 'LSB', left_at: null, joined_at: T1 },
      { bureau: 'SAB', left_at: null, joined_at: T0 },
      { bureau: 'BCB', left_at: T2, joined_at: T0 },
    ])).toEqual(['SAB', 'LSB'])
  })

  it('isOpEnded covers resolved and closed', () => {
    expect(isOpEnded('resolved')).toBe(true)
    expect(isOpEnded('closed')).toBe(true)
    expect(isOpEnded('active')).toBe(false)
  })

  it('operationTimeline assembles derived events newest-first', () => {
    const events = operationTimeline(
      { created_at: T0, jtf_converted_at: T1, resolved_at: T2, status: 'resolved', op_type: 'jtf', lead_bureau: 'SAB' },
      [{ bureau: 'SAB', joined_at: T1, left_at: null }],
      [{ added_at: T1, removed_at: T2, removal_reason: 'unlinked', caseNumber: 'LSB-9000042' }],
    )
    expect(events[0].label).toMatch(/resolved|removed/i)
    expect(events.map((e) => e.label)).toEqual(expect.arrayContaining([
      'Operation created', 'Converted to Joint Task Force',
      'Bureau joined — SAB', 'Case linked — LSB-9000042',
      'Case removed — LSB-9000042', 'Operation resolved',
    ]))
    // Sorted newest first.
    const ts = events.map((e) => Date.parse(e.at))
    expect([...ts].sort((a, b) => b - a)).toEqual(ts)
  })
})
