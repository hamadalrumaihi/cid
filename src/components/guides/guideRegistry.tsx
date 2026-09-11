'use client'

/** body_key → the guide's written content.
 *
 *  The library row in public.guides says a guide EXISTS, what it is called and
 *  whether it is published; this registry says what it SAYS. Guide prose is
 *  code-reviewed — it changes through a pull request, with the diff visible —
 *  so it lives in the repository rather than in a database column, and
 *  guides.body_key is the join between the two.
 *
 *  Adding a guide is: a body module exporting its sections, its search and its
 *  body component; one entry here; and one row in the library. No new route,
 *  no new chrome, no new plumbing. */
import type { DocHeading } from '@/lib/markdown'
import { LAST_UPDATED, REFERENCE_NOTE, SECTIONS, matchSections } from '@/components/undergrnd/undergrndContent'
import { UndergrndBody } from '@/components/undergrnd/UndergrndBody'
import type { GuideImageRef } from './GuideParts'

/** What the shared page hands every guide body. The body renders its sections
 *  and nothing else — the masthead, search, contents and bookmark are the
 *  page's. */
export interface GuideBodyProps {
  /** Section ids the in-guide search currently matches. */
  shown: ReadonlySet<string>
  /** The images an editor attached to one section — empty for most sections,
   *  and an empty list renders nothing at all. */
  imagesFor: (section: string) => GuideImageRef[]
}

export interface GuideBody {
  /** The anchor sections, in document order. These are ANCHORS, not tabs: a
   *  guide is one continuous document with a contents rail beside it. */
  sections: DocHeading[]
  /** In-guide search: which sections match this query. A blank query matches
   *  every section. */
  matchSections: (query: string) => Set<string>
  /** ISO date the written content was last revised — a fact about the prose,
   *  not about the library row. */
  lastUpdated: string
  /** The one-line statement that the document is not live. */
  note?: string
  Body: React.ComponentType<GuideBodyProps>
}

export const GUIDE_BODIES: Record<string, GuideBody> = {
  undergrnd: {
    sections: SECTIONS,
    matchSections,
    lastUpdated: LAST_UPDATED,
    note: REFERENCE_NOTE,
    Body: UndergrndBody,
  },
}

/** The body for a library row, or null when the row names one the build does
 *  not carry (a guide registered ahead of its content, or a content module
 *  removed). The page then says so plainly rather than rendering a blank. */
export const guideBody = (bodyKey: string | null | undefined): GuideBody | null =>
  (bodyKey && GUIDE_BODIES[bodyKey]) || null
