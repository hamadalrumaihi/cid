'use client'

/** Case jacket header — a persistent, flat, bordered panel in three lines:
 *  1 · identity (mono case number + copy, title) with the ActionMenu;
 *  2 · a definition-list of the case facts (status/priority controls, stage,
 *      assigned unit vs responsible bureau, lead, supporting count,
 *      classification, last update, joint/op chips);
 *  3 · the stage strip with THE single primary next action (shared assessCase
 *      engine), the follow-up chip and the urgent blocker/overdue counters.
 *  Behavior is unchanged: every former header action is still reachable —
 *  the long tail stays folded into the ActionMenu. */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ActionMenu, type ActionItem } from '@/components/ui/ActionMenu'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { list, rpc, update } from '@/lib/db'
import { copyText, slug, timeAgo, todayISO } from '@/lib/format'
import { caseLink } from '@/lib/caseLinks'
import { priorityTint } from '@/lib/tint'
import { useAuth } from '@/lib/auth'
import { useAction } from '@/lib/useAction'
import { bureauLabel } from '@/lib/roles'
import { officerName } from '@/lib/profiles'
import { useWatchlistStore } from '@/lib/watchlist'
import { caseCourtHint, caseStatusTint, CASE_STATUSES, signoffLabel, signoffTint } from '@/lib/signoff'
import { isJtfAssigned, isRoutingBureau } from '@/lib/legalWorkflow'
import type { CaseAssessment, CaseStage } from '@/lib/caseWorkflow'
import { jointReasonText, type CaseJointInfo } from '@/lib/opsJoint'
import { gatherCasePacket, packetDocx, packetMarkdown, packetPdfSpec, type PacketData } from '@/lib/packet'
import { toast } from '@/lib/toast'
import { StaleBadge } from './StaleBadge'
import { JointCaseModal } from './JointCaseModal'
import type { AssignmentRow, CaseRow } from './tabs/shared'

export const CASE_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

/** Stage chip follows the app's status temperatures (lib/tint). */
const STAGE_TINTS: Record<CaseStage, string> = {
  investigation: 'bg-emerald-500/15 text-emerald-300',
  awaiting_signoff: 'bg-amber-500/15 text-amber-300',
  returned_signoff: 'bg-rose-500/15 text-rose-300',
  doj_review: 'bg-blue-500/15 text-blue-300',
  dormant: 'bg-blue-500/15 text-blue-300',
  closed: 'bg-slate-500/20 text-slate-300',
}

const CONTROL = 'min-h-[40px] rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white'

/** One labelled fact in the line-2 definition list. */
function DlField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <span className="flex min-w-0 items-center gap-1 text-sm text-slate-200">{children}</span>
    </div>
  )
}

