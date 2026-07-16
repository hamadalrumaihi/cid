/** Pins for the pure document-governance model — collection mapping, review
 *  due/expiry boundaries, acknowledgement state (incl. re-ack after material
 *  updates), filters per view, sorting, metrics, and the client authority
 *  mirrors (UX only — v131 pins the server side live). */
import { describe, expect, it } from 'vitest'
import {
  ackState, applyDocFilters, buildLibraryMetrics, canApproveDoc, canEditDoc,
  docCategory, docTitle, isExpired, isRecentlyUpdated, reviewState, sortDocs,
  type DocViewer, type ShelfDoc,
} from './docModel'

const NOW = Date.parse('2026-08-01T12:00:00Z')
const DAY = 86_400_000

const doc = (over: Partial<ShelfDoc> & { id: string }): ShelfDoc => ({
  folder: 'SOPs', name: 'Doc', kind: 'doc', category: 'sops', document_type: 'sop',
  status: 'published', classification: 'internal', owner_user_id: null,
  mandatory: false, acknowledgement_required: false, acknowledgement_deadline: null,
  approval_required: false, approved_by: null, effective_at: null,
  reviewed_at: null, review_due_at: null, expires_at: null,
  source_system: 'portal', canonical_source: 'portal', sync_status: null,
  last_synced_at: null, current_version_number: 1, excerpt: null,
  updated_at: new Date(NOW - 30 * DAY).toISOString(),
  created_at: new Date(NOW - 60 * DAY).toISOString(),
  modified_label: null, tags: [], ...over,
})

const viewer = (over: Partial<DocViewer> = {}): DocViewer => ({
  userId: 'me', active: true, role: 'detective', isCommand: false, isOwner: false,
  justiceRole: null, ...over,
})

describe('titles and collections', () => {
  it('strips legacy import extensions', () => {
    expect(docTitle('Use of Force.docx')).toBe('Use of Force')
    expect(docTitle('Roster.sheet')).toBe('Roster')
    expect(docTitle('Plain name')).toBe('Plain name')
  })
  it('maps legacy folders when category is missing (mirrors the backfill)', () => {
    expect(docCategory({ category: null, folder: 'SOPs' })).toBe('sops')
    expect(docCategory({ category: null, folder: 'Forms' })).toBe('sops')
    expect(docCategory({ category: null, folder: 'Personnel' })).toBe('command')
    expect(docCategory({ category: null, folder: 'Gang Intel' })).toBe('investigative')
    expect(docCategory({ category: 'justice', folder: 'SOPs' })).toBe('justice')
  })
})

describe('review / expiry boundaries', () => {
  it('overdue at/after due; due_soon within 14 days; null otherwise', () => {
    expect(reviewState(doc({ id: 'a', review_due_at: new Date(NOW - 1).toISOString() }), NOW)).toBe('overdue')
    expect(reviewState(doc({ id: 'b', review_due_at: new Date(NOW + 13 * DAY).toISOString() }), NOW)).toBe('due_soon')
    expect(reviewState(doc({ id: 'c', review_due_at: new Date(NOW + 15 * DAY).toISOString() }), NOW)).toBeNull()
    expect(reviewState(doc({ id: 'd' }), NOW)).toBeNull()
  })
  it('archived/superseded documents never flag review or expiry', () => {
    expect(reviewState(doc({ id: 'a', status: 'archived', review_due_at: new Date(NOW - DAY).toISOString() }), NOW)).toBeNull()
    expect(isExpired(doc({ id: 'b', status: 'superseded', expires_at: new Date(NOW - DAY).toISOString() }), NOW)).toBe(false)
  })
  it('expiry is inclusive of the moment; recency window defaults to 7 days', () => {
    expect(isExpired(doc({ id: 'a', expires_at: new Date(NOW).toISOString() }), NOW)).toBe(true)
    expect(isRecentlyUpdated(doc({ id: 'b', updated_at: new Date(NOW - 6 * DAY).toISOString() }), NOW)).toBe(true)
    expect(isRecentlyUpdated(doc({ id: 'c', updated_at: new Date(NOW - 8 * DAY).toISOString() }), NOW)).toBe(false)
  })
})

describe('acknowledgement state', () => {
  const ackDoc = doc({ id: 'd1', acknowledgement_required: true, current_version_number: 3 })
  it('not required / pending / acknowledged / re-ack after a material bump', () => {
    expect(ackState(doc({ id: 'x' }), {})).toBe('not_required')
    expect(ackState(ackDoc, {})).toBe('pending')
    expect(ackState(ackDoc, { d1: [3] })).toBe('acknowledged')
    expect(ackState(ackDoc, { d1: [2] })).toBe('reack_needed')
  })
})

