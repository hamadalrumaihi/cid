import { describe, expect, it } from 'vitest'
import {
  buildActionItems, priorityFromScore, NUDGE, STATUS_BASE,
  type AcAccess, type AcBlocker, type AcCase, type AcDoc, type AcLegal, type AcNotif,
  type AcSuggestion, type AcTask, type AcTransfer, type ActionSources,
} from './actionItems'

const ME = 'me-1'
const NOW_ISO = '2026-07-15T12:00:00.000Z'
const NOW = Date.parse(NOW_ISO)
const TODAY = '2026-07-15'

const NAMES: Record<string, string> = { 'off-2': 'Det. Ortiz', 'off-3': 'Det. Vale' }

function src(over: Partial<ActionSources> = {}): ActionSources {
  return {
    me: ME, role: 'detective', division: 'LSB', isCommand: false,
    todayISO: TODAY, nowMs: NOW,
    profileName: (id) => (id && NAMES[id]) || '',
    cases: [], tasks: [], transfers: [], accessRequests: [],
    membershipPending: null, legal: [], blockers: [], notifications: [],
    ...over,
  }
}

function mkCase(over: Partial<AcCase> = {}): AcCase {
  return {
    id: 'c-1', case_number: 'CID-26-001', title: 'Dockside', status: 'open',
    bureau: 'LSB', lead_detective_id: ME, created_by: ME, follow_up_at: null,
    signoff_status: 'none', signoff_stage: null, signoff_assignee_id: null,
    signoff_submitted_by: null, signoff_submitted_at: null,
    created_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  }
}

function mkTask(over: Partial<AcTask> = {}): AcTask {
  return {
    id: 't-1', case_id: 'c-1', title: 'Pull CCTV', due: null, done: false,
    assignee: ME, created_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  }
}

function mkTransfer(over: Partial<AcTransfer> = {}): AcTransfer {
  return {
    id: 'tr-1', status: 'pending_source', target_id: 'off-2', requested_by: 'off-3',
    from_bureau: 'LSB', to_bureau: 'BCB', reason: 'Coverage',
    created_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  }
}

function mkAccess(over: Partial<AcAccess> = {}): AcAccess {
  return {
    id: 'ar-1', case_id: 'c-1', requester_id: 'off-2', requester_name: null,
    reason: 'Need the file', status: 'pending', created_at: NOW_ISO, ...over,
  }
}

function mkLegal(over: Partial<AcLegal> = {}): AcLegal {
  return {
    id: 'lr-1', case_id: 'c-1', case_number_snapshot: 'CID-26-001',
    request_number: 'LR-26-004', request_type: 'warrant', subtype: 'search_warrant',
    review_status: 'submitted_to_doj', document_status: 'submitted',
    fulfilment_status: 'unissued', service_status: 'not_served',
    compliance_status: 'pending', approval_route: 'judge', classification: 'standard',
    created_by: ME, responsible_bureau: 'LSB',
    assigned_ada_id: null, assigned_judge_id: null,
    response_deadline: null, expires_at: null, submitted_to_doj_at: NOW_ISO,
    created_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  }
}

function mkBlocker(over: Partial<AcBlocker> = {}): AcBlocker {
  return {
    id: 'b-1', case_id: 'c-1', title: 'Waiting on lab', type: 'external',
    status: 'open', owner_id: ME, review_at: null,
    created_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  }
}

function mkNotif(over: Partial<AcNotif> = {}): AcNotif {
  return {
    id: 'n-1', user_id: ME, type: 'chat_mention', payload: { case_id: 'c-1' },
    read: false, created_at: NOW_ISO, ...over,
  }
}

const byKey = (q: ReturnType<typeof buildActionItems>, key: string) =>
  q.items.find((i) => i.dedupeKey === key)

/* ---- tasks ----------------------------------------------------------------- */