export function CaseCommandHeader({
  c,
  op,
  joint,
  assessment,
  openBlockers,
  pinned,
  canEdit,
  canArchive,
  canDelete,
  canHold,
  holdActive,
  onPlaceHold,
  canHandover,
  canReassignBureau,
  responsibleBureauAction,
  onResponsibleBureau,
  onStatusChange,
  onPinToggle,
  onEdit,
  onArchive,
  onHandover,
  onReassign,
  onDelete,
  onChanged,
  onGoTab,
}: {
  c: CaseRow
  op: { id: string; name: string } | null
  /** Operation-derived joint picture (opsJoint.caseJointInfo). */
  joint: CaseJointInfo | null
  assessment: CaseAssessment | null
  /** Open case_blockers count (null until the workflow snapshot lands). */
  openBlockers: number | null
  pinned: boolean
  canEdit: boolean
  canArchive: boolean
  canDelete: boolean
  /** Command may place a legal hold. Lifting is done from the case banner. */
  canHold: boolean
  /** A hold is already active — the menu offers nothing (the banner lifts it). */
  holdActive: boolean
  onPlaceHold: () => void
  canHandover: boolean
  canReassignBureau: boolean
  /** JTF-assigned cases: 'set' when no responsible bureau is recorded (Senior
   *  Detective+), 'change' when one is (Deputy Director+); null hides the
   *  action. Cosmetic — resolve_case_originating_bureau re-validates. */
  responsibleBureauAction: 'set' | 'change' | null
  onResponsibleBureau: () => void
  onStatusChange: (s: CaseRow['status']) => void
  onPinToggle: () => void
  onEdit: () => void
  onArchive: () => void
  onHandover: () => void
  onReassign: () => void
  onDelete: () => void
  /** Refetch the case (and notify the board) after a header mutation. */
  onChanged: () => void
  onGoTab: (tab: string) => void
}) {
  const { profile, isCommand } = useAuth()
  const hint = caseCourtHint(c, profile?.id ?? null, officerName(c.signoff_assignee_id))
  const [followUpOpen, setFollowUpOpen] = useState(false)
  const [packetOpen, setPacketOpen] = useState(false)
  const [jointOpen, setJointOpen] = useState(false)
  const [jointAssignments, setJointAssignments] = useState<AssignmentRow[]>([])

  // Follow/unfollow (the former WatchButton), now a menu item.
  const watched = useWatchlistStore((s) => s.rows.some((w) => w.target_type === 'case' && w.target_id === c.id))
  const toggleWatch = useWatchlistStore((s) => s.toggle)
  const watch = useAction(() => toggleWatch('case', c.id, c.case_number))

  const priority = useAction(async (value: string) => {
    const res = await update('cases', c.id, { priority: value || null })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Priority updated.', 'success')
    onChanged()
  })

  // Joint-case management — client mirror of the server authority (command,
  // case lead, or creator); RLS + the RPCs enforce the real rule.
  const managesJoint = isCommand || c.lead_detective_id === profile?.id || c.created_by === profile?.id
  const openJoint = useAction(async () => {
    // Snapshot current assignments so the picker excludes already-assigned officers.
    try { setJointAssignments(await list('case_assignments', { eq: { case_id: c.id } })) }
    catch { setJointAssignments([]) }
    setJointOpen(true)
  })
  const endJoint = useAction(async () => {
    const ok = await uiConfirm('This closes all temporary joint access on this case. Assignment history is preserved.', {
      title: 'End joint-case status',
      confirmText: 'End joint case',
      danger: false,
    })
    if (!ok) return
    const res = await rpc('joint_case_end', { p_case: c.id })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Joint-case status ended.', 'success'); onChanged() }
  })

  const items: ActionItem[] = []
  if (canEdit) {
    items.push({ label: 'Edit case…', onClick: onEdit })
    items.push({ label: 'Set follow-up…', onClick: () => setFollowUpOpen(true) })
  }
  if (managesJoint) {
    items.push(c.is_joint_case
      ? { label: 'End joint-case status…', onClick: () => void endJoint.run(), disabled: endJoint.busy }
      : { label: 'Make this a joint case…', onClick: () => void openJoint.run(), disabled: openJoint.busy })
  }
  items.push({ label: pinned ? 'Unpin case' : 'Pin case', onClick: onPinToggle, separatorBefore: items.length > 0 })
  items.push({ label: watched ? 'Unfollow case' : 'Follow case', onClick: () => void watch.run(), disabled: watch.busy })
  items.push({ label: 'Copy case link', onClick: () => copyText(`${window.location.origin}${caseLink(c.id)}`, 'Case link') })
  items.push({ label: 'Case packet…', onClick: () => setPacketOpen(true) })
  const admin: ActionItem[] = []
  if (canHandover) admin.push({ label: 'Hand over case…', onClick: onHandover })
  if (canReassignBureau) admin.push({ label: 'Reassign bureau…', onClick: onReassign })
  if (responsibleBureauAction) {
    admin.push({
      label: responsibleBureauAction === 'change' ? 'Change responsible bureau…' : 'Set responsible bureau…',
      onClick: onResponsibleBureau,
    })
  }
  if (admin.length) { admin[0].separatorBefore = true; items.push(...admin) }
  // Archiving is blocked while a legal hold is active (server RLS is the real
  // block); restoring an already-archived case is never blocked by a hold.
  if (canArchive) {
    const archiveHeld = holdActive && !c.archived_at
    items.push({
      label: c.archived_at ? 'Restore case' : archiveHeld ? 'Archive case — blocked by legal hold' : 'Archive case',
      onClick: onArchive,
      disabled: archiveHeld,
      separatorBefore: !admin.length,
    })
  }
  // Legal hold — placing lives here; lifting is on the case banner so an active
  // hold is always visible, not buried in a menu.
  if (canHold && !holdActive) items.push({ label: 'Place legal hold…', onClick: onPlaceHold, separatorBefore: !canArchive && !admin.length })
  if (canDelete) items.push({ label: 'Permanently delete case…', onClick: onDelete, danger: true, separatorBefore: true })

  // Primary action: the top assessCase recommendation. Tab-bearing actions
  // navigate; the tab-less "follow-up is due" opens the follow-up editor.
  const primary = assessment?.nextActions[0] ?? null
  let primaryGo: (() => void) | null = null
  if (primary?.tab) { const t = primary.tab; primaryGo = () => onGoTab(t) }
  else if (primary?.key === 'followup_due' && canEdit) primaryGo = () => setFollowUpOpen(true)

  const followUpDue = !!c.follow_up_at && c.follow_up_at.slice(0, 10) <= todayISO()
  const overdueTasks = assessment?.counts.overdueTasks ?? 0
  // Legal routing bureau: recorded responsible bureau first, else a permanent
  // CID bureau routes itself; JTF/unset shows the needs-routing amber.
  const responsibleBureau = isRoutingBureau(c.originating_bureau)
    ? c.originating_bureau
    : isRoutingBureau(c.bureau) ? c.bureau : null

  return (
    <section className="rounded-lg border border-white/10 bg-ink-900/40">
      {/* Line 1 — identity: mono case number (copy) · title · the action menu. */}
      <div className="border-b border-white/5 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
            <button
              onClick={() => copyText(c.case_number, 'Case number')}
              title="Copy case number"
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-white/5 px-2.5 font-mono text-sm font-bold tabular-nums text-badge-200 transition hover:bg-white/10 sm:min-h-0 sm:py-1"
            >
              {c.case_number}
              <span aria-hidden className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">copy</span>
            </button>
            <h1 className="min-w-0 truncate text-lg font-black text-white">{c.title || 'Untitled case'}</h1>
          </div>
          <ActionMenu items={items} label="More case actions" buttonClassName="h-10 px-3.5" />
        </div>
        {c.summary && <p className="mt-1 line-clamp-2 max-w-4xl text-sm text-slate-400">{c.summary}</p>}
      </div>

      {/* Line 2 — the case facts as a compact definition list. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-white/5 px-4 py-2">
        <DlField label="Status">
          {canEdit ? (
            <select aria-label="Case status" value={c.status} onChange={(e) => onStatusChange(e.target.value as CaseRow['status'])} className={CONTROL}>
              {CASE_STATUSES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
          ) : <Badge tint={caseStatusTint(c.status)} className="uppercase">{c.status}</Badge>}
        </DlField>
        <DlField label="Priority">
          {canEdit ? (
            <select
              aria-label="Case priority"
              value={c.priority ?? ''}
              disabled={priority.busy}
              onChange={(e) => void priority.run(e.target.value)}
              className={`${CONTROL} disabled:opacity-60`}
            >
              <option value="">NO PRIORITY</option>
              {CASE_PRIORITIES.map((p) => <option key={p} value={p}>{p.toUpperCase()}</option>)}
            </select>
          ) : c.priority ? <Badge tint={priorityTint(c.priority)} className="uppercase">{c.priority}</Badge> : <span className="text-slate-400">—</span>}
        </DlField>
        {!canEdit && <span className="rounded-lg border border-white/10 px-2 py-0.5 text-xs text-slate-300">Read-only</span>}
        {assessment && (
          <DlField label="Stage"><Badge tint={STAGE_TINTS[assessment.stage]}>{assessment.stageLabel}</Badge></DlField>
        )}
        <DlField label="Unit">{isJtfAssigned(c) ? 'JTF (operational)' : c.bureau}</DlField>
        <DlField label="Responsible bureau">
          {responsibleBureau ? (
            <Badge title="Responsible bureau for legal routing">{responsibleBureau}</Badge>
          ) : (
            <Badge
              tint="bg-amber-500/15 text-amber-300"
              title="No responsible bureau is set — a CID supervisor (Senior Detective or above) must select LSB, BCB, or SAB before legal requests can route."
            >
              Needs routing bureau
            </Badge>
          )}
        </DlField>
        <DlField label="Lead">{officerName(c.lead_detective_id) || 'Unassigned'}</DlField>
        <DlField label="Supporting">
          <span className="tabular-nums">{assessment ? assessment.counts.supportOfficers : '—'}</span>
        </DlField>
        <DlField label="Classification">
          {holdActive ? <Badge tint="bg-rose-500/15 text-rose-300">Legal hold</Badge>
            : c.archived_at ? <Badge tint="bg-amber-500/15 text-amber-300">Archived</Badge>
            : <span className="text-slate-400">Standard</span>}
        </DlField>
        <DlField label="Updated"><span title={c.updated_at}>{timeAgo(c.updated_at)}</span></DlField>
        {/* Workflow + joint/op chips — same set as before, unchanged meaning. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tint={signoffTint(c.signoff_status)}>{signoffLabel(c.signoff_status)}</Badge>
          <StaleBadge c={c} />
          {c.is_joint_case && (
            <Badge
              tint="bg-violet-500/15 text-violet-300"
              title={`Originating department: ${bureauLabel(c.originating_bureau ?? c.bureau)}`}
            >
              JTF · Joint case
            </Badge>
          )}
          {joint?.activeVia && (
            <Badge tint="bg-violet-500/15 text-violet-300" title={jointReasonText(joint)}>
              JOINT · Op {joint.activeVia.opName}
            </Badge>
          )}
          {joint && !joint.activeVia && !c.is_joint_case && joint.everJoint && (
            <Badge tint="bg-violet-500/10 text-violet-300/80" title={jointReasonText(joint)}>
              JOINT · historical
            </Badge>
          )}
          {op && (
            <Link href={`/operations?op=${op.id}`} className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10">
              {joint?.activeVia?.opId === op.id ? `Joint via Operation ${op.name}` : `Operation: ${op.name}`}
            </Link>
          )}
          {!op && joint?.operations.filter((o) => !o.linked).slice(0, 1).map((o) => (
            <Link key={o.opId} href={`/operations?op=${o.opId}`} className="inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-400 hover:bg-white/10">
              Formerly Operation {o.opName} ({o.opStatus})
            </Link>
          ))}
        </div>
      </div>

      {/* Line 3 — stage strip: primary next action + follow-up + counters. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {hint && <span className={`inline-flex rounded-lg px-2.5 py-1 text-sm font-semibold ${hint.c}`}>{hint.t}</span>}
          {primary?.detail && <span className="text-sm text-slate-400">{primary.detail}</span>}
          {c.follow_up_at && (canEdit ? (
            <button
              onClick={() => setFollowUpOpen(true)}
              title="Edit follow-up"
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${followUpDue ? 'bg-amber-500/15 text-amber-300' : 'bg-white/5 text-slate-300'} hover:bg-white/10`}
            >
              Follow-up {c.follow_up_at.slice(0, 10)}
              <DeadlineChip at={c.follow_up_at} kind="due" />
            </button>
          ) : (
            <Badge tint={followUpDue ? 'bg-amber-500/15 text-amber-300' : undefined}>
              Follow-up {c.follow_up_at.slice(0, 10)}
              <DeadlineChip at={c.follow_up_at} kind="due" />
            </Badge>
          ))}
          <Badge
            tint={(openBlockers ?? 0) > 0 ? 'bg-amber-500/15 text-amber-300' : undefined}
            title="Open blockers on this case (see the Brief tab)"
          >
            <span className="tabular-nums">{openBlockers ?? '—'}</span> blockers
          </Badge>
          <Badge
            tint={overdueTasks > 0 ? 'bg-rose-500/15 text-rose-300' : undefined}
            title="Overdue tasks on this case"
          >
            <span className="tabular-nums">{assessment ? overdueTasks : '—'}</span> overdue
          </Badge>
        </div>
        {primary && (primaryGo
          ? <Button variant="primary" onClick={primaryGo}>{primary.label}</Button>
          : <span className="rounded-lg bg-white/5 px-3 py-2 text-sm font-semibold text-slate-300">{primary.label}</span>)}
      </div>

      <FollowUpModal open={followUpOpen} c={c} onClose={() => setFollowUpOpen(false)} onChanged={onChanged} />
      <PacketModal open={packetOpen} c={c} onClose={() => setPacketOpen(false)} />
      <JointCaseModal
        open={jointOpen}
        onClose={() => setJointOpen(false)}
        c={c}
        mode="convert"
        existingAssignments={jointAssignments}
        onDone={() => { setJointOpen(false); onChanged() }}
      />
    </section>
  )
}

function FollowUpModal({ open, c, onClose, onChanged }: { open: boolean; c: CaseRow; onClose: () => void; onChanged: () => void }) {
  const [date, setDate] = useState(c.follow_up_at?.slice(0, 10) ?? '')
  useEffect(() => { if (open) queueMicrotask(() => setDate(c.follow_up_at?.slice(0, 10) ?? '')) }, [open, c.follow_up_at])
  const save = async (clear = false) => {
    const res = await update('cases', c.id, { follow_up_at: clear ? null : date || null })
    if (res.error) toast(res.error.message, 'danger')
    else { toast(clear ? 'Follow-up cleared.' : 'Follow-up saved.', 'success'); onClose(); onChanged() }
  }
  return (
    <Modal open={open} onClose={onClose} dirty={() => date !== (c.follow_up_at?.slice(0, 10) ?? '')}>
      <div className="p-5">
        <ModalHeader title="Follow-up" onClose={onClose} />
        <input type="date" aria-label="Follow-up date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => void save(true)}>Clear</Button>
          <Button variant="primary" onClick={() => void save()}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}

function PacketModal({ open, c, onClose }: { open: boolean; c: CaseRow; onClose: () => void }) {
  const { isCommand } = useAuth()
  // Gathered once per open so the restricted-exclusion notice reflects what
  // an export would actually ship; an in-modal approval re-gathers.
  const [data, setData] = useState<PacketData | null>(null)
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      setData(null)
      void gatherCasePacket(c).then(setData).catch((e) => toast(e instanceof Error ? e.message : e, 'danger'))
    })
  }, [open, c])

  const exportMd = () => {
    if (!data) return
    packetMarkdown(c, data)
    onClose()
  }
  const exportDocx = () => {
    if (!data) return
    packetDocx(c, data)
    onClose()
  }
  const [pdfBusy, setPdfBusy] = useState(false)
  const exportPdf = async () => {
    if (!data || pdfBusy) return
    setPdfBusy(true)
    try {
      const { downloadPdf } = await import('@/lib/pdf')
      await downloadPdf(packetPdfSpec(c, data), `${slug(c.case_number)}-packet.pdf`)
      onClose()
    } catch (e) { toast(e instanceof Error ? e.message : e, 'danger') }
    finally { setPdfBusy(false) }
  }
  // Command may open the 1h restricted-export window (server-audited); the
  // re-gather folds the restricted rows back into the packet.
  const approveRestricted = async () => {
    const note = await uiPrompt('Optional note for the restricted-access audit trail.', {
      title: 'Approve restricted export (1 h)',
      confirmText: 'Approve export',
    })
    if (note === null) return
    const res = await rpc('packet_export_approve_restricted', { p_case: c.id, ...(note.trim() ? { p_note: note.trim() } : {}) })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Restricted export approved for 1 hour.', 'success')
    setData(null)
    setData(await gatherCasePacket(c))
  }
  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-5">
        <ModalHeader title="Case packet" onClose={onClose} />
        {data != null && data.restrictedExcluded > 0 && (
          <div className="mb-3 space-y-2 rounded-lg border border-rose-400/30 bg-rose-500/[0.07] p-3">
            <p className="text-xs text-rose-100">
              {data.restrictedExcluded} restricted {data.restrictedExcluded === 1 ? 'item is' : 'items are'} excluded —
              Lead+ approval required for restricted export.
            </p>
            {isCommand && (
              <Button size="sm" variant="warn" onAction={approveRestricted}>Approve restricted export (1 h)</Button>
            )}
          </div>
        )}
        <div className="grid gap-2">
          <Button variant="primary" onClick={exportDocx} disabled={!data}>Download DOCX</Button>
          <Button variant="primary" onClick={exportMd} disabled={!data}>Download Markdown</Button>
          <Button variant="primary" onClick={() => void exportPdf()} disabled={!data || pdfBusy}>{pdfBusy ? 'Rendering PDF…' : 'Download PDF'}</Button>
        </div>
        {data == null && <p className="mt-2 text-xs text-slate-400">Gathering case data…</p>}
      </div>
    </Modal>
  )
}
