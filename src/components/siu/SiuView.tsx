'use client'

/** Special Investigations Bureau — the privileged investigative workspace.
 *
 *  SIB deliberately reuses the CID portal's mature systems: an SIB
 *  investigation IS a `cases` row (authority `siu`), so opening one lands in
 *  the ordinary case workspace with its reports, evidence, media, tasks,
 *  timeline, chat, graph and legal tabs already working. This screen is the
 *  privileged FILTER and the SIB-only administration around them — not a
 *  second case-management app.
 *
 *  Access: every gate here comes from `useSiu()` (the client mirror of
 *  `private.siu_standing()`). Rendering nothing is the correct behavior for an
 *  unauthorized account — the route resolves to the app's ordinary
 *  unknown-tab notice, never a "restricted" banner that would confirm SIB
 *  exists. RLS and the SIB RPCs are the real enforcement.
 *
 *  Visual language: the portal's own dark investigative surfaces. Violet is
 *  reserved for identity and state markers — standing/classification/
 *  visibility chips — never washed over panels, borders or ordinary actions.
 *  No stamps, no glow, no hacker aesthetic — the difference between CID and
 *  SIB is authority and information access, not decoration. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import { list, rpc, withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import { useTableVersion } from '@/lib/realtime'
import {
  SIU_CLASSIFICATIONS, fetchSiuAudit, fetchSiuOverview, fetchSiuRoster,
  searchSiuCandidates, siuAuditLabel, siuCallsign, siuCanAppointRole, siuCanRemove,
  siuClassificationLabel, siuClassificationTint, siuRoleLabel,
  SIU_CLASSIFICATION_HINT, SIU_ROLE_SHORT, SIU_INTEGRITY_NOTE_TYPES,
  SIU_PRIORITY_DESIGNATIONS, siuDesignationLabel, siuNoteTypeLabel,
  SIU_OPENABLE_DESIGNATIONS, SIU_TARGET_PRIORITIES, SIU_TARGET_PRIORITY_LABEL,
  SIU_NOTE_TYPES, fetchSiuTargets, fetchSiuIntelligence, siuTargetPriorityTint,
  type SiuTargetEntry, type SiuIntelEntry,
  siuOperationCategoryLabel, type SiuOperationCategory,
  type SiuAuditRow, type SiuCandidate, type SiuOverview, type SiuRosterRow,
  type SiuDesignation, type SiuNoteType,
  SIU_CREDIBILITY, SIU_RELIABILITY, SIU_SOURCE_TYPES,
  siuCredibilityLabel, siuCredibilityTint,
  siuReliabilityLabel, siuReviewOutcomeLabel, siuSourceTypeLabel,
  fetchSiuAccessRequests, fetchSiuCommandDashboard, fetchSiuDisclosures,
  fetchSiuIntelQuality, fetchSiuReferrals, siuAudienceLabel,
  siuReferralCategoryLabel,
  type SiuAccessRequest, type SiuCommandDashboard, type SiuDisclosure,
  type SiuIntelQuality, type SiuReferral,
} from '@/lib/siu'
import { SiuCompartmentsSection } from './SiuCompartments'
import { SiuDisclosuresSection } from './SiuDisclosures'
import { SiuIntakeSection } from './SiuIntake'
import { SiuWatchlistSection } from './SiuWatchlist'
import {
  SiuRegistryPicker, choiceIsComplete, emptyChoice, type SiuRegistryChoice,
} from './SiuRegistryPicker'
import { SiuPersonDossierModal } from './SiuPersonDossier'
import { SiuCommandSection } from './SiuCommand'
import { SiuOversightSection, SiuTradecraftSection } from './SiuTradecraft'
import { DashPanel } from '@/components/dash/DashPanel'
import { DashRow } from '@/components/dash/DashRow'
import { DashSwitcher } from '@/components/dash/DashSwitcher'
import {roleLabel, bureauShort} from '@/lib/roles'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { MetricStrip } from '@/components/ui/MetricStrip'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { SectionTabs } from '@/components/ui/SectionTabs'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { Field, Input, Select, Textarea, inputCls } from '@/components/ui/Field'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'

type CaseRow = Tables<'cases'>
type Section = 'overview' | 'intake' | 'investigations' | 'targets' | 'operations' | 'intelligence'
  | 'watchlist' | 'tradecraft' | 'compartments' | 'disclosure' | 'command' | 'oversight'
  | 'agents' | 'activity'
type OperationRow = Tables<'operations'>

const SECTIONS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'intake' as const, label: 'Intake' },
  { id: 'investigations' as const, label: 'Investigations' },
  { id: 'targets' as const, label: 'Targets' },
  { id: 'operations' as const, label: 'Operations' },
  { id: 'intelligence' as const, label: 'Intelligence' },
  { id: 'watchlist' as const, label: 'Watchlist' },
  { id: 'tradecraft' as const, label: 'Tradecraft' },
  { id: 'compartments' as const, label: 'Compartments' },
  { id: 'disclosure' as const, label: 'Released to CID' },
  { id: 'command' as const, label: 'Command' },
  { id: 'oversight' as const, label: 'Oversight' },
  { id: 'agents' as const, label: 'Agents' },
  { id: 'activity' as const, label: 'Activity' },
]

/** Designation chips: priority designations read hot, cleared reads resolved,
 *  everything else stays neutral. Investigative standing, never a finding. */
const designationTint = (d: string): string =>
  SIU_PRIORITY_DESIGNATIONS.includes(d) ? 'bg-rose-500/15 text-rose-300'
  : d === 'cleared' ? 'bg-emerald-500/15 text-emerald-300'
  : d === 'source' ? 'bg-blue-500/15 text-blue-300'
  : 'bg-white/5 text-slate-300'

const noteTint = (t: string): string =>
  SIU_INTEGRITY_NOTE_TYPES.includes(t) ? 'bg-amber-500/15 text-amber-300'
  : 'bg-white/5 text-slate-300'

