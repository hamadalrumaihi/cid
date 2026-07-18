import { describe, it, expect } from 'vitest'
import {
  countViewerActionable,
  currentStage, stageForReviewStatus, stagesForRequest, laneThatAdvanced,
  judgeClaimEligible, responsibleRole, dispositionFor, isBureauAwareness,
  routingExplanation, canReviewJusticeRole, canAssignAsJudge, canAssignAsProsecutor,
  issuedStateFor, issuedActionLabel, urgencyFor, activeDeadline, formatTarget,
  ISSUED_STATE_LABEL, ISSUED_STATE_ORDER,
  subtypeRequiresPerson, subtypeSupportsStructuredTargets, fulfilmentEvents,
  LEGAL_WIZARD_STEPS, legalWizardIssues, legalWizardDraftIssues,
  structuredTargetLine, appendSearchTargetLine,
  type LegalFulfilmentLike, type LegalReqLike, type LegalViewer, type LegalWizardInput,
} from './legalWorkflow'

const NOW = Date.parse('2026-07-17T00:00:00Z')

// Minimal request factory — only the fields the model reads.
function req(over: Partial<LegalReqLike> = {}): LegalReqLike {
  return {
    created_by: 'inv-1', review_status: 'submitted_to_doj', document_status: 'finalized',
    fulfilment_status: 'unissued', service_status: 'not_served', compliance_status: 'pending',
    approval_route: 'judge', classification: 'classified', request_type: 'warrant',
    subtype: 'search_warrant', responsible_bureau: 'SAB',
    assigned_ada_id: null, assigned_judge_id: null,
    expires_at: null, response_deadline: null, submitted_to_doj_at: '2026-07-15T00:00:00Z',
    ...over,
  }
}
function viewer(over: Partial<LegalViewer> = {}): LegalViewer {
  return { myId: 'u-1', cidActive: false, cidRole: null, justiceRole: null, isOwner: false, ...over }
}

describe('stage derivation', () => {
  it('maps review statuses to lifecycle stages', () => {
    expect(stageForReviewStatus('not_submitted')).toBe('draft')
    expect(stageForReviewStatus('returned_by_judge')).toBe('draft') // returns collapse to the fix owner
    expect(stageForReviewStatus('cid_supervisor_review')).toBe('cid_review')
    expect(stageForReviewStatus('submitted_to_doj')).toBe('doj_intake')
    expect(stageForReviewStatus('ada_review')).toBe('prosecutorial_review')
    expect(stageForReviewStatus('da_review')).toBe('prosecutorial_review')
    expect(stageForReviewStatus('judicial_review')).toBe('judicial_review')
    expect(stageForReviewStatus('approved')).toBe('issued')
    expect(stageForReviewStatus('denied')).toBe('closed')
  })
  it('folds fulfilment into the lifecycle stage once approved', () => {
    expect(currentStage(req({ review_status: 'approved', fulfilment_status: 'issued' }))).toBe('issued')
    expect(currentStage(req({ review_status: 'approved', fulfilment_status: 'executed' }))).toBe('fulfilment')
    expect(currentStage(req({ review_status: 'approved', fulfilment_status: 'closed' }))).toBe('closed')
  })
  it('renders judicial stage only for judge-routed requests', () => {
    expect(stagesForRequest(req({ approval_route: 'judge' }))).toContain('judicial_review')
    expect(stagesForRequest(req({ approval_route: 'da' }))).not.toContain('judicial_review')
  })
})

describe('parallel-lane rendering', () => {
  it('judicial lane when a judge claimed directly from DOJ (no ADA ever assigned)', () => {
    expect(laneThatAdvanced(req({ review_status: 'judicial_review', assigned_judge_id: 'j-1', assigned_ada_id: null }))).toBe('judicial')
  })
  it('prosecutorial lane when an ADA was assigned first', () => {
    expect(laneThatAdvanced(req({ review_status: 'judicial_review', assigned_judge_id: 'j-1', assigned_ada_id: 'a-1' }))).toBe('prosecutorial')
    expect(laneThatAdvanced(req({ review_status: 'ada_review', assigned_ada_id: 'a-1' }))).toBe('prosecutorial')
  })
  it('no lane yet at bare DOJ intake', () => {
    expect(laneThatAdvanced(req({ review_status: 'submitted_to_doj' }))).toBeNull()
  })
})

