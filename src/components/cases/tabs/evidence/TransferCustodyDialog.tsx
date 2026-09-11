'use client'

/** Hand custody of one evidence item to another active member. The server
 *  (`evidence_custody_transfer`) checks that the caller is the current
 *  custodian, the uploader or command, that the recipient can read the
 *  case, writes the TRANSFERRED event and notifies the recipient. */
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { transferCustody, type MediaRow } from '@/lib/evidence'
import { activeProfiles, officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'

export function TransferCustodyDialog({ m, onClose, onDone }: {
  m: MediaRow
  onClose: () => void
  onDone: () => void
}) {
  const [to, setTo] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const members = activeProfiles().filter((p) => p.id !== m.current_custodian)
  const custodian = officerName(m.current_custodian)

  const submit = async () => {
    if (!to) { toast('Choose who takes custody.', 'warn'); return }
    if (!reason.trim()) { toast('A reason is required to transfer custody.', 'warn'); return }
    setBusy(true)
    const r = await transferCustody(m.id, to, reason.trim())
    setBusy(false)
    if (!r.ok) { toast(r.message ?? 'Transfer refused.', 'danger'); return }
    toast(`Custody transferred to ${officerName(to) ?? 'the recipient'}.`, 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!to || reason.trim().length > 0}>
      <div className="p-5">
        <ModalHeader title="Transfer custody" onClose={onClose} />
        <p className="mb-3 text-sm text-slate-400">
          <span className="font-mono text-slate-200">{m.evidence_number ?? m.title}</span>
          {custodian ? <> · currently held by <span className="text-slate-200">{custodian}</span></> : null}
        </p>
        <div className="space-y-3">
          <Field label="New custodian" required>
            {(id) => (
              <Select id={id} name="custodian" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">— choose a member —</option>
                {members.map((p) => <option key={p.id} value={p.id}>{p.display_name}{p.badge_number ? ` · ${p.badge_number}` : ''}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Reason" required hint="Recorded on the custody chain and sent to the recipient.">
            {(id) => (
              <Textarea
                id={id}
                name="reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Handing over for forensic review before Tuesday's hearing…"
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={() => void submit()}>Transfer custody</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
