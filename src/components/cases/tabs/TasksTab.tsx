'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'
import { insert, list, update, deleteWithUndo } from '@/lib/db'
import { deadlineInfo } from '@/lib/deadlines'
import { caseLink } from '@/lib/caseLinks'
import { copyText } from '@/lib/format'
import { useNow } from '@/lib/useNow'
import { officerName, activeProfiles } from '@/lib/profiles'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { type CaseRow, type TaskRow } from './shared'

/** Urgency buckets — overdue first, then due within 48h, then the rest of the
 *  open work; completed tasks collapse out of the way. The case follow-up
 *  (set from the header's Follow-up button) files into the same buckets so
 *  one list carries everything with a date on it. */
type Bucket = 'overdue' | 'soon' | 'open' | 'done'
const BUCKETS: { id: Bucket; label: string }[] = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'soon', label: 'Due soon' },
  { id: 'open', label: 'Open' },
]

const bucketOf = (done: boolean, due: string | null, now: number): Bucket => {
  if (done) return 'done'
  const info = deadlineInfo(due, 'due', { now, urgentHours: 48 })
  if (info?.overdue) return 'overdue'
  if (info?.urgent) return 'soon'
  return 'open'
}

function TaskItem({ t, c, canEdit, canDelete, holdActive, highlight, refCb, onToggle, refresh }: {
  t: TaskRow; c: CaseRow; canEdit: boolean; canDelete: boolean; holdActive: boolean; highlight: boolean
  refCb: (el: HTMLDivElement | null) => void; onToggle: (t: TaskRow) => void; refresh: () => void
}) {
  return (
    <div ref={refCb} className={`flex items-center gap-3 rounded-xl border bg-ink-950/50 p-3 ${highlight ? 'border-badge-400/60 ring-1 ring-badge-400/40' : 'border-white/10'}`}>
      <input type="checkbox" checked={t.done} disabled={!canEdit} aria-label={`Mark task ${t.done ? 'open' : 'done'}: ${t.title}`} onChange={() => onToggle(t)} />
      <div className="min-w-0 flex-1"><p className={`font-semibold ${t.done ? 'text-slate-500 line-through' : 'text-white'}`}>{t.title}</p><p className="text-xs text-slate-500">{officerName(t.assignee) || 'Unassigned'}{t.done && t.due ? ` - due ${t.due}` : ''}{!t.done && t.due && <DeadlineChip at={t.due} kind="due" className="ml-2" />}</p></div>
      <button aria-label={`Copy link to task: ${t.title}`} onClick={() => copyText(`${window.location.origin}${caseLink(c.id, 'tasks', { task: t.id })}`, 'Task link')} className="text-sm font-bold text-slate-400 hover:text-slate-200">Link</button>
      {canDelete && (holdActive
        ? <span title="A legal hold preserves this case's tasks" className="text-sm font-bold text-rose-300/50">Held</span>
        : <button aria-label={`Delete task: ${t.title}`} onClick={() => void deleteWithUndo('case_tasks', t, { confirmTitle: 'Delete task', confirmMessage: `Delete “${t.title}”? Any sub-tasks under it are removed too. You can undo this for a few seconds.`, confirmText: 'Delete task', label: 'task', children: [{ table: 'case_tasks', column: 'parent_id' }], after: refresh })} className="text-sm font-bold text-rose-300 hover:text-rose-200">Delete</button>)}
    </div>
  )
}

/** The case-level follow-up rendered as a read-only row in its urgency
 *  bucket — it is edited from the case header, not here. */
function FollowUpItem({ at }: { at: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
      <span aria-hidden>📌</span>
      <div className="min-w-0 flex-1"><p className="font-semibold text-amber-200">Case follow-up</p><p className="text-xs text-slate-500">Set from the case header <DeadlineChip at={at} kind="due" className="ml-2" /></p></div>
    </div>
  )
}

