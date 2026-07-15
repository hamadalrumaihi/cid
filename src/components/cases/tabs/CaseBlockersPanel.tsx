'use client'

/* ── Case blockers ──────────────────────────────────────────────────────────
 * Durable, officer-authored "what is this case waiting on" rows
 * (case_blockers). Unlike the derived blockers from assessCase (open tasks,
 * drafts…), these capture external waits — a lab result, another agency, a
 * command decision — with an optional owner, review date, and a link to the
 * task/report they hold up. Open rows feed back into assessCase via
 * `persistedBlockers`, so the guided next action and closure readiness react.
 * Resolving keeps the row (status='resolved' + note + who/when) as history;
 * hard delete is command-or-creator only (mirrors RLS). */
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { deleteWithUndo, insert, update } from '@/lib/db'
import { fmtDate } from '@/lib/format'
import { reportTitle } from '@/lib/forms'
import { useAuth } from '@/lib/auth'
import { activeProfiles, officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import type { Tables } from '@/lib/database.types'
import type { ReportRow, TaskRow } from './shared'

export type BlockerRow = Tables<'case_blockers'>

/** The 9-value CHECK vocabulary on case_blockers.type, humanized. */
const BLOCKER_TYPES: { value: string; label: string }[] = [
  { value: 'awaiting_evidence', label: 'Awaiting evidence' },
  { value: 'awaiting_report', label: 'Awaiting report' },
  { value: 'awaiting_legal_review', label: 'Awaiting legal review' },
  { value: 'awaiting_command_review', label: 'Awaiting command review' },
  { value: 'awaiting_agency', label: 'Awaiting outside agency' },
  { value: 'awaiting_suspect', label: 'Awaiting suspect' },
  { value: 'task_dependency', label: 'Task dependency' },
  { value: 'resource', label: 'Resource constraint' },
  { value: 'other', label: 'Other' },
]

export function blockerTypeLabel(type: string | null | undefined): string {
  return BLOCKER_TYPES.find((t) => t.value === type)?.label ?? (type || 'Other')
}

export function CaseBlockersPanel({ caseId, blockers, tasks, reports, canEdit, now, onChanged }: {
  caseId: string
  blockers: BlockerRow[]
  tasks: TaskRow[]
  reports: ReportRow[]
  canEdit: boolean
  /** Timestamp snapshotted by the parent's refresh — keeps render pure. */
  now: number
  onChanged: () => void
}) {
  const { profile, isCommand } = useAuth()
  const open = blockers.filter((b) => b.status === 'open')
  const resolved = blockers
    .filter((b) => b.status !== 'open')
    .sort((a, b) => (b.resolved_at || '').localeCompare(a.resolved_at || ''))

  // ── Add flow ──
  const [addOpen, setAddOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState(BLOCKER_TYPES[0].value)
  const [ownerId, setOwnerId] = useState('')
  const [reviewAt, setReviewAt] = useState('')
  const [link, setLink] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const closeAdd = () => {
    setAddOpen(false)
    setTitle(''); setType(BLOCKER_TYPES[0].value); setOwnerId(''); setReviewAt(''); setLink('')
  }
  const submitAdd = async () => {
    const t = title.trim()
    if (!t) { toast('Enter what the case is waiting on.', 'warn'); return }
    if (addBusy) return
    setAddBusy(true)
    const [linkKind, linkId] = link ? link.split(':') : [null, null]
    const res = await insert('case_blockers', {
      case_id: caseId,
      title: t,
      type,
      owner_id: ownerId || null,
      review_at: reviewAt || null,
      task_id: linkKind === 'task' ? linkId : null,
      report_id: linkKind === 'report' ? linkId : null,
    })
    setAddBusy(false)
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Blocker recorded.', 'success'); closeAdd(); onChanged() }
  }

  // ── Resolve flow ──
  const [resolveTarget, setResolveTarget] = useState<BlockerRow | null>(null)
  const [resolveNote, setResolveNote] = useState('')
  const [resolveBusy, setResolveBusy] = useState(false)
  const confirmResolve = async () => {
    if (!resolveTarget || resolveBusy) return
    setResolveBusy(true)
    const note = resolveNote.trim()
    const res = await update('case_blockers', resolveTarget.id, {
      status: 'resolved',
      resolution_note: note || null,
      resolved_by: profile?.id ?? null,
      resolved_at: new Date().toISOString(),
    })
    setResolveBusy(false)
    if (res.error) toast(res.error.message, 'danger')
    else {
      toast('Blocker resolved.', 'success')
      setResolveTarget(null); setResolveNote('')
      onChanged()
    }
  }

  const openTasks = tasks.filter((t) => !t.done)

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold text-white">Blockers {open.length > 0 && <span className="text-slate-400">({open.length})</span>}</h3>
        {canEdit && <Button className="min-h-[44px] sm:min-h-0" onClick={() => setAddOpen(true)}>＋ Add blocker</Button>}
      </div>
      <div className="space-y-2">
        {open.map((b) => {
          const linkedTask = b.task_id ? tasks.find((t) => t.id === b.task_id) : null
          const linkedReport = b.report_id ? reports.find((r) => r.id === b.report_id) : null
          return (
            <div key={b.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-white/10 bg-ink-900/40 p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white">{b.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge>{blockerTypeLabel(b.type)}</Badge>
                  {b.owner_id && <span className="text-xs text-slate-400">Owner: <span className="text-slate-300">{officerName(b.owner_id) || 'Officer'}</span></span>}
                  {b.review_at && (
                    <span className="text-xs text-slate-400">
                      Review {fmtDate(b.review_at)} <DeadlineChip at={b.review_at} now={now} className="ml-0.5" />
                    </span>
                  )}
                </div>
                {(linkedTask || linkedReport || b.legal_request_id) && (
                  <p className="mt-1 truncate text-xs text-slate-400">
                    ↳ {linkedTask ? `Task: ${linkedTask.title}` : linkedReport ? `Report: ${reportTitle(linkedReport)}` : 'Linked legal request'}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {canEdit && (
                  <Button size="sm" className="min-h-[40px] sm:min-h-0" onClick={() => { setResolveNote(''); setResolveTarget(b) }}>
                    Resolve
                  </Button>
                )}
                {(isCommand || b.created_by === profile?.id) && (
                  <button
                    aria-label={`Delete blocker ${b.title}`}
                    onClick={() => void deleteWithUndo('case_blockers', b, { label: 'blocker', confirmTitle: 'Delete blocker', confirmMessage: `Delete "${b.title}"? Resolving keeps it in the history — delete only if it was recorded in error.`, after: onChanged })}
                    className="grid h-10 w-10 place-items-center rounded-lg text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 sm:h-8 sm:w-8"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {!open.length && <p className="text-sm text-slate-400">Nothing is blocking this case. Record one when the case is waiting on something outside your control.</p>}
      </div>
      {resolved.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 hover:text-slate-300">
            Resolved ({resolved.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {resolved.slice(0, 8).map((b) => (
              <li key={b.id} className="text-xs text-slate-400">
                <span className="text-slate-300">{b.title}</span>
                {' — resolved'}
                {b.resolved_by ? ` by ${officerName(b.resolved_by) || 'Officer'}` : ''}
                {b.resolved_at ? ` ${fmtDate(b.resolved_at)}` : ''}
                {b.resolution_note ? ` · ${b.resolution_note}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Modal open={addOpen} onClose={closeAdd} dirty={() => title.trim().length > 0}>
        <div className="p-5">
          <ModalHeader title="Add blocker" onClose={closeAdd} />
          <div className="space-y-3">
            <Field label="What is the case waiting on?" required>
              {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ballistics results from the state lab" maxLength={200} />}
            </Field>
            <Field label="Type">
              {(id) => (
                <Select id={id} value={type} onChange={(e) => setType(e.target.value)}>
                  {BLOCKER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              )}
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Owner (optional)" hint="Who is chasing this.">
                {(id) => (
                  <Select id={id} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                    <option value="">— Unassigned —</option>
                    {activeProfiles().map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Review date (optional)" hint="When to re-check whether it still blocks.">
                {(id) => <Input id={id} type="date" value={reviewAt} onChange={(e) => setReviewAt(e.target.value)} />}
              </Field>
            </div>
            {(openTasks.length > 0 || reports.length > 0) && (
              <Field label="Linked item (optional)" hint="The task or report this blocker holds up.">
                {(id) => (
                  <Select id={id} value={link} onChange={(e) => setLink(e.target.value)}>
                    <option value="">— None —</option>
                    {openTasks.length > 0 && (
                      <optgroup label="Open tasks">
                        {openTasks.map((t) => <option key={t.id} value={`task:${t.id}`}>{t.title}</option>)}
                      </optgroup>
                    )}
                    {reports.length > 0 && (
                      <optgroup label="Reports">
                        {reports.map((r) => <option key={r.id} value={`report:${r.id}`}>{reportTitle(r)}</option>)}
                      </optgroup>
                    )}
                  </Select>
                )}
              </Field>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button className="min-h-[44px] sm:min-h-0" onClick={closeAdd} disabled={addBusy}>Cancel</Button>
            <Button variant="primary" className="min-h-[44px] sm:min-h-0" onClick={() => void submitAdd()} disabled={addBusy}>
              {addBusy ? 'Adding…' : 'Add blocker'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!resolveTarget} onClose={() => setResolveTarget(null)} dirty={() => resolveNote.trim().length > 0}>
        <div className="p-5">
          <ModalHeader title="Resolve blocker" onClose={() => setResolveTarget(null)} />
          <p className="text-sm text-slate-300">
            Mark <span className="font-semibold text-white">{resolveTarget?.title ?? ''}</span> as resolved?
            It moves to the resolved history with your note.
          </p>
          <div className="mt-4">
            <Field label="Resolution note (optional)">
              {(id) => <Textarea id={id} rows={2} value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="e.g. Lab results received and logged as evidence" />}
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button className="min-h-[44px] sm:min-h-0" onClick={() => setResolveTarget(null)} disabled={resolveBusy}>Cancel</Button>
            <Button variant="success" className="min-h-[44px] sm:min-h-0" onClick={() => void confirmResolve()} disabled={resolveBusy}>
              {resolveBusy ? 'Resolving…' : 'Resolve blocker'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
