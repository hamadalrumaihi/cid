'use client'

/** body_key → the guide's written content.
 *
 *  The library row in public.guides says a guide EXISTS, what it is called,
 *  which audience may read it and whether it is published; this registry says
 *  what it SAYS. Guide prose is code-reviewed — it changes through a pull
 *  request, with the diff visible — so it lives in the repository rather than
 *  in a database column, and guides.body_key is the join between the two.
 *
 *  A guide registered with `body_kind = 'sections'` has no entry here at all:
 *  its prose was written in the editor and lives in public.guide_sections. The
 *  page renders both through the same shell, and a reader cannot tell which is
 *  which — nor should they have to.
 *
 *  Adding a repository guide is: a doc module, one entry here, one row in the
 *  library, and its sections in the search-index seed. `npm run check:guides`
 *  fails if those last two disagree, so a section can never become silently
 *  unfindable. */
import type { DocHeading } from '@/lib/markdown'
import { LAST_UPDATED as UNDERGRND_UPDATED, REFERENCE_NOTE, SECTIONS as UNDERGRND_SECTIONS, matchSections as matchUndergrnd } from '@/components/undergrnd/undergrndContent'
import { UndergrndBody } from '@/components/undergrnd/UndergrndBody'
import { USER_GUIDE_DOC } from './docs/userGuideDoc'
import { CASE_MANAGEMENT_DOC } from './docs/caseManagementDoc'
import { REPORTS_EVIDENCE_DOC } from './docs/reportsEvidenceDoc'
import { LEGAL_REQUESTS_DOC } from './docs/legalRequestsDoc'
import { ACTION_CENTER_DOC } from './docs/actionCenterDoc'
import { ENTITIES_DOC } from './docs/entitiesDoc'
import { docHeadings, matchDocSections, readMinutes, searchDocSections, type DocSectionHit, type GuideDoc } from './guideDoc'
import type { GuideImageRef } from './GuideParts'

/** What the shared page hands a guide body that renders itself. */
export interface GuideBodyProps {
  shown: ReadonlySet<string>
  imagesFor: (section: string) => GuideImageRef[]
}

export interface GuideBody {
  /** The anchor sections, in document order. ANCHORS, not tabs: the document
   *  is continuous and the contents rail scrolls to a heading. */
  sections: DocHeading[]
  matchSections: (query: string) => Set<string>
  /** The sections a library-wide search matches, with a snippet each. A guide
   *  in the build is searched from the build; a guide written in the editor is
   *  searched by the server. Both end up in the same result list. */
  searchSections: (query: string) => DocSectionHit[]
  /** ISO date the prose was last revised — a fact about the text, not about
   *  the library row. */
  lastUpdated: string
  /** The one-line statement that the document is not live, where one applies. */
  note?: string
  /** Reading estimate, in minutes. */
  readMinutes: number
  /** Data-driven guides hand the page their document, so it can render the
   *  copy-link control and the in-guide links itself. */
  doc?: GuideDoc
  /** A guide that renders itself (UNDERGRND's tables and cards are specific
   *  to it and would not survive being flattened into blocks). */
  Body?: React.ComponentType<GuideBodyProps>
}

/** One registry entry for a data-driven guide. */
function fromDoc(doc: GuideDoc, lastUpdated: string): GuideBody {
  return {
    sections: docHeadings(doc),
    matchSections: (q) => matchDocSections(doc, q),
    searchSections: (q) => searchDocSections(doc, q),
    lastUpdated,
    readMinutes: readMinutes(doc),
    doc,
  }
}

/** When each guide's prose was last revised. One date per guide, edited with
 *  the prose it describes — the library row's `updated_at` is about the row. */
const REVISED = '2026-09-11T00:00:00'

export const GUIDE_BODIES: Record<string, GuideBody> = {
  'user-guide': fromDoc(USER_GUIDE_DOC, REVISED),
  'case-management': fromDoc(CASE_MANAGEMENT_DOC, REVISED),
  'reports-evidence': fromDoc(REPORTS_EVIDENCE_DOC, REVISED),
  'legal-requests': fromDoc(LEGAL_REQUESTS_DOC, REVISED),
  'action-center': fromDoc(ACTION_CENTER_DOC, REVISED),
  'entities-organizations': fromDoc(ENTITIES_DOC, REVISED),
  undergrnd: {
    sections: UNDERGRND_SECTIONS,
    matchSections: matchUndergrnd,
    // Transcribed figures rather than prose: the heading is the only useful
    // thing to show beside a hit, so there is no snippet to take.
    searchSections: (q) => {
      const hit = q.trim() ? matchUndergrnd(q) : new Set<string>()
      return UNDERGRND_SECTIONS.filter((s) => hit.has(s.id))
        .map((s) => ({ anchor: s.id, heading: s.text, snippet: '' }))
    },
    lastUpdated: UNDERGRND_UPDATED,
    note: REFERENCE_NOTE,
    // Transcribed tables, progress bars and recorded-value cards: this one
    // renders itself rather than flattening into generic blocks.
    readMinutes: 8,
    Body: UndergrndBody,
  },
}

/** The body for a library row, or null when the row names one the build does
 *  not carry — a guide registered ahead of its content, or a guide written in
 *  the editor (whose prose comes from the database instead). */
export const guideBody = (bodyKey: string | null | undefined): GuideBody | null =>
  (bodyKey && GUIDE_BODIES[bodyKey]) || null
