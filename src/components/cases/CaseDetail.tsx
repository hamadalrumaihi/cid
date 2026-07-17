'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { DetailSkeleton } from '@/components/ui/Skeleton'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { SectionTabs, panelDomId, tabDomId, type SectionTab, type SectionTabGroup } from '@/components/ui/SectionTabs'
import { uiConfirm } from '@/components/ui/dialog'
import { countRows, deleteWithUndo, list, update, withRetry } from '@/lib/db'
import { todayISO } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useOperationsStore } from '@/lib/operations'
import { assessCase, type PersistedBlocker, type WfLegal, type WfReport, type WfTask } from '@/lib/caseWorkflow'
import { parseCharges } from '@/lib/jsonShapes'
import { officerName, activeProfiles } from '@/lib/profiles'
import { notify } from '@/lib/notify'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { isPinnedCase, pushRecentCase, togglePinCase } from './caseUtils'
import { CaseModal } from './CaseModal'
import { CaseCommandHeader } from './CaseCommandHeader'
import { ReassignBureauModal } from './ReassignBureauModal'
import { OverviewTab } from './tabs/OverviewTab'
import { NotesTab } from './tabs/NotesTab'
import { EvidenceTab } from './tabs/EvidenceTab'
import { ChargesTab } from './tabs/ChargesTab'
import { RicoTab } from './tabs/RicoTab'
import { IntelTab } from './tabs/IntelTab'
import { ReportsTab } from './tabs/ReportsTab'
import { TasksTab } from './tabs/TasksTab'
import { SignoffTab } from './tabs/SignoffTab'
import { ChatTab } from './tabs/ChatTab'
import { TimelineTab } from './tabs/TimelineTab'
import type { CaseRow } from './tabs/shared'

// RicoView renders the same tracker outside the case screen.
export { RicoTab } from './tabs/RicoTab'

// React Flow is heavy — load the graph only when its tab is opened.
const CaseGraphTab = dynamic(() => import('./CaseGraphTab').then((m) => m.CaseGraphTab), {
  ssr: false,
  loading: () => <p className="py-10 text-center text-sm text-slate-500">Building the link chart…</p>,
})

const TABS = ['overview', 'graph', 'evidence', 'notes', 'charges', 'rico', 'intel', 'reports', 'tasks', 'signoff', 'chat', 'timeline'] as const
type TabId = (typeof TABS)[number]

const TAB_LABELS: Record<TabId, string> = {
  overview: 'Overview', graph: 'Graph', evidence: 'Evidence', notes: 'Notes',
  charges: 'Charges', rico: 'RICO', intel: 'Intel', reports: 'Reports',
  tasks: 'Tasks', signoff: 'Sign-off', chat: 'Chat', timeline: 'Timeline',
}

// Visual grouping only — the tab ids and ?tab= URL values are unchanged.
const TAB_GROUPS: ReadonlyArray<SectionTabGroup<TabId>> = [
  { label: 'Command', tabs: ['overview', 'signoff', 'timeline'] },
  { label: 'Investigation', tabs: ['graph', 'evidence', 'notes', 'charges', 'rico', 'intel'] },
  { label: 'Documentation', tabs: ['reports'] },
  { label: 'Collaboration', tabs: ['tasks', 'chat'] },
]

interface WorkflowRows {
  tasks: WfTask[]
  reports: WfReport[]
  legal: WfLegal[]
  evidence: number
  blockers: PersistedBlocker[]
}