const fmtDate = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtWhen = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export function SiuView() {
  const { state } = useAuth()
  const siu = useSiu()
  const sp = useSearchParams()
  const [section, setSection] = useState<Section>('overview')

  // ?s= deep-links land on their section (the CommandCenterView precedent) —
  // the Action Center's SIB items point here. In-view tab clicks keep the
  // existing local state; an invalid or absent param changes nothing. The
  // deferred hop keeps the setState out of the synchronous effect body (the
  // ShiftsView pattern used throughout this file).
  useEffect(() => {
    const s = sp.get('s')
    if (!s || !SECTIONS.some((t) => t.id === s)) return
    const t = window.setTimeout(() => setSection(s as Section), 0)
    return () => window.clearTimeout(t)
  }, [sp])

  if (state !== 'in') return <Notice text="Sign in to continue." />
  if (siu.loading) return <CardGridSkeleton cols="" />
  // Unauthorized: the app's ordinary "nothing here" surface. No mention of
  // SIB, no hint that a restricted area exists.
  if (!siu.canAccess) {
    return (
      <EmptyState
        icon="🔍"
        title="Nothing to show here"
        hint="This section isn't available for your account."
      />
    )
  }

  return (
    <div>
      {/* Same chip row as My Dashboard — a multi-role account hops between
          its dashboards from the SIB landing without touching the sidebar. */}
      <div className="mb-4">
        <DashSwitcher />
      </div>
      <Card pad="lg" className="mb-5">
        <PageHeader
          eyebrow="Special Investigations Bureau"
          title="SIB Workspace"
          subtitle="Investigations, personnel and oversight of CID activity — separate authority, need-to-know by default."
          actions={
            <div className="flex items-center gap-2">
              <Badge tint="bg-violet-500/15 text-violet-300">
                {siu.standing === 'owner' ? 'Portal Owner'
                  : siu.standing === 'oversight' ? 'SIB Oversight'
                  : siuRoleLabel(siu.standing)}
              </Badge>
              {siu.membership?.callsign && (
                <Badge tone="neutral" title="Callsign">{siuCallsign(siu.membership.callsign)}</Badge>
              )}
            </div>
          }
        />
        {!siu.releaseOpen && (
          <p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-300/90">
            <strong className="font-semibold">Pre-release.</strong> SIB is gated to the Portal Owner
            until it is marked production-ready. Appointments, investigations and permissions all work
            exactly as they will after launch — no other account can see or reach any of it.
          </p>
        )}
      </Card>

      <SectionTabs
        tabs={SECTIONS}
        active={section}
        onChange={setSection}
        idBase="siu"
        ariaLabel="SIB sections"
        className="mb-4"
      />

      {section === 'overview' && <OverviewSection onGoto={setSection} />}
      {section === 'intake' && <SiuIntakeSection />}
      {section === 'investigations' && <InvestigationsSection />}
      {section === 'targets' && <TargetsSection />}
      {section === 'operations' && <OperationsSection />}
      {section === 'intelligence' && <IntelligenceSection />}
      {section === 'watchlist' && <SiuWatchlistSection />}
      {section === 'tradecraft' && <SiuTradecraftSection />}
      {section === 'compartments' && <SiuCompartmentsSection />}
      {section === 'disclosure' && <SiuDisclosuresSection />}
      {section === 'command' && <SiuCommandSection />}
      {section === 'oversight' && <SiuOversightSection />}
      {section === 'agents' && <AgentsSection />}
      {section === 'activity' && <ActivitySection />}
    </div>
  )
}

/* ---------------------------------------------------------------- overview */

/** Referrals still needing an intake decision — SiuIntake's OPEN_STATUSES. */
const REFERRAL_OPEN = ['submitted', 'under_review', 'info_requested']

type TaskLite = Pick<Tables<'case_tasks'>, 'id' | 'case_id' | 'title' | 'due'>

/** The field agent's own work — loaded only for field standing (oversight has
 *  no read on intake and no tasks of its own; loading nothing is the honest
 *  state, never a locked panel). Everything is bounded and RLS-scoped. */
interface AgentWork {
  /** Open SIB investigations the agent is cleared for, newest movement first. */
  openCases: CaseRow[]
  /** The agent's open tasks (intersected client-side with `openCases`). */
  tasks: TaskLite[]
  referrals: SiuReferral[]
  disclosures: SiuDisclosure[]
}

/** X-1's queues — reuses the existing §35/§36 payloads (siu_command_dashboard,
 *  siu_intel_quality) and the access-request list; no new queries. */
interface CommandWork {
  access: SiuAccessRequest[]
  dash: SiuCommandDashboard
  intel: SiuIntelQuality
}

