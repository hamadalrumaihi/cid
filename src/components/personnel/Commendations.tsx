'use client'

/** Medals & support commendations — vanilla personnel.js:51-96. Tinted
 *  gradient cards; any active member can award/edit, command can delete
 *  (with undo). Recipient is free text with the roster cache as fallback
 *  name resolution. */
import { useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { deleteWithUndo, insert, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { Modal, ModalHeader } from '@/components/ui/Modal'

export type CommendationRow = Tables<'commendations'>

const COMM_TINTS: Record<string, string> = {
  amber: 'from-amber-500/20 to-amber-700/5 border-amber-500/20',
  blue: 'from-blue-500/20 to-blue-700/5 border-blue-500/20',
  violet: 'from-violet-500/20 to-violet-700/5 border-violet-500/20',
  emerald: 'from-emerald-500/20 to-emerald-700/5 border-emerald-500/20',
}
const TINT_KEYS = ['amber', 'blue', 'violet', 'emerald']

export function Commendations({ rows, onChanged }: { rows: CommendationRow[]; onChanged: () => void }) {
  const { state, canEdit } = useAuth()
  /** null = closed · 'new' = award · row = edit. */
  const [editing, setEditing] = useState<CommendationRow | 'new' | null>(null)

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Medals &amp; Support Commendations</h2>
        {canEdit && (
          <button onClick={() => setEditing('new')} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10">
            + Award Commendation
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state !== 'in' ? (
          <p className="text-sm text-slate-500 sm:col-span-2 lg:col-span-3">Sign in to view commendations.</p>
        ) : !rows.length ? (
          <p className="text-sm text-slate-500 sm:col-span-2 lg:col-span-3">No commendations.{canEdit ? ' Use "+ Award Commendation".' : ''}</p>
        ) : rows.map((c) => (
          <div key={c.id} className={`relative rounded-2xl border bg-gradient-to-br ${COMM_TINTS[c.tint || 'amber'] || COMM_TINTS.amber} p-5`}>
            <div className="flex items-start gap-3">
              <span className="text-3xl" aria-hidden="true">{c.icon || '🎖️'}</span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">{c.title}</p>
                <p className="text-xs text-slate-300">{c.recipient_name || officerName(c.recipient_id) || '—'}</p>
              </div>
              {canEdit && <button onClick={() => setEditing(c)} className="-m-2 p-2 text-[11px] text-slate-400 hover:text-white">edit</button>}
            </div>
            <p className="mt-3 text-xs text-slate-300">{c.note || ''}</p>
          </div>
        ))}
      </div>
      {editing !== null && (
        <CommendModal
          record={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged() }}
        />
      )}
    </div>
  )
}

/** Mounted fresh per open — initializers seed from the record being edited. */
function CommendModal({ record, onClose, onSaved }: { record: CommendationRow | null; onClose: () => void; onSaved: () => void }) {
  const { canDelete } = useAuth()
  const [title, setTitle] = useState(record?.title || '')
  const [recipient, setRecipient] = useState(record?.recipient_name || '')
  const [icon, setIcon] = useState(record?.icon || '🎖️')
  const [tint, setTint] = useState(record?.tint || 'amber')
  const [note, setNote] = useState(record?.note || '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!title.trim()) { toast('Title required.', 'warn'); return }
    setBusy(true)
    const patch = { title: title.trim(), recipient_name: recipient.trim(), icon: icon.trim(), tint, note: note.trim() }
    const res = record ? await update('commendations', record.id, patch) : await insert('commendations', patch)
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(record ? 'Commendation updated' : 'Commendation awarded', 'success')
    onSaved()
  }

  const del = async () => {
    if (!record) return
    onClose()
    await deleteWithUndo('commendations', record, { label: 'Commendation', after: onSaved })
  }

  const dirty = () =>
    title.trim() !== (record?.title || '') || recipient.trim() !== (record?.recipient_name || '') || note.trim() !== (record?.note || '')

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title={`${record ? 'Edit' : 'New'} Commendation`} onClose={onClose} />
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Recipient</label>
            <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Officer name" className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Icon</label>
              <input value={icon} onChange={(e) => setIcon(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Color</label>
              <select value={tint} onChange={(e) => setTint(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">
                {TINT_KEYS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Note</label>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={() => void save()} disabled={busy} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
            {busy ? 'Saving…' : record ? 'Save' : 'Award'}
          </button>
          {record && canDelete && (
            <button onClick={() => void del()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">
              Delete
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
