/** Ask the library — retrieval, not generation.
 *
 *  ── Why there is no model here ────────────────────────────────────────────
 *  The portal has no AI infrastructure: no server-side model, no embeddings, no
 *  vector store. The one thing calling itself an assistant is an Owner-only
 *  page-agent that ships inert and, when configured, sends whatever is on
 *  screen to an external LLM — which is precisely what the brief rules out for
 *  document content.
 *
 *  So this answers by RETRIEVAL. It returns the actual sections of the actual
 *  documents, quoted from the database, cited and version-stamped. It cannot
 *  invent a legal requirement because it never writes a sentence, and no
 *  document text leaves the database because nothing is sent anywhere. The
 *  honest limit: it answers "where is this written", not "what does this mean".
 *
 *  ── Confirmed versus possible ─────────────────────────────────────────────
 *  Two passes over the same RLS-bounded search:
 *
 *   • DIRECT — every meaningful word in the question appears in one section.
 *     That is a section genuinely about what was asked.
 *   • POSSIBLE — any of the words appear. Worth reading, and clearly not the
 *     same claim.
 *
 *  Keeping them apart is the difference between a reference tool and one that
 *  sounds equally confident whether or not it found anything. When neither pass
 *  returns a section, the answer is that no confirmed answer was found — never
 *  a plausible paragraph assembled to fill the space.
 *
 *  Access is the database's: search_document_sections is SECURITY INVOKER over
 *  a table whose visibility is the owning document's, so the assistant can
 *  never reach a document the asker could not open by hand.
 */

import { searchSections, type SectionHit } from './docSections'

/** Words too common to narrow anything. Kept small on purpose: Postgres already
 *  drops English stopwords when it builds the tsquery, and this list exists
 *  only to stop the LOOSE pass from matching on question-shaped filler. */
const FILLER = new Set([
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did',
  'a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with',
  'and', 'or', 'not', 'can', 'could', 'should', 'would', 'may', 'might',
  'i', 'we', 'you', 'they', 'it', 'this', 'that', 'these', 'those',
  'me', 'my', 'our', 'need', 'needs', 'want', 'get', 'got', 'about',
])

/** The words worth searching on, in the order they were asked. */
export function meaningfulTerms(question: string): string[] {
  return [...new Set(
    question
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !FILLER.has(w)),
  )].slice(0, 8)
}

export interface LibraryAnswer {
  /** Sections where every meaningful word appears — about what was asked. */
  direct: SectionHit[]
  /** Sections mentioning some of it. Worth reading, a weaker claim. */
  possible: SectionHit[]
  /** False when nothing was found, which is a real answer and says so. */
  answered: boolean
  /** The words actually searched on, so the asker can see why they got this. */
  terms: string[]
}

export const NO_ANSWER: LibraryAnswer =
  { direct: [], possible: [], answered: false, terms: [] }

export async function askLibrary(question: string): Promise<LibraryAnswer> {
  const terms = meaningfulTerms(question)
  if (!terms.length) return NO_ANSWER

  // websearch_to_tsquery ANDs bare words and understands a literal "or", so
  // both passes go through the same RLS-bounded RPC and no second search
  // function is needed.
  const [direct, loose] = await Promise.all([
    searchSections(terms.join(' '), 10),
    terms.length > 1 ? searchSections(terms.join(' or '), 24) : Promise.resolve([]),
  ])

  const seen = new Set(direct.map(key))
  const possible = loose.filter((h) => !seen.has(key(h))).slice(0, 8)
  return {
    direct,
    possible,
    answered: direct.length > 0 || possible.length > 0,
    terms,
  }
}

const key = (h: SectionHit): string => `${h.document_id}#${h.anchor}`

/** What to tell somebody when nothing came back. Deliberately does not suggest
 *  the answer might exist elsewhere in some form -- it says what was searched
 *  and that the library does not contain it. */
export function noAnswerText(terms: string[]): string {
  if (!terms.length) {
    return 'Ask a question with a few specific words in it — a topic, a form, a rule.'
  }
  return `No document you can open contains ${terms.map((t) => `"${t}"`).join(', ')}. `
    + 'That is not the same as "no such rule exists" — it means the library does '
    + 'not record one, and somebody would have to write it.'
}
