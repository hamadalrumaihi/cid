'use client'

/** Supporting section — the deliberately-selected packet (exhibits) plus the
 *  version-bound signature trail. Reviewers see ONLY the selected items; the
 *  add/remove write paths stay on the add_legal_exhibit / remove_legal_exhibit
 *  definer RPCs, unchanged. 'prior_legal_request' exhibits render as linked
 *  request chips (→ ?request=), and the reverse "Referenced by" list shows
 *  RLS-visible requests that cite THIS one. */
import { useState } from 'react'
import { rpc } from '@/lib/db'
import { justiceRoleLabel, type LegalExhibit, type LegalRequest, type LegalSignature, type LegalVersion } from '@/lib/justice'
import { humanize } from '@/lib/legalWorkflow'
import type { PacketManifestEntry } from '@/lib/schemas'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiConfirm } from '@/components/ui/dialog'
import { RelatedRecordPicker, type RecordSource } from '@/components/shared/RelatedRecordPicker'
import { SignatureViewer, type SignatureItem } from '@/components/shared/SignatureViewer'
import type { CaseRecords } from './dossierShared'

/** Slim projection of a request that references this one (reverse lookup —
 *  only what the chip renders; the parent fetch is RLS-trimmed). */
export interface ReferencedBy {
  id: string
  request_number: string | null
  title: string | null
}

