'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { deleteWithUndo, list, insert, update } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { OPS_CASE_COLS, OP_SEG_COLOR, OP_STATUSES, opStatusTint, type OpsCaseRow, useOperationsStore } from '@/lib/operations'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'

type OperationRow = Tables<'operations'>

export function OperationsView() {
  const router = useRouter()
  const sp = useSearchParams()
  const { canEdit, canDelete } = useAuth()
  const operations = useOperationsStore((s) => s.operations)
  const fetchOps = useOperationsStore((s) => s.fetch)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [cases, setCases] = useState<OpsCaseRow[]>([])
  const [modal, setModal] = useState<OperationRow | null | 'new'>(null)
  const version = useTableVersion('operations')
  const casesVersion = useTableVersion('cases')
  const opId = sp.get('op')

  const refresh = useCallback(async () => {
    void fetchProfiles()
    await fetchOps()
    try { setCases((await list('cases', { select: OPS_CASE_COLS, order: 'updated_at', ascending: false })) as unknown as OpsCaseRow[]) } catch { /* stale */ }
  }, [fetchOps, fetchProfiles])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, version, casesVersion])

  const selected = operations.find((o) => o.id === opId)
  if (opId && selected) return <OperationDetail op={selected} cases={cases.filter((c) => c.operation_id === opId)} unlinked={cases.filter((c) => !c.operation_id)} canEdit={canEdit} canDelete={canDelete} onBack={() => router.push('/operations')} onChanged={refresh} onEdit={() => setModal(selected)} />

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">ACTIVE TASK FORCES</p><h2 className="text-2xl font-black text-white">Operations</h2></div>
        {canEdit && <button onClick={() => setModal('new')} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-2 text-sm font-bold text-white">New Operation</button>}
      </header>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {operations.map((op) => <OperationCard key={op.id} op={op} cases={cases.filter((c) => c.operation_id === op.id)} onOpen={() => router.push(`/operations?op=${op.id}`)} />)}
      </div>
      {!operations.length && <p className="rounded-2xl border border-white/10 bg-ink-900/50 p-8 text-center text-sm text-slate-400">No operations yet.</p>}
      <OperationModal open={!!modal} record={modal === 'new' ? null : modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); void refresh() }} />
    </div>
  )
}

function OperationCard({ op, cases, onOpen }: { op: OperationRow; cases: OpsCaseRow[]; onOpen: () => void }) {
  const counts = OP_STATUSES.map((s) => cases.filter((c) => c.status === s).length)
  const total = Math.max(1, cases.length)
  return (
    <button onClick={onOpen} className="rounded-2xl border border-white/10 bg-ink-900/60 p-4 text-left transition hover:border-badge-400/50">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-black text-white">{op.name}</h3>
        <span className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${opStatusTint(op.status)}`}>{op.status}</span>
      </div>
      <p className="mt-2 line-clamp-3 min-h-[3.75rem] text-sm text-slate-400">{op.description || 'No description recorded.'}</p>
      <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-white/5">
        {OP_STATUSES.map((s, i) => <span key={s} className={OP_SEG_COLOR[s]} style={{ width: `${(counts[i] / total) * 100}%` }} />)}
      </div>
      <p className="mt-3 text-xs text-slate-500">{cases.length} linked cases - updated {timeAgo(op.updated_at)}</p>
    </button>
  )
}

function OperationDetail({ op, cases, unlinked, canEdit, canDelete, onBack, onChanged, onEdit }: { op: OperationRow; cases: OpsCaseRow[]; unlinked: OpsCaseRow[]; canEdit: boolean; canDelete: boolean; onBack: () => void; onChanged: () => void; onEdit: () => void }) {
  const router = useRouter()
  const [pick, setPick] = useState('')
  const linkCase = async () => {
    if (!pick) return
    const res = await update('cases', pick, { operation_id: op.id })
    if (res.error) toast(res.error.message, 'danger')
    else { setPick(''); toast('Case linked.', 'success'); onChanged() }
  }
  const unlink = async (id: string) => {
    const res = await update('cases', id, { operation_id: null })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Case unlinked.', 'success'); onChanged() }
  }
  const del = async () => {
    const ok = await deleteWithUndo('operations', op, { label: op.name, setNullRefs: [{ table: 'cases', column: 'operation_id' }] })
    if (ok) { onBack(); onChanged() }
  }
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm font-semibold text-badge-200 hover:text-white">Back to operations</button>
      <section className="rounded-2xl border border-white/10 bg-ink-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className={`mb-2 inline-flex rounded-full px-2 py-1 text-xs font-bold uppercase ${opStatusTint(op.status)}`}>{op.status}</p><h2 className="text-2xl font-black text-white">{op.name}</h2><p className="mt-2 max-w-3xl text-sm text-slate-300">{op.description || 'No description recorded.'}</p></div>
          <div className="flex gap-2">{canEdit && <button onClick={onEdit} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-bold text-white">Edit</button>}{canDelete && <button onClick={() => void del()} className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-bold text-white">Delete</button>}</div>
        </div>
      </section>
      {canEdit && <div className="flex gap-2 rounded-2xl border border-white/10 bg-ink-900/50 p-3">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white"><option value="">Link a case...</option>{unlinked.map((c) => <option key={c.id} value={c.id}>{c.case_number} - {c.title}</option>)}</select>
        <button onClick={linkCase} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Link</button>
      </div>}
      <div className="space-y-2">
        {cases.map((c) => <div key={c.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-950/50 p-3"><button onClick={() => router.push(`/cases?case=${c.id}`)} className="min-w-0 flex-1 text-left"><p className="font-mono text-sm font-bold text-badge-200">{c.case_number}</p><p className="font-semibold text-white">{c.title || 'Untitled case'}</p><p className="text-xs text-slate-500">{c.bureau} - {c.status} - {officerName(c.lead_detective_id) || 'Unassigned'}</p></button>{canEdit && <button onClick={() => void unlink(c.id)} className="text-sm font-bold text-rose-300">Unlink</button>}</div>)}
        {!cases.length && <p className="rounded-2xl border border-white/10 bg-ink-900/50 p-8 text-center text-sm text-slate-400">No cases linked to this operation.</p>}
      </div>
    </div>
  )
}

function OperationModal({ open, record, onClose, onSaved }: { open: boolean; record: OperationRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [status, setStatus] = useState('active')
  const [description, setDescription] = useState('')
  useEffect(() => { if (open) queueMicrotask(() => { setName(record?.name ?? ''); setStatus(record?.status ?? 'active'); setDescription(record?.description ?? '') }) }, [open, record])
  const save = async () => {
    if (!name.trim()) { toast('Operation name is required.', 'warn'); return }
    const patch = { name: name.trim(), status, description: description.trim() || null }
    const res = record ? await update('operations', record.id, patch) : await insert('operations', patch)
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Operation saved.', 'success'); onSaved() }
  }
  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-5">
        <ModalHeader title={record ? 'Edit operation' : 'New operation'} onClose={onClose} />
        <div className="space-y-3">
          <label className="block text-sm text-slate-300">Name<input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" /></label>
          <label className="block text-sm text-slate-300">Status<select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white"><option value="active">Active</option><option value="closed">Closed</option></select></label>
          <label className="block text-sm text-slate-300">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" /></label>
        </div>
        <div className="mt-5 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200">Cancel</button><button onClick={save} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white">Save</button></div>
      </div>
    </Modal>
  )
}
