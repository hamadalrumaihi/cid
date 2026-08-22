'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { DetailSkeleton } from '@/components/ui/Skeleton'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { SectionTabs, panelDomId, tabDomId, type SectionTab } from '@/components/ui/SectionTabs'
import { CASE_TABS, CASE_TAB_GROUPS, CASE_TAB_LABELS, type CaseTabId } from './caseTabs'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { countRows, list, rpc, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useSiu } from '@/lib/useSiu'
import { caseDepartment, siuClassificationLabel, siuClassificationTint, termsFor } from '@/lib/siu'
import { ReleasedIntelligence } from './ReleasedIntelligence'
import { SiuCaseLifecycle, SiuControlBar } from './SiuControlBar'
import { Badge } from '@/components/ui/Badge'
import { useOperationsStore } from '@/lib/operations'
import { caseJointInfo, type OpCaseLinkRow } from '@/lib/opsJoint'
import { assessCase, ricoTabVisible } from '@/lib/caseWorkflow'
import { normalizeCaseTab } from '@/lib/caseLinks'
import type { Tables } from '@/lib/database.types'
import type { LegalRequest } from '@/lib/justice'
import { canChangeResponsibleBureau, canSetResponsibleBureau, countViewerActionable, isJtfAssigned, isRoutingBureau } from '@/lib/legalWorkflow'
import { officerName, activeProfiles } from '@/lib/profiles'
import { notify } from '@/lib/notify'
import { loadCaseChargeTotals } from '@/lib/caseCharges'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { useNow } from '@/lib/useNow'
import { LEGAL_LIST_COLS, buildLegalViewer, useMyProsecutorBureaus } from '@/components/justice/legalShared'
import { confirmCaseClose, enableRicoSession, isPinnedCase, pushRecentCase, ricoSessionEnabled, togglePinCase } from './caseUtils'
import { CaseModal } from './CaseModal'
import { CaseCommandHeader } from './CaseCommandHeader'
import { ReassignBureauModal } from './ReassignBureauModal'
import { ResponsibleBureauModal } from './ResponsibleBureauModal'
import { OverviewTab } from './tabs/OverviewTab'
import { MediaTab } from './tabs/MediaTab'
import type { BlockerRow } from './tabs/CaseBlockersPanel'
import { ChargesTab } from './tabs/ChargesTab'
import { RicoTab } from './tabs/RicoTab'
import { IntelTab } from './tabs/IntelTab'
import { SurveillanceTab } from './tabs/SurveillanceTab'
import { ExtractionsTab } from './tabs/ExtractionsTab'
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

// Tab ids/labels/grouping live in caseTabs.ts so the in-app User Guide renders
// the real rail (aliased here to keep the 30+ existing references unchanged).
const TABS = CASE_TABS
type TabId = CaseTabId
const TAB_LABELS = CASE_TAB_LABELS
const TAB_GROUPS = CASE_TAB_GROUPS

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
  /** Total counts across every live charge record, from case_charge_totals().
   *  NOT from cases.charges: that jsonb is frozen history now, so a case edited
   *  through the charge record would show a stale badge forever. */
  chargeCounts: number
  /** Live (non-removed) case_assignments — HEAD count only; feeds the case
   *  jacket header's Supporting field via assessCase's supportCount. */
  assignments: number
}

