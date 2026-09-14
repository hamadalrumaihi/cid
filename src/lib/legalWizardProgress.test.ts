/** The legal wizard's progress rail, and where a reviewer's note belongs.
 *
 *  A wizard whose steps are numbered and nothing more asks the investigator to
 *  hold the whole form in their head: which step is finished, which one is
 *  missing something, and — after a return — which step the reviewer was
 *  actually complaining about. Both are derivable from state the wizard
 *  already has, so they are derived here, purely, and tested.
 *
 *  What this does NOT do is change what is required. `legalWizardIssues` is
 *  still the single mirror of the server's checks; this reads it.
 */
import { describe, expect, it } from 'vitest'
import {
  legalStepProgress, revisionStepFor,
  type LegalWizardInput, type LegalWizardStepId,
} from './legalWorkflow'

const complete: LegalWizardInput = {
  requestType: 'warrant',
  subtype: 'search_warrant',
  caseId: 'case-1',
  personId: 'person-1',
  recipientType: 'player',
  recipientName: 'A. Suspect',
  title: 'Search warrant — 12 Grove St',
  priority: 'Medium',
  narrative: 'x'.repeat(400),
  form: { standard_of_proof: 'probable_cause', probable_cause: 'y'.repeat(200), premises: '12 Grove St', items_sought: 'phones' },
  routingBureau: 'major_crimes',
}

describe('what the rail can say about a step', () => {
  it('marks a step complete when nothing is missing from it', () => {
    const p = legalStepProgress('case_target', complete, { visited: true })
    expect(p.state).toBe('complete')
    expect(p.missing).toBe(0)
  })

  it('counts what a step is still missing, and says it in words', () => {
    const p = legalStepProgress('case_target', { ...complete, caseId: '' }, { visited: true })
    expect(p.state).toBe('incomplete')
    expect(p.missing).toBeGreaterThan(0)
    expect(p.label).toMatch(/missing/i)
  })

  it('does not accuse a step the investigator has not reached yet', () => {
    const p = legalStepProgress('narrative', { ...complete, narrative: '' }, { visited: false })
    expect(p.state, 'unvisited and incomplete is "not started", not a failure').toBe('todo')
    expect(p.label).toMatch(/not started/i)
  })

  it('calls an unvisited step that needs nothing complete — optional steps are not chores', () => {
    // Charges and evidence never block; an untouched one is not a to-do item.
    expect(legalStepProgress('charges', complete, { visited: false }).state).toBe('complete')
    expect(legalStepProgress('evidence', complete, { visited: false }).state).toBe('complete')
  })

  it('never reports progress through colour alone — every state carries text', () => {
    for (const step of ['type', 'case_target', 'charges', 'details', 'evidence', 'narrative', 'review'] as LegalWizardStepId[]) {
      const p = legalStepProgress(step, complete, { visited: true })
      expect(p.label, step).toBeTruthy()
    }
  })
})

describe('where a returned request’s notes belong', () => {
  it('routes a reviewer’s note to the step that owns the field', () => {
    expect(revisionStepFor('title')).toBe('case_target')
    expect(revisionStepFor('person')).toBe('case_target')
    expect(revisionStepFor('recipient_name')).toBe('case_target')
    expect(revisionStepFor('narrative')).toBe('narrative')
    expect(revisionStepFor('probable_cause')).toBe('narrative')
    expect(revisionStepFor('standard_of_proof')).toBe('narrative')
    expect(revisionStepFor('charges')).toBe('charges')
    expect(revisionStepFor('evidence')).toBe('evidence')
    expect(revisionStepFor('exhibits')).toBe('evidence')
  })

  it('sends a type-specific field to the details step', () => {
    expect(revisionStepFor('premises')).toBe('details')
    expect(revisionStepFor('items_sought')).toBe('details')
    expect(revisionStepFor('anything_else_unknown')).toBe('details')
  })

  it('puts a general note where it cannot be missed — the review step', () => {
    expect(revisionStepFor(null)).toBe('review')
    expect(revisionStepFor('')).toBe('review')
  })
})