describe('tasks', () => {
  it('open task with no due date → needs_action, inline Mark done, task deep link', () => {
    const q = buildActionItems(src({ cases: [mkCase()], tasks: [mkTask()] }))
    const item = byKey(q, 'task:t-1')
    expect(item).toMatchObject({
      sourceType: 'task', sourceId: 't-1', status: 'needs_action', dueAt: null,
      canAct: true, actionLabel: 'Mark done', isPersonalItem: true,
      isWaitingOnCurrentUser: true, ownerId: ME, caseId: 'c-1', caseNumber: 'CID-26-001',
      deepLink: '/cases?case=c-1&tab=tasks&task=t-1',
    })
  })

  it('overdue task (2 days) → overdue, score 400 + 2×10 = 420, critical', () => {
    const q = buildActionItems(src({ tasks: [mkTask({ due: '2026-07-13T12:00:00.000Z' })] }))
    const item = byKey(q, 'task:t-1')
    expect(item?.status).toBe('overdue')
    expect(item?.urgencyScore).toBe(420)
    expect(item?.priority).toBe('critical')
  })

  it('task due within 48h → due_soon, score 250 + 50 = 300, high', () => {
    const q = buildActionItems(src({ tasks: [mkTask({ due: '2026-07-16T12:00:00.000Z' })] }))
    const item = byKey(q, 'task:t-1')
    expect(item?.status).toBe('due_soon')
    expect(item?.urgencyScore).toBe(300)
    expect(item?.priority).toBe('high')
  })

  it('done tasks and structural duplicates are dropped', () => {
    const q = buildActionItems(src({ tasks: [mkTask({ done: true }), mkTask({ id: 't-2' }), mkTask({ id: 't-2' })] }))
    expect(q.items.map((i) => i.dedupeKey)).toEqual(['task:t-2'])
  })
})

/* ---- sign-off decide + returned -------------------------------------------- */

describe('sign-off decide', () => {
  it('named assignee → personal decide item, navigation-only, +40 nudge (score 340)', () => {
    const c = mkCase({ signoff_status: 'awaiting_deputy', signoff_assignee_id: ME, signoff_submitted_at: NOW_ISO, lead_detective_id: 'off-2', created_by: 'off-2' })
    const q = buildActionItems(src({ cases: [c] }))
    const item = byKey(q, 'case:c-1:signoff-decide')
    expect(item).toMatchObject({
      sourceType: 'signoff', status: 'needs_action', isCommandItem: false,
      isPersonalItem: true, canAct: false, actionLabel: null,
      waitingSince: NOW_ISO, deepLink: '/cases?case=c-1&tab=signoff',
    })
    expect(item?.urgencyScore).toBe(STATUS_BASE.needs_action + NUDGE.signoffDecide)
  })

  it('role authority (bureau lead of the case bureau) → command item with responsibleRole', () => {
    const c = mkCase({ signoff_status: 'awaiting_bureau_lead', signoff_assignee_id: 'off-2', lead_detective_id: 'off-3', created_by: 'off-3' })
    const q = buildActionItems(src({ role: 'bureau_lead', division: 'LSB', isCommand: true, cases: [c] }))
    const item = byKey(q, 'case:c-1:signoff-decide')
    expect(item).toMatchObject({ isCommandItem: true, isPersonalItem: false, responsibleRole: 'bureau_lead' })
  })

  it('gated to awaiting_* — approved_deputy does not surface a decide item', () => {
    const c = mkCase({ signoff_status: 'approved_deputy', signoff_assignee_id: 'off-2', lead_detective_id: 'off-3', created_by: 'off-3' })
    const q = buildActionItems(src({ role: 'deputy_director', isCommand: true, cases: [c] }))
    expect(byKey(q, 'case:c-1:signoff-decide')).toBeUndefined()
  })

  it('non-reviewers see no decide item', () => {
    const c = mkCase({ signoff_status: 'awaiting_director', signoff_assignee_id: 'off-2', lead_detective_id: 'off-3', created_by: 'off-3' })
    const q = buildActionItems(src({ cases: [c] }))
    expect(byKey(q, 'case:c-1:signoff-decide')).toBeUndefined()
  })
})

describe('returned case', () => {
  it('changes_requested on my submission → returned, urgent band, revise reason', () => {
    const c = mkCase({ signoff_status: 'changes_requested', signoff_submitted_by: ME, signoff_submitted_at: NOW_ISO })
    const q = buildActionItems(src({ cases: [c] }))
    const item = byKey(q, 'case:c-1:signoff-returned')
    expect(item).toMatchObject({ sourceType: 'returned_case', status: 'returned', isPersonalItem: true })
    expect(item?.reason).toContain('revise and resubmit')
    expect(item?.urgencyScore).toBe(STATUS_BASE.returned)
    expect(item?.priority).toBe('high')
  })
})

/* ---- transfers -------------------------------------------------------------- */

