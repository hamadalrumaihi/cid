'use client'

/** The approve / deny dialog for every `modal: 'access'` inline action
 *  (inlineActions.inlineActionsFor): a case access request
 *  (`case_access_decide` — ONE atomic server-side decision that inserts the
 *  standing grant on approve, stamps the request, notifies and audits), a
 *  field access request (`field_access_decide`), a narcotic suggestion
 *  (`decide_narcotic_suggestion`) or a surveillance alert
 *  (`surveillance_alert_ack`). The copy and button labels follow the kind;
 *  the write is always `runInlineAction(item, kind, { approve, note })`, so
 *  the server resolves the subject from the row itself — no client-assembled
 *  metadata is trusted for the decision. */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { officerName } from '@/lib/profiles'
import { humanizeError, toast } from '@/lib/toast'
import type { ActionItem } from '@/lib/actionItems'
import { runInlineAction } from './inlineActions'

export interface AccessTarget { item: ActionItem; kind: string }

interface AccessMeta {
  requester_id?: unknown
  requester_name?: unknown
  case_id?: unknown
  reason?: unknown
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

interface Copy {
  title: string
  approve: string
  deny: string
  /** Offer an optional note (sent as `note`) — the case-access RPC persists none. */
  note?: string
  footer: string
}

const COPY: Record<string, Copy> = {
  decide_access: {
    title: 'Case access request', approve: 'Grant access', deny: 'Deny',
    footer: 'Granting adds a standing access grant for this officer; denying closes the request. The requester is notified either way.',
  },
  decide_field_access: {
    title: 'Field access request', approve: 'Approve', deny: 'Deny', note: 'Reason (optional)',
    footer: 'Approving appoints the officer to the Field Intelligence portal; denying closes the request with your reason.',
  },
  decide_narcotic_suggestion: {
    title: 'Narcotic suggestion', approve: 'Accept', deny: 'Decline', note: 'Note (optional)',
    footer: 'The submitter is notified of the decision and sees your note.',
  },
  ack_surveillance_alert: {
    title: 'Surveillance alert', approve: 'Acknowledge', deny: 'Dismiss alert',
    footer: 'Acknowledging keeps the alert on the case record; dismissing closes it as not actionable.',
  },
}
const FALLBACK: Copy = { title: 'Decision', approve: 'Approve', deny: 'Deny', footer: 'The decision is recorded and the requester is notified.' }

export function AccessDecisionModal({ target, onClose, onDecided }: {
  /** The item under decision + its inline action kind (null = closed). */
  target: AccessTarget | null
  onClose: () => void
  /** Fired after a successful decision so the queue refreshes. */
  onDecided: () => void
}) {
  const item = target?.item ?? null
  const kind = target?.kind ?? ''
  const copy = COPY[kind] ?? FALLBACK
  const [note, setNote] = useState('')
  const meta = (item?.sourceMetadata ?? {}) as AccessMeta
  const requesterId = str(meta.requester_id)
  // The model routes the requester's own words into item.reason (with a
  // generic fallback we don't echo back as a quote).
  const reason = str(meta.reason)
    ?? (item?.reason && item.reason !== 'Pending access decision' ? item.reason : null)
  const requesterName = str(meta.requester_name) ?? officerName(requesterId) ?? 'An officer'
  const isCaseAccess = kind === 'decide_access'

  const decide = async (approve: boolean) => {
    if (!item) return
    const res = await runInlineAction(item, kind, { approve, note: note.trim() || undefined })
    if (!res.ok) { toast(humanizeError(res.message ?? 'Could not record the decision.'), 'danger'); return }
    toast(res.message ?? 'Decision recorded.', 'success')
    onDecided()
    onClose()
  }

  return (
    <Modal open={!!item} onClose={onClose} dirty={() => note.trim().length > 0}>
      <div className="p-5">
        <ModalHeader title={copy.title} onClose={onClose} />
        {isCaseAccess ? (
          <p className="text-sm text-slate-300">
            <span className="font-semibold text-white">{requesterName}</span> requested access to
            {item?.caseNumber
              ? <> case <span className="font-mono text-slate-200">{item.caseNumber}</span>.</>
              : <> this case.</>}
          </p>
        ) : (
          <p className="text-sm text-slate-300">
            <span className="font-semibold text-white">{item?.title ?? ''}</span>
            {item?.summary && <> — {item.summary}</>}
          </p>
        )}
        {reason && (
          <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">{reason}</p>
        )}
        {copy.note && (
          <div className="mt-4">
            <Field label={copy.note}>
              {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">{copy.footer}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button className="min-h-[44px] sm:min-h-0" onClick={onClose}>Cancel</Button>
          <Button variant="danger" className="min-h-[44px] sm:min-h-0" onAction={() => decide(false)}>{copy.deny}</Button>
          <Button variant="success" className="min-h-[44px] sm:min-h-0" onAction={() => decide(true)}>{copy.approve}</Button>
        </div>
      </div>
    </Modal>
  )
}
