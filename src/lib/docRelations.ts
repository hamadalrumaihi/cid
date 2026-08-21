/** Document relations — the client model for `document_relations`.
 *
 *  ── Why this file exists ──────────────────────────────────────────────────
 *  The table, its RLS and the reader's "Related" panel have all been in place
 *  since document governance shipped. The table has zero rows, and the reason
 *  turned out to be simple: nothing in the portal could ever CREATE one. The
 *  feature was built read-only, so every downstream promise resting on it —
 *  related documents, "used in this workflow", conflict detection between
 *  documents — has been resting on an empty table.
 *
 *  ── Two kinds of target ───────────────────────────────────────────────────
 *  A relation points either at another DOCUMENT (this policy supersedes that
 *  one) or at a ROUTE — a place in the portal where the document actually
 *  applies. The route form is what makes contextual help possible: the evidence
 *  screen does not need to know which policy governs it, it asks which
 *  documents have declared themselves policy_for that route. Documents claim
 *  their own relevance; screens do not maintain a list.
 *
 *  Writes are governed by doc_rel_ins/doc_rel_del, which admit only somebody
 *  who may edit the OWNING document. Reads follow the owning document's own
 *  visibility, so a relation can never reveal a document you could not open.
 */

import { insert, list, remove } from './db'
import type { Tables } from './database.types'

export type RelationRow = Tables<'document_relations'>

/** The stored vocabulary (document_relations_relation_check). */
export const RELATIONS = [
  'policy_for', 'required_for', 'checklist_for', 'applies_to',
  'supersedes', 'see_also', 'related',
] as const
export type Relation = (typeof RELATIONS)[number]

export const RELATION_LABEL: Record<Relation, string> = {
  policy_for: 'Policy for',
  required_for: 'Required for',
  checklist_for: 'Checklist for',
  applies_to: 'Applies to',
  supersedes: 'Supersedes',
  see_also: 'See also',
  related: 'Related to',
}

/** What each relation is actually claiming, so an author picks the right one
 *  rather than the first one. */
export const RELATION_MEANING: Record<Relation, string> = {
  policy_for: 'This document is the governing policy for that work.',
  required_for: 'That work cannot be completed without this document.',
  checklist_for: 'This is the checklist somebody follows while doing that work.',
  applies_to: 'This document has something to say about that, without governing it.',
  supersedes: 'This document replaces that one. The old one should be archived.',
  see_also: 'Worth reading alongside, no dependency either way.',
  related: 'Connected, but none of the above.',
}

/** Portal places a document can declare itself relevant to. Deliberately a
 *  fixed list rather than free text: a typo in a route is a relation that
 *  silently never shows up anywhere. */
export const DOC_ROUTES = [
  { route: 'cases', label: 'Cases' },
  { route: 'evidence', label: 'Evidence' },
  { route: 'field', label: 'Intelligence' },
  { route: 'legal', label: 'Legal requests' },
  { route: 'siu', label: 'SIU' },
  { route: 'penal', label: 'Penal Code' },
  { route: 'personnel', label: 'Personnel' },
  { route: 'records', label: 'Records' },
  { route: 'operations', label: 'Operations' },
  { route: 'media', label: 'Media vault' },
] as const

export const routeLabel = (route: string | null): string =>
  DOC_ROUTES.find((r) => r.route === route)?.label ?? route ?? 'somewhere in the portal'

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function loadRelations(documentId: string): Promise<RelationRow[]> {
  return list('document_relations', { eq: { document_id: documentId } }).catch(() => [])
}

/** Every document that has declared itself relevant to a portal route.
 *
 *  RLS-bounded by construction: a relation is readable only through its owning
 *  document, so a screen showing contextual help can never surface a document
 *  the viewer could not open directly. */
export async function documentsForRoute(route: string): Promise<RelationRow[]> {
  return list('document_relations', {
    eq: { target_kind: 'route', target_route: route },
  }).catch(() => [])
}

// ---------------------------------------------------------------------------
// Writes — governed by doc_rel_ins / doc_rel_del
// ---------------------------------------------------------------------------

export async function linkDocument(
  documentId: string, relation: Relation, targetDocumentId: string, label?: string,
): Promise<string | null> {
  const res = await insert('document_relations', {
    document_id: documentId,
    relation,
    target_kind: 'document',
    target_document_id: targetDocumentId,
    label: label?.trim() || null,
  })
  return res.error?.message ?? null
}

export async function linkRoute(
  documentId: string, relation: Relation, route: string, label?: string,
): Promise<string | null> {
  const res = await insert('document_relations', {
    document_id: documentId,
    relation,
    target_kind: 'route',
    target_route: route,
    label: label?.trim() || routeLabel(route),
  })
  return res.error?.message ?? null
}

/** Removing a relation is not removing history — a relation is a statement
 *  about what is true now, and a wrong one should simply go. The documents on
 *  either side, and their version history, are untouched. */
export async function unlinkRelation(id: string): Promise<string | null> {
  const res = await remove('document_relations', id)
  return res.error?.message ?? null
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/** A relation pointing at a document that has since been archived or
 *  superseded is the quiet failure the brief is most worried about: a workflow
 *  still citing guidance nobody maintains. Reported as a warning for a human,
 *  never an automatic edit. */
export function staleTargets(
  relations: RelationRow[], statusById: Record<string, string | undefined>,
): { relation: RelationRow; targetStatus: string }[] {
  return relations.flatMap((r) => {
    const id = r.target_document_id
    if (!id) return []
    const status = statusById[id]
    if (status === 'archived' || status === 'superseded') {
      return [{ relation: r, targetStatus: status }]
    }
    return []
  })
}

export function relationLabel(r: string): string {
  return RELATION_LABEL[r as Relation]
    ?? (r.charAt(0).toUpperCase() + r.slice(1)).replace(/_/g, ' ')
}