describe('transfers', () => {
  it('source-side bureau lead decides pending_source → command needs_action item', () => {
    const q = buildActionItems(src({ role: 'bureau_lead', division: 'LSB', isCommand: true, transfers: [mkTransfer()] }))
    const item = byKey(q, 'transfer:tr-1')
    expect(item).toMatchObject({
      sourceType: 'transfer', status: 'needs_action', isCommandItem: true,
      isWaitingOnCurrentUser: true, deepLink: '/command-center?s=promotions',
    })
    expect(item?.title).toContain('Det. Ortiz')
  })

  it('pending_target is decided by the DESTINATION bureau lead, not the source lead', () => {
    const t = mkTransfer({ status: 'pending_target' })
    const sourceLead = buildActionItems(src({ role: 'bureau_lead', division: 'LSB', isCommand: true, transfers: [t] }))
    expect(byKey(sourceLead, 'transfer:tr-1')).toBeUndefined() // not decider, not a party → excluded
    const destLead = buildActionItems(src({ role: 'bureau_lead', division: 'BCB', isCommand: true, transfers: [t] }))
    expect(byKey(destLead, 'transfer:tr-1')?.status).toBe('needs_action')
  })

  it('deputy director decides either side; owner bypass mirrors the server', () => {
    const dd = buildActionItems(src({ role: 'deputy_director', isCommand: true, transfers: [mkTransfer({ status: 'pending_target' })] }))
    expect(byKey(dd, 'transfer:tr-1')?.status).toBe('needs_action')
    const owner = buildActionItems(src({ role: 'detective', isOwner: true, transfers: [mkTransfer()] }))
    expect(byKey(owner, 'transfer:tr-1')?.status).toBe('needs_action')
  })

  it('my own transfer is never a decide item — it waits, even for a decider role', () => {
    const q = buildActionItems(src({ role: 'bureau_lead', division: 'LSB', isCommand: true, transfers: [mkTransfer({ target_id: ME })] }))
    const item = byKey(q, 'transfer:tr-1')
    expect(item).toMatchObject({ status: 'waiting', isCommandItem: false, isPersonalItem: true, isWaitingOnCurrentUser: false })
  })

  it('requester waits (waitingSince = created_at, profile deep link for non-command)', () => {
    const q = buildActionItems(src({ transfers: [mkTransfer({ requested_by: ME })] }))
    const item = byKey(q, 'transfer:tr-1')
    expect(item).toMatchObject({ status: 'waiting', waitingSince: NOW_ISO, deepLink: '/profile' })
    expect(item?.urgencyScore).toBe(STATUS_BASE.waiting)
    expect(item?.priority).toBe('normal')
  })

  it('transfers I can neither decide nor am part of are excluded', () => {
    const q = buildActionItems(src({ transfers: [mkTransfer()] }))
    expect(q.items).toHaveLength(0)
  })
})

/* ---- access requests --------------------------------------------------------- */

describe('access requests', () => {
  it('case lead decides → inline Grant/Deny with requester metadata (personal authority)', () => {
    const q = buildActionItems(src({ cases: [mkCase()], accessRequests: [mkAccess()] }))
    const item = byKey(q, 'access:ar-1')
    expect(item).toMatchObject({
      sourceType: 'access_request', status: 'needs_action', canAct: true,
      actionLabel: 'Grant', secondaryActionLabel: 'Deny',
      isCommandItem: false, isPersonalItem: true,
      deepLink: '/cases?case=c-1',
    })
    expect(item?.sourceMetadata).toMatchObject({ requester_id: 'off-2', case_id: 'c-1' })
    expect(item?.title).toContain('Det. Ortiz')
  })

  it('bureau lead (not the case lead) → command authority item', () => {
    const q = buildActionItems(src({
      role: 'bureau_lead', isCommand: true,
      cases: [mkCase({ lead_detective_id: 'off-3' })], accessRequests: [mkAccess()],
    }))
    expect(byKey(q, 'access:ar-1')).toMatchObject({ isCommandItem: true, responsibleRole: 'bureau_lead' })
  })

  it('my own filed request → waiting; others’ requests I cannot grant → excluded', () => {
    const cases = [mkCase({ lead_detective_id: 'off-3' })]
    const mine = buildActionItems(src({ cases, accessRequests: [mkAccess({ requester_id: ME })] }))
    expect(byKey(mine, 'access:ar-1')).toMatchObject({ status: 'waiting', isPersonalItem: true })
    const others = buildActionItems(src({ cases, accessRequests: [mkAccess()] }))
    expect(others.items).toHaveLength(0)
  })
})