describe('judge claim eligibility (mirror of claim_legal_request_as_judge)', () => {
  const judge = viewer({ myId: 'j-1', justiceRole: 'judge' })
  it('eligible: judge, judge-routed, non-sealed, waiting, no judge yet, not creator', () => {
    expect(judgeClaimEligible(req(), judge)).toBe(true)
    expect(judgeClaimEligible(req({ review_status: 'submitted_to_judge' }), judge)).toBe(true)
  })
  it('rejects sealed', () => {
    expect(judgeClaimEligible(req({ classification: 'sealed' }), judge)).toBe(false)
  })
  it('rejects when a judge is already assigned', () => {
    expect(judgeClaimEligible(req({ assigned_judge_id: 'j-2' }), judge)).toBe(false)
  })
  it('rejects the creator claiming their own request', () => {
    expect(judgeClaimEligible(req({ created_by: 'j-1' }), judge)).toBe(false)
  })
  it('rejects non-judges (ADA/DA/CID/anon)', () => {
    expect(judgeClaimEligible(req(), viewer({ justiceRole: 'assistant_district_attorney' }))).toBe(false)
    expect(judgeClaimEligible(req(), viewer({ cidActive: true, cidRole: 'director' }))).toBe(false)
    expect(judgeClaimEligible(req(), viewer({ myId: null }))).toBe(false)
  })
  it('rejects wrong state and da-routed', () => {
    expect(judgeClaimEligible(req({ review_status: 'ada_review' }), judge)).toBe(false)
    expect(judgeClaimEligible(req({ approval_route: 'da' }), judge)).toBe(false)
  })
})

describe('responsible role', () => {
  it('tracks who owns the next action', () => {
    expect(responsibleRole(req({ review_status: 'not_submitted' }))).toBe('investigator')
    expect(responsibleRole(req({ review_status: 'returned_by_ada' }))).toBe('investigator')
    expect(responsibleRole(req({ review_status: 'cid_supervisor_review' }))).toBe('cid_supervisor')
    expect(responsibleRole(req({ review_status: 'submitted_to_doj', assigned_ada_id: null, approval_route: 'judge' }))).toBe('any_judge')
    expect(responsibleRole(req({ review_status: 'submitted_to_doj', assigned_ada_id: 'a-1' }))).toBe('assigned_ada')
    expect(responsibleRole(req({ review_status: 'ada_review' }))).toBe('assigned_ada')
    expect(responsibleRole(req({ review_status: 'judicial_review' }))).toBe('assigned_judge')
  })
})

describe('action vs awareness distinction', () => {
  it('a bureau prosecutor sees a parked bureau request as awareness-only, not assigned', () => {
    const prosecutor = viewer({ myId: 'p-1', justiceRole: 'assistant_district_attorney', prosecutorBureaus: ['SAB'] })
    const r = req({ review_status: 'submitted_to_doj', responsible_bureau: 'SAB', assigned_ada_id: null })
    expect(isBureauAwareness(r, prosecutor)).toBe(true)
    const d = dispositionFor(r, prosecutor, NOW)
    expect(d.awarenessOnly).toBe(true)
    expect(d.viewerCanAct).toBe(false)
    expect(d.group).toBe('awareness')
    expect(d.nextAction).toBe('Awareness only')
  })
  it('a different bureau prosecutor gets no awareness flag', () => {
    const bcb = viewer({ myId: 'p-2', justiceRole: 'assistant_district_attorney', prosecutorBureaus: ['BCB'] })
    expect(isBureauAwareness(req({ responsible_bureau: 'SAB' }), bcb)).toBe(false)
  })
  it('the assigned ADA is action, not awareness', () => {
    const ada = viewer({ myId: 'a-1', justiceRole: 'assistant_district_attorney', prosecutorBureaus: ['SAB'] })
    const d = dispositionFor(req({ review_status: 'ada_review', assigned_ada_id: 'a-1' }), ada, NOW)
    expect(d.viewerCanAct).toBe(true)
    expect(d.awarenessOnly).toBe(false)
    expect(d.group).toBe('assigned_to_you')
    expect(d.nextAction).toBe('Review as assigned ADA')
  })
})

