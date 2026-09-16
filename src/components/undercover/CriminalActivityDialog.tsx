'use client'

/** §5 — the criminal activity notification.
 *
 *  The procedure states a REPORTING duty: a Detective who participates in
 *  criminal activity of any kind must notify their Bureau Lead and CID
 *  Command, and submit the full session recording to CID Command. This dialog
 *  is that notification, and nothing more.
 *
 *  It deliberately does not:
 *   · call the act misconduct, a violation or a breach — the procedure makes
 *     this a report, and a report is not a finding. §9 is a separate section
 *     with a separate process, and the portal does not blur the two;
 *   · block the report when a notification has not been made yet. Recording
 *     WHAT HAPPENED promptly matters more than recording it completely, so an
 *     incomplete report is accepted and the outstanding steps are shown back
 *     to the Detective — on the operation, until they are discharged. */
import { useState } from 'react'
import { rpc } from '@/lib/db'
import { toast } from '@/lib/toast'
import { UC_NOTIFICATION_REQUIREMENTS, type UcOperation } from '@/lib/undercover'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

/** The three §5 duties, as checkboxes. `id` matches the `outstanding` codes
 *  the RPC returns, so the server's answer can be read back verbatim. */
const DUTIES = UC_NOTIFICATION_REQUIREMENTS

export function CriminalActivityDialog({ op, onClose, onDone }: {
  op: UcOperation
  onClose: () => void
  onDone: () => void
}) {
  const [description, setDescription] = useState('')
  const [occurredAt, setOccurredAt] = useState('')
  const [incident, setIncident] = useState('')
  const [recordingRef, setRecordingRef] = useState('')
  const [done, setDone] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)

  const outstanding = DUTIES.filter((d) => !done[d.id])

  const submit = async () => {
    if (busy) return
    if (!description.trim()) { toast('Describe what happened.', 'warn'); return }
    if (!occurredAt) { toast('Say when it happened.', 'warn'); return }
    setBusy(true)
    const res = await rpc('uc_report_criminal_activity', {
      p_op: op.id,
      p_description: description.trim(),
      p_occurred_at: new Date(occurredAt).toISOString(),
      // The report attaches to the operation's own case; §5 asks for the
      // related incident, which is free text when it is not a portal case.
      p_related_case: op.case_id,
      p_incident_reference: incident.trim() || null,
      p_bureau_lead_notified: !!done.bureau_lead,
      p_command_notified: !!done.command,
      p_recording_submitted: !!done.recording,
      p_recording_reference: recordingRef.trim() || null,
    })
    setBusy(false)
    const body = res.data as { ok?: boolean; message?: string; outstanding?: string[] } | null
    if (res.error) { toast(res.error.message, 'danger'); return }
    if (body && body.ok === false) { toast(body.message ?? 'Could not record the report.', 'warn'); return }
    const left = body?.outstanding ?? []
    toast(
      left.length
        ? `Reported. ${left.length} of ${DUTIES.length} notification requirements are still outstanding.`
        : 'Reported, with all three notification requirements recorded.',
      left.length ? 'warn' : 'success',
    )
    onDone()
  }

  return (
    <Modal open onClose={onClose} wide dirty={() => !!description.trim() || !!occurredAt}>
      <form className="p-6" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <ModalHeader title="Report criminal activity (§5)" onClose={onClose} />

        <p className="mb-4 text-sm text-slate-400">
          Detectives MUST notify their Bureau Lead and CID Command after participating in criminal activity of
          any kind, and submit the full session recording to CID Command. This form records that notification.
          It is a reporting requirement — it does not record a disciplinary finding, and submitting it is not an
          admission of misconduct.
        </p>

        <div className="space-y-3">
          <Field label="What happened" required hint="§5 — a short factual description.">
            {(id) => (
              <Textarea
                id={id}
                name="description"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the activity as it occurred…"
              />
            )}
          </Field>

          <Field label="Date and time" required>
            {(id) => (
              <Input
                id={id}
                name="occurred_at"
                type="datetime-local"
                value={occurredAt}
                onChange={(e) => setOccurredAt(e.target.value)}
              />
            )}
          </Field>

          <Field label="Related incident" hint="If applicable — an incident or report number.">
            {(id) => (
              <Input
                id={id}
                name="incident"
                value={incident}
                onChange={(e) => setIncident(e.target.value)}
                maxLength={120}
                placeholder="Optional"
              />
            )}
          </Field>

          {/* The three duties. Checking a box records that the notification was
              MADE — it does not send anything on the Detective's behalf, because
              the procedure asks the Detective to notify, not the portal. */}
          <fieldset className="rounded-lg border border-white/10 bg-ink-900/60 p-3">
            <legend className="px-1 text-xs font-semibold text-slate-400">Required notifications</legend>
            <div className="space-y-2">
              {DUTIES.map((d) => (
                <label key={d.id} className="flex min-h-[44px] items-center gap-2.5 text-sm text-slate-200 sm:min-h-0">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-badge-500"
                    checked={!!done[d.id]}
                    onChange={(e) => setDone((p) => ({ ...p, [d.id]: e.target.checked }))}
                  />
                  {d.label}
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              Tick what you have already done. The portal records the notification — it does not make it for you.
            </p>
          </fieldset>

          <Field label="Recording reference" hint="Where the full session recording was submitted, if not attached here.">
            {(id) => (
              <Input
                id={id}
                name="recording_reference"
                value={recordingRef}
                onChange={(e) => setRecordingRef(e.target.value)}
                maxLength={300}
                placeholder="Optional — a secure link or an evidence reference"
              />
            )}
          </Field>

          {outstanding.length > 0 && (
            <div role="note" className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-100">
                {outstanding.length} of {DUTIES.length} requirements will remain outstanding
              </p>
              <ul className="mt-1 space-y-0.5">
                {outstanding.map((d) => (
                  <li key={d.id} className="text-[11px] text-amber-200/90">• {d.label}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-amber-200/80">
                You can still file the report now. The outstanding steps stay visible on the operation until they
                are recorded.
              </p>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" className="min-h-[44px] sm:min-h-0" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            className="min-h-[44px] sm:min-h-0"
            loading={busy}
            disabled={busy || !description.trim() || !occurredAt}
          >
            File the notification
          </Button>
        </div>
      </form>
    </Modal>
  )
}