describe('filters per view', () => {
  const rows = [
    doc({ id: 'pub' }),
    doc({ id: 'req', acknowledgement_required: true }),
    doc({ id: 'check', document_type: 'checklist' }),
    doc({ id: 'tmpl', document_type: 'template' }),
    doc({ id: 'arch', status: 'archived' }),
    doc({ id: 'sup', status: 'superseded' }),
    doc({ id: 'fresh', updated_at: new Date(NOW - DAY).toISOString() }),
    doc({ id: 'conf', source_system: 'google_drive', sync_status: 'conflict' }),
  ]
  it('default library view hides archived + superseded', () => {
    const out = applyDocFilters(rows, {}, {}, new Set(), 'library', NOW).map((d) => d.id)
    expect(out).not.toContain('arch')
    expect(out).not.toContain('sup')
    expect(out).toContain('pub')
  })
  it('views narrow correctly (required / checklists / templates / bookmarks / recent)', () => {
    expect(applyDocFilters(rows, {}, {}, new Set(), 'required', NOW).map((d) => d.id)).toEqual(['req'])
    expect(applyDocFilters(rows, {}, {}, new Set(), 'checklists', NOW).map((d) => d.id)).toEqual(['check'])
    expect(applyDocFilters(rows, {}, {}, new Set(), 'templates', NOW).map((d) => d.id)).toEqual(['tmpl'])
    expect(applyDocFilters(rows, {}, {}, new Set(['conf']), 'bookmarks', NOW).map((d) => d.id)).toEqual(['conf'])
    expect(applyDocFilters(rows, {}, {}, new Set(), 'recent', NOW).map((d) => d.id)).toEqual(['fresh'])
  })
  it('unacked + syncWarning + archived filters', () => {
    expect(applyDocFilters(rows, { unacked: true }, {}, new Set(), 'library', NOW).map((d) => d.id)).toEqual(['req'])
    expect(applyDocFilters(rows, { syncWarning: true }, {}, new Set(), 'library', NOW).map((d) => d.id)).toEqual(['conf'])
    expect(applyDocFilters(rows, { archived: true }, {}, new Set(), 'library', NOW).map((d) => d.id)).toEqual(['arch'])
  })
})

describe('sorting', () => {
  it('review_due sorts missing dates last; title is alphabetical', () => {
    const rows = [
      doc({ id: 'none', name: 'Zed' }),
      doc({ id: 'soon', name: 'Alpha', review_due_at: new Date(NOW + DAY).toISOString() }),
      doc({ id: 'later', name: 'Mid', review_due_at: new Date(NOW + 5 * DAY).toISOString() }),
    ]
    expect(sortDocs(rows, 'review_due').map((d) => d.id)).toEqual(['soon', 'later', 'none'])
    expect(sortDocs(rows, 'title').map((d) => d.name)).toEqual(['Alpha', 'Mid', 'Zed'])
  })
})

describe('metrics', () => {
  it('counts published/required/awaiting/reviewDue/recent/syncWarnings', () => {
    const rows = [
      doc({ id: 'a' }),
      doc({ id: 'b', acknowledgement_required: true }),
      doc({ id: 'c', review_due_at: new Date(NOW - DAY).toISOString() }),
      doc({ id: 'd', updated_at: new Date(NOW - DAY).toISOString() }),
      doc({ id: 'e', sync_status: 'portal_newer' }),
      doc({ id: 'f', status: 'draft' }),
    ]
    const m = buildLibraryMetrics(rows, { b: [] }, NOW)
    expect(m).toEqual({ published: 5, required: 1, awaitingAck: 1, reviewDue: 1, recent: 1, syncWarnings: 1 })
  })
})

describe('client authority mirrors (UX only)', () => {
  it('edit: locked folder needs command/owner/doc-owner; open internal folder stays member-writable', () => {
    expect(canEditDoc(viewer(), doc({ id: 'a', folder: 'SOPs' }))).toBe(false)
    expect(canEditDoc(viewer({ isCommand: true }), doc({ id: 'a', folder: 'SOPs' }))).toBe(true)
    expect(canEditDoc(viewer({ userId: 'me' }), doc({ id: 'a', folder: 'SOPs', owner_user_id: 'me' }))).toBe(true)
    expect(canEditDoc(viewer(), doc({ id: 'b', folder: 'State Bureau Cases' }))).toBe(true)
  })
  it('justice docs are DA/AG/owner territory; owner docs are owner-only', () => {
    const j = doc({ id: 'j', classification: 'justice' })
    expect(canEditDoc(viewer({ isCommand: true }), j)).toBe(false)
    expect(canEditDoc(viewer({ justiceRole: 'attorney_general' }), j)).toBe(true)
    expect(canApproveDoc(viewer({ isCommand: true }), j)).toBe(false)
    expect(canApproveDoc(viewer({ justiceRole: 'district_attorney' }), j)).toBe(true)
    const o = doc({ id: 'o', classification: 'owner' })
    expect(canEditDoc(viewer({ isCommand: true }), o)).toBe(false)
    expect(canEditDoc(viewer({ isOwner: true }), o)).toBe(true)
  })
  it('approval: sops category = command+; other categories need deputy_director+', () => {
    expect(canApproveDoc(viewer({ isCommand: true }), doc({ id: 'a', category: 'sops' }))).toBe(true)
    expect(canApproveDoc(viewer({ isCommand: true, role: 'bureau_lead' }), doc({ id: 'b', category: 'technical' }))).toBe(false)
    expect(canApproveDoc(viewer({ isCommand: true, role: 'deputy_director' }), doc({ id: 'b', category: 'technical' }))).toBe(true)
  })
})