function OverviewSection({ onGoto }: { onGoto: (s: Section) => void }) {
  const { profile } = useAuth()
  const router = useRouter()
  const siu = useSiu()
  const [data, setData] = useState<SiuOverview | null>(null)
  const [recent, setRecent] = useState<CaseRow[]>([])
  const [agent, setAgent] = useState<AgentWork | null>(null)
  const [command, setCommand] = useState<CommandWork | null>(null)
  const [loading, setLoading] = useState(true)

  const me = profile?.id ?? null

  useEffect(() => {
    // Wait for the resolved SIB context: the standing gates below decide
    // which queues load at all, and a false-while-loading flag would skip
    // the agent/command fetches on first mount.
    if (siu.loading) return
    let live = true
    void (async () => {
      try {
        const [o, r, aw, cw] = await Promise.all([
          withRetry(fetchSiuOverview),
          withRetry(() => list('cases', {
            order: 'updated_at', ascending: false, limit: 6,
            eq: { case_authority: 'siu' },
            select: 'id,case_number,title,status,siu_classification,updated_at,lead_detective_id',
          })),
          siu.isAgent && me
            ? Promise.all([
                withRetry(() => list('cases', {
                  order: 'updated_at', ascending: false, limit: 100,
                  eq: { case_authority: 'siu' }, is: { closed_at: null },
                  select: 'id,case_number,title,status,siu_classification,updated_at,lead_detective_id',
                })),
                withRetry(() => list('case_tasks', {
                  select: 'id,case_id,title,due', eq: { assignee: me, done: false }, limit: 100,
                })),
                withRetry(() => fetchSiuReferrals()).catch((): SiuReferral[] => []),
                withRetry(() => fetchSiuDisclosures()).catch((): SiuDisclosure[] => []),
              ]).then(([openCases, tasks, referrals, disclosures]): AgentWork => ({
                openCases: openCases as CaseRow[],
                tasks: tasks as unknown as TaskLite[],
                referrals, disclosures,
              }))
            : Promise.resolve(null),
          siu.isCommand
            ? Promise.all([
                // Command-only by RLS; fail-open to empty/no-access so a miss
                // can never sink the landing.
                withRetry(() => fetchSiuAccessRequests()).catch((): SiuAccessRequest[] => []),
                withRetry(() => fetchSiuCommandDashboard()).catch((): SiuCommandDashboard => ({ access: false })),
                withRetry(() => fetchSiuIntelQuality()).catch((): SiuIntelQuality => ({ access: false })),
              ]).then(([access, dash, intel]): CommandWork => ({ access, dash, intel }))
            : Promise.resolve(null),
        ])
        if (live) { setData(o); setRecent(r as CaseRow[]); setAgent(aw); setCommand(cw) }
      } catch (e) {
        if (live) toast(e instanceof Error ? e.message : String(e), 'danger')
      } finally { if (live) setLoading(false) }
    })()
    return () => { live = false }
  }, [siu.loading, siu.isAgent, siu.isCommand, me])

  const openCaseById = useMemo(
    () => new Map((agent?.openCases ?? []).map((c) => [c.id, c])),
    [agent],
  )
  const myCases = useMemo(
    () => (agent?.openCases ?? []).filter((c) => c.lead_detective_id === me),
    [agent, me],
  )
  const myTasks = useMemo(
    () => (agent?.tasks ?? []).filter((t) => openCaseById.has(t.case_id)),
    [agent, openCaseById],
  )
  const openReferrals = useMemo(
    () => (agent?.referrals ?? []).filter((r) => REFERRAL_OPEN.includes(r.status)),
    [agent],
  )
  const unacked = useMemo(
    () => (agent?.disclosures ?? []).filter((d) => !d.acknowledged_at && !d.revoked_at),
    [agent],
  )
  const pendingAccess = useMemo(
    () => (command?.access ?? []).filter((r) => r.status === 'pending'),
    [command],
  )

  if (loading) return <CardGridSkeleton cols="" />
  if (!data?.access) return <Notice text="Nothing to show here." />

  const q = command?.dash.queues
  const intel = command?.intel

  return (
    <div className="space-y-4">
      <MetricStrip
        metrics={[
          { label: 'Investigations', value: data.investigations ?? 0, hint: 'You can access', onClick: () => onGoto('investigations') },
          { label: 'Open', value: data.open_investigations ?? 0, onClick: () => onGoto('investigations') },
          { label: 'Assigned to you', value: data.assigned ?? 0, onClick: () => onGoto('investigations') },
          { label: 'Compartmented', value: data.compartmented ?? 0, tint: 'bg-rose-500/15 text-rose-300', onClick: () => onGoto('compartments') },
          // SIB legal requests route via the Attorney General — the SIB-side
          // list is the workspace's own Legal Requests tab, never the CID
          // prosecutor path.
          { label: 'Legal pending', value: data.legal_pending ?? 0, hint: 'Warrants & subpoenas', onClick: () => router.push('/legal') },
          { label: 'Agents', value: data.agents ?? 0, onClick: () => onGoto('agents') },
        ]}
      />

      {/* Operational picture — the §14 sections, each counting only what this
          agent may actually see. Surveillance lives on each case's own tab,
          so that tile stays a plain count. */}
      <MetricStrip
        metrics={[
          { label: 'Priority targets', value: data.priority_targets ?? 0,
            hint: 'Target · Priority · Fugitive',
            tint: (data.priority_targets ?? 0) > 0 ? 'bg-rose-500/15 text-rose-300' : undefined,
            onClick: () => onGoto('targets') },
          { label: 'Active targets', value: data.active_targets ?? 0, onClick: () => onGoto('targets') },
          { label: 'Active operations', value: data.active_operations ?? 0, onClick: () => onGoto('operations') },
          { label: 'Surveillance', value: data.surveillance_active ?? 0, hint: 'Running' },
          { label: 'Intelligence', value: data.open_intel ?? 0, hint: 'Unresolved', onClick: () => onGoto('intelligence') },
          { label: 'Integrity flags', value: data.cid_integrity_flags ?? 0,
            hint: 'Raised on CID cases',
            tint: (data.cid_integrity_flags ?? 0) > 0 ? 'bg-amber-500/15 text-amber-300' : undefined,
            onClick: () => onGoto('intelligence') },
        ]}
      />

      {/* ── Command landing — X-1's decision queues (reused payloads) ─────── */}
      {command && (
        <>
          <DashPanel
            title="Access requests to decide"
            count={pendingAccess.length}
            hint="The Director of CID asking to read one investigation — X-1 decides. Approval opens that one case file for a fixed period."
            action={{ label: 'Intake →', onClick: () => onGoto('intake') }}
            empty={pendingAccess.length === 0}
          >
            {pendingAccess.map((r) => (
              <DashRow
                key={r.id}
                title={r.case_number_requested}
                why={r.reason || 'Pending access decision'}
                meta={fmtWhen(r.requested_at)}
                onClick={() => onGoto('intake')}
              />
            ))}
          </DashPanel>

          {command.dash.access && (
            <Card>
              <SectionHeader
                title="Command queues"
                subtitle="What is waiting on somebody — counts reflect only what you can see. Each number opens its owning section."
              />
              <div className="mt-3">
                <MetricStrip
                  metrics={[
                    { label: 'Referrals awaiting review', value: q?.referrals_awaiting ?? 0, onClick: () => onGoto('intake') },
                    { label: 'Open inquiries', value: q?.inquiries_open ?? 0, onClick: () => onGoto('investigations') },
                    { label: 'Standing conflicts', value: q?.conflicts_standing ?? 0, onClick: () => onGoto('intake') },
                    { label: 'Watches expiring (14d)', value: q?.watch_expiring_14d ?? 0, onClick: () => onGoto('watchlist') },
                    { label: 'Aging investigations', value: command.dash.aging?.length ?? 0, hint: 'Open 60+ days', onClick: () => onGoto('command') },
                    { label: 'Release gate', value: siu.releaseOpen ? 'Open' : 'Pre-release',
                      hint: siu.releaseOpen ? 'SIB is live for appointed agents' : 'Owner-only until launch',
                      onClick: () => onGoto('command') },
                  ]}
                />
              </div>
              {intel?.access && (
                <div className="mt-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Intelligence quality
                  </p>
                  <MetricStrip
                    metrics={[
                      { label: 'Ungraded', value: intel.ungraded ?? 0,
                        tint: (intel.ungraded ?? 0) > 0 ? 'bg-amber-500/15 text-amber-300' : undefined,
                        onClick: () => onGoto('intelligence') },
                      { label: 'Reviews overdue', value: intel.review_overdue ?? 0,
                        tint: (intel.review_overdue ?? 0) > 0 ? 'bg-rose-500/15 text-rose-300' : undefined,
                        onClick: () => onGoto('intelligence') },
                      { label: 'Review due (30d)', value: intel.review_due_30d ?? 0, onClick: () => onGoto('intelligence') },
                      { label: 'Untested sources', value: intel.untested_source ?? 0, onClick: () => onGoto('intelligence') },
                    ]}
                  />
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {/* ── Agent landing — the viewer's own SIB work, with why-lines ─────── */}
      {agent && (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <DashPanel
            title="Your investigations"
            count={myCases.length}
            action={{ label: 'All investigations →', onClick: () => onGoto('investigations') }}
            empty={myCases.length === 0}
          >
            {myCases.slice(0, 8).map((c) => (
              <DashRow
                key={c.id}
                title={`${c.case_number} · ${c.title || 'Untitled investigation'}`}
                badge={
                  <Badge tint={siuClassificationTint(c.siu_classification)}>
                    {siuClassificationLabel(c.siu_classification)}
                  </Badge>
                }
                why="You are the lead agent"
                meta={fmtDate(c.updated_at)}
                onClick={() => router.push(`/cases?case=${c.id}`)}
              />
            ))}
          </DashPanel>

          <DashPanel
            title="Your tasks"
            count={myTasks.length}
            hint="Open tasks assigned to you on SIB investigations."
            empty={myTasks.length === 0}
          >
            {myTasks.slice(0, 8).map((t) => {
              const c = openCaseById.get(t.case_id)
              return (
                <DashRow
                  key={t.id}
                  title={t.title}
                  why={t.due ? `Assigned to you — due ${fmtDate(t.due)}` : 'Assigned to you'}
                  meta={c?.case_number ?? undefined}
                  overdue={!!t.due && new Date(t.due) < new Date()}
                  onClick={() => router.push(caseLink(t.case_id, 'tasks', { task: t.id }))}
                />
              )
            })}
          </DashPanel>

          <DashPanel
            title="Intake awaiting review"
            count={openReferrals.length}
            action={{ label: 'Intake →', onClick: () => onGoto('intake') }}
            empty={openReferrals.length === 0}
          >
            {openReferrals.slice(0, 8).map((r) => (
              <DashRow
                key={r.id}
                title={r.summary}
                why={`${siuReferralCategoryLabel(r.category)} — ${r.status === 'info_requested'
                  ? 'more information was requested'
                  : 'awaiting an intake decision'}`}
                meta={fmtWhen(r.submitted_at)}
                onClick={() => onGoto('intake')}
              />
            ))}
          </DashPanel>

          <DashPanel
            title="Releases awaiting acknowledgement"
            count={unacked.length}
            hint="What SIB told CID that CID has not yet acknowledged."
            action={{ label: 'Released to CID →', onClick: () => onGoto('disclosure') }}
            empty={unacked.length === 0}
          >
            {unacked.slice(0, 8).map((d) => (
              <DashRow
                key={d.id}
                title={d.title}
                why={`${siuAudienceLabel(d.audience)} — not yet acknowledged by CID`}
                meta={fmtWhen(d.released_at)}
                onClick={() => onGoto('disclosure')}
              />
            ))}
          </DashPanel>
        </div>
      )}

      <Card>
        <SectionHeader
          title="Active investigations"
          subtitle="The most recently worked SIB cases you are cleared for."
          actions={<Button size="sm" onClick={() => onGoto('investigations')}>View all</Button>}
        />
        {!recent.length ? (
          <p className="mt-3 text-xs text-slate-400">No SIB investigations yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recent.map((c) => <InvestigationRow key={c.id} row={c} />)}
          </ul>
        )}
      </Card>

      {/* CID oversight signal — deliberately a filtered pointer into the CID
          screens SIB already reads, not a second analytics dashboard. */}
      {siu.canReadCid && (
        <Card>
          <SectionHeader
            title="CID activity"
            subtitle="SIB holds broad read access across every bureau. Read-only: SIB never edits CID records."
          />
          <div className="mt-3">
            <MetricStrip
              metrics={[
                { label: 'Open CID cases', value: data.cid_open_cases ?? '—', onClick: () => router.push('/cases') },
                { label: 'Opened this week', value: data.cid_recent_cases ?? '—', onClick: () => router.push('/cases') },
              ]}
            />
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Work CID material in its own screens — Case Files, Persons, Gangs, the relationship
            graph and global search all already return every bureau&rsquo;s records for you.
            Integrity concerns you record against a CID investigation stay on the SIB layer:
            the case&rsquo;s own detectives and CID command never see that the note exists.
          </p>
        </Card>
      )}
    </div>
  )
}

function InvestigationRow({ row }: { row: CaseRow }) {
  const router = useRouter()
  return (
    <li>
      <button
        type="button"
        onClick={() => router.push(`/cases?case=${row.id}`)}
        className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-left transition hover:bg-white/10"
      >
        <span className="font-mono text-xs font-semibold text-blue-300">{row.case_number}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-white">{row.title || 'Untitled investigation'}</span>
        <Badge tint={siuClassificationTint(row.siu_classification)}>
          {siuClassificationLabel(row.siu_classification)}
        </Badge>
        <Badge tone={row.status === 'closed' ? 'neutral' : 'accent'}>{row.status}</Badge>
        <span className="text-[11px] text-slate-400">{fmtDate(row.updated_at)}</span>
      </button>
    </li>
  )
}

/* --------------------------------------------------------- investigations */

function InvestigationsSection() {
  const siu = useSiu()
  const [rows, setRows] = useState<CaseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const version = useTableVersion('cases')

  const refresh = useCallback(async () => {
    // Yield before the first setState so calling this straight from an effect
    // never triggers a synchronous cascading render (the ShiftsView pattern).
    await Promise.resolve()
    setLoading(true)
    try {
      setRows(await withRetry(() => list('cases', {
        order: 'updated_at', ascending: false, eq: { case_authority: 'siu' },
      })) as CaseRow[])
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'danger')
    } finally { setLoading(false) }
  }, [])

  // The deferred call is the repo's standard effect→refresh hop (ShiftsView):
  // it keeps the first setState out of the synchronous effect body. `cases` is
  // in the realtime publication and its per-subscriber RLS now runs the SIB
  // wall, so this only ever wakes for rows this account may actually see.
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return rows.filter((r) =>
      (!classFilter || (r.siu_classification ?? 'siu') === classFilter)
      && (!q || `${r.case_number} ${r.title ?? ''} ${r.summary ?? ''}`.toLowerCase().includes(q)))
  }, [rows, filter, classFilter])

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          title="SIB investigations"
          subtitle="Every SIB case you are cleared for. Opening one uses the full case workspace."
          actions={siu.isAgent ? (
            <Button variant="primary" onClick={() => setCreating(true)}>+ New investigation</Button>
          ) : undefined}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            className={`${inputCls} max-w-xs`}
            placeholder="Filter by number, title or summary…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter investigations"
          />
          <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label="Filter by classification" className="max-w-[13rem]">
            <option value="">All classifications</option>
            {SIU_CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>{siuClassificationLabel(c)}</option>
            ))}
          </Select>
        </div>
      </Card>

      {loading ? (
        <CardGridSkeleton cols="" />
      ) : !shown.length ? (
        <EmptyState
          icon="🗂️"
          title={rows.length ? 'No investigation matches that filter' : 'No SIB investigations yet'}
          hint={rows.length
            ? 'Clear the filter to see everything you are cleared for.'
            : 'Open one to start building the record. Compartmented cases start with you as the only person on the allow-list.'}
          action={siu.isAgent && !rows.length ? { label: '+ New investigation', onClick: () => setCreating(true) } : undefined}
        />
      ) : (
        <Card>
          <ul className="space-y-2">
            {shown.map((r) => <InvestigationRow key={r.id} row={r} />)}
          </ul>
        </Card>
      )}

      {creating && (
        <NewInvestigationModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); void refresh() }}
        />
      )}
    </div>
  )
}

