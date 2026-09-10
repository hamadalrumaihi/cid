/** Notification rendering for the intel triage kinds (Phase 6 §4): the five
 *  labels, the deep link into the review tool, and the one-line rule that the
 *  secondary line shows the FI number and nothing else — the payload is
 *  minimal by contract and this file must never grow a reason line. */
import { describe, expect, it } from 'vitest'
import { MUTABLE_NOTIF_TYPES } from './notifications'
import { NOTIF_LABEL, intelReviewHref, notifDetail, notifHref, notifSub, notifTitle, type NotificationRow } from './notifText'

const INTEL_KINDS = ['intel_new', 'intel_assigned', 'intel_question', 'intel_reply', 'intel_referred'] as const

const row = (type: string, payload: Record<string, unknown> | null = {}): NotificationRow => ({
  id: 'n1', user_id: 'u1', type, payload: payload as never, read: false, read_at: null, created_at: '2026-09-01T00:00:00Z',
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

/* ── Phase 7 (P7-07): ONE title map, the escalation ladder's deep links. ─── */
import titles from './notificationTitles.json'
import { NOTIF_CATEGORY, NOTIF_REGISTRY, type NotifEntry } from './notifText'

describe('notification titles (P7-07)', () => {
  it('NOTIF_LABEL is exactly the JSON title map (the edge function ships a copy)', () => {
    const json = titles as Record<string, NotifEntry>
    expect(NOTIF_REGISTRY).toBe(json)
    expect(Object.keys(NOTIF_LABEL).sort()).toEqual(Object.keys(json).sort())
    for (const [k, v] of Object.entries(json)) {
      expect(NOTIF_LABEL[k]).toBe(v.title)
      expect(NOTIF_CATEGORY[k]).toBe(v.category)
    }
  })

  it('every entry has the typed shape and nothing beyond it', () => {
    const KEYS = new Set(['title', 'category', 'destination', 'mutable', 'priority'])
    for (const [k, v] of Object.entries(NOTIF_REGISTRY)) {
      for (const key of Object.keys(v)) expect(KEYS.has(key), `${k}.${key}`).toBe(true)
      if (v.destination !== undefined) expect(v.destination).toBe('portal')
      if (v.mutable !== undefined) expect(v.mutable).toBe(true)
      if (v.priority !== undefined) expect(['high', 'normal', 'low']).toContain(v.priority)
    }
  })

  it('carries every kind the plan listed as missing, with the existing wording kept', () => {
    expect(NOTIF_LABEL.narcotic_suggestion).toBe('Narcotic suggestion decided')
    expect(NOTIF_LABEL.siu_access_request).toBe('SIB access requested')
    expect(NOTIF_LABEL.siu_access_decision).toBe('SIB access decision')
    expect(NOTIF_LABEL.siu_appointed).toBe('Appointed to the SIB')
    expect(NOTIF_LABEL.siu_case_assigned).toBe('SIB case assigned')
    expect(NOTIF_LABEL.siu_compartment_granted).toBe('SIB compartment granted')
    expect(NOTIF_LABEL.document_required).toBe('Document acknowledgement required')
    expect(NOTIF_LABEL.info).toBe('Notice')
    expect(NOTIF_LABEL.client_error).toBe('⚠ App error reported')
    expect(NOTIF_LABEL.blocker_assigned).toBe('Blocker assigned to you')
    expect(NOTIF_LABEL.action_escalated).toBe('Escalated to you')
    expect(NOTIF_LABEL.case_stale).toBe('Case going stale')
    expect(NOTIF_LABEL.stale_case).toBe('Case going stale')
    // Legacy wording preserved for the kinds the bell already rendered.
    expect(NOTIF_LABEL.signoff_waiting).toBe('Case awaiting your sign-off')
    expect(NOTIF_LABEL.announcement).toBe('📣 Announcement')
    expect(notifTitle(row('never_heard_of_it'))).toBe('never_heard_of_it')
  })

  it('routes action_escalated by the escalated source kind', () => {
    expect(notifHref(row('action_escalated', { kind: 'signoff', source_id: 'c-1', case_id: 'c-1' })))
      .toBe('/cases?case=c-1&tab=signoff')
    expect(notifHref(row('action_escalated', { kind: 'task_overdue', source_id: 't-9', case_id: 'c-1' })))
      .toBe('/cases?case=c-1&tab=tasks&task=t-9')
    expect(notifHref(row('action_escalated', { kind: 'access_request', source_id: 'ar-1', case_id: 'c-1' })))
      .toBe('/cases?case=c-1')
    // No case in the payload → the Action Center's escalated filter (`/inbox`
    // since the portal cleanup), never a dead row.
    expect(notifHref(row('action_escalated', { kind: 'signoff', source_id: 'x' }))).toBe('/inbox?f=escalated')
  })

  it('routes the Informants kinds into the compartment and never onto a case', () => {
    for (const k of ['ci_assigned', 'ci_handler_changed', 'ci_handler_removed', 'ci_contact_overdue', 'ci_intel_added', 'ci_compromised']) {
      expect(notifHref(row(k, { ci_id: 'ci-1', intel_id: 'i-1' })), k).toBe('/informants?ci=ci-1')
      // A stray case_id must not win over the compartment.
      expect(notifHref(row(k, { ci_id: 'ci-1', case_id: 'c-1' })), k).toBe('/informants?ci=ci-1')
      // No id → no destination (a mark-read-only row), never a generic surface.
      expect(notifHref(row(k, {})), k).toBeNull()
    }
    expect(notifHref(row('ci_capacity_request', { request_id: 'r-1' }))).toBe('/informants?requests=1')
    expect(notifHref(row('ci_request_decided', { request_id: 'r-1' }))).toBe('/informants?requests=1')
    expect(notifHref(row('ci_assigned', { ci_id: 'a b' }))).toBe('/informants?ci=a%20b')
    // Released intelligence names no CI and lands on the case's Intel tab.
    expect(notifHref(row('case_intel_released', { case_id: 'c-1', release_id: 'rel-1' }))).toBe('/cases?case=c-1&tab=intel')
  })

  it('blocker_assigned lands on the Brief tab (CaseBlockersPanel lives in OverviewTab)', () => {
    expect(notifHref(row('blocker_assigned', { case_id: 'c-1', blocker_id: 'b-1' }))).toBe('/cases?case=c-1&tab=overview')
  })
})