describe('next-action derivation + grouping', () => {
  it('creator draft/returned', () => {
    const inv = viewer({ myId: 'inv-1', cidActive: true, cidRole: 'detective' })
    expect(dispositionFor(req({ review_status: 'not_submitted', created_by: 'inv-1' }), inv, NOW).nextAction).toBe('Finish draft')
    const ret = dispositionFor(req({ review_status: 'returned_by_ada', created_by: 'inv-1' }), inv, NOW)
    expect(ret.nextAction).toBe('Revise and resubmit')
    expect(ret.group).toBe('returned_to_you')
  })
  it('CID supervisor can act on cid_supervisor_review (not the creator)', () => {
    const sup = viewer({ myId: 'sup-1', cidActive: true, cidRole: 'bureau_lead' })
    const d = dispositionFor(req({ review_status: 'cid_supervisor_review', created_by: 'inv-1' }), sup, NOW)
    expect(d.viewerCanAct).toBe(true)
    expect(d.nextAction).toBe('Review as CID supervisor')
    expect(d.group).toBe('needs_action')
  })
  it('a judge sees an eligible request as available-to-claim', () => {
    const judge = viewer({ myId: 'j-1', justiceRole: 'judge' })
    const d = dispositionFor(req(), judge, NOW)
    expect(d.viewerCanClaim).toBe(true)
    expect(d.group).toBe('available_to_claim')
    expect(d.nextAction).toBe('Take for judicial review')
  })
  it('an uninvolved viewer sees waiting, never action', () => {
    const other = viewer({ myId: 'x', cidActive: true, cidRole: 'detective' })
    const d = dispositionFor(req({ review_status: 'ada_review', assigned_ada_id: 'a-9', created_by: 'inv-1' }), other, NOW)
    expect(d.viewerCanAct).toBe(false)
    expect(d.group).toBe('waiting_prosecution')
  })
})

describe('countViewerActionable (case Legal tab marker)', () => {
  it('counts only rows the viewer can act on — claimable and awareness excluded', () => {
    const rows = [
      req({ review_status: 'ada_review', assigned_ada_id: 'a-1' }),          // actionable for the ADA
      req({ review_status: 'submitted_to_doj', responsible_bureau: 'SAB' }), // awareness for a SAB prosecutor
      req({ review_status: 'ada_review', assigned_ada_id: 'a-9' }),          // someone else's review
    ]
    const ada = viewer({ myId: 'a-1', justiceRole: 'assistant_district_attorney', prosecutorBureaus: ['SAB'] })
    expect(countViewerActionable(rows, ada, NOW)).toBe(1)
    // A judge could CLAIM the parked request, but claimable is not "needs your action".
    const judge = viewer({ myId: 'j-1', justiceRole: 'judge' })
    expect(countViewerActionable(rows, judge, NOW)).toBe(0)
    expect(countViewerActionable([], ada, NOW)).toBe(0)
  })

  it('returned requests count for their creator', () => {
    const inv = viewer({ myId: 'inv-1', cidActive: true, cidRole: 'detective' })
    expect(countViewerActionable([req({ review_status: 'returned_by_ada', created_by: 'inv-1' })], inv, NOW)).toBe(1)
    expect(countViewerActionable([req({ review_status: 'returned_by_ada', created_by: 'other' })], inv, NOW)).toBe(0)
  })
})

