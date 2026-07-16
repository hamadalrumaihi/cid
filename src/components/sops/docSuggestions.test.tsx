import { describe, expect, it } from 'vitest'
import {
  DECISION_STATUSES, SUGGESTION_STATUSES, SUGGESTION_TYPES,
  decisionRequiresNote, groupSuggestions, isOpenSuggestion,
  submitSuggestionParams, suggestionFormError, suggestionGroup,
} from './docSuggestions'

describe('docSuggestions vocabulary', () => {
  it('labels every status and type', () => {
    expect(SUGGESTION_STATUSES).toHaveLength(8)
    expect(SUGGESTION_TYPES).toHaveLength(10)
  })

  it('decision statuses exclude the terminal/auto states', () => {
    // submitted (initial), duplicate + implemented (own RPCs) are not manual decisions
    expect(DECISION_STATUSES).not.toContain('submitted')
    expect(DECISION_STATUSES).not.toContain('duplicate')
    expect(DECISION_STATUSES).not.toContain('implemented')
    expect(DECISION_STATUSES).toContain('accepted')
  })

  it('requires a note only for decline / needs-more-info', () => {
    expect(decisionRequiresNote('declined')).toBe(true)
    expect(decisionRequiresNote('needs_more_information')).toBe(true)
    expect(decisionRequiresNote('accepted')).toBe(false)
    expect(decisionRequiresNote('under_review')).toBe(false)
  })
})

describe('review grouping', () => {
  it('maps each status to its workspace column', () => {
    expect(suggestionGroup('submitted')).toBe('new')
    expect(suggestionGroup('under_review')).toBe('under_review')
    expect(suggestionGroup('needs_more_information')).toBe('under_review')
    expect(suggestionGroup('accepted')).toBe('accepted')
    expect(suggestionGroup('partially_accepted')).toBe('accepted')
    expect(suggestionGroup('implemented')).toBe('implemented')
    expect(suggestionGroup('declined')).toBe('closed')
    expect(suggestionGroup('duplicate')).toBe('closed')
  })

  it('open state excludes implemented/declined/duplicate', () => {
    expect(isOpenSuggestion('submitted')).toBe(true)
    expect(isOpenSuggestion('accepted')).toBe(true)
    expect(isOpenSuggestion('implemented')).toBe(false)
    expect(isOpenSuggestion('declined')).toBe(false)
  })

  it('groups a flat list preserving order', () => {
    const rows = [
      { id: 'a', status: 'submitted' },
      { id: 'b', status: 'accepted' },
      { id: 'c', status: 'submitted' },
      { id: 'd', status: 'duplicate' },
    ]
    const g = groupSuggestions(rows)
    expect(g.new.map((r) => r.id)).toEqual(['a', 'c'])
    expect(g.accepted.map((r) => r.id)).toEqual(['b'])
    expect(g.closed.map((r) => r.id)).toEqual(['d'])
    expect(g.under_review).toEqual([])
  })
})

describe('submit params + validation', () => {
  it('trims and nulls empties, keeps ids', () => {
    const p = submitSuggestionParams({
      documentId: 'doc-1', type: 'unclear', title: '  Fix step 3 ',
      explanation: ' the wording is confusing ', sectionId: '  ',
      sectionTitle: 'Step 3', proposedText: '', relatedCaseId: null, sourceUrl: ' /sops?doc=doc-1 ',
    })
    expect(p.p_document).toBe('doc-1')
    expect(p.p_title).toBe('Fix step 3')
    expect(p.p_explanation).toBe('the wording is confusing')
    expect(p.p_section_id).toBeNull()          // whitespace-only → null
    expect(p.p_section_title).toBe('Step 3')
    expect(p.p_proposed_text).toBeNull()
    expect(p.p_source_url).toBe('/sops?doc=doc-1')
  })

  it('carries a null document for new-document proposals', () => {
    const p = submitSuggestionParams({
      documentId: null, type: 'new_document', title: 'Add K-9 SOP', explanation: 'We need one.',
    })
    expect(p.p_document).toBeNull()
    expect(p.p_type).toBe('new_document')
  })

  it('flags missing required fields', () => {
    expect(suggestionFormError({ title: '', explanation: 'x', type: 'unclear' })).toMatch(/title/i)
    expect(suggestionFormError({ title: 'x', explanation: '', type: 'unclear' })).toMatch(/explain/i)
    expect(suggestionFormError({ title: 'x', explanation: 'y', type: '' })).toMatch(/kind/i)
    expect(suggestionFormError({ title: 'x', explanation: 'y', type: 'unclear' })).toBeNull()
  })
})
