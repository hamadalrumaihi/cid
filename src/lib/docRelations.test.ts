/** Unit tests for document relations.
 *
 *  The access rules are the database's — doc_rel_ins and doc_rel_del admit only
 *  somebody who may edit the OWNING document, and doc_rel_sel makes a relation
 *  readable only through that document. Those were probed live and are recorded
 *  in the delivery notes.
 *
 *  What is pinned here is the derivation the portal acts on: which links point
 *  at guidance that is no longer in force. That is the quiet failure worth
 *  catching — a workflow that still reads fine while citing a document nobody
 *  maintains.
 */

import { describe, expect, it } from 'vitest'
import {
  RELATIONS, relationLabel, routeLabel, staleTargets, type RelationRow,
} from './docRelations'

const rel = (over: Partial<RelationRow> = {}): RelationRow => ({
  id: 'r1', document_id: 'doc-a', relation: 'policy_for',
  target_kind: 'document', target_document_id: 'doc-b', target_id: null,
  target_route: null, label: null,
  created_by: 'u1', created_at: '2026-08-01T00:00:00Z',
  ...over,
})

describe('links to guidance that is no longer in force', () => {
  it('flags a link to an archived document', () => {
    const out = staleTargets([rel()], { 'doc-b': 'archived' })
    expect(out).toHaveLength(1)
    expect(out[0].targetStatus).toBe('archived')
  })

  it('flags a link to a superseded document', () => {
    // Superseded is the more dangerous of the two: the document still reads
    // like policy, it has simply been replaced by a newer version.
    expect(staleTargets([rel()], { 'doc-b': 'superseded' })).toHaveLength(1)
  })

  it('says nothing about a link to a published document', () => {
    expect(staleTargets([rel()], { 'doc-b': 'published' })).toEqual([])
  })

  it('ignores route links, which have no document status to go stale', () => {
    const routeRel = rel({ target_kind: 'route', target_document_id: null, target_route: 'evidence' })
    expect(staleTargets([routeRel], {})).toEqual([])
  })

  it('stays quiet when the target is not in the caller’s visible set', () => {
    // The status map is built from documents THIS viewer can read. A target
    // they cannot see is unknown, not stale — guessing would leak the fact that
    // the document exists.
    expect(staleTargets([rel()], {})).toEqual([])
  })
})

describe('vocabulary', () => {
  it('offers only relations the database will accept', () => {
    // Mirrors document_relations_relation_check. A value outside this list is
    // rejected on write, so offering one would be a button that always fails.
    expect([...RELATIONS]).toEqual([
      'policy_for', 'required_for', 'checklist_for', 'applies_to',
      'supersedes', 'see_also', 'related',
    ])
  })

  it('reads a relation as a phrase rather than a column value', () => {
    expect(relationLabel('policy_for')).toBe('Policy for')
    expect(relationLabel('required_for')).toBe('Required for')
    // An unknown value still reads as something, rather than vanishing.
    expect(relationLabel('invented_thing')).toBe('Invented thing')
  })

  it('names a route the way the portal names it', () => {
    expect(routeLabel('legal')).toBe('Legal requests')
    expect(routeLabel('field')).toBe('Intelligence')
    expect(routeLabel(null)).toBe('somewhere in the portal')
  })
})
