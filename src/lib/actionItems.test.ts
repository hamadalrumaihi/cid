import { describe, expect, it } from 'vitest'
import {
  buildActionItems, describeDraftKey, priorityFromScore, NUDGE, STATUS_BASE,
  type AcAccess, type AcBlocker, type AcBoloPerson, type AcCase, type AcDoc, type AcDraft,
  type AcFieldSubmission, type AcLegal, type AcNotif,
  type AcObservation, type AcSiuAccessRequest, type AcSiuDisclosure, type AcSiuReferral,
  type AcSuggestion, type AcSurvTarget, type AcTask, type AcTransfer,
  type AcCi, type AcCiRequest,
  type ActionSources,
} from './actionItems'

const ME = 'me-1'
const NOW_ISO = '2026-07-15T12:00:00.000Z'
const NOW = Date.parse(NOW_ISO)
const TODAY = '2026-07-15'

const NAMES: Record<string, string> = { 'off-2': 'Det. Ortiz', 'off-3': 'Det. Vale' }

function src(over: Partial<ActionSources> = {}): ActionSources {
  return {
    me: ME, role: 'detective', division: 'major_crimes', isCommand: false,
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
    bureau: 'major_crimes', lead_detective_id: ME, created_by: ME, follow_up_at: null,
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
    from_bureau: 'major_crimes', to_bureau: 'street_crimes', reason: 'Coverage',
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
    review_status: 'submitted_to_judge', document_status: 'submitted',
    fulfilment_status: 'unissued', service_status: 'not_served',
    compliance_status: 'pending', approval_route: 'judge', classification: 'standard',
    created_by: ME, responsible_bureau: 'major_crimes',
    assigned_ada_id: null, assigned_judge_id: null,
    response_deadline: null, expires_at: null, submitted_to_doj_at: null,
    submitted_to_judge_at: NOW_ISO, stage_entered_at: NOW_ISO,
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
    read: false, read_at: null, created_at: NOW_ISO, ...over,
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
    const q = buildActionItems(src({ role: 'bureau_lead', division: 'major_crimes', isCommand: true, cases: [c] }))
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
    const q = buildActionItems(src({ role: 'bureau_lead', division: 'major_crimes', isCommand: true, transfers: [mkTransfer()] }))
    const item = byKey(q, 'transfer:tr-1')
    expect(item).toMatchObject({
      sourceType: 'transfer', status: 'needs_action', isCommandItem: true,
      isWaitingOnCurrentUser: true, deepLink: '/command-center?s=promotions',
    })
    expect(item?.title).toContain('Det. Ortiz')
  })

  it('pending_target is decided by the DESTINATION bureau lead, not the source lead', () => {
    const t = mkTransfer({ status: 'pending_target' })
    const sourceLead = buildActionItems(src({ role: 'bureau_lead', division: 'major_crimes', isCommand: true, transfers: [t] }))
    expect(byKey(sourceLead, 'transfer:tr-1')).toBeUndefined() // not decider, not a party → excluded
    const destLead = buildActionItems(src({ role: 'bureau_lead', division: 'street_crimes', isCommand: true, transfers: [t] }))
    expect(byKey(destLead, 'transfer:tr-1')?.status).toBe('needs_action')
  })

  it('deputy director decides either side; owner bypass mirrors the server', () => {
    const dd = buildActionItems(src({ role: 'deputy_director', isCommand: true, transfers: [mkTransfer({ status: 'pending_target' })] }))
    expect(byKey(dd, 'transfer:tr-1')?.status).toBe('needs_action')
    const owner = buildActionItems(src({ role: 'detective', isOwner: true, transfers: [mkTransfer()] }))
    expect(byKey(owner, 'transfer:tr-1')?.status).toBe('needs_action')
  })

  it('my own transfer is never a decide item — it waits, even for a decider role', () => {
    const q = buildActionItems(src({ role: 'bureau_lead', division: 'major_crimes', isCommand: true, transfers: [mkTransfer({ target_id: ME })] }))
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
      title: '3 member approvals awaiting review', deepLink: '/command-center?s=membership',
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
  it('filed by me, waiting in the judicial queue, no deadline → waiting with the model’s why-not text', () => {
    const q = buildActionItems(src({ legal: [mkLegal()] }))
    const item = byKey(q, 'legal:lr-1')
    expect(item).toMatchObject({
      sourceType: 'legal_request', status: 'waiting', waitingSince: NOW_ISO,
      deepLink: '/legal?request=lr-1', isPersonalItem: true, isWaitingOnCurrentUser: false,
    })
    // Unassigned in the queue → the model says who is actually waited on.
    expect(item?.reason).toBe('Waiting on any eligible judge.')
  })

  it('returned_by_judge puts the ball back with me → RETURNED band (350), actionable', () => {
    const q = buildActionItems(src({ legal: [mkLegal({ review_status: 'returned_by_judge' })] }))
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

  it('a partially approved request runs the same issued lane as approved', () => {
    const q = buildActionItems(src({ legal: [mkLegal({ review_status: 'partially_approved', expires_at: '2026-07-17T12:00:00.000Z' })] }))
    expect(byKey(q, 'legal:lr-1')).toMatchObject({ status: 'due_soon', urgencyScore: 360 })
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

  it('my own request in bureau review just waits (conflict-of-role mirror)', () => {
    const q = buildActionItems(src({
      role: 'senior_detective',
      legal: [mkLegal({ review_status: 'cid_supervisor_review' })],
    }))
    expect(byKey(q, 'legal:lr-1')).toMatchObject({
      status: 'waiting', isWaitingOnCurrentUser: false, reason: 'Waiting on bureau lead.',
    })
  })

  it('the reminder sweep’s marks lift a stalled request: nudged +20, escalated +50 (escalated wins)', () => {
    const nudged = byKey(buildActionItems(src({ legal: [mkLegal({ nudged_at: NOW_ISO })] })), 'legal:lr-1')
    expect(nudged?.urgencyScore).toBe(STATUS_BASE.waiting + NUDGE.legalNudged)
    expect(nudged?.reason).toBe('Nudged — Waiting on any eligible judge.')
    expect(nudged?.sourceMetadata).toEqual({ sla: 'nudged' })
    const escalated = byKey(buildActionItems(src({ legal: [mkLegal({ nudged_at: NOW_ISO, escalated_at: NOW_ISO })] })), 'legal:lr-1')
    expect(escalated?.urgencyScore).toBe(STATUS_BASE.waiting + NUDGE.legalEscalated)
    expect(escalated?.reason).toBe('Escalated — Waiting on any eligible judge.')
    expect(escalated?.sourceMetadata).toEqual({ sla: 'escalated' })
    // the responsible party gets the same lift on their needs-action item
    const lead = byKey(buildActionItems(src({
      role: 'bureau_lead',
      legal: [mkLegal({ created_by: 'off-2', review_status: 'cid_supervisor_review', escalated_at: NOW_ISO })],
    })), 'legal:lr-1')
    expect(lead?.urgencyScore).toBe(STATUS_BASE.needs_action + NUDGE.legalEscalated)
    expect(lead?.reason).toBe('Escalated — Review as Bureau Lead')
  })

  it('waitingSince follows the stage clock when the server carries one', () => {
    const q = buildActionItems(src({ legal: [mkLegal({ stage_entered_at: '2026-07-15T00:00:00.000Z' })] }))
    expect(byKey(q, 'legal:lr-1')?.waitingSince).toBe('2026-07-15T00:00:00.000Z')
  })

  it('a retired prosecutor membership never surfaces work — not even on a row it once held', () => {
    const q = buildActionItems(src({
      justiceRole: 'prosecutor',
      legalViewer: { myId: ME, cidActive: false, cidRole: null, justiceRole: 'prosecutor', isOwner: false },
      legal: [
        mkLegal({ created_by: 'off-2' }),
        mkLegal({ id: 'lr-2', created_by: 'off-2', review_status: 'prosecutor_review', assigned_prosecutor_id: ME }),
        mkLegal({ id: 'lr-3', created_by: 'off-2', review_status: 'prosecutor_queue' }),
      ],
    }))
    expect(q.items).toHaveLength(0)
  })

  it('excludes rows I merely see and closed/completed states', () => {
    const q = buildActionItems(src({
      legal: [
        mkLegal({ created_by: 'off-2' }), // visible, not mine, not my action
        mkLegal({ id: 'lr-2', review_status: 'withdrawn' }),
        mkLegal({ id: 'lr-3', review_status: 'approved', fulfilment_status: 'closed' }),
        mkLegal({ id: 'lr-4', review_status: 'approved', fulfilment_status: 'return_recorded' }),
        mkLegal({ id: 'lr-5', review_status: 'cancelled' }),
        mkLegal({ id: 'lr-6', review_status: 'superseded' }),
      ],
    }))
    expect(q.items).toHaveLength(0)
  })
})

describe('judicial pipeline items (justiceRole-gated — no prosecutor lane)', () => {
  const judgeViewer = { myId: ME, cidActive: false, cidRole: null, justiceRole: 'judge' as const, isOwner: false }
  const agViewer = { myId: ME, cidActive: false, cidRole: null, justiceRole: 'attorney_general' as const, isOwner: false }

  it('a judge sees an open, unassigned, non-sealed queue row as ONE claimable legal_queue item', () => {
    const q = buildActionItems(src({ justiceRole: 'judge', legalViewer: judgeViewer, legal: [mkLegal({ created_by: 'off-2' })] }))
    expect(q.items).toHaveLength(1)
    expect(byKey(q, 'legal_queue:lr-1')).toMatchObject({
      sourceType: 'legal_queue', status: 'needs_action', reason: 'Awaiting judicial pickup — available to claim',
      summary: 'Case CID-26-001 · judicial queue', waitingSince: NOW_ISO, isWaitingOnCurrentUser: true,
    })
    // never a branch-7 duplicate for the same row
    expect(byKey(q, 'legal:lr-1')).toBeUndefined()
  })

  it('sealed rows are never a judge’s pickup; the Attorney General gets a sealed-assignment item instead', () => {
    const sealed = mkLegal({ created_by: 'off-2', classification: 'sealed' })
    expect(buildActionItems(src({ justiceRole: 'judge', legalViewer: judgeViewer, legal: [sealed] })).items).toHaveLength(0)
    const ag = buildActionItems(src({ justiceRole: 'attorney_general', legalViewer: agViewer, legal: [sealed] }))
    expect(ag.items).toHaveLength(1)
    expect(byKey(ag, 'legal_queue:lr-1')).toMatchObject({
      status: 'needs_action', reason: 'Sealed — assign a judge', summary: 'Sealed request · judicial queue', isCommandItem: true,
    })
    // an open (non-sealed) row is judges' work, not the AG's item
    expect(buildActionItems(src({ justiceRole: 'attorney_general', legalViewer: agViewer, legal: [mkLegal({ created_by: 'off-2' })] })).items).toHaveLength(0)
  })

  it('an assigned judicial review is a personal needs-action item that dedupes with the branch-7 key', () => {
    const q = buildActionItems(src({
      justiceRole: 'judge', legalViewer: judgeViewer,
      legal: [mkLegal({ created_by: 'off-2', review_status: 'judicial_review', assigned_judge_id: ME })],
    }))
    expect(q.items).toHaveLength(1)
    expect(byKey(q, 'legal:lr-1')).toMatchObject({ sourceType: 'legal_queue', status: 'needs_action', reason: 'Assigned for judicial review', isPersonalItem: true })
    // another judge's review is nobody's item
    expect(buildActionItems(src({
      justiceRole: 'judge', legalViewer: judgeViewer,
      legal: [mkLegal({ created_by: 'off-2', review_status: 'judicial_review', assigned_judge_id: 'j-9' })],
    })).items).toHaveLength(0)
  })

  it('the sweep’s escalation lifts queue work too', () => {
    const q = buildActionItems(src({ justiceRole: 'judge', legalViewer: judgeViewer, legal: [mkLegal({ created_by: 'off-2', escalated_at: NOW_ISO })] }))
    const item = byKey(q, 'legal_queue:lr-1')
    expect(item?.urgencyScore).toBe(STATUS_BASE.needs_action + NUDGE.legalEscalated)
    expect(item?.reason).toBe('Escalated — Awaiting judicial pickup — available to claim')
  })

  it('a judge never gets an item for their own request', () => {
    const q = buildActionItems(src({ justiceRole: 'judge', legalViewer: judgeViewer, legal: [mkLegal({ created_by: ME })] }))
    expect(byKey(q, 'legal_queue:lr-1')).toBeUndefined()
    expect(byKey(q, 'legal:lr-1')?.status).toBe('waiting')
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
        payload: { document_id: 'd-1' }, read: false, read_at: null, created_at: NOW_ISO,
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
        payload: { suggestion_id: 's-1', document_id: 'd-1' }, read: false, read_at: null, created_at: NOW_ISO,
      }],
    }))
    expect(q.suppressedCount).toBe(1)
    const it1 = q.items.find((i) => i.sourceType === 'document_suggestion')!
    expect(it1.sourceMetadata.notificationIds).toEqual(['n-9'])
  })
})