describe('issued / service-return mapping', () => {
  it('issued-state', () => {
    expect(issuedStateFor(req({ review_status: 'approved', fulfilment_status: 'issued' }))).toBe('active')
    expect(issuedStateFor(req({ review_status: 'approved', fulfilment_status: 'executed' }))).toBe('executed')
    expect(issuedStateFor(req({ review_status: 'approved', fulfilment_status: 'served' }))).toBe('served')
    expect(issuedStateFor(req({ review_status: 'approved', fulfilment_status: 'returned' }))).toBe('returned')
    expect(issuedStateFor(req({ review_status: 'approved', fulfilment_status: 'revoked' }))).toBe('revoked')
  })
  it('expiry passes to expired even when marked issued', () => {
    expect(issuedStateFor(req({ review_status: 'approved', fulfilment_status: 'issued', expires_at: '2026-07-16T00:00:00Z' }), NOW)).toBe('expired')
  })
  it('the issued board covers every state exactly once, with a label', () => {
    expect(new Set(ISSUED_STATE_ORDER).size).toBe(ISSUED_STATE_ORDER.length)
    for (const s of ISSUED_STATE_ORDER) expect(ISSUED_STATE_LABEL[s]).toBeTruthy()
  })
  it('every fulfilment status lands on the issued board', () => {
    const statuses = [
      'unissued', 'issued', 'executed', 'served', 'returned', 'return_recorded',
      'records_received', 'testimony_completed', 'compliance_pending',
      'non_compliance', 'expired', 'revoked', 'closed',
    ]
    for (const f of statuses) {
      expect(ISSUED_STATE_ORDER).toContain(issuedStateFor(req({ review_status: 'approved', fulfilment_status: f }), NOW))
    }
  })
  it('issued-action label by type', () => {
    expect(issuedActionLabel(req({ request_type: 'warrant', fulfilment_status: 'issued' }))).toBe('Record execution')
    expect(issuedActionLabel(req({ request_type: 'subpoena', fulfilment_status: 'issued' }))).toBe('Record service')
    expect(issuedActionLabel(req({ fulfilment_status: 'executed' }))).toBe('File return')
  })
})

describe('deadlines + urgency', () => {
  it('overdue / soon / normal / none', () => {
    expect(urgencyFor(req({ response_deadline: '2026-07-16T00:00:00Z' }), NOW)).toBe('overdue')
    expect(urgencyFor(req({ response_deadline: '2026-07-18T00:00:00Z' }), NOW)).toBe('soon')
    expect(urgencyFor(req({ response_deadline: '2026-07-30T00:00:00Z' }), NOW)).toBe('normal')
    expect(urgencyFor(req({ response_deadline: null, expires_at: null }), NOW)).toBe('none')
  })
  it('active deadline prefers warrant expiry once issued', () => {
    const d = activeDeadline(req({ fulfilment_status: 'issued', expires_at: '2026-07-20T00:00:00Z', response_deadline: '2026-07-19T00:00:00Z' }))
    expect(d).toEqual({ at: '2026-07-20T00:00:00Z', kind: 'expires' })
  })
})

describe('routing explanation', () => {
  it('parallel-lane explanation for a non-sealed judge-routed DOJ request', () => {
    expect(routingExplanation(req())).toContain('Judge may claim it directly')
  })
  it('sealed explanation excludes open pickup', () => {
    expect(routingExplanation(req({ classification: 'sealed' }))).toContain('not available for open judicial pickup')
  })
  it('bureau awareness explanation', () => {
    const prosecutor = viewer({ myId: 'p-1', justiceRole: 'assistant_district_attorney', prosecutorBureaus: ['SAB'] })
    expect(routingExplanation(req(), prosecutor)).toContain('bureau awareness')
  })
})

