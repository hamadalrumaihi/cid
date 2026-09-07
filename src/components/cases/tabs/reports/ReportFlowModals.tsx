'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { useAuth } from '@/lib/auth'
import { parseFormValues } from '@/lib/jsonShapes'
import { reopenReport, requiredGaps, reviewReport, submitReport, type TemplateVersion } from '@/lib/reportTemplates'
import { toast } from '@/lib/toast'
import { useAction } from '@/lib/useAction'
import type { ReportRow } from '../shared'
import { RequiredChecklist } from './RequiredChecklist'

/** The three review-flow dialogs (contract §2). Every confirm calls a report
 *  RPC that returns the reports row and RAISES on refusal — the message is
 *  toasted (humanized) and nothing changes client-side until the refresh.
 *
 *  Signatures are TYPED (RB8): the officer types their name; the server
 *  captures {officer, signer_id, badge, signed_at, typed}. The badge comes
 *  from the profile, never from the form.
 *
 *  Each dialog's fields live in an inner body that mounts with the target
 *  (keyed on the report id) — state starts fresh per open without effects. */

export type FlowKind = 'submit' | 'review' | 'reopen'
export interface FlowTarget { kind: FlowKind; r: ReportRow; version: TemplateVersion | null; decision?: 'approve' | 'return' }

interface BodyProps { target: FlowTarget; onClose: () => void; onDone: () => void }

/** Submit for review — or, for a self-seal template (review_required =
 *  false), Finalize & seal through the same RPC. The required-field checklist
 *  hard-blocks (mirror of "required fields missing: …"); case_closure's open
 *  tasks rule is server-only and surfaces as the RPC's message. */
