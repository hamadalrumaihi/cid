'use client'

/** §14 — assuming and releasing SIU control of a case, plus the §15 export
 *  control on an SIU investigation.
 *
 *  Renders nothing without SIU command standing, so an ordinary CID member
 *  never sees a control they cannot use, and — more importantly — a case that
 *  SIU has never touched is visually identical to any other case.
 *
 *  Nothing here is the security boundary. `siu_assume_control` and
 *  `siu_release_control` both re-check authority server-side, and the two
 *  authority columns are frozen against every direct write by
 *  `private.block_direct_siu_case_cols()`. */

import { useState } from 'react'
import { rpc } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import {
  SIU_CASE_CATEGORIES, SIU_CLASSIFICATIONS, SIU_CLASSIFICATION_HINT,
  SIU_CLOSURE_REASONS, SIU_STAGE_HINT, isPreliminaryInquiry, siuCaseCategoryLabel,
  siuClassificationLabel, siuClosureReasonLabel, siuStageLabel, siuStageTint,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { uiPrompt } from '@/components/ui/dialog'
import { SiuExportPanel } from '@/components/siu/SiuTradecraft'
import type { CaseRow } from './tabs/shared'

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function SiuControlBar({ caseRow, onChanged }: { caseRow: CaseRow; onChanged: () => void }) {
  const siu = useSiu()
  const [taking, setTaking] = useState(false)

  const isSiu = caseRow.case_authority === 'siu'
  const wasAssumed = !!caseRow.siu_assumed_at

  // Command only. Oversight standing (the Director, the AG) deliberately gets
  // no takeover control: taking a CID case is an operational decision.
  if (!siu.isCommand) return null

  const release = async () => {
    const reason = await uiPrompt(
      'The case returns to CID with its bureau, lead detective and full history intact. CID members regain access immediately.',
      { title: 'Return control to CID', placeholder: 'Reason', confirmText: 'Return to CID' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_release_control', { p_case: caseRow.id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Control returned to CID.', 'success')
    onChanged()
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.03] px-4 py-2.5">
      <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">SIU Command</span>

      {!isSiu && (
        <>
          <span className="text-xs text-slate-300">
            This is a CID case. SIU can assume control of it without moving, copying or renumbering anything.
          </span>
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => setTaking(true)}>
            Assume SIU control
          </Button>
        </>
      )}

      {isSiu && wasAssumed && (
        <>
          <span className="text-xs text-slate-300">
            Assumed from CID {fmtDate(caseRow.siu_assumed_at)}
            {caseRow.siu_assumption_reason ? ` — ${caseRow.siu_assumption_reason}` : ''}
          </span>
          <Button size="sm" className="ml-auto" onClick={() => void release()}>Return control to CID</Button>
        </>
      )}

      {isSiu && !wasAssumed && (
        <span className="text-xs text-slate-400">
          Opened by SIU. A natively-SIU investigation is never handed to CID wholesale — release a
          specific item instead.
        </span>
      )}

      {isSiu && <div className="w-full"><SiuExportPanel caseId={caseRow.id} /></div>}

      {taking && (
        <AssumeModal
          caseRow={caseRow}
          onClose={() => setTaking(false)}
          onDone={() => { setTaking(false); onChanged() }}
        />
      )}
    </div>
  )
}

/** §15/§17/§32/§33 — stage, category, closure and recusal on an SIU
 *  investigation.
 *
 *  Separate from SiuControlBar because the audiences differ. Promotion,
 *  category and closure are command acts. DECLARING A CONFLICT is not: it is
 *  available to anyone who can see the file, deliberately including oversight,
 *  because the person most in need of a way to step back is often the most
 *  senior one in the room. `siu_declare_conflict()` gates on
 *  `private.siu_case_read()` for exactly that reason.
 *
 *  Declaring is one-way from this screen. The recusal takes effect in the same
 *  transaction — `private.siu_recused()` vetoes access above every grant, rank
 *  and owner included — and only a DIFFERENT member of command can lift it,
 *  from the Intake screen. */