/* ---- surveillance ------------------------------------------------------------- */

describe('surveillance (observations + targets)', () => {
  const mkObs = (over: Partial<AcObservation> = {}): AcObservation => ({
    id: 'so-1', case_id: 'c-1', activity: 'Two subjects loading crates',
    source_type: 'detective_manual', created_at: NOW_ISO,
    observed_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  })
  const mkTarget = (over: Partial<AcSurvTarget> = {}): AcSurvTarget => ({
    id: 'st-1', case_id: 'c-1', label: 'Dockside warehouse',
    status: 'pending_approval', expires_at: null, requested_by: 'off-2',
    created_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  })

  it('an unverified observation → needs_action review item deep-linked to the Surveillance tab', () => {
    const q = buildActionItems(src({ cases: [mkCase()], observations: [mkObs()] }))
    const item = byKey(q, 'surv_obs:so-1')
    expect(item).toMatchObject({
      sourceType: 'unverified_observation', status: 'needs_action', canAct: true,
      actionLabel: 'Review observation', isPersonalItem: true, isWaitingOnCurrentUser: true,
      caseId: 'c-1', caseNumber: 'CID-26-001',
      deepLink: '/cases?case=c-1&tab=surveillance',
    })
    expect(item?.summary).toBe('Two subjects loading crates')
  })

  it('pending approval → command decide item ONLY for the authorization mirror (bureau lead of the case bureau)', () => {
    const cases = [mkCase({ bureau: 'major_crimes' })]
    const lead = buildActionItems(src({ role: 'bureau_lead', division: 'major_crimes', isCommand: true, cases, survTargets: [mkTarget()] }))
    expect(byKey(lead, 'surv_tgt:st-1')).toMatchObject({
      sourceType: 'surveillance_expiring', status: 'needs_action',
      isCommandItem: true, isWaitingOnCurrentUser: true,
      deepLink: '/cases?case=c-1&tab=surveillance',
    })
    // A bureau lead of ANOTHER bureau has no authority — and is not a party.
    const otherLead = buildActionItems(src({ role: 'bureau_lead', division: 'street_crimes', isCommand: true, cases, survTargets: [mkTarget()] }))
    expect(byKey(otherLead, 'surv_tgt:st-1')).toBeUndefined()
  })

  it('self-approval is barred: the requesting deputy director waits instead of deciding', () => {
    const q = buildActionItems(src({
      role: 'deputy_director', isCommand: true,
      cases: [mkCase()], survTargets: [mkTarget({ requested_by: ME })],
    }))
    expect(byKey(q, 'surv_tgt:st-1')).toMatchObject({ status: 'waiting', isPersonalItem: true, isCommandItem: false })
  })

  it('an active authorization expiring within 72h → due_soon with dueAt for the requester', () => {
    const q = buildActionItems(src({
      cases: [mkCase()],
      survTargets: [mkTarget({ status: 'active', requested_by: ME, expires_at: '2026-07-17T12:00:00.000Z' })],
    }))
    const item = byKey(q, 'surv_tgt:st-1:expiry')
    expect(item).toMatchObject({
      sourceType: 'surveillance_expiring', status: 'due_soon',
      dueAt: '2026-07-17T12:00:00.000Z', isPersonalItem: true,
    })
    // due within 48h window adds +50 on top of due_soon's 250.
    expect(item?.urgencyScore).toBeGreaterThanOrEqual(STATUS_BASE.due_soon)
  })

  it('a far-future expiry emits nothing; an uninvolved detective sees no expiry item', () => {
    const far = buildActionItems(src({
      cases: [mkCase()],
      survTargets: [mkTarget({ status: 'active', requested_by: ME, expires_at: '2026-09-01T00:00:00.000Z' })],
    }))
    expect(byKey(far, 'surv_tgt:st-1:expiry')).toBeUndefined()
    const bystander = buildActionItems(src({
      cases: [mkCase()],
      survTargets: [mkTarget({ status: 'active', requested_by: 'off-2', expires_at: '2026-07-16T12:00:00.000Z' })],
    }))
    expect(byKey(bystander, 'surv_tgt:st-1:expiry')).toBeUndefined()
  })
})

