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
  SIU_CLASSIFICATIONS, SIU_CLASSIFICATION_HINT, siuClassificationLabel,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
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
