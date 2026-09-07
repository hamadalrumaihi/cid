/** Notification rendering for the intel triage kinds (Phase 6 §4): the five
 *  labels, the deep link into the review tool, and the one-line rule that the
 *  secondary line shows the FI number and nothing else — the payload is
 *  minimal by contract and this file must never grow a reason line. */
import { describe, expect, it } from 'vitest'
import { MUTABLE_NOTIF_TYPES } from './notifications'
import { NOTIF_LABEL, intelReviewHref, notifDetail, notifHref, notifSub, notifTitle, type NotificationRow } from './notifText'

const INTEL_KINDS = ['intel_new', 'intel_assigned', 'intel_question', 'intel_reply', 'intel_referred'] as const

const row = (type: string, payload: Record<string, unknown> | null = {}): NotificationRow => ({
  id: 'n1', user_id: 'u1', type, payload: payload as never, read: false, created_at: '2026-09-01T00:00:00Z',
})

describe('intel notifications', () => {
  it('labels all five kinds with the contract wording', () => {
    expect(NOTIF_LABEL.intel_new).toBe('🛈 New intelligence submitted')
    expect(NOTIF_LABEL.intel_assigned).toBe('Intelligence assigned to you')
    expect(NOTIF_LABEL.intel_question).toBe('A question about your report')
    expect(NOTIF_LABEL.intel_reply).toBe('The officer replied on a report')
    expect(NOTIF_LABEL.intel_referred).toBe('Intelligence referred to SIB')
    for (const k of INTEL_KINDS) expect(notifTitle(row(k))).toBe(NOTIF_LABEL[k])
  })

  it('lands every kind on the review tool with the record selected', () => {
    for (const k of INTEL_KINDS) {
      expect(notifHref(row(k, { submission_id: 'abc-1', submission_no: 'FI-2026-0007' })))
        .toBe('/tools?tool=field-review&record=abc-1')
    }
    // No id (a malformed payload) still opens the queue rather than a dead row.
    expect(notifHref(row('intel_new', {}))).toBe('/tools?tool=field-review')
    expect(notifHref(row('intel_new', null))).toBe('/tools?tool=field-review')
    expect(intelReviewHref('a b')).toBe('/tools?tool=field-review&record=a%20b')
  })

  it('shows the FI number and nothing else on the secondary line', () => {
    const n = row('intel_new', {
      submission_id: 'abc-1', submission_no: 'FI-2026-0007', jurisdiction: 'city',
      actor_name: 'Reyes', reason: 'should never be here', title: 'nor this', summary: 'nor this',
    })
    expect(notifSub(n)).toBe('FI-2026-0007')
    expect(notifSub(row('intel_reply', { submission_id: 'x' }))).toBeNull()
    expect(notifDetail(n)).toBeNull()
  })

  it('is never mutable', () => {
    for (const k of INTEL_KINDS) expect(MUTABLE_NOTIF_TYPES.has(k), k).toBe(false)
  })
})
