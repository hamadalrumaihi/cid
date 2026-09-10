import { describe, expect, it } from 'vitest'
import { ADMIN_AUDIT_ACTIONS, adminActionLabel, ledgerReferenceCount } from './ownerQueue'

describe('ADMIN_AUDIT_ACTIONS', () => {
  it('is a curated named-action set — never the generic row-trigger ops', () => {
    for (const generic of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(ADMIN_AUDIT_ACTIONS).not.toContain(generic)
    }
    // Spot-check the owner-only controls stay represented.
    for (const a of ['SIU_RELEASE_SET', 'TEST_FLAG_SET', 'PERMANENT_DELETE_EXECUTED', 'JUSTICE_GRANTED']) {
      expect(ADMIN_AUDIT_ACTIONS).toContain(a)
    }
  })

  it('holds upper-snake action codes only (the format the RPCs write)', () => {
    for (const a of ADMIN_AUDIT_ACTIONS) expect(a).toMatch(/^[A-Z_]+$/)
  })
})

describe('adminActionLabel', () => {
  it('humanizes the action code', () => {
    expect(adminActionLabel('ROLE_CHANGED')).toBe('Role changed')
    expect(adminActionLabel('SIU_RELEASE_SET')).toBe('Siu release set')
    expect(adminActionLabel('APPROVED')).toBe('Approved')
  })
})

describe('ledgerReferenceCount', () => {
  it('sums nested bucket counts and scalar counts', () => {
    expect(ledgerReferenceCount({
      repoint: { 'cases.created_by': 4, 'reports.author_id': 2 },
      cascade: { 'notifications.user_id': 10 },
      role_events: 3,
    })).toBe(19)
  })

  it('counts array snapshots by length and ignores non-numeric leaves', () => {
    expect(ledgerReferenceCount({
      role_events: [{ role: 'detective' }, { role: 'bureau_lead' }],
      deleted: { 'case_assignments.user_id': 1, note: 'n/a' },
    })).toBe(3)
  })

  it('returns null for non-object shapes instead of guessing', () => {
    expect(ledgerReferenceCount(null)).toBeNull()
    expect(ledgerReferenceCount('7')).toBeNull()
    expect(ledgerReferenceCount([1, 2])).toBeNull()
  })

  it('an empty snapshot is zero references, not unknown', () => {
    expect(ledgerReferenceCount({})).toBe(0)
  })
})