/* ---- drafts / unassigned intel / expiring BOLOs (Wave 3) ------------------- */

describe('drafts (user_drafts keys)', () => {
  const mkDraft = (key: string): AcDraft => ({ key, updated_at: NOW_ISO })

  it('describeDraftKey humanizes the key vocabulary — never a payload', () => {
    expect(describeDraftKey('chat:c-1')).toMatchObject({
      title: 'Case chat draft', caseId: 'c-1', deepLink: '/cases?case=c-1&tab=chat',
    })
    expect(describeDraftKey('notes:c-1').deepLink).toBe('/cases?case=c-1&tab=intel')
    expect(describeDraftKey('report:c-1:arrest_report')).toMatchObject({
      title: 'Report draft — Arrest Report', caseId: 'c-1', deepLink: '/cases?case=c-1&tab=reports',
    })
    expect(describeDraftKey('report:edit:r-9')).toMatchObject({ caseId: null, deepLink: '/cases' })
    expect(describeDraftKey('legal:edit:lr-9').deepLink).toBe('/legal?request=lr-9')
    expect(describeDraftKey('legal:new:search_warrant').title).toBe('Legal request draft — Search Warrant')
    expect(describeDraftKey('person:new').deepLink).toBe('/persons')
    expect(describeDraftKey('person:summary:p-7').deepLink).toBe('/tools?tool=persons&record=p-7')
    expect(describeDraftKey('gang:new').deepLink).toBe('/gangs')
    // Unknown prefixes degrade to a generic label, never raw JSON.
    expect(describeDraftKey('mystery:x').title).toBe('Mystery draft')
  })

  it('a draft → informational personal item with a Discard inline action; case keys pick up case context', () => {
    const q = buildActionItems(src({ cases: [mkCase()], myDrafts: [mkDraft('chat:c-1')] }))
    const item = byKey(q, 'draft:chat:c-1')
    expect(item).toMatchObject({
      sourceType: 'draft', status: 'informational', canAct: true, actionLabel: 'Discard',
      isPersonalItem: true, ownerId: ME, caseId: 'c-1', caseNumber: 'CID-26-001',
      bureau: 'major_crimes', deepLink: '/cases?case=c-1&tab=chat',
    })
    expect(item?.sourceMetadata).toMatchObject({ draft_key: 'chat:c-1' })
  })

  it('drafts never outrank real queue work (low priority band)', () => {
    const q = buildActionItems(src({ tasks: [mkTask()], myDrafts: [mkDraft('person:new')] }))
    const task = byKey(q, 'task:t-1')!
    const draft = byKey(q, 'draft:person:new')!
    expect(draft.urgencyScore).toBeLessThan(task.urgencyScore)
    expect(draft.priority).toBe('low')
  })
})

describe('unassigned intel (field_submissions pickups)', () => {
  const mkIntel = (over: Partial<AcFieldSubmission> = {}): AcFieldSubmission => ({
    id: 'fs-1', submission_no: 'FI-26-010', summary: 'Vans staging at the docks',
    status: 'new', assigned_to: null, jurisdiction: 'city',
    submitted_at: NOW_ISO, created_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  })

  it('an unassigned review-active submission → shared-queue needs_action item on /field-review', () => {
    const q = buildActionItems(src({ fieldSubmissions: [mkIntel()] }))
    expect(byKey(q, 'intel:fs-1')).toMatchObject({
      sourceType: 'unassigned_intel', status: 'needs_action',
      title: 'Unclaimed intel — FI-26-010', summary: 'Vans staging at the docks',
      deepLink: '/field-review', isWaitingOnCurrentUser: true,
      isCommandItem: false, isPersonalItem: false,
    })
  })

  it('claimed or processed rows emit nothing (assigned_to set / status outside the review-active lane)', () => {
    const claimed = buildActionItems(src({ fieldSubmissions: [mkIntel({ assigned_to: 'off-2' })] }))
    expect(byKey(claimed, 'intel:fs-1')).toBeUndefined()
    for (const status of ['draft', 'reviewed', 'actionable', 'archived']) {
      const q = buildActionItems(src({ fieldSubmissions: [mkIntel({ status })] }))
      expect(byKey(q, 'intel:fs-1'), status).toBeUndefined()
    }
  })

  it('needs_info rows explain the officer is waiting too', () => {
    const q = buildActionItems(src({ fieldSubmissions: [mkIntel({ status: 'needs_info' })] }))
    expect(byKey(q, 'intel:fs-1')?.reason).toContain('waiting on the officer')
  })
})

describe('expiring BOLOs (persons.bolo)', () => {
  const mkBolo = (over: Partial<AcBoloPerson> = {}): AcBoloPerson => ({
    id: 'p-1', name: 'Ray Vargas', bolo: true,
    bolo_expires_at: '2026-07-18T12:00:00.000Z', bolo_risk: 'armed_and_dangerous',
    updated_at: NOW_ISO, ...over,
  })

  it('a BOLO inside its last 7 days → due_soon renewal item opening the person record (editors only)', () => {
    const q = buildActionItems(src({ canManageBolos: true, boloPersons: [mkBolo()] }))
    const item = byKey(q, 'bolo:p-1')
    expect(item).toMatchObject({
      sourceType: 'bolo_expiring', status: 'due_soon',
      title: 'BOLO expiring — Ray Vargas', dueAt: '2026-07-18T12:00:00.000Z',
      deepLink: '/tools?tool=persons&record=p-1', isWaitingOnCurrentUser: true,
    })
    expect(item?.summary).toContain('Armed And Dangerous risk')
    // Both the why and the next action are stated.
    expect(item?.reason).toContain('renew it or stand it down')
  })

  it('a lapsed BOLO → overdue with the lapsed title', () => {
    const q = buildActionItems(src({ canManageBolos: true, boloPersons: [mkBolo({ bolo_expires_at: '2026-07-10T12:00:00.000Z' })] }))
    expect(byKey(q, 'bolo:p-1')).toMatchObject({ status: 'overdue', title: 'BOLO lapsed — Ray Vargas' })
  })

  it('far-future windows, bolo=false rows and non-editor viewers emit nothing', () => {
    const far = buildActionItems(src({ canManageBolos: true, boloPersons: [mkBolo({ bolo_expires_at: '2026-09-01T00:00:00.000Z' })] }))
    expect(byKey(far, 'bolo:p-1')).toBeUndefined()
    const off = buildActionItems(src({ canManageBolos: true, boloPersons: [mkBolo({ bolo: false })] }))
    expect(byKey(off, 'bolo:p-1')).toBeUndefined()
    const viewer = buildActionItems(src({ boloPersons: [mkBolo()] }))
    expect(byKey(viewer, 'bolo:p-1')).toBeUndefined()
  })
})

/* ---- SIB branch (sibStanding-gated) ---------------------------------------- */

