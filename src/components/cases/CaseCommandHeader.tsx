'use client'

/** Case command header — one identity line (number · status · bureau · joint ·
 *  priority), a stage readout with THE single primary next action (from the
 *  shared assessCase engine), and the long tail of case actions folded into an
 *  ActionMenu instead of an 11-button wall. Behavior is unchanged: every
 *  former header action is still reachable, just grouped. */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ActionMenu, type ActionItem } from '@/components/ui/ActionMenu'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { uiConfirm } from '@/components/ui/dialog'
import { list, rpc, update } from '@/lib/db'
import { copyText, slug, todayISO } from '@/lib/format'
import { caseLink } from '@/lib/caseLinks'
import { priorityTint } from '@/lib/tint'
import { useAuth } from '@/lib/auth'
import { useAction } from '@/lib/useAction'
import { bureauLabel } from '@/lib/roles'
import { officerName } from '@/lib/profiles'
import { useWatchlistStore } from '@/lib/watchlist'
import { caseCourtHint, caseStatusTint, CASE_STATUSES, signoffLabel, signoffTint } from '@/lib/signoff'
import type { CaseAssessment, CaseStage } from '@/lib/caseWorkflow'
import { gatherCasePacket, packetDocx, packetMarkdown, packetPdfSpec } from '@/lib/packet'
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

export function CaseCommandHeader({
  c,
  op,
  assessment,
  pinned,
  canEdit,
  canArchive,
  canDelete,
  canHandover,
  canReassignBureau,
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
  assessment: CaseAssessment | null
  pinned: boolean
  canEdit: boolean
  canArchive: boolean
  canDelete: boolean
  canHandover: boolean
  canReassignBureau: boolean
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
  if (admin.length) { admin[0].separatorBefore = true; items.push(...admin) }
  if (canArchive) items.push({ label: c.archived_at ? 'Restore case' : 'Archive case', onClick: onArchive, separatorBefore: !admin.length })
  if (canDelete) items.push({ label: 'Permanently delete case…', onClick: onDelete, danger: true, separatorBefore: true })

  // Primary action: the top assessCase recommendation. Tab-bearing actions
  // navigate; the tab-less "follow-up is due" opens the follow-up editor.
  const primary = assessment?.nextActions[0] ?? null
  let primaryGo: (() => void) | null = null
  if (primary?.tab) { const t = primary.tab; primaryGo = () => onGoTab(t) }
  else if (primary?.key === 'followup_due' && canEdit) primaryGo = () => setFollowUpOpen(true)

  const followUpDue = !!c.follow_up_at && c.follow_up_at.slice(0, 10) <= todayISO()

  return (
    <section className="rounded-2xl border border-white/10 bg-ink-900/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {/* Identity group — what the case is. */}
            <button onClick={() => copyText(c.case_number, 'Case number')} title="Copy case number" className="inline-flex items-center rounded-full bg-white/5 px-2.5 py-0.5 font-mono text-[11px] font-bold text-badge-200 hover:bg-white/10">{c.case_number}</button>
            <Badge>{c.bureau}</Badge>
            {c.is_joint_case && (
              <Badge
                tint="bg-violet-500/15 text-violet-300"
                title={`Originating department: ${bureauLabel(c.originating_bureau ?? c.bureau)}`}
              >
                JTF · Joint case
              </Badge>
            )}
            <span aria-hidden className="mx-0.5 h-4 w-px bg-white/10" />
            {/* Workflow group — where the case stands. */}
            <Badge tint={caseStatusTint(c.status)} className="uppercase">{c.status}</Badge>
            <Badge tint={signoffTint(c.signoff_status)}>{signoffLabel(c.signoff_status)}</Badge>
            {c.priority && <Badge tint={priorityTint(c.priority)} className="uppercase">{c.priority} priority</Badge>}
            <StaleBadge c={c} />
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
          </div>
          <h1 className="text-2xl font-black text-white">{c.title || 'Untitled case'}</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">{c.summary || 'No summary recorded.'}</p>
          {op && <Link href={`/operations?op=${op.id}`} className="mt-2 inline-flex items-center rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10">Operation: {op.name}</Link>}
          {hint && <p className={`mt-3 inline-flex rounded-lg px-3 py-2 text-sm font-semibold ${hint.c}`}>{hint.t}</p>}
        </div>
        <div className="flex flex-wrap items-start justify-end gap-2">
          {canEdit ? (
            <select aria-label="Case status" value={c.status} onChange={(e) => onStatusChange(e.target.value as CaseRow['status'])} className={CONTROL}>
              {CASE_STATUSES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
          ) : <span className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300">Read-only</span>}
          {canEdit && (
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
          )}
          <ActionMenu items={items} label="More case actions" buttonClassName="h-10 px-3.5" />
        </div>
      </div>

      {assessment && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Stage</span>
            <Badge tint={STAGE_TINTS[assessment.stage]}>{assessment.stageLabel}</Badge>
            {primary?.detail && <span className="text-sm text-slate-400">{primary.detail}</span>}
          </div>
          {primary && (primaryGo
            ? <Button variant="primary" onClick={primaryGo}>{primary.label}</Button>
            : <span className="rounded-lg bg-white/5 px-3 py-2 text-sm font-semibold text-slate-300">{primary.label}</span>)}
        </div>
      )}

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
    <Modal open={open} onClose={onClose}>
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
  const exportMd = async () => {
    try {
      const data = await gatherCasePacket(c)
      packetMarkdown(c, data)
      onClose()
    } catch (e) { toast(e instanceof Error ? e.message : e, 'danger') }
  }
  const exportDocx = async () => {
    try {
      const data = await gatherCasePacket(c)
      packetDocx(c, data)
      onClose()
    } catch (e) { toast(e instanceof Error ? e.message : e, 'danger') }
  }
  const [pdfBusy, setPdfBusy] = useState(false)
  const exportPdf = async () => {
    if (pdfBusy) return
    setPdfBusy(true)
    try {
      const data = await gatherCasePacket(c)
      const { downloadPdf } = await import('@/lib/pdf')
      await downloadPdf(packetPdfSpec(c, data), `${slug(c.case_number)}-packet.pdf`)
      onClose()
    } catch (e) { toast(e instanceof Error ? e.message : e, 'danger') }
    finally { setPdfBusy(false) }
  }
  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-5">
        <ModalHeader title="Case packet" onClose={onClose} />
        <div className="grid gap-2">
          <Button variant="primary" onClick={exportDocx}>Download DOCX</Button>
          <Button variant="primary" onClick={exportMd}>Download Markdown</Button>
          <Button variant="primary" onClick={() => void exportPdf()} disabled={pdfBusy}>{pdfBusy ? 'Rendering PDF…' : 'Download PDF'}</Button>
        </div>
      </div>
    </Modal>
  )
}
