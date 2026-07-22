'use client'

/** Role decision panel — replaces the old bottom action button-wall with ONE
 *  panel that shows only the current viewer's available primary action(s),
 *  with plain-language context from the deterministic workflow model. Every
 *  predicate here mirrors (never replaces) a server-side authority check, and
 *  every action is the SAME definer RPC as before — a hidden button is
 *  cosmetic, the server revalidates everything. Awareness-only viewers
 *  (bureau prosecutor, not a gate) get a quiet note, never action styling. */
import { rpc } from '@/lib/db'
import { type LegalExhibit, type LegalRequest } from '@/lib/justice'
import type { LegalDisposition } from '@/lib/legalWorkflow'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiPrompt } from '@/components/ui/dialog'

type ActFn = (fn: () => Promise<{ error: { message: string } | null }>, okMsg: string) => Promise<void>

/** One labelled action group: who you're acting as, then the controls. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export function DecisionPanel({
  r, busy, act, promptSig, exhibits,
  editable, canCidReview, cidActive,
  awarenessOnly, disposition, now, onSubmitToCid,
}: {
  r: LegalRequest
  busy: boolean
  act: ActFn
  promptSig: () => Promise<string | null>
  exhibits: LegalExhibit[]
  editable: boolean
  canCidReview: boolean
  cidActive: boolean
  awarenessOnly: boolean
  disposition: LegalDisposition
  now: number
  onSubmitToCid: () => void
}) {
  /* ── Bureau Lead decision (approve / deny / return) — the single write
   *    surface for legal-request review. Every action mirrors, never replaces,
   *    the server-side authority check in review_legal_request_as_cid. ─────── */
  const cidDecide = async (decision: 'approve' | 'deny' | 'return') => {
    if (decision === 'return') {
      const note = await uiPrompt('Return note for the investigator (required).', { title: 'Return for revision' })
      if (!note?.trim()) return
      await act(() => rpc('review_legal_request_as_cid', { p_request: r.id, p_decision: 'return', p_note: note }), 'Returned to the investigator.')
      return
    }
    if (decision === 'deny') {
      const note = await uiPrompt('Reason for denial (required).', { title: 'Deny request' })
      if (!note?.trim()) return
      await act(() => rpc('review_legal_request_as_cid', { p_request: r.id, p_decision: 'deny', p_note: note }), 'Denied.')
      return
    }
    let override: string | null = null
    if (exhibits.length === 0) {
      override = await uiPrompt('No supporting items are selected. Record an override reason to approve anyway.', { title: 'Packet override' })
      if (!override?.trim()) return
    }
    const sig = await promptSig()
    if (sig === null) return
    await act(() => rpc('review_legal_request_as_cid', {
      p_request: r.id, p_decision: 'approve', p_override_reason: override ?? undefined, p_signature: sig || undefined,
    }), 'Approved — ready to issue.')
  }

  /* ── Fulfilment handlers: issue / execute / return / service / compliance ── */
  const approvedUnissued = r.review_status === 'approved' && r.fulfilment_status === 'unissued'
  const warrant = r.request_type === 'warrant'

  const issue = async () => {
    const exp = warrant ? await uiPrompt('Expiration date/time (optional if the Judge set one).', { title: 'Issue', placeholder: '2026-07-21 18:00' }) : ''
    if (exp === null) return
    const dl = !warrant ? await uiPrompt('Response deadline (optional).', { title: 'Issue', placeholder: '2026-07-21 18:00' }) : ''
    if (dl === null) return
    const parse = (s: string | null) => (s?.trim() ? new Date(s.trim()).toISOString() : undefined)
    await act(() => rpc('issue_legal_request', { p_request: r.id, p_expires_at: parse(exp), p_response_deadline: parse(dl) }), 'Issued.')
  }
  const execute = async (result: 'full' | 'partial' | 'unable') => {
    const title = result === 'unable' ? 'Unable to execute' : result === 'partial' ? 'Partial execution' : 'Record execution'
    const outcome = await uiPrompt(
      result === 'unable'
        ? 'Reason the warrant could not be executed (required).'
        : 'Execution outcome (e.g. suspect in custody).',
      { title },
    )
    if (!outcome?.trim()) return
    const notes = await uiPrompt('Notes (optional). Log seized property below as inventory.', { title })
    if (notes === null) return
    await act(
      () => rpc('record_warrant_execution', { p_request: r.id, p_outcome: outcome, p_notes: notes || undefined, p_result: result }),
      result === 'unable' ? 'Recorded — the warrant remains issued.' : 'Execution recorded.',
    )
  }
  const fileReturn = async () => {
    const narrative = await uiPrompt('Return narrative (required).', { title: 'File return' })
    if (!narrative?.trim()) return
    await act(() => rpc('record_warrant_return', { p_request: r.id, p_narrative: narrative }), 'Return filed.')
  }
  const service = async (statusValue: string) => {
    const method = await uiPrompt('Service method (optional).', { title: 'Record service' })
    if (method === null) return
    const notes = await uiPrompt('Service notes (optional).', { title: 'Record service' })
    if (notes === null) return
    await act(() => rpc('record_subpoena_service', { p_request: r.id, p_status: statusValue, p_method: method || undefined, p_notes: notes || undefined }), 'Service recorded.')
  }
  const compliance = async (statusValue: string) => {
    let reason: string | null = null
    if (statusValue === 'non_compliant') {
      reason = await uiPrompt('Non-compliance reason (required).', { title: 'Record compliance' })
      if (!reason?.trim()) return
    }
    const notes = await uiPrompt('Notes (optional). Received materials must be logged as case evidence/attachments — this record links back to the case.', { title: 'Record compliance' })
    if (notes === null) return
    await act(() => rpc('record_subpoena_compliance', { p_request: r.id, p_status: statusValue, p_notes: notes || undefined, p_non_compliance_reason: reason ?? undefined }), 'Compliance recorded.')
  }
  const close = async (outcome: 'closed' | 'expired' | 'revoked') => {
    const needNote = outcome === 'revoked'
    const note = await uiPrompt(needNote ? 'Revocation reason (required).' : 'Close note (optional).', { title: outcome === 'revoked' ? 'Revoke' : 'Close request' })
    if (note === null || (needNote && !note.trim())) return
    await act(() => rpc('close_legal_request', { p_request: r.id, p_outcome: outcome, p_note: note || undefined }), 'Recorded.')
  }

  /* ── Block visibility (predicates preserved from the action bar) ─────────── */
  const canIssue = cidActive && approvedUnissued
  const canExecute = cidActive && warrant && r.fulfilment_status === 'issued'
  const canFileReturn = cidActive && warrant && ['executed', 'expired', 'revoked'].includes(r.fulfilment_status)
  const canRecordService = cidActive && !warrant && ['issued', 'served'].includes(r.fulfilment_status)
  const canRecordCompliance = cidActive && !warrant && ['compliance_pending', 'records_received', 'testimony_completed', 'non_compliance'].includes(r.fulfilment_status)
  const canClose = cidActive && r.fulfilment_status !== 'closed' && ['approved', 'denied', 'withdrawn'].includes(r.review_status)
  const canMarkExpired = cidActive && !!r.expires_at && Date.parse(r.expires_at) < now && !['expired', 'closed'].includes(r.fulfilment_status)
  const canRevoke = cidActive && ['issued', 'executed'].includes(r.fulfilment_status)
  const anyFulfilment = canIssue || canExecute || canFileReturn || canRecordService || canRecordCompliance || canClose || canMarkExpired || canRevoke

  const hasActions = editable || canCidReview || anyFulfilment

  return (
    <div className="sticky bottom-0 z-20 pb-[env(safe-area-inset-bottom)] sm:static sm:pb-0">
      <section aria-label="Your available actions">
        <Card pad="sm" className="space-y-3 backdrop-blur">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Your actions</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {disposition.statusLabel}
              {disposition.responsibleRoleLabel !== '—' ? ` — awaiting ${disposition.responsibleRoleLabel}.` : '.'}
            </p>
          </div>

          {editable && (
            <Block title="As the requesting investigator">
              <Button variant="primary" disabled={busy} onClick={onSubmitToCid}>Submit for CID review</Button>
              <span className="text-xs text-slate-400">Draft — edit in the Request and Supporting sections, then submit.</span>
            </Block>
          )}
          {canCidReview && (
            <Block title="As Bureau Lead">
              <Button variant="primary" disabled={busy} onClick={() => void cidDecide('approve')}>Approve</Button>
              <Button disabled={busy} onClick={() => void cidDecide('deny')}>Deny</Button>
              <Button disabled={busy} onClick={() => void cidDecide('return')}>Return for revision</Button>
            </Block>
          )}
          {anyFulfilment && (
            <Block title="Service & return recording">
              {canIssue && <Button variant="primary" disabled={busy} onClick={() => void issue()}>Record issue</Button>}
              {canExecute && (
                <>
                  <Button variant="primary" disabled={busy} onClick={() => void execute('full')}>Record execution</Button>
                  <Button disabled={busy} onClick={() => void execute('partial')}>Partial execution</Button>
                  <Button disabled={busy} onClick={() => void execute('unable')}>Unable to execute</Button>
                </>
              )}
              {canFileReturn && <Button disabled={busy} onClick={() => void fileReturn()}>File return</Button>}
              {canRecordService && (
                <>
                  <Button variant="primary" disabled={busy} onClick={() => void service('served')}>Record service</Button>
                  <Button disabled={busy} onClick={() => void service('service_attempted')}>Service attempted</Button>
                  <Button disabled={busy} onClick={() => void service('service_failed')}>Service failed</Button>
                </>
              )}
              {canRecordCompliance && (
                <>
                  <Button variant="primary" disabled={busy} onClick={() => void compliance('complete')}>Compliance complete</Button>
                  <Button disabled={busy} onClick={() => void compliance('partial')}>Partial</Button>
                  <Button disabled={busy} onClick={() => void compliance('non_compliant')}>Non-compliance</Button>
                  <Button disabled={busy} onClick={() => void compliance('return_recorded')}>Record return</Button>
                </>
              )}
              {canClose && <Button disabled={busy} onClick={() => void close('closed')}>Close request</Button>}
              {canMarkExpired && <Button disabled={busy} onClick={() => void close('expired')}>Mark expired</Button>}
              {canRevoke && <Button disabled={busy} onClick={() => void close('revoked')}>Revoke</Button>}
            </Block>
          )}

          {!hasActions && (
            awarenessOnly ? (
              <p className="text-xs text-slate-400">
                Visible for bureau awareness — no action is assigned to you.
              </p>
            ) : (
              <p className="text-xs text-slate-400">No actions available for your role at this stage.</p>
            )
          )}
        </Card>
      </section>
    </div>
  )
}
