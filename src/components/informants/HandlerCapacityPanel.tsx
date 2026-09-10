'use client'

/** Handler Capacity — full access only. Every active handler as
 *  `Name — n / c Informants`, the at-capacity ones flagged, a drill-in that
 *  filters the roster to that handler, and the direct override editor
 *  (`ci_capacity_set`: 1..30, reason required, optional expiry; clearing the
 *  override returns the member to the default 6). Data is `ci_stats().handlers`
 *  — the server never hands this list to a handler, and neither does the UI. */
import { useState } from 'react'
import { toast } from '@/lib/toast'
import { CI_DEFAULT_CAPACITY, CI_MAX_CAPACITY, capacityLabel, ciCapacitySet, ciRefused, isAtCapacity, type CiStatsHandler } from '@/lib/ci'
import { DashPanel } from '@/components/dash/DashPanel'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/Notice'
import { MemberSelect } from './ciShared'

export function HandlerCapacityPanel({ handlers, activeHandler, onDrillIn, onChanged }: {
  handlers: CiStatsHandler[]
  /** The handler the roster is currently filtered to (highlights the row). */
  activeHandler?: string | null
  onDrillIn: (userId: string | null) => void
  onChanged: () => void
}) {
  const [editing, setEditing] = useState<{ user_id: string; name: string | null; capacity: number } | 'new' | null>(null)
  const sorted = [...handlers].sort((a, b) => (b.active_count / Math.max(1, b.capacity)) - (a.active_count / Math.max(1, a.capacity)) || (a.name ?? '').localeCompare(b.name ?? ''))
  const atCap = sorted.filter((h) => isAtCapacity(h.active_count, h.capacity)).length

  return (
    <>
      <DashPanel
        title="Handler Capacity"
        count={sorted.length}
        hint={atCap ? `${atCap} handler${atCap === 1 ? '' : 's'} at capacity. Select a row to filter the roster.` : 'Select a row to filter the roster to that handler.'}
        action={{ label: 'Set capacity…', onClick: () => setEditing('new') }}
      >
        {!sorted.length ? (
          <EmptyState title="No active handlers" hint="Handlers appear here once a source is assigned." className="!p-5" />
        ) : (
          <ul className="divide-y divide-white/5">
            {sorted.map((h) => {
              const full = isAtCapacity(h.active_count, h.capacity)
              const on = activeHandler === h.user_id
              const pct = Math.min(100, Math.round((h.active_count / Math.max(1, h.capacity)) * 100))
              return (
                <li key={h.user_id} className="flex items-center gap-2 px-1.5 py-1">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onDrillIn(on ? null : h.user_id)}
                    className={`flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left transition hover:bg-white/5 ${on ? 'bg-white/5' : ''}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">{h.name ?? 'Member'}</span>
                        {full && <Badge tone="warn">At capacity</Badge>}
                        {h.capacity !== CI_DEFAULT_CAPACITY && <Badge tone="neutral" title="Capacity override in effect">Override</Badge>}
                      </span>
                      <span className="mt-1 block h-1 w-full max-w-[12rem] overflow-hidden rounded-full bg-white/10" aria-hidden>
                        <span className={`block h-full rounded-full ${full ? 'bg-amber-400' : 'bg-badge-500'}`} style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span className={`flex-shrink-0 text-sm font-semibold tabular-nums ${full ? 'text-amber-200' : 'text-slate-200'}`}>
                      {capacityLabel(h.active_count, h.capacity)}
                    </span>
                  </button>
                  <Button size="sm" className="min-h-11 lg:min-h-0" aria-label={`Set capacity for ${h.name ?? 'member'}`}
                    onClick={() => setEditing({ user_id: h.user_id, name: h.name, capacity: h.capacity })}>
                    Set
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </DashPanel>
      {editing && (
        <CapacityOverrideEditor
          open
          onClose={() => setEditing(null)}
          target={editing === 'new' ? null : editing}
          onSaved={() => { setEditing(null); onChanged() }}
        />
      )}
    </>
  )
}

/** Direct individual override (full access). */
export function CapacityOverrideEditor({ open, onClose, target, onSaved }: {
  open: boolean
  onClose: () => void
  /** Prefilled member, or null to pick one. */
  target: { user_id: string; name: string | null; capacity: number } | null
  onSaved: () => void
}) {
  const [user, setUser] = useState(target?.user_id ?? '')
  const [limit, setLimit] = useState(String(target?.capacity ?? CI_DEFAULT_CAPACITY))
  const [reset, setReset] = useState(false)
  const [reason, setReason] = useState('')
  const [expires, setExpires] = useState('')
  const [err, setErr] = useState<string | undefined>()

  const submit = async () => {
    if (!user) { setErr('Choose a member.'); return }
    const n = Number(limit)
    if (!reset && (!Number.isInteger(n) || n < 1 || n > CI_MAX_CAPACITY)) { setErr(`Capacity must be 1–${CI_MAX_CAPACITY}.`); return }
    if (reason.trim().length < 3) { setErr('A reason of at least 3 characters is required.'); return }
    setErr(undefined)
    const r = await ciCapacitySet(user, reset ? null : n, reason.trim(), expires ? new Date(expires).toISOString() : null)
    if (ciRefused(r)) return
    toast(reset ? `Capacity reset to the default ${CI_DEFAULT_CAPACITY}.` : `Capacity set to ${n}.`, 'success')
    onSaved()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => reason.trim() !== ''}>
      <div className="p-5">
        <ModalHeader title={target ? `Capacity — ${target.name ?? 'Member'}` : 'Set handler capacity'} onClose={onClose} />
        <div className="space-y-3">
          {!target && <MemberSelect label="Member" required value={user} onChange={setUser} />}
          <Field label="Capacity" required error={err && !reset && (Number(limit) < 1 || Number(limit) > CI_MAX_CAPACITY) ? err : undefined}
            hint={`Default ${CI_DEFAULT_CAPACITY}; maximum ${CI_MAX_CAPACITY}. Only active sources count.`}>
            {(id) => <Input id={id} type="number" min={1} max={CI_MAX_CAPACITY} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} disabled={reset} />}
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} className="h-4 w-4" />
            Remove the override (back to {capacityLabel(0, CI_DEFAULT_CAPACITY).replace(/^0 \/ /, '')})
          </label>
          <Field label="Expires">
            {(id) => <Input id={id} type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} disabled={reset} />}
          </Field>
          <Field label="Reason" required error={err && reason.trim().length < 3 ? err : undefined}>
            {(id) => <Textarea id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!err && reason.trim().length < 3} placeholder="Recorded as CI_CAPACITY_CHANGED" />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={submit}>{reset ? 'Reset capacity' : 'Set capacity'}</Button>
        </div>
      </div>
    </Modal>
  )
}
