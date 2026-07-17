'use client'

/* ---- Pre-submission packet preview (v1.14) -------------------------------
 * One last look at EXACTLY what leaves CID: the form content, the selected
 * exhibits (cross-checked against their live sources), and what DOJ will NOT
 * receive. Confirm calls the same save + submit RPCs — the server remains
 * the authority on every requirement shown here. */
import type { LegalExhibit, LegalRequest } from '@/lib/justice'
import { humanize } from '@/lib/legalWorkflow'
import { Button } from '@/components/ui/Button'
import { ClassificationBadge } from '../legalShared'
import { exhibitFlag, type CaseRecords, type DraftShape } from './dossierShared'

export function SubmitPreview({ r, draft, exhibits, records, checklist, busy, onCancel, onConfirm }: {
  r: LegalRequest
  draft: DraftShape
  exhibits: LegalExhibit[]
  records: CaseRecords | null
  checklist: { label: string; ok: boolean; blocking: boolean }[]
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const blocked = checklist.some((c) => c.blocking && !c.ok)
  const flagged = exhibits.map((e) => ({ e, flag: exhibitFlag(e, records) }))
  const brokenCount = flagged.filter((x) => x.flag).length
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Packet preview before submission">
      <div className="max-h-[85vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl border border-white/10 bg-ink-950 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-white">Packet preview — submit for CID review</h3>
          <span className="font-mono text-xs text-blue-300">{r.request_number}</span>
          <ClassificationBadge value={draft.classification || r.classification} />
        </div>

        <p className="rounded-lg border border-badge-500/20 bg-badge-500/5 p-3 text-xs text-slate-300">
          Reviewers will receive <span className="font-semibold text-white">only</span> this request&apos;s form content and
          the exhibits below, frozen as an immutable version at DOJ submission. DOJ will{' '}
          <span className="font-semibold text-white">not</span> receive general case access — notes, evidence, files and
          reports that are not selected here stay CID-only.
        </p>

        <section className="space-y-1.5">
          <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Requirements</h4>
          <ul className="space-y-1">
            {checklist.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-sm">
                <span className={c.ok ? 'text-emerald-300' : c.blocking ? 'text-rose-300' : 'text-amber-300'}>
                  {c.ok ? '✓' : c.blocking ? '✗' : '⚠'}
                </span>
                <span className={c.ok ? 'text-slate-300' : 'text-slate-200'}>{c.label}</span>
                {!c.ok && !c.blocking && (
                  <span className="text-xs text-amber-300/80">CID supervisor must record an override for an empty packet</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-1.5">
          <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            Included exhibits ({exhibits.length})
          </h4>
          {exhibits.length === 0 && <p className="text-sm text-slate-400">No supporting items selected.</p>}
          <ul className="space-y-1.5">
            {flagged.map(({ e, flag }) => (
              <li key={e.id} className={`rounded-lg border px-3 py-2 text-sm ${flag ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/10 bg-ink-900/50'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{humanize(e.exhibit_type)}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-200">{e.display_title}</span>
                  {e.exhibit_type === 'finalized_report' && !flag && (
                    <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 text-[10px] font-semibold text-emerald-300">finalized</span>
                  )}
                </div>
                {flag && <p className="mt-1 text-xs text-amber-300">⚠ {flag} — remove it or fix the source before submitting.</p>}
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 pt-3">
          {blocked && <span className="mr-auto text-xs text-rose-300">Complete the required fields before submitting.</span>}
          {!blocked && brokenCount > 0 && (
            <span className="mr-auto text-xs text-amber-300">{brokenCount} exhibit{brokenCount === 1 ? '' : 's'} flagged — you can still submit; reviewers see the frozen snapshot titles.</span>
          )}
          <Button onClick={onCancel}>Back to editing</Button>
          <Button variant="primary" disabled={busy || blocked} onClick={onConfirm}>Confirm &amp; submit to CID</Button>
        </div>
      </div>
    </div>
  )
}
