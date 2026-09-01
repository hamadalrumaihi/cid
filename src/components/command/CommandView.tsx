'use client'

/** Division Overview — the member-facing division stats/tools page. Command
 *  operations moved to the Command Center (Phase-2B): the needs-attention
 *  widget, command filter bar + drill, bureau scorecards and caseload bars
 *  live there now (a banner points command staff across). What remains is the
 *  lean division picture every member gets: the case-vitals strip (each tile
 *  navigates to the surface that owns the number), crime analytics, trackers
 *  and raid compensation. Everything derives from RLS-scoped reads. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { list, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { Store } from '@/lib/store'
import { persistCaseFilters } from '@/components/cases/caseUtils'
import { ActivityFeed } from './ActivityFeed'
import { Analytics } from './Analytics'
import { Encourage } from './Encourage'
import { RaidComp } from './RaidComp'
import { Trackers } from './Trackers'
import { Card } from '@/components/ui/Card'
import type { CaseRow } from './commandUtils'

type PersonRow = Tables<'persons'>
type GangRow = Tables<'gangs'>
type EvidenceRow = Tables<'evidence'>

interface CmdData {
  cases: CaseRow[]
  evidence: EvidenceRow[]
  persons: PersonRow[]
  gangs: GangRow[]
}
const EMPTY: CmdData = { cases: [], evidence: [], persons: [], gangs: [] }

/* ---- KPI vocabulary (command.js:9, T_ICONS core.js:1134) ------------------
 * Flat case-jacket strip: the accent survives as the icon temperature only —
 * no gradients, no per-tile card chrome. Tiles now NAVIGATE (the in-page
 * drill went to the Command Center with the rest of the command tooling). */
const KPI_ACCENTS: Record<string, string> = {
  blue: 'text-blue-300',
  slate: 'text-slate-400',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
}

