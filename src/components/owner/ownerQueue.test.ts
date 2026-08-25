import { describe, expect, it } from 'vitest'
import {
  ADMIN_AUDIT_ACTIONS, adminActionLabel, ledgerReferenceCount, ownerQueue,
} from './ownerQueue'

const NONE = { clientErrors: 0, securityFailures: 0, fixtureIssues: 0, openFeedback: 0 }

describe('ownerQueue', () => {
  it('returns nothing when every signal is zero', () => {
    expect(ownerQueue(NONE)).toEqual([])
  })

  it('null means unknown, never pending', () => {
    expect(ownerQueue({
      clientErrors: null, securityFailures: null, fixtureIssues: null, openFeedback: null,
    })).toEqual([])
  })

  it('emits one row per non-zero signal, carrying the count', () => {
    const q = ownerQueue({ clientErrors: 3, securityFailures: 1, fixtureIssues: 2, openFeedback: 7 })
    expect(q.map((i) => i.id)).toEqual([
      'client_errors', 'security_failures', 'fixture_issues', 'open_feedback',
    ])
    expect(q.map((i) => i.count)).toEqual([3, 1, 2, 7])
  })

  it('routes health signals to Security & Audit and feedback to the inbox', () => {
    const q = ownerQueue({ ...NONE, clientErrors: 1, openFeedback: 1 })
    expect(q.find((i) => i.id === 'client_errors')?.section).toBe('security')
    expect(q.find((i) => i.id === 'open_feedback')?.section).toBe('feedback')
  })

  it('every row states why it is in front of the owner', () => {
    const q = ownerQueue({ clientErrors: 1, securityFailures: 1, fixtureIssues: 1, openFeedback: 1 })
    for (const i of q) expect(i.why.length).toBeGreaterThan(10)
  })
})

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
