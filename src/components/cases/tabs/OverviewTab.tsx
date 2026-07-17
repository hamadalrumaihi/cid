'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { Field, Textarea } from '@/components/ui/Field'
import { insert, list, deleteWithUndo, rpc } from '@/lib/db'
import { caseLink } from '@/lib/caseLinks'
import { fmtDate, timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { officerName, activeProfiles, useProfilesStore } from '@/lib/profiles'
import { bureauLabel, roleLabel } from '@/lib/roles'
import { useTableVersion } from '@/lib/realtime'
import type { CaseAssessment, ClosureChecklistItem, NextAction } from '@/lib/caseWorkflow'
import type { LegalRequest } from '@/lib/justice'
import { LegalRequestRow } from '@/components/justice/legalShared'
import { Store } from '@/lib/store'
import { toast } from '@/lib/toast'
import type { WorkflowRows } from '../CaseDetail'
import { JointCaseModal, isActiveAssignment } from '../JointCaseModal'
import { CaseBlockersPanel } from './CaseBlockersPanel'
import { Stat, type AssignmentRow, type CaseRow } from './shared'

export function OverviewTab({ c, canEdit, canDelete, wf, assessment, onWorkflowChanged }: {
  c: CaseRow
  canEdit: boolean
  canDelete: boolean
  /** Shell-fetched workflow snapshot (tasks/reports/legal/media/blockers) —
   *  Overview renders it instead of re-running the same five queries. */
  wf: WorkflowRows | null
  assessment: CaseAssessment | null
  onWorkflowChanged: () => void
}) {
  const { profile, isCommand } = useAuth()
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const router = useRouter()
  // "Now" is snapshotted per refresh (render must stay pure) — expiry lines
  // re-evaluate whenever the assignments themselves are refetched.
  const [now, setNow] = useState(0)
  // "Since your last visit" recap: the marker for THIS case is captured once on
  // open (so the recap stays visible through the visit) and re-stamped on leave.
  const [seenAt] = useState<string>(() => Store.get<string>(`caseSeen:${c.id}`, ''))
  const vA = useTableVersion('case_assignments')
  const refresh = useCallback(async () => {
    try {
      const a = await list('case_assignments', { eq: { case_id: c.id } })
      setAssignments(a); setNow(Date.now())
    } catch { /* tab can render stale */ }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vA])
  // Re-stamp the marker when leaving the case, so the next visit's recap covers
  // what changed while away. new Date() runs only in this browser effect.
  useEffect(() => {
    const id = c.id
    return () => { Store.set(`caseSeen:${id}`, new Date().toISOString()) }
  }, [c.id])

  const recap = useMemo(() => {
    if (!seenAt || !wf) return null
    const newer = (rows: { created_at?: string | null }[]) => rows.filter((x) => (x.created_at || '') > seenAt).length
    return {
      photos: newer(wf.media), reports: newer(wf.reports), tasks: newer(wf.tasks),
      legal: wf.legal.filter((x) => (x.updated_at || '') > seenAt).length,
    }
  }, [wf, seenAt])

  const [assignBusy, setAssignBusy] = useState(false)
  const addAssignment = async () => {
    if (assignBusy) return
    const officer = activeProfiles()[0]?.id
    if (!officer) { toast('No active officers found.', 'warn'); return }
    setAssignBusy(true)
    const res = await insert('case_assignments', { case_id: c.id, officer_id: officer, role: 'support' })
    setAssignBusy(false)
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Officer assigned.', 'success'); void refresh() }
  }

  // Joint rows render in their own panel below; the standard panel keeps its
  // existing behavior for 'standard'/'manual_access' rows only.
  const standardRows = assignments.filter((a) => a.assignment_source !== 'joint_case')
  const jointRows = assignments.filter((a) => a.assignment_source === 'joint_case')
  const activeJoint = jointRows.filter((a) => !a.removed_at)
  const removedJoint = jointRows.filter((a) => a.removed_at)
  const showJointPanel = c.is_joint_case || jointRows.length > 0
  // Client mirror of the server authority: command, case lead/creator, or an
  // own ACTIVE joint-lead assignment. RLS + the RPCs enforce the real rule.
  const managesJoint = isCommand
    || c.lead_detective_id === profile?.id
    || c.created_by === profile?.id
    || activeJoint.some((a) =>
      a.officer_id === profile?.id
      && (a.joint_role === 'JTF Case Lead' || a.joint_role === 'JTF Co-Lead')
      && isActiveAssignment(a))

  return (
    <div className="space-y-4">
      <CaseRecap recap={recap} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Left — operational state: what to do next, what stands in the way. */}
        <div className="min-w-0 space-y-4">
          {assessment && <GuidedNextAction caseId={c.id} stageLabel={assessment.stageLabel} actions={assessment.nextActions} />}
          <CaseBlockersPanel caseId={c.id} blockers={wf?.blockers ?? []} tasks={wf?.tasks ?? []} reports={wf?.reports ?? []} canEdit={canEdit} now={now} onChanged={onWorkflowChanged} />
          {assessment && <ClosureReadinessPanel caseId={c.id} checklist={assessment.closureChecklist} ready={assessment.closureReady} closed={assessment.stage === 'closed'} />}
        </div>
        {/* Right — context: case facts, people, linked legal work. */}
        <div className="min-w-0 space-y-4">
          {/* Case facts the shell's MetricStrip doesn't carry — evidence/report
              counts live up there now, so these tiles stay non-duplicative. */}
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Lead" value={officerName(c.lead_detective_id) || 'Unassigned'} />
            <Stat label="Officers" value={standardRows.filter((a) => isActiveAssignment(a)).length} />
            <Stat label="Opened" value={fmtDate(c.created_at)} />
            <Stat label="Updated" value={timeAgo(c.updated_at).toUpperCase()} />
          </div>
          <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-bold text-white">Assigned Officers</h3>
              {canEdit && <Button onClick={() => void addAssignment()} disabled={assignBusy}>Add support</Button>}
            </div>
            <div className="flex flex-wrap gap-2">
              {standardRows.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm text-slate-200">
                  {officerName(a.officer_id) || 'Officer'} <span className="text-xs uppercase text-slate-500">{a.role}</span>
                  {canDelete && <button aria-label={`Remove ${officerName(a.officer_id) || 'officer'} from case`} onClick={() => void deleteWithUndo('case_assignments', a, { confirmTitle: 'Remove officer', confirmMessage: `Remove ${officerName(a.officer_id) || 'this officer'} from the case? You can undo this for a few seconds.`, confirmText: 'Remove', label: 'assignment', after: refresh })} className="text-rose-300 hover:text-rose-200">×</button>}
                </span>
              ))}
              {!standardRows.length && <p className="text-sm text-slate-500">No support assignments recorded.</p>}
            </div>
          </div>
          <CaseLegalPanel rows={wf?.legal ?? []} onOpen={(id) => router.push(`/legal?request=${encodeURIComponent(id)}`)} />
          {showJointPanel && (
            <JointMembersPanel
              c={c}
              assignments={assignments}
              activeJoint={activeJoint}
              removedJoint={removedJoint}
              manages={managesJoint}
              now={now}
              onChanged={refresh}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Closure readiness ──────────────────────────────────────────────────────
 * The itemized closure checklist from assessCase, rendered pass/fail. It is
 * the same engine the shell's pre-close flow reads, so what a detective sees
 * here never disagrees with what the close button will demand. When every
 * gate is clear it offers the deep link into sign-off (the RPCs stay the
 * authority on who may act). Hidden on closed cases — nothing left to gate. */
function ClosureReadinessPanel({ caseId, checklist, ready, closed }: {
  caseId: string
  checklist: ClosureChecklistItem[]
  ready: boolean
  closed: boolean
}) {
  if (closed) return null
  // The "not already closed" gate always passes here — skip the noise.
  const items = checklist.filter((i) => i.key !== 'case_open')
  return (
    <section aria-label="Closure readiness" className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold text-white">Closure readiness</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${ready ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
          {ready ? 'Ready' : `${items.filter((i) => !i.ok).length} remaining`}
        </span>
      </div>
      <ul className="space-y-1.5">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-2 text-sm">
            <span aria-hidden className={`grid h-4 w-4 flex-shrink-0 place-items-center rounded-full text-[10px] font-bold ${i.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
              {i.ok ? '✓' : '•'}
            </span>
            <span className={i.ok ? 'text-slate-400' : 'text-slate-200'}>
              {i.label} <span className="sr-only">{i.ok ? '(complete)' : '(pending)'}</span>
            </span>
          </li>
        ))}
      </ul>
      {ready && (
        <div className="mt-3 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-3 py-2.5">
          <p className="text-sm text-emerald-100">
            <span className="font-bold">Ready for sign-off.</span> Every closure gate is clear.{' '}
            <Link href={caseLink(caseId, 'signoff')} className="font-semibold underline underline-offset-2 hover:text-white">
              Go to sign-off →
            </Link>
          </p>
        </div>
      )}
    </section>
  )
}

/* ── Case legal panel ───────────────────────────────────────────────────────
 * Read-only view of the case's warrants/subpoenas on the Overview, so a
 * detective never has to leave the case to see whether their search warrant
 * was approved. Rows reuse the shared LegalRequestRow (same look as the Legal
 * and Justice queues) and deep-link into /legal?request=<id>. Creating and
 * advancing requests stays in the Legal view / its RPCs. (Audit P1-7.) */
function CaseLegalPanel({ rows, onOpen }: { rows: LegalRequest[]; onOpen: (id: string) => void }) {
  const TERMINAL = new Set(['denied', 'withdrawn', 'closed'])
  const active = rows.filter((r) => !TERMINAL.has(r.review_status))
  const resolved = rows.filter((r) => TERMINAL.has(r.review_status))
  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold text-white">Legal requests <span className="text-slate-500">({rows.length})</span></h3>
        <Link href="/legal" className="text-xs font-semibold text-blue-300 hover:text-blue-200">Open Legal ↗</Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No warrants or subpoenas are linked to this case yet. Draft one from the <Link href="/legal" className="text-blue-300 hover:text-blue-200">Legal Requests</Link> view.</p>
      ) : (
        <div className="space-y-3">
          {active.length > 0 && (
            <div className="space-y-1.5">
              {active.map((r) => <LegalRequestRow key={r.id} r={r} onOpen={onOpen} />)}
            </div>
          )}
          {resolved.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 hover:text-slate-300">Resolved ({resolved.length})</summary>
              <div className="mt-2 space-y-1.5 opacity-80">
                {resolved.map((r) => <LegalRequestRow key={r.id} r={r} onOpen={onOpen} />)}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}

/* ── Since your last visit ──────────────────────────────────────────────────
 * A compact recap of what changed on this case since the viewer last opened it
 * (per-case localStorage marker, re-stamped on leave). Purely informational —
 * it never suppresses a notification; it just orients a returning detective. */
function CaseRecap({ recap }: { recap: { photos: number; reports: number; tasks: number; legal: number } | null }) {
  if (!recap) return null
  const parts: string[] = []
  if (recap.photos) parts.push(`${recap.photos} photo${recap.photos === 1 ? '' : 's'} added`)
  if (recap.reports) parts.push(`${recap.reports} report${recap.reports === 1 ? '' : 's'} added`)
  if (recap.tasks) parts.push(`${recap.tasks} task${recap.tasks === 1 ? '' : 's'} added`)
  if (recap.legal) parts.push(`${recap.legal} legal update${recap.legal === 1 ? '' : 's'}`)
  if (!parts.length) return null
  return (
    <section aria-label="Changes since your last visit" className="rounded-xl border border-sky-400/25 bg-sky-500/10 px-4 py-3">
      <p className="text-sm text-sky-100">
        <span className="font-bold">Since your last visit:</span> {parts.join(' · ')}.
      </p>
    </section>
  )
}

/* ── Guided next action ─────────────────────────────────────────────────────
 * A recommendation banner driven by the shared, unit-tested case-state
 * evaluator (lib/caseWorkflow). It only surfaces what the evaluator derived
 * from already-fetched state; the sign-off / legal RPCs remain the authority
 * for who may actually act. Actions carrying a `tab` deep-link into that
 * section via the same ?case=&tab= URL the tab bar uses. */
const ACTION_TINT: Record<NextAction['severity'], string> = {
  urgent: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
  warn: 'border-amber-400/25 bg-amber-500/10 text-amber-100',
  info: 'border-white/10 bg-white/[0.03] text-slate-200',
}
const ACTION_DOT: Record<NextAction['severity'], string> = {
  urgent: 'bg-rose-400', warn: 'bg-amber-400', info: 'bg-slate-400',
}

function GuidedNextAction({ caseId, stageLabel, actions }: { caseId: string; stageLabel: string; actions: NextAction[] }) {
  if (!actions.length) return null
  // Lead with the highest-severity action; show up to two more as follow-ups.
  const order: NextAction['severity'][] = ['urgent', 'warn', 'info']
  const ranked = [...actions].sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity))
  const [lead, ...rest] = ranked
  const inner = (a: NextAction) => (
    <>
      <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${ACTION_DOT[a.severity]}`} aria-hidden />
      <span className="min-w-0">
        <span className="block text-sm font-bold">{a.label}</span>
        {a.detail && <span className="block text-xs opacity-80">{a.detail}</span>}
      </span>
    </>
  )
  return (
    <section aria-label="Recommended next action" className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="t-readout text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Next action</span>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-400">{stageLabel}</span>
      </div>
      {lead.tab ? (
        <Link href={caseLink(caseId, lead.tab)} className={`flex items-start gap-2.5 rounded-lg border p-3 transition hover:brightness-110 ${ACTION_TINT[lead.severity]}`}>
          {inner(lead)}
        </Link>
      ) : (
        <div className={`flex items-start gap-2.5 rounded-lg border p-3 ${ACTION_TINT[lead.severity]}`}>{inner(lead)}</div>
      )}
      {rest.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rest.slice(0, 3).map((a) => (
            <li key={a.key}>
              {a.tab ? (
                <Link href={caseLink(caseId, a.tab)} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs text-slate-400 transition hover:text-slate-200">
                  <span className={`h-1.5 w-1.5 rounded-full ${ACTION_DOT[a.severity]}`} aria-hidden />{a.label}
                </Link>
              ) : (
                <span className="flex items-center gap-2 px-1 py-0.5 text-xs text-slate-400">
                  <span className={`h-1.5 w-1.5 rounded-full ${ACTION_DOT[a.severity]}`} aria-hidden />{a.label}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ── Joint-case members ────────────────────────────────────────────────────
 * Joint rows are RPC-managed (RLS blocks direct writes): add via
 * joint_case_add_members, remove via joint_case_remove_member with an
 * optional reason. Removed members are NEVER hard-deleted — they stay in a
 * collapsed history list with the removal date and reason. */
function JointMembersPanel({ c, assignments, activeJoint, removedJoint, manages, now, onChanged }: {
  c: CaseRow
  assignments: AssignmentRow[]
  activeJoint: AssignmentRow[]
  removedJoint: AssignmentRow[]
  manages: boolean
  /** Timestamp snapshotted by the parent's refresh — keeps render pure. */
  now: number
  onChanged: () => void
}) {
  const profiles = useProfilesStore((s) => s.profiles)
  const [addOpen, setAddOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<AssignmentRow | null>(null)
  const [removeReason, setRemoveReason] = useState('')
  const [removeBusy, setRemoveBusy] = useState(false)

  const confirmRemove = async () => {
    if (!removeTarget || removeBusy) return
    setRemoveBusy(true)
    const reason = removeReason.trim()
    const res = await rpc('joint_case_remove_member', {
      p_case: c.id,
      p_officer: removeTarget.officer_id,
      ...(reason ? { p_reason: reason } : {}),
    })
    setRemoveBusy(false)
    if (res.error) toast(res.error.message, 'danger')
    else {
      toast('Member removed from the joint case.', 'success')
      setRemoveTarget(null); setRemoveReason('')
      onChanged()
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold text-white">
          Joint-case members{' '}
          <span className="ml-1 align-middle rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-300">JTF</span>
        </h3>
        {manages && (
          <Button className="min-h-[44px] sm:min-h-0" onClick={() => setAddOpen(true)}>
            ＋ Add members
          </Button>
        )}
      </div>
      <div className="space-y-2">
        {activeJoint.map((a) => {
          const p = profiles.find((x) => x.id === a.officer_id)
          return (
            <div key={a.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-white/10 bg-ink-900/40 p-3">
              <div>
                <p className="text-sm font-semibold text-white">{officerName(a.officer_id) || 'Officer'}</p>
                <p className="text-xs text-slate-400">Permanent: {bureauLabel(p?.division)} {roleLabel(p?.role)}</p>
                <p className="text-xs text-slate-300">Joint-Case Role: <span className="font-semibold text-violet-300">{a.joint_role ?? '—'}</span></p>
                {a.expires_at && <ExpiryLine expiresAt={a.expires_at} now={now} />}
              </div>
              {manages && (
                <button
                  onClick={() => { setRemoveReason(''); setRemoveTarget(a) }}
                  className="min-h-[44px] rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 sm:min-h-0"
                >
                  Remove
                </button>
              )}
            </div>
          )
        })}
        {!activeJoint.length && <p className="text-sm text-slate-400">No active joint-case members.</p>}
      </div>
      {removedJoint.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.16em] text-slate-400 hover:text-slate-300">
            Removal history ({removedJoint.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {removedJoint.map((a) => (
              <li key={a.id} className="text-xs text-slate-400">
                <span className="text-slate-300">{officerName(a.officer_id) || 'Officer'}</span>
                {a.joint_role ? ` · ${a.joint_role}` : ''}
                {a.removed_at ? ` — removed ${fmtDate(a.removed_at)}` : ''}
                {a.removal_reason ? ` · ${a.removal_reason}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}

      <JointCaseModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        c={c}
        mode="add"
        existingAssignments={assignments}
        onDone={() => { setAddOpen(false); onChanged() }}
      />

      <Modal open={!!removeTarget} onClose={() => setRemoveTarget(null)}>
        <div className="p-5">
          <ModalHeader title="Remove joint-case member" onClose={() => setRemoveTarget(null)} />
          <p className="text-sm text-slate-300">
            Remove <span className="font-semibold text-white">{removeTarget ? officerName(removeTarget.officer_id) || 'this officer' : ''}</span> from
            the joint case? Their access ends now; the assignment stays in the removal history.
          </p>
          <div className="mt-4">
            <Field label="Reason (optional)">
              {(id) => <Textarea id={id} rows={2} value={removeReason} onChange={(e) => setRemoveReason(e.target.value)} placeholder="e.g. Detail concluded" />}
            </Field>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button className="min-h-[44px] sm:min-h-0" onClick={() => setRemoveTarget(null)} disabled={removeBusy}>Cancel</Button>
            <Button variant="danger" className="min-h-[44px] sm:min-h-0" onClick={() => void confirmRemove()} disabled={removeBusy}>
              {removeBusy ? 'Removing…' : 'Remove member'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/** Expiry line: amber inside the final 48 hours, struck-through + "expired"
 *  once past (the row stays until a manager removes it or joint status ends). */
function ExpiryLine({ expiresAt, now }: { expiresAt: string; now: number }) {
  const exp = new Date(expiresAt)
  const label = exp.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  const remaining = exp.getTime() - now
  if (remaining <= 0) {
    return (
      <p className="text-xs text-slate-400">
        <span className="line-through">Temporary access expires {label}</span>{' '}
        <span className="font-semibold uppercase text-rose-300">expired</span>{' '}
        <DeadlineChip at={expiresAt} kind="expires" now={now} />
      </p>
    )
  }
  const soon = remaining < 48 * 3_600_000
  return (
    <p className={`text-xs ${soon ? 'text-amber-300' : 'text-slate-400'}`}>
      Temporary access expires {label} <DeadlineChip at={expiresAt} kind="expires" now={now} className="ml-1" />
    </p>
  )
}
