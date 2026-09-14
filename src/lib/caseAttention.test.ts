/** "Needs attention" — the case-scoped version of the question the Action
 *  Center answers division-wide: what is waiting, and is it waiting on ME.
 *
 *  The case Brief already carried a guided next action and a closure
 *  checklist, but three states that stall real cases were invisible on it: a
 *  report a reviewer SENT BACK, a legal request returned for revision, and a
 *  finalized report nobody signed. Each sits quietly in a tab nobody opens
 *  until someone asks why the case has not moved.
 *
 *  Two rules carry the design:
 *   · MINE FIRST. An item the viewer can act on outranks one that is waiting
 *     on somebody else, whatever its severity — "waiting on the judge" is not
 *     work, it is weather.
 *   · NOTHING FROM ANOTHER CASE. This list is built only from the rows of the
 *     case it belongs to, so it can never become a second Action Center.
 */
import { describe, expect, it } from 'vitest'
import { caseAttention, type AttentionInputs } from './caseAttention'

const ME = 'me-1'
const OTHER = 'other-1'

const base: AttentionInputs = {
  c: {
    id: 'c1', status: 'open', signoff_status: 'none', signoff_stage: null,
    signoff_assignee_id: null, signoff_submitted_by: null, lead_detective_id: ME,
    follow_up_at: null,
  },
  meId: ME,
  todayISO: '2026-09-14',
}

const keys = (over: Partial<AttentionInputs> = {}) =>
  caseAttention({ ...base, ...over }).map((i) => i.key)
const item = (key: string, over: Partial<AttentionInputs> = {}) =>
  caseAttention({ ...base, ...over }).find((i) => i.key === key)

const report = (over: Record<string, unknown> = {}) => ({
  review_status: 'draft', finalized: false, author_id: ME, signature: null, ...over,
})
const legal = (over: Record<string, unknown> = {}) => ({
  review_status: 'cid_supervisor_review', expires_at: null, created_by: ME, ...over,
})
const task = (over: Record<string, unknown> = {}) => ({ done: false, due: '2026-09-01', assignee_id: ME, ...over })

describe('a quiet case says so', () => {
  it('has nothing to report when nothing is waiting', () => {
    expect(caseAttention(base)).toEqual([])
  })

  it('stays quiet on a closed case — a closed case is not a queue', () => {
    expect(keys({
      c: { ...base.c, status: 'closed' },
      tasks: [task()],
      reports: [report({ review_status: 'returned' })],
    })).toEqual([])
  })
})

describe('sign-off', () => {
  it('names the decision when it is sitting with the viewer', () => {
    const i = item('signoff_decide', {
      c: { ...base.c, signoff_status: 'awaiting_bureau_lead', signoff_assignee_id: ME },
    })
    expect(i?.mine).toBe(true)
    expect(i?.severity).toBe('urgent')
    expect(i?.tab).toBe('signoff')
  })

  it('does not call it the viewer’s move when it is with someone else', () => {
    const i = item('signoff_waiting', {
      c: { ...base.c, signoff_status: 'awaiting_deputy', signoff_assignee_id: OTHER },
      assigneeName: 'D. Vance',
    })
    expect(i?.mine).toBe(false)
    expect(i?.label).toContain('D. Vance')
  })

  it('asks the submitter to revise when a reviewer sent it back', () => {
    const i = item('signoff_returned', {
      c: { ...base.c, signoff_status: 'changes_requested', signoff_submitted_by: ME },
    })
    expect(i?.mine).toBe(true)
    expect(i?.severity).toBe('urgent')
  })
})