describe('SIB work (sibStanding-gated)', () => {
  const mkSibAccess = (over: Partial<AcSiuAccessRequest> = {}): AcSiuAccessRequest => ({
    id: 'sar-1', case_number_requested: 'SIB-8000012', reason: 'Cross-bureau overlap',
    status: 'pending', requested_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  })
  const mkSibReferral = (over: Partial<AcSiuReferral> = {}): AcSiuReferral => ({
    id: 'ref-1', category: 'corruption', summary: 'Evidence log discrepancies',
    status: 'submitted', submitted_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  })
  const mkSibDisclosure = (over: Partial<AcSiuDisclosure> = {}): AcSiuDisclosure => ({
    id: 'dis-1', title: 'Sanitized surveillance summary', audience: 'cid',
    released_at: NOW_ISO, acknowledged_at: null, revoked_at: null, ...over,
  })
  const AGENT = { isAgent: true, isCommand: false }
  const COMMAND = { isAgent: true, isCommand: true }

  it('null sibStanding emits NOTHING even when SIB rows are present (non-disclosure)', () => {
    const q = buildActionItems(src({
      sibAccessRequests: [mkSibAccess()],
      sibReferrals: [mkSibReferral()],
      sibDisclosures: [mkSibDisclosure()],
    }))
    expect(q.items).toEqual([])
  })

  it('pending Director access request → command needs_action item on /siu?s=intake (X-1 only)', () => {
    const q = buildActionItems(src({ sibStanding: COMMAND, sibAccessRequests: [mkSibAccess()] }))
    expect(byKey(q, 'sib_access:sar-1')).toMatchObject({
      sourceType: 'sib_access_request', status: 'needs_action',
      title: 'SIB access request — SIB-8000012', summary: 'Cross-bureau overlap',
      deepLink: '/siu?s=intake', isCommandItem: true, isWaitingOnCurrentUser: true,
      canAct: false, actionLabel: null,
    })
    // A field agent without command standing never sees the decision queue.
    const agent = buildActionItems(src({ sibStanding: AGENT, sibAccessRequests: [mkSibAccess()] }))
    expect(byKey(agent, 'sib_access:sar-1')).toBeUndefined()
    // Decided rows emit nothing.
    const decided = buildActionItems(src({ sibStanding: COMMAND, sibAccessRequests: [mkSibAccess({ status: 'approved' })] }))
    expect(byKey(decided, 'sib_access:sar-1')).toBeUndefined()
  })

  it('open intake referral → shared-queue needs_action item for field agents', () => {
    const q = buildActionItems(src({ sibStanding: AGENT, sibReferrals: [mkSibReferral()] }))
    expect(byKey(q, 'sib_referral:ref-1')).toMatchObject({
      sourceType: 'sib_referral', status: 'needs_action',
      title: 'Intake referral — Corruption', summary: 'Evidence log discrepancies',
      reason: 'Awaiting an SIB intake decision',
      deepLink: '/siu?s=intake', isWaitingOnCurrentUser: true,
    })
    const info = buildActionItems(src({ sibStanding: AGENT, sibReferrals: [mkSibReferral({ status: 'info_requested' })] }))
    expect(byKey(info, 'sib_referral:ref-1')?.reason).toContain('More information was requested')
    for (const status of ['accepted', 'declined']) {
      const closed = buildActionItems(src({ sibStanding: AGENT, sibReferrals: [mkSibReferral({ status })] }))
      expect(byKey(closed, 'sib_referral:ref-1'), status).toBeUndefined()
    }
  })

  it('un-acknowledged release to CID → waiting item; acknowledged/revoked emit nothing', () => {
    const q = buildActionItems(src({ sibStanding: AGENT, sibDisclosures: [mkSibDisclosure()] }))
    expect(byKey(q, 'sib_disclosure:dis-1')).toMatchObject({
      sourceType: 'sib_disclosure', status: 'waiting',
      title: 'Release to CID — Sanitized surveillance summary',
      deepLink: '/siu?s=disclosure', isPersonalItem: true,
    })
    const acked = buildActionItems(src({ sibStanding: AGENT, sibDisclosures: [mkSibDisclosure({ acknowledged_at: NOW_ISO })] }))
    expect(byKey(acked, 'sib_disclosure:dis-1')).toBeUndefined()
    const revoked = buildActionItems(src({ sibStanding: AGENT, sibDisclosures: [mkSibDisclosure({ revoked_at: NOW_ISO })] }))
    expect(byKey(revoked, 'sib_disclosure:dis-1')).toBeUndefined()
  })
})

/* ── Phase 7 (P7-02 #374, P7-03 #375) — the new kinds, the priority weight,
 *    the escalation ledger and the per-viewer state merge. ───────────────── */
import {
  SOURCE_TYPE_LABEL, escalationKey, priorityNudge,
  type AcClientError, type AcEscalation, type AcFieldAccessRequest, type AcGangMember,
  type AcJusticeApplication, type AcLegalComment, type AcMdtExport, type AcMySubmission,
  type AcNarcoticSuggestion, type AcRejectedSubmission, type AcReport, type AcRestrictedExport,
  type AcSiuConflict, type AcSiuWatch, type AcSurvAlert, type AcTracker, type ActionSourceType,
} from './actionItems'

const HOUR = 3_600_000
const iso = (deltaMs: number) => new Date(NOW + deltaMs).toISOString()
const findKey = (s: ActionSources, key: string) => buildActionItems(s).items.find((i) => i.dedupeKey === key)

describe('Phase 7 — SOURCE_TYPE_LABEL', () => {
  it('names every source type the builder can emit', () => {
    const emitted: ActionSourceType[] = [
      'task', 'signoff', 'returned_case', 'transfer', 'access_request', 'access_expiring', 'membership_request',
      'legal_request', 'case_followup', 'handover', 'mention', 'blocker', 'document_ack', 'document_review',
      'document_approval', 'document_sync', 'document_suggestion', 'legal_hold', 'restricted_access',
      'unverified_observation', 'surveillance_expiring', 'legal_queue', 'draft', 'unassigned_intel', 'bolo_expiring',
      'sib_access_request', 'sib_referral', 'sib_disclosure', 'restricted_export', 'mdt_export', 'field_access',
      'claim_verdict', 'narcotic_suggestion', 'gang_duplicate', 'tracker_cosign', 'sib_conflict', 'sib_watch_review',
      'owner_signal', 'justice_application', 'surveillance_alert', 'legal_comment', 'report_review',
      'intel_reply', 'intel_restore', 'intel_validate', 'other',
    ]
    for (const t of emitted) expect(SOURCE_TYPE_LABEL[t], t).toBeTruthy()
  })
})

describe('Phase 7 — cases.priority weight (#375)', () => {
  it('lifts every item on a critical case by +100 and a high case by +50', () => {
    expect(priorityNudge('critical')).toBe(NUDGE.priorityCritical)
    expect(priorityNudge('high')).toBe(NUDGE.priorityHigh)
    expect(priorityNudge('normal')).toBe(0)
    expect(priorityNudge(null)).toBe(0)
    const base = findKey(src({ cases: [mkCase()], tasks: [mkTask()] }), 'task:t-1')!
    const crit = findKey(src({ cases: [mkCase({ priority: 'critical' })], tasks: [mkTask()] }), 'task:t-1')!
    const high = findKey(src({ cases: [mkCase({ priority: 'high' })], tasks: [mkTask()] }), 'task:t-1')!
    expect(crit.urgencyScore - base.urgencyScore).toBe(100)
    expect(high.urgencyScore - base.urgencyScore).toBe(50)
    expect(crit.priority).toBe('critical')
  })
})

