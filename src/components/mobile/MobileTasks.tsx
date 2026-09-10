'use client'

/** Tasks — open first (due-ordered, undated last), completed / waived behind
 *  a toggle. Quick actions make the SAME writes TasksTab makes: add →
 *  insert('case_tasks', { case_id, title, assignee: null, due }); done →
 *  update('case_tasks', id, { done }). Assignee, waive, delete and links
 *  stay on the desktop. */
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { insert, list, update } from '@/lib/db'
import { officerName } from '@/lib/profiles'
import { useCaseTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import type { TaskRow } from '@/components/cases/tabs/shared'
import { writeRefusal } from '@/components/cases/sections/sectionShared'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { DesktopOnlyCard, type MobileCase } from './mobileShared'

function TaskCard({ t, canEdit, onToggle }: { t: TaskRow; canEdit: boolean; onToggle: (t: TaskRow) => void }) {
  const waived = !!t.waived_at
  const closed = t.done || waived
  return (
    <li className="flex min-h-[44px] items-center gap-3 rounded-lg border border-white/10 bg-ink-950/50 p-3">
      <input
        type="checkbox"
        className="h-5 w-5 flex-shrink-0 accent-badge-500"
        checked={t.done}
        disabled={!canEdit}
        aria-label={`Mark task ${t.done ? 'open' : 'done'}: ${t.title}`}
        onChange={() => onToggle(t)}
      />
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-semibold ${closed ? 'text-slate-400 line-through' : 'text-white'}`}>{t.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
          <span>{officerName(t.assignee) || 'Unassigned'}</span>
          {!closed && t.due && <DeadlineChip at={t.due} kind="due" />}
          {closed && t.due && <span>due {t.due}</span>}
          {waived && <Badge tone="warn" title={t.waive_reason ? `Waived: ${t.waive_reason}` : 'Waived'}>Waived</Badge>}
        </p>
      </div>
    </li>
  )
}

export function MobileTasks({ c, canEdit }: { c: MobileCase; canEdit: boolean }) {
  const [tasks, setTasks] = useState<TaskRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [title, setTitle] = useState('')
  const [due, setDue] = useState('')
  const [adding, setAdding] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const v = useCaseTableVersion('case_tasks', c.id)

  const refresh = useCallback(async () => {
    try {
      setTasks(await list('case_tasks', { eq: { case_id: c.id }, order: 'due', nullsFirst: false }))
      setError(null)
    } catch (e) { setError(e) }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const clean = title.trim()
    if (!clean || adding) return
    setAdding(true)
    const res = await insert('case_tasks', { case_id: c.id, title: clean, assignee: null, due: due || null })
    setAdding(false)
    const refusal = writeRefusal(res)
    if (refusal) { toast(refusal, 'danger'); return }
    setTitle(''); setDue('')
    toast('Task added.', 'success')
    void refresh()
  }
  const toggle = async (t: TaskRow) => {
    const res = await update('case_tasks', t.id, { done: !t.done })
    const refusal = writeRefusal(res)
    if (refusal) { toast(refusal, 'danger'); return }
    void refresh()
  }

  const open = (tasks ?? []).filter((t) => !t.done && !t.waived_at)
  const done = (tasks ?? []).filter((t) => t.done || !!t.waived_at)

  return (
    <>
      {canEdit && (
        <Card pad="sm">
          <form onSubmit={(e) => void add(e)} className="space-y-3">
            <Field label="New task">
              {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" autoComplete="off" />}
            </Field>
            <div className="flex items-end gap-2">
              <Field label="Due date (optional)" className="min-w-0 flex-1">
                {(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
              </Field>
              <Button type="submit" variant="primary" loading={adding} disabled={!title.trim()}>Add</Button>
            </div>
          </form>
        </Card>
      )}
      {error ? (
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      ) : tasks === null ? (
        <ListSkeleton count={3} />
      ) : tasks.length === 0 ? (
        <EmptyState title="No tasks yet" hint={canEdit ? 'Add the first task above.' : 'Tasks appear here as the team adds them.'} />
      ) : (
        <>
          <section aria-label="Open tasks" className="space-y-2">
            <h3 className="text-[13px] font-semibold text-white">Open <span className="font-normal text-slate-400">({open.length})</span></h3>
            {open.length === 0
              ? <p className="text-sm text-slate-400">Nothing open.</p>
              : <ul className="space-y-2">{open.map((t) => <TaskCard key={t.id} t={t} canEdit={canEdit} onToggle={(x) => void toggle(x)} />)}</ul>}
          </section>
          {done.length > 0 && (
            <section aria-label="Completed tasks" className="space-y-2">
              <button
                type="button"
                onClick={() => setShowDone((s) => !s)}
                aria-expanded={showDone}
                className="flex min-h-[44px] items-center gap-1.5 text-[13px] font-semibold text-slate-400 hover:text-slate-200"
              >
                Completed / waived <span className="font-normal text-slate-400">({done.length})</span> <span aria-hidden>{showDone ? '▴' : '▾'}</span>
              </button>
              {showDone && <ul className="space-y-2">{done.map((t) => <TaskCard key={t.id} t={t} canEdit={canEdit} onToggle={(x) => void toggle(x)} />)}</ul>}
            </section>
          )}
        </>
      )}
      <DesktopOnlyCard caseId={c.id} section="tasks" title="Assign, waive or delete on the desktop" />
    </>
  )
}