describe('reports', () => {
  it('surfaces a report a reviewer returned — the state that stalls cases silently', () => {
    const i = item('report_returned', { reports: [report({ review_status: 'returned' })] })
    expect(i?.mine, 'the author is the one who must act').toBe(true)
    expect(i?.severity).toBe('urgent')
    expect(i?.tab).toBe('reports')
  })

  it('does not claim a returned report is the viewer’s move when they did not write it', () => {
    expect(item('report_returned', { reports: [report({ review_status: 'returned', author_id: OTHER })] })?.mine).toBe(false)
  })

  it('counts a report waiting on a reviewer as waiting on someone else', () => {
    const i = item('report_review', { reports: [report({ review_status: 'submitted', finalized: true })] })
    expect(i?.mine).toBe(false)
    expect(i?.label).toMatch(/review/i)
  })

  it('surfaces a finalized report nobody signed', () => {
    const i = item('report_unsigned', { reports: [report({ review_status: 'approved', finalized: true })] })
    expect(i?.mine).toBe(true)
    expect(i?.label).toMatch(/sign/i)
  })

  it('says nothing about a signed report, or a draft that was never submitted', () => {
    expect(keys({ reports: [report({ review_status: 'approved', finalized: true, signature: { by: ME } })] }))
      .not.toContain('report_unsigned')
    expect(keys({ reports: [report()] })).not.toContain('report_unsigned')
  })
})

describe('legal requests', () => {
  it('surfaces one returned for revision, whoever returned it', () => {
    for (const status of ['returned_by_cid', 'returned_by_siu_command', 'returned_by_judge']) {
      const i = item('legal_returned', { legal: [legal({ review_status: status })] })
      expect(i, status).toBeTruthy()
      expect(i?.mine, status).toBe(true)
      expect(i?.severity).toBe('urgent')
    }
  })

  it('counts one awaiting a decision as waiting on someone else', () => {
    const i = item('legal_pending', { legal: [legal({ review_status: 'submitted_to_judge' })] })
    expect(i?.mine).toBe(false)
  })

  it('warns when an approved request is about to expire', () => {
    const i = item('legal_expiring', { legal: [legal({ review_status: 'approved', expires_at: '2026-09-15' })] })
    expect(i?.severity).toBe('urgent')
  })

  it('ignores a request that is already finished', () => {
    for (const status of ['denied', 'withdrawn', 'cancelled', 'superseded']) {
      expect(keys({ legal: [legal({ review_status: status })] }), status).toEqual([])
    }
  })
})

describe('tasks and evidence', () => {
  it('separates the viewer’s overdue tasks from everyone else’s', () => {
    expect(item('tasks_overdue_mine', { tasks: [task()] })?.mine).toBe(true)
    expect(item('tasks_overdue', { tasks: [task({ assignee_id: OTHER })] })?.mine).toBe(false)
  })

  it('does not call a task overdue before its date', () => {
    expect(keys({ tasks: [task({ due: '2026-09-20' })] })).toEqual([])
    expect(keys({ tasks: [task({ due: null })] })).toEqual([])
    expect(keys({ tasks: [task({ done: true })] })).toEqual([])
  })

  it('nudges about missing evidence without calling it urgent', () => {
    const i = item('evidence_missing', { mediaCount: 0 })
    expect(i?.severity).toBe('info')
    expect(keys({ mediaCount: 3 })).not.toContain('evidence_missing')
  })
})

describe('the order the list is read in', () => {
  it('puts what the viewer can act on first, then urgency', () => {
    const items = caseAttention({
      ...base,
      c: { ...base.c, signoff_status: 'awaiting_deputy', signoff_assignee_id: OTHER },
      tasks: [task()],
      reports: [report({ review_status: 'submitted', finalized: true, author_id: OTHER })],
      mediaCount: 0,
    })
    expect(items[0].mine, 'the viewer’s own overdue task leads').toBe(true)
    expect(items[0].key).toBe('tasks_overdue_mine')
    // Everything waiting on someone else follows, and the advisory nudge last.
    expect(items[items.length - 1].key).toBe('evidence_missing')
  })

  it('never invents an item for a case with no rows at all', () => {
    expect(caseAttention({ c: base.c, meId: ME, todayISO: '2026-09-14' })).toEqual([])
  })
})
