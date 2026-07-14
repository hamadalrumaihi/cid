import { describe, expect, it } from 'vitest'
import { assessCase, type WfCase } from './caseWorkflow'

const TODAY = '2026-07-14'
const meId = 'me-0000'

function mkCase(over: Partial<WfCase> = {}): WfCase {
  return {
    id: 'case-1',
    status: 'open',
    signoff_status: 'none',
    signoff_stage: null,
    signoff_assignee_id: null,
    signoff_submitted_by: null,
    lead_detective_id: meId,
    follow_up_at: null,
    ...over,
  }
}

describe('assessCase — stage derivation', () => {
  it('closed status → closed stage, no blockers, not closure-ready', () => {
    const a = assessCase({ c: mkCase({ status: 'closed' }), todayISO: TODAY })
    expect(a.stage).toBe('closed')
    expect(a.blockers).toHaveLength(0)
    expect(a.closureReady).toBe(false)
    expect(a.nextActions[0].key).toBe('closed')
  })

  it('cold status with nothing pending → dormant', () => {
    const a = assessCase({ c: mkCase({ status: 'cold' }), todayISO: TODAY })
    expect(a.stage).toBe('dormant')
  })

  it('awaiting a reviewer → awaiting_signoff', () => {
    const a = assessCase({ c: mkCase({ signoff_status: 'awaiting_deputy' }), todayISO: TODAY })
    expect(a.stage).toBe('awaiting_signoff')
  })

  it('changes_requested → returned_signoff', () => {
    const a = assessCase({ c: mkCase({ signoff_status: 'changes_requested' }), todayISO: TODAY })
    expect(a.stage).toBe('returned_signoff')
  })

  it('ready_doj → doj_review', () => {
    const a = assessCase({ c: mkCase({ signoff_status: 'ready_doj' }), todayISO: TODAY })
    expect(a.stage).toBe('doj_review')
  })

  it('active legal request pulls an otherwise-open case into doj_review', () => {
    const a = assessCase({ c: mkCase(), legal: [{ review_status: 'ada_review', expires_at: null }], todayISO: TODAY })
    expect(a.stage).toBe('doj_review')
  })

  it('a denied legal request does NOT count as active', () => {
    const a = assessCase({ c: mkCase(), legal: [{ review_status: 'denied', expires_at: null }], todayISO: TODAY })
    expect(a.stage).toBe('investigation')
    expect(a.counts.activeLegal).toBe(0)
  })
})

describe('assessCase — next actions are actor-specific', () => {
  it('returned to the owner → urgent revise-and-resubmit', () => {
    const a = assessCase({ c: mkCase({ signoff_status: 'denied', signoff_submitted_by: meId }), meId, todayISO: TODAY })
    expect(a.nextActions[0]).toMatchObject({ key: 'signoff_returned', severity: 'urgent', tab: 'signoff' })
  })

  it('awaiting the current viewer as assignee → urgent decide', () => {
    const a = assessCase({ c: mkCase({ signoff_status: 'awaiting_director', signoff_assignee_id: meId, lead_detective_id: 'other' }), meId, todayISO: TODAY })
    expect(a.nextActions[0]).toMatchObject({ key: 'signoff_decide', severity: 'urgent' })
  })

  it('awaiting someone else → informational waiting line naming the reviewer', () => {
    const a = assessCase({ c: mkCase({ signoff_status: 'awaiting_director', signoff_assignee_id: 'other', lead_detective_id: 'me-else' }), meId, assigneeName: 'Dir. Ocho', todayISO: TODAY })
    const wait = a.nextActions.find((x) => x.key === 'signoff_waiting')
    expect(wait?.label).toContain('Dir. Ocho')
    expect(wait?.severity).toBe('info')
  })
})

