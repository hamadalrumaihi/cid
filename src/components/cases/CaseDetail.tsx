'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { DetailSkeleton } from '@/components/ui/Skeleton'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { SectionTabs, panelDomId, tabDomId, type SectionTab, type SectionTabGroup } from '@/components/ui/SectionTabs'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { countRows, list, rpc, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useOperationsStore } from '@/lib/operations'
import { assessCase, ricoTabVisible } from '@/lib/caseWorkflow'
import { normalizeCaseTab } from '@/lib/caseLinks'
import type { Tables } from '@/lib/database.types'
import type { LegalRequest } from '@/lib/justice'
import { countViewerActionable } from '@/lib/legalWorkflow'
import { parseCharges } from '@/lib/jsonShapes'
import { officerName, activeProfiles } from '@/lib/profiles'
import { notify } from '@/lib/notify'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { useNow } from '@/lib/useNow'
import { LEGAL_LIST_COLS, buildLegalViewer, useMyProsecutorBureaus } from '@/components/justice/legalShared'
import { confirmCaseClose, enableRicoSession, isPinnedCase, pushRecentCase, ricoSessionEnabled, togglePinCase } from './caseUtils'
import { CaseModal } from './CaseModal'
import { CaseCommandHeader } from './CaseCommandHeader'
import { ReassignBureauModal } from './ReassignBureauModal'
import { OverviewTab } from './tabs/OverviewTab'
import { MediaTab } from './tabs/MediaTab'
import type { BlockerRow } from './tabs/CaseBlockersPanel'
import { ChargesTab } from './tabs/ChargesTab'
import { RicoTab } from './tabs/RicoTab'
import { IntelTab } from './tabs/IntelTab'
import { LegalTab } from './tabs/LegalTab'
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

const TABS = ['overview', 'graph', 'media', 'intel', 'charges', 'rico', 'reports', 'tasks', 'legal', 'signoff', 'chat', 'timeline'] as const
type TabId = (typeof TABS)[number]

const TAB_LABELS: Record<TabId, string> = {
  overview: 'Overview', graph: 'Graph', media: 'Photos & Media', intel: 'Intel & Notes',
  charges: 'Charges', rico: 'RICO', reports: 'Reports', tasks: 'Tasks',
  legal: 'Legal', signoff: 'Sign-off', chat: 'Chat', timeline: 'Timeline',
}

// Visual grouping only — `?tab=` URL values match the ids (legacy
// `tab=evidence`/`tab=notes` links resolve via normalizeCaseTab). RICO is
// conditional (ricoTabVisible): the group simply skips it when hidden.
const TAB_GROUPS: ReadonlyArray<SectionTabGroup<TabId>> = [
  { label: 'Command', tabs: ['overview'] },
  { label: 'Investigation', tabs: ['graph', 'media', 'intel', 'charges', 'rico'] },
  { label: 'Casework', tabs: ['reports', 'tasks', 'legal'] },
  { label: 'Oversight', tabs: ['signoff', 'chat', 'timeline'] },
]

/** Slim media projection — enough for the metric count + Overview recap. */
type WfMediaRow = Pick<Tables<'media'>, 'id' | 'created_at' | 'archived_at'>

/** The case-scoped workflow snapshot — fetched ONCE here and shared with the
 *  command header, metric strip AND OverviewTab (which used to run the same
 *  five queries again in parallel — the audit's triple-fetch). */
export interface WorkflowRows {
  tasks: Tables<'case_tasks'>[]
  reports: Tables<'reports'>[]
  /** Narrow LEGAL_LIST_COLS projection — everything the cards, the workflow
   *  model and the Legal tab read; RLS scopes the rows, unchanged. */
  legal: LegalRequest[]
  media: WfMediaRow[]
  blockers: BlockerRow[]
  /** rico_cases rows for this case (0/1 — UNIQUE case_id). HEAD count only;
   *  drives the conditional RICO tab. */
  rico: number
}

