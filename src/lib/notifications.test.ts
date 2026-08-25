import { describe, expect, it } from 'vitest'
import { MUTABLE_NOTIF_TYPES, OPTIONAL_NOTIF_CATEGORIES } from './notifications'
import { NOTIF_LABEL } from './notifText'

/** Governance pins for the mute allow-list — the constants are pure; the db
 *  helpers themselves are covered by the RLS/MSW suites. */

/** Types that must NEVER be mutable: assignments, mentions, sign-off
 *  decisions, access/security and the whole legal/justice stream. */
const MANDATORY = [
  'task_assigned', 'case_assigned', 'case_handover', 'chat_mention', 'mention',
  'signoff_waiting', 'signoff_denied', 'signoff_changes', 'signoff_escalated',
  'access_requested', 'access_granted', 'access_denied',
  'login_denied', 'login_restored',
  'legal_request', 'legal_update', 'legal_decision', 'legal_coverage',
  'membership_request', 'membership_update',
  'restricted_break_glass', 'restricted_access_requested',
  'tracker_pending', // a co-sign request is work, not FYI
]

describe('OPTIONAL_NOTIF_CATEGORIES', () => {
  it('every mutable type is a real NOTIF_LABEL type', () => {
    for (const t of MUTABLE_NOTIF_TYPES) expect(NOTIF_LABEL[t], t).toBeDefined()
  })

  it('no mandatory type is ever mutable', () => {
    for (const t of MANDATORY) expect(MUTABLE_NOTIF_TYPES.has(t), t).toBe(false)
  })

  it('categories stay small, labelled and non-overlapping', () => {
    expect(OPTIONAL_NOTIF_CATEGORIES.length).toBeLessThanOrEqual(5)
    const all = OPTIONAL_NOTIF_CATEGORIES.flatMap((c) => c.types)
    expect(new Set(all).size).toBe(all.length)
    for (const c of OPTIONAL_NOTIF_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0)
      expect(c.hint.length).toBeGreaterThan(0)
      expect(c.types.length).toBeGreaterThan(0)
    }
  })
})