export function SubmitReportModal({ target, onClose, onDone }: { target: FlowTarget | null; onClose: () => void; onDone: () => void }) {
  const open = target?.kind === 'submit'
  return (
    <Modal open={open} onClose={onClose}>
      {open && target && <SubmitBody key={target.r.id} target={target} onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function SubmitBody({ target, onClose, onDone }: BodyProps) {
  const { profile } = useAuth()
  const [typed, setTyped] = useState(profile?.display_name || '')
  const values = useMemo(() => parseFormValues(target.r.fields), [target.r.fields])
  const version = target.version
  const selfSeal = !!version && !version.reviewRequired
  const gaps = version ? requiredGaps(version, values) : []
  const [blocked, setBlocked] = useState<string | null>(null)
  const { run, busy } = useAction(async () => {
    // Hard block — the same refusal report_submit would raise, without the
    // round trip. The RPC re-checks regardless.
    if (gaps.length) { setBlocked(`required fields missing: ${gaps.map((g) => g.label).join(', ')}`); return }
    const res = await submitReport(target.r.id, typed.trim() || null, profile?.badge_number || null)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(selfSeal ? 'Report sealed.' : 'Report submitted for review.', 'success')
    onClose(); onDone()
  })
  return (
    <div className="p-5">
      <ModalHeader title={selfSeal ? 'Finalize & seal this report?' : 'Submit this report for review?'} onClose={onClose} />
      <div className="space-y-3 text-sm text-slate-300">
        <p>
          {selfSeal
            ? 'This template seals on submission: its contents lock and it is signed in your name. Bureau Lead and above can reopen it later with a reason.'
            : 'Your contents lock while a Senior Detective or Bureau Lead reviews it. An approval seals the report with both signatures; a return sends it back to you with a note.'}
        </p>
        {version
          ? <RequiredChecklist version={version} values={values} compact />
          : <p className="rounded-lg bg-amber-500/10 p-3 text-amber-200">This report has no published template — the server will refuse the submission.</p>}
        {blocked && <p role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-200">Cannot submit — {blocked}.</p>}
        <Field label="Signature (type your name)" required hint={profile?.badge_number ? `Badge #${profile.badge_number} is recorded with the signature.` : undefined}>
          {(id) => <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={profile?.display_name || 'Your name'} />}
        </Field>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant={selfSeal ? 'success' : 'warn'} loading={busy} disabled={!version || !typed.trim()} onClick={() => void run()}>
          {selfSeal ? 'Finalize & seal' : 'Submit for review'}
        </Button>
      </div>
    </div>
  )
}

/** Reviewer decision — approve with a typed signature, or return with a
 *  required note. Shown only when the viewer's mirror says they may review;
 *  private.can_review_report decides. */
export function ReviewReportModal({ target, onClose, onDone }: { target: FlowTarget | null; onClose: () => void; onDone: () => void }) {
  const open = target?.kind === 'review'
  return (
    <Modal open={open} onClose={onClose}>
      {open && target && <ReviewBody key={target.r.id} target={target} onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function ReviewBody({ target, onClose, onDone }: BodyProps) {
  const { profile } = useAuth()
  const [decision, setDecision] = useState<'approve' | 'return'>(target.decision ?? 'approve')
  const [note, setNote] = useState('')
  const [typed, setTyped] = useState(profile?.display_name || '')
  const { run, busy } = useAction(async () => {
    const res = await reviewReport(target.r.id, decision, note.trim() || null, typed.trim() || null, profile?.badge_number || null)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(decision === 'approve' ? 'Report approved and sealed.' : 'Report returned to the author.', 'success')
    onClose(); onDone()
  })
  const canConfirm = decision === 'approve' ? !!typed.trim() : !!note.trim()
  return (
    <div className="p-5">
      <ModalHeader title="Review this report" onClose={onClose} />
      <div className="mb-3" role="group" aria-label="Decision">
        <p className="mb-1 block text-xs font-semibold text-slate-400">Decision</p>
        <div className="flex flex-wrap gap-2">
          <Button variant={decision === 'approve' ? 'success' : 'secondary'} aria-pressed={decision === 'approve'} onClick={() => setDecision('approve')}>Approve</Button>
          <Button variant={decision === 'return' ? 'warn' : 'secondary'} aria-pressed={decision === 'return'} onClick={() => setDecision('return')}>Return for revision</Button>
        </div>
      </div>
      <div className="space-y-3">
        <Field label={decision === 'return' ? 'Note to the author' : 'Note (optional)'} required={decision === 'return'}>
          {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={decision === 'return' ? 'What needs to change before it can be sealed' : 'Recorded with the approval'} />}
        </Field>
        {decision === 'approve' && (
          <Field label="Reviewer signature (type your name)" required hint={profile?.badge_number ? `Badge #${profile.badge_number} and your rank are recorded with the signature.` : undefined}>
            {(id) => <Input id={id} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={profile?.display_name || 'Your name'} />}
          </Field>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant={decision === 'approve' ? 'success' : 'warn'} loading={busy} disabled={!canConfirm} onClick={() => void run()}>
          {decision === 'approve' ? 'Approve & seal' : 'Return to author'}
        </Button>
      </div>
    </div>
  )
}

/** Reopen a sealed report — a reason is required (RB8); the seal and both
 *  signatures move into fields._reopen_log and the author is notified. */
export function ReopenReportModal({ target, onClose, onDone }: { target: FlowTarget | null; onClose: () => void; onDone: () => void }) {
  const open = target?.kind === 'reopen'
  return (
    <Modal open={open} onClose={onClose}>
      {open && target && <ReopenBody key={target.r.id} target={target} onClose={onClose} onDone={onDone} />}
    </Modal>
  )
}

function ReopenBody({ target, onClose, onDone }: BodyProps) {
  const [reason, setReason] = useState('')
  const { run, busy } = useAction(async () => {
    const res = await reopenReport(target.r.id, reason.trim())
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Report reopened — it can be edited again.', 'success')
    onClose(); onDone()
  })
  return (
    <div className="p-5">
      <ModalHeader title="Reopen this report?" onClose={onClose} />
      <p className="text-sm text-slate-300">The seal is removed and the report becomes editable again. Both signatures are kept in the report&apos;s history, the author is notified, and the reopen is audit-logged with your reason.</p>
      <Field label="Reason" required className="mt-3">
        {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this sealed report must be reopened" />}
      </Field>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="warn" loading={busy} disabled={!reason.trim()} onClick={() => void run()}>Reopen report</Button>
      </div>
    </div>
  )
}