describe('fulfilment event derivation (service/return event cards)', () => {
  // Minimal fulfilment factory — same non-null defaults as the request factory
  // (service_status: 'not_served', compliance_status: 'pending').
  function ful(over: Partial<LegalFulfilmentLike> = {}): LegalFulfilmentLike {
    return {
      request_type: 'warrant', fulfilment_status: 'unissued',
      service_status: 'not_served', compliance_status: 'pending',
      issued_at: null, issued_by: null,
      executed_at: null, executed_by: null, execution_outcome: null, execution_notes: null,
      returned_at: null, return_filed_by: null, return_narrative: null,
      served_at: null, served_by: null, service_method: null, service_notes: null,
      compliance_date: null, compliance_notes: null, non_compliance_reason: null,
      revoked_at: null, revoked_by: null, revoke_reason: null,
      closed_at: null, closed_by: null, close_note: null,
      ...over,
    }
  }
  it('an untouched request yields no events', () => {
    expect(fulfilmentEvents(ful())).toEqual([])
  })
  it('warrant lifecycle: issued → executed → return filed', () => {
    const events = fulfilmentEvents(ful({
      fulfilment_status: 'returned',
      issued_at: '2026-07-01T00:00:00Z', issued_by: 'cid-1',
      executed_at: '2026-07-02T00:00:00Z', executed_by: 'cid-1',
      execution_outcome: 'Suspect in custody', execution_notes: 'No resistance',
      returned_at: '2026-07-03T00:00:00Z', return_filed_by: 'cid-1', return_narrative: 'Return complete',
    }))
    expect(events.map((e) => e.id)).toEqual(['issued', 'executed', 'return'])
    expect(events[1].detail).toEqual([
      { label: 'Outcome', value: 'Suspect in custody' },
      { label: 'Notes', value: 'No resistance' },
    ])
    expect(events[2].byId).toBe('cid-1')
  })
  it('subpoena lifecycle: service + compliance surface with humanised labels', () => {
    const events = fulfilmentEvents(ful({
      request_type: 'subpoena', fulfilment_status: 'non_compliance',
      served_at: '2026-07-04T00:00:00Z', served_by: 'cid-2',
      service_status: 'served', service_method: 'In person',
      compliance_status: 'non_compliant', compliance_date: '2026-07-10T00:00:00Z',
      non_compliance_reason: 'Records withheld',
    }))
    expect(events.map((e) => e.label)).toEqual(['Service — Served', 'Compliance — Non Compliant'])
    expect(events[1].detail[0]).toEqual({ label: 'Non-compliance reason', value: 'Records withheld' })
  })
  it('warrant never emits subpoena service/compliance events and vice versa', () => {
    expect(fulfilmentEvents(ful({ service_status: 'served', compliance_status: 'complete' }))).toEqual([])
    expect(fulfilmentEvents(ful({ request_type: 'subpoena', execution_outcome: 'x', return_narrative: 'y' }))).toEqual([])
  })
  it('revocation and closure events, with expired closures labelled as such', () => {
    const revoked = fulfilmentEvents(ful({ fulfilment_status: 'revoked', revoked_at: '2026-07-05T00:00:00Z', revoked_by: 'da-1', revoke_reason: 'Superseded' }))
    expect(revoked[0]).toMatchObject({ id: 'revoked', label: 'Revoked', byId: 'da-1' })
    const expired = fulfilmentEvents(ful({ fulfilment_status: 'expired', closed_at: '2026-07-06T00:00:00Z', closed_by: 'cid-1' }))
    expect(expired[0].label).toBe('Marked expired')
    const closed = fulfilmentEvents(ful({ fulfilment_status: 'closed', closed_at: '2026-07-06T00:00:00Z', close_note: 'Done' }))
    expect(closed[0]).toMatchObject({ label: 'Closed', detail: [{ label: 'Note', value: 'Done' }] })
  })
})

