'use client'

/** Assign / replace a handler → `ci_handler_set` (full access). Same capacity
 *  rule as ci_create: if the source is active and the member is at capacity
 *  the server answers `code:'capacity'`; the dialog then shows the Capacity
 *  warning and re-submits with an authorization reason ("Assign with
 *  authorization"). The displaced handler loses access the moment the row
 *  ends — RLS, not UI. */
import { useState } from 'react'
import { toast } from '@/lib/toast'
import { capacityLabel, ciHandlerSet, ciRefused, type CiHandler, type CiStatsHandler } from '@/lib/ci'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { officerName } from '@/lib/profiles'
import { CapacityWarning, MemberSelect } from './ciShared'

export function ReassignHandlerDialog({ open, onClose, ciId, ciNumber, status, handlers, capacity, initialRole = 'primary', onSaved }: {
  open: boolean
  onClose: () => void
  ciId: string
  ciNumber: string
  status: string
  handlers: CiHandler[]
  /** `ci_stats().handlers` when available — powers the live n / c preview. */
  capacity?: CiStatsHandler[]
  initialRole?: 'primary' | 'secondary'
  onSaved?: () => void
}) {
  const [role, setRole] = useState<'primary' | 'secondary'>(initialRole)
  const [user, setUser] = useState('')
  const [reason, setReason] = useState('')
  const [counts, setCounts] = useState(true)
  const [override, setOverride] = useState<{ active: number; capacity: number; message: string } | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [err, setErr] = useState<string | undefined>()

  const live = handlers.filter((h) => !h.ended_at)
  const holder = live.find((h) => h.role === role)
  const stat = capacity?.find((h) => h.user_id === user)
  const preview = stat ? capacityLabel(stat.active_count, stat.capacity) : null
  const willCount = status === 'active' && counts

  const submit = async () => {
    if (!user) { setErr('Choose a member.'); return }
    if (reason.trim().length < 3) { setErr('A reason of at least 3 characters is required.'); return }
    if (override && overrideReason.trim().length < 3) { setErr('Give the authorization reason.'); return }
    setErr(undefined)
    const r = await ciHandlerSet(ciId, user, role, reason.trim(), override ? overrideReason.trim() : null, counts)
    if (!r.ok && r.code === 'capacity' && !override) {
      // Parse "(n / c)" out of the server's message for the warning; fall back
      // to the stats row when the message shape ever changes.
      const m = /\((\d+)\s*\/\s*(\d+)\)/.exec(r.message)
      setOverride({
        active: m ? Number(m[1]) : stat?.active_count ?? 0,
        capacity: m ? Number(m[2]) : stat?.capacity ?? 6,
        message: r.message,
      })
      return
    }
    if (ciRefused(r)) return
    toast(`${role === 'primary' ? 'Primary' : 'Secondary'} handler set on ${ciNumber}.`, 'success')
    onSaved?.()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => reason.trim() !== '' || user !== ''}>
      <div className="p-5">
        <ModalHeader title={`Assign handler — ${ciNumber}`} onClose={onClose} />
        <div className="space-y-3">
          <Field label="Role" required hint={holder ? `Replaces ${holder.name ?? officerName(holder.user_id) ?? 'the current holder'}.` : 'The slot is currently empty.'}>
            {(id) => (
              <Select id={id} value={role} onChange={(e) => { setRole(e.target.value as 'primary' | 'secondary'); setOverride(null) }}>
                <option value="primary">Primary handler</option>
                <option value="secondary">Secondary handler</option>
              </Select>
            )}
          </Field>
          <MemberSelect label="Member" required value={user} onChange={(v) => { setUser(v); setOverride(null) }}
            exclude={new Set(live.filter((h) => h.role === role).map((h) => h.user_id))}
            hint={preview ? `Currently ${preview}.` : undefined} />
          <label className="flex min-h-11 items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={counts} onChange={(e) => { setCounts(e.target.checked); setOverride(null) }} className="h-4 w-4" />
            Counts toward the member&apos;s capacity
            {!willCount && <span className="text-xs text-slate-400">(only active sources count)</span>}
          </label>
          <Field label="Reason" required error={err}>
            {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!err} placeholder="Why the handler changes" />}
          </Field>
          {override && (
            <CapacityWarning
              handlerName={stat?.name ?? officerName(user) ?? 'This member'}
              active={override.active} capacity={override.capacity}
              reason={overrideReason} onReason={setOverrideReason}
              error={err && overrideReason.trim().length < 3 ? err : undefined}
            />
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={override ? 'warn' : 'primary'} onAction={submit}>
            {override ? 'Assign with authorization' : 'Assign handler'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