export function SiuCaseLifecycle({ caseRow, onChanged }: { caseRow: CaseRow; onChanged: () => void }) {
  const siu = useSiu()
  const [closing, setClosing] = useState(false)

  if (caseRow.case_authority !== 'siu' || !siu.canAccess) return null

  const inquiry = isPreliminaryInquiry(caseRow)
  const closed = caseRow.status === 'closed'

  const promote = async () => {
    const reason = await uiPrompt(
      'The inquiry becomes a full investigation. From that moment it is visible to oversight — the Director of CID and the Attorney General — at standard classification. This cannot be undone.',
      { title: 'Promote to full investigation', placeholder: 'Reason', confirmText: 'Promote' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_promote_inquiry', { p_case: caseRow.id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Promoted to a full investigation.', 'success')
    onChanged()
  }

  const setCategory = async (value: string) => {
    const res = await rpc('siu_set_case_category', { p_case: caseRow.id, p_category: value })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Category updated.', 'success')
    onChanged()
  }

  const declareConflict = async () => {
    const reason = await uiPrompt(
      'Your access to this investigation ends immediately — reading and writing both, whatever your rank. Only another member of command can restore it. The declaration itself is kept: a conflict declared and handled is a good record.',
      { title: 'Declare a conflict of interest', placeholder: 'Why you are conflicted', confirmText: 'Declare and step back' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_declare_conflict', { p_case: caseRow.id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Conflict declared. You no longer have access to this investigation.', 'success')
    onChanged()
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2.5">
      <Badge tint={siuStageTint(caseRow.siu_stage)} title={SIU_STAGE_HINT[caseRow.siu_stage ?? 'investigation']}>
        {siuStageLabel(caseRow.siu_stage)}
      </Badge>
      {caseRow.siu_category && (
        <Badge tone="neutral">{siuCaseCategoryLabel(caseRow.siu_category)}</Badge>
      )}
      {closed && caseRow.siu_closure_reason && (
        <span className="text-xs text-slate-400">
          Closed — {siuClosureReasonLabel(caseRow.siu_closure_reason)}
          {caseRow.siu_closure_note ? `: ${caseRow.siu_closure_note}` : ''}
        </span>
      )}

      {inquiry && (
        <span className="text-[11px] text-amber-300/80">
          Not visible to oversight until promoted.
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {siu.isCommand && !closed && (
          <Select
            aria-label="Case category"
            className="h-7 w-auto py-0 text-xs"
            value={caseRow.siu_category ?? ''}
            onChange={(e) => void setCategory(e.target.value)}
          >
            <option value="">No category</option>
            {SIU_CASE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{siuCaseCategoryLabel(c)}</option>
            ))}
          </Select>
        )}
        {siu.isCommand && inquiry && !closed && (
          <Button size="sm" onClick={() => void promote()}>Promote to investigation</Button>
        )}
        {siu.isCommand && !closed && (
          <Button size="sm" onClick={() => setClosing(true)}>Close investigation</Button>
        )}
        <Button size="sm" onClick={() => void declareConflict()}>Declare a conflict</Button>
      </div>

      {closing && (
        <CloseModal
          caseRow={caseRow}
          onClose={() => setClosing(false)}
          onDone={() => { setClosing(false); onChanged() }}
        />
      )}
    </div>
  )
}

function CloseModal({ caseRow, onClose, onDone }: {
  caseRow: CaseRow; onClose: () => void; onDone: () => void
}) {
  const [reason, setReason] = useState<string>('insufficient_evidence')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!note.trim()) { toast('A closure note is required.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_close_case', {
      p_case: caseRow.id, p_reason: reason, p_note: note.trim(),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Investigation closed.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!note}>
      <ModalHeader title={`Close ${caseRow.case_number}`} onClose={onClose} />
      <div className="space-y-3">
        <Field label="Reason" required hint="Every closed SIU investigation carries why, from a fixed list.">
          {(id) => (
            <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}>
              {SIU_CLOSURE_REASONS.map((r) => (
                <option key={r} value={r}>{siuClosureReasonLabel(r)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Closure note" required hint="What was found, or why nothing was. Recorded against your name.">
          {(id) => (
            <Textarea id={id} rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Closing…' : 'Close investigation'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function AssumeModal({ caseRow, onClose, onDone }: {
  caseRow: CaseRow; onClose: () => void; onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [classification, setClassification] = useState<string>('siu_restricted')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!reason.trim()) { toast('Record why SIU is taking this case.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_assume_control', {
      p_case: caseRow.id,
      p_reason: reason.trim(),
      p_classification: classification,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('SIU control assumed.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!reason}>
      <ModalHeader title={`Assume SIU control of ${caseRow.case_number}`} onClose={onClose} />
      <div className="space-y-3">
        <Field label="Reason" required hint="Recorded on the case and in the audit log, against your name.">
          {(id) => (
            <Textarea
              id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Integrity concern regarding the assigned investigator"
            />
          )}
        </Field>
        <Field label="Classification" hint={SIU_CLASSIFICATION_HINT[classification]}>
          {(id) => (
            <Select id={id} value={classification} onChange={(e) => setClassification(e.target.value)}>
              {SIU_CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>{siuClassificationLabel(c)}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
          <p className="font-semibold">What happens immediately</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-200/80">
            <li>The case leaves every CID list, search result and notification, at every rank.</li>
            <li>Its reports, evidence, media, tasks, timeline and sign-off history come with it, unchanged and still credited to their authors.</li>
            <li>The case number, bureau and lead detective are not altered.</li>
            <li>Nobody is notified. The case simply stops appearing.</li>
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Assuming…' : 'Assume control'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