export function CaseDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const sp = useSearchParams()
  const auth = useAuth()
  const { profile, canEdit, canDelete, isCommand, isOwner } = auth
  const operations = useOperationsStore((s) => s.operations)
  const [c, setCase] = useState<CaseRow | null>(null)
  // The id this view successfully loaded at least once — distinguishes a case
  // that vanished on refetch (access ended: joint expiry, RLS change) from one
  // that never resolved at all.
  const [everLoadedId, setEverLoadedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [edit, setEdit] = useState(false)
  const [handover, setHandover] = useState(false)
  const [reassign, setReassign] = useState(false)
  const casesV = useTableVersion('cases')
  // Legacy ?tab=evidence (old links/notifications/search hits) maps to media.
  const requestedTab = normalizeCaseTab(sp.get('tab'))
  const urlTab = (requestedTab && TABS.includes(requestedTab as TabId) ? requestedTab : 'overview') as TabId
  // Same-page section switching is local state synced to the URL through the
  // native history API (Next keeps useSearchParams in step with it). A router
  // round-trip is avoided deliberately: query-only router navigation reverts
  // in some serving environments. Real navigations (deep links, notification
  // clicks) still win — the effect below adopts any URL-driven tab change.
  const [tabOverride, setTabOverride] = useState<TabId | null>(null)
  const [adoptedKey, setAdoptedKey] = useState(`${id}:${urlTab}`)
  if (adoptedKey !== `${id}:${urlTab}`) {
    // Render-phase adjustment (not an effect): a URL-driven change means a
    // real navigation landed — it supersedes any local override.
    setAdoptedKey(`${id}:${urlTab}`)
    setTabOverride(null)
  }
  const tab = tabOverride ?? urlTab

  // Stale-while-revalidate (the useRegistry idiom): once THIS id has loaded,
  // realtime-bump refetches must not blank the screen back to the skeleton —
  // that unmounts every tab and loses scroll + tab-local state. The skeleton
  // shows only on first load or when `id` changes. A ref (not state) so
  // back-to-back refetches in one tick see it flip.
  const loadedIdRef = useRef<string | null>(null)
  const fetchCase = useCallback(async () => {
    if (loadedIdRef.current !== id) setLoading(true)
    try {
      const rows = await withRetry(() => list('cases', { eq: { id } }))
      setCase(rows[0] ?? null)
      loadedIdRef.current = id
      if (rows[0]) { setEverLoadedId(id); pushRecentCase(rows[0].id) }
    } catch (e) {
      toast(e instanceof Error ? e.message : e, 'danger')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { queueMicrotask(() => { void fetchCase() }) }, [fetchCase, casesV])

  const setTab = (next: TabId) => {
    setTabOverride(next)
    const params = new URLSearchParams(sp.toString())
    params.set('case', id)
    params.set('tab', next)
    window.history.replaceState(window.history.state, '', `/cases?${params.toString()}`)
  }

  // ── Workflow snapshot — the ONE case-scoped fetch behind the command
  //    header, metric strip and OverviewTab (passed down as props; Overview
  //    no longer re-runs these queries). Media comes over as slim rows so
  //    the same fetch feeds the Photos metric AND the Overview recap; blockers
  //    come over whole (open + resolved) for the blockers panel history —
  //    assessCase filters open rows itself. Best-effort: the header renders
  //    without it. ──
  const [wf, setWf] = useState<WorkflowRows | null>(null)
  // Active legal hold on this case (D7). Null = none; the banner + delete guard
  // key off it. Command places/lifts; anyone who can see the case sees it.
  const [hold, setHold] = useState<Tables<'legal_holds'> | null>(null)
  const [wfForId, setWfForId] = useState(id)
  if (wfForId !== id) {
    // Render-phase adjustment (same idiom as adoptedKey above): navigating to
    // a different case drops the previous case's snapshot — the header and
    // metrics render em-dashes for wf === null until the fresh fetch lands,
    // never the old case's counts.
    setWfForId(id)
    setWf(null)
    setHold(null)
  }
  const vM = useTableVersion('media')
  const vR = useTableVersion('reports')
  const vT = useTableVersion('case_tasks')
  const vL = useTableVersion('legal_requests')
  const vB = useTableVersion('case_blockers')
  const vRi = useTableVersion('rico_cases')
  const fetchWorkflow = useCallback(async () => {
    try {
      const [tasks, reports, legal, media, blockers, rico] = await Promise.all([
        list('case_tasks', { eq: { case_id: id } }),
        list('reports', { eq: { case_id: id } }),
        // Legal is read-scoped by RLS; a failure must not sink the header.
        // Narrow projection — the Legal tab + cards read the same columns.
        list('legal_requests', { select: LEGAL_LIST_COLS, eq: { case_id: id }, order: 'created_at', ascending: false }).catch(() => [] as LegalRequest[]),
        list('media', { select: 'id,created_at,archived_at', eq: { case_id: id } })
          .then((r) => r as unknown as WfMediaRow[]),
        list('case_blockers', { eq: { case_id: id }, order: 'created_at', ascending: false }).catch(() => [] as BlockerRow[]),
        // Cheap HEAD count — has this case ever grown a RICO tracker?
        countRows('rico_cases', { eq: { case_id: id } }).catch(() => 0),
      ])
      setWf({ tasks, reports, legal: legal as LegalRequest[], media, blockers, rico })
    } catch { /* header/metrics render with em-dashes until a fetch lands */ }
  }, [id])
  useEffect(() => { queueMicrotask(() => { void fetchWorkflow() }) }, [fetchWorkflow, casesV, vM, vR, vT, vL, vB, vRi])

  // Legal hold — its own tiny fetch (independent of the workflow snapshot).
  // RLS lets command + anyone who can access the case read it; a denied read
  // just leaves the banner off.
  const vH = useTableVersion('legal_holds')
  const fetchHold = useCallback(async () => {
    try {
      const rows = await list('legal_holds', { eq: { case_id: id }, order: 'placed_at', ascending: false })
      setHold((rows as Tables<'legal_holds'>[]).find((h) => !h.lifted_at) ?? null)
    } catch { setHold(null) }
  }, [id])
  useEffect(() => { queueMicrotask(() => { void fetchHold() }) }, [fetchHold, vH])

  // Photos = non-archived case media (archived rows stay out of every count).
  const mediaCount = useMemo(() => (wf ? wf.media.filter((m) => !m.archived_at).length : null), [wf])

  const assessment = useMemo(() => (c && wf ? assessCase({
    c,
    tasks: wf.tasks, reports: wf.reports, legal: wf.legal,
    mediaCount: mediaCount ?? 0,
    persistedBlockers: wf.blockers,
    meId: profile?.id ?? null,
    assigneeName: officerName(c.signoff_assignee_id),
  }) : null), [c, wf, mediaCount, profile?.id])

  // Legal-tab attention marker: how many of THIS viewer's case legal rows need
  // their own action (dispositionFor — awareness excluded). Same fetched rows
  // as the tab; sealed rows outside the viewer's RLS never reach this.
  const prosecutorBureaus = useMyProsecutorBureaus()
  const legalNow = useNow()
  const legalNeedsAction = useMemo(
    () => (wf ? countViewerActionable(wf.legal, buildLegalViewer(auth, prosecutorBureaus), legalNow) : 0),
    [wf, auth, prosecutorBureaus, legalNow],
  )

  // Conditional RICO tab: visible with data, after an explicit session enable,
  // or under a direct ?tab=rico deep link (saved links never break). A deep
  // link also stamps the session flag so the tab survives switching away.
  useEffect(() => { if (tab === 'rico') enableRicoSession(id) }, [tab, id])
  const ricoOn = ricoTabVisible({ hasData: (wf?.rico ?? 0) > 0, sessionEnabled: ricoSessionEnabled(id), activeTab: tab })

  if (loading) return <DetailSkeleton />
  if (!c) {
    return (
      <p className="rounded-2xl border border-white/10 bg-ink-900/50 p-6 text-slate-300">
        {everLoadedId === id
          ? 'This case is no longer available to you — your access may have ended.'
          : 'Case not found.'}
      </p>
    )
  }

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
    // The pre-close checklist confirm is shared with the board (caseUtils).
    if (status === 'closed' && c.status !== 'closed') {
      const ok = await confirmCaseClose(c, profile?.id ?? null)
      if (!ok) { void fetchCase(); return }
    }
    const res = await update('cases', c.id, { status, closed_at: status === 'closed' && !c.closed_at ? new Date().toISOString() : c.closed_at })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Status updated.', 'success'); onChanged(); void fetchCase() }
  }

  const archiveCase = async () => {
    const restoring = !!c.archived_at
    const ok = await uiConfirm(restoring
      ? `Restore ${c.case_number} to the working views?`
      : `Archive ${c.case_number}? Nothing is deleted — the case leaves the working views and stays restorable under the Archived filter.`,
      { confirmText: restoring ? 'Restore' : 'Archive' })
    if (!ok) return
    const res = restoring ? await rpc('case_restore', { p_case: c.id }) : await rpc('case_archive', { p_case: c.id })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(restoring ? 'Case restored.' : 'Case archived.', 'success')
    onChanged(); if (restoring) void fetchCase(); else onBack()
  }

  const placeHold = async () => {
    const reason = await uiPrompt(
      `Place a legal hold on ${c.case_number}?\n\nWhile the hold is active this case cannot be permanently deleted — not even by the owner — until a command member lifts it.`,
      { title: 'Place legal hold', placeholder: 'Reason (required)', confirmText: 'Place hold' },
    )
    if (reason === null) return
    const res = await rpc('legal_hold_place', { p_case: c.id, p_legal_request: null, p_reason: reason })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Legal hold placed.', 'success'); void fetchHold()
  }

  const liftHold = async () => {
    if (!hold) return
    const reason = await uiPrompt(
      `Lift the legal hold on ${c.case_number}?\n\nOnce lifted the case can be permanently deleted again.`,
      { title: 'Lift legal hold', placeholder: 'Reason (optional)', confirmText: 'Lift hold' },
    )
    if (reason === null) return
    const res = await rpc('legal_hold_lift', { p_hold: hold.id, p_reason: reason || null })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Legal hold lifted.', 'success'); void fetchHold()
  }

  const permanentDelete = async () => {
    const pv = await rpc('case_delete_preview', { p_case: c.id })
    if (pv.error) { toast(pv.error.message, 'danger'); return }
    const preview = pv.data as { items: { table: string; rows: number; on_delete: string }[]; legal_requests: number; active_hold?: boolean; deletable: boolean }
    if (preview.active_hold) {
      toast('This case is under an active legal hold and cannot be deleted — lift the hold first.', 'warn')
      return
    }
    if (!preview.deletable) {
      toast(`This case has ${preview.legal_requests} legal request${preview.legal_requests === 1 ? '' : 's'} on file and cannot be deleted.`, 'warn')
      return
    }
    const lines = preview.items.map((i) => `• ${i.table.replace('public.', '')}: ${i.rows} row${i.rows === 1 ? '' : 's'} ${i.on_delete}`).join('\n')
    const reason = await uiPrompt(
      `Permanently delete ${c.case_number}?\n\nThis cannot be undone. It will destroy:\n${lines || '• (no linked records)'}\n\nEnter the reason (recorded in the audit log):`,
      { title: 'Permanently delete case', placeholder: 'Reason (required)', confirmText: 'Delete forever' },
    )
    if (reason === null) return
    const res = await rpc('case_permanent_delete', { p_case: c.id, p_reason: reason })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(`${c.case_number} permanently deleted.`, 'warn')
    onBack(); onChanged()
  }

  // Header/metric derivations — cheap, render-pure.
  const chargesCount = parseCharges(c.charges).reduce((n, x) => n + Math.max(1, x.count || 1), 0)
  const openTasks = wf ? wf.tasks.filter((t) => !t.done).length : null
  const openBlockers = wf ? wf.blockers.filter((b) => b.status === 'open').length : null
  const counts = assessment?.counts ?? null

  const metrics: Metric[] = [
    { label: 'Photos', value: mediaCount ?? '—', onClick: () => setTab('media') },
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
      label: 'Open blockers', value: openBlockers ?? '—', onClick: () => setTab('overview'),
      tint: openBlockers ? 'bg-amber-500/15 text-amber-300' : undefined,
    },
    { label: 'Charges', value: chargesCount, onClick: () => setTab('charges') },
  ]

  const tabDefs: Array<SectionTab<TabId>> = TABS.filter((t) => t !== 'rico' || ricoOn).map((t) => ({
    id: t,
    label: TAB_LABELS[t],
    count:
      t === 'media' ? mediaCount ?? undefined
      : t === 'reports' ? wf?.reports.length
      : t === 'tasks' ? openTasks ?? undefined
      : t === 'charges' ? chargesCount
      : t === 'legal' ? wf?.legal.length
      : undefined,
    marker: t === 'signoff' ? awaitingSignoff : t === 'legal' && legalNeedsAction > 0,
    markerLabel:
      t === 'signoff' ? 'Sign-off requires attention'
      : t === 'legal' ? 'Legal requests need your action'
      : undefined,
  }))

  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: 'Cases', onClick: onBack }, { label: c.case_number }]} />
      {c.archived_at && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-200">
          This case is archived — it is hidden from the working views. Command can restore it from the header menu.
        </p>
      )}
      {hold && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-rose-200">
              Legal hold — this case cannot be permanently deleted until a command member lifts it.
            </p>
            {isCommand && <Button onClick={() => void liftHold()}>Lift hold…</Button>}
          </div>
          <p className="mt-1 text-rose-100/80">
            {hold.reason} · placed by {officerName(hold.placed_by) || 'command'} on {hold.placed_at.slice(0, 10)}
          </p>
        </div>
      )}
      <CaseCommandHeader
        c={c}
        op={op ? { id: op.id, name: op.name } : null}
        assessment={assessment}
        pinned={pinned}
        canEdit={canEdit}
        canArchive={isCommand}
        canDelete={isOwner}
        canHold={isCommand}
        holdActive={!!hold}
        onPlaceHold={() => void placeHold()}
        canHandover={canHandover}
        canReassignBureau={canReassignBureau}
        onStatusChange={(s) => void quickStatus(s)}
        onPinToggle={() => { togglePinCase(c.id); setCase({ ...c }) }}
        onEdit={() => setEdit(true)}
        onArchive={() => void archiveCase()}
        onHandover={() => setHandover(true)}
        onReassign={() => setReassign(true)}
        onDelete={() => void permanentDelete()}
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
        {tab === 'overview' && (
          <OverviewTab
            c={c} canEdit={canEdit} canDelete={canDelete} wf={wf} assessment={assessment}
            onWorkflowChanged={() => void fetchWorkflow()}
            /* !!wf: only offer the enable once the rico count is known, so the
               action never flashes on a case that already has tracker data. */
            showEnableRico={canEdit && !!wf && !ricoOn}
            onEnableRico={() => { enableRicoSession(c.id); setTab('rico') }}
          />
        )}
        {tab === 'graph' && <CaseGraphTab c={c} />}
        {tab === 'media' && <MediaTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'intel' && <IntelTab c={c} canEdit={canEdit} onChanged={fetchCase} />}
        {tab === 'charges' && <ChargesTab c={c} canEdit={canEdit} onChanged={fetchCase} />}
        {tab === 'rico' && <RicoTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'reports' && <ReportsTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'tasks' && <TasksTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'legal' && <LegalTab rows={wf?.legal ?? null} />}
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