const KPI_ICON_PATHS: Record<string, React.ReactNode> = {
  folder: <path d="M3 7.5a2 2 0 0 1 2-2h4.2l1.8 2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  pen: <path d="M4.5 19.5l3.8-.9L19.5 7.4l-2.9-2.9L5.4 15.7z" />,
  scale: <><path d="M12 4.5v15M6.5 6.5h11" /><path d="M6.5 6.5l-2.5 5.5a3 3 0 0 0 5 0zM17.5 6.5L15 12a3 3 0 0 0 5 0z" /></>,
  cold: <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9" />,
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

export function CommandView() {
  const router = useRouter()
  const { state, isCommand, isOwner } = useAuth()
  const [data, setData] = useState<CmdData>(EMPTY)

  const vCases = useTableVersion('cases')
  const vEvidence = useTableVersion('evidence')
  const vPersons = useTableVersion('persons')

  const live = state === 'in'

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    try {
      // Optional caches degrade to [] individually (vanilla fetchKpis wraps
      // them in try/catch) — a denied/failed side-read never blanks the KPIs.
      const [cases, evidence, persons, gangs] = await Promise.all([
        withRetry(() => list('cases', {})),
        list('evidence', {}).catch(() => [] as EvidenceRow[]),
        list('persons', {}).catch(() => [] as PersonRow[]),
        list('gangs', {}).catch(() => [] as GangRow[]),
      ])
      setData({ cases, evidence, persons, gangs })
    } catch { /* cases read failed (transient) — keep the previous dashboard */ }
  }, [state])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, vCases, vEvidence, vPersons])

  /** Tile navigation: /cases with the persisted-filter mechanism where a list
   *  filter exists (cold), the sign-off lane of the Action Center where the
   *  pipeline lives, the full board otherwise. Scope forced to 'all' so the
   *  default 'mine' never empties a division-wide number. */
  const goCases = useCallback((status: string) => {
    Store.set('casesScope', 'all')
    persistCaseFilters({ bureau: '', status, assignee: '', stale: '' })
    router.push('/cases')
  }, [router])

  const kpis = useMemo(() => {
    const cs = data.cases
    const open = cs.filter((c) => c.status === 'open' || c.status === 'active').length
    const cold = cs.filter((c) => c.status === 'cold').length
    const awaiting = cs.filter((c) => /^awaiting_/.test(c.signoff_status || '')).length
    const readyDoj = cs.filter((c) => c.signoff_status === 'ready_doj' || c.signoff_status === 'approved_complete').length
    return [
      { label: 'Open Cases', value: tVal(open), delta: `${cs.length} total on file`, icon: 'folder', accent: 'blue', go: () => goCases(''), title: 'View the case board' },
      { label: 'Awaiting Sign-off', value: tVal(awaiting), delta: 'stuck in the approval chain', icon: 'pen', accent: 'amber', go: () => router.push('/action?f=signoff'), title: 'Open the sign-off queue' },
      { label: 'Ready for DOJ', value: tVal(readyDoj), delta: 'approved & complete', icon: 'scale', accent: 'emerald', go: () => goCases(''), title: 'View the case board' },
      { label: 'Cold Cases', value: tVal(cold), delta: '2-week inactivity policy', icon: 'cold', accent: 'slate', go: () => goCases('cold'), title: 'View cold cases' },
    ]
  }, [data.cases, goCases, router])

  return (
    <section className="view-in space-y-4">
      <Encourage />

      {/* Command tooling relocated (Phase-2B) — a pointer, not a duplicate. */}
      {live && (isCommand || isOwner) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-badge-500/20 bg-badge-500/5 px-4 py-2.5">
          <p className="text-sm text-slate-200">
            <span className="font-semibold text-white">Command tools have moved.</span>{' '}
            Queues, workload and approvals now live in the Command Center.
          </p>
          <Link href="/command-center" className="rounded text-sm font-bold text-badge-200 transition hover:text-white">
            Open Command Center →
          </Link>
        </div>
      )}

      {/* KPI strip — flat border-separated stat cells; tiles navigate */}
      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-white">Division vitals</h3>
        <div className="flex flex-wrap gap-px overflow-hidden rounded-lg border border-white/10 bg-white/5">
          {kpis.map((m) => {
            const body = (
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-500">{m.label}</p>
                  <p className="mt-0.5 text-lg font-bold leading-6 tabular-nums text-white">{live ? m.value : '—'}</p>
                  <p className="truncate text-[10px] text-slate-400">{m.delta}</p>
                </div>
                <span aria-hidden className={KPI_ACCENTS[m.accent]}><KpiIcon name={m.icon} /></span>
              </div>
            )
            const cell = 'min-h-[44px] min-w-0 flex-1 basis-48 bg-ink-900 px-3 py-2 text-left'
            return live ? (
              <button
                key={m.label}
                type="button"
                onClick={m.go}
                title={m.title}
                className={`${cell} transition hover:bg-ink-850 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-badge-500`}
              >
                {body}
              </button>
            ) : (
              <div key={m.label} className={cell}>{body}</div>
            )
          })}
        </div>
      </div>

      {/* Crime analytics — collapsible so the dashboard scans; nothing removed.
          The dedicated Analytics tab keeps the full trend charts. */}
      {live && (data.cases.length > 0 || data.persons.length > 0) && (
        <details open className="group rounded-lg border border-white/5 bg-ink-900/40 p-4">
          <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
            <span aria-hidden className="text-xs text-slate-500 group-open:hidden">▸</span>
            <span aria-hidden className="hidden text-xs text-slate-500 group-open:inline">▾</span>
            <h3 className="text-[13px] font-semibold text-white">Crime analytics</h3>
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

      {/* Division activity feed reads audit_log, which RLS seals to the Owner —
          rendered only there so nobody else stares at a permanently empty panel. */}
      {live && isOwner && (
        <Card pad="lg">
          <h3 className="mb-4 text-base font-semibold text-white">Division Activity Feed</h3>
          <ActivityFeed />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Trackers cases={data.cases} />
        <RaidComp />
      </div>
    </section>
  )
}