export function CaseDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const sp = useSearchParams()
  const auth = useAuth()
  const { profile, canEdit: authCanEdit, canDelete: authCanDelete, isCommand, isOwner } = auth
  const siu = useSiu()
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
  const [respBureau, setRespBureau] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
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
  const vAsg = useTableVersion('case_assignments')
  const fetchWorkflow = useCallback(async () => {
    try {
      const [tasks, reports, legal, media, blockers, rico, assignments, chargeTotals] = await Promise.all([
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
        // Live assignment roster size (Supporting field in the case jacket).
        countRows('case_assignments', { eq: { case_id: id }, is: { removed_at: null } }).catch(() => 0),
        // Charge totals are computed by the database because it is the only
        // place that knows which charge rows this viewer may see.
        loadCaseChargeTotals(id).catch(() => null),
      ])
      setWf({ tasks, reports, legal: legal as LegalRequest[], media, blockers, rico, assignments,
              chargeCounts: chargeTotals?.counts ?? 0 })
    } catch { /* header/metrics render with em-dashes until a fetch lands */ }
  }, [id])
  useEffect(() => { queueMicrotask(() => { void fetchWorkflow() }) }, [fetchWorkflow, casesV, vM, vR, vT, vL, vB, vRi, vAsg])

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

  // JTF-operation participation history — feeds the JOINT badge and the
  // "Joint via Operation …" chip. Permanent rows (survive op closure and
  // manual removal); best-effort, the header renders without them.
  const [opLinks, setOpLinks] = useState<OpCaseLinkRow[]>([])
  const vOpLinks = useTableVersion('operation_case_links')
  const opsLoaded = useOperationsStore((s) => s.loaded)
  const fetchOpsStore = useOperationsStore((s) => s.fetch)
  useEffect(() => { if (!opsLoaded) void fetchOpsStore() }, [opsLoaded, fetchOpsStore])
  const fetchOpLinks = useCallback(async () => {
    try { setOpLinks(await list('operation_case_links', { eq: { case_id: id }, order: 'added_at', ascending: false })) }
    catch { setOpLinks([]) }
  }, [id])
  useEffect(() => { queueMicrotask(() => { void fetchOpLinks() }) }, [fetchOpLinks, vOpLinks])

  // Photos = non-archived case media (archived rows stay out of every count).
  const mediaCount = useMemo(() => (wf ? wf.media.filter((m) => !m.archived_at).length : null), [wf])

  const assessment = useMemo(() => (c && wf ? assessCase({
    c,
    tasks: wf.tasks, reports: wf.reports, legal: wf.legal,
    mediaCount: mediaCount ?? 0,
    supportCount: wf.assignments,
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
    () => (wf ? countViewerActionable(wf.legal, buildLegalViewer(auth, prosecutorBureaus, undefined, siu.isCommand), legalNow) : 0),
    [wf, auth, prosecutorBureaus, legalNow, siu.isCommand],
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
  const joint = caseJointInfo(c, opLinks, new Map(operations.map((o) => [o.id, o])))
  const pinned = isPinnedCase(c.id)
  // The current lead (or command) may hand the case to another officer.
  const canHandover = !!profile && (c.lead_detective_id === profile.id || isCommand)
  // Bureau reassignment is Deputy Director+/Owner (never bureau_lead) — the
  // cosmetic mirror of case_reassign_bureau's server rule; RLS + the freeze
  // trigger enforce the real one.
  const canReassignBureau = isOwner || (isCommand && (profile?.role === 'deputy_director' || profile?.role === 'director'))
  // Responsible-bureau action (JTF-assigned cases only — legal routing rides
  // originating_bureau): SETTING a missing value is Senior Detective+;
  // CHANGING an already-set one is Deputy Director+/Owner with a reason.
  // Cosmetic mirror of resolve_case_originating_bureau — the RPC re-validates.
  const responsibleBureauAction: 'set' | 'change' | null = !isJtfAssigned(c)
    ? null
    : isRoutingBureau(c.originating_bureau)
      ? (canChangeResponsibleBureau(profile?.role, isOwner) ? 'change' : null)
      : (canSetResponsibleBureau(profile?.role, isOwner) ? 'set' : null)
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

  // Header/metric derivations — cheap, render-pure.
  const chargesCount = wf?.chargeCounts
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
    // Em-dash until the totals land, matching Photos: a 0 would read as
    // "this case has no charges", which is a different claim from "not yet known".
    { label: 'Charges', value: chargesCount ?? '—', onClick: () => setTab('charges') },
  ]

  // The department that OWNS this record decides its vocabulary — an SIU
  // investigation says "Lead Agent", a CID case says "Lead Detective" — while
  // the viewer's own context (siu.inSiu) decides whether the external-access
  // banner is shown. The two are deliberately separate (§12, §20).
  // Narrow the write gates to what the server will actually accept. RLS
  // refuses a cross-department write by matching ZERO ROWS rather than
  // erroring, so leaving Edit visible would let it appear to save and change
  // nothing. See siuCaseReadOnly().
  const readOnly = siu.caseReadOnly(c)
  const canEdit = authCanEdit && !readOnly
  const canDelete = authCanDelete && !readOnly

  const caseDept = caseDepartment(c)
  const caseTerms = termsFor(caseDept)

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
      <Breadcrumbs items={[{ label: caseTerms.caseWordPlural, onClick: onBack }, { label: c.case_number }]} />
      {/* Department banner. The record's OWNING department names it — an SIU
          investigation is never labelled "CID CASE" and vice versa (§13/§20) —
          and an SIU agent reading a CID case is told plainly that they are
          looking at an external investigation under SIU read authority, not
          as a case member (§12). */}
      {caseDept === 'siu' ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-violet-500/25 bg-violet-500/5 px-4 py-2.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300">
            Special Investigation Unit
          </span>
          <span className="text-violet-500/40" aria-hidden>·</span>
          <span className="text-xs font-semibold text-violet-100">SIU Investigation</span>
          {c.siu_classification && (
            <Badge tint={siuClassificationTint(c.siu_classification)}>
              {siuClassificationLabel(c.siu_classification)}
            </Badge>
          )}
          {/* Oversight authority (Director of CID, Attorney General) reads the
              unit's standard investigations but works none of them — say so,
              rather than letting an edit control imply otherwise. */}
          {siu.standing === 'oversight' && (
            <span className="text-xs text-slate-300">
              Viewing under oversight authority — read-only. You are not assigned to this investigation.
            </span>
          )}
        </div>
      ) : siu.inSiu ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-300">
            CID Investigation
          </span>
          <span className="text-white/20" aria-hidden>·</span>
          <span className="text-xs text-slate-300">
            Viewing under SIU authority — read-only oversight. You are not a member of this case.
          </span>
        </div>
      ) : null}
      {/* §14/§15 controls. SiuControlBar renders nothing without SIU command,
          and ReleasedIntelligence renders nothing when nothing was released —
          a CID case untouched by SIU looks exactly as it always did. */}
      <SiuControlBar caseRow={c} onChanged={() => { void fetchCase(); onChanged() }} />
      <SiuCaseLifecycle caseRow={c} onChanged={() => { void fetchCase(); onChanged() }} />
      {caseDept === 'cid' && <ReleasedIntelligence caseId={c.id} />}
      {c.archived_at && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm font-semibold text-amber-200">
          This case is archived — it is hidden from the working views. Command can restore it from the header menu.
        </p>
      )}
      {hold && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-rose-200">
              Legal hold — this case is preserved. It can&apos;t be archived, permanently deleted, or have its media, reports, tasks, or linked-entity merges removed until a command member lifts the hold.
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
        joint={joint}
        assessment={assessment}
        openBlockers={openBlockers}
        pinned={pinned}
        canEdit={canEdit}
        canArchive={isCommand}
        canDelete={isOwner}
        canHold={isCommand}
        holdActive={!!hold}
        onPlaceHold={() => void placeHold()}
        canHandover={canHandover}
        canReassignBureau={canReassignBureau}
        responsibleBureauAction={responsibleBureauAction}
        onResponsibleBureau={() => setRespBureau(true)}
        onStatusChange={(s) => void quickStatus(s)}
        onPinToggle={() => { togglePinCase(c.id); setCase({ ...c }) }}
        onEdit={() => setEdit(true)}
        onArchive={() => void archiveCase()}
        onHandover={() => setHandover(true)}
        onReassign={() => setReassign(true)}
        onDelete={() => setDeleteOpen(true)}
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
        {tab === 'media' && <MediaTab c={c} canEdit={canEdit} canDelete={canDelete} holdActive={!!hold} />}
        {tab === 'intel' && <IntelTab c={c} canEdit={canEdit} onChanged={fetchCase} />}
        {tab === 'surveillance' && <SurveillanceTab c={c} />}
        {tab === 'extractions' && <ExtractionsTab c={c} canEdit={canEdit} />}
        {tab === 'charges' && <ChargesTab c={c} canEdit={canEdit} onChanged={fetchCase} />}
        {tab === 'rico' && <RicoTab c={c} canEdit={canEdit} canDelete={canDelete} />}
        {tab === 'reports' && <ReportsTab c={c} canEdit={canEdit} canDelete={canDelete} holdActive={!!hold} />}
        {tab === 'tasks' && <TasksTab c={c} canEdit={canEdit} canDelete={canDelete} holdActive={!!hold} />}
        {tab === 'legal' && <LegalTab rows={wf?.legal ?? null} />}
        {tab === 'signoff' && <SignoffTab c={c} />}
        {tab === 'chat' && <ChatTab c={c} />}
        {tab === 'timeline' && <TimelineTab c={c} />}
      </section>
      <CaseModal open={edit} record={c} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); onChanged(); void fetchCase() }} />
      <HandoverModal open={handover} c={c} onClose={() => setHandover(false)} onDone={() => { setHandover(false); onChanged(); void fetchCase() }} />
      <ReassignBureauModal open={reassign} c={c} onClose={() => setReassign(false)} onDone={() => { setReassign(false); onChanged(); void fetchCase() }} />
      <ResponsibleBureauModal open={respBureau} c={c} onClose={() => setRespBureau(false)} onDone={(updated) => { setRespBureau(false); setCase(updated); onChanged(); void fetchCase() }} />
      <DeleteCaseModal open={deleteOpen} c={c} onClose={() => setDeleteOpen(false)} onDeleted={() => { setDeleteOpen(false); onBack(); onChanged() }} />
    </div>
  )
}