describe('guided create wizard (pure step model)', () => {
  // Minimal wizard-input factory — a valid search-warrant draft by default.
  function wiz(over: Partial<LegalWizardInput> = {}): LegalWizardInput {
    return {
      requestType: 'warrant', subtype: 'search_warrant', caseId: 'c-1', personId: '',
      recipientType: 'player', recipientName: '', title: 'Search Warrant — stash house',
      priority: 'High', narrative: 'Probable cause narrative.',
      form: { search_targets: 'Place: The stash house', items_sought: 'Contraband' },
      ...over,
    }
  }

  it('publishes the canonical step order', () => {
    expect(LEGAL_WIZARD_STEPS.map((s) => s.id)).toEqual(['type', 'case_target', 'details', 'narrative', 'review'])
  })

  it('type step requires a chosen subtype', () => {
    expect(legalWizardIssues('type', wiz({ subtype: null }))).toHaveLength(1)
    expect(legalWizardIssues('type', wiz())).toEqual([])
  })

  it('case & target: case always, person per subtype/recipient rules', () => {
    expect(legalWizardIssues('case_target', wiz({ caseId: '' }))).toHaveLength(1)
    expect(legalWizardIssues('case_target', wiz({ subtype: 'arrest_warrant', personId: '' }))).toHaveLength(1)
    expect(legalWizardIssues('case_target', wiz({ subtype: 'arrest_warrant', personId: 'p-1' }))).toEqual([])
    // search warrants: subject optional at this step (the target rule lives on details)
    expect(legalWizardIssues('case_target', wiz({ personId: '' }))).toEqual([])
    const sub = wiz({ requestType: 'subpoena', subtype: 'testimony', form: { testimony_subject: 'x' } })
    expect(legalWizardIssues('case_target', { ...sub, recipientType: 'player', personId: '' })).toHaveLength(1)
    expect(legalWizardIssues('case_target', { ...sub, recipientType: 'entity', recipientName: '' })).toHaveLength(1)
    expect(legalWizardIssues('case_target', { ...sub, recipientType: 'entity', recipientName: 'Maze Bank' })).toEqual([])
  })

  it('details: required type-specific fields are enforced', () => {
    const sub = wiz({ requestType: 'subpoena', subtype: 'testimony', personId: 'p-1', form: {} })
    expect(legalWizardIssues('details', sub)).toEqual(['Testimony Subject is required.'])
    expect(legalWizardIssues('details', { ...sub, form: { testimony_subject: 'What they saw' } })).toEqual([])
  })

  it('details mirrors the server search-warrant rule EXACTLY: subject OR search_targets text', () => {
    // neither → blocked (same error the server raises)
    expect(legalWizardIssues('details', wiz({ personId: '', form: { items_sought: 'x' } })))
      .toContain('A search warrant requires a subject or at least one search target.')
    // subject only, no search_targets text → allowed (server allows it)
    expect(legalWizardIssues('details', wiz({ personId: 'p-1', form: { items_sought: 'x' } }))).toEqual([])
    // search_targets text only (typed or mirrored from structured targets) → allowed
    expect(legalWizardIssues('details', wiz({ personId: '', form: { items_sought: 'x', search_targets: 'Vehicle: ABC123' } }))).toEqual([])
  })

  it('narrative: title + narrative always, priority for warrants only', () => {
    expect(legalWizardIssues('narrative', wiz({ title: ' ' }))).toHaveLength(1)
    expect(legalWizardIssues('narrative', wiz({ narrative: '' }))).toHaveLength(1)
    expect(legalWizardIssues('narrative', wiz({ priority: '' }))).toHaveLength(1)
    expect(legalWizardIssues('narrative', wiz({ requestType: 'subpoena', subtype: 'testimony', priority: '' }))).toEqual([])
  })

  it('review unions every earlier step', () => {
    const broken = wiz({ caseId: '', title: '', form: {} , personId: '' })
    const issues = legalWizardIssues('review', broken)
    expect(issues).toContain('Select a case.')
    expect(issues).toContain('A title is required.')
    expect(issues).toContain('A search warrant requires a subject or at least one search target.')
    expect(legalWizardIssues('review', wiz())).toEqual([])
  })

  it('draft issues mirror create_legal_request (no narrative/priority/detail requirements)', () => {
    // A titled search warrant with a target can be saved without narrative or details.
    expect(legalWizardDraftIssues(wiz({ narrative: '', priority: '', form: { search_targets: 'Place: X' } }))).toEqual([])
    expect(legalWizardDraftIssues(wiz({ title: '' }))).toContain('A title is required.')
    expect(legalWizardDraftIssues(wiz({ personId: '', form: {} })))
      .toContain('A search warrant requires a subject or at least one search target.')
    expect(legalWizardDraftIssues(wiz({ subtype: 'arrest_warrant', personId: '' })))
      .toContain('An arrest warrant requires a suspect from the Persons registry.')
  })

  it('structured targets mirror deterministic lines into search_targets', () => {
    expect(structuredTargetLine({ kind: 'vehicle', label: 'ABC123 — Sultan' })).toBe('Vehicle: ABC123 — Sultan')
    expect(structuredTargetLine({ kind: 'prior_legal_request', label: 'LR-0042' })).toBe('Prior legal request: LR-0042')
    expect(appendSearchTargetLine('', 'Vehicle: ABC123')).toBe('Vehicle: ABC123')
    expect(appendSearchTargetLine('Person: John Doe', 'Vehicle: ABC123')).toBe('Person: John Doe\nVehicle: ABC123')
    // idempotent — re-adding an existing line never duplicates it
    expect(appendSearchTargetLine('Vehicle: ABC123', 'Vehicle: ABC123')).toBe('Vehicle: ABC123')
    expect(appendSearchTargetLine('kept text', '')).toBe('kept text')
  })
})

