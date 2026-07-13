'use client'

import { useCallback, useEffect, useState } from 'react'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Field, Textarea } from '@/components/ui/Field'
import { insert, list, deleteWithUndo, rpc } from '@/lib/db'
import { timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { officerName, activeProfiles, useProfilesStore } from '@/lib/profiles'
import { bureauLabel, roleLabel } from '@/lib/roles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { JointCaseModal, isActiveAssignment } from '../JointCaseModal'
import { Stat, type AssignmentRow, type CaseRow } from './shared'

export function OverviewTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const { profile, isCommand } = useAuth()
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [evidence, setEvidence] = useState(0)
  const [reports, setReports] = useState(0)
  // "Now" is snapshotted per refresh (render must stay pure) — expiry lines
  // re-evaluate whenever the assignments themselves are refetched.
  const [now, setNow] = useState(0)
  const vA = useTableVersion('case_assignments')
  const vE = useTableVersion('evidence')
  const vR = useTableVersion('reports')
  const refresh = useCallback(async () => {
    try {
      const [a, e, r] = await Promise.all([
        list('case_assignments', { eq: { case_id: c.id } }),
        list('evidence', { eq: { case_id: c.id } }),
        list('reports', { eq: { case_id: c.id } }),
      ])
      setAssignments(a); setEvidence(e.length); setReports(r.length); setNow(Date.now())
    } catch { /* tab can render stale */ }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vA, vE, vR])

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
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Evidence" value={evidence} />
        <Stat label="Reports" value={reports} />
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
        <span className="font-semibold uppercase text-rose-300">expired</span>
      </p>
    )
  }
  const soon = remaining < 48 * 3_600_000
  return <p className={`text-xs ${soon ? 'text-amber-300' : 'text-slate-400'}`}>Temporary access expires {label}</p>
}
