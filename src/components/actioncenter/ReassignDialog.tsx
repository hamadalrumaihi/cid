'use client'

/** Reassign a task or blocker from the queue (Phase 7, P7-04 / AC5) through
 *  `action_reassign_task` / `action_reassign_blocker` (via
 *  inlineActions.runInlineAction). The server decides authority (case lead
 *  or command, on a writable case) and that the target can see the case;
 *  this dialog only collects the member and the required reason (≥ 3 chars
 *  — the RPC raises 'say why the task is being reassigned' below that).
 *  The picker lists the active roster; `useProfilesStore` is RLS-scoped. */
import { useEffect, useMemo, useState } from 'react'
import type { ActionItem } from '@/lib/actionItems'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { humanizeError, toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea, fieldErrorId } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { runInlineAction } from './inlineActions'

const MIN_REASON = 3

export function ReassignDialog({ item, onClose, onDone }: {
  /** The task / blocker item (null = closed). */
  item: ActionItem | null
  onClose: () => void
  /** Fired after a successful reassignment so the queue refreshes. */
  onDone: () => void
}) {
  const { profile } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const loaded = useProfilesStore((s) => s.loaded)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [target, setTarget] = useState('')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!item || loaded) return
    queueMicrotask(() => { void fetchProfiles() })
  }, [item, loaded, fetchProfiles])

  // Active, non-system members other than me (the current assignee — the
  // item is in MY queue) — name-sorted like activeProfiles().
  const options = useMemo(() => profiles
    .filter((p) => p.active && !p.is_system && p.id !== profile?.id && p.id !== item?.ownerId)
    .slice()
    .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '')), [profiles, profile?.id, item?.ownerId])

  const reasonErr = touched && reason.trim().length < MIN_REASON ? `Say why (at least ${MIN_REASON} characters).` : undefined
  const targetErr = touched && !target ? 'Pick a member.' : undefined
  const kindLabel = item?.sourceType === 'blocker' ? 'blocker' : 'task'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!item || !target || reason.trim().length < MIN_REASON || busy) return
    setBusy(true)
    try {
      const res = await runInlineAction(item, 'reassign', { targetUserId: target, reason: reason.trim() })
      if (!res.ok) { toast(humanizeError(res.message ?? 'Could not reassign.'), 'danger'); return }
      toast(res.message ?? 'Reassigned.', 'success')
      onDone()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!item} onClose={onClose} dirty={() => !!target || reason.trim().length > 0}>
      <form onSubmit={submit} className="p-5" noValidate>
        <ModalHeader title={`Reassign ${kindLabel}`} onClose={onClose} />
        <p className="text-sm text-slate-300">
          Hand <span className="font-semibold text-white">{item?.title ?? ''}</span>
          {item?.caseNumber && <> on <span className="font-mono text-slate-200">{item.caseNumber}</span></>} to another member.
          They are notified; the change is recorded on the case.
        </p>
        <div className="mt-4 space-y-3">
          <Field label="Reassign to" required error={targetErr}>
            {(id) => (
              <Select
                id={id}
                value={target}
                required
                invalid={!!targetErr}
                aria-describedby={targetErr ? fieldErrorId(id) : undefined}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">{loaded ? 'Choose a member…' : 'Loading roster…'}</option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>{p.display_name || 'Officer'}{p.badge_number ? ` · ${p.badge_number}` : ''}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Reason" required error={reasonErr} hint="Shown to the new assignee and kept in the case history.">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={reason}
                required
                minLength={MIN_REASON}
                invalid={!!reasonErr}
                aria-describedby={reasonErr ? fieldErrorId(id) : undefined}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Lead has the witness contact — better placed to follow up"
              />
            )}
          </Field>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Only the case lead or command can reassign, and only to a member who can see the case — the server refuses anything else.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" className="min-h-[44px] sm:min-h-0" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" className="min-h-[44px] sm:min-h-0" loading={busy}>Reassign</Button>
        </div>
      </form>
    </Modal>
  )
}