/* ---- membership summary -------------------------------------------------------- */

describe('member approvals (membership summary)', () => {
  it('command sees ONE summary item with the shared awaitingCount and +20 nudge', () => {
    const q = buildActionItems(src({ isCommand: true, role: 'director', membershipPending: 3 }))
    const item = byKey(q, 'membership:pending')
    expect(item).toMatchObject({
      sourceType: 'membership_request', status: 'needs_action', isCommandItem: true,
      title: '3 member approvals awaiting review', deepLink: '/command-center?s=approvals',
    })
    expect(item?.urgencyScore).toBe(STATUS_BASE.needs_action + NUDGE.membership)
  })

  it('an owner without a command role gets the same summary item', () => {
    const q = buildActionItems(src({ isOwner: true, membershipPending: 1 }))
    expect(byKey(q, 'membership:pending')?.title).toBe('1 member approval awaiting review')
  })

  it('non-command (null) and zero counts emit nothing', () => {
    expect(buildActionItems(src({ membershipPending: null })).items).toHaveLength(0)
    expect(buildActionItems(src({ isCommand: true, membershipPending: 0 })).items).toHaveLength(0)
  })
})

/* ---- legal requests -------------------------------------------------------------- */

describe('legal requests (disposition-driven — lib/legalWorkflow)', () => {
  it('filed by me, waiting at DOJ, no deadline → waiting with the model’s why-not text', () => {
    const q = buildActionItems(src({ legal: [mkLegal()] }))
    const item = byKey(q, 'legal:lr-1')
    expect(item).toMatchObject({
      sourceType: 'legal_request', status: 'waiting', waitingSince: NOW_ISO,
      deepLink: '/legal?request=lr-1', isPersonalItem: true, isWaitingOnCurrentUser: false,
    })
    // Judge-routed + unassigned → the model says who is actually waited on.
    expect(item?.reason).toBe('Waiting on any eligible judge.')
  })

  it('returned_by_* puts the ball back with me → RETURNED band (350), actionable', () => {
    const q = buildActionItems(src({ legal: [mkLegal({ review_status: 'returned_by_ada' })] }))
    const item = byKey(q, 'legal:lr-1')
    expect(item).toMatchObject({ status: 'returned', isWaitingOnCurrentUser: true, reason: 'Revise and resubmit' })
    expect(item?.urgencyScore).toBe(STATUS_BASE.returned)
  })

  it('a draft I filed → needs_action with the model’s next-action label', () => {
    const q = buildActionItems(src({ legal: [mkLegal({ review_status: 'not_submitted', document_status: 'draft' })] }))
    expect(byKey(q, 'legal:lr-1')).toMatchObject({ status: 'needs_action', reason: 'Finish draft' })
  })

  it('expiring within 72h → due_soon with the +60 nudge (250 + 50 + 60 = 360)', () => {
    const q = buildActionItems(src({ legal: [mkLegal({ review_status: 'approved', expires_at: '2026-07-17T12:00:00.000Z' })] }))
    const item = byKey(q, 'legal:lr-1')
    expect(item?.status).toBe('due_soon')
    expect(item?.dueAt).toBe('2026-07-17T12:00:00.000Z')
    expect(item?.urgencyScore).toBe(360)
  })

  it('a past response_deadline escalates to overdue (activeDeadline + urgencyFor)', () => {
    const q = buildActionItems(src({ legal: [mkLegal({ response_deadline: '2026-07-14T12:00:00.000Z' })] }))
    expect(byKey(q, 'legal:lr-1')?.status).toBe('overdue')
  })

  it('a CID supervisor owns the review on another investigator’s request → needs_action', () => {
    const q = buildActionItems(src({
      role: 'bureau_lead',
      legal: [mkLegal({ created_by: 'off-2', review_status: 'cid_supervisor_review' })],
    }))
    const item = byKey(q, 'legal:lr-1')
    expect(item).toMatchObject({
      status: 'needs_action', reason: 'Review as Bureau Lead',
      isCommandItem: true, isPersonalItem: false, isWaitingOnCurrentUser: true,
    })
  })

  it('my own request in CID supervisor review just waits (conflict-of-role mirror)', () => {
    const q = buildActionItems(src({
      role: 'senior_detective',
      legal: [mkLegal({ review_status: 'cid_supervisor_review' })],
    }))
    expect(byKey(q, 'legal:lr-1')).toMatchObject({
      status: 'waiting', isWaitingOnCurrentUser: false, reason: 'Waiting on bureau lead.',
    })
  })

  it('bureau-awareness visibility NEVER surfaces as work', () => {
    const q = buildActionItems(src({
      legalViewer: {
        myId: ME, cidActive: true, cidRole: 'detective',
        justiceRole: 'assistant_district_attorney', isOwner: false,
        prosecutorBureaus: ['LSB'],
      },
      legal: [mkLegal({ created_by: 'off-2' })], // submitted_to_doj, LSB, unassigned
    }))
    expect(q.items).toHaveLength(0)
  })

  it('excludes rows I merely see, judge-claimable pickups, and closed/completed states', () => {
    const q = buildActionItems(src({
      legal: [
        mkLegal({ created_by: 'off-2' }), // visible, not mine, not my action
        mkLegal({ id: 'lr-2', review_status: 'withdrawn' }),
        mkLegal({ id: 'lr-3', review_status: 'approved', fulfilment_status: 'closed' }),
        mkLegal({ id: 'lr-4', review_status: 'approved', fulfilment_status: 'return_recorded' }),
      ],
    }))
    expect(q.items).toHaveLength(0)
    // A judge could CLAIM the waiting request — still Justice-portal work.
    const judge = buildActionItems(src({
      legalViewer: {
        myId: ME, cidActive: false, cidRole: null,
        justiceRole: 'judge', isOwner: false, prosecutorBureaus: [],
      },
      legal: [mkLegal({ created_by: 'off-2' })],
    }))
    expect(judge.items).toHaveLength(0)
  })
})

