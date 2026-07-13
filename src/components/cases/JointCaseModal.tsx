'use client'

/** Joint-case membership modal — one component for both flows:
 *  mode 'convert' → convert_case_to_joint (case becomes JTF-displayed, the
 *  originating bureau is preserved), mode 'add' → joint_case_add_members.
 *  Joint assignment rows are RPC-only (RLS blocks direct writes), so this
 *  modal never touches case_assignments directly. Two steps: pick members
 *  (searchable listbox + per-member role/expiry), then confirm a summary. */
import { useEffect, useId, useMemo, useState } from 'react'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Field, Input, Select } from '@/components/ui/Field'
import { rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useProfilesStore, type RosterProfile } from '@/lib/profiles'
import { BUREAUS, bureauLabel, roleLabel } from '@/lib/roles'
import { toast } from '@/lib/toast'
import type { Json } from '@/lib/database.types'
import type { AssignmentRow, CaseRow } from './tabs/shared'

export const JOINT_ROLES = [
  'JTF Case Lead',
  'JTF Co-Lead',
  'Joint Investigator',
  'Support Investigator',
  'Department Liaison',
  'Read-Only Member',
] as const
export type JointRole = (typeof JOINT_ROLES)[number]

/** ACTIVE assignment = not removed AND not past its expiry. */
export function isActiveAssignment(a: Pick<AssignmentRow, 'removed_at' | 'expires_at'>): boolean {
  return !a.removed_at && (!a.expires_at || new Date(a.expires_at).getTime() > Date.now())
}

interface Picked {
  officer_id: string
  joint_role: JointRole
  /** datetime-local value; '' = no expiry. */
  expires_at: string
}

export interface JointCaseModalProps {
  open: boolean
  onClose: () => void
  c: CaseRow
  mode: 'convert' | 'add'
  /** Current case_assignments rows — officers already actively assigned are
   *  excluded from the picker (the RPC would reject them anyway). */
  existingAssignments: AssignmentRow[]
  onDone: () => void
}

const subLine = (p: RosterProfile) =>
  [p.badge_number ? `Badge ${p.badge_number}` : null, bureauLabel(p.division), roleLabel(p.role)]
    .filter(Boolean)
    .join(' · ')

