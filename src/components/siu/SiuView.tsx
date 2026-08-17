'use client'

/** Special Investigation Unit — the privileged investigative workspace.
 *
 *  SIU deliberately reuses the CID portal's mature systems: an SIU
 *  investigation IS a `cases` row (authority `siu`), so opening one lands in
 *  the ordinary case workspace with its reports, evidence, media, tasks,
 *  timeline, chat, graph and legal tabs already working. This screen is the
 *  privileged FILTER and the SIU-only administration around them — not a
 *  second case-management app.
 *
 *  Access: every gate here comes from `useSiu()` (the client mirror of
 *  `private.siu_standing()`). Rendering nothing is the correct behavior for an
 *  unauthorized account — the route resolves to the app's ordinary
 *  unknown-tab notice, never a "restricted" banner that would confirm SIU
 *  exists. RLS and the SIU RPCs are the real enforcement.
 *
 *  Visual language: the portal's own dark investigative surfaces with a violet
 *  authority accent and small classification chips. No stamps, no glow, no
 *  hacker aesthetic — the difference between CID and SIU is authority and
 *  information access, not decoration. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { list, rpc, withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import { useTableVersion } from '@/lib/realtime'
import {
  SIU_CLASSIFICATIONS, fetchSiuAudit, fetchSiuOverview, fetchSiuRoster,
  searchSiuCandidates, siuAuditLabel, siuCallsign, siuCanAppointRole, siuCanRemove,
  siuClassificationLabel, siuClassificationTint, siuRoleLabel,
  SIU_CLASSIFICATION_HINT, SIU_ROLE_SHORT, SIU_INTEGRITY_NOTE_TYPES,
  SIU_PRIORITY_DESIGNATIONS, siuDesignationLabel, siuNoteTypeLabel,
  siuOperationCategoryLabel, type SiuOperationCategory,
  type SiuAuditRow, type SiuCandidate, type SiuOverview, type SiuRosterRow,
  type SiuDesignation, type SiuNoteType,
  SIU_CREDIBILITY, SIU_RELIABILITY, SIU_SOURCE_TYPES,
  isUngraded, reviewOverdue, siuCredibilityLabel, siuCredibilityTint,
  siuReliabilityLabel, siuReviewOutcomeLabel, siuSourceTypeLabel,
} from '@/lib/siu'
import { SiuDisclosuresSection } from './SiuDisclosures'
import { SiuIntakeSection } from './SiuIntake'
import { SiuWatchlistSection } from './SiuWatchlist'
import { SiuCommandSection } from './SiuCommand'
import { SiuOversightSection, SiuTradecraftSection } from './SiuTradecraft'
import { roleLabel } from '@/lib/roles'
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
  | 'watchlist' | 'tradecraft' | 'disclosure' | 'command' | 'oversight' | 'agents' | 'activity'
type TargetRow = Tables<'siu_targets'>
type OperationRow = Tables<'operations'>
type NoteRow = Tables<'siu_case_notes'>

const SECTIONS = [
  { id: 'overview' as const, label: 'Overview' },
  { id: 'intake' as const, label: 'Intake' },
  { id: 'investigations' as const, label: 'Investigations' },
  { id: 'targets' as const, label: 'Targets' },
  { id: 'operations' as const, label: 'Operations' },
  { id: 'intelligence' as const, label: 'Intelligence' },
  { id: 'watchlist' as const, label: 'Watchlist' },
  { id: 'tradecraft' as const, label: 'Tradecraft' },
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
  const [section, setSection] = useState<Section>('overview')

  if (state !== 'in') return <Notice text="Sign in to continue." />
  if (siu.loading) return <CardGridSkeleton cols="" />
  // Unauthorized: the app's ordinary "nothing here" surface. No mention of
  // SIU, no hint that a restricted area exists.
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
      <Card pad="lg" className="mb-5 border-violet-500/20">
        <PageHeader
          eyebrow="Special Investigation Unit"
          title="SIU Workspace"
          subtitle="Investigations, personnel and oversight of CID activity — separate authority, need-to-know by default."
          actions={
            <div className="flex items-center gap-2">
              <Badge tint="bg-violet-500/15 text-violet-300">
                {siu.standing === 'owner' ? 'Portal Owner'
                  : siu.standing === 'oversight' ? 'SIU Oversight'
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
            <strong className="font-semibold">Pre-release.</strong> SIU is gated to the Portal Owner
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
        ariaLabel="SIU sections"
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
      {section === 'disclosure' && <SiuDisclosuresSection />}
      {section === 'command' && <SiuCommandSection />}
      {section === 'oversight' && <SiuOversightSection />}
      {section === 'agents' && <AgentsSection />}
      {section === 'activity' && <ActivitySection />}
    </div>
  )
}

/* ---------------------------------------------------------------- overview */