/* ---- follow-ups -------------------------------------------------------------------- */

describe('case follow-ups', () => {
  it('a due follow-up on my case → needs_action with the date as dueAt', () => {
    const q = buildActionItems(src({ cases: [mkCase({ follow_up_at: '2026-07-10' })] }))
    expect(byKey(q, 'case:c-1:followup')).toMatchObject({
      sourceType: 'case_followup', status: 'needs_action', dueAt: '2026-07-10', deepLink: '/cases?case=c-1',
    })
  })

  it('a follow-up within 48h → due_soon; closed cases and others’ cases are excluded', () => {
    const soon = buildActionItems(src({ cases: [mkCase({ follow_up_at: '2026-07-16' })] }))
    expect(byKey(soon, 'case:c-1:followup')?.status).toBe('due_soon')
    const closed = buildActionItems(src({ cases: [mkCase({ follow_up_at: '2026-07-10', status: 'closed' })] }))
    expect(byKey(closed, 'case:c-1:followup')).toBeUndefined()
    const notMine = buildActionItems(src({ cases: [mkCase({ follow_up_at: '2026-07-10', lead_detective_id: 'off-2', created_by: 'off-2' })] }))
    expect(byKey(notMine, 'case:c-1:followup')).toBeUndefined()
  })
})

/* ---- blockers ------------------------------------------------------------------------ */

describe('blockers', () => {
  it('an open blocker I own → needs_action with an inline Resolve action', () => {
    const q = buildActionItems(src({ cases: [mkCase()], blockers: [mkBlocker()] }))
    expect(byKey(q, 'blocker:b-1')).toMatchObject({
      sourceType: 'blocker', status: 'needs_action', canAct: true, actionLabel: 'Resolve',
      dueAt: null, deepLink: '/cases?case=c-1', ownerId: ME,
    })
  })

  it('a past review_at escalates the blocker to overdue', () => {
    const q = buildActionItems(src({ blockers: [mkBlocker({ review_at: '2026-07-10T12:00:00.000Z' })] }))
    expect(byKey(q, 'blocker:b-1')?.status).toBe('overdue')
  })
})

/* ---- notifications: suppression + standalone items ------------------------------------- */

