'use client'

/** Prosecutor / judge picker for AG assignment actions. The pool comes from
 *  the `justice_directory()` definer RPC (the justice-domain name source —
 *  never the CID roster), filtered to ACTIVE members whose EFFECTIVE role
 *  matches the seat being filled (legacy ADA/DA rows count as prosecutors).
 *  The optional reason field is required by the server when reassigning a
 *  claimed request — the caller says so via `reasonRequired`. */
import { useEffect, useState } from 'react'
import { rpc } from '@/lib/db'
import { justiceRoleLabel } from '@/lib/justice'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { effectiveJusticeRole } from '@/components/justice/legalShared'

interface DirectoryEntry {
  user_id: string
  display_name: string
  justice_role: string
  active: boolean
}

export function JusticePickerModal({
  seat, title, hint, reasonMode = 'optional', busy, excludeIds = [], onSubmit, onClose,
}: {
  /** The effective role being seated. */
  seat: 'prosecutor' | 'judge'
  title: string
  hint?: string
  /** 'required' when the server demands one (reassigning a claimed request);
   *  'none' for RPCs that take no reason (assign_judge). */
  reasonMode?: 'none' | 'optional' | 'required'
  busy: boolean
  /** Never offer these (e.g. the current holder — the server refuses anyway). */
  excludeIds?: readonly string[]
  onSubmit: (v: { userId: string; reason: string }) => void
  onClose: () => void
}) {
  const [pool, setPool] = useState<DirectoryEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState('')
  const [reason, setReason] = useState('')
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    void rpc('justice_directory', undefined as never).then((r) => {
      if (cancelled) return
      if (r.error || !r.data) { setFailed(true); return }
      setPool(r.data as DirectoryEntry[])
    })
    return () => { cancelled = true }
  }, [])

  const q = query.trim().toLowerCase()
  const options = (pool ?? []).filter((p) =>
    p.active
    && effectiveJusticeRole(p.justice_role) === seat
    && !excludeIds.includes(p.user_id)
    && (!q || p.display_name.toLowerCase().includes(q)))

  const ready = !!selected && (reasonMode !== 'required' || reason.trim() !== '')
  const dirty = () => !!selected || reason.trim() !== ''

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-5">
        <ModalHeader title={title} onClose={onClose} />
        {hint && <p className="text-sm text-slate-400">{hint}</p>}

        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-1 block text-xs font-semibold text-slate-400">
              {seat === 'prosecutor' ? 'Active prosecutors' : 'Active judges'}
              <span className="ml-0.5 text-rose-300" aria-hidden>*</span>
            </p>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by name…"
              aria-label="Filter members"
              autoComplete="off"
            />
            <ul
              role="radiogroup"
              aria-label={seat === 'prosecutor' ? 'Select a prosecutor' : 'Select a judge'}
              className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-ink-950/70"
            >
              {options.map((p) => (
                <li key={p.user_id}>
                  <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-white/5">
                    <input
                      type="radio"
                      name="justice-pick"
                      checked={selected === p.user_id}
                      onChange={() => setSelected(p.user_id)}
                      className="h-4 w-4 border-white/20 bg-ink-900 accent-badge-500"
                    />
                    <span className="text-sm font-semibold text-white">{p.display_name || 'Member'}</span>
                    <span className="text-xs text-slate-400">{justiceRoleLabel(p.justice_role)}</span>
                  </label>
                </li>
              ))}
              {!options.length && (
                <li className="px-3 py-2.5 text-sm text-slate-400">
                  {failed
                    ? 'Directory unavailable — try again.'
                    : pool === null
                      ? 'Loading directory…'
                      : `No active ${seat === 'prosecutor' ? 'prosecutors' : 'judges'} available.`}
                </li>
              )}
            </ul>
          </div>

          {reasonMode !== 'none' && (
            <Field
              label="Reason"
              required={reasonMode === 'required'}
              hint={reasonMode === 'required' ? 'Required — this reassigns a claimed request.' : 'Optional — recorded in the request history.'}
            >
              {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !ready}
            onClick={() => onSubmit({ userId: selected, reason: reason.trim() })}
          >
            {busy ? 'Assigning…' : 'Assign'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
