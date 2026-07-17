'use client'

/** Reader metadata rail — governance facts, source/sync state, the viewer's
 *  own reading state, and related documents (forward relations + reverse
 *  backlinks, e.g. "Replaced by"). Pure presentation over rows the reader
 *  loaded; every derivation comes from docModel so the rail can never
 *  disagree with the shelf. Rendered as the sticky right column at xl and
 *  inside a disclosure above the article below that. */
import type { Tables } from '@/lib/database.types'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useNow } from '@/lib/useNow'
import { Badge } from '@/components/ui/Badge'
import {
  ACK_LABEL, CLASS_LABEL, SYNC_LABEL, SYNC_TONE, STATUS_LABEL, STATUS_TONE, TYPE_LABEL,
  docTitle, reviewState, type AckState, type DocRow, type DocumentStatus, type DocumentType, type SyncStatus,
} from './docModel'

export type RelationRow = Tables<'document_relations'>

export interface RelatedDocMeta { id: string; name: string; status: string; document_type: string }

export interface CampaignLite {
  id: string
  deadline: string | null
  reason: string
  audience: string
  created_at: string
}

export interface MyAckLite { acknowledged_at: string; version_number: number | null }

const REL_LABEL: Record<string, string> = {
  related: 'Related', references: 'References', replaces: 'Replaces',
  superseded_by: 'Superseded by', supersedes: 'Supersedes', see_also: 'See also',
}
const relLabel = (r: string): string => REL_LABEL[r] ?? (r.charAt(0).toUpperCase() + r.slice(1)).replace(/_/g, ' ')

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <dt className="flex-shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-xs text-slate-200">{children}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/5 bg-ink-900/60 p-4">
      <h2 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</h2>
      {children}
    </section>
  )
}

function RelatedLink({ id, meta, prefix, onOpenDoc }: {
  id: string
  meta: RelatedDocMeta | undefined
  prefix: string
  onOpenDoc: (id: string) => void
}) {
  return (
    <li>
      <button
        onClick={() => onOpenDoc(id)}
        className="flex min-h-[40px] w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{prefix}</span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-badge-200">
          {meta ? docTitle(meta.name) : 'Document'}
        </span>
        {meta && (
          <Badge tone={STATUS_TONE[meta.status as DocumentStatus] ?? 'neutral'}>
            {STATUS_LABEL[meta.status as DocumentStatus] ?? meta.status}
          </Badge>
        )}
      </button>
    </li>
  )
}

