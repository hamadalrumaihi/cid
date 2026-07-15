'use client'

/** Central Command dashboard — port of vanilla command.js (§5). Everything
 *  derives from RLS-scoped reads; the transient command filters scope the
 *  KPIs/caseload/drill, while the scorecards and attention widget stay
 *  standing views over the unfiltered cache. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { list, withRetry } from '@/lib/db'
import { fmtUSD } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { statusTint } from '@/lib/tint'
import { ActivityFeed } from './ActivityFeed'
import { Analytics } from './Analytics'
import { AttentionWidget } from './AttentionWidget'
import { Encourage } from './Encourage'
import { JumpBack } from './JumpBack'
import { RaidComp } from './RaidComp'
import { TicketQueue } from './TicketQueue'
import { Trackers } from './Trackers'
import { Card } from '@/components/ui/Card'
import {
  EMPTY_CMD_FILTERS, avgResolutionDays, bureauScore, cmdFilterActive, cmdMatch, fmtAvgDays,
  reEvNarc, reEvWeapon, type CaseRow, type CmdFilters,
} from './commandUtils'

type PersonRow = Tables<'persons'>
type GangRow = Tables<'gangs'>
type EvidenceRow = Tables<'evidence'>
type RaidRow = Tables<'raid_compensations'>

interface CmdData {
  cases: CaseRow[]
  raids: RaidRow[]
  evidence: EvidenceRow[]
  persons: PersonRow[]
  gangs: GangRow[]
}
const EMPTY: CmdData = { cases: [], raids: [], evidence: [], persons: [], gangs: [] }

/* ---- KPI vocabulary (command.js:9, T_ICONS core.js:1134) ------------------ */
const KPI_ACCENTS: Record<string, string> = {
  blue: 'from-blue-500/20 to-blue-700/5 text-blue-300 border-blue-500/20',
  slate: 'from-slate-500/20 to-slate-700/5 text-slate-300 border-slate-500/20',
  violet: 'from-violet-500/20 to-violet-700/5 text-violet-300 border-violet-500/20',
  emerald: 'from-emerald-500/20 to-emerald-700/5 text-emerald-300 border-emerald-500/20',
  amber: 'from-amber-500/20 to-amber-700/5 text-amber-300 border-amber-500/20',
  rose: 'from-rose-500/20 to-rose-700/5 text-rose-300 border-rose-500/20',
  cyan: 'from-cyan-500/20 to-cyan-700/5 text-cyan-300 border-cyan-500/20',
}

const KPI_ICON_PATHS: Record<string, React.ReactNode> = {
  folder: <path d="M3 7.5a2 2 0 0 1 2-2h4.2l1.8 2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  pen: <path d="M4.5 19.5l3.8-.9L19.5 7.4l-2.9-2.9L5.4 15.7z" />,
  scale: <><path d="M12 4.5v15M6.5 6.5h11" /><path d="M6.5 6.5l-2.5 5.5a3 3 0 0 0 5 0zM17.5 6.5L15 12a3 3 0 0 0 5 0z" /></>,
  timer: <><circle cx="12" cy="13" r="7.5" /><path d="M12 9.5V13l2.5 2M9.5 3.5h5" /></>,
  cold: <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />,
  cash: <><rect x="3" y="7" width="18" height="10" rx="1" /><circle cx="12" cy="12" r="2.6" /></>,
  capsule: <><rect x="3.5" y="8.5" width="17" height="7" rx="3.5" /><path d="M12 8.5v7" /></>,
  crosshair: <><circle cx="12" cy="12" r="7" /><path d="M12 3.5V7M12 17v3.5M3.5 12H7M17 12h3.5" /></>,
  users: <><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19c1-2.8 3-4.2 5.5-4.2s4.5 1.4 5.5 4.2" /><circle cx="16.5" cy="9.5" r="2.4" /><path d="M16.8 14.6c2 .3 3.3 1.6 4 3.9" /></>,
}

const KpiIcon = ({ name }: { name: string }) => (
  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    {KPI_ICON_PATHS[name]}
  </svg>
)

/** Tactical zero-state: a flat 0 reads as "00 // STANDBY" so an idle metric
 *  still reads as a deliberate system state, not missing data. */
const Standby = () => (
  <>00<span className="t-readout ml-1 text-xs font-semibold text-slate-600">{'// STANDBY'}</span></>
)
const tVal = (v: number): React.ReactNode => (v === 0 ? <Standby /> : String(v))