export function TasksTab({ c, canEdit, canDelete, holdActive = false }: { c: CaseRow; canEdit: boolean; canDelete: boolean; holdActive?: boolean }) {
  const { profile } = useAuth()
  const sp = useSearchParams()
  const now = useNow()
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState<PickedRecord | null>(null)
  const [due, setDue] = useState('')
  // null = auto: collapsed unless a ?task= deep link targets a completed row.
  const [showDone, setShowDone] = useState<boolean | null>(null)
  // A load failure surfaces with Retry (IntelTab's rule: a fetch error must
  // never read as an empty "No tasks yet"). Cleared on the next good fetch.
  const [err, setErr] = useState<unknown>(null)
  const v = useTableVersion('case_tasks')
  const refresh = useCallback(async () => {
    try {
      setTasks(await list('case_tasks', { eq: { case_id: c.id }, order: 'due', nullsFirst: false }))
      setErr(null)
    } catch (e) { setErr(e) }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  // Assignee search-picker source — a client-side filter over the cached
  // roster (activeProfiles()), same pool the old <select> listed; no queries.
  const searchRoster = useCallback(async (q: string): Promise<PickedRecord[]> => {
    const needle = q.trim().toLowerCase()
    return activeProfiles()
      .filter((p) => !needle
        || (p.display_name ?? '').toLowerCase().includes(needle)
        || (p.badge_number ?? '').toLowerCase().includes(needle))
      .slice(0, 20)
      .map((p) => ({
        id: p.id,
        label: officerName(p.id) || p.display_name || 'Officer',
        ...(p.badge_number ? { sublabel: `Badge ${p.badge_number}` } : {}),
      }))
  }, [])

  // ?task= deep link: scroll the referenced row into view once. Highlight is
  // a ring only — focus is never moved or trapped.
  const taskParam = sp.get('task')
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const scrolledRef = useRef<string | null>(null)
  useEffect(() => {
    if (!taskParam || scrolledRef.current === taskParam) return
    const el = rowRefs.current[taskParam]
    if (!el) return
    scrolledRef.current = taskParam
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [taskParam, tasks])

  const [adding, setAdding] = useState(false)
  const add = async () => {
    if (!title.trim() || adding) return
    setAdding(true)
    const taskTitle = title.trim()
    const taskAssignee = assignee?.id ?? ''
    const res = await insert('case_tasks', { case_id: c.id, title: taskTitle, assignee: taskAssignee || null, due: due || null })
    setAdding(false)
    if (res.error) toast(res.error.message, 'danger')
    else {
      // Let the assignee know (unless they assigned it to themselves) — the
      // notification carries case_id, so the bell deep-links to the case.
      if (taskAssignee && taskAssignee !== profile?.id) {
        void notify(taskAssignee, 'task_assigned', { case_id: c.id, case_number: c.case_number, title: taskTitle })
      }
      setTitle(''); setAssignee(null); setDue(''); toast('Task added.', 'success'); void refresh()
    }
  }
  const toggle = async (t: TaskRow) => {
    const res = await update('case_tasks', t.id, { done: !t.done })
    if (res.error) toast(res.error.message, 'danger')
    else void refresh()
  }

  if (err) return <ErrorNotice message={err} onRetry={() => void refresh()} />

  // The due-ordered fetch (earliest first, undated last) is preserved inside
  // each bucket, so the sharpest deadline always tops its group.
  const grouped: Record<Bucket, TaskRow[]> = { overdue: [], soon: [], open: [], done: [] }
  for (const t of tasks) grouped[bucketOf(t.done, t.due, now)].push(t)
  const followBucket = c.follow_up_at ? bucketOf(false, c.follow_up_at, now) : null
  const done = grouped.done
  // A ?task= deep link into the completed group opens it so the target row
  // exists to scroll to (derived, not stateful); the toggle still overrides.
  const doneVisible = showDone ?? (!!taskParam && done.some((t) => t.id === taskParam))
  const item = (t: TaskRow) => (
    <TaskItem key={t.id} t={t} c={c} canEdit={canEdit} canDelete={canDelete} holdActive={holdActive}
      highlight={t.id === taskParam} refCb={(el) => { rowRefs.current[t.id] = el }}
      onToggle={(x) => void toggle(x)} refresh={() => void refresh()} />
  )
  return (
    <div className="space-y-3">
      {canEdit && <div className="grid items-start gap-2 rounded-xl border border-white/10 bg-ink-950/50 p-3 md:grid-cols-[minmax(0,1fr)_14rem_10rem_auto]">
        <Field label="New task">
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void add() }} placeholder="What needs doing?" />}
        </Field>
        <RecordSearchPicker label="Assignee" value={assignee} onChange={setAssignee} search={searchRoster} placeholder="Unassigned — search roster…" />
        <Field label="Due date">
          {(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
        </Field>
        <Button variant="primary" className="md:mt-5" onClick={() => void add()} disabled={adding}>Add</Button>
      </div>}
      {BUCKETS.map(({ id, label }) => {
        const items = grouped[id]
        const withFollow = followBucket === id
        if (!items.length && !withFollow) return null
        return (
          <section key={id} aria-label={`${label} tasks`} className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">{label} <span className="font-normal text-slate-500">({items.length + (withFollow ? 1 : 0)})</span></h3>
            {withFollow && c.follow_up_at && <FollowUpItem at={c.follow_up_at} />}
            {items.map(item)}
          </section>
        )
      })}
      {done.length > 0 && (
        <section className="space-y-2">
          <button onClick={() => setShowDone(!doneVisible)} aria-expanded={doneVisible} className="flex min-h-[40px] items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-200">
            Completed <span className="font-normal text-slate-500">({done.length})</span> <span aria-hidden>{doneVisible ? '▴' : '▾'}</span>
          </button>
          {doneVisible && done.map(item)}
        </section>
      )}
      {!tasks.length && !c.follow_up_at && (
        <EmptyState
          title="No tasks yet"
          hint={canEdit ? 'Add the first task above — assign an officer and set a due date so it files into the urgency buckets.' : 'Tasks and the case follow-up appear here, bucketed by urgency.'}
        />
      )}
    </div>
  )
}
