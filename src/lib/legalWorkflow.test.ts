import { describe, it, expect } from 'vitest'
import {
  currentStage, stageForReviewStatus, stagesForRequest, laneThatAdvanced,
  judgeClaimEligible, responsibleRole, dispositionFor, isBureauAwareness,
  routingExplanation, canReviewJusticeRole, canAssignAsJudge, canAssignAsProsecutor,
  issuedStateFor, issuedActionLabel, urgencyFor, activeDeadline, formatTarget,
  subtypeRequiresPerson, subtypeSupportsStructuredTargets,
  type LegalReqLike, type LegalViewer,
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

describe('action vs awareness distinction (spec §5/§9)', () => {
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

describe('issued / service-return mapping (spec §15/§29-30)', () => {
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

describe('routing explanation (deterministic, no runtime AI)', () => {
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