export function SupportingSection({ r, exhibits, signatures, versions, editable, busy, onChanged, records, manifest, referencedBy, onOpenRequest }: {
  r: LegalRequest
  exhibits: LegalExhibit[]
  signatures: LegalSignature[]
  versions: LegalVersion[]
  editable: boolean
  busy: boolean
  onChanged: () => void
  records: CaseRecords | null
  manifest: PacketManifestEntry[]
  referencedBy: ReferencedBy[]
  onOpenRequest: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)

  const removeExhibit = async (e: LegalExhibit) => {
    const ok = await uiConfirm(`Remove “${e.display_title}” from the packet?`, { title: 'Remove exhibit', confirmText: 'Remove' })
    if (!ok) return
    const res = await rpc('remove_legal_exhibit', { p_exhibit: e.id })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Exhibit removed.', 'info'); onChanged() }
  }

  return (
    <div className="space-y-4">
      <Card pad="sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            Selected packet — reviewers see ONLY these items
          </h3>
          {editable && <Button disabled={busy} onClick={() => setAdding((x) => !x)}>{adding ? 'Done' : '+ Add exhibit'}</Button>}
        </div>
        <ul className="space-y-1.5">
          {exhibits.map((e) => (
            <li key={e.id} className="rounded-lg border border-white/10 bg-ink-950/50 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{humanize(e.exhibit_type)}</span>
                {e.exhibit_type === 'prior_legal_request' && e.source_id ? (
                  // Cross-referenced request → open its dossier in place. The
                  // snapshot title (request number + title) is already on this
                  // RLS-authorised exhibit row; RLS decides the far side.
                  <button
                    onClick={() => onOpenRequest(e.source_id!)}
                    className="min-w-0 flex-1 truncate text-left font-medium text-blue-200 hover:text-white"
                    title="Open the referenced legal request"
                  >
                    {e.display_title}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate text-slate-200">{e.display_title}</span>
                )}
                {(() => {
                  // safeUrl on EVERY DB-sourced href — a planted javascript:/data:
                  // URL must never reach a DOJ reviewer's click (renders nothing).
                  const url = (typeof e.snapshot_metadata === 'object' && e.snapshot_metadata && !Array.isArray(e.snapshot_metadata))
                    ? safeUrl((e.snapshot_metadata as Record<string, unknown>).url) : ''
                  return url
                    ? <a className="text-xs text-blue-300 underline" href={url} target="_blank" rel="noreferrer">open</a>
                    : null
                })()}
                {editable && (
                  <button onClick={() => void removeExhibit(e)} className="min-h-[40px] px-1 text-xs font-semibold text-rose-300 hover:text-rose-200" aria-label={`Remove ${e.display_title}`}>
                    Remove
                  </button>
                )}
              </div>
              {e.rationale && (
                <p className="mt-1 text-xs text-slate-400">
                  <span className="font-semibold text-slate-300">Why this target:</span> {e.rationale}
                </p>
              )}
            </li>
          ))}
          {exhibits.length === 0 && <li className="text-sm text-slate-400">No supporting items selected yet.</li>}
        </ul>
        {!editable && manifest.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            Frozen manifest of the submitted version: {manifest.map((m) => m.title).filter(Boolean).join(' · ')}
          </p>
        )}
      </Card>

      {adding && editable && <ExhibitPickers r={r} records={records} onAdded={onChanged} />}

      {/* Reverse cross-references — only RLS-visible citing requests appear,
          so an empty list renders nothing (never a "none exist" claim). */}
      {referencedBy.length > 0 && (
        <Card pad="sm">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            Referenced by — requests citing this one
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {referencedBy.map((x) => (
              <button
                key={x.id}
                onClick={() => onOpenRequest(x.id)}
                title={`Open ${x.request_number ?? 'request'}${x.title ? ` — ${x.title}` : ''}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-blue-200 transition hover:bg-white/10"
              >
                <span className="font-mono">{x.request_number ?? 'Request'}</span>
                {x.title && <span className="truncate text-slate-300">{x.title}</span>}
              </button>
            ))}
          </div>
        </Card>
      )}

      <Card pad="sm">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Signatures (version-bound)</h3>
        {signatures.length === 0 ? (
          <p className="text-sm text-slate-400">No signatures recorded yet.</p>
        ) : (
          <SignatureViewer signatures={signatures.map((s): SignatureItem => {
            const ver = versions.find((x) => x.id === s.version_id)
            return {
              id: s.id,
              name: s.signer_name_snapshot,
              role: justiceRoleLabel(s.signer_role_snapshot),
              action: humanize(s.action),
              versionLabel: `v${ver?.version_number ?? '?'}`,
              at: s.signed_at,
            }
          })} />
        )}
      </Card>
    </div>
  )
}

/** Case-scoped selectors over the SAME canonical records used elsewhere in
 *  the portal (evidence, attachments, finalized reports, media) — the
 *  shared RelatedRecordPicker; the add_legal_exhibit write path is unchanged. */
function ExhibitPickers({ r, records, onAdded }: { r: LegalRequest; records: CaseRecords | null; onAdded: () => void }) {
  const add = async (type: string, sourceId: string | null, title?: string, meta?: Record<string, string>) => {
    const res = await rpc('add_legal_exhibit', {
      p_request: r.id, p_type: type, p_source_id: sourceId ?? undefined,
      p_title: title, p_meta: meta ?? {},
    })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Exhibit added.', 'success'); onAdded() }
  }

  const sources: RecordSource[] = [
    { kind: 'evidence', label: 'Evidence', options: (records?.evidence ?? []).map((e) => ({ id: e.id, label: `${e.item_code ?? ''} ${e.description ?? e.type ?? 'Evidence'}`.trim() })) },
    { kind: 'attachment', label: 'Attachments', options: (records?.files ?? []).map((f) => ({ id: f.id, label: f.name })) },
    { kind: 'finalized_report', label: 'Finalized reports', options: (records?.reports ?? []).filter((x) => x.finalized).map((x) => ({ id: x.id, label: `${x.template} report` })) },
    { kind: 'case_media', label: 'Case media', options: (records?.media ?? []).map((m) => ({ id: m.id, label: m.title })) },
  ]

  return (
    <Card pad="sm">
      <RelatedRecordPicker
        sources={sources}
        onPick={(kind, option) => void add(kind, option.id)}
        onAddLink={(url) => void add('external_link', null, undefined, { url })}
      />
    </Card>
  )
}