describe('notification suppression', () => {
  it('task_assigned is suppressed by the matching task item and its id is attached', () => {
    const q = buildActionItems(src({
      tasks: [mkTask()],
      notifications: [mkNotif({ type: 'task_assigned', payload: { case_id: 'c-1', task_id: 't-1' } })],
    }))
    expect(q.suppressedCount).toBe(1)
    expect(q.items).toHaveLength(1)
    expect(byKey(q, 'task:t-1')?.sourceMetadata.notificationIds).toEqual(['n-1'])
  })

  it('signoff_waiting is suppressed by the decide item; membership_request by the summary', () => {
    const c = mkCase({ signoff_status: 'awaiting_deputy', signoff_assignee_id: ME, lead_detective_id: 'off-2', created_by: 'off-2' })
    const q = buildActionItems(src({
      isCommand: true, role: 'deputy_director', membershipPending: 2, cases: [c],
      notifications: [
        mkNotif({ id: 'n-1', type: 'signoff_waiting', payload: { case_id: 'c-1' } }),
        mkNotif({ id: 'n-2', type: 'membership_request', payload: {} }),
      ],
    }))
    expect(q.suppressedCount).toBe(2)
    expect(byKey(q, 'case:c-1:signoff-decide')?.sourceMetadata.notificationIds).toEqual(['n-1'])
    expect(byKey(q, 'membership:pending')?.sourceMetadata.notificationIds).toEqual(['n-2'])
  })

  it('access_requested without a request_id still matches via the case alias', () => {
    const q = buildActionItems(src({
      cases: [mkCase()], accessRequests: [mkAccess()],
      notifications: [mkNotif({ type: 'access_requested', payload: { case_id: 'c-1' } })],
    }))
    expect(q.suppressedCount).toBe(1)
    expect(byKey(q, 'access:ar-1')?.sourceMetadata.notificationIds).toEqual(['n-1'])
  })

  it('the transfer fan-out (membership_update + transfer_id) is suppressed by my transfer item', () => {
    const q = buildActionItems(src({
      transfers: [mkTransfer({ target_id: ME })],
      notifications: [mkNotif({ type: 'membership_update', payload: { transfer_id: 'tr-1', status: 'pending_source' } })],
    }))
    expect(q.suppressedCount).toBe(1)
    expect(byKey(q, 'transfer:tr-1')?.sourceMetadata.notificationIds).toEqual(['n-1'])
  })
})

describe('standalone notification items', () => {
  it('an unmatched mention → informational mention with Mark read + chat deep link', () => {
    const q = buildActionItems(src({ notifications: [mkNotif()] }))
    const item = byKey(q, 'notif:n-1')
    expect(item).toMatchObject({
      sourceType: 'mention', status: 'informational', canAct: true, actionLabel: 'Mark read',
      deepLink: '/cases?case=c-1&tab=chat', caseId: 'c-1',
    })
    expect(item?.priority).toBe('low')
  })

  it('case_handover → handover; unknown caseless types → other with the /inbox fallback', () => {
    const q = buildActionItems(src({
      notifications: [
        mkNotif({ id: 'n-1', type: 'case_handover', payload: { case_id: 'c-1' } }),
        mkNotif({ id: 'n-2', type: 'mystery_type', payload: {} }),
      ],
    }))
    expect(byKey(q, 'notif:n-1')?.sourceType).toBe('handover')
    expect(byKey(q, 'notif:n-2')).toMatchObject({ sourceType: 'other', deepLink: '/inbox' })
  })

  it('read notifications are ignored entirely', () => {
    const q = buildActionItems(src({ notifications: [mkNotif({ read: true })] }))
    expect(q.items).toHaveLength(0)
    expect(q.suppressedCount).toBe(0)
  })
})

/* ---- ranking ------------------------------------------------------------------------- */

