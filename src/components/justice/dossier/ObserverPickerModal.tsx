'use client'

/** Observer picker (P4-01 / L16): the prosecutor role is retired, and
 *  per-request read access is granted instead as an `observer` participant
 *  via `legal_set_observer`. The pool is the CID roster (profiles — readable
 *  by CID members) merged with the justice directory (definer RPC — the DOJ
 *  name source); a justice-only viewer simply gets the directory half. The
 *  server re-checks the caller (AG, Owner, approver pool, creator) and the
 *  target (active profile or justice member). */
import { useEffect, useMemo, useState } from 'react'
import { rpc } from '@/lib/db'
import { justiceRoleLabel } from '@/lib/justice'
import { activeProfiles, useProfilesStore } from '@/lib/profiles'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

interface Candidate { id: string; label: string; sublabel: string }

export function ObserverPickerModal({ requestNumber, currentObserverIds, busy, onSubmit, onClose }: {
  requestNumber: string
  /** Active observer participants — offered for removal. */
  currentObserverIds: readonly string[]
  busy: boolean
  onSubmit: (v: { userId: string; active: boolean; reason: string }) => void
  onClose: () => void
}) {
  const loaded = useProfilesStore((s) => s.loaded)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [directory, setDirectory] = useState<Candidate[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => { if (!loaded) void fetchProfiles().catch(() => {}) }, [loaded, fetchProfiles])
  useEffect(() => {
    let cancelled = false
    void rpc('justice_directory', undefined as never).then((r) => {
      if (cancelled || r.error || !r.data) return
      setDirectory((r.data as { user_id: string; display_name: string; justice_role: string; active: boolean }[])
        .filter((p) => p.active)
        .map((p) => ({ id: p.user_id, label: p.display_name, sublabel: justiceRoleLabel(p.justice_role) })))
    })
    return () => { cancelled = true }
  }, [])

  const pool = useMemo<Candidate[]>(() => {
    const seen = new Set<string>()
    const out: Candidate[] = []
    for (const p of activeProfiles()) {
      seen.add(p.id)
      out.push({ id: p.id, label: p.display_name || 'Member', sublabel: p.badge_number ? `Badge ${p.badge_number}` : 'CID' })
    }
    for (const d of directory) if (!seen.has(d.id)) out.push(d)
    return out.sort((a, b) => a.label.localeCompare(b.label))
    // activeProfiles() reads the store; `loaded` flips when the roster lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directory, loaded])

  const q = query.trim().toLowerCase()
  const options = pool.filter((p) => !q || p.label.toLowerCase().includes(q) || p.sublabel.toLowerCase().includes(q)).slice(0, 40)
  const isObserver = currentObserverIds.includes(selected)

  return (
    <Modal open onClose={onClose} dirty={() => selected !== '' || reason.trim() !== ''}>
      <div className="p-5">
        <ModalHeader title={`Observer access — ${requestNumber}`} onClose={onClose} />
        <p className="text-sm text-slate-400">
          An observer can read this request and its comments without any decision authority. Removing one ends their access.
        </p>
        <div className="mt-4 space-y-4">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name, badge or role…" aria-label="Filter members" autoComplete="off" />
          <ul role="radiogroup" aria-label="Members" className="max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-ink-950/70">
            {options.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-white/5">
                  <input type="radio" name="observer" value={p.id} checked={selected === p.id} onChange={() => setSelected(p.id)} className="accent-badge-500" />
                  <span className="text-sm font-semibold text-white">{p.label}</span>
                  <span className="text-xs text-slate-400">{p.sublabel}</span>
                  {currentObserverIds.includes(p.id) && <span className="ml-auto text-[10px] font-semibold uppercase text-emerald-300">observer</span>}
                </label>
              </li>
            ))}
            {options.length === 0 && <li className="px-3 py-2.5 text-sm text-slate-400">{pool.length ? 'No members match.' : 'Loading members…'}</li>}
          </ul>
          <Field label="Reason" hint="Optional — recorded on the request timeline.">
            {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          {isObserver ? (
            <Button variant="danger" disabled={busy || !selected} onClick={() => onSubmit({ userId: selected, active: false, reason: reason.trim() })}>
              {busy ? 'Saving…' : 'Remove observer'}
            </Button>
          ) : (
            <Button variant="primary" disabled={busy || !selected} onClick={() => onSubmit({ userId: selected, active: true, reason: reason.trim() })}>
              {busy ? 'Saving…' : 'Grant observer access'}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
