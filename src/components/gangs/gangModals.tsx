'use client'

import { useMemo, useState } from 'react'
import { insert, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { toast } from '@/lib/toast'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { cap, RANK_SUGGEST, type CaseOption, type Density, type GangRow, type MemberRow, type PersonRow, type ThreatLevel } from './gangShared'

export function GangModal({ record, onClose, onSaved }: { record: GangRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(record?.name || '')
  const [colors, setColors] = useState(record?.colors || '')
  const [threat, setThreat] = useState<ThreatLevel>(record?.threat_level || 'medium')
  const [notes, setNotes] = useState(record?.notes || '')
  const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'

  const save = async () => {
    if (!name.trim()) { toast('Gang name is required.', 'warn'); return }
    const payload = { name: name.trim(), colors: colors.trim() || null, threat_level: threat, notes: notes.trim() || null }
    const res = record ? await update('gangs', record.id, payload) : await insert('gangs', payload)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(record ? 'Gang updated' : 'Gang created', 'success')
    onSaved()
  }

  const dirty = () =>
    name.trim() !== (record?.name || '') || colors.trim() !== (record?.colors || '') ||
    threat !== (record?.threat_level || 'medium') || notes.trim() !== (record?.notes || '')

  return (
    <Modal open wide onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title={`${record ? 'Edit' : 'New'} Gang`} onClose={onClose} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input value={name} onChange={(e) => setName(e.target.value)} className={input} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Colors</label><input value={colors} onChange={(e) => setColors(e.target.value)} className={input} /></div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Threat Level</label>
            <select value={threat} onChange={(e) => setThreat(e.target.value as ThreatLevel)} className={input}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} /></div>
        </div>
        <button onClick={() => void save()} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
          {record ? 'Save changes' : 'Create gang'}
        </button>
      </div>
    </Modal>
  )
}

export function MemberModal({ gangId, member, people, cases, canDelete, onClose, onSaved, onDelete }: {
  gangId: string
  member: MemberRow | null
  people: PersonRow[]
  cases: CaseOption[]
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
  onDelete: (member: MemberRow) => void
}) {
  const [name, setName] = useState(member?.name || '')
  const [rank, setRank] = useState(member?.rank || 'Soldier')
  const [callsign, setCallsign] = useState(member?.callsign || '')
  const [status, setStatus] = useState(member?.status || 'At Large')
  const [personId, setPersonId] = useState(member?.person_id || '')
  const [caseId, setCaseId] = useState(member?.case_id || '')
  const [ccw, setCcw] = useState(!!member?.ccw)
  const [vch, setVch] = useState(String(member?.vch ?? 0))
  const [felonies, setFelonies] = useState(String(member?.felony_count ?? 0))
  const [mugshot, setMugshot] = useState(member?.mugshot_url || '')

  const personKnown = !personId || people.some((p) => p.id === personId)
  const caseKnown = !caseId || cases.some((c) => c.id === caseId)
  const [busy, setBusy] = useState(false)
  const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'

  const save = async () => {
    if (!name.trim()) { toast('Name is required.', 'warn'); return }
    setBusy(true)
    const payload = {
      gang_id: gangId,
      name: name.trim(),
      rank: rank.trim() || null,
      callsign: callsign.trim() || null,
      status: status.trim() || null,
      person_id: personId || null,
      case_id: caseId || null,
      ccw,
      vch: Number(vch) || 0,
      felony_count: Number(felonies) || 0,
      mugshot_url: mugshot.trim() || null,
    }
    const res = member ? await update('gang_members', member.id, payload) : await insert('gang_members', payload)
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Member saved', 'success')
    onSaved()
  }

  return (
    <Modal open wide onClose={onClose}>
      <div className="p-6">
        <ModalHeader title={`${member ? 'Edit' : 'Add'} Member`} onClose={onClose} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input value={name} onChange={(e) => setName(e.target.value)} className={input} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Rank</label><input list="gang-rank-list" value={rank} onChange={(e) => setRank(e.target.value)} className={input} /><datalist id="gang-rank-list">{RANK_SUGGEST.map((r) => <option key={r} value={r} />)}</datalist></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Callsign</label><input value={callsign} onChange={(e) => setCallsign(e.target.value)} className={input} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Status</label><input value={status} onChange={(e) => setStatus(e.target.value)} className={input} /></div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Link Person</label>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} className={input}>
              <option value="">- link person (optional) -</option>
              {!personKnown && <option value={personId}>(linked person - loading...)</option>}
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Link Case</label>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className={input}>
              <option value="">- link case (optional) -</option>
              {!caseKnown && <option value={caseId}>(linked case - other bureau)</option>}
              {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">CCW</label>
            <select value={ccw ? 'true' : 'false'} onChange={(e) => setCcw(e.target.value === 'true')} className={input}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-xs font-semibold text-slate-400">VCH</label><input type="number" value={vch} onChange={(e) => setVch(e.target.value)} className={input} /></div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-400">Felonies</label><input type="number" value={felonies} onChange={(e) => setFelonies(e.target.value)} className={input} /></div>
          </div>
          <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-400">Mugshot URL</label><input value={mugshot} onChange={(e) => setMugshot(e.target.value)} className={input} /></div>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={() => void save()} disabled={busy} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
            {busy ? 'Saving…' : member ? 'Save' : 'Add member'}
          </button>
          {member && canDelete && <button onClick={() => onDelete(member)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>}
        </div>
      </div>
    </Modal>
  )
}

export function TurfModal({ gangId, onClose, onSaved }: { gangId: string; onClose: () => void; onSaved: () => void }) {
  const [block, setBlock] = useState('')
  const [density, setDensity] = useState<Density>('low')
  const [hotspot, setHotspot] = useState('')
  const [busy, setBusy] = useState(false)
  const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'

  const save = async () => {
    if (!block.trim()) { toast('Block is required.', 'warn'); return }
    setBusy(true)
    const res = await insert('gang_turf', { gang_id: gangId, block: block.trim(), density, hotspot_area: hotspot.trim() || null })
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Turf added', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="Add Turf Block" onClose={onClose} />
        <div className="space-y-3">
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Block / Territory *</label><input value={block} onChange={(e) => setBlock(e.target.value)} className={input} /></div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Density</label>
            <select value={density} onChange={(e) => setDensity(e.target.value as Density)} className={input}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Hotspot Area</label><input value={hotspot} onChange={(e) => setHotspot(e.target.value)} className={input} /></div>
        </div>
        <button onClick={() => void save()} disabled={busy} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">{busy ? 'Saving…' : 'Add Turf'}</button>
      </div>
    </Modal>
  )
}

export function AttachGangModal({ gang, caseOptions, onClose }: { gang: GangRow; caseOptions: CaseOption[]; onClose: () => void }) {
  const { profile } = useAuth()
  const sorted = useMemo(
    () => caseOptions.slice().sort((a, b) => (a.case_number || '').localeCompare(b.case_number || '')),
    [caseOptions],
  )
  const [caseId, setCaseId] = useState(sorted[0]?.id || '')
  const label = `Gang - ${gang.name}${gang.colors ? ` (${gang.colors})` : ''} · ${cap(gang.threat_level)} threat`

  const go = async () => {
    if (!caseId) return
    const res = await insert('case_messages', {
      case_id: caseId,
      author_name: profile?.display_name || 'CID',
      body: `Intel reference - ${label}`,
      mentions: [],
      links: [],
    })
    if (res.error) { toast(`Attach failed: ${res.error.message}`, 'danger'); return }
    const num = sorted.find((c) => c.id === caseId)?.case_number || 'case'
    toast(`Reference posted to ${num} channel`, 'success')
    onClose()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="Attach to case" onClose={onClose} />
        <p className="mb-3 text-sm text-slate-400">Posts a reference to <span className="text-white">{label}</span> into the case channel.</p>
        {sorted.length ? (
          <>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Case to attach the reference to" className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">
              {sorted.map((c) => <option key={c.id} value={c.id}>{c.case_number} · {c.title || ''}</option>)}
            </select>
            <button onClick={() => void go()} className="mt-4 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
              Attach reference
            </button>
          </>
        ) : (
          <p className="text-sm text-slate-500">No cases available to attach to.</p>
        )}
      </div>
    </Modal>
  )
}
