'use client'

/* ---- Pre-submission packet preview (v1.14) -------------------------------
 * One last look at EXACTLY what leaves CID: the form content, the selected
 * exhibits (cross-checked against their live sources), and what the
 * reviewers will NOT receive. Confirm calls the same save + submit RPCs — the
 * server remains the authority on every requirement shown here.
 *
 * Resubmission (P4-06, L11): from ANY returned_* state the server refuses
 * without a change summary, so it is required here; unresolved revision
 * items are listed as a warning (they never block — the reviewer decides).
 * A judge return fast-tracks back to the judicial queue unless the
 * investigator DECLARES a material change, which re-enters bureau review. */
import { useState } from 'react'
import type { LegalExhibit, LegalRequest } from '@/lib/justice'
import { humanize } from '@/lib/legalWorkflow'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { ClassificationBadge } from '../legalShared'
import { exhibitFlag, type CaseRecords, type DraftShape } from './dossierShared'
import { fieldLabel, type RevisionItem } from './RevisionChecklist'

export function SubmitPreview({ r, draft, exhibits, records, checklist, busy, returnedBy = null, unresolved = [], onCancel, onConfirm }: {
  r: LegalRequest
  draft: DraftShape
  exhibits: LegalExhibit[]
  records: CaseRecords | null
  checklist: { label: string; ok: boolean; blocking: boolean }[]
  busy: boolean
  /** Set when resubmitting from a returned_* state: 'judge' also shows the
   *  material-change declaration (a bureau return re-enters bureau review
   *  regardless). Null on a first submission. */
  returnedBy?: 'judge' | 'bureau' | null
  /** Unresolved revision items — warned about, never blocking. */
  unresolved?: RevisionItem[]
  onCancel: () => void
  onConfirm: (v: { materialChange: boolean; changeSummary: string }) => void
}) {
  const [materialChange, setMaterialChange] = useState(false)
  const [changeSummary, setChangeSummary] = useState('')
  const resubmitting = !!returnedBy
  const summaryMissing = resubmitting && !changeSummary.trim()
  const blocked = checklist.some((c) => c.blocking && !c.ok) || summaryMissing
  const flagged = exhibits.map((e) => ({ e, flag: exhibitFlag(e, records) }))
  const brokenCount = flagged.filter((x) => x.flag).length
  return (
    // Shared Modal engine: focus trap, Escape + backdrop close (→ onCancel),
    // focus restore and dialog aria come from the primitive (audit a11y).
    <Modal open onClose={onCancel} wide>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="cid-modal-title" className="text-sm font-bold text-white">
            {resubmitting ? 'Packet preview — resubmit for review' : 'Packet preview — submit for bureau review'}
          </h3>
          <span className="font-mono text-xs text-blue-300">{r.request_number}</span>
          <ClassificationBadge value={draft.classification || r.classification} />
        </div>

        <p className="rounded-lg border border-badge-500/20 bg-badge-500/5 p-3 text-xs text-slate-300">
          Reviewers will receive <span className="font-semibold text-white">only</span> this request&apos;s form content and
          the exhibits below, frozen as an immutable version at submission. The bench will{' '}
          <span className="font-semibold text-white">not</span> receive general case access — notes, evidence, files and
          reports that are not selected here stay CID-only.
        </p>

        <section className="space-y-1.5">
          <h4 className="text-[13px] font-semibold text-white">Requirements</h4>
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
          <h4 className="text-[13px] font-semibold text-white">
            Included exhibits ({exhibits.length})
          </h4>
          {exhibits.length === 0 && <p className="text-sm text-slate-400">No supporting items selected.</p>}
          <ul className="space-y-1.5">
            {flagged.map(({ e, flag }) => (
              <li key={e.id} className={`rounded-lg border px-3 py-2 text-sm ${flag ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/10 bg-ink-900/50'}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">{humanize(e.exhibit_type)}</span>
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

        {resubmitting && (
          <section className="space-y-3 rounded-lg border border-white/10 bg-ink-950/50 p-3">
            {unresolved.length > 0 && (
              <div role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
                <p className="font-semibold">{unresolved.length} requested revision{unresolved.length === 1 ? ' is' : 's are'} still marked unresolved:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {unresolved.map((i) => <li key={i.id}><span className="font-semibold">{fieldLabel(i.field)}</span> — {i.note}</li>)}
                </ul>
                <p className="mt-1 text-amber-200/80">You can still resubmit; the reviewer will see them open.</p>
              </div>
            )}
            {returnedBy === 'judge' && (
              <>
                <p className="text-xs text-slate-300">
                  A corrected request returns directly to the judicial queue. Check below only if you made a
                  material change.
                </p>
                <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 text-sm text-slate-200">
                  <input
                    type="checkbox"
                    checked={materialChange}
                    onChange={(e) => setMaterialChange(e.target.checked)}
                    className="h-4 w-4 rounded border-white/20 bg-ink-900 accent-badge-500"
                  />
                  I made a material change (requires renewed bureau review)
                </label>
              </>
            )}
            <Field
              label="What changed since the last version?"
              required
              hint="Required on every resubmission — saved with the new version so reviewers see the changes at a glance."
            >
              {(id) => <Textarea id={id} rows={2} value={changeSummary} onChange={(e) => setChangeSummary(e.target.value)} />}
            </Field>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 pt-3">
          {blocked && (
            <span className="mr-auto text-xs text-rose-300">
              {summaryMissing && !checklist.some((c) => c.blocking && !c.ok) ? 'A change summary is required when resubmitting.' : 'Complete the required fields before submitting.'}
            </span>
          )}
          {!blocked && brokenCount > 0 && (
            <span className="mr-auto text-xs text-amber-300">{brokenCount} exhibit{brokenCount === 1 ? '' : 's'} flagged — you can still submit; reviewers see the frozen snapshot titles.</span>
          )}
          <Button onClick={onCancel}>Back to editing</Button>
          <Button
            variant="primary"
            disabled={busy || blocked}
            onClick={() => onConfirm({ materialChange: returnedBy === 'judge' && materialChange, changeSummary: changeSummary.trim() })}
          >
            {returnedBy === 'judge' && !materialChange
              ? 'Confirm & resubmit to the judge'
              : resubmitting ? 'Confirm & resubmit for bureau review' : 'Confirm & submit for bureau review'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