describe('Phase 7 — escalation ledger + viewer state merge', () => {
  it('maps ledger kinds onto the dedupe keys they lift', () => {
    expect(escalationKey({ kind: 'signoff', source_id: 'c-1' })).toBe('case:c-1:signoff-decide')
    expect(escalationKey({ kind: 'access_request', source_id: 'ar-1' })).toBe('access:ar-1')
    expect(escalationKey({ kind: 'task_overdue', source_id: 't-1' })).toBe('task:t-1')
    expect(escalationKey({ kind: 'legal', source_id: 'x' })).toBeNull()
  })

  it('stamps escalatedAt and adds +80 to the escalated item only', () => {
    const escalations: AcEscalation[] = [{ kind: 'task_overdue', source_id: 't-1', case_id: 'c-1', escalated_at: iso(-2 * HOUR) }]
    const s = src({ cases: [mkCase()], tasks: [mkTask(), mkTask({ id: 't-2' })] })
    const plain = findKey(s, 'task:t-1')!
    const lifted = findKey({ ...s, escalations }, 'task:t-1')!
    const other = findKey({ ...s, escalations }, 'task:t-2')!
    expect(lifted.escalatedAt).toBe(iso(-2 * HOUR))
    expect(lifted.urgencyScore - plain.urgencyScore).toBe(NUDGE.escalated)
    expect(other.escalatedAt).toBeNull()
  })

  it('a legal request escalated by the legal sweep carries escalatedAt without the ledger lift', () => {
    const l = mkLegal({ review_status: 'submitted_to_judge', escalated_at: iso(-HOUR) })
    const it = findKey(src({ legal: [l] }), 'legal:lr-1')!
    expect(it.escalatedAt).toBe(iso(-HOUR))
    expect(it.reason.startsWith('Escalated')).toBe(true)
  })

  it('merges the viewer state row onto the item; the builder never filters by it', () => {
    const states = { 'task:t-1': { seenAt: null, snoozedUntil: iso(HOUR), dismissedAt: null } }
    const it = findKey(src({ cases: [mkCase()], tasks: [mkTask()], states }), 'task:t-1')!
    expect(it.state?.snoozedUntil).toBe(iso(HOUR))
    expect(findKey(src({ tasks: [mkTask()] }), 'task:t-1')!.state).toBeNull()
  })

  it('tasks and blockers carry caseLeadId for the reassign gate', () => {
    const s = src({ cases: [mkCase({ lead_detective_id: 'off-2' })], tasks: [mkTask()], blockers: [mkBlocker()] })
    expect(findKey(s, 'task:t-1')!.sourceMetadata.caseLeadId).toBe('off-2')
    expect(findKey(s, 'blocker:b-1')!.sourceMetadata.caseLeadId).toBe('off-2')
  })
})