describe('assessCase — tasks, legal, follow-ups', () => {
  it('overdue tasks are urgent and counted apart from open', () => {
    const a = assessCase({
      c: mkCase(),
      tasks: [{ done: false, due: '2026-07-10' }, { done: false, due: '2026-08-01' }, { done: true, due: '2026-07-01' }],
      todayISO: TODAY,
    })
    expect(a.counts.openTasks).toBe(2)
    expect(a.counts.overdueTasks).toBe(1)
    expect(a.nextActions.find((x) => x.key === 'tasks_overdue')).toMatchObject({ severity: 'urgent' })
    expect(a.nextActions.find((x) => x.key === 'tasks_open')?.label).toContain('open')
  })

  it('a legal request expiring within 3 days is urgent; one far out is not', () => {
    const soon = assessCase({ c: mkCase(), legal: [{ review_status: 'approved', expires_at: '2026-07-16' }], todayISO: TODAY })
    expect(soon.counts.expiringLegal).toBe(1)
    expect(soon.nextActions.find((x) => x.key === 'legal_expiring')?.severity).toBe('urgent')
    const later = assessCase({ c: mkCase(), legal: [{ review_status: 'approved', expires_at: '2026-08-30' }], todayISO: TODAY })
    expect(later.counts.expiringLegal).toBe(0)
  })

  it('a due follow-up surfaces as a warning', () => {
    const a = assessCase({ c: mkCase({ follow_up_at: '2026-07-14' }), todayISO: TODAY })
    expect(a.nextActions.find((x) => x.key === 'followup_due')).toMatchObject({ severity: 'warn' })
  })
})

describe('assessCase — investigation nudges', () => {
  it('an empty open case is nudged to add evidence', () => {
    const a = assessCase({ c: mkCase(), evidenceCount: 0, todayISO: TODAY })
    expect(a.nextActions.find((x) => x.key === 'add_evidence')).toBeTruthy()
  })

  it('evidence present, no drafts, no tasks → ready to request sign-off', () => {
    const a = assessCase({ c: mkCase(), evidenceCount: 3, reports: [{ finalized: true }], tasks: [], todayISO: TODAY })
    expect(a.nextActions.find((x) => x.key === 'request_signoff')).toBeTruthy()
    expect(a.nextActions.find((x) => x.key === 'add_evidence')).toBeFalsy()
  })

  it('draft reports prompt finalization', () => {
    const a = assessCase({ c: mkCase(), evidenceCount: 1, reports: [{ finalized: false }, { finalized: true }], todayISO: TODAY })
    expect(a.counts.draftReports).toBe(1)
    expect(a.nextActions.find((x) => x.key === 'finalize_reports')?.label).toContain('1 draft report')
  })
})

describe('assessCase — closure readiness / pre-close checklist', () => {
  it('a clean open case with no pending work is closure-ready', () => {
    const a = assessCase({ c: mkCase(), evidenceCount: 2, reports: [{ finalized: true }], tasks: [], legal: [], todayISO: TODAY })
    expect(a.blockers).toHaveLength(0)
    expect(a.closureReady).toBe(true)
  })

  it('open tasks, active legal, drafts, and in-flight sign-off all block closure', () => {
    const a = assessCase({
      c: mkCase({ signoff_status: 'awaiting_deputy' }),
      tasks: [{ done: false, due: null }],
      legal: [{ review_status: 'ada_review', expires_at: null }],
      reports: [{ finalized: false }],
      todayISO: TODAY,
    })
    const keys = a.blockers.map((b) => b.key).sort()
    expect(keys).toEqual(['active_legal', 'draft_reports', 'open_tasks', 'signoff_open'])
    expect(a.closureReady).toBe(false)
  })

  it('overdue tasks raise the open-tasks blocker to urgent', () => {
    const a = assessCase({ c: mkCase(), tasks: [{ done: false, due: '2026-07-01' }], todayISO: TODAY })
    expect(a.blockers.find((b) => b.key === 'open_tasks')).toMatchObject({ severity: 'urgent', count: 1 })
  })

  it('a closed case is never closure-ready and lists no blockers', () => {
    const a = assessCase({ c: mkCase({ status: 'closed' }), tasks: [{ done: false, due: null }], todayISO: TODAY })
    expect(a.blockers).toHaveLength(0)
    expect(a.closureReady).toBe(false)
  })
})