describe('ranking', () => {
  it('documented order: overdue task > returned case > sign-off decide > waiting transfer > informational', () => {
    const q = buildActionItems(src({
      cases: [
        mkCase({ id: 'c-ret', case_number: 'CID-26-002', signoff_status: 'denied', signoff_submitted_by: ME, signoff_submitted_at: NOW_ISO }),
        mkCase({ id: 'c-dec', case_number: 'CID-26-003', signoff_status: 'awaiting_deputy', signoff_assignee_id: ME, signoff_submitted_at: NOW_ISO, lead_detective_id: 'off-2', created_by: 'off-2' }),
      ],
      tasks: [mkTask({ id: 't-over', case_id: 'c-x', due: '2026-07-15T11:00:00.000Z' })],
      transfers: [mkTransfer({ requested_by: ME })],
      notifications: [mkNotif({ id: 'n-info' })],
    }))
    expect(q.items.map((i) => i.dedupeKey)).toEqual([
      'task:t-over',                 // overdue: 400
      'case:c-ret:signoff-returned', // returned: 350
      'case:c-dec:signoff-decide',   // needs_action + decide nudge: 340
      'transfer:tr-1',               // waiting: 100
      'notif:n-info',                // informational: 0
    ])
  })

  it('ties break by dueAt asc (nulls last), then by id — deterministic and stable', () => {
    const q = buildActionItems(src({
      tasks: [
        mkTask({ id: 't-b', due: '2026-07-16T12:00:00.000Z' }), // due_soon 300
        mkTask({ id: 't-a', due: '2026-07-16T04:00:00.000Z' }), // due_soon 300, earlier due
      ],
    }))
    expect(q.items.map((i) => i.dedupeKey)).toEqual(['task:t-a', 'task:t-b'])
    const noDue = buildActionItems(src({ tasks: [mkTask({ id: 't-z' }), mkTask({ id: 't-y' })] }))
    expect(noDue.items.map((i) => i.dedupeKey)).toEqual(['task:t-y', 'task:t-z'])
  })

  it('age escalation lifts long-waiting items (+2/day, capped at 30 days)', () => {
    const old = buildActionItems(src({ transfers: [mkTransfer({ requested_by: ME, created_at: '2026-07-05T12:00:00.000Z' })] }))
    expect(byKey(old, 'transfer:tr-1')?.urgencyScore).toBe(STATUS_BASE.waiting + 10 * 2)
    const ancient = buildActionItems(src({ transfers: [mkTransfer({ requested_by: ME, created_at: '2025-01-01T12:00:00.000Z' })] }))
    expect(byKey(ancient, 'transfer:tr-1')?.urgencyScore).toBe(STATUS_BASE.waiting + 30 * 2)
  })

  it('the same input always yields the same output (pure + deterministic)', () => {
    const sources = src({
      cases: [mkCase({ signoff_status: 'awaiting_deputy', signoff_assignee_id: ME, follow_up_at: '2026-07-16' })],
      tasks: [mkTask({ due: '2026-07-10' })],
      blockers: [mkBlocker()],
      notifications: [mkNotif()],
    })
    expect(buildActionItems(sources)).toEqual(buildActionItems(sources))
  })

  it('priority bands from the score: ≥400 critical, ≥300 high, ≥100 normal, else low', () => {
    expect(priorityFromScore(400)).toBe('critical')
    expect(priorityFromScore(399)).toBe('high')
    expect(priorityFromScore(300)).toBe('high')
    expect(priorityFromScore(299)).toBe('normal')
    expect(priorityFromScore(100)).toBe('normal')
    expect(priorityFromScore(99)).toBe('low')
  })
})

describe('library governance items (AcDoc — pre-derived facts)', () => {
  const mkDoc = (over: Partial<AcDoc> = {}): AcDoc => ({
    id: 'd-1', title: 'Evidence Handling SOP', status: 'published',
    ackPending: false, ackDeadline: null,
    reviewDue: null, reviewDueAt: null,
    awaitingMyApproval: false, syncConflict: false,
    createdAt: NOW_ISO, updatedAt: NOW_ISO, ...over,
  })

  it('required acknowledgement: personal item, overdue past the deadline, deep-links to the reader', () => {
    const q = buildActionItems(src({ documents: [
      mkDoc({ ackPending: true, ackDeadline: '2026-07-10T00:00:00Z' }),
    ] }))
    const it1 = q.items.find((i) => i.sourceType === 'document_ack')!
    expect(it1).toBeDefined()
    expect(it1.status).toBe('overdue')
    expect(it1.isPersonalItem).toBe(true)
    expect(it1.deepLink).toBe('/sops?doc=d-1')
    expect(it1.actionLabel).toBe('Read & acknowledge')
  })

  it('review due (docs I own), approval waiting on me, and sync conflict each emit their own item', () => {
    const q = buildActionItems(src({ documents: [
      mkDoc({ id: 'd-r', reviewDue: 'overdue', reviewDueAt: '2026-07-01T00:00:00Z' }),
      mkDoc({ id: 'd-a', status: 'in_review', awaitingMyApproval: true }),
      mkDoc({ id: 'd-s', syncConflict: true }),
    ] }))
    const types = q.items.map((i) => i.sourceType)
    expect(types).toContain('document_review')
    expect(types).toContain('document_approval')
    expect(types).toContain('document_sync')
    const sync = q.items.find((i) => i.sourceType === 'document_sync')!
    expect(sync.isCommandItem).toBe(true)
    expect(sync.status).toBe('blocked')
  })

  it('a quiet document emits nothing; a document_required notification is suppressed by its structural item', () => {
    const quiet = buildActionItems(src({ documents: [mkDoc()] }))
    expect(quiet.items.filter((i) => i.sourceType.startsWith('document_'))).toHaveLength(0)
    const withNotif = buildActionItems(src({
      documents: [mkDoc({ ackPending: true })],
      notifications: [{
        id: 'n-1', user_id: ME, type: 'document_required',
        payload: { document_id: 'd-1' }, read: false, created_at: NOW_ISO,
      }],
    }))
    expect(withNotif.suppressedCount).toBe(1)
    const ack = withNotif.items.find((i) => i.sourceType === 'document_ack')!
    expect(ack.sourceMetadata.notificationIds).toEqual(['n-1'])
  })
})

