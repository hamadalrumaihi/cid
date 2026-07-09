'use client'

/** New/Edit person modal — vanilla persons.js openPersonModal(). Includes the
 *  repeatable Known Properties rows (collected as a jsonb array) and the
 *  gang-preservation guard: if the gangs cache hasn't loaded, the current gang
 *  id is kept as a placeholder option so an unrelated save can't null it.
 *  Mounted fresh per open. */
import { useState } from 'react'
import type { Json, Tables } from '@/lib/database.types'
import { deleteWithUndo, insert, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'

export type PersonRow = Tables<'persons'>
export type GangRow = Tables<'gangs'>

export interface PersonProperty { address: string; type: string; notes: string }

const PROPERTY_TYPES = ['Residence', 'Stash House', 'Front Business', 'Safehouse', 'Warehouse', 'Vehicle', 'Other']

export const parseProperties = (j: Json | null): PersonProperty[] =>
  Array.isArray(j)
    ? j.map((x) => (x && typeof x === 'object' ? (x as unknown as Partial<PersonProperty>) : {}))
        .map((x) => ({ address: x.address || '', type: x.type || 'Residence', notes: x.notes || '' }))
    : []

/** Cascade-null references restored by undo (vanilla persons.js:86). */
export const PERSON_NULL_REFS = [
  { table: 'gang_members' as const, column: 'person_id' },
  { table: 'vehicles' as const, column: 'owner_id' },
]

interface PersonModalProps {
  record: PersonRow | null
  /** Quick-add prefill for the "no persons match" inline create. */
  prefillName?: string
  gangs: GangRow[]
  onClose: () => void
  onSaved: () => void
}

export function PersonModal({ record, prefillName, gangs, onClose, onSaved }: PersonModalProps) {
  const { canDelete } = useAuth()
  const [name, setName] = useState(record?.name || prefillName || '')
  const [alias, setAlias] = useState(record?.alias || '')
  const [gangId, setGangId] = useState(record?.gang_id || '')
  const [status, setStatus] = useState(record?.status || 'Person of Interest')
  const [ccw, setCcw] = useState(!!record?.ccw)
  const [bolo, setBolo] = useState(!!record?.bolo)
  const [vch, setVch] = useState(String(record?.vch ?? 0))
  const [felonies, setFelonies] = useState(String(record?.felony_count ?? 0))
  const [mugshot, setMugshot] = useState(record?.mugshot_url || '')
  const [notes, setNotes] = useState(record?.notes || '')
  const [props, setProps] = useState<PersonProperty[]>(() => parseProperties(record?.properties ?? null))

  const gangKnown = !gangId || gangs.some((g) => g.id === gangId)

  const setProp = (i: number, patch: Partial<PersonProperty>) =>
    setProps((rows) => rows.map((r, x) => (x === i ? { ...r, ...patch } : r)))

  const save = async () => {
    if (!name.trim()) { toast('Name is required.', 'warn'); return }
    const payload = {
      name: name.trim(),
      alias: alias.trim() || null,
      gang_id: gangId || null,
      status: status.trim() || null,
      ccw, bolo,
      vch: Number(vch) || 0,
      felony_count: Number(felonies) || 0,
      mugshot_url: mugshot.trim() || null,
      notes: notes.trim() || null,
      properties: props
        .map((p) => ({ address: p.address.trim(), type: p.type, notes: p.notes.trim() }))
        .filter((p) => p.address || p.notes) as unknown as Json,
    }
    const res = record ? await update('persons', record.id, payload) : await insert('persons', payload)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(record ? 'Person updated' : 'Person created', 'success')
    onSaved()
  }

  const del = async () => {
    if (!record) return
    if (!(await uiConfirm(`Delete person "${record.name}"?`, { confirmText: 'Delete' }))) return
    onClose()
    await deleteWithUndo('persons', record, {
      label: `Person "${record.name}"`, noConfirm: true, after: onSaved, setNullRefs: PERSON_NULL_REFS,
    })
  }

  const dirty = () =>
    name.trim() !== (record?.name || prefillName || '') || alias.trim() !== (record?.alias || '') ||
    notes.trim() !== (record?.notes || '') || gangId !== (record?.gang_id || '')

  const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'
  return (
    <Modal open wide onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title={`${record ? 'Edit' : 'New'} Person`} onClose={onClose} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label htmlFor="person-name" className="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input id="person-name" value={name} onChange={(e) => setName(e.target.value)} className={input} /></div>
          <div><label htmlFor="person-alias" className="mb-1 block text-xs font-semibold text-slate-400">Alias</label><input id="person-alias" value={alias} onChange={(e) => setAlias(e.target.value)} className={input} /></div>
          <div>
            <label htmlFor="person-gang" className="mb-1 block text-xs font-semibold text-slate-400">Gang</label>
            <select id="person-gang" value={gangId} onChange={(e) => setGangId(e.target.value)} className={input}>
              <option value="">— no gang —</option>
              {!gangKnown && <option value={gangId}>(current gang — loading…)</option>}
              {gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div><label htmlFor="person-status" className="mb-1 block text-xs font-semibold text-slate-400">Status</label><input id="person-status" value={status} onChange={(e) => setStatus(e.target.value)} className={input} /></div>
          <div>
            <label htmlFor="person-ccw" className="mb-1 block text-xs font-semibold text-slate-400">CCW</label>
            <select id="person-ccw" value={ccw ? 'true' : 'false'} onChange={(e) => setCcw(e.target.value === 'true')} className={input}>
              <option value="false">No</option><option value="true">Yes</option>
            </select>
          </div>
          <div>
            <label htmlFor="person-bolo" className="mb-1 block text-xs font-semibold text-slate-400">Active BOLO</label>
            <select id="person-bolo" value={bolo ? 'true' : 'false'} onChange={(e) => setBolo(e.target.value === 'true')} className={input}>
              <option value="false">No</option><option value="true">Yes — be on the lookout</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="person-vch" className="mb-1 block text-xs font-semibold text-slate-400">VCH</label><input id="person-vch" type="number" value={vch} onChange={(e) => setVch(e.target.value)} className={input} /></div>
            <div><label htmlFor="person-felonies" className="mb-1 block text-xs font-semibold text-slate-400">Felonies</label><input id="person-felonies" type="number" value={felonies} onChange={(e) => setFelonies(e.target.value)} className={input} /></div>
          </div>
          <div className="sm:col-span-2"><label htmlFor="person-mugshot" className="mb-1 block text-xs font-semibold text-slate-400">Mugshot URL</label><input id="person-mugshot" value={mugshot} onChange={(e) => setMugshot(e.target.value)} className={input} /></div>
          <div className="sm:col-span-2"><label htmlFor="person-notes" className="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea id="person-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} /></div>
          <div className="sm:col-span-2">
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-xs font-semibold text-slate-400">Known Properties</label>
              <button type="button" onClick={() => setProps((r) => [...r, { address: '', type: 'Residence', notes: '' }])} className="text-xs font-semibold text-blue-300 transition hover:text-blue-200">+ Add property</button>
            </div>
            <div className="space-y-2">
              {props.map((pr, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink-900 p-2">
                  <input value={pr.address} onChange={(e) => setProp(i, { address: e.target.value })} placeholder="Address / location" className="min-w-[10rem] flex-1 rounded-md border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-white outline-none focus:border-badge-500" />
                  <select value={pr.type} onChange={(e) => setProp(i, { type: e.target.value })} className="rounded-md border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-white outline-none focus:border-badge-500">
                    {PROPERTY_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <input value={pr.notes} onChange={(e) => setProp(i, { notes: e.target.value })} placeholder="Notes (optional)" className="min-w-[8rem] flex-1 rounded-md border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-white outline-none focus:border-badge-500" />
                  <button type="button" aria-label="Remove property" onClick={() => setProps((r) => r.filter((_, x) => x !== i))} className="-my-1 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-xs text-rose-300 transition hover:bg-rose-500/10">✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={() => void save()} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
            {record ? 'Save changes' : 'Create person'}
          </button>
          {record && canDelete && (
            <button onClick={() => void del()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>
          )}
        </div>
      </div>
    </Modal>
  )
}