export function CaseDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const router = useRouter()
  const sp = useSearchParams()
  const { profile, canEdit, canDelete, isCommand, isOwner } = useAuth()
  const operations = useOperationsStore((s) => s.operations)
  const [c, setCase] = useState<CaseRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(false)
  const [handover, setHandover] = useState(false)
  const [reassign, setReassign] = useState(false)
  const casesV = useTableVersion('cases')
  const tab = (sp.get('tab') && TABS.includes(sp.get('tab') as TabId) ? sp.get('tab') : 'overview') as TabId

  const fetchCase = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await withRetry(() => list('cases', { eq: { id } }))
      setCase(rows[0] ?? null)
      if (rows[0]) pushRecentCase(rows[0].id)
    } catch (e) {
      toast(e instanceof Error ? e.message : e, 'danger')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { queueMicrotask(() => { void fetchCase() }) }, [fetchCase, casesV])

  const setTab = (next: TabId) => {
    const params = new URLSearchParams(sp.toString())
    params.set('case', id)
    params.set('tab', next)
    router.replace(`/cases?${params.toString()}`)
  }

  // ── Workflow snapshot for the command header + metric strip. Row fetches are
  //    the same case-scoped queries the tabs run; evidence uses a HEAD count so
  //    no rows move. Open blockers come over as rows (not a count) so the same
  //    fetch feeds assessCase's persistedBlockers — header, metric strip and
  //    Overview all gate on identical data. Best-effort: the header renders
  //    without it. ──
  const [wf, setWf] = useState<WorkflowRows | null>(null)
  const vE = useTableVersion('evidence')
  const vR = useTableVersion('reports')
  const vT = useTableVersion('case_tasks')
  const vL = useTableVersion('legal_requests')
  const vB = useTableVersion('case_blockers')
  const fetchWorkflow = useCallback(async () => {
    try {
      const [tasks, reports, legal, evidence, blockers] = await Promise.all([
        list('case_tasks', { eq: { case_id: id } }),
        list('reports', { eq: { case_id: id } }),
        // Legal is read-scoped by RLS; a failure must not sink the header.
        list('legal_requests', { eq: { case_id: id } }).catch(() => [] as WfLegal[]),
        countRows('evidence', { eq: { case_id: id } }),
        list('case_blockers', { eq: { case_id: id, status: 'open' } }).catch(() => [] as PersistedBlocker[]),
      ])
      setWf({ tasks, reports, legal, evidence, blockers })
    } catch { /* header/metrics render with em-dashes until a fetch lands */ }
  }, [id])
  useEffect(() => { queueMicrotask(() => { void fetchWorkflow() }) }, [fetchWorkflow, casesV, vE, vR, vT, vL, vB])

  const assessment = useMemo(() => (c && wf ? assessCase({
    c,
    tasks: wf.tasks, reports: wf.reports, legal: wf.legal,
    evidenceCount: wf.evidence,
    persistedBlockers: wf.blockers,
    meId: profile?.id ?? null,
    assigneeName: officerName(c.signoff_assignee_id),
  }) : null), [c, wf, profile?.id])

  if (loading) return <DetailSkeleton />
  if (!c) return <p className="rounded-2xl border border-white/10 bg-ink-900/50 p-6 text-slate-300">Case not found.</p>

  const op = operations.find((x) => x.id === c.operation_id)
  const pinned = isPinnedCase(c.id)
  // The current lead (or command) may hand the case to another officer.
  const canHandover = !!profile && (c.lead_detective_id === profile.id || isCommand)
  // Bureau reassignment is Deputy Director+/Owner (never bureau_lead) — the
  // cosmetic mirror of case_reassign_bureau's server rule; RLS + the freeze
  // trigger enforce the real one.
  const canReassignBureau = isOwner || (isCommand && (profile?.role === 'deputy_director' || profile?.role === 'director'))
  // "Awaiting a decision" reuses the established sign-off vocabulary: every
  // awaiting state is prefixed awaiting_ (lib/signoff), same set caseCourtHint
  // keys off. No new states invented.
  const awaitingSignoff = (c.signoff_status ?? '').startsWith('awaiting_')

  const quickStatus = async (status: CaseRow['status']) => {
    // Closing stamps closed_at and takes the case off the active board — worth
    // a beat of confirmation. It stays reversible (set it back to reopen).
    if (status === 'closed' && c.status !== 'closed') {
      // Pre-close checklist: surface unresolved work via the shared evaluator
      // so a case isn't closed over open sign-off / tasks / legal / drafts. This
      // is advisory — command can still close over it (reason lives in history).
      let blockerLines = ''
      try {
        const [tasks, reports, legal, evidence, persisted] = await Promise.all([
          list('case_tasks', { eq: { case_id: c.id } }),
          list('reports', { eq: { case_id: c.id } }),
          list('legal_requests', { eq: { case_id: c.id } }).catch(() => []),
          list('evidence', { eq: { case_id: c.id } }),
          list('case_blockers', { eq: { case_id: c.id, status: 'open' } }).catch(() => [] as PersistedBlocker[]),
        ])
        const { blockers } = assessCase({ c, tasks, reports, legal, evidenceCount: evidence.length, persistedBlockers: persisted, meId: profile?.id ?? null, todayISO: todayISO() })
        if (blockers.length) blockerLines = '\n\nStill open on this case:\n' + blockers.map((b) => `• ${b.label}`).join('\n') + '\n\nClose anyway?'
      } catch { /* checklist is best-effort; fall back to the plain confirm */ }
      const ok = await uiConfirm(
        `Close ${c.case_number}? It will leave the active case board. You can reopen it later.${blockerLines}`,
        { title: 'Close case', confirmText: blockerLines ? 'Close anyway' : 'Close case', danger: !!blockerLines },
      )
      if (!ok) { void fetchCase(); return }
    }
    const res = await update('cases', c.id, { status, closed_at: status === 'closed' && !c.closed_at ? new Date().toISOString() : c.closed_at })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Status updated.', 'success'); onChanged(); void fetchCase() }
  }

  const deleteCase = async () => {
    const ok = await deleteWithUndo('cases', c, {
      label: c.case_number,
      children: [
        { table: 'case_assignments', column: 'case_id' },
        { table: 'case_tasks', column: 'case_id' },
        { table: 'case_messages', column: 'case_id' },
        { table: 'case_signoff_history', column: 'case_id' },
        { table: 'reports', column: 'case_id' },
      ],
      setNullRefs: [{ table: 'evidence', column: 'case_id' }, { table: 'media', column: 'case_id' }],
    })
    if (ok) { onBack(); onChanged() }
  }

  // Header/metric derivations — cheap, render-pure.
  const chargesCount = parseCharges(c.charges).reduce((n, x) => n + Math.max(1, x.count || 1), 0)
  const openTasks = wf ? wf.tasks.filter((t) => !t.done).length : null
  const counts = assessment?.counts ?? null

  const metrics: Metric[] = [
    { label: 'Evidence', value: wf ? wf.evidence : '—', onClick: () => setTab('evidence') },
    {
      label: 'Open tasks', value: openTasks ?? '—', onClick: () => setTab('tasks'),
      hint: counts && counts.overdueTasks > 0 ? `${counts.overdueTasks} overdue` : undefined,
      tint: counts && counts.overdueTasks > 0 ? 'bg-rose-500/15 text-rose-300' : undefined,
    },
    {
      label: 'Reports', value: wf ? wf.reports.length : '—', onClick: () => setTab('reports'),
      hint: counts && counts.draftReports > 0 ? `${counts.draftReports} draft` : undefined,
    },
    {
      label: 'Open blockers', value: wf ? wf.blockers.length : '—', onClick: () => setTab('overview'),
      tint: wf && wf.blockers.length > 0 ? 'bg-amber-500/15 text-amber-300' : undefined,
    },
    { label: 'Charges', value: chargesCount, onClick: () => setTab('charges') },
  ]

  const tabDefs: Array<SectionTab<TabId>> = TABS.map((t) => ({
    id: t,
    label: TAB_LABELS[t],
    count:
      t === 'evidence' ? wf?.evidence
      : t === 'reports' ? wf?.reports.length
      : t === 'tasks' ? openTasks ?? undefined
      : t === 'charges' ? chargesCount
      : undefined,
    marker: t === 'signoff' && awaitingSignoff,
    markerLabel: t === 'signoff' ? 'Sign-off requires attention' : undefined,
  }))

  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: 'Cases', onClick: onBack }, { label: c.case_number }]} />
      <CaseCommandHeader
        c={c}
        op={op ? { id: op.id, name: op.name } : null}
        assessment={assessment}
        pinned={pinned}
        canEdit={canEdit}
        canDelete={canDelete}
        canHandover={canHandover}
        canReassignBureau={canReassignBureau}
        onStatusChange={(s) => void quickStatus(s)}
        onPinToggle={() => { togglePinCase(c.id); setCase({ ...c }) }}
        onEdit={() => setEdit(true)}
        onHandover={() => setHandover(true)}
        onReassign={() => setReassign(true)}
        onDelete={() => void deleteCase()}
        onChanged={() => { onChanged(); void fetchCase() }}
        onGoTab={(t) => setTab(TABS.includes(t as TabId) ? (t as TabId) : 'overview')}
      />

      <MetricStrip metrics={metrics} />

      {/* Sticky tab strip — tucks directly under the shell header (sticky
          top-0). Header ≈ 4.5rem mobile / 4.75rem sm+; z-10 stays below the
          header's z-20 so the header owns the seam (no gap, no overlap). */}
      <div className="sticky top-[4.5rem] z-10 -mx-4 border-b border-white/10 bg-ink-950/90 px-4 backdrop-blur sm:top-[4.75rem] sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <SectionTabs<TabId>
          tabs={tabDefs}
          groups={TAB_GROUPS}
          active={tab}
          onChange={setTab}
          idBase="case"
          ariaLabel="Case sections"
          className="py-1"
        />
      </div>
      <section role="tabpanel" id={panelDomId('case', tab)} aria-labelledby={tabDomId('case', tab)} tabIndex={0} className="rounded-2xl border border-white/10 bg-ink-900/45 p-4">
        {tab === 'overview' && <OverviewTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'graph' && <CaseGraphTab c={c} />}
        {tab === 'evidence' && <EvidenceTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'notes' && <NotesTab c={c} canEdit={canEdit} onChanged={fetchCase} />}
        {tab === 'charges' && <ChargesTab c={c} canEdit={canEdit} onChanged={fetchCase} />}
        {tab === 'rico' && <RicoTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'intel' && <IntelTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'reports' && <ReportsTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'tasks' && <TasksTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'signoff' && <SignoffTab c={c} />}
        {tab === 'chat' && <ChatTab c={c} />}
        {tab === 'timeline' && <TimelineTab c={c} />}
      </section>
      <CaseModal open={edit} record={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onChanged(); void fetchCase() }} />
      <HandoverModal open={handover} c={c} onClose={() => setHandover(false)} onDone={() => { setHandover(false); onChanged(); void fetchCase() }} />
      <ReassignBureauModal open={reassign} c={c} onClose={() => setReassign(false)} onDone={() => { setReassign(false); onChanged(); void fetchCase() }} />
    </div>
  )
}

