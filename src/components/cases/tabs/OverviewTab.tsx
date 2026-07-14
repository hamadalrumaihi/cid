'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { Field, Textarea } from '@/components/ui/Field'
import { insert, list, deleteWithUndo, rpc } from '@/lib/db'
import { timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { officerName, activeProfiles, useProfilesStore } from '@/lib/profiles'
import { bureauLabel, roleLabel } from '@/lib/roles'
import { useTableVersion } from '@/lib/realtime'
import { assessCase, type NextAction, type WfReport, type WfTask } from '@/lib/caseWorkflow'
import type { LegalRequest } from '@/lib/justice'
import { LegalRequestRow } from '@/components/justice/legalShared'
import { Store } from '@/lib/store'
import { toast } from '@/lib/toast'
import { JointCaseModal, isActiveAssignment } from '../JointCaseModal'
import { Stat, type AssignmentRow, type CaseRow } from './shared'

export function OverviewTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const { profile, isCommand } = useAuth()
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [evidence, setEvidence] = useState(0)
  const [reports, setReports] = useState<WfReport[]>([])
  const [tasks, setTasks] = useState<WfTask[]>([])
  const [legal, setLegal] = useState<LegalRequest[]>([])
  const router = useRouter()
  // "Now" is snapshotted per refresh (render must stay pure) — expiry lines
  // re-evaluate whenever the assignments themselves are refetched.
  const [now, setNow] = useState(0)
  // "Since your last visit" recap: the marker for THIS case is captured once on
  // open (so the recap stays visible through the visit) and re-stamped on leave.
  const seenRef = useRef<string>(Store.get<string>(`caseSeen:${c.id}`, ''))
  const [recap, setRecap] = useState<{ evidence: number; reports: number; tasks: number; legal: number } | null>(null)
  const vA = useTableVersion('case_assignments')
  const vE = useTableVersion('evidence')
  const vR = useTableVersion('reports')
  const vT = useTableVersion('case_tasks')
  const vL = useTableVersion('legal_requests')
  const refresh = useCallback(async () => {
    try {
      const [a, e, r, t, l] = await Promise.all([
        list('case_assignments', { eq: { case_id: c.id } }),
        list('evidence', { eq: { case_id: c.id } }),
        list('reports', { eq: { case_id: c.id } }),
        list('case_tasks', { eq: { case_id: c.id } }),
        // Legal is read-scoped by RLS; a failure must not sink the Overview.
        list('legal_requests', { eq: { case_id: c.id }, order: 'created_at', ascending: false }).catch(() => [] as LegalRequest[]),
      ])
      setAssignments(a); setEvidence(e.length); setReports(r); setTasks(t); setLegal(l as LegalRequest[]); setNow(Date.now())
      const seen = seenRef.current
      const newer = (rows: { created_at?: string | null }[]) => seen ? rows.filter((x) => (x.created_at || '') > seen).length : 0
      setRecap(seen ? {
        evidence: newer(e), reports: newer(r), tasks: newer(t),
        legal: l.filter((x) => (x.updated_at || '') > seen).length,
      } : null)
    } catch { /* tab can render stale */ }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vA, vE, vR, vT, vL])
  // Re-stamp the marker when leaving the case, so the next visit's recap covers
  // what changed while away. new Date() runs only in this browser effect.
  useEffect(() => {
    const id = c.id
    return () => { Store.set(`caseSeen:${id}`, new Date().toISOString()) }
  }, [c.id])

  const standardCount = assignments.filter((a) => a.assignment_source !== 'joint_case' && !a.removed_at).length
  const assessment = useMemo(() => assessCase({
    c,
    tasks, reports, legal,
    evidenceCount: evidence,
    supportCount: standardCount,
    meId: profile?.id ?? null,
    assigneeName: officerName(c.signoff_assignee_id),
  }), [c, tasks, reports, legal, evidence, standardCount, profile?.id])

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
      <GuidedNextAction caseId={c.id} stageLabel={assessment.stageLabel} actions={assessment.nextActions} />
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Evidence" value={evidence} />
        <Stat label="Reports" value={reports.length} />
        <Stat label="Lead" value={officerName(c.lead_detective_id) || 'Unassigned'} />
        <Stat label="Updated" value={timeAgo(c.updated_at).toUpperCase()} />
      </div>
      <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-white">Assigned Officers</h3>
          {canEdit && <button onClick={() => void addAssignment()} disabled={assignBusy} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Add support</button>}
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
      <CaseLegalPanel rows={legal} onOpen={(id) => router.push(`/legal?request=${encodeURIComponent(id)}`)} />
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
function CaseRecap({ recap }: { recap: { evidence: number; reports: number; tasks: number; legal: number } | null }) {
  if (!recap) return null
  const parts: string[] = []
  if (recap.evidence) parts.push(`${recap.evidence} evidence item${recap.evidence === 1 ? '' : 's'} added`)
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
        <Link href={`/cases?case=${encodeURIComponent(caseId)}&tab=${lead.tab}`} className={`flex items-start gap-2.5 rounded-lg border p-3 transition hover:brightness-110 ${ACTION_TINT[lead.severity]}`}>
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
                <Link href={`/cases?case=${encodeURIComponent(caseId)}&tab=${a.tab}`} className="flex items-center gap-2 rounded px-1 py-0.5 text-xs text-slate-400 transition hover:text-slate-200">
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

  const fmtDate = (v: string) => new Date(v).toLocaleDateString('en-US')

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-bold text-white">
          Joint-case members{' '}
          <span className="ml-1 align-middle rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-300">JTF</span>
        </h3>
        {manages && (
          <button onClick={() => setAddOpen(true)} className="min-h-[44px] rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/15 sm:min-h-0">
            ＋ Add members
          </button>
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
            <button onClick={() => setRemoveTarget(null)} disabled={removeBusy} className="min-h-[44px] rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-60 sm:min-h-0">Cancel</button>
            <button onClick={() => void confirmRemove()} disabled={removeBusy} className="min-h-[44px] rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-60 sm:min-h-0">
              {removeBusy ? 'Removing…' : 'Remove member'}
            </button>
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
