'use client'

import { useCallback, useEffect, useState } from 'react'
import { insert, list, remove, update } from '@/lib/db'
import { officerName, activeProfiles } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { mutateThen, type CaseRow, type TaskRow } from './shared'

export function TasksTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState('')
  const [due, setDue] = useState('')
  const v = useTableVersion('case_tasks')
  const refresh = useCallback(async () => { try { setTasks(await list('case_tasks', { eq: { case_id: c.id }, order: 'due', nullsFirst: false })) } catch { /* stale ok */ } }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  const [adding, setAdding] = useState(false)
  const add = async () => {
    if (!title.trim() || adding) return
    setAdding(true)
    const res = await insert('case_tasks', { case_id: c.id, title: title.trim(), assignee: assignee || null, due: due || null })
    setAdding(false)
    if (res.error) toast(res.error.message, 'danger')
    else { setTitle(''); setAssignee(''); setDue(''); toast('Task added.', 'success'); void refresh() }
  }
  const toggle = async (t: TaskRow) => {
    const res = await update('case_tasks', t.id, { done: !t.done })
    if (res.error) toast(res.error.message, 'danger')
    else void refresh()
  }
  return (
    <div className="space-y-3">
      {canEdit && <div className="grid gap-2 rounded-xl border border-white/10 bg-ink-950/50 p-3 md:grid-cols-[1fr_12rem_10rem_auto]">
        <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} placeholder="New task" className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />
        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white"><option value="">Unassigned</option>{activeProfiles().map((p) => <option key={p.id} value={p.id}>{officerName(p.id) || p.display_name}</option>)}</select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />
        <button onClick={() => void add()} disabled={adding} className="rounded-lg bg-badge-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-60">Add</button>
      </div>}
      {tasks.map((t) => <div key={t.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-ink-950/50 p-3">
        <input type="checkbox" checked={t.done} disabled={!canEdit} onChange={() => void toggle(t)} />
        <div className="min-w-0 flex-1"><p className={`font-semibold ${t.done ? 'text-slate-500 line-through' : 'text-white'}`}>{t.title}</p><p className="text-xs text-slate-500">{officerName(t.assignee) || 'Unassigned'}{t.due ? ` - due ${t.due}` : ''}</p></div>
        {canDelete && <button onClick={() => mutateThen(remove('case_tasks', t.id), refresh)} className="text-sm font-bold text-rose-300">Delete</button>}
      </div>)}
      {!tasks.length && <p className="py-8 text-center text-sm text-slate-500">No tasks yet.</p>}
    </div>
  )
}