function OverviewSection({ onGoto }: { onGoto: (s: Section) => void }) {
  const siu = useSiu()
  const [data, setData] = useState<SiuOverview | null>(null)
  const [recent, setRecent] = useState<CaseRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const [o, r] = await Promise.all([
          withRetry(fetchSiuOverview),
          withRetry(() => list('cases', {
            order: 'updated_at', ascending: false, limit: 6,
            eq: { case_authority: 'siu' },
            select: 'id,case_number,title,status,siu_classification,updated_at,lead_detective_id',
          })),
        ])
        if (live) { setData(o); setRecent(r as CaseRow[]) }
      } catch (e) {
        if (live) toast(e instanceof Error ? e.message : String(e), 'danger')
      } finally { if (live) setLoading(false) }
    })()
    return () => { live = false }
  }, [])

  if (loading) return <CardGridSkeleton cols="" />
  if (!data?.access) return <Notice text="Nothing to show here." />

  return (
    <div className="space-y-4">
      <MetricStrip
        metrics={[
          { label: 'Investigations', value: data.investigations ?? 0, hint: 'You can access', onClick: () => onGoto('investigations') },
          { label: 'Open', value: data.open_investigations ?? 0 },
          { label: 'Assigned to you', value: data.assigned ?? 0, onClick: () => onGoto('investigations') },
          { label: 'Compartmented', value: data.compartmented ?? 0, tint: 'bg-rose-500/15 text-rose-300' },
          { label: 'Legal pending', value: data.legal_pending ?? 0, hint: 'Warrants & subpoenas' },
          { label: 'Agents', value: data.agents ?? 0, onClick: () => onGoto('agents') },
        ]}
      />

      {/* Operational picture — the §14 sections, each counting only what this
          agent may actually see. */}
      <MetricStrip
        metrics={[
          { label: 'Priority targets', value: data.priority_targets ?? 0,
            hint: 'Target · Priority · Fugitive',
            tint: (data.priority_targets ?? 0) > 0 ? 'bg-rose-500/15 text-rose-300' : undefined },
          { label: 'Active targets', value: data.active_targets ?? 0 },
          { label: 'Active operations', value: data.active_operations ?? 0 },
          { label: 'Surveillance', value: data.surveillance_active ?? 0, hint: 'Running' },
          { label: 'Intelligence', value: data.open_intel ?? 0, hint: 'Unresolved' },
          { label: 'Integrity flags', value: data.cid_integrity_flags ?? 0,
            hint: 'Raised on CID cases',
            tint: (data.cid_integrity_flags ?? 0) > 0 ? 'bg-amber-500/15 text-amber-300' : undefined },
        ]}
      />

      <Card>
        <SectionHeader
          title="Active investigations"
          subtitle="The most recently worked SIU cases you are cleared for."
          actions={<Button size="sm" onClick={() => onGoto('investigations')}>View all</Button>}
        />
        {!recent.length ? (
          <p className="mt-3 text-xs text-slate-400">No SIU investigations yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recent.map((c) => <InvestigationRow key={c.id} row={c} />)}
          </ul>
        )}
      </Card>

      {/* CID oversight signal — deliberately a filtered pointer into the CID
          screens SIU already reads, not a second analytics dashboard. */}
      {siu.canReadCid && (
        <Card>
          <SectionHeader
            title="CID activity"
            subtitle="SIU holds broad read access across every bureau. Read-only: SIU never edits CID records."
          />
          <div className="mt-3">
            <MetricStrip
              metrics={[
                { label: 'Open CID cases', value: data.cid_open_cases ?? '—' },
                { label: 'Opened this week', value: data.cid_recent_cases ?? '—' },
              ]}
            />
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Work CID material in its own screens — Case Files, Persons, Gangs, the relationship
            graph and global search all already return every bureau&rsquo;s records for you.
            Integrity concerns you record against a CID investigation stay on the SIU layer:
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
        <span className="font-mono text-xs font-semibold text-violet-300">{row.case_number}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-white">{row.title || 'Untitled investigation'}</span>
        <Badge tint={siuClassificationTint(row.siu_classification)}>
          {siuClassificationLabel(row.siu_classification)}
        </Badge>
        <Badge tone={row.status === 'closed' ? 'neutral' : 'accent'}>{row.status}</Badge>
        <span className="text-[10px] text-slate-400">{fmtDate(row.updated_at)}</span>
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
  // in the realtime publication and its per-subscriber RLS now runs the SIU
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
          title="SIU investigations"
          subtitle="Every SIU case you are cleared for. Opening one uses the full case workspace."
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
          title={rows.length ? 'No investigation matches that filter' : 'No SIU investigations yet'}
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

function NewInvestigationModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
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
      <ModalHeader title="New SIU investigation" onClose={onClose} />
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
          The case number is minted server-side in the SIU series. You are recorded as the lead agent;
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
  const [rows, setRows] = useState<TargetRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCleared, setShowCleared] = useState(false)

  useEffect(() => {
    let live = true
    void withRetry(() => list('siu_targets', { order: 'created_at', ascending: false }))
      .then((r) => { if (live) setRows(r as TargetRow[]) })
      .catch((e) => { if (live) toast(e instanceof Error ? e.message : String(e), 'danger') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  const shown = useMemo(
    () => rows.filter((r) => showCleared || !r.cleared_at),
    [rows, showCleared],
  )

  if (loading) return <CardGridSkeleton cols="" />

  return (
    <Card>
      <SectionHeader
        title="Targets"
        subtitle="Investigative designations across SIU investigations you can access. A designation describes someone's standing in an investigation — it is not a finding or a conviction."
        actions={
          <Button size="sm" onClick={() => setShowCleared((v) => !v)}>
            {showCleared ? 'Hide cleared' : 'Show cleared'}
          </Button>
        }
      />
      {!shown.length ? (
        <p className="mt-3 text-xs text-slate-400">
          {rows.length ? 'No active designations — everything here is cleared.' : 'No targets designated yet.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-white/5 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-white">{t.label}</span>
              <Badge tone="neutral">{t.entity_type}</Badge>
              <Badge tint={designationTint(t.designation)}>
                {siuDesignationLabel(t.designation as SiuDesignation)}
              </Badge>
              {t.role_in_network && <span className="text-[11px] text-slate-400">{t.role_in_network}</span>}
              {t.cleared_at && <Badge tone="good">Cleared</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
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
    const name = await uiPrompt('Operation name', { title: 'New SIU operation' })
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
        subtitle="Planned SIU actions — surveillance, undercover, warrants, apprehensions. Invisible to CID at every rank."
        actions={siu.isAgent ? (
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void create()}>
            + New operation
          </Button>
        ) : undefined}
      />
      {!rows.length ? (
        <p className="mt-3 text-xs text-slate-400">No SIU operations yet.</p>
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
              <span className="text-[10px] text-slate-400">{fmtDate(o.created_at)}</span>
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
  const [rows, setRows] = useState<NoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [grading, setGrading] = useState<NoteRow | null>(null)

  const load = useCallback(async () => {
    try { setRows(await withRetry(() => list('siu_case_notes', { order: 'created_at', ascending: false, limit: 100 })) as NoteRow[]) }
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

  const review = async (n: NoteRow, outcome: string) => {
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
  const ungraded = open.filter(isUngraded).length
  const overdue = open.filter(reviewOverdue).length

  return (
    <Card>
      <SectionHeader
        title="Intelligence"
        subtitle="Restricted SIU intelligence, including concerns recorded against CID investigations. A CID case's own detectives and CID command never see that these notes exist."
        actions={
          <div className="flex items-center gap-2">
            {ungraded > 0 && <Badge tint="bg-white/5 text-slate-300">{ungraded} ungraded</Badge>}
            {overdue > 0 && <Badge tint="bg-amber-500/15 text-amber-300">{overdue} review overdue</Badge>}
          </div>
        }
      />
      {!open.length ? (
        <p className="mt-3 text-xs text-slate-400">No unresolved SIU intelligence.</p>
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
                {reviewOverdue(n) && (
                  <Badge tint="bg-amber-500/15 text-amber-300">Review overdue</Badge>
                )}
                <span className="ml-auto text-[10px] text-slate-400">{fmtWhen(n.created_at)}</span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-xs text-slate-300">{n.body}</p>
              {siu.isAgent && (
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                  {n.review_due_at && (
                    <span className="text-slate-500">Review due {fmtDate(n.review_due_at)}</span>
                  )}
                  <button
                    type="button"
                    className="ml-auto text-violet-300 underline-offset-2 hover:underline"
                    onClick={() => setGrading(n)}
                  >
                    {isUngraded(n) ? 'Grade' : 'Regrade'}
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

/** §20/§21. Two grades, asked separately and on purpose — collapsing "who said
 *  it" and "is it true" into one confidence number is how an assessment gets
 *  over-trusted. */
function GradeNoteModal({ note, onClose, onDone }: {
  note: NoteRow; onClose: () => void; onDone: () => void
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
      `Revoke ${r.display_name || 'this agent'}'s SIU access? Their reports, evidence, authorship and audit history are preserved — only live access ends.`,
      { title: 'Remove from SIU', confirmText: 'Remove' },
    ))) return
    const reason = await uiPrompt('Reason for the removal (recorded in the SIU audit trail)', { title: 'Reason required' })
    if (!reason?.trim()) return
    const res = await rpc('siu_remove', { p_user: r.user_id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('SIU access revoked.', 'success')
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
          title="SIU personnel"
          subtitle="Appointment only — there is no application, no request queue and no promotion path into SIU."
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
              <p className="mt-3 text-xs text-slate-400">No SIU agents appointed yet.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[46rem] text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wider text-slate-400">
                    <tr>
                      <th className="px-2 py-1.5">Agent</th>
                      <th className="px-2 py-1.5">SIU role</th>
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
                          {r.badge_number && <span className="ml-1 text-[10px] text-slate-400">#{r.badge_number}</span>}
                        </td>
                        <td className="px-2 py-2">
                          <Badge tint="bg-violet-500/15 text-violet-300">
                            {r.oversight_only ? 'SIU Oversight' : siuRoleLabel(r.siu_role)}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 font-mono text-violet-300">{siuCallsign(r.callsign)}</td>
                        <td className="px-2 py-2 text-slate-300">
                          {fmtDate(r.appointed_at)}
                          {r.appointed_by_name && <span className="block text-[10px] text-slate-400">by {r.appointed_by_name}</span>}
                        </td>
                        {/* History, never authority — no SIU rule reads it. */}
                        <td className="px-2 py-2 text-slate-400">
                          {roleLabel(r.former_cid_role)}{r.former_cid_bureau ? ` · ${r.former_cid_bureau}` : ''}
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
    toast(`${picked.display_name || 'Member'} appointed to SIU.`, 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!picked}>
      <ModalHeader title="Invite an agent into SIU" onClose={onClose} />
      <div className="space-y-3">
        <Field label="Find an approved portal member" hint="Only active, approved accounts that are not already in SIU.">
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
                picked?.id === c.id ? 'bg-violet-500/15' : ''
              }`}
            >
              <span className="flex-1 truncate text-white">{c.display_name || 'Member'}</span>
              <span className="text-slate-400">{roleLabel(c.cid_role)}{c.cid_bureau ? ` · ${c.cid_bureau}` : ''}</span>
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="SIU role">
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
        title="SIU activity"
        subtitle="Appointments, classifications, assignments and compartment changes. Case-keyed entries appear only for investigations you are cleared for — the subject of an investigation never sees its trail."
      />
      {!rows.length ? (
        <p className="mt-3 text-xs text-slate-400">No SIU activity recorded yet.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-2 border-t border-white/5 py-1.5 text-xs">
              <span className="w-36 shrink-0 text-[10px] text-slate-400">{fmtWhen(r.created_at)}</span>
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
