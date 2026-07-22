'use client'

/** Role decision panel — replaces the old bottom action button-wall with ONE
 *  panel that shows only the current viewer's available primary action(s),
 *  with plain-language context from the deterministic workflow model. Every
 *  predicate here mirrors (never replaces) a server-side authority check, and
 *  every action is the SAME definer RPC as before — a hidden button is
 *  cosmetic, the server revalidates everything. Awareness-only viewers
 *  (bureau prosecutor, not a gate) get a quiet note, never action styling. */
import { rpc } from '@/lib/db'
import { justiceRoleLabel, type LegalExhibit, type LegalRequest } from '@/lib/justice'
import type { LegalDisposition } from '@/lib/legalWorkflow'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { Select } from '@/components/ui/Field'
import type { JusticeDirEntry } from '../legalShared'

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
  r, status, busy, act, promptSig, exhibits, prosecutors, judges,
  editable, canCidReview, canManage, adaActing, daActing, agActing,
  canAssignJudge, judgeActing, canJudgeClaim, cidActive, judgeSelf,
  awarenessOnly, disposition, now, onSubmitToCid,
}: {
  r: LegalRequest
  status: string
  busy: boolean
  act: ActFn
  promptSig: () => Promise<string | null>
  exhibits: LegalExhibit[]
  prosecutors: JusticeDirEntry[]
  judges: JusticeDirEntry[]
  editable: boolean
  canCidReview: boolean
  canManage: boolean
  adaActing: boolean
  daActing: boolean
  agActing: boolean
  canAssignJudge: boolean
  judgeActing: boolean
  canJudgeClaim: boolean
  cidActive: boolean
  judgeSelf: boolean
  awarenessOnly: boolean
  disposition: LegalDisposition
  now: number
  onSubmitToCid: () => void
}) {
  /* ── Review / assignment / decision handlers (RPC wiring unchanged) ─────── */
  const cidDecide = async (decision: 'approve' | 'return') => {
    if (decision === 'return') {
      const note = await uiPrompt('Return note for the investigator (required).', { title: 'Return for revision' })
      if (!note?.trim()) return
      await act(() => rpc('review_legal_request_as_cid', { p_request: r.id, p_decision: 'return', p_note: note }), 'Returned to the investigator.')
      return
    }
    let override: string | null = null
    if (exhibits.length === 0) {
      override = await uiPrompt('No supporting items are selected. Record an override reason to submit anyway.', { title: 'Packet override' })
      if (!override?.trim()) return
    }
    const sig = await promptSig()
    if (sig === null) return
    await act(() => rpc('review_legal_request_as_cid', {
      p_request: r.id, p_decision: 'approve', p_override_reason: override ?? undefined, p_signature: sig || undefined,
    }), 'Approved — submitted to DOJ.')
  }

  const assignAda = async (adaId: string) => {
    const target = prosecutors.find((p) => p.user_id === adaId)
    if (!target) return
    const reason = await uiPrompt(`Assignment note / override reason (required for cross-bureau or missing-coverage assignment).`, {
      title: `Assign to ${target.display_name}`,
    })
    if (reason === null) return
    await act(() => (status === 'submitted_to_doj'
      ? rpc('submit_legal_request_to_doj', { p_request: r.id, p_ada: adaId, p_reason: reason || undefined })
      : rpc('reassign_legal_ada', { p_request: r.id, p_new_ada: adaId, p_reason: reason || undefined })),
      'Prosecutor assigned.')
  }

  const adaDecide = async (decision: 'return' | 'submit_to_judge' | 'submit_to_da' | 'submit_to_ag' | 'note') => {
    const noteLabel = decision === 'return' ? 'Return note for CID (required).'
      : decision === 'note' ? 'Internal prosecutor note (not visible to CID).' : 'Optional note.'
    const note = await uiPrompt(noteLabel, { title: 'ADA review' })
    if (note === null) return
    if ((decision === 'return' || decision === 'note') && !note.trim()) return
    let sig: string | null = ''
    if (decision.startsWith('submit')) { sig = await promptSig(); if (sig === null) return }
    await act(() => rpc('review_legal_request_as_ada', {
      p_request: r.id, p_decision: decision, p_note: note || undefined, p_signature: sig || undefined,
    }), 'Recorded.')
  }

  const daAgDecide = async (who: 'da' | 'ag', decision: string) => {
    const needNote = decision === 'return' || decision === 'deny'
    const note = await uiPrompt(needNote ? 'Note (required).' : 'Optional note.', { title: who.toUpperCase() + ' review' })
    if (note === null || (needNote && !note.trim())) return
    let sig: string | null = ''
    if (decision === 'approve' || decision === 'deny') { sig = await promptSig(); if (sig === null) return }
    const fn = who === 'da' ? 'review_legal_request_as_da' : 'review_legal_request_as_ag'
    await act(() => rpc(fn, { p_request: r.id, p_decision: decision, p_note: note || undefined, p_signature: sig || undefined }), 'Recorded.')
  }

  const assignJudgeTo = async (judgeId: string) => {
    const j = judges.find((x) => x.user_id === judgeId)
    if (!j) return
    if (!(await uiConfirm(`Assign ${j.display_name} for judicial review?`, { title: 'Assign Judge' }))) return
    await act(() => rpc('assign_judge', { p_request: r.id, p_judge: judgeId }), 'Judge assigned.')
  }

  const judgeClaim = async () => {
    const ok = await uiConfirm(
      'Take this request for judicial review? It moves to your queue immediately — the prosecution is notified but not required to act first.',
      { title: 'Take for judicial review', confirmText: 'Take it' },
    )
    if (!ok) return
    await act(() => rpc('claim_legal_request_as_judge', { p_request: r.id }), 'Taken for judicial review.')
  }

  const judgeDecide = async (decision: 'approve' | 'deny' | 'return') => {
    const needNote = decision !== 'approve'
    const note = await uiPrompt(needNote ? 'Decision note (required).' : 'Decision note (optional).', { title: 'Judicial decision' })
    if (note === null || (needNote && !note.trim())) return
    let conditions: string | null = null
    let expires: string | null = null
    if (decision === 'approve') {
      conditions = await uiPrompt('Conditions (optional).', { title: 'Judicial conditions' })
      if (conditions === null) return
      expires = await uiPrompt('Expiration date/time (optional, e.g. 2026-07-21 18:00).', { title: 'Expiration' })
      if (expires === null) return
    }
    const sig = await promptSig()
    if (sig === null) return
    const expMs = expires?.trim() ? Date.parse(expires.trim()) : Number.NaN
    const expIso = Number.isFinite(expMs) ? new Date(expMs).toISOString() : undefined
    if (expires?.trim() && !expIso) { toast('Could not parse that expiration date.', 'warn'); return }
    await act(() => rpc('decide_legal_request_as_judge', {
      p_request: r.id, p_decision: decision, p_note: note || undefined,
      p_conditions: conditions || undefined, p_expires_at: expIso, p_signature: sig || undefined,
    }), 'Judicial decision recorded.')
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
  const showAssignAda = canManage && ['submitted_to_doj', 'ada_review', 'returned_by_ada'].includes(status) && prosecutors.length > 0
  const canIssue = cidActive && approvedUnissued
  const canExecute = cidActive && warrant && r.fulfilment_status === 'issued'
  const canFileReturn = cidActive && warrant && ['executed', 'expired', 'revoked'].includes(r.fulfilment_status)
  const canRecordService = cidActive && !warrant && ['issued', 'served'].includes(r.fulfilment_status)
  const canRecordCompliance = cidActive && !warrant && ['compliance_pending', 'records_received', 'testimony_completed', 'non_compliance'].includes(r.fulfilment_status)
  const canClose = (cidActive || canManage) && r.fulfilment_status !== 'closed' && ['approved', 'denied', 'withdrawn'].includes(r.review_status)
  const canMarkExpired = (cidActive || canManage) && !!r.expires_at && Date.parse(r.expires_at) < now && !['expired', 'closed'].includes(r.fulfilment_status)
  const canRevoke = (canManage || judgeSelf) && ['issued', 'executed'].includes(r.fulfilment_status)
  const anyFulfilment = canIssue || canExecute || canFileReturn || canRecordService || canRecordCompliance || canClose || canMarkExpired || canRevoke

  const hasActions = editable || canCidReview || showAssignAda || adaActing || daActing || agActing
    || canAssignJudge || canJudgeClaim || judgeActing || anyFulfilment

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
            <Block title="As CID supervisor">
              <Button variant="primary" disabled={busy} onClick={() => void cidDecide('approve')}>Approve → submit to DOJ</Button>
              <Button disabled={busy} onClick={() => void cidDecide('return')}>Return for revision</Button>
            </Block>
          )}
          {showAssignAda && (
            <Block title="DOJ assignment">
              <label className="flex items-center gap-2 text-xs text-slate-400">
                {status === 'submitted_to_doj' ? 'Assign prosecutor:' : 'Reassign prosecutor:'}
                <Select value="" onChange={(e) => { if (e.target.value) void assignAda(e.target.value) }}>
                  <option value="">Choose…</option>
                  {prosecutors.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name} ({justiceRoleLabel(p.justice_role)})</option>)}
                </Select>
              </label>
            </Block>
          )}
          {adaActing && (
            <Block title="As the assigned ADA">
              {r.approval_route === 'judge' && <Button variant="primary" disabled={busy} onClick={() => void adaDecide('submit_to_judge')}>Submit to Judge</Button>}
              {(r.approval_route === 'da' || r.approval_route === 'ag') && <Button variant="primary" disabled={busy} onClick={() => void adaDecide('submit_to_da')}>Submit to DA</Button>}
              {r.approval_route === 'ag' && <Button disabled={busy} onClick={() => void adaDecide('submit_to_ag')}>Submit to AG</Button>}
              <Button disabled={busy} onClick={() => void adaDecide('return')}>Return to CID</Button>
              <Button disabled={busy} onClick={() => void adaDecide('note')}>Add internal note</Button>
            </Block>
          )}
          {daActing && (
            <Block title="As District Attorney">
              {r.approval_route === 'da' && (
                <>
                  <Button variant="primary" disabled={busy} onClick={() => void daAgDecide('da', 'approve')}>Approve</Button>
                  <Button disabled={busy} onClick={() => void daAgDecide('da', 'deny')}>Deny</Button>
                </>
              )}
              {r.approval_route === 'ag' && <Button variant="primary" disabled={busy} onClick={() => void daAgDecide('da', 'forward_to_ag')}>Forward to AG</Button>}
              {r.approval_route === 'judge' && <Button variant="primary" disabled={busy} onClick={() => void daAgDecide('da', 'forward_to_judge')}>Forward to Judge</Button>}
              <Button disabled={busy} onClick={() => void daAgDecide('da', 'return')}>Return to CID</Button>
            </Block>
          )}
          {agActing && (
            <Block title="As Attorney General">
              {r.approval_route === 'ag' && (
                <>
                  <Button variant="primary" disabled={busy} onClick={() => void daAgDecide('ag', 'approve')}>Approve</Button>
                  <Button disabled={busy} onClick={() => void daAgDecide('ag', 'deny')}>Deny</Button>
                </>
              )}
              {r.approval_route === 'judge' && <Button variant="primary" disabled={busy} onClick={() => void daAgDecide('ag', 'forward_to_judge')}>Forward to Judge</Button>}
              <Button disabled={busy} onClick={() => void daAgDecide('ag', 'return')}>Return to CID</Button>
            </Block>
          )}
          {canAssignJudge && judges.length > 0 && (
            <Block title="Judicial assignment">
              <label className="flex items-center gap-2 text-xs text-slate-400">
                Assign Judge:
                <Select value="" onChange={(e) => { if (e.target.value) void assignJudgeTo(e.target.value) }}>
                  <option value="">Choose…</option>
                  {judges.map((j) => <option key={j.user_id} value={j.user_id}>{j.display_name}</option>)}
                </Select>
              </label>
            </Block>
          )}
          {canAssignJudge && judges.length === 0 && (
            <p className="text-xs text-amber-300">No active Judges are available for assignment.</p>
          )}
          {canJudgeClaim && (
            <Block title="As a Judge — parallel lane">
              <Button variant="primary" disabled={busy} onClick={() => void judgeClaim()}>Take for judicial review</Button>
            </Block>
          )}
          {judgeActing && (
            <Block title="As the assigned Judge">
              <Button variant="primary" disabled={busy} onClick={() => void judgeDecide('approve')}>Approve warrant/subpoena</Button>
              <Button disabled={busy} onClick={() => void judgeDecide('deny')}>Deny</Button>
              <Button disabled={busy} onClick={() => void judgeDecide('return')}>Return for revision</Button>
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
