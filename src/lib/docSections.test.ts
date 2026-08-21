/** Unit tests for the section index.
 *
 *  The security property — that a caller cannot forge section text — lives in
 *  the database and was probed live: a genuine heading indexed 39,477
 *  characters of real document text while a forged one indexed an empty
 *  section. That result is recorded in 20260927120000_document_sections.sql.
 *
 *  What is pinned here is the thing the client is actually responsible for:
 *  that the anchors submitted for indexing are byte-for-byte the anchors the
 *  reader renders. If those two ever diverge, every deep link from search
 *  points at a heading that is not there — and it would fail silently, which is
 *  the worst way for a link to break.
 */

import { describe, expect, it } from 'vitest'
import { renderDocumentMarkdown } from './markdown'
import { citation, documentHeadings, highlightRuns, sectionHref, type SectionHit } from './docSections'

/* Shapes drawn from the real library: markdown headings, a document with none
 * at all (six of the fifteen are like this), and repeated headings that force
 * the de-duplication counter to do its work. */
const MARKDOWN = `# Purpose

This SOP governs evidence handling.

## Required Steps

Do the thing.

### Notes

More.`

const NO_HASH_HEADINGS = `EVIDENCE HANDLING

Officers must log every item.

Chain of custody:

Sign the form.`

const REPEATED = `## Scope

One.

## Scope

Two.

## Scope

Three.`

describe('anchors match what the reader renders', () => {
  for (const [label, body] of Object.entries({ MARKDOWN, NO_HASH_HEADINGS, REPEATED })) {
    it(`agrees with renderDocumentMarkdown for ${label}`, () => {
      const rendered = renderDocumentMarkdown(body).headings
      const submitted = documentHeadings(body)
      expect(submitted.map((h) => h.anchor)).toEqual(rendered.map((h) => h.id))
      expect(submitted.map((h) => h.heading)).toEqual(rendered.map((h) => h.text))
      expect(submitted.map((h) => h.depth)).toEqual(rendered.map((h) => h.level))
    })
  }

  it('finds structure in a document with no markdown headings at all', () => {
    // The reason the index is not built in SQL: a '#'-only parser would leave
    // this document — and five more like it, including the 15,891-character
    // CID SOP — with no sections and therefore unreachable by section search.
    expect(documentHeadings(NO_HASH_HEADINGS).length).toBeGreaterThan(0)
  })

  it('de-duplicates repeated headings so anchors stay unique', () => {
    const anchors = documentHeadings(REPEATED).map((h) => h.anchor)
    expect(new Set(anchors).size).toBe(anchors.length)
  })

  it('has nothing to submit for an empty document', () => {
    expect(documentHeadings('')).toEqual([])
    expect(documentHeadings(null)).toEqual([])
  })
})

describe('presenting a hit', () => {
  const hit = (over: Partial<SectionHit> = {}): SectionHit => ({
    document_id: 'd1', document_name: 'CID Standard Operating Procedure',
    category: 'sops', document_type: 'sop', status: 'published',
    classification: 'internal', version_number: 3,
    effective_at: '2026-02-01T00:00:00Z', anchor: 'required-steps',
    heading: 'Required Steps', ordinal: 2, rank: 0.8,
    headline: 'log every [[item]] into evidence', ...over,
  })

  it('cites the document, the section, the version and the date', () => {
    // A quotation with no version and no date is not a citation somebody can
    // check, which is the entire point of the exercise.
    expect(citation(hit())).toBe(
      'CID Standard Operating Procedure — Required Steps (v3, 2026-02-01)')
  })

  it('says so plainly when a document carries no effective date', () => {
    expect(citation(hit({ effective_at: null }))).toContain('no effective date recorded')
  })

  it('links to the section, not the top of the document', () => {
    expect(sectionHref(hit())).toBe('/sops?doc=d1#required-steps')
  })

  it('splits the server excerpt into plain and matched runs', () => {
    // ts_headline marks matches with [[…]] so the server never emits markup.
    expect(highlightRuns('log every [[item]] into evidence'))
      .toEqual(['log every ', 'item', ' into evidence'])
    expect(highlightRuns(null)).toEqual([''])
  })
})
