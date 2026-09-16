import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import migration from '../../../supabase/migrations/20261113120000_cid_sop_v3.sql?raw'
import { renderDocumentMarkdown } from '@/lib/markdown'
import type { GuideRow } from '@/lib/guides'
import { Collapsible } from '@/components/ui/Collapsible'
import { DocToc } from '@/components/shared/DocToc'
import { DocumentHeader } from './DocumentHeader'
import { GUIDE_CANVAS } from './guideSurfaces'

/** The active CID SOP, version 3, rendered exactly as the document page
 *  renders it — the header, the contents rail, the prose — from the text in
 *  the migration that applies it. No login and no Supabase: this is how the
 *  correction was looked at before it was applied, at 390, 768 and 1440. */
const BODY = /\$sop\$([\s\S]*?)\$sop\$/.exec(migration)?.[1] ?? ''

const ROW: GuideRow = {
  id: 'd5ce98b9-5de8-4fd8-9b7b-beeffc0a32e4',
  slug: 'cid-standard-operating-procedure',
  title: 'Criminal Investigation Division (CID) Standard Operating Procedure',
  summary: 'The division’s standing rules: structure, chain of command, equipment, patrol, case management, informants, surveillance and undercover operations, joint operations, discipline, training, records and compensation.',
  category: 'general', status: 'published', doc_type: 'sop',
  issuing_authority: null, effective_date: '2026-08-03', version_label: '3',
  change_summary: null, superseded_by: null, related_policy: null,
  acknowledgement_required: false, acknowledgement_deadline: null, migrated_document_id: null,
  body_key: 'cid-standard-operating-procedure', pinned: false, audience: 'all', custom_roles: [],
  tags: [], keywords: null, body_kind: 'sections', read_minutes: null, view_count: 0,
  content_owner: null, last_reviewed_at: null, next_review_at: null,
  archived_at: null, archived_by: null, publication_note: null,
  outdated_at: null, outdated_by: null, outdated_reason: null,
  published_at: '2026-08-03T00:00:00.000Z', created_by: null, updated_by: null,
  created_at: '2026-08-03T00:00:00.000Z', updated_at: '2026-09-16T00:00:00.000Z',
  deleted_at: null, deleted_by: null, delete_reason: null, delete_batch: null,
}

const meta = { title: 'Guides/CID SOP v3' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Document: Story = {
  render: function SopStory() {
    const { nodes, headings } = renderDocumentMarkdown(BODY)
    const [active, setActive] = useState<string | null>(headings[0]?.id ?? null)
    const words = BODY.trim().split(/\s+/).length
    return (
      <div className={`${GUIDE_CANVAS} px-3 py-4 sm:px-6`}>
        <div className="mx-auto flex w-full max-w-6xl gap-8">
          <aside className="hidden w-60 flex-shrink-0 lg:block">
            <div className="sticky top-4">
              <DocToc headings={headings} activeId={active} onSelect={setActive} size="rail" />
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <DocumentHeader row={ROW} categoryLabel="General" readMinutes={Math.max(1, Math.round(words / 200))} />
            {headings.length > 1 && (
              <Collapsible className="lg:hidden" title="Contents" hint={`${headings.filter((h) => h.level < 4).length} sections`}>
                <DocToc headings={headings} activeId={active} onSelect={setActive} size="sheet" />
              </Collapsible>
            )}
            <div className="prose-guide text-sm leading-relaxed text-slate-300">{nodes}</div>
          </div>
        </div>
      </div>
    )
  },
}