describe('justice approval matrix (mirror of can_review_justice_role)', () => {
  it('ADA reviewed by DA/AG/Owner', () => {
    expect(canReviewJusticeRole('district_attorney', false, 'assistant_district_attorney')).toBe(true)
    expect(canReviewJusticeRole('attorney_general', false, 'assistant_district_attorney')).toBe(true)
    expect(canReviewJusticeRole('judge', false, 'assistant_district_attorney')).toBe(false)
  })
  it('DA reviewed by AG/Owner only', () => {
    expect(canReviewJusticeRole('attorney_general', false, 'district_attorney')).toBe(true)
    expect(canReviewJusticeRole('district_attorney', false, 'district_attorney')).toBe(false)
  })
  it('AG and Judge are Owner-only', () => {
    expect(canReviewJusticeRole('attorney_general', false, 'attorney_general')).toBe(false)
    expect(canReviewJusticeRole(null, true, 'attorney_general')).toBe(true)
    expect(canReviewJusticeRole(null, true, 'judge')).toBe(true)
  })
})

describe('assignment eligibility + target/subtype helpers', () => {
  it('judge/prosecutor assignment eligibility', () => {
    expect(canAssignAsJudge({ active: true, justice_role: 'judge' })).toBe(true)
    expect(canAssignAsJudge({ active: false, justice_role: 'judge' })).toBe(false)
    expect(canAssignAsProsecutor({ active: true, justice_role: 'assistant_district_attorney' })).toBe(true)
    expect(canAssignAsProsecutor({ active: true, justice_role: 'judge' })).toBe(false)
  })
  it('target formatting', () => {
    expect(formatTarget({ person_name_snapshot: 'John Doe', recipient_name: null, recipient_type: null })).toBe('John Doe')
    expect(formatTarget({ person_name_snapshot: null, recipient_name: 'Maze Bank', recipient_type: 'organization' })).toBe('Maze Bank (Organization)')
    expect(formatTarget({ person_name_snapshot: null, recipient_name: null, recipient_type: null })).toBe('—')
  })
  it('subtype requirements', () => {
    expect(subtypeRequiresPerson('warrant', 'arrest_warrant')).toBe(true)
    expect(subtypeRequiresPerson('warrant', 'search_warrant')).toBe(false)
    expect(subtypeSupportsStructuredTargets('warrant', 'search_warrant')).toBe(true)
    expect(subtypeSupportsStructuredTargets('warrant', 'arrest_warrant')).toBe(false)
  })
})

describe('remediation pins — executed grouping, parked ownership, AG judge review', () => {
  it('an executed warrant is outstanding return work, not completed', () => {
    const r = req({ review_status: 'approved', fulfilment_status: 'executed' })
    expect(dispositionFor(r, viewer({ myId: 'inv-1', cidActive: true, cidRole: 'detective' }), NOW).group).toBe('service_return_pending')
  })
  it('a parked coverage-gap request is DOJ management\'s action', () => {
    const parked = req({ review_status: 'submitted_to_doj', assigned_ada_id: null })
    expect(dispositionFor(parked, viewer({ justiceRole: 'district_attorney' }), NOW).viewerCanAct).toBe(true)
    expect(dispositionFor(parked, viewer({ justiceRole: 'attorney_general' }), NOW).viewerCanAct).toBe(true)
    expect(dispositionFor(parked, viewer({ justiceRole: 'assistant_district_attorney' }), NOW).viewerCanAct).toBe(false)
    const routed = req({ review_status: 'submitted_to_doj', assigned_ada_id: 'a-1' })
    expect(dispositionFor(routed, viewer({ justiceRole: 'district_attorney' }), NOW).viewerCanAct).toBe(false)
  })
  it('the AG reviews judge applications (server matrix 20260731010000)', () => {
    expect(canReviewJusticeRole('attorney_general', false, 'judge')).toBe(true)
    expect(canReviewJusticeRole('district_attorney', false, 'judge')).toBe(false)
    expect(canReviewJusticeRole('attorney_general', false, 'attorney_general')).toBe(false)
  })
  it('every fulfilment status lands in a coherent group (no completed-with-pending-return)', () => {
    const owed = ['issued', 'compliance_pending', 'non_compliance', 'executed']
    const done = ['served', 'returned', 'return_recorded', 'records_received', 'testimony_completed']
    const inv = viewer({ myId: 'inv-1', cidActive: true, cidRole: 'detective' })
    for (const f of owed) {
      const g = dispositionFor(req({ review_status: 'approved', fulfilment_status: f }), inv, NOW).group
      expect(['issued_active', 'service_return_pending'], f).toContain(g)
    }
    for (const f of done) {
      expect(dispositionFor(req({ review_status: 'approved', fulfilment_status: f }), inv, NOW).group, f).toBe('completed')
    }
  })
})