export function JointCaseModal({ open, onClose, c, mode, existingAssignments, onDone }: JointCaseModalProps) {
  const uid = useId()
  const { profile } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const rosterLoaded = useProfilesStore((s) => s.loaded)
  const fetchProfiles = useProfilesStore((s) => s.fetch)

  const [step, setStep] = useState<'pick' | 'confirm'>('pick')
  const [selected, setSelected] = useState<Picked[]>([])
  const [query, setQuery] = useState('')
  const [bureauFilter, setBureauFilter] = useState('all')
  const [listOpen, setListOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const [busy, setBusy] = useState(false)

  // Fresh slate every time the modal opens (deferred, matching the
  // FollowUpButton idiom); lazy-load the roster if it isn't cached yet.
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      setStep('pick'); setSelected([]); setQuery(''); setBureauFilter('all')
      setListOpen(false); setActiveIdx(0); setBusy(false)
    })
  }, [open])
  useEffect(() => { if (open && !rosterLoaded) void fetchProfiles() }, [open, rosterLoaded, fetchProfiles])

  // Officers with an ACTIVE assignment (standard or joint) can't be added again.
  const assignedIds = useMemo(
    () => new Set(existingAssignments.filter(isActiveAssignment).map((a) => a.officer_id)),
    [existingAssignments],
  )

  const options = useMemo(() => {
    const q = query.trim().toLowerCase()
    return profiles
      .filter((p) => p.active && !p.removed_at && p.id !== profile?.id && !assignedIds.has(p.id))
      .filter((p) => bureauFilter === 'all' || p.division === bureauFilter)
      .filter((p) => !q
        || (p.display_name ?? '').toLowerCase().includes(q)
        || (p.badge_number ?? '').toLowerCase().includes(q))
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
  }, [profiles, profile?.id, assignedIds, bureauFilter, query])

  // Roving highlight, clamped at read time so a shrinking filtered pool never
  // leaves it out of range (no state write needed).
  const idx = options.length ? Math.min(activeIdx, options.length - 1) : 0
  useEffect(() => {
    if (!listOpen || !options[idx]) return
    document.getElementById(`${uid}-opt-${options[idx].id}`)?.scrollIntoView({ block: 'nearest' })
  }, [idx, listOpen, options, uid])

  const toggle = (officerId: string) => {
    setSelected((prev) => prev.some((m) => m.officer_id === officerId)
      ? prev.filter((m) => m.officer_id !== officerId)
      : [...prev, { officer_id: officerId, joint_role: 'Joint Investigator', expires_at: '' }])
  }
  const patch = (officerId: string, p: Partial<Picked>) =>
    setSelected((prev) => prev.map((m) => (m.officer_id === officerId ? { ...m, ...p } : m)))

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!listOpen) setListOpen(true)
      else setActiveIdx(Math.min(idx + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(Math.max(idx - 1, 0))
    } else if (e.key === 'Enter') {
      if (listOpen && options[idx]) { e.preventDefault(); toggle(options[idx].id) }
    } else if (e.key === 'Escape' && listOpen) {
      // Swallow the first Escape to close the option list only — a second
      // Escape reaches the Modal's document listener and closes the dialog.
      e.preventDefault()
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      setListOpen(false)
    }
  }

  const goConfirm = () => {
    if (!selected.length) { toast('Select at least one member first.', 'warn'); return }
    if (selected.some((m) => m.expires_at && new Date(m.expires_at).getTime() <= Date.now())) {
      toast('Temporary access expiry must be in the future.', 'warn')
      return
    }
    setStep('confirm')
  }

  const submit = async () => {
    if (busy) return
    setBusy(true)
    const p_members = selected.map((m) => ({
      officer_id: m.officer_id,
      joint_role: m.joint_role,
      ...(m.expires_at ? { expires_at: new Date(m.expires_at).toISOString() } : {}),
    })) as Json
    const res = mode === 'convert'
      ? await rpc('convert_case_to_joint', { p_case: c.id, p_members })
      : await rpc('joint_case_add_members', { p_case: c.id, p_members })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(
      mode === 'convert'
        ? `Joint case created — ${selected.length} member(s) added.`
        : `${selected.length} member(s) added to the joint case.`,
      'success',
    )
    onDone()
  }

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.display_name || 'Officer'
  const fmtExpiry = (v: string) => new Date(v).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  const listboxId = `${uid}-listbox`
  const originating = bureauLabel(c.originating_bureau ?? c.bureau)

  return (
    <Modal open={open} onClose={onClose} wide dirty={() => selected.length > 0}>
      <div className="p-5">
        <ModalHeader
          title={mode === 'convert' ? 'Make this a joint case' : 'Add joint-case members'}
          onClose={onClose}
        />
        <p className="text-sm text-slate-300">
          {mode === 'convert'
            ? 'Converting displays this case as JTF while the originating department is preserved. Selected members get temporary access to this case only.'
            : 'Selected members get temporary joint-case access to this case only; their department and rank are unchanged.'}
        </p>
        <p className="mt-2 text-sm text-slate-400">
          Originating department: <span className="font-semibold text-slate-200">{originating}</span>
        </p>

        {step === 'pick' ? (
          <>
            {selected.length > 0 && (
              <div className="mt-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Selected members ({selected.length})</p>
                {selected.map((m) => (
                  <div key={m.officer_id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-ink-950/50 p-3">
                    <span className="min-w-32 flex-1 text-sm font-semibold text-white">{nameOf(m.officer_id)}</span>
                    <select
                      value={m.joint_role}
                      onChange={(e) => patch(m.officer_id, { joint_role: e.target.value as JointRole })}
                      aria-label={`Joint-case role for ${nameOf(m.officer_id)}`}
                      className="min-h-[44px] rounded-lg border border-white/10 bg-ink-900 px-2 py-2 text-sm text-white outline-none transition focus:border-badge-500 sm:min-h-0"
                    >
                      {JOINT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <input
                      type="datetime-local"
                      value={m.expires_at}
                      min={new Date().toISOString().slice(0, 16)}
                      onChange={(e) => patch(m.officer_id, { expires_at: e.target.value })}
                      aria-label={`Access expiry for ${nameOf(m.officer_id)} (optional)`}
                      className="min-h-[44px] rounded-lg border border-white/10 bg-ink-900 px-2 py-2 text-sm text-white outline-none transition focus:border-badge-500 sm:min-h-0"
                    />
                    <button
                      onClick={() => toggle(m.officer_id)}
                      aria-label={`Remove ${nameOf(m.officer_id)} from selection`}
                      className="grid h-11 w-11 place-items-center rounded-lg text-lg text-rose-300 transition hover:bg-white/5 hover:text-rose-200 sm:h-9 sm:w-9"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Search members" hint="Type a name or badge number; ↑/↓ to highlight, Enter to select.">
                {(id) => (
                  <Input
                    id={id}
                    role="combobox"
                    aria-expanded={listOpen}
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    aria-activedescendant={listOpen && options[idx] ? `${uid}-opt-${options[idx].id}` : undefined}
                    placeholder="Name or badge number…"
                    value={query}
                    onFocus={() => setListOpen(true)}
                    onChange={(e) => { setQuery(e.target.value); setListOpen(true); setActiveIdx(0) }}
                    onKeyDown={onSearchKeyDown}
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field label="Department">
                {(id) => (
                  <Select id={id} value={bureauFilter} onChange={(e) => { setBureauFilter(e.target.value); setActiveIdx(0) }}>
                    <option value="all">All departments</option>
                    {Object.keys(BUREAUS).map((b) => <option key={b} value={b}>{bureauLabel(b)}</option>)}
                  </Select>
                )}
              </Field>
            </div>

            {listOpen && (
              <ul
                id={listboxId}
                role="listbox"
                aria-label="Eligible members"
                aria-multiselectable="true"
                className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-ink-950/70"
              >
                {options.map((p, i) => {
                  const on = selected.some((m) => m.officer_id === p.id)
                  return (
                    <li
                      key={p.id}
                      id={`${uid}-opt-${p.id}`}
                      role="option"
                      aria-selected={on}
                      onMouseDown={(e) => e.preventDefault() /* keep focus in the search input */}
                      onClick={() => toggle(p.id)}
                      onMouseMove={() => setActiveIdx(i)}
                      className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 px-3 py-2 ${i === idx ? 'bg-white/10' : ''}`}
                    >
                      <span>
                        <span className="block text-sm font-semibold text-white">{p.display_name || 'Officer'}</span>
                        <span className="block text-xs text-slate-400">{subLine(p)}</span>
                      </span>
                      {on && <span aria-hidden className="text-sm font-bold text-violet-300">✓</span>}
                    </li>
                  )
                })}
                {!options.length && <li className="px-3 py-3 text-sm text-slate-400">No eligible members match.</li>}
              </ul>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={onClose} className="min-h-[44px] rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5 sm:min-h-0">Cancel</button>
              <button onClick={goConfirm} disabled={!selected.length} className="min-h-[44px] rounded-lg bg-badge-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60 sm:min-h-0">Continue</button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 rounded-xl border border-white/10 bg-ink-950/50 p-4">
              <p className="text-sm font-semibold text-white">
                {mode === 'convert' ? 'Convert to joint case' : 'Add to joint case'} — {selected.length} member(s)
              </p>
              <ul className="mt-3 space-y-2">
                {selected.map((m) => (
                  <li key={m.officer_id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                    <span className="font-semibold text-slate-100">{nameOf(m.officer_id)}</span>
                    <span aria-hidden className="text-slate-500">→</span>
                    <span className="text-violet-300">{m.joint_role}</span>
                    <span className="text-xs text-slate-400">
                      {m.expires_at ? `expires ${fmtExpiry(m.expires_at)}` : 'no expiry'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setStep('pick')} disabled={busy} className="min-h-[44px] rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-60 sm:min-h-0">Back</button>
              <button onClick={() => void submit()} disabled={busy} className="min-h-[44px] rounded-lg bg-badge-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60 sm:min-h-0">
                {busy ? 'Saving…' : mode === 'convert' ? 'Confirm — create joint case' : 'Confirm — add members'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