/* ── Permanent case deletion (owner-only) ───────────────────────────────────
 * A dedicated destructive-action modal replaces the old prompt chain: it loads
 * the server's destruction manifest (case_delete_preview), demands the EXACT
 * case number typed back plus a reason, and only then calls the unchanged
 * case_permanent_delete RPC. Archiving stays the signposted normal path. */
interface DeletePreview {
  items: { table: string; rows: number; on_delete: string }[]
  legal_requests: number
  active_hold?: boolean
  deletable: boolean
}

function DeleteCaseModal({ open, c, onClose, onDeleted }: { open: boolean; c: CaseRow; onClose: () => void; onDeleted: () => void }) {
  const [preview, setPreview] = useState<DeletePreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [confirmNumber, setConfirmNumber] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      setPreview(null); setPreviewError(null); setConfirmNumber(''); setReason(''); setBusy(false)
      void rpc('case_delete_preview', { p_case: c.id }).then((pv) => {
        if (pv.error) setPreviewError(pv.error.message)
        else setPreview(pv.data as unknown as DeletePreview)
      })
    })
  }, [open, c.id])

  const blocked = preview
    ? preview.active_hold
      ? 'This case is under an active legal hold and cannot be deleted — lift the hold first.'
      : !preview.deletable
        ? `This case has ${preview.legal_requests} legal request${preview.legal_requests === 1 ? '' : 's'} on file and cannot be deleted.`
        : null
    : null
  const numberMatches = confirmNumber.trim() === c.case_number
  const canDelete = !!preview && !blocked && numberMatches && !!reason.trim() && !busy

  const run = async () => {
    if (!canDelete) return
    setBusy(true)
    const res = await rpc('case_permanent_delete', { p_case: c.id, p_reason: reason.trim() })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(`${c.case_number} permanently deleted.`, 'warn')
    onDeleted()
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => !!confirmNumber.trim() || !!reason.trim()}>
      <div className="p-5">
        <ModalHeader title="Permanently delete case" onClose={onClose} />
        <div className="space-y-3">
          <p className="rounded-lg border border-rose-400/30 bg-rose-500/[0.07] p-3 text-sm text-rose-100">
            This destroys <span className="font-mono font-bold">{c.case_number}</span> and every linked record listed
            below. It cannot be undone. <strong>Archiving hides a case without destroying history</strong> — it is the
            normal path; deletion is for records that must not exist.
          </p>

          {previewError ? (
            <p className="rounded-lg border border-rose-400/30 bg-rose-500/[0.07] p-3 text-sm text-rose-100">{previewError}</p>
          ) : !preview ? (
            <p className="text-sm text-slate-400">Loading the destruction manifest…</p>
          ) : blocked ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">{blocked}</p>
          ) : (
            <div className="rounded-lg border border-white/10 bg-ink-950/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Will be destroyed</p>
              {preview.items.length ? (
                <ul className="mt-1.5 space-y-1 text-sm text-slate-200">
                  {preview.items.map((i) => (
                    <li key={i.table} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate font-mono text-xs">{i.table.replace('public.', '')}</span>
                      <span className="flex-shrink-0 tabular-nums text-slate-300">
                        {i.rows} row{i.rows === 1 ? '' : 's'} <span className="text-xs text-slate-400">{i.on_delete}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-sm text-slate-400">No linked records — only the case row itself.</p>
              )}
            </div>
          )}

          {preview && !blocked && (
            <>
              <Field label={`Type the case number to confirm (${c.case_number})`} required>
                {(id) => (
                  <Input
                    id={id}
                    value={confirmNumber}
                    onChange={(e) => setConfirmNumber(e.target.value)}
                    placeholder={c.case_number}
                    autoComplete="off"
                    className="font-mono"
                  />
                )}
              </Field>
              <Field label="Reason" required hint="Recorded in the audit log with the deletion.">
                {(id) => (
                  <Textarea
                    id={id}
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why this record must be destroyed rather than archived"
                  />
                )}
              </Field>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="danger" onClick={() => void run()} disabled={!canDelete}>
              {busy ? 'Deleting…' : 'Delete forever'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
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