describe('Phase 7 — new queue kinds (#374)', () => {
  const cmd = { role: 'bureau_lead', isCommand: true, canEdit: true } as const

  it('restricted export window — command sees the open 1-hour window, may renew it', () => {
    const rows: AcRestrictedExport[] = [
      { id: 'l1', action: 'packet_export', actor_id: 'off-2', entity_id: 'c-1', entity_type: 'media', reason: 'court', created_at: iso(-20 * 60_000) },
      { id: 'l0', action: 'packet_export', actor_id: 'off-2', entity_id: 'c-1', entity_type: 'media', reason: null, created_at: iso(-3 * HOUR) },
    ]
    const it = findKey(src({ ...cmd, cases: [mkCase()], restrictedExports: rows }), 'restricted:c-1:export')!
    expect(it.sourceType).toBe('restricted_export')
    expect(it.isCommandItem).toBe(true)
    expect(it.status).toBe('informational')
    expect(it.reason).toContain('Det. Ortiz')
    expect(it.deepLink).toBe('/cases?case=c-1&tab=media')
    expect(buildActionItems(src({ ...cmd, restrictedExports: rows })).items.filter((i) => i.sourceType === 'restricted_export')).toHaveLength(1)
    expect(findKey(src({ cases: [mkCase()], restrictedExports: rows }), 'restricted:c-1:export')).toBeUndefined()
  })

  it('MDT export proposal — command decides, the proposer waits', () => {
    const e: AcMdtExport = { id: 'm1', kind: 'wanted', status: 'proposed', subject_snapshot: 'Marcus Reed', reason: 'armed', risk_level: 'high', proposed_by: 'off-2', proposed_at: NOW_ISO, source_case_id: 'c-1', updated_at: NOW_ISO }
    const it = findKey(src({ ...cmd, cases: [mkCase()], mdtExports: [e] }), 'mdt_export:m1')!
    expect(it).toMatchObject({ sourceType: 'mdt_export', status: 'needs_action', isCommandItem: true, canAct: true, deepLink: '/tools?tool=bolo', caseNumber: 'CID-26-001' })
    const mine = findKey(src({ mdtExports: [{ ...e, proposed_by: ME }] }), 'mdt_export:m1')!
    expect(mine).toMatchObject({ status: 'waiting', isPersonalItem: true, canAct: false })
    expect(findKey(src({ mdtExports: [{ ...e, status: 'exported' }] }), 'mdt_export:m1')).toBeUndefined()
  })

  it('field access request — command only', () => {
    const r: AcFieldAccessRequest = { id: 'fa1', user_id: 'u9', agency: 'lspd', callsign: '1L-20', status: 'pending', created_at: NOW_ISO, updated_at: NOW_ISO }
    const it = findKey(src({ ...cmd, fieldAccessRequests: [r] }), 'field_access:fa1')!
    expect(it).toMatchObject({ sourceType: 'field_access', isCommandItem: true, actionLabel: 'Approve', secondaryActionLabel: 'Deny', deepLink: '/tools?tool=field-review' })
    expect(it.title).toContain('1L-20')
    expect(findKey(src({ fieldAccessRequests: [r] }), 'field_access:fa1')).toBeUndefined()
  })

  it('my submissions — claim verdicts, validation-ready and officer replies', () => {
    const base: AcMySubmission = {
      id: 'fs1', submission_no: 'FI-26-0007', summary: 'Two plates', status: 'reviewing', assigned_to: ME,
      validated_at: null, rejected_at: null, submitted_at: NOW_ISO, created_at: NOW_ISO, updated_at: NOW_ISO,
      counts: { claims: 3, decided: 1, validated: false }, lastOfficerMessageAt: null, lastReviewerNoteAt: null,
    }
    const s = src({ canEdit: true, mySubmissions: [base] })
    expect(findKey(s, 'claim:fs1')).toMatchObject({ sourceType: 'claim_verdict', isPersonalItem: true, deepLink: '/tools?tool=field-review&record=fs1' })
    expect(findKey(s, 'claim:fs1')!.reason).toBe('2 of 3 claims still need a verdict')
    expect(findKey(s, 'intel:fs1:validate')).toBeUndefined()
    const ready = src({ canEdit: true, mySubmissions: [{ ...base, counts: { claims: 3, decided: 3, validated: true } }] })
    expect(findKey(ready, 'intel:fs1:validate')).toMatchObject({ sourceType: 'intel_validate' })
    expect(findKey(ready, 'claim:fs1')).toBeUndefined()
    const replied = src({ canEdit: true, mySubmissions: [{ ...base, lastOfficerMessageAt: iso(-HOUR), lastReviewerNoteAt: iso(-2 * HOUR) }] })
    expect(findKey(replied, 'intel:fs1:reply')).toMatchObject({ sourceType: 'intel_reply' })
    const answered = src({ canEdit: true, mySubmissions: [{ ...base, lastOfficerMessageAt: iso(-2 * HOUR), lastReviewerNoteAt: iso(-HOUR) }] })
    expect(findKey(answered, 'intel:fs1:reply')).toBeUndefined()
    // Not assigned to me / inactive viewer → nothing.
    expect(findKey(src({ canEdit: true, mySubmissions: [{ ...base, assigned_to: 'off-2' }] }), 'claim:fs1')).toBeUndefined()
    expect(findKey(src({ mySubmissions: [base] }), 'claim:fs1')).toBeUndefined()
  })

  it('rejected intel — command, inside the 7-day restore window', () => {
    const r: AcRejectedSubmission = { id: 'fs2', submission_no: 'FI-26-0008', summary: null, status: 'rejected', rejected_at: iso(-2 * 86_400_000), rejected_by: 'off-3', updated_at: NOW_ISO, created_at: NOW_ISO }
    const it = findKey(src({ ...cmd, rejectedSubmissions: [r] }), 'intel:fs2:rejected')!
    expect(it).toMatchObject({ sourceType: 'intel_restore', status: 'informational', isCommandItem: true })
    expect(it.reason).toContain('Det. Vale')
    expect(findKey(src({ ...cmd, rejectedSubmissions: [{ ...r, rejected_at: iso(-9 * 86_400_000) }] }), 'intel:fs2:rejected')).toBeUndefined()
  })

  it('narcotic suggestion — a manager decides, the author waits or answers', () => {
    const g: AcNarcoticSuggestion = { id: 'ns1', title: 'Add "Blue Fen"', status: 'submitted', suggestion_type: 'new_substance', created_by: 'off-2', source_case_id: null, created_at: NOW_ISO, updated_at: NOW_ISO }
    const it = findKey(src({ canEdit: true, narcoticSuggestions: [g] }), 'narcotic:ns1')!
    expect(it).toMatchObject({ sourceType: 'narcotic_suggestion', status: 'needs_action', actionLabel: 'Accept', secondaryActionLabel: 'Decline', deepLink: '/tools?tool=narcotics' })
    expect(findKey(src({ canEdit: true, narcoticSuggestions: [{ ...g, created_by: ME }] }), 'narcotic:ns1')).toMatchObject({ status: 'waiting', isPersonalItem: true })
    expect(findKey(src({ canEdit: true, narcoticSuggestions: [{ ...g, created_by: ME, status: 'needs_more_information' }] }), 'narcotic:ns1')).toMatchObject({ status: 'needs_action' })
    expect(findKey(src({ canEdit: true, narcoticSuggestions: [{ ...g, status: 'accepted' }] }), 'narcotic:ns1')).toBeUndefined()
  })

  it('gang duplicate review — one item per unreviewed member in a same-name cluster', () => {
    const m = (id: string, name: string, over: Partial<AcGangMember> = {}): AcGangMember =>
      ({ id, gang_id: 'g-1', name, person_id: null, reviewed_at: null, deleted_at: null, created_at: NOW_ISO, updated_at: NOW_ISO, ...over })
    const s = src({ canEdit: true, gangMembers: [m('a', 'Trey Sanders'), m('b', 'trey-sanders!'), m('c', 'Solo Name'), m('d', 'Trey Sanders', { reviewed_at: NOW_ISO })], gangNames: { 'g-1': 'Ballas' } })
    const items = buildActionItems(s).items.filter((i) => i.sourceType === 'gang_duplicate')
    expect(items.map((i) => i.dedupeKey).sort()).toEqual(['gang_dup:a', 'gang_dup:b'])
    expect(items[0].summary).toContain('Ballas')
    expect(items[0].deepLink).toBe('/gangs?gang=g-1')
    expect(items[0].reason).toContain('3 memberships')
    // A different gang with the same name is not a cluster.
    expect(buildActionItems(src({ canEdit: true, gangMembers: [m('a', 'X'), m('b', 'X', { gang_id: 'g-2' })] })).items.filter((i) => i.sourceType === 'gang_duplicate')).toHaveLength(0)
  })

  it('tracker co-sign — a second command officer, never the signer or the creator', () => {
    const t: AcTracker = { id: 'tk1', tracker_code: 'TRK-07', target: 'Black SUV', status: 'pending', bureau: 'major_crimes', case_id: null, created_by: 'off-2', director_sig: 'off-2', deputy_sig: null, created_at: NOW_ISO, updated_at: NOW_ISO }
    expect(findKey(src({ ...cmd, trackers: [t] }), 'tracker:tk1')).toMatchObject({ sourceType: 'tracker_cosign', status: 'needs_action', isCommandItem: true, deepLink: '/command' })
    expect(findKey(src({ ...cmd, trackers: [{ ...t, director_sig: ME }] }), 'tracker:tk1')).toMatchObject({ status: 'waiting', isPersonalItem: true })
    expect(findKey(src({ trackers: [t] }), 'tracker:tk1')).toBeUndefined()
    expect(findKey(src({ ...cmd, trackers: [{ ...t, deputy_sig: 'off-3', status: 'authorized' }] }), 'tracker:tk1')).toBeUndefined()
  })

  it('SIB conflict — SIB command only', () => {
    const k: AcSiuConflict = { id: 'k1', case_id: 'c-1', agent_id: 'off-2', reason: 'Relative', status: 'declared', declared_at: NOW_ISO, updated_at: NOW_ISO }
    const it = findKey(src({ sibStanding: { isAgent: true, isCommand: true }, sibConflicts: [k] }), 'siu_conflict:k1')!
    expect(it).toMatchObject({ sourceType: 'sib_conflict', isCommandItem: true, deepLink: '/siu?s=intake' })
    expect(it.title).toContain('Det. Ortiz')
    expect(findKey(src({ sibStanding: { isAgent: true, isCommand: false }, sibConflicts: [k] }), 'siu_conflict:k1')).toBeUndefined()
  })

  it('SIB watchlist — review due and expiry inside 7 days, agents only', () => {
    const w: AcSiuWatch = { id: 'w1', label: 'Harbor crew', entity_type: 'gang', priority: 'high', status: 'active', review_due_at: iso(2 * 86_400_000), expires_at: iso(30 * 86_400_000), removed_at: null, assigned_agent: ME, created_at: NOW_ISO, updated_at: NOW_ISO }
    const s = src({ sibStanding: { isAgent: true, isCommand: false }, sibWatchlist: [w] })
    expect(findKey(s, 'siu_watch:w1')).toMatchObject({ sourceType: 'sib_watch_review', status: 'due_soon', isPersonalItem: true, deepLink: '/siu?s=watchlist' })
    expect(findKey(s, 'siu_watch:w1:expiry')).toBeUndefined()
    const lapsing = src({ sibStanding: { isAgent: true, isCommand: false }, sibWatchlist: [{ ...w, review_due_at: null, expires_at: iso(3 * 86_400_000) }] })
    expect(findKey(lapsing, 'siu_watch:w1:expiry')).toMatchObject({ status: 'due_soon' })
    expect(findKey(src({ sibWatchlist: [w] }), 'siu_watch:w1')).toBeUndefined()
  })

  it('Owner signals — client errors fold into one item per day; the audit mismatch is typed owner_signal', () => {
    const errs: AcClientError[] = [
      { id: 'e1', created_at: iso(-HOUR), route: '/cases' }, { id: 'e2', created_at: iso(-2 * HOUR), route: '/legal' },
      { id: 'e3', created_at: iso(-30 * HOUR), route: '/x' },
    ]
    const s = src({ isOwner: true, clientErrors: errs, notifications: [mkNotif({ id: 'n9', type: 'audit_chain_mismatch', payload: {} })] })
    const owner = findKey(s, `owner:client_errors:${TODAY}`)!
    expect(owner).toMatchObject({ sourceType: 'owner_signal', status: 'informational', deepLink: '/owner?s=security' })
    expect(owner.title).toBe('2 client errors in the last 24 hours')
    expect(findKey(s, 'notif:n9')).toMatchObject({ sourceType: 'owner_signal', deepLink: '/audit' })
    expect(findKey(src({ clientErrors: errs }), `owner:client_errors:${TODAY}`)).toBeUndefined()
  })

  it('justice applications — one item per open request for command/owner (awareness)', () => {
    const j: AcJusticeApplication = { id: 'j1', applicant_id: 'u1', display_name: 'A. Vance', requested_agency: 'doj', requested_justice_role: 'judge', status: 'pending', submitted_at: NOW_ISO, created_at: NOW_ISO, updated_at: NOW_ISO }
    const s = src({ ...cmd, justiceApplications: [j, { ...j, id: 'j2', status: 'approved' }, { ...j, id: 'j3', status: 'correction_requested' }] })
    expect(findKey(s, 'justice:j1')).toMatchObject({ sourceType: 'justice_application', isCommandItem: true, status: 'informational', deepLink: '/command-center?s=membership' })
    expect(findKey(s, 'justice:j2')).toBeUndefined()
    expect(findKey(s, 'justice:j3')).toMatchObject({ status: 'waiting' })
    expect(findKey(src({ justiceApplications: [j] }), 'justice:j1')).toBeUndefined()
  })

  it('surveillance alert — acknowledge / dismiss on the case Surveillance tab', () => {
    const a: AcSurvAlert = { id: 'al1', case_id: 'c-1', title: 'Repeat plate', explanation: 'Seen 4× near the pier', alert_type: 'pattern', status: 'open', created_at: NOW_ISO }
    const it = findKey(src({ canEdit: true, cases: [mkCase()], survAlerts: [a] }), 'surv_alert:al1')!
    expect(it).toMatchObject({ sourceType: 'surveillance_alert', actionLabel: 'Acknowledge', secondaryActionLabel: 'Dismiss', canAct: true, deepLink: '/cases?case=c-1&tab=surveillance', caseNumber: 'CID-26-001' })
    expect(findKey(src({ canEdit: true, survAlerts: [{ ...a, status: 'acknowledged' }] }), 'surv_alert:al1')).toBeUndefined()
  })

  it('legal comments — others\' comments in the last 7 days, never my own or deleted ones', () => {
    const k: AcLegalComment = { id: 'lc1', legal_request_id: 'lr-1', author_id: 'off-2', created_at: iso(-HOUR), deleted_at: null }
    const s = src({ legal: [mkLegal()], legalComments: [k, { ...k, id: 'lc2', author_id: ME }, { ...k, id: 'lc3', deleted_at: NOW_ISO }, { ...k, id: 'lc4', created_at: iso(-8 * 86_400_000) }] })
    const it = findKey(s, 'legal_comment:lc1')!
    expect(it).toMatchObject({ sourceType: 'legal_comment', status: 'informational', actionLabel: 'Mark read', deepLink: '/legal?request=lr-1', caseNumber: 'CID-26-001' })
    expect(it.title).toBe('New comment — LR-26-004')
    expect(it.reason).toContain('Det. Ortiz')
    for (const k2 of ['lc2', 'lc3', 'lc4']) expect(findKey(s, `legal_comment:${k2}`), k2).toBeUndefined()
  })

  it('report review — the can_review_report mirror: reviewer roles, never the author, bureau-scoped leads', () => {
    const r: AcReport = { id: 'r1', case_id: 'c-1', template: 'arrest_report', kind: 'initial', seq: null, author_id: 'off-2', review_status: 'submitted', finalized: false, submitted_at: NOW_ISO, created_at: NOW_ISO, updated_at: NOW_ISO }
    const lead = findKey(src({ role: 'bureau_lead', isCommand: true, canEdit: true, cases: [mkCase()], reports: [r] }), 'report:r1')!
    expect(lead).toMatchObject({ sourceType: 'report_review', isCommandItem: true, deepLink: '/cases?case=c-1&tab=reports&report=r1' })
    const senior = findKey(src({ role: 'senior_detective', canEdit: true, cases: [mkCase()], reports: [r] }), 'report:r1')!
    expect(senior).toMatchObject({ isPersonalItem: true, isCommandItem: false })
    expect(findKey(src({ role: 'detective', canEdit: true, cases: [mkCase()], reports: [r] }), 'report:r1')).toBeUndefined()
    expect(findKey(src({ role: 'bureau_lead', isCommand: true, canEdit: true, cases: [mkCase()], reports: [{ ...r, author_id: ME }] }), 'report:r1')).toBeUndefined()
    expect(findKey(src({ role: 'bureau_lead', division: 'street_crimes', isCommand: true, canEdit: true, cases: [mkCase()], reports: [r] }), 'report:r1')).toBeUndefined()
    expect(findKey(src({ role: 'bureau_lead', isCommand: true, canEdit: true, cases: [mkCase()], reports: [{ ...r, review_status: 'draft' }] }), 'report:r1')).toBeUndefined()
  })
  /* ── Confidential informants (CI contract §6.4) ─────────────────────────── */
  const mkCi = (over: Partial<AcCi> = {}): AcCi => ({
    id: 'ci-1', ci_number: 'CI-0041', alias: 'Kestrel', status: 'active', bureau: 'major_crimes',
    last_contact_at: iso(-10 * 86_400_000), next_contact_at: iso(-2 * 86_400_000),
    primary_handler_id: ME, secondary_handler_id: null, linked_cases: 1, open_followups: 0, ...over,
  })
  const mkCiReq = (over: Partial<AcCiRequest> = {}): AcCiRequest => ({
    id: 'req-1', kind: 'capacity', requester_id: 'off-2', bureau: 'major_crimes', current_count: 6,
    requested_capacity: 8, status: 'pending', case_id: null, created_at: NOW_ISO, updated_at: NOW_ISO, ...over,
  })
  const handler = { ciStanding: { fullAccess: false, isHandler: true } }
  const fullCi = { ciStanding: { fullAccess: true, isHandler: false } }

  it('CI — nothing at all without ciStanding, even when rows are (wrongly) supplied', () => {
    const s = src({ ciDue: [mkCi()], ciFollowups: [mkCi({ open_followups: 2 })], ciRequests: [mkCiReq({ requester_id: ME })] })
    expect(buildActionItems(s).items.filter((it) => it.sourceType.startsWith('ci_'))).toEqual([])
  })

  it('CI contact due — my source is personal work, overdue by next_contact_at, deep-linking the profile by id only', () => {
    const it = findKey(src({ ...handler, ciDue: [mkCi()] }), 'ci:ci-1:contact')!
    expect(it).toMatchObject({
      sourceType: 'ci_contact_due', status: 'overdue', isPersonalItem: true, isCommandItem: false,
      actionLabel: 'Log contact', deepLink: '/informants?ci=ci-1&s=contacts', bureau: 'major_crimes',
    })
    expect(it.title).toBe('CI-0041 · contact due')
    expect(it.reason).toBe('Your source · contact overdue by 2d')
    // The item never carries the person's name — CI number only.
    expect(JSON.stringify(it)).not.toContain('person_name')
    // Within 48h → due_soon; no next_contact_at (the sweep's silent-30d case) → needs_action.
    expect(findKey(src({ ...handler, ciDue: [mkCi({ next_contact_at: iso(12 * HOUR) })] }), 'ci:ci-1:contact')).toMatchObject({ status: 'due_soon' })
    const silent = findKey(src({ ...handler, ciDue: [mkCi({ next_contact_at: null })] }), 'ci:ci-1:contact')!
    expect(silent.status).toBe('needs_action')
    expect(silent.reason).toContain('silent for 30 days')
    // Non-active sources never nag; a handler never sees another handler's source.
    expect(findKey(src({ ...handler, ciDue: [mkCi({ status: 'dormant' })] }), 'ci:ci-1:contact')).toBeUndefined()
    expect(findKey(src({ ...handler, ciDue: [mkCi({ primary_handler_id: 'off-2' })] }), 'ci:ci-1:contact')).toBeUndefined()
    // Full access sees every overdue source as an oversight (command) item.
    expect(findKey(src({ ...fullCi, role: 'director', ciDue: [mkCi({ primary_handler_id: 'off-2' })] }), 'ci:ci-1:contact'))
      .toMatchObject({ isCommandItem: true, isPersonalItem: false, responsibleRole: 'director' })
  })

  it('CI follow-ups — one item per source with open follow-ups, linking the intelligence section', () => {
    const it = findKey(src({ ...handler, ciFollowups: [mkCi({ open_followups: 2 })] }), 'ci_intel:ci-1:followup')!
    expect(it).toMatchObject({ sourceType: 'ci_intel_followup', status: 'needs_action', isPersonalItem: true, deepLink: '/informants?ci=ci-1&s=intelligence' })
    expect(it.title).toBe('CI-0041 · 2 intelligence follow-ups')
    expect(findKey(src({ ...handler, ciFollowups: [mkCi({ open_followups: 1 })] }), 'ci_intel:ci-1:followup')!.title).toBe('CI-0041 · 1 intelligence follow-up')
    expect(findKey(src({ ...handler, ciFollowups: [mkCi({ open_followups: 0 })] }), 'ci_intel:ci-1:followup')).toBeUndefined()
  })

  it('CI requests — a reviewer decision for full access, waiting for the requester, never shown to a plain handler', () => {
    const decide = findKey(src({ ...fullCi, role: 'bureau_lead', isCommand: true, ciRequests: [mkCiReq()] }), 'ci_request:req-1')!
    expect(decide).toMatchObject({
      sourceType: 'ci_capacity_request', status: 'needs_action', isCommandItem: true, isWaitingOnCurrentUser: true,
      actionLabel: 'Review', deepLink: '/informants?requests=1', bureau: 'major_crimes',
    })
    expect(decide.title).toBe('CI capacity request — Det. Ortiz')
    expect(decide.summary).toBe('6 active → 8 requested')
    const mine = findKey(src({ ...handler, ciRequests: [mkCiReq({ requester_id: ME, kind: 'assignment', requested_capacity: null })] }), 'ci_request:req-1')!
    expect(mine).toMatchObject({ status: 'waiting', isPersonalItem: true, isCommandItem: false, actionLabel: null })
    expect(mine.title).toBe('Your CI assignment request')
    expect(mine.summary).toBe('6 active sources')
    expect(findKey(src({ ...handler, ciRequests: [mkCiReq()] }), 'ci_request:req-1')).toBeUndefined()
    expect(findKey(src({ ...fullCi, ciRequests: [mkCiReq({ status: 'approved' })] }), 'ci_request:req-1')).toBeUndefined()
  })

  it('CI notifications — deep-link by id, and the sweep / request pings fold into the structural items', () => {
    const s = src({
      ...handler,
      ciDue: [mkCi()],
      notifications: [
        mkNotif({ id: 'n1', type: 'ci_contact_overdue', payload: { ci_id: 'ci-1' } }),
        mkNotif({ id: 'n2', type: 'ci_assigned', payload: { ci_id: 'ci-7' } }),
        mkNotif({ id: 'n3', type: 'ci_request_decided', payload: { request_id: 'req-9' } }),
        mkNotif({ id: 'n4', type: 'case_intel_released', payload: { case_id: 'c-1', release_id: 'rel-1' } }),
        mkNotif({ id: 'n5', type: 'ci_intel_added', payload: {} }),
      ],
    })
    const q = buildActionItems(s)
    expect(q.suppressedCount).toBe(1)
    expect(findKey(s, 'ci:ci-1:contact')!.sourceMetadata.notificationIds).toEqual(['n1'])
    expect(findKey(s, 'notif:n1')).toBeUndefined()
    expect(findKey(s, 'notif:n2')).toMatchObject({ sourceType: 'other', deepLink: '/informants?ci=ci-7' })
    expect(findKey(s, 'notif:n3')).toMatchObject({ deepLink: '/informants?requests=1' })
    expect(findKey(s, 'notif:n4')).toMatchObject({ deepLink: '/cases?case=c-1&tab=intel' })
    expect(findKey(s, 'notif:n5')).toMatchObject({ deepLink: '/informants' })
    // A request ping folds into the decision item for a reviewer.
    const r = src({ ...fullCi, ciRequests: [mkCiReq()], notifications: [mkNotif({ id: 'n6', type: 'ci_capacity_request', payload: { request_id: 'req-1' } })] })
    expect(buildActionItems(r).suppressedCount).toBe(1)
    expect(findKey(r, 'ci_request:req-1')!.sourceMetadata.notificationIds).toEqual(['n6'])
  })

})

