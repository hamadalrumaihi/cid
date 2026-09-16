import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { GuideRow } from '@/lib/guides'
import { GuideCard } from './GuideCard'
import { DocumentHeader } from './DocumentHeader'
import { DocCallout, ClassificationStrip } from './DocCallout'
import { RelatedDocuments } from './RelatedDocuments'
import { ActiveFilterChips, LibraryFilters, type FilterGroup } from './LibraryFilters'

/** The redesigned library surfaces, provider-free.
 *
 *  These exist so the responsive and colour work can be LOOKED AT — at 390px,
 *  at 768px and on a wide screen — without a signed-in portal. Nothing here
 *  touches Supabase, AuthContext or the router beyond the Storybook stub, so
 *  what renders is exactly what a reader sees, minus the data. */
const doc = (over: Partial<GuideRow> = {}): GuideRow => ({
  id: 'g1',
  slug: 'cid-undercover-operations-procedure',
  title: 'CID Undercover Operations Procedure',
  summary: 'Authorization, cover identity handling, contact discipline, recordings and after-action reporting for undercover assignments.',
  category: 'undercover',
  status: 'published',
  doc_type: 'procedure',
  issuing_authority: 'Director Jack Crow',
  effective_date: '2026-09-01',
  version_label: '1.0',
  change_summary: null,
  superseded_by: null,
  related_policy: null,
  acknowledgement_required: true,
  acknowledgement_deadline: null,
  migrated_document_id: null,
  body_key: 'uc-procedure',
  pinned: false,
  audience: 'investigative',
  custom_roles: [],
  tags: [],
  keywords: null,
  body_kind: 'module',
  read_minutes: 14,
  view_count: 0,
  content_owner: null,
  last_reviewed_at: null,
  next_review_at: null,
  archived_at: null,
  archived_by: null,
  publication_note: null,
  outdated_at: null,
  outdated_by: null,
  outdated_reason: null,
  published_at: '2026-09-01T00:00:00.000Z',
  created_by: null,
  updated_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-12T00:00:00.000Z',
  deleted_at: null,
  deleted_by: null,
  delete_reason: null,
  delete_batch: null,
  ...over,
})

const FORM = doc({
  id: 'g2',
  slug: 'uc-operation-activity-report',
  title: 'UC Operation Activity Report',
  summary: 'Filed after each undercover contact.',
  doc_type: 'form',
  version_label: '1',
  issuing_authority: null,
  read_minutes: 2,
})
const SOP = doc({
  id: 'g3',
  slug: 'cid-sop',
  title: 'Criminal Investigation Division (CID) Standard Operating Procedure',
  summary: 'The division’s standing rules.',
  doc_type: 'sop',
  category: 'general',
  audience: 'all',
  version_label: '2',
  issuing_authority: null,
  pinned: true,
  read_minutes: 41,
})
const SUPERSEDED = doc({
  id: 'g4',
  slug: 'cid-sop-v1',
  title: 'CID Standard Operating Procedure',
  summary: 'Replaced by version 2.',
  doc_type: 'sop',
  category: 'general',
  audience: 'all',
  status: 'superseded',
  version_label: '1',
  issuing_authority: null,
  read_minutes: 22,
})
const SIB = doc({
  id: 'g5',
  slug: 'sib-sop',
  title: 'Special Investigations Bureau SOP',
  summary: 'Compartmented. Distribution is limited to SIB standing.',
  doc_type: 'sop',
  category: 'sib',
  audience: 'sib',
  version_label: '1',
  issuing_authority: null,
  outdated_at: '2026-09-14T00:00:00.000Z',
  read_minutes: 16,
})

const meta = { title: 'Guides/Library' } satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const cardProps = (g: GuideRow) => ({
  guide: g,
  categoryLabel: g.category === 'undercover' ? 'Undercover'
    : g.category === 'sib' ? 'SIB' : 'General',
  readMinutes: g.read_minutes ?? 3,
  lastUpdatedText: '12 Sep 2026',
  onOpen: () => {},
  onToggleBookmark: () => {},
})

/** The grid, at whatever width the viewport is. Forms read as forms, the
 *  superseded SOP and the flagged one are amber, the SIB document is rose. */
