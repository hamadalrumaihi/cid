'use client'

/** §7 — marking an operation compromised.
 *
 *  "If an undercover operation becomes compromised, the Detective shall
 *  withdraw when reasonably possible and notify CID Command." The dialog
 *  records the four things the procedure names — the time, the circumstances,
 *  whether the Detective withdrew, whether Command was notified — and creates
 *  an audit event.
 *
 *  It notifies narrowly and on purpose. The server tells the Detective's own
 *  Bureau Lead and nobody else: §4 authorizes High Command, the CID Bureau
 *  Lead and CID Command to know an operation exists, so a wider alert would
 *  disclose an undercover identity to people the procedure does not authorize.
 *  A compromise is the moment that matters most. */
import { useState } from 'react'
import { rpc } from '@/lib/db'
import { toast } from '@/lib/toast'
import type { UcOperation } from '@/lib/undercover'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

export function CompromisedDialog({ op, onClose, onDone }: {
  op: UcOperation
  onClose: () => void
  onDone: () => void
}) {
  const [at, setAt] = useState('')
  const [note, setNote] = useState('')
  const [withdrawn, setWithdrawn] = useState(false)
  const [commandNotified, setCommandNotified] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    const res = await rpc('uc_mark_compromised', {
      p_op: op.id,
      // Blank means now: a Detective marking a live compromise should not have
      // to fill a timestamp before they can report it.
      p_compromised_at: at ? new Date(at).toISOString() : new Date().toISOString(),
      p_note: note.trim() || null,
      p_withdrawn: withdrawn,
      p_command_notified: commandNotified,
    })
    setBusy(false)
    const body = res.data as { ok?: boolean; message?: string } | null
    if (res.error) { toast(res.error.message, 'danger'); return }
    if (body && body.ok === false) { toast(body.message ?? 'Could not record it.', 'warn'); return }
    toast('Recorded as compromised.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!note.trim()}>
      <form className="p-6" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <ModalHeader title="Mark operation compromised (§7)" onClose={onClose} />

        <div role="note" className="mb-4 rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-2.5">
          <p className="text-sm font-semibold text-rose-100">Safety comes before the cover identity</p>
          <p className="mt-1 text-xs text-rose-200/90">
            If the operation is compromised, withdraw when reasonably possible and notify CID Command. Record it
            here once you are safe — this form is the record, not the notification.
          </p>
        </div>

        <div className="space-y-3">
          <Field label="Time compromised" hint="Leave blank to record it as now.">
            {(id) => (
              <Input id={id} name="compromised_at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
            )}
          </Field>

          <Field label="Brief circumstances">
            {(id) => (
              <Textarea
                id={id}
                name="note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What happened, and what it exposed…"
              />
            )}
          </Field>

          <label className="flex min-h-[44px] items-center gap-2.5 text-sm text-slate-200 sm:min-h-0">
            <input
              type="checkbox"
              className="h-4 w-4 accent-badge-500"
              checked={withdrawn}
              onChange={(e) => setWithdrawn(e.target.checked)}
            />
            I withdrew from the operation
          </label>
          <label className="flex min-h-[44px] items-center gap-2.5 text-sm text-slate-200 sm:min-h-0">
            <input
              type="checkbox"
              className="h-4 w-4 accent-badge-500"
              checked={commandNotified}
              onChange={(e) => setCommandNotified(e.target.checked)}
            />
            CID Command notified
          </label>

          <p className="text-[11px] text-slate-500">
            Marking this concludes the operation as compromised and records an audit event. Your Bureau Lead is
            notified; nobody outside the positions §4 authorizes is told this operation exists.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" className="min-h-[44px] sm:min-h-0" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="danger" className="min-h-[44px] sm:min-h-0" loading={busy} disabled={busy}>
            Mark compromised
          </Button>
        </div>
      </form>
    </Modal>
  )
}