/* ---- Platform upgrade (§2.10) — notification kinds → queue items ------------------- */

describe('platform-upgrade notification kinds', () => {
  const C = 'c-1'
  const M = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  const notif = (id: string, type: string, payload: Record<string, unknown>): AcNotif =>
    mkNotif({ id, type, payload: { case_id: C, case_number: 'CID-26-001', ...payload } })

  it('evidence integrity failure → critical, keyed on the media, deep-links the media', () => {
    const it = findKey(src({ notifications: [notif('n-1', 'evidence_integrity_failure', { media_id: M, evidence_number: 'EV-000004' })] }), `evidence_integrity:${M}`)!
    expect(it.priority).toBe('critical')
    expect(it.status).toBe('needs_action')
    expect(it.sourceType).toBe('other')
    expect(it.deepLink).toBe(`/cases?case=${C}&tab=media&media=${M}`)
    expect(it.summary).toBe('CID-26-001') // case number leads; the evidence number is the fallback identifier
    expect(it.actionLabel).toBe('Mark read')
    expect(it.sourceMetadata.notificationIds).toEqual(['n-1'])
  })

  it('packet ready → normal; packet failed → high; both land on the Documents tab with the packet selected', () => {
    const ready = findKey(src({ notifications: [notif('n-1', 'case_packet_ready', { packet_id: 'p-1' })] }), 'packet:p-1')!
    expect(ready.priority).toBe('normal')
    expect(ready.status).toBe('informational')
    expect(ready.deepLink).toBe(`/cases?case=${C}&tab=documents&packet=p-1`)
    const failed = findKey(src({ notifications: [notif('n-2', 'case_packet_failed', { packet_id: 'p-1' })] }), 'packet_failed:p-1')!
    expect(failed.priority).toBe('high')
    expect(failed.status).toBe('needs_action')
  })

  it('source changed → normal at /intelligence?source=; source failed → high', () => {
    const changed = findKey(src({ notifications: [notif('n-1', 'external_source_changed', { source_id: 's-1' })] }), 'source:s-1')!
    expect(changed.priority).toBe('normal')
    expect(changed.deepLink).toBe('/intelligence?source=s-1')
    const failed = findKey(src({ notifications: [notif('n-2', 'external_source_failed', { source_id: 's-1' })] }), 'source_failed:s-1')!
    expect(failed.priority).toBe('high')
  })

  it('documents, bundles and custody', () => {
    const q = buildActionItems(src({ notifications: [
      notif('n-1', 'document_ready', { media_id: M }),
      notif('n-2', 'document_failed', { media_id: M }),
      notif('n-3', 'evidence_bundle_ready', { job_id: 'j-1' }),
      notif('n-4', 'evidence_custody_transfer', { media_id: M, evidence_number: 'EV-000004' }),
    ] }))
    expect(byKey(q, `document:${M}`)).toMatchObject({ priority: 'normal', deepLink: `/cases?case=${C}&tab=documents&media=${M}` })
    expect(byKey(q, `document_failed:${M}`)).toMatchObject({ priority: 'high' })
    expect(byKey(q, 'bundle:j-1')).toMatchObject({ priority: 'normal', deepLink: `/cases?case=${C}&tab=documents` })
    expect(byKey(q, `custody:${M}`)).toMatchObject({ priority: 'high', status: 'needs_action', isWaitingOnCurrentUser: true, deepLink: `/cases?case=${C}&tab=media&media=${M}` })
  })

  it('background job failed → an owner signal (high) pointing at System Health, named by job kind', () => {
    const it = findKey(src({ notifications: [notif('n-1', 'background_job_failed', { job_id: 'j-9', kind: 'packet.render' })] }), 'job:j-9')!
    expect(it.sourceType).toBe('owner_signal')
    expect(it.priority).toBe('high')
    expect(it.deepLink).toBe('/owner?s=health')
    expect(it.summary).toBe('Packet render')
    expect(it.isCommandItem).toBe(true)
  })

  it('a second ping about the same subject folds into the first item; a payload without an id keys on the notification', () => {
    const q = buildActionItems(src({ notifications: [
      notif('n-1', 'external_source_changed', { source_id: 's-1' }),
      notif('n-2', 'external_source_changed', { source_id: 's-1' }),
      notif('n-3', 'case_packet_ready', {}),
    ] }))
    expect(q.suppressedCount).toBe(1)
    expect(byKey(q, 'source:s-1')?.sourceMetadata.notificationIds).toEqual(['n-1', 'n-2'])
    expect(byKey(q, 'notif:n-3')).toMatchObject({ priority: 'normal' })
    // Every key satisfies action_item_state's grammar.
    for (const it of q.items) expect(it.dedupeKey).toMatch(/^[a-z_]+:[A-Za-z0-9_:.@-]+$/)
  })
})