/* ── Case handover ──────────────────────────────────────────────────────────
 * The current lead (or command) reassigns the case to another officer. The
 * lead field is a plain, RLS-guarded case update; both the outgoing and
 * incoming lead are notified (case_handover — a case-access-gated type on the
 * guarded create_notification path) so a handover is never silent. */
function HandoverModal({ open, c, onClose, onDone }: { open: boolean; c: CaseRow; onClose: () => void; onDone: () => void }) {
  const { profile } = useAuth()
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) queueMicrotask(() => { setTo(''); setNote('') }) }, [open])
  const options = activeProfiles().filter((p) => p.id !== c.lead_detective_id)
  const run = async () => {
    if (!to || busy) return
    setBusy(true)
    const res = await update('cases', c.id, { lead_detective_id: to })
    if (res.error) { setBusy(false); toast(res.error.message, 'danger'); return }
    const actor = profile?.display_name || 'An officer'
    const payload = { case_id: c.id, case_number: c.case_number, detective: actor, title: c.title || c.case_number, ...(note.trim() ? { reason: note.trim() } : {}) }
    void notify(to, 'case_handover', { ...payload, reason: note.trim() || `${actor} handed you the lead on ${c.case_number}.` })
    if (c.lead_detective_id && c.lead_detective_id !== profile?.id) {
      void notify(c.lead_detective_id, 'case_handover', { ...payload, reason: `${officerName(to) || 'Another officer'} is now the lead on ${c.case_number}.` })
    }
    setBusy(false)
    toast(`Case handed to ${officerName(to) || 'the officer'}.`, 'success')
    onDone()
  }
  return (
    <Modal open={open} onClose={onClose}>
      <div className="p-5">
        <ModalHeader title="Hand over case" onClose={onClose} />
        <p className="text-sm text-slate-300">
          Reassign the lead on <span className="font-mono font-bold text-white">{c.case_number}</span> from{' '}
          <span className="text-slate-200">{officerName(c.lead_detective_id) || 'Unassigned'}</span> to another officer. Both are notified.
        </p>
        <label className="mt-4 block text-sm text-slate-300">New lead
          <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white">
            <option value="">Select an officer…</option>
            {options.map((p) => <option key={p.id} value={p.id}>{officerName(p.id) || p.display_name}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-sm text-slate-300">Handover note (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Context for the incoming lead" className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy || !to}>{busy ? 'Handing over…' : 'Hand over'}</Button>
        </div>
      </div>
    </Modal>
  )
}