const BUREAU_KEYS = ['LSB', 'BCB', 'SAB', 'JTF'] as const
const BUREAU_FULL_NAMES: Record<string, string> = {
  LSB: 'Los Santos Bureau', BCB: 'Blaine County Bureau', SAB: 'State Bureau', JTF: 'Joint Task Force',
}
const BUREAU_BAR_COLORS: Record<string, string> = {
  LSB: 'bg-blue-500', BCB: 'bg-emerald-500', SAB: 'bg-violet-500', JTF: 'bg-amber-500',
}

const drillStatusPill = (c: CaseRow) => {
  const s = /^awaiting_/.test(c.signoff_status || '') ? 'awaiting'
    : c.signoff_status === 'ready_doj' || c.signoff_status === 'approved_complete' ? 'DOJ-ready'
    : c.status
  // Shared statusTint keeps this pill aligned with the case-board columns —
  // it had silently drifted (open showed blue here, amber on the board).
  return <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${statusTint(s)}`}>{s}</span>
}

export function CommandView() {
  const router = useRouter()
  const { profile, state, isCommand } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [data, setData] = useState<CmdData>(EMPTY)
  const [filters, setFilters] = useState<CmdFilters>(EMPTY_CMD_FILTERS)

  const vCases = useTableVersion('cases')
  const vEvidence = useTableVersion('evidence')
  const vRaids = useTableVersion('raid_compensations')
  const vPersons = useTableVersion('persons')

  const live = state === 'in'

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    try {
      // Optional caches degrade to [] individually (vanilla fetchKpis wraps
      // them in try/catch) — a denied/failed side-read never blanks the KPIs.
      const [cases, raids, evidence, persons, gangs] = await Promise.all([
        withRetry(() => list('cases', {})),
        list('raid_compensations', {}).catch(() => [] as RaidRow[]),
        list('evidence', {}).catch(() => [] as EvidenceRow[]),
        list('persons', {}).catch(() => [] as PersonRow[]),
        list('gangs', {}).catch(() => [] as GangRow[]),
      ])
      setData({ cases, raids, evidence, persons, gangs })
    } catch { /* cases read failed (transient) — keep the previous dashboard */ }
  }, [state])

  useEffect(() => {
    const id = window.setTimeout(() => { void fetchProfiles(); void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [fetchProfiles, refresh, vCases, vEvidence, vRaids, vPersons])

  // KPI-card drill applies to every signed-in member (vanilla setCmdStatus);
  // only the filter BAR below is command-gated.
  const scoped = cmdFilterActive(filters)
  const filtered = useMemo(() => data.cases.filter((c) => cmdMatch(c, filters)), [data.cases, filters])

  /** KPI-card drill: clicking a card toggles the matching status filter. */
  const setStatus = (s: string) => setFilters((f) => ({ ...f, status: f.status === s ? '' : s }))

  const kpis = useMemo(() => {
    const caseIds = new Set(filtered.map((c) => c.id))
    const open = filtered.filter((c) => c.status === 'open' || c.status === 'active').length
    const cold = filtered.filter((c) => c.status === 'cold').length
    const awaiting = filtered.filter((c) => /^awaiting_/.test(c.signoff_status || '')).length
    const readyDoj = filtered.filter((c) => c.signoff_status === 'ready_doj' || c.signoff_status === 'approved_complete').length
    const seiz = (scoped ? data.raids.filter((r) => r.case_id && caseIds.has(r.case_id)) : data.raids)
      .reduce((a, b) => a + (Number(b.net_value) || 0), 0)
    const ev = scoped ? data.evidence.filter((e) => e.case_id && caseIds.has(e.case_id)) : data.evidence
    const weapons = ev.filter((e) => reEvWeapon.test(e.type || '') || reEvWeapon.test(e.description || '')).length
    const narcs = ev.filter((e) => reEvNarc.test(e.type || '') || reEvNarc.test(e.description || '')).length
    const avg = avgResolutionDays(filtered)
    const flagged = data.persons.filter((p) => (p.felony_count || 0) >= 8).length
    return [
      { label: 'Open Cases', value: tVal(open), delta: `${filtered.length} ${scoped ? 'in filter' : 'total on file'}`, icon: 'folder', accent: 'blue', go: () => setStatus('open_active') },
      { label: 'Awaiting Sign-off', value: tVal(awaiting), delta: 'stuck in the approval chain', icon: 'pen', accent: 'amber', go: () => setStatus('awaiting') },
      { label: 'Ready for DOJ', value: tVal(readyDoj), delta: 'approved & complete', icon: 'scale', accent: 'emerald', go: () => setStatus('ready_doj') },
      { label: 'Avg Resolution', value: avg == null ? <span className="t-readout text-slate-500">--</span> : fmtAvgDays(avg), delta: avg == null ? 'no closed cases yet' : 'open → closed', icon: 'timer', accent: 'cyan' },
      { label: 'Cold Cases', value: tVal(cold), delta: '2-week inactivity policy', icon: 'cold', accent: 'slate', go: () => setStatus('cold') },
      { label: 'Seizures (money)', value: seiz === 0 ? tVal(0) : fmtUSD(seiz), delta: 'logged raid compensation', icon: 'cash', accent: 'emerald' },
      { label: 'Narcotics Seized', value: tVal(narcs), delta: 'evidence items logged', icon: 'capsule', accent: 'violet' },
      { label: 'Weapons Seized', value: tVal(weapons), delta: 'evidence items logged', icon: 'crosshair', accent: 'rose' },
      { label: 'Persons of Interest', value: tVal(data.persons.length), delta: `${flagged} ≥8-felony flagged`, icon: 'users', accent: 'violet' },
    ]
  }, [filtered, scoped, data.raids, data.evidence, data.persons])

  const detectives = useMemo(
    () => profiles.filter((p) => p.active).slice().sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '')),
    [profiles],
  )

  const bureauCounts = useMemo(() => {
    const counts: Record<string, number> = { LSB: 0, BCB: 0, SAB: 0, JTF: 0 }
    filtered.forEach((c) => { if (counts[c.bureau] != null) counts[c.bureau]++ })
    return counts
  }, [filtered])
  const bureauMax = Math.max(1, ...BUREAU_KEYS.map((k) => bureauCounts[k]))

  // Director/deputy see all bureaus; a bureau lead sees only their own
  // (profiles use `division`, not `bureau`). Standing view — unfiltered cache.
  const scorecardKeys = isCommand
    ? (profile?.role === 'bureau_lead' && profile.division ? [profile.division] : [...BUREAU_KEYS])
    : []

  const openCase = (id: string) => router.push(`/cases?case=${encodeURIComponent(id)}`)
  const drillCases = useMemo(
    () => (scoped ? filtered.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) : []),
    [scoped, filtered],
  )

  return (
    <section className="view-in space-y-4">
      <Encourage />
      {live && <JumpBack cases={data.cases} />}
      {live && <AttentionWidget cases={data.cases} onDrillAwaiting={() => setStatus('awaiting')} />}

      {/* Command filters (#17): scope KPIs & caseload by bureau/detective/status/date */}
      {isCommand && (
        <Card pad="sm" className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Bureau</label>
            <select value={filters.bureau} onChange={(e) => setFilters((f) => ({ ...f, bureau: e.target.value }))} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">
              <option value="">All bureaus</option>
              {BUREAU_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Detective</label>
            <select value={filters.detective} onChange={(e) => setFilters((f) => ({ ...f, detective: e.target.value }))} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">
              <option value="">All detectives</option>
              {detectives.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Status</label>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">
              <option value="">Any status</option>
              <option value="open">Open</option><option value="active">Active</option>
              <option value="cold">Cold</option><option value="closed">Closed</option>
              <option value="awaiting">Awaiting sign-off</option><option value="ready_doj">Ready for DOJ</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">From</label>
            <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">To</label>
            <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
          </div>
          <button onClick={() => setFilters(EMPTY_CMD_FILTERS)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10">Reset</button>
          <span className="ml-auto text-xs text-slate-500">{scoped ? `${filtered.length} of ${data.cases.length} cases` : ''}</span>
        </Card>
      )}

      {/* KPI grid — compact tiles; drill behavior unchanged */}
      <div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Division vitals</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {kpis.map((m) => (
            <div
              key={m.label}
              onClick={m.go && live ? m.go : undefined}
              className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${KPI_ACCENTS[m.accent]} p-4 transition hover:shadow-glow${m.go && live ? ' cursor-pointer hover:brightness-110' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{m.label}</p>
                  <p className="mt-1.5 text-2xl font-bold text-white">{live ? m.value : '—'}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">{m.delta}</p>
                </div>
                <span className="text-slate-500"><KpiIcon name={m.icon} /></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Drill: matching cases while a filter is active */}
      {live && scoped && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Matching cases</h3>
            <span className="text-[11px] text-slate-500">{drillCases.length} result{drillCases.length === 1 ? '' : 's'}</span>
          </div>
          {drillCases.length ? (
            <div className="space-y-2">
              {drillCases.slice(0, 40).map((c) => (
                <button key={c.id} onClick={() => openCase(c.id)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900 px-4 py-2.5 text-left transition hover:border-blue-500/30 hover:bg-white/5">
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-xs text-blue-300">{c.case_number}</span>{' '}
                    <span className="text-sm text-slate-200">{c.title || ''}</span>
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-2">
                    <span className="text-[11px] text-slate-500">{c.bureau}</span>
                    {drillStatusPill(c)}
                  </span>
                </button>
              ))}
              {drillCases.length > 40 && <p className="mt-2 text-center text-[11px] text-slate-500">Showing first 40.</p>}
            </div>
          ) : <p className="text-sm text-slate-500">No cases match the current filters.</p>}
        </Card>
      )}

      {/* Bureau performance scorecards (Wave 3) — command only */}
      {live && scorecardKeys.length > 0 && (
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Bureau scorecards</h3>
            <span className="text-[11px] text-slate-500">{profile?.role === 'bureau_lead' ? 'your bureau' : 'all bureaus'} · performance</span>
          </div>
          <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2${scorecardKeys.length > 2 ? ' xl:grid-cols-4' : ''}`}>
            {scorecardKeys.map((k) => {
              const s = bureauScore(data.cases.filter((c) => c.bureau === k))
              const clr = s.clearance == null ? '—' : `${s.clearance}%`
              const clrTint = s.clearance == null ? 'text-slate-400' : s.clearance >= 60 ? 'text-emerald-300' : s.clearance >= 30 ? 'text-amber-300' : 'text-rose-300'
              return (
                <Card key={k} pad="sm">
                  <p className="text-sm font-bold text-white">{BUREAU_FULL_NAMES[k] || k}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">{s.total} case{s.total === 1 ? '' : 's'} on file</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <div><p className="text-2xl font-bold text-white">{s.open}</p><p className="text-[10px] uppercase tracking-wider text-slate-500">Active load</p></div>
                    <div><p className={`text-2xl font-bold ${clrTint}`}>{clr}</p><p className="text-[10px] uppercase tracking-wider text-slate-500">Clearance</p></div>
                    <div><p className="text-2xl font-bold text-white">{fmtAvgDays(s.avg)}</p><p className="text-[10px] uppercase tracking-wider text-slate-500">Avg close</p></div>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* Crime analytics — collapsible so the dashboard scans; nothing removed.
          The dedicated Analytics tab keeps the full trend charts. */}
      {live && (data.cases.length > 0 || data.persons.length > 0) && (
        <details open className="group rounded-2xl border border-white/5 bg-ink-900/40 p-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-xs text-slate-500 group-open:hidden">▸</span>
            <span aria-hidden className="hidden text-xs text-slate-500 group-open:inline">▾</span>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">📈 Crime Analytics</h3>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); router.push('/analytics') }}
              className="ml-auto flex-shrink-0 text-xs font-bold text-badge-200 hover:text-white"
            >
              Full analytics →
            </button>
          </summary>
          <div className="mt-4"><Analytics cases={data.cases} persons={data.persons} gangs={data.gangs} evidence={data.evidence} /></div>
        </details>
      )}

      <TicketQueue cases={data.cases} onCaseCreated={() => void refresh()} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card pad="lg" className="lg:col-span-2">
          <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-white"><span aria-hidden="true">🛰️</span> Division Activity Feed</h3>
          {live ? <ActivityFeed /> : <p className="text-sm text-slate-500">Sign in to view the division activity feed.</p>}
        </Card>
        <Card pad="lg">
          <h3 className="mb-4 flex items-center gap-2 text-base font-semibold text-white"><span aria-hidden="true">🏛️</span> Bureau Caseload</h3>
          <div className="space-y-5">
            {BUREAU_KEYS.map((k) => (
              <div
                key={k}
                onClick={isCommand ? () => setFilters((f) => ({ ...f, bureau: f.bureau === k ? '' : k })) : undefined}
                title={isCommand ? `Filter to ${BUREAU_FULL_NAMES[k]}` : undefined}
                className={isCommand ? 'cursor-pointer' : undefined}
              >
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className={`font-medium ${filters.bureau === k ? 'text-white' : 'text-slate-300'}`}>
                    {BUREAU_FULL_NAMES[k]}{filters.bureau === k ? ' ✓' : ''}
                  </span>
                  <span className="font-mono text-slate-400">{bureauCounts[k]} case{bureauCounts[k] === 1 ? '' : 's'}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-ink-800">
                  <div className={`h-full ${BUREAU_BAR_COLORS[k]} transition-all duration-700`} style={{ width: `${Math.round((bureauCounts[k] / bureauMax) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Trackers cases={data.cases} />
        <RaidComp />
      </div>
    </section>
  )
}