export function NewInvestigationModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [classification, setClassification] = useState<string>('siu')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!title.trim()) { toast('Give the investigation a title.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_create_case', {
      p_title: title.trim(),
      p_summary: summary.trim() || undefined,
      p_classification: classification,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Investigation opened.', 'success')
    onCreated()
    if (typeof res.data === 'string') router.push(`/cases?case=${res.data}`)
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!title || !!summary}>
      <ModalHeader title="New SIB investigation" onClose={onClose} />
      <div className="space-y-3">
        <Field label="Title" required>
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Integrity review — Vespucci narcotics unit" />}
        </Field>
        <Field label="Summary">
          {(id) => <Textarea id={id} rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What is being investigated and why." />}
        </Field>
        <Field label="Classification" hint={SIU_CLASSIFICATION_HINT[classification]}>
          {(id) => (
            <Select id={id} value={classification} onChange={(e) => setClassification(e.target.value)}>
              {SIU_CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>{siuClassificationLabel(c)}</option>
              ))}
            </Select>
          )}
        </Field>
        <p className="text-[11px] text-slate-400">
          The case number is minted server-side in the SIB series. You are recorded as the lead agent;
          a compartmented investigation starts with you as its only allow-listed member.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Opening…' : 'Open investigation'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------- targets */

function TargetsSection() {
  const siu = useSiu()
  const [rows, setRows] = useState<SiuTargetEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showCleared, setShowCleared] = useState(false)
  const [designating, setDesignating] = useState(false)
  const [dossier, setDossier] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setRows(await withRetry(() => fetchSiuTargets())) }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  const shown = useMemo(
    () => rows.filter((r) => showCleared || !r.cleared_at),
    [rows, showCleared],
  )

  const clear = async (t: SiuTargetEntry) => {
    const reason = await uiPrompt(
      `Clearing ${t.display_name} keeps the designation and records that it was lifted. Somebody wrongly designated is entitled to the record showing they were cleared, and the unit needs the record that it once thought otherwise.`,
      { title: 'Clear this designation', placeholder: 'What the investigation found', confirmText: 'Clear' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_clear_target', { p_id: t.id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Designation cleared.', 'success')
    void load()
  }

  if (loading) return <CardGridSkeleton cols="" />

  return (
    <Card>
      <SectionHeader
        title="Targets"
        subtitle="Investigative designations across SIB investigations you can access. A designation describes someone's standing in an investigation — it is not a finding or a conviction."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setShowCleared((v) => !v)}>
              {showCleared ? 'Hide cleared' : 'Show cleared'}
            </Button>
            {siu.isAgent && (
              <Button size="sm" variant="primary" onClick={() => setDesignating(true)}>
                + Designate a target
              </Button>
            )}
          </div>
        }
      />
      {!shown.length ? (
        <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
          <p className="text-sm font-semibold text-slate-200">
            {rows.length ? 'No active designations — everything here is cleared.' : 'No targets designated yet.'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-400">
            A designation records what somebody&apos;s standing is in one investigation. Pick the
            subject from the registry so the designation stays tied to what CID already knows about
            them — and so it survives their name being corrected.
          </p>
          {siu.isAgent && (
            <Button variant="primary" size="sm" className="mt-3" onClick={() => setDesignating(true)}>
              + Designate a target
            </Button>
          )}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((t) => (
            <li key={t.id} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                {t.entity_type === 'person' && t.entity_id ? (
                  <button
                    type="button"
                    className="min-w-0 truncate text-sm text-white underline-offset-2 hover:underline"
                    onClick={() => setDossier(t.entity_id)}
                  >
                    {t.display_name}
                  </button>
                ) : (
                  <span className="min-w-0 truncate text-sm text-white">{t.display_name}</span>
                )}
                {t.secondary && <span className="text-[11px] text-slate-500">{t.secondary}</span>}
                <Badge tone="neutral">{t.entity_type}</Badge>
                <Badge tint={designationTint(t.designation)}>
                  {siuDesignationLabel(t.designation as SiuDesignation)}
                </Badge>
                <Badge tint={siuTargetPriorityTint(t.priority)}>
                  {SIU_TARGET_PRIORITY_LABEL[t.priority] ?? t.priority}
                </Badge>
                {t.role_in_network && <span className="text-[11px] text-slate-400">{t.role_in_network}</span>}
                {t.case_number && (
                  <span className="ml-auto font-mono text-[11px] text-slate-500">{t.case_number}</span>
                )}
              </div>
              {t.notes && <p className="mt-1.5 text-xs text-slate-400">{t.notes}</p>}
              {t.cleared_at && (
                <p className="mt-1 text-[11px] text-emerald-300/80">
                  Cleared {fmtDate(t.cleared_at)}
                  {t.clearance_reason ? ` — ${t.clearance_reason}` : ''}
                </p>
              )}
              {siu.isAgent && !t.cleared_at && (
                <div className="mt-2 flex justify-end gap-3 text-[11px]">
                  {t.entity_type === 'person' && t.entity_id && (
                    <button
                      type="button"
                      className="text-slate-300 underline-offset-2 hover:underline"
                      onClick={() => setDossier(t.entity_id)}
                    >
                      Open dossier
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-emerald-300 underline-offset-2 hover:underline"
                    onClick={() => void clear(t)}
                  >
                    Clear
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {designating && (
        <DesignateTargetModal
          onClose={() => setDesignating(false)}
          onDone={() => { setDesignating(false); void load() }}
        />
      )}
      {dossier && (
        <SiuPersonDossierModal personId={dossier} onClose={() => setDossier(null)} />
      )}
    </Card>
  )
}

/** Designating names a registry record and an investigation. Both are required
 *  and neither is free text — a designation that floats without a case cannot
 *  be reviewed, and one that names a typed string cannot be looked up. */
function DesignateTargetModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [cases, setCases] = useState<CaseRow[]>([])
  const [caseId, setCaseId] = useState('')
  const [choice, setChoice] = useState<SiuRegistryChoice>(emptyChoice)
  const [designation, setDesignation] = useState('person_of_interest')
  const [priority, setPriority] = useState('medium')
  const [role, setRole] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      try {
        const r = await withRetry(() => list('cases', {
          eq: { case_authority: 'siu' }, is: { closed_at: null },
          order: 'created_at', ascending: false, limit: 200,
        })) as CaseRow[]
        if (live) setCases(r)
      } catch { /* an empty picker is the honest fallback */ }
    })()
    return () => { live = false }
  }, [])

  const save = async () => {
    if (!caseId) { toast('Choose the investigation this designation belongs to.', 'warn'); return }
    if (!choiceIsComplete(choice)) { toast('Choose the subject from the registry.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_designate_target', {
      p_case: caseId,
      p_entity_type: choice.entityType,
      p_entity_id: choice.entityId ?? undefined,
      p_designation: designation,
      p_priority: priority,
      p_role: role.trim() || undefined,
      p_notes: notes.trim() || undefined,
      p_label: choice.label?.trim() || undefined,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Designation recorded.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!caseId || choiceIsComplete(choice)}>
      <ModalHeader title="Designate a target" onClose={onClose} />
      <div className="space-y-3">
        <Field label="Investigation" required hint="Only investigations you can work are listed.">
          {(id) => (
            <Select id={id} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">Choose an investigation…</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.case_number} — {c.title}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <SiuRegistryPicker value={choice} onChange={setChoice} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Designation" required>
            {(id) => (
              <Select id={id} value={designation} onChange={(e) => setDesignation(e.target.value)}>
                {SIU_OPENABLE_DESIGNATIONS.map((d) => (
                  <option key={d} value={d}>{siuDesignationLabel(d)}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Priority" required>
            {(id) => (
              <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                {SIU_TARGET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>{SIU_TARGET_PRIORITY_LABEL[p]}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field label="Role in the network" hint="e.g. distribution, money movement, enforcement. Optional.">
          {(id) => <Input id={id} value={role} onChange={(e) => setRole(e.target.value)} />}
        </Field>
        <Field label="Notes" hint="Optional.">
          {(id) => <Textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>

        <p className="text-[11px] leading-relaxed text-slate-500">
          A designation describes standing in an investigation. It is not a finding, not a charge and
          not a conviction, and clearing one later keeps the record of both.
        </p>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Recording…' : 'Designate'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* -------------------------------------------------------------- operations */

function OperationsSection() {
  const siu = useSiu()
  const [rows, setRows] = useState<OperationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    await Promise.resolve()
    setLoading(true)
    try {
      setRows(await withRetry(() => list('operations', {
        order: 'created_at', ascending: false, eq: { authority: 'siu' },
      })) as OperationRow[])
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'danger')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const create = async () => {
    const name = await uiPrompt('Operation name', { title: 'New SIB operation' })
    if (!name?.trim()) return
    setBusy(true)
    const res = await rpc('siu_create_operation', { p_name: name.trim() })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Operation created.', 'success')
    void refresh()
  }

  if (loading) return <CardGridSkeleton cols="" />

  return (
    <Card>
      <SectionHeader
        title="Operations"
        subtitle="Planned SIB actions — surveillance, undercover, warrants, apprehensions. Invisible to CID at every rank."
        actions={siu.isAgent ? (
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void create()}>
            + New operation
          </Button>
        ) : undefined}
      />
      {!rows.length ? (
        <p className="mt-3 text-xs text-slate-400">No SIB operations yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-white">{o.name}</span>
              {o.op_category && (
                <Badge tone="neutral">
                  {siuOperationCategoryLabel(o.op_category as SiuOperationCategory)}
                </Badge>
              )}
              <Badge tone={o.status === 'active' ? 'accent' : 'neutral'}>{o.status}</Badge>
              <span className="text-[11px] text-slate-400">{fmtDate(o.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------ intelligence */

function IntelligenceSection() {
  const siu = useSiu()
  const [rows, setRows] = useState<SiuIntelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [grading, setGrading] = useState<SiuIntelEntry | null>(null)
  const [recording, setRecording] = useState(false)
  const [dossier, setDossier] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setRows(await withRetry(() => fetchSiuIntelligence())) }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  const review = async (n: SiuIntelEntry, outcome: string) => {
    const note = await uiPrompt(
      outcome === 'withdrawn'
        ? 'The note is resolved and marked withdrawn. It is kept, not deleted — intelligence that turned out to be wrong is part of the record of what the unit believed, and when.'
        : 'Recorded against your name, with the next review date set 90 days out.',
      { title: `Record a review — ${siuReviewOutcomeLabel(outcome)}`, placeholder: 'What the review found', confirmText: 'Record' },
    )
    if (!note?.trim()) return
    const res = await rpc('siu_review_note', { p_note: n.id, p_outcome: outcome, p_note_text: note.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Review recorded.', 'success')
    void load()
  }

  if (loading) return <CardGridSkeleton cols="" />

  const open = rows.filter((r) => !r.resolved_at)
  const ungraded = open.filter((n) => !n.info_credibility).length
  const overdue = open.filter((n) => n.review_overdue).length

  return (
    <Card>
      <SectionHeader
        title="Intelligence"
        subtitle="Restricted SIB intelligence, including concerns recorded against CID investigations. A CID case's own detectives and CID command never see that these notes exist."
        actions={
          <div className="flex items-center gap-2">
            {ungraded > 0 && <Badge tint="bg-white/5 text-slate-300">{ungraded} ungraded</Badge>}
            {overdue > 0 && <Badge tint="bg-amber-500/15 text-amber-300">{overdue} review overdue</Badge>}
            {siu.isAgent && (
              <Button size="sm" variant="primary" onClick={() => setRecording(true)}>
                + Record intelligence
              </Button>
            )}
          </div>
        }
      />
      {!open.length ? (
        <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
          <p className="text-sm font-semibold text-slate-200">
            {rows.length ? 'No unresolved SIB intelligence.' : 'No intelligence recorded yet.'}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-400">
            A note can sit on an SIB investigation or on a CID case. Recorded against a CID case it
            is invisible to that case&apos;s own detectives and to CID command — which is what makes
            investigating a compromised investigator possible without alerting them.
          </p>
          {siu.isAgent && (
            <Button variant="primary" size="sm" className="mt-3" onClick={() => setRecording(true)}>
              + Record intelligence
            </Button>
          )}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {open.map((n) => (
            <li key={n.id} className="rounded-lg border border-white/5 bg-white/5 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tint={noteTint(n.note_type)}>{siuNoteTypeLabel(n.note_type as SiuNoteType)}</Badge>
                <Badge tone={n.severity === 'critical' || n.severity === 'high' ? 'warn' : 'neutral'}>
                  {n.severity}
                </Badge>
                {/* Grading reads as its own pair: who said it, and whether it is
                    true. Ungraded shows as ungraded — never as neutral-good. */}
                <Badge tint={siuCredibilityTint(n.info_credibility)}>
                  {siuCredibilityLabel(n.info_credibility)}
                </Badge>
                {n.source_reliability && (
                  <Badge tone="neutral" title="Source reliability">
                    {siuReliabilityLabel(n.source_reliability)}
                  </Badge>
                )}
                {n.source_type && <Badge tone="neutral">{siuSourceTypeLabel(n.source_type)}</Badge>}
                {n.review_overdue && (
                  <Badge tint="bg-amber-500/15 text-amber-300">Review overdue</Badge>
                )}
                <span className="ml-auto text-[11px] text-slate-400">{fmtWhen(n.created_at)}</span>
              </div>

              {/* Which case this is ABOUT, said out loud. A concern against a CID
                  investigation is the sensitive case and must never have to be
                  inferred from where the reader happened to be standing. */}
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                {n.case_number && (
                  <span className="font-mono">{n.case_number}</span>
                )}
                {n.is_about_cid_case && (
                  <Badge tint="bg-violet-500/15 text-violet-300">CID case — hidden from CID</Badge>
                )}
                {n.siu_case_number && n.siu_case_number !== n.case_number && (
                  <span>held by {n.siu_case_number}</span>
                )}
                {n.subject_person_id && n.subject_name && (
                  <button
                    type="button"
                    className="text-slate-400 underline-offset-2 hover:underline"
                    onClick={() => setDossier(n.subject_person_id)}
                  >
                    Subject: {n.subject_name}
                  </button>
                )}
                {n.created_by_name && <span>by {n.created_by_name}</span>}
              </p>

              <p className="mt-1.5 whitespace-pre-wrap text-xs text-slate-300">{n.body}</p>
              {siu.isAgent && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                  {n.review_due_at && (
                    <span className="text-slate-500">Review due {fmtDate(n.review_due_at)}</span>
                  )}
                  <button
                    type="button"
                    className="ml-auto text-sky-300 underline-offset-2 hover:underline"
                    onClick={() => setGrading(n)}
                  >
                    {n.info_credibility ? 'Regrade' : 'Grade'}
                  </button>
                  <button
                    type="button"
                    className="text-slate-300 underline-offset-2 hover:underline"
                    onClick={() => void review(n, 'revalidated')}
                  >
                    Revalidate
                  </button>
                  <button
                    type="button"
                    className="text-rose-300 underline-offset-2 hover:underline"
                    onClick={() => void review(n, 'withdrawn')}
                  >
                    Withdraw
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {recording && (
        <RecordIntelligenceModal
          onClose={() => setRecording(false)}
          onDone={() => { setRecording(false); void load() }}
        />
      )}
      {dossier && (
        <SiuPersonDossierModal personId={dossier} onClose={() => setDossier(null)} />
      )}
      {grading && (
        <GradeNoteModal
          note={grading}
          onClose={() => setGrading(null)}
          onDone={() => { setGrading(null); void load() }}
        />
      )}
    </Card>
  )
}

/** Recording a note.
 *
 *  Two things this form has to be honest about, because both are easy to get
 *  wrong and expensive when wrong:
 *
 *   * WHICH case. A note against a CID investigation is hidden from that
 *     investigation's own detectives and from CID command. That is the feature,
 *     and the author is told so before they save rather than after.
 *   * Grading at AUTHORSHIP. The 5x5x5 can only be set as the note is written;
 *     afterwards `block_direct_siu_note_grading` refuses it and grading goes
 *     through its own verb. Leaving it blank is legitimate and the note is then
 *     surfaced as ungraded — which is the honest state, not a defect. */
function RecordIntelligenceModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [cases, setCases] = useState<CaseRow[]>([])
  const [caseId, setCaseId] = useState('')
  const [siuCaseId, setSiuCaseId] = useState('')
  const [noteType, setNoteType] = useState('intelligence')
  const [severity, setSeverity] = useState('medium')
  const [body, setBody] = useState('')
  const [sourceType, setSourceType] = useState('')
  const [reliability, setReliability] = useState('')
  const [credibility, setCredibility] = useState('')
  const [reviewDays, setReviewDays] = useState(90)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      try {
        const r = await withRetry(() => list('cases', {
          is: { closed_at: null }, order: 'created_at', ascending: false, limit: 300,
        })) as CaseRow[]
        if (live) setCases(r)
      } catch { /* an empty picker is the honest fallback */ }
    })()
    return () => { live = false }
  }, [])

  const siuCases = useMemo(() => cases.filter((c) => c.case_authority === 'siu'), [cases])
  const target = cases.find((c) => c.id === caseId)
  const aboutCid = !!target && target.case_authority !== 'siu'

  const save = async () => {
    if (!caseId) { toast('Choose the case this note is about.', 'warn'); return }
    if (!body.trim()) { toast('A note needs a body.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_record_intelligence', {
      p_case: caseId,
      p_note_type: noteType,
      p_body: body.trim(),
      p_severity: severity,
      p_siu_case: siuCaseId || undefined,
      p_source_type: sourceType || undefined,
      p_source_reliability: reliability || undefined,
      p_info_credibility: credibility || undefined,
      p_review_days: credibility ? reviewDays : undefined,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Intelligence recorded.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!body || !!caseId} wide>
      <ModalHeader title="Record intelligence" onClose={onClose} />
      <div className="space-y-3">
        <Field label="About which case" required>
          {(id) => (
            <Select id={id} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">Choose a case…</option>
              {cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.case_authority === 'siu' ? '[SIB] ' : '[CID] '}{c.case_number} — {c.title}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {aboutCid && (
          <p className="rounded-lg border border-violet-500/25 bg-violet-500/5 px-3 py-2 text-xs leading-relaxed text-violet-200/90">
            This note sits on a <strong className="font-semibold">CID investigation</strong>. Its own
            detectives and CID command will not see that it exists — that is what makes recording a
            concern about an investigation possible without alerting the people running it. Every SIB
            field agent can read it.
          </p>
        )}

        {aboutCid && (
          <Field
            label="Held by which SIB investigation"
            hint="Optional. Files the concern under one of your investigations so it is found again."
          >
            {(id) => (
              <Select id={id} value={siuCaseId} onChange={(e) => setSiuCaseId(e.target.value)}>
                <option value="">Not filed under an investigation</option>
                {siuCases.map((c) => (
                  <option key={c.id} value={c.id}>{c.case_number} — {c.title}</option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type" required>
            {(id) => (
              <Select id={id} value={noteType} onChange={(e) => setNoteType(e.target.value)}>
                {SIU_NOTE_TYPES.map((t) => (
                  <option key={t} value={t}>{siuNoteTypeLabel(t)}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Severity" required>
            {(id) => (
              <Select id={id} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                {['low', 'medium', 'high', 'critical'].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <Field label="The note" required hint="What is being recorded, in enough detail to be assessed later.">
          {(id) => <Textarea id={id} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>

        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <p className="text-xs font-semibold text-slate-200">Grading (5×5×5)</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
            Set here or leave blank. It can only be entered as the note is written — afterwards it
            goes through Grade, which records who assessed it and when. An ungraded note is shown as
            ungraded rather than assumed sound.
          </p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <Field label="Source">
              {(id) => (
                <Select id={id} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
                  <option value="">Not stated</option>
                  {SIU_SOURCE_TYPES.map((t) => (
                    <option key={t} value={t}>{siuSourceTypeLabel(t)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Reliability">
              {(id) => (
                <Select id={id} value={reliability} onChange={(e) => setReliability(e.target.value)}>
                  <option value="">Not stated</option>
                  {SIU_RELIABILITY.map((t) => (
                    <option key={t} value={t}>{siuReliabilityLabel(t)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Credibility">
              {(id) => (
                <Select id={id} value={credibility} onChange={(e) => setCredibility(e.target.value)}>
                  <option value="">Ungraded</option>
                  {SIU_CREDIBILITY.map((t) => (
                    <option key={t} value={t}>{siuCredibilityLabel(t)}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          {credibility && (
            <div className="mt-2 max-w-[12rem]">
              <Field label="Review in (days)" hint="Only graded intelligence gets a review date.">
                {(id) => (
                  <Input
                    id={id} type="number" min={1} max={730}
                    value={reviewDays} onChange={(e) => setReviewDays(Number(e.target.value))}
                  />
                )}
              </Field>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Recording…' : 'Record'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function GradeNoteModal({ note, onClose, onDone }: {
  // Only the four fields it actually grades. Narrower than the table row on
  // purpose: the list now comes from siu_intelligence_live(), whose shape is a
  // join rather than siu_case_notes, and a modal that grades one note has no
  // business demanding every column of it.
  note: {
    id: string
    source_type: string | null
    source_reliability: string | null
    info_credibility: string | null
  }
  onClose: () => void; onDone: () => void
}) {
  const [sourceType, setSourceType] = useState<string>(note.source_type ?? 'human_source')
  const [reliability, setReliability] = useState<string>(note.source_reliability ?? 'untested')
  const [credibility, setCredibility] = useState<string>(note.info_credibility ?? 'cannot_judge')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    const res = await rpc('siu_grade_note', {
      p_note: note.id,
      p_source_type: sourceType,
      p_reliability: reliability,
      p_credibility: credibility,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Graded. Next review in 90 days.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => false}>
      <ModalHeader title="Grade this intelligence" onClose={onClose} />
      <div className="space-y-3">
        <Field label="How it was obtained" required>
          {(id) => (
            <Select id={id} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
              {SIU_SOURCE_TYPES.map((t) => (
                <option key={t} value={t}>{siuSourceTypeLabel(t)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Source reliability" required hint="How much the SOURCE has been worth in the past.">
          {(id) => (
            <Select id={id} value={reliability} onChange={(e) => setReliability(e.target.value)}>
              {SIU_RELIABILITY.map((r) => (
                <option key={r} value={r}>{siuReliabilityLabel(r)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Information credibility"
          required
          hint="Whether THIS piece is true, judged on its own. A reliable source can still pass on a rumour."
        >
          {(id) => (
            <Select id={id} value={credibility} onChange={(e) => setCredibility(e.target.value)}>
              {SIU_CREDIBILITY.map((c) => (
                <option key={c} value={c}>{siuCredibilityLabel(c)}</option>
              ))}
            </Select>
          )}
        </Field>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save grading'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ agents */

function AgentsSection() {
  const { profile } = useAuth()
  const siu = useSiu()
  const [rows, setRows] = useState<SiuRosterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [inviting, setInviting] = useState(false)

  const refresh = useCallback(async () => {
    await Promise.resolve()
    setLoading(true)
    try { setRows(await withRetry(fetchSiuRoster)) }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const remove = async (r: SiuRosterRow) => {
    if (!(await uiConfirm(
      `Revoke ${r.display_name || 'this agent'}'s SIB access? Their reports, evidence, authorship and audit history are preserved — only live access ends.`,
      { title: 'Remove from SIB', confirmText: 'Remove' },
    ))) return
    const reason = await uiPrompt('Reason for the removal (recorded in the SIB audit trail)', { title: 'Reason required' })
    if (!reason?.trim()) return
    const res = await rpc('siu_remove', { p_user: r.user_id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('SIB access revoked.', 'success')
    void refresh()
  }

  const setCallsign = async (r: SiuRosterRow) => {
    const next = await uiPrompt('Callsign', { title: 'Set callsign', value: r.callsign ?? '' })
    if (next === null) return
    const res = await rpc('siu_set_callsign', { p_user: r.user_id, p_callsign: next.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Callsign updated.', 'success')
    void refresh()
  }

  const active = rows.filter((r) => r.active)
  const former = rows.filter((r) => !r.active)

  return (
    <div className="space-y-4">
      <Card>
        <SectionHeader
          title="SIB personnel"
          subtitle="Appointment only — there is no application, no request queue and no promotion path into SIB."
          actions={siu.canAppoint ? (
            <Button variant="primary" onClick={() => setInviting(true)}>+ Invite agent</Button>
          ) : undefined}
        />
      </Card>

      {loading ? <CardGridSkeleton cols="" /> : (
        <>
          <Card>
            <SectionHeader title={`Active (${active.length})`} />
            {!active.length ? (
              <p className="mt-3 text-xs text-slate-400">No SIB agents appointed yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[46rem] text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-2 py-1.5">Agent</th>
                      <th className="px-2 py-1.5">SIB role</th>
                      <th className="px-2 py-1.5">Callsign</th>
                      <th className="px-2 py-1.5">Appointed</th>
                      <th className="px-2 py-1.5">Former CID</th>
                      <th className="px-2 py-1.5">Last activity</th>
                      <th className="px-2 py-1.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((r) => (
                      <tr key={r.user_id} className="border-t border-white/5">
                        <td className="px-2 py-2 text-white">
                          {r.display_name || 'Member'}
                          {r.user_id === profile?.id && (
                            <span className="ml-1 rounded bg-blue-500/15 px-1.5 text-[10px] font-semibold uppercase text-blue-300">you</span>
                          )}
                          {r.badge_number && <span className="ml-1 text-[11px] text-slate-400">#{r.badge_number}</span>}
                        </td>
                        <td className="px-2 py-2">
                          <Badge tint="bg-violet-500/15 text-violet-300">
                            {r.oversight_only ? 'SIB Oversight' : siuRoleLabel(r.siu_role)}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 font-mono text-slate-200">{siuCallsign(r.callsign)}</td>
                        <td className="px-2 py-2 text-slate-300">
                          {fmtDate(r.appointed_at)}
                          {r.appointed_by_name && <span className="block text-[11px] text-slate-400">by {r.appointed_by_name}</span>}
                        </td>
                        {/* History, never authority — no SIB rule reads it. */}
                        <td className="px-2 py-2 text-slate-400">
                          {roleLabel(r.former_cid_role)}{r.former_cid_bureau ? ` · ${bureauShort(r.former_cid_bureau)}` : ''}
                        </td>
                        <td className="px-2 py-2 text-slate-400">{fmtWhen(r.last_activity)}</td>
                        <td className="px-2 py-2 text-right">
                          {siu.canAppoint && (
                            <Button size="sm" className="-my-1 mr-1" onClick={() => void setCallsign(r)}>Callsign</Button>
                          )}
                          {siuCanRemove(
                            { profile, membership: siu.membership, release: siu.releaseOpen },
                            { user_id: r.user_id, siu_role: r.siu_role, callsign: r.callsign, oversight_only: r.oversight_only, active: r.active },
                          ) && (
                            <Button size="sm" variant="danger" className="-my-1" onClick={() => void remove(r)}>Remove</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {!!former.length && (
            <Card>
              <SectionHeader
                title={`Former (${former.length})`}
                subtitle="Access ended. Reports, evidence, authorship and audit history are preserved."
              />
              <ul className="mt-3 space-y-1.5">
                {former.map((r) => (
                  <li key={r.user_id} className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="text-slate-300">{r.display_name || 'Member'}</span>
                    <span>{SIU_ROLE_SHORT[r.siu_role] ?? r.siu_role}</span>
                    <span>· ended {fmtDate(r.ended_at)}</span>
                    {r.end_reason && <span className="truncate">· {r.end_reason}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}

      {inviting && (
        <InviteAgentModal onClose={() => setInviting(false)} onDone={() => { setInviting(false); void refresh() }} />
      )}
    </div>
  )
}

function InviteAgentModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { profile } = useAuth()
  const siu = useSiu()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<SiuCandidate[]>([])
  const [picked, setPicked] = useState<SiuCandidate | null>(null)
  const [role, setRole] = useState('special_agent')
  const [callsign, setCallsign] = useState('')
  const [oversight, setOversight] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => {
      void searchSiuCandidates(q)
        .then((r) => { if (live) setResults(r) })
        .catch(() => { if (live) setResults([]) })
    }, 200)
    return () => { live = false; window.clearTimeout(t) }
  }, [q])

  const ctx = { profile, membership: siu.membership, release: siu.releaseOpen }
  const roles = (['special_agent', 'special_agent_in_charge'] as const).filter((r) => siuCanAppointRole(ctx, r))

  const submit = async () => {
    if (!picked) { toast('Pick a member to appoint.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_appoint', {
      p_user: picked.id,
      p_role: role,
      p_callsign: callsign.trim() || undefined,
      p_oversight_only: oversight,
      p_note: note.trim() || undefined,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(`${picked.display_name || 'Member'} appointed to SIB.`, 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!picked}>
      <ModalHeader title="Invite an agent into SIB" onClose={onClose} />
      <div className="space-y-3">
        <Field label="Find an approved portal member" hint="Only active, approved accounts that are not already in SIB.">
          {(id) => <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or badge number…" />}
        </Field>
        <div className="max-h-52 overflow-y-auto rounded-lg border border-white/10">
          {!results.length ? (
            <p className="px-3 py-4 text-xs text-slate-400">No matching members.</p>
          ) : results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setPicked(c)}
              className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-white/10 ${
                picked?.id === c.id ? 'bg-white/10' : ''
              }`}
            >
              <span className="flex-1 truncate text-white">{c.display_name || 'Member'}</span>
              <span className="text-slate-400">{roleLabel(c.cid_role)}{c.cid_bureau ? ` · ${bureauShort(c.cid_bureau)}` : ''}</span>
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="SIB role">
            {(id) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => <option key={r} value={r}>{siuRoleLabel(r)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Callsign" hint="X-2, X-3, … Free-form; unique among active agents.">
            {(id) => <Input id={id} value={callsign} onChange={(e) => setCallsign(e.target.value)} placeholder="X-2" />}
          </Field>
        </div>

        <label className="flex items-start gap-2 text-xs text-slate-300">
          <input type="checkbox" className="mt-0.5" checked={oversight} onChange={(e) => setOversight(e.target.checked)} />
          <span>
            <strong className="font-semibold text-white">Oversight only.</strong>{' '}
            Appointment and legal oversight without field authority — no broad CID read and no default
            access to investigations. Use this for the Attorney General.
          </span>
        </label>

        <Field label="Internal note" hint="Recorded with the appointment. Never shown to the appointee.">
          {(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>

        <p className="text-[11px] text-slate-400">
          The appointee gets a private in-portal notice. No announcement is posted.
          Only the Portal Owner may appoint a Special Agent in Charge.
        </p>

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || !picked}>
            {busy ? 'Appointing…' : 'Confirm appointment'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------------------------------------------------------- activity */

function ActivitySection() {
  const [rows, setRows] = useState<SiuAuditRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void withRetry(() => fetchSiuAudit(150))
      .then((r) => { if (live) setRows(r) })
      .catch((e) => { if (live) toast(e instanceof Error ? e.message : String(e), 'danger') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  if (loading) return <CardGridSkeleton cols="" />

  return (
    <Card>
      <SectionHeader
        title="SIB activity"
        subtitle="Appointments, classifications, assignments and compartment changes. Case-keyed entries appear only for investigations you are cleared for — the subject of an investigation never sees its trail."
      />
      {!rows.length ? (
        <p className="mt-3 text-xs text-slate-400">No SIB activity recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-2 border-t border-white/5 py-1.5 text-xs">
              <span className="w-36 shrink-0 text-[11px] text-slate-400">{fmtWhen(r.created_at)}</span>
              <span className="font-medium text-white">{siuAuditLabel(r.action)}</span>
              {r.actor_name && <span className="text-slate-400">by {r.actor_name}</span>}
              {typeof r.detail?.reason === 'string' && (
                <span className="min-w-0 flex-1 truncate text-slate-400">— {r.detail.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
