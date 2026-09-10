'use client'

/** Sanitize / Release (CI contract §3 `ci_release`, §6.4) — full CI access
 *  turns ONE piece of source intelligence into a sanitized record on the case
 *  (`case_intel_releases`, visible to the case team through ordinary case
 *  RLS). The body is deliberately NOT prefilled from the source text: the
 *  releaser writes what the case may know, in their own words.
 *
 *  `sanitizeCheck` (lib/ciModel) is the cosmetic pre-check — it flags the CI
 *  number, the alias / name and the handler's name as they are typed. The
 *  server re-runs `private.ci_sanitized` and its `unsanitized` refusal is
 *  final; that message is shown verbatim. The original ci_intelligence row is
 *  never declassified — the release carries no ci / intel column at all. */
import { useMemo, useState } from 'react'
import {
  CI_HANDLING, CI_HANDLING_LABEL, ciRelease, sanitizeCheck, type CiHandling, type SanitizeSubject,
} from '@/lib/ci'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea, fieldErrorId } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

export interface SanitizeReleaseIntel {
  id: string
  ci_number: string
  /** The source summary — shown read-only as the releaser's reference, never copied. */
  summary: string
  handler_name?: string | null
}

export function SanitizeReleaseDialog({
  open, onClose, intel, subject, onReleased,
}: {
  open: boolean
  onClose: () => void
  intel: SanitizeReleaseIntel
  /** Extra identifying strings for the pre-check (the person's name / alias)
   *  when the caller knows them; the CI number and handler are always checked. */
  subject?: SanitizeSubject
  onReleased?: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [handling, setHandling] = useState<CiHandling>('law_enforcement_sensitive')
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const check = useMemo(() => sanitizeCheck(`${title}\n${body}`, {
    ...subject,
    ciNumber: subject?.ciNumber ?? intel.ci_number,
    handlerNames: [...(subject?.handlerNames ?? []), intel.handler_name],
  }), [title, body, subject, intel.ci_number, intel.handler_name])

  const dirty = () => !!title.trim() || !!body.trim()
  const canSubmit = title.trim().length >= 3 && body.trim().length >= 10 && check.clean && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    setServerError(null)
    const r = await ciRelease(intel.id, title.trim(), body.trim(), handling)
    setBusy(false)
    if (!r.ok) {
      // The server's own words — `unsanitized` names exactly what was found.
      setServerError(r.message || 'The release was refused.')
      return
    }
    toast('Released to the case.', 'success')
    setTitle(''); setBody('')
    onReleased?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title="Sanitize and release to the case" onClose={onClose} />
        <div className="space-y-4">
        <p className="text-sm text-slate-400">
          Only the text you write below reaches the case. The source record, its CI number and its handler never leave the compartment — write what the investigation may know, in your own words.
        </p>
        <div className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
          <p className="text-xs font-semibold text-slate-400">Source intelligence (reference only — not released)</p>
          <p className="mt-1 text-sm text-slate-200">{intel.summary}</p>
        </div>
        <Field label="Release title" required>
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What the case team is being told" maxLength={160} />}
        </Field>
        <Field
          label="Released text"
          required
          hint="Describe the intelligence without the source. No CI number, name, alias or handler."
          error={check.clean ? undefined : `The text names the source — remove: ${check.hits.join(', ')}`}
        >
          {(id) => (
            <Textarea
              id={id}
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              invalid={!check.clean}
              aria-describedby={check.clean ? undefined : fieldErrorId(id)}
              placeholder="Information received indicates that…"
            />
          )}
        </Field>
        <Field label="Handling">
          {(id) => (
            <Select id={id} value={handling} onChange={(e) => setHandling(e.target.value as CiHandling)}>
              {CI_HANDLING.map((h) => <option key={h} value={h}>{CI_HANDLING_LABEL[h]}</option>)}
            </Select>
          )}
        </Field>
        {serverError && (
          <p role="alert" className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-sm text-rose-200">{serverError}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!canSubmit} loading={busy}>Release to case</Button>
        </div>
        </div>
      </div>
    </Modal>
  )
}