export const Cards: Story = {
  render: () => (
    <div className="bg-canvas p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[doc(), FORM, SOP, SUPERSEDED, SIB].map((g) => (
          <GuideCard key={g.id} {...cardProps(g)} />
        ))}
      </div>
    </div>
  ),
}

/** One header, five documents. Restricted ones lead with the strip. */
export const Headers: Story = {
  render: () => (
    <div className="flex flex-col gap-10 bg-canvas p-4">
      <DocumentHeader row={doc()} categoryLabel="Undercover" readMinutes={14} />
      <DocumentHeader row={SOP} categoryLabel="General" readMinutes={41} />
      <DocumentHeader row={SIB} categoryLabel="SIB" readMinutes={16} />
    </div>
  ),
}

/** All six, plus the strip. Each says its kind as a word. */
export const Callouts: Story = {
  render: () => (
    <div className="flex flex-col gap-3 bg-canvas p-4">
      <ClassificationStrip
        text="CID Restricted — CID access only"
        detail="Do not distribute outside the authorized audience."
      />
      <DocCallout kind="info">Background a reader may want but does not have to act on.</DocCallout>
      <DocCallout kind="important">Something that changes what a detective must do.</DocCallout>
      <DocCallout kind="warning">A step that goes wrong quietly if it is skipped.</DocCallout>
      <DocCallout kind="restricted">Material that does not leave its audience.</DocCallout>
      <DocCallout kind="time">A deadline: the activity report is filed within 24 hours.</DocCallout>
      <DocCallout kind="command">An action reserved to command staff.</DocCallout>
    </div>
  ),
}

/** Three lanes, three different relationships. */
export const Related: Story = {
  render: () => (
    <div className="bg-canvas p-4">
      <RelatedDocuments governs={[FORM]} supersedes={[SUPERSEDED]} sameCategory={[SOP, SIB]} />
    </div>
  ),
}

/** The filter control, live. Open it: a popover at `sm+`, a bottom sheet
 *  below. This is the story to resize — the sheet is the piece that cannot be
 *  checked by reading the class list. */
export const Filters: Story = {
  render: function FiltersStory() {
    const [types, setTypes] = useState<ReadonlySet<string>>(new Set(['sop']))
    const [cats, setCats] = useState<ReadonlySet<string>>(new Set())
    const toggle = (
      set: ReadonlySet<string>, v: string, put: (s: Set<string>) => void,
    ) => {
      const next = new Set(set)
      if (next.has(v)) next.delete(v)
      else next.add(v)
      put(next)
    }
    const groups: FilterGroup[] = [
      {
        id: 'type',
        label: 'Document type',
        options: [
          { value: 'sop', label: 'SOP', count: 3 },
          { value: 'procedure', label: 'Procedure', count: 2 },
          { value: 'guide', label: 'Guide', count: 9 },
          { value: 'form', label: 'Form', count: 3 },
          { value: 'reference', label: 'Reference', count: 2 },
        ],
        selected: types,
        onToggle: (v) => toggle(types, v, setTypes),
      },
      {
        id: 'category',
        label: 'Category',
        options: [
          { value: 'reports-evidence', label: 'Reports and Evidence', count: 3 },
          { value: 'case-management', label: 'Case Management', count: 2 },
          { value: 'command-admin', label: 'Command and Administration', count: 2 },
          { value: 'general', label: 'General', count: 2 },
          { value: 'undercover', label: 'Undercover', count: 2 },
          { value: 'sib', label: 'SIB', count: 1 },
        ],
        selected: cats,
        onToggle: (v) => toggle(cats, v, setCats),
      },
    ]
    const chips = [
      ...[...types].map((v) => ({ key: `t-${v}`, label: v.toUpperCase(), onRemove: () => toggle(types, v, setTypes) })),
      ...[...cats].map((v) => ({ key: `c-${v}`, label: v, onRemove: () => toggle(cats, v, setCats) })),
    ]
    return (
      <div className="flex flex-col gap-3 bg-canvas p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">Library controls</span>
          <span className="ml-auto">
            <LibraryFilters
              groups={groups}
              activeCount={types.size + cats.size}
              onClearAll={() => { setTypes(new Set()); setCats(new Set()) }}
            />
          </span>
        </div>
        <ActiveFilterChips chips={chips} onClear={() => { setTypes(new Set()); setCats(new Set()) }} />
      </div>
    )
  },
}
