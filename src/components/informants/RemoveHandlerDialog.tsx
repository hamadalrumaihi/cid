'use client'

/** End a handler assignment → `ci_handler_remove` (full access). The server
 *  refuses to strip the primary of an active/candidate source
 *  (`primary_required`) — reassign first; that message is shown verbatim. */
import { useState } from 'react'
import { toast } from '@/lib/toast'
import { ciHandlerRemove, ciRefused, type CiHandler } from '@/lib/ci'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

export function RemoveHandlerDialog({ open, onClose, ciId, ciNumber, handlers, onSaved }: {
  open: boolean
  onClose: () => void
  ciId: string
  ciNumber: string
  /** Active handler rows (ended rows are not offered). */
  handlers: CiHandler[]
  onSaved?: () => void
}) {
  const live = handlers.filter((h) => !h.ended_at)
  const [user, setUser] = useState(live.length === 1 ? live[0].user_id : '')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | undefined>()

  const submit = async () => {
    if (!user) { setErr('Choose the handler to remove.'); return }
    if (reason.trim().length < 3) { setErr('A reason of at least 3 characters is required.'); return }
    setErr(undefined)
    const r = await ciHandlerRemove(ciId, user, reason.trim())
    if (ciRefused(r)) return
    toast('Handler removed.', 'success')
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => reason.trim() !== ''}>
      <div className="p-5">
        <ModalHeader title={`Remove handler — ${ciNumber}`} onClose={onClose} />
        <div className="space-y-3">
          <Field label="Handler" required error={!user ? err : undefined}>
            {(id) => (
              <Select id={id} value={user} onChange={(e) => setUser(e.target.value)}>
                <option value="">Select…</option>
                {live.map((h) => <option key={h.user_id} value={h.user_id}>{h.name ?? 'Member'} — {h.role}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Reason" required error={user ? err : undefined} hint="The primary of an active or candidate source cannot be removed — assign a new primary first.">
            {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!err && !!user} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onAction={submit}>Remove handler</Button>
        </div>
      </div>
    </Modal>
  )
}