export function DocMetaRail({ doc, relations, backlinks, relatedMeta, campaign, myAck, ack, onOpenDoc }: {
  doc: DocRow
  /** Forward relations (this document → others). */
  relations: RelationRow[]
  /** Reverse relations (other documents → this one). */
  backlinks: RelationRow[]
  relatedMeta: Record<string, RelatedDocMeta>
  campaign: CampaignLite | null
  myAck: MyAckLite | null
  ack: AckState
  onOpenDoc: (id: string) => void
}) {
  const nowMs = useNow()
  const review = reviewState(doc, nowMs)
  const drive = doc.source_system === 'google_drive'
  const tags: string[] = Array.isArray(doc.tags) ? doc.tags.filter((t): t is string => typeof t === 'string') : []
  const docLinks = relations.filter((r) => r.target_document_id)
  const otherLinks = relations.filter((r) => !r.target_document_id && (r.label || r.target_route))

  return (
    <div className="space-y-4">
      <Section title="Details">
        <dl className="divide-y divide-white/5">
          <KV label="Type">{TYPE_LABEL[doc.document_type as DocumentType] ?? doc.document_type}</KV>
          <KV label="Status">
            <Badge tone={STATUS_TONE[doc.status as DocumentStatus] ?? 'neutral'}>{STATUS_LABEL[doc.status as DocumentStatus] ?? doc.status}</Badge>
          </KV>
          <KV label="Classification">{CLASS_LABEL[doc.classification as keyof typeof CLASS_LABEL] ?? doc.classification}</KV>
          <KV label="Version">v{doc.current_version_number}</KV>
          <KV label="Owner">{officerName(doc.owner_user_id) ?? '—'}</KV>
          {doc.approved_by && (
            <KV label="Approved">{officerName(doc.approved_by)}{doc.approved_at ? ` · ${fmtDate(doc.approved_at)}` : ''}</KV>
          )}
          <KV label="Effective">{fmtDate(doc.effective_at)}</KV>
          <KV label="Review due">
            {doc.review_due_at ? (
              <span className={review ? 'font-semibold text-amber-300' : undefined}>
                {fmtDate(doc.review_due_at)}{review === 'overdue' ? ' — overdue' : review === 'due_soon' ? ' — due soon' : ''}
              </span>
            ) : '—'}
          </KV>
          {doc.expires_at && <KV label="Expires">{fmtDate(doc.expires_at)}</KV>}
          <KV label="Updated">{fmtDateTime(doc.updated_at)}</KV>
          {tags.length > 0 && (
            <KV label="Tags">
              <span className="flex flex-wrap justify-end gap-1">
                {tags.map((t) => <Badge key={t} tone="neutral">{t}</Badge>)}
              </span>
            </KV>
          )}
        </dl>
      </Section>

      <Section title="Source">
        <dl className="divide-y divide-white/5">
          <KV label="Maintained in">{doc.canonical_source === 'google_drive' ? 'Google Drive' : 'Portal'}</KV>
          {drive && (
            <>
              <KV label="Sync">
                <Badge tone={SYNC_TONE[(doc.sync_status ?? 'pending') as SyncStatus] ?? 'neutral'}>
                  {SYNC_LABEL[(doc.sync_status ?? 'pending') as SyncStatus] ?? doc.sync_status}
                </Badge>
              </KV>
              <KV label="Last synced">{fmtDateTime(doc.last_synced_at)}</KV>
              {doc.source_modified_at && <KV label="Drive modified">{fmtDateTime(doc.source_modified_at)}</KV>}
            </>
          )}
        </dl>
        {drive && doc.sync_error && <p className="mt-2 text-xs text-rose-300">{doc.sync_error}</p>}
      </Section>

      {ack !== 'not_required' && (
        <Section title="Your reading">
          <p className="text-xs text-slate-200">{ACK_LABEL[ack]}</p>
          {myAck && (
            <p className="mt-1 text-xs text-slate-400">
              Last acknowledged{myAck.version_number != null ? ` v${myAck.version_number}` : ''} · {fmtDateTime(myAck.acknowledged_at)}
            </p>
          )}
          {doc.acknowledgement_deadline && (
            <p className="mt-1 text-xs text-amber-300">Deadline {fmtDate(doc.acknowledgement_deadline)}</p>
          )}
          {campaign && (
            <p className="mt-1 text-xs text-slate-400">
              Required reading{campaign.deadline ? ` — due ${fmtDate(campaign.deadline)}` : ''}: {campaign.reason}
            </p>
          )}
        </Section>
      )}

      {(docLinks.length > 0 || backlinks.length > 0 || otherLinks.length > 0) && (
        <Section title="Related">
          <ul className="space-y-0.5">
            {docLinks.map((r) => (
              <RelatedLink
                key={r.id}
                id={r.target_document_id as string}
                meta={relatedMeta[r.target_document_id as string]}
                prefix={r.label || relLabel(r.relation)}
                onOpenDoc={onOpenDoc}
              />
            ))}
            {backlinks.map((r) => (
              <RelatedLink
                key={r.id}
                id={r.document_id}
                meta={relatedMeta[r.document_id]}
                prefix={r.relation === 'replaces' || r.relation === 'supersedes' ? 'Replaced by' : 'Referenced by'}
                onOpenDoc={onOpenDoc}
              />
            ))}
            {otherLinks.map((r) => (
              <li key={r.id} className="px-2 py-1.5 text-xs text-slate-400">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{relLabel(r.relation)}</span>{' '}
                {r.label ?? r.target_kind}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
