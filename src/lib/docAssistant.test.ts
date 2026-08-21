/** Unit tests for the retrieval assistant.
 *
 *  The access boundary is the database's — search_document_sections is SECURITY
 *  INVOKER over a table whose visibility is the owning document's — and was
 *  probed live for each role. Recorded in the delivery notes.
 *
 *  What is pinned here is the part that decides how confident an answer sounds:
 *  which words are searched, and the line between "the documents say this" and
 *  "these mention some of it". A tool that blurred those two would be worse
 *  than no tool, because people would stop checking.
 */

import { describe, expect, it } from 'vitest'
import { meaningfulTerms, noAnswerText } from './docAssistant'

describe('what actually gets searched', () => {
  it('drops question-shaped filler and keeps the subject', () => {
    expect(meaningfulTerms('What evidence is required for a search warrant?'))
      .toEqual(['evidence', 'required', 'search', 'warrant'])
  })

  it('keeps the words that carry the question', () => {
    expect(meaningfulTerms('Who approves an SIU legal request?'))
      .toEqual(['approves', 'siu', 'legal', 'request'])
  })

  it('de-duplicates so one repeated word does not dominate the ranking', () => {
    expect(meaningfulTerms('evidence evidence evidence handling')).toEqual(['evidence', 'handling'])
  })

  it('ignores punctuation but keeps hyphenated terms intact', () => {
    expect(meaningfulTerms('chain-of-custody, properly?')).toEqual(['chain-of-custody', 'properly'])
  })

  it('has nothing to search when the question is all filler', () => {
    // Better to say so than to run a query matching every document in the
    // library and present the result as an answer.
    expect(meaningfulTerms('what is it')).toEqual([])
    expect(meaningfulTerms('')).toEqual([])
  })

  it('caps the term list so one rambling question cannot become a wildcard', () => {
    const many = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda'
    expect(meaningfulTerms(many)).toHaveLength(8)
  })
})

describe('saying nothing was found', () => {
  it('names what it searched for rather than shrugging', () => {
    const text = noAnswerText(['warrant', 'affidavit'])
    expect(text).toContain('"warrant"')
    expect(text).toContain('"affidavit"')
  })

  it('does not let "not in the library" be read as "no such rule"', () => {
    // The distinction the brief cares about most: absence of a document is not
    // evidence that the rule does not exist.
    expect(noAnswerText(['warrant'])).toContain('not the same as "no such rule exists"')
  })

  it('asks for something searchable when the question had no terms', () => {
    expect(noAnswerText([])).toContain('a few specific words')
  })
})
