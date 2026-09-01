'use client'

/** Role decision panel — replaces the old bottom action button-wall with ONE
 *  panel that shows only the current viewer's available primary action(s),
 *  with plain-language context from the deterministic workflow model. Every
 *  predicate here mirrors (never replaces) a server-side authority check, and
 *  every action is the SAME definer RPC as before — a hidden button is
 *  cosmetic, the server revalidates everything. Awareness-only viewers
 *  (bureau prosecutor, not a gate) get a quiet note, never action styling.
 *
 *  Minimal-DOJ revival: the panel adds the prosecutor seat (claim / approve /
 *  return / decline / note on the shared-queue pipeline), the judge seat
 *  (claim; approve with reasoning + conditions + expiry / deny / return), and
 *  AG oversight (assign prosecutor or judge, return-to-queue). A refusal from
 *  the server's conflict detection surfaces verbatim in the RecusalBanner. */
import { useEffect, useState } from 'react'
import { rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { activeProfiles, useProfilesStore } from '@/lib/profiles'
import { type LegalExhibit, type LegalRequest } from '@/lib/justice'
import type { LegalDisposition, LegalViewer } from '@/lib/legalWorkflow'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { uiPrompt } from '@/components/ui/dialog'
import { StickyActionBar } from '@/components/shared/StickyActionBar'
import { JusticePickerModal } from '@/components/doj/JusticePickerModal'
import { RecusalBanner, isRecusalError } from '@/components/doj/RecusalBanner'

type ActFn = (fn: () => Promise<{ error: { message: string } | null }>, okMsg: string) => Promise<void>

type ExecResult = 'full' | 'partial' | 'unable'

/** Warrant-execution capture form. Custody-grade: the server (record_warrant_
 *  execution) REQUIRES a non-blank incident number, ≥1 executing officer that
 *  exists in profiles, and a non-blank outcome for EVERY result — so this form
 *  collects and client-gates all three (the server re-validates regardless).
 *  The recording officer is default-checked; the pool is activeProfiles(). */
function ExecutionModal({
  result, requestNumber, defaultOfficerId, busy, onSubmit, onClose,
}: {
  result: ExecResult
  requestNumber: string
  defaultOfficerId: string
  busy: boolean
  onSubmit: (v: { incident: string; officers: string[]; outcome: string; notes: string }) => void
  onClose: () => void
}) {
  const loaded = useProfilesStore((s) => s.loaded)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [incident, setIncident] = useState('')
  const [officers, setOfficers] = useState<string[]>(defaultOfficerId ? [defaultOfficerId] : [])
  const [outcome, setOutcome] = useState('')
  const [notes, setNotes] = useState('')
  const [query, setQuery] = useState('')

  // Populate the officer pool if the roster isn't cached yet (loaded flips
  // false→true on the first fetch, re-rendering the list once names arrive).
  useEffect(() => { if (!loaded) void fetchProfiles() }, [loaded, fetchProfiles])

  const q = query.trim().toLowerCase()
  const options = activeProfiles().filter((p) => !q
    || (p.display_name ?? '').toLowerCase().includes(q)
    || (p.badge_number ?? '').toLowerCase().includes(q))

  const toggle = (id: string) =>
    setOfficers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])

  const title = result === 'unable' ? 'Unable to execute' : result === 'partial' ? 'Partial execution' : 'Record execution'
  const outcomeLabel = result === 'unable' ? 'Reason the warrant could not be executed' : 'Execution outcome'
  const outcomeHint = result === 'unable' ? undefined : 'e.g. suspect in custody, premises searched.'
  const ready = incident.trim() !== '' && officers.length > 0 && outcome.trim() !== ''
  const dirty = () => incident.trim() !== '' || outcome.trim() !== '' || notes.trim() !== ''

  return (
    <Modal open onClose={onClose} wide dirty={dirty}>
      <div className="p-5">
        <ModalHeader title={title} onClose={onClose} />
        <p className="text-sm text-slate-400">
          Warrant <span className="font-semibold text-slate-200">{requestNumber}</span> — this record is part of the
          custody chain. {result === 'unable'
            ? 'The warrant stays issued and a follow-up task is opened.'
            : 'A warrant-return draft is seeded on submit.'}
        </p>

        <div className="mt-4 space-y-4">
          <Field label="Incident / offense number" required>
            {(id) => (
              <Input id={id} value={incident} onChange={(e) => setIncident(e.target.value)}
                placeholder="e.g. 25-004821" autoComplete="off" />
            )}
          </Field>

          <div>
            <p className="mb-1 block text-xs font-semibold text-slate-400">
              Executing officers<span className="ml-0.5 text-rose-300" aria-hidden>*</span>
              <span className="ml-1.5 font-normal text-slate-500">({officers.length} selected)</span>
            </p>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name or badge…"
              aria-label="Filter executing officers"
              autoComplete="off"
            />
            <ul
              role="group"
              aria-label="Executing officers"
              className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-ink-950/70"
            >
              {options.map((p) => {
                const on = officers.includes(p.id)
                return (
                  <li key={p.id}>
                    <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-white/5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(p.id)}
                        className="h-4 w-4 rounded border-white/20 bg-ink-900 accent-badge-500"
                      />
                      <span className="text-sm font-semibold text-white">{p.display_name || 'Officer'}</span>
                      {p.badge_number && <span className="text-xs text-slate-400">Badge {p.badge_number}</span>}
                    </label>
                  </li>
                )
              })}
              {!options.length && (
                <li className="px-3 py-2.5 text-sm text-slate-400">
                  {loaded ? 'No active officers match.' : 'Loading roster…'}
                </li>
              )}
            </ul>
          </div>

          <Field label={outcomeLabel} hint={outcomeHint} required>
            {(id) => (
              <Textarea id={id} rows={3} value={outcome} onChange={(e) => setOutcome(e.target.value)} />
            )}
          </Field>

          <Field label="Notes" hint="Optional. Log seized property below as inventory.">
            {(id) => (
              <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            )}
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button className="min-h-[44px] sm:min-h-0" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            className="min-h-[44px] sm:min-h-0"
            disabled={busy || !ready}
            onClick={() => onSubmit({ incident: incident.trim(), officers, outcome: outcome.trim(), notes: notes.trim() })}
          >
            {busy ? 'Recording…' : result === 'unable' ? 'Record — unable to execute' : 'Record execution'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Issue capture — replaces the chained free-text uiPrompts (an unparseable
 *  date string used to become Invalid Date silently). datetime-local input +
 *  an explicit validity gate, so an invalid date can never reach the RPC. */
function IssueModal({
  warrant, requestNumber, busy, onSubmit, onClose,
}: {
  warrant: boolean
  requestNumber: string
  busy: boolean
  onSubmit: (v: { when?: string }) => void
  onClose: () => void
}) {
  const [when, setWhen] = useState('')
  const invalid = when !== '' && Number.isNaN(new Date(when).getTime())
  const dirty = () => when !== ''
  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-5">
        <ModalHeader title="Record issue" onClose={onClose} />
        <p className="text-sm text-slate-400">
          {warrant ? 'Warrant' : 'Subpoena'} <span className="font-semibold text-slate-200">{requestNumber}</span> — marks the request issued and active.
        </p>
        <div className="mt-4">
          <Field
            label={warrant ? 'Expiration date/time' : 'Response deadline'}
            hint={warrant ? 'Optional if the Judge set one.' : 'Optional.'}
          >
            {(id) => <Input id={id} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
          </Field>
          {invalid && <p className="mt-1 text-xs text-rose-300">That date/time could not be read — fix or clear it.</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || invalid}
            onClick={() => onSubmit({ when: when ? new Date(when).toISOString() : undefined })}
          >
            {busy ? 'Recording…' : 'Record issue'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

type ServiceStatus = 'served' | 'service_attempted' | 'service_failed'
const SERVICE_TITLE: Record<ServiceStatus, string> = {
  served: 'Record service',
  service_attempted: 'Record service attempt',
  service_failed: 'Record failed service',
}

/** Subpoena-service capture — one form (status pre-set by the button that
 *  opened it) instead of two chained uiPrompts. Both fields stay optional,
 *  matching the RPC's contract exactly. */
function ServiceModal({
  status, requestNumber, busy, onSubmit, onClose,
}: {
  status: ServiceStatus
  requestNumber: string
  busy: boolean
  onSubmit: (v: { method: string; notes: string }) => void
  onClose: () => void
}) {
  const [method, setMethod] = useState('')
  const [notes, setNotes] = useState('')
  const dirty = () => method.trim() !== '' || notes.trim() !== ''
  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-5">
        <ModalHeader title={SERVICE_TITLE[status]} onClose={onClose} />
        <p className="text-sm text-slate-400">
          Subpoena <span className="font-semibold text-slate-200">{requestNumber}</span>.
        </p>
        <div className="mt-4 space-y-4">
          <Field label="Service method" hint="Optional — e.g. in person, registered agent, counsel.">
            {(id) => <Input id={id} value={method} onChange={(e) => setMethod(e.target.value)} autoComplete="off" />}
          </Field>
          <Field label="Notes" hint="Optional.">
            {(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => onSubmit({ method: method.trim(), notes: notes.trim() })}>
            {busy ? 'Recording…' : SERVICE_TITLE[status]}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

type ComplianceStatus = 'complete' | 'partial' | 'non_compliant' | 'return_recorded'
const COMPLIANCE_TITLE: Record<ComplianceStatus, string> = {
  complete: 'Compliance complete',
  partial: 'Partial compliance',
  non_compliant: 'Record non-compliance',
  return_recorded: 'Record return',
}

/** Subpoena-compliance capture — one form (status pre-set by the button that
 *  opened it). The reason field appears — and is required — only for
 *  non-compliance, mirroring the old prompt chain's gate. */
function ComplianceModal({
  status, requestNumber, busy, onSubmit, onClose,
}: {
  status: ComplianceStatus
  requestNumber: string
  busy: boolean
  onSubmit: (v: { reason: string; notes: string }) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const needReason = status === 'non_compliant'
  const ready = !needReason || reason.trim() !== ''
  const dirty = () => reason.trim() !== '' || notes.trim() !== ''
  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-5">
        <ModalHeader title={COMPLIANCE_TITLE[status]} onClose={onClose} />
        <p className="text-sm text-slate-400">
          Subpoena <span className="font-semibold text-slate-200">{requestNumber}</span>.
        </p>
        <div className="mt-4 space-y-4">
          {needReason && (
            <Field label="Non-compliance reason" required>
              {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          )}
          <Field label="Notes" hint="Optional. Received materials must be logged as case evidence/attachments — this record links back to the case.">
            {(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" disabled={busy || !ready} onClick={() => onSubmit({ reason: reason.trim(), notes: notes.trim() })}>
            {busy ? 'Recording…' : COMPLIANCE_TITLE[status]}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

type ProsecutorDecision = 'approve' | 'return' | 'decline' | 'note'
const PROSECUTOR_TITLE: Record<ProsecutorDecision, string> = {
  approve: 'Approve for judicial review',
  return: 'Return to the investigator',
  decline: 'Decline the request',
  note: 'Add review note',
}

/** Prosecutorial decision capture (review_legal_request_as_prosecutor). The
 *  note is required exactly where the server requires it (return needs the
 *  corrections; decline needs the recorded reason; a note action needs the
 *  note); approve/decline may carry a signature bound to the frozen version. */
function ProsecutorDecisionModal({ decision, requestNumber, busy, onSubmit, onClose }: {
  decision: ProsecutorDecision
  requestNumber: string
  busy: boolean
  onSubmit: (v: { note: string; signature: string }) => void
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [signature, setSignature] = useState('')
  const needNote = decision !== 'approve'
  const signs = decision === 'approve' || decision === 'decline'
  const ready = !needNote || note.trim() !== ''
  const noteLabel = decision === 'return' ? 'Required corrections'
    : decision === 'decline' ? 'Reason for declining'
    : decision === 'note' ? 'Review note' : 'Note'
  return (
    <Modal open onClose={onClose} dirty={() => note.trim() !== '' || signature.trim() !== ''}>
      <div className="p-5">
        <ModalHeader title={PROSECUTOR_TITLE[decision]} onClose={onClose} />
        <p className="text-sm text-slate-400">
          Request <span className="font-semibold text-slate-200">{requestNumber}</span>.{' '}
          {decision === 'approve' && 'Approval freezes the reviewed version and hands the request to the judicial queue.'}
          {decision === 'return' && 'The draft reopens for the investigator; a corrected resubmission returns directly to your bureau’s queue (renewed CID review only on a declared material change).'}
          {decision === 'decline' && 'A terminal prosecutorial refusal — the reason stays on record.'}
          {decision === 'note' && 'Recorded in the internal review trail.'}
        </p>
        <div className="mt-4 space-y-4">
          <Field label={noteLabel} required={needNote} hint={needNote ? undefined : 'Optional.'}>
            {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {signs && (
            <Field label="Signature" hint="Optional — type your name to sign this decision.">
              {(id) => <Input id={id} value={signature} onChange={(e) => setSignature(e.target.value)} autoComplete="off" />}
            </Field>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={decision === 'decline' ? 'danger' : 'primary'}
            disabled={busy || !ready}
            onClick={() => onSubmit({ note: note.trim(), signature: signature.trim() })}
          >
            {busy ? 'Recording…' : PROSECUTOR_TITLE[decision]}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

type JudgeDecision = 'approve' | 'deny' | 'return'
const JUDGE_TITLE: Record<JudgeDecision, string> = {
  approve: 'Approve request',
  deny: 'Deny request',
  return: 'Return to the investigator',
}

/** Judicial decision capture (decide_legal_request_as_judge). Reasoning is
 *  required for every outcome (the server refuses without it); approval may
 *  add conditions and an expiry, and issuance stays a CID act afterwards. */
function JudgeDecisionModal({ decision, requestNumber, busy, onSubmit, onClose }: {
  decision: JudgeDecision
  requestNumber: string
  busy: boolean
  onSubmit: (v: { note: string; conditions: string; expires?: string; signature: string }) => void
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [conditions, setConditions] = useState('')
  const [expires, setExpires] = useState('')
  const [signature, setSignature] = useState('')
  const invalidExpiry = expires !== '' && Number.isNaN(new Date(expires).getTime())
  const ready = note.trim() !== '' && !invalidExpiry
  return (
    <Modal open onClose={onClose} dirty={() => note.trim() !== '' || conditions.trim() !== '' || expires !== ''}>
      <div className="p-5">
        <ModalHeader title={JUDGE_TITLE[decision]} onClose={onClose} />
        <p className="text-sm text-slate-400">
          Request <span className="font-semibold text-slate-200">{requestNumber}</span>.{' '}
          {decision === 'approve'
            ? 'Approval freezes the official issued-basis version; issuance itself remains a CID fulfilment act.'
            : decision === 'deny'
              ? 'A judicial denial with the reasoning on record.'
              : 'The draft reopens for the investigator with your reasoning attached.'}
        </p>
        <div className="mt-4 space-y-4">
          <Field label="Reasoning" required>
            {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
          {decision === 'approve' && (
            <>
              <Field label="Conditions" hint="Optional — recorded as judicial conditions on the approval.">
                {(id) => <Textarea id={id} rows={2} value={conditions} onChange={(e) => setConditions(e.target.value)} />}
              </Field>
              <Field label="Expiry" hint="Optional — when the authorization lapses.">
                {(id) => <Input id={id} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />}
              </Field>
              {invalidExpiry && <p className="text-xs text-rose-300">That date/time could not be read — fix or clear it.</p>}
            </>
          )}
          <Field label="Signature" hint="Optional — type your name to sign this decision.">
            {(id) => <Input id={id} value={signature} onChange={(e) => setSignature(e.target.value)} autoComplete="off" />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={decision === 'deny' ? 'danger' : 'primary'}
            disabled={busy || !ready}
            onClick={() => onSubmit({
              note: note.trim(), conditions: conditions.trim(),
              expires: expires ? new Date(expires).toISOString() : undefined,
              signature: signature.trim(),
            })}
          >
            {busy ? 'Recording…' : JUDGE_TITLE[decision]}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** One labelled action group: who you're acting as, then the controls. */
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-white">{title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export function DecisionPanel({
  r, busy, act, promptSig, exhibits,
  editable, canCidReview, canSiuCommandReview, cidActive, viewer,
  awarenessOnly, disposition, now, onSubmitToCid,
}: {
  r: LegalRequest
  busy: boolean
  act: ActFn
  promptSig: () => Promise<string | null>
  exhibits: LegalExhibit[]
  editable: boolean
  canCidReview: boolean
  /** The SIB lane's first approval. Same RPC as the CID one — the server
   *  branches on the case's authority — but a different person and different
   *  wording, because "As Bureau Lead" on an SIB warrant names somebody with
   *  no authority over it. */
  canSiuCommandReview: boolean
  cidActive: boolean
  /** The workflow model's viewer (effective justice role included). */
  viewer: LegalViewer
  awarenessOnly: boolean
  disposition: LegalDisposition
  now: number
  onSubmitToCid: () => void
}) {
  const { profile } = useAuth()
  // The execution capture form is a modal, opened pre-set to a result variant
  // by the three record buttons (null = closed). Issue/service/compliance use
  // the same pattern: their buttons open a modal pre-set to the status.
  const [execResult, setExecResult] = useState<ExecResult | null>(null)
  const [issueOpen, setIssueOpen] = useState(false)
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus | null>(null)
  const [complianceStatus, setComplianceStatus] = useState<ComplianceStatus | null>(null)
  // DOJ seats: decision modals (pre-set like the fulfilment ones), the AG
  // assignment picker, and the verbatim conflict banner.
  const [prosDecision, setProsDecision] = useState<ProsecutorDecision | null>(null)
  const [judgeDecision, setJudgeDecision] = useState<JudgeDecision | null>(null)
  const [assignSeat, setAssignSeat] = useState<'prosecutor' | 'judge' | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)

  /** Same contract as `act`, but a conflict/recusal refusal also raises the
   *  banner with the server message verbatim. */
  const dojAct = (fn: () => Promise<{ error: { message: string } | null }>, okMsg: string) =>
    act(async () => {
      const res = await fn()
      if (res.error && isRecusalError(res.error.message)) setConflict(res.error.message)
      else if (!res.error) setConflict(null)
      return res
    }, okMsg)
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

  /* ── DOJ handlers (minimal-DOJ revival — all definer RPCs) ───────────────── */
  // Claim from the shared queue (atomic FOR UPDATE claim server-side).
  const claimAsProsecutor = () =>
    dojAct(() => rpc('legal_claim_prosecutor', { p_request: r.id }), 'Claimed — the request is yours to review.')
  const claimAsJudge = () =>
    dojAct(() => rpc('claim_legal_request_as_judge', { p_request: r.id }), 'Claimed for judicial review.')

  // Prosecutorial decision. Capacity passthrough: dual CID+DOJ members must
  // state an acting capacity — if the server raises it, retry acting as DOJ
  // (this panel IS the DOJ seat).
  const submitProsecutorDecision = async (decision: ProsecutorDecision, v: { note: string; signature: string }) => {
    await dojAct(async () => {
      const call = (cap?: string) => rpc('review_legal_request_as_prosecutor', {
        p_request: r.id, p_decision: decision,
        p_note: v.note || undefined, p_signature: v.signature || undefined,
        ...(cap ? { p_capacity: cap } : {}),
      })
      let res = await call()
      if (res.error && /acting capacity/i.test(res.error.message)) res = await call('doj')
      return res
    }, decision === 'approve' ? 'Approved — handed to the judicial queue.'
      : decision === 'return' ? 'Returned to the investigator.'
      : decision === 'decline' ? 'Declined — the reason is on record.'
      : 'Review note recorded.')
    setProsDecision(null)
  }

  // The holding prosecutor steps back to the shared queue.
  const returnToQueue = async () => {
    const reason = await uiPrompt('Reason for returning this to the shared queue (optional).', { title: 'Return to queue' })
    if (reason === null) return
    await dojAct(
      () => rpc('legal_return_to_prosecutor_queue', { p_request: r.id, p_reason: reason || undefined }),
      'Returned to the prosecutor queue.',
    )
  }

  // Judicial decision — reasoning required for every outcome.
  const submitJudgeDecision = async (decision: JudgeDecision, v: { note: string; conditions: string; expires?: string; signature: string }) => {
    await dojAct(() => rpc('decide_legal_request_as_judge', {
      p_request: r.id, p_decision: decision, p_note: v.note,
      p_conditions: decision === 'approve' ? (v.conditions || undefined) : undefined,
      p_expires_at: decision === 'approve' ? v.expires : undefined,
      p_signature: v.signature || undefined,
    }), decision === 'approve' ? 'Approved — ready for CID issuance.'
      : decision === 'deny' ? 'Denied.' : 'Returned to the investigator.')
    setJudgeDecision(null)
  }

  // AG assignment (the only path for sealed requests).
  const submitAssign = async (v: { userId: string; reason: string }) => {
    if (assignSeat === 'prosecutor') {
      await dojAct(
        () => rpc('legal_assign_prosecutor', { p_request: r.id, p_prosecutor: v.userId, p_reason: v.reason || undefined }),
        'Prosecutor assigned.',
      )
    } else if (assignSeat === 'judge') {
      await dojAct(() => rpc('assign_judge', { p_request: r.id, p_judge: v.userId }), 'Judge assigned.')
    }
    setAssignSeat(null)
  }

  /* ── Fulfilment handlers: issue / execute / return / service / compliance ── */
  const approvedUnissued = r.review_status === 'approved' && r.fulfilment_status === 'unissued'
  const warrant = r.request_type === 'warrant'

  // The IssueModal validates the datetime-local value before this runs, so
  // `when` is always a well-formed ISO string (or absent).
  const submitIssue = async (v: { when?: string }) => {
    await act(() => rpc('issue_legal_request', {
      p_request: r.id,
      p_expires_at: warrant ? v.when : undefined,
      p_response_deadline: warrant ? undefined : v.when,
    }), 'Issued.')
    setIssueOpen(false)
  }
  // Custody-grade execution capture lives in ExecutionModal: an incident
  // number, ≥1 executing officer (multi-select, defaulted to the recorder) and
  // an outcome are required for EVERY result. This just runs the RPC with the
  // form's values, then closes the modal.
  const submitExecution = async (result: ExecResult, v: { incident: string; officers: string[]; outcome: string; notes: string }) => {
    await act(
      () => rpc('record_warrant_execution', {
        p_request: r.id, p_incident_number: v.incident, p_officers: v.officers, p_outcome: v.outcome,
        p_notes: v.notes || undefined, p_result: result,
      }),
      result === 'unable' ? 'Recorded — the warrant remains issued.' : 'Execution recorded.',
    )
    setExecResult(null)
  }
  const fileReturn = async () => {
    const narrative = await uiPrompt('Return narrative (required).', { title: 'File return' })
    if (!narrative?.trim()) return
    await act(() => rpc('record_warrant_return', { p_request: r.id, p_narrative: narrative }), 'Return filed.')
  }
  const submitService = async (statusValue: ServiceStatus, v: { method: string; notes: string }) => {
    await act(() => rpc('record_subpoena_service', { p_request: r.id, p_status: statusValue, p_method: v.method || undefined, p_notes: v.notes || undefined }), 'Service recorded.')
    setServiceStatus(null)
  }
  // The ComplianceModal requires the reason exactly when the status is
  // non_compliant, so `reason` is non-blank whenever the RPC needs it.
  const submitCompliance = async (statusValue: ComplianceStatus, v: { reason: string; notes: string }) => {
    await act(() => rpc('record_subpoena_compliance', { p_request: r.id, p_status: statusValue, p_notes: v.notes || undefined, p_non_compliance_reason: v.reason || undefined }), 'Compliance recorded.')
    setComplianceStatus(null)
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

  /* ── DOJ seat visibility (mirrors — the RPCs re-check everything) ────────── */
  const me = viewer.myId
  const status = r.review_status
  const sealed = r.classification === 'sealed'
  const isAG = viewer.justiceRole === 'attorney_general' || viewer.isOwner
  const canClaimProsecutor = viewer.justiceRole === 'prosecutor'
    && status === 'prosecutor_queue' && !sealed && r.created_by !== me
  const isAssignedProsecutor = !!me && status === 'prosecutor_review' && r.assigned_prosecutor_id === me
  const canClaimJudge = viewer.justiceRole === 'judge'
    && status === 'submitted_to_judge' && !sealed && !r.assigned_judge_id && r.created_by !== me
  const isAssignedJudge = !!me && status === 'judicial_review' && r.assigned_judge_id === me
  const agAssignProsecutor = isAG && ['prosecutor_queue', 'prosecutor_review'].includes(status)
  const agAssignJudge = isAG && status === 'submitted_to_judge'
  const agReturnToQueue = isAG && status === 'prosecutor_review'
  const anyDoj = canClaimProsecutor || isAssignedProsecutor || canClaimJudge || isAssignedJudge
    || agAssignProsecutor || agAssignJudge

  const hasActions = editable || canCidReview || canSiuCommandReview || anyFulfilment || anyDoj

  return (
    // Phones: pinned above the BottomNav via the shared StickyActionBar
    // geometry (safe-area handled there); static in the sm+ column layout.
    <StickyActionBar className="sm:static">
      <section aria-label="Your available actions">
        <Card pad="sm" className="space-y-3 backdrop-blur">
          <div>
            <h2 className="text-[13px] font-semibold text-white">Your actions</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {disposition.statusLabel}
              {disposition.responsibleRoleLabel !== '—' ? ` — awaiting ${disposition.responsibleRoleLabel}.` : '.'}
            </p>
          </div>

          {conflict && <RecusalBanner message={conflict} onDismiss={() => setConflict(null)} />}

          {editable && (
            <Block title="As the requesting investigator">
              <Button variant="primary" disabled={busy} onClick={onSubmitToCid}>
                {['returned_by_judge', 'returned_by_prosecutor'].includes(r.review_status)
                  ? 'Resubmit for review'
                  : 'Submit for CID review'}
              </Button>
              <span className="text-xs text-slate-400">
                {['returned_by_judge', 'returned_by_prosecutor'].includes(r.review_status)
                  ? 'Corrected requests return directly to the prosecutor — a declared material change re-enters CID review.'
                  : 'Draft — edit in the Request and Supporting sections, then submit.'}
              </span>
            </Block>
          )}
          {canCidReview && (
            <Block title="As Bureau Lead">
              <Button variant="primary" disabled={busy} onClick={() => void cidDecide('approve')}>Approve</Button>
              <Button disabled={busy} onClick={() => void cidDecide('deny')}>Deny</Button>
              <Button disabled={busy} onClick={() => void cidDecide('return')}>Return for revision</Button>
            </Block>
          )}
          {canSiuCommandReview && (
            <Block title="As SIB command">
              <Button variant="primary" disabled={busy} onClick={() => void cidDecide('approve')}>Approve</Button>
              <Button disabled={busy} onClick={() => void cidDecide('deny')}>Deny</Button>
              <Button disabled={busy} onClick={() => void cidDecide('return')}>Return for revision</Button>
              <span className="text-xs text-slate-400">
                Approval sends this to the Attorney General — not to a CID prosecutor queue.
              </span>
            </Block>
          )}
          {canClaimProsecutor && (
            <Block title="As Prosecutor">
              <Button variant="primary" disabled={busy} onClick={() => void claimAsProsecutor()}>Claim from the queue</Button>
              <span className="text-xs text-slate-400">Claiming is atomic — the request becomes yours to review.</span>
            </Block>
          )}
          {isAssignedProsecutor && (
            <Block title="As the assigned Prosecutor">
              <Button variant="primary" disabled={busy} onClick={() => setProsDecision('approve')}>Approve for judicial review</Button>
              <Button disabled={busy} onClick={() => setProsDecision('return')}>Return for corrections</Button>
              <Button disabled={busy} onClick={() => setProsDecision('decline')}>Decline</Button>
              <Button disabled={busy} onClick={() => setProsDecision('note')}>Add review note</Button>
              <Button variant="ghost" disabled={busy} onClick={() => void returnToQueue()}>Return to queue…</Button>
            </Block>
          )}
          {canClaimJudge && (
            <Block title="As Judge">
              <Button variant="primary" disabled={busy} onClick={() => void claimAsJudge()}>Claim for judicial review</Button>
            </Block>
          )}
          {isAssignedJudge && (
            <Block title="As the assigned Judge">
              <Button variant="primary" disabled={busy} onClick={() => setJudgeDecision('approve')}>Approve…</Button>
              <Button disabled={busy} onClick={() => setJudgeDecision('deny')}>Deny…</Button>
              <Button disabled={busy} onClick={() => setJudgeDecision('return')}>Return…</Button>
              <span className="text-xs text-slate-400">Every judicial decision requires recorded reasoning.</span>
            </Block>
          )}
          {(agAssignProsecutor || agAssignJudge) && (
            <Block title="As Attorney General">
              {agAssignProsecutor && (
                <Button variant={sealed ? 'primary' : 'secondary'} disabled={busy} onClick={() => setAssignSeat('prosecutor')}>
                  {r.assigned_prosecutor_id ? 'Reassign prosecutor…' : 'Assign prosecutor…'}
                </Button>
              )}
              {agAssignJudge && (
                <Button variant={sealed ? 'primary' : 'secondary'} disabled={busy} onClick={() => setAssignSeat('judge')}>
                  Assign judge…
                </Button>
              )}
              {agReturnToQueue && (
                <Button variant="ghost" disabled={busy} onClick={() => void returnToQueue()}>Return to queue…</Button>
              )}
              {sealed && (
                <span className="text-xs text-slate-400">Sealed — formal assignment is the only path forward.</span>
              )}
            </Block>
          )}
          {anyFulfilment && (
            <Block title="Service & return recording">
              {canIssue && <Button variant="primary" disabled={busy} onClick={() => setIssueOpen(true)}>Record issue</Button>}
              {canExecute && (
                <>
                  <Button variant="primary" disabled={busy} onClick={() => setExecResult('full')}>Record execution</Button>
                  <Button disabled={busy} onClick={() => setExecResult('partial')}>Partial execution</Button>
                  <Button disabled={busy} onClick={() => setExecResult('unable')}>Unable to execute</Button>
                </>
              )}
              {canFileReturn && <Button disabled={busy} onClick={() => void fileReturn()}>File return</Button>}
              {canRecordService && (
                <>
                  <Button variant="primary" disabled={busy} onClick={() => setServiceStatus('served')}>Record service</Button>
                  <Button disabled={busy} onClick={() => setServiceStatus('service_attempted')}>Service attempted</Button>
                  <Button disabled={busy} onClick={() => setServiceStatus('service_failed')}>Service failed</Button>
                </>
              )}
              {canRecordCompliance && (
                <>
                  <Button variant="primary" disabled={busy} onClick={() => setComplianceStatus('complete')}>Compliance complete</Button>
                  <Button disabled={busy} onClick={() => setComplianceStatus('partial')}>Partial</Button>
                  <Button disabled={busy} onClick={() => setComplianceStatus('non_compliant')}>Non-compliance</Button>
                  <Button disabled={busy} onClick={() => setComplianceStatus('return_recorded')}>Record return</Button>
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

      {execResult && profile?.id && (
        <ExecutionModal
          result={execResult}
          requestNumber={r.request_number}
          defaultOfficerId={profile.id}
          busy={busy}
          onClose={() => setExecResult(null)}
          onSubmit={(v) => void submitExecution(execResult, v)}
        />
      )}
      {issueOpen && (
        <IssueModal
          warrant={warrant}
          requestNumber={r.request_number}
          busy={busy}
          onClose={() => setIssueOpen(false)}
          onSubmit={(v) => void submitIssue(v)}
        />
      )}
      {serviceStatus && (
        <ServiceModal
          status={serviceStatus}
          requestNumber={r.request_number}
          busy={busy}
          onClose={() => setServiceStatus(null)}
          onSubmit={(v) => void submitService(serviceStatus, v)}
        />
      )}
      {complianceStatus && (
        <ComplianceModal
          status={complianceStatus}
          requestNumber={r.request_number}
          busy={busy}
          onClose={() => setComplianceStatus(null)}
          onSubmit={(v) => void submitCompliance(complianceStatus, v)}
        />
      )}
      {prosDecision && (
        <ProsecutorDecisionModal
          decision={prosDecision}
          requestNumber={r.request_number}
          busy={busy}
          onClose={() => setProsDecision(null)}
          onSubmit={(v) => void submitProsecutorDecision(prosDecision, v)}
        />
      )}
      {judgeDecision && (
        <JudgeDecisionModal
          decision={judgeDecision}
          requestNumber={r.request_number}
          busy={busy}
          onClose={() => setJudgeDecision(null)}
          onSubmit={(v) => void submitJudgeDecision(judgeDecision, v)}
        />
      )}
      {assignSeat && (
        <JusticePickerModal
          seat={assignSeat}
          title={assignSeat === 'prosecutor' ? `Assign a prosecutor — ${r.request_number}` : `Assign a judge — ${r.request_number}`}
          hint={sealed
            ? 'Sealed request — formal assignment is the only path to the bench.'
            : 'Formal assignment. Conflicted members are refused server-side.'}
          reasonMode={assignSeat === 'judge' ? 'none' : r.assigned_prosecutor_id ? 'required' : 'optional'}
          busy={busy}
          excludeIds={[r.created_by, r.assigned_prosecutor_id ?? ''].filter(Boolean)}
          onSubmit={(v) => void submitAssign(v)}
          onClose={() => setAssignSeat(null)}
        />
      )}
    </StickyActionBar>
  )
}