describe('document suggestions (AcSuggestion — pre-derived facts)', () => {
  const mkSug = (over: Partial<AcSuggestion> = {}): AcSuggestion => ({
    id: 's-1', title: 'Clarify evidence chain', status: 'submitted',
    documentId: 'd-1', canManage: false, mine: false, assignedToMe: false,
    createdAt: NOW_ISO, updatedAt: NOW_ISO, ...over,
  })

  it('manager triage: a fresh submission on a doc I manage is a command needs-action item, deep-linked to the queue', () => {
    const q = buildActionItems(src({ suggestions: [mkSug({ canManage: true })] }))
    const it1 = q.items.find((i) => i.sourceType === 'document_suggestion')!
    expect(it1).toBeDefined()
    expect(it1.status).toBe('needs_action')
    expect(it1.isCommandItem).toBe(true)
    expect(it1.deepLink).toBe('/sops?view=suggestions&suggestion=s-1')
    expect(it1.actionLabel).toBe('Review')
  })

  it('submitter reply: my suggestion in needs_more_information is a personal needs-action item on the doc', () => {
    const q = buildActionItems(src({ suggestions: [
      mkSug({ mine: true, canManage: false, status: 'needs_more_information' }),
    ] }))
    const it1 = q.items.find((i) => i.sourceType === 'document_suggestion')!
    expect(it1).toBeDefined()
    expect(it1.isPersonalItem).toBe(true)
    expect(it1.deepLink).toBe('/sops?doc=d-1')
    expect(it1.actionLabel).toBe('Reply')
  })

  it('assigned editor: an accepted suggestion assigned to me is a personal implement item', () => {
    const q = buildActionItems(src({ suggestions: [
      mkSug({ status: 'accepted', assignedToMe: true }),
    ] }))
    const it1 = q.items.find((i) => i.sourceType === 'document_suggestion')!
    expect(it1).toBeDefined()
    expect(it1.actionLabel).toBe('Implement')
    expect(it1.isPersonalItem).toBe(true)
  })

  it('informational states emit nothing: my submitted suggestion (awaiting a reviewer) and an accepted one not assigned to me', () => {
    const mineWaiting = buildActionItems(src({ suggestions: [mkSug({ mine: true, status: 'submitted' })] }))
    expect(mineWaiting.items.filter((i) => i.sourceType === 'document_suggestion')).toHaveLength(0)
    const acceptedElsewhere = buildActionItems(src({ suggestions: [mkSug({ status: 'accepted', assignedToMe: false })] }))
    expect(acceptedElsewhere.items.filter((i) => i.sourceType === 'document_suggestion')).toHaveLength(0)
  })

  it('a document_suggestion notification is suppressed by its structural item', () => {
    const q = buildActionItems(src({
      suggestions: [mkSug({ canManage: true })],
      notifications: [{
        id: 'n-9', user_id: ME, type: 'document_suggestion',
        payload: { suggestion_id: 's-1', document_id: 'd-1' }, read: false, created_at: NOW_ISO,
      }],
    }))
    expect(q.suppressedCount).toBe(1)
    const it1 = q.items.find((i) => i.sourceType === 'document_suggestion')!
    expect(it1.sourceMetadata.notificationIds).toEqual(['n-9'])
  })
})
