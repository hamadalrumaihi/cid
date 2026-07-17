'use client'

/** Division Analytics — command-level trends over the live data: cases opened
 *  vs closed per week, clearance & time-to-close, open-case workload per
 *  detective, evidence logged per week. Hand-rolled SVG charts (no chart
 *  dependency), dark-surface palette validated for CVD/contrast
 *  (#3b82f6 opened / #059669 closed; single-series charts use the blue).
 *  Close dates are approximated by a closed case's last update. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'

type CaseRow = Tables<'cases'>
type EvidenceRow = Tables<'evidence'>
type PersonRow = Tables<'persons'>

const OPENED = '#3b82f6'
const CLOSED = '#059669'
const GRID = '#1b2940'
const WEEKS = 12
const CLOSED_STATES = new Set(['closed'])
const isOpenCase = (c: CaseRow) => !CLOSED_STATES.has(String(c.status)) && String(c.status) !== 'cold'

interface Tip { x: number; y: number; lines: string[] }

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-900/60 px-4 py-3">
      <p className="t-readout text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  )
}

function Panel({ title, legend, children }: { title: string; legend?: [string, string][]; children: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black uppercase tracking-wide text-slate-100">{title}</h3>
        {legend && (
          <div className="flex gap-3">
            {legend.map(([name, color]) => (
              <span key={name} className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} /> {name}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </Card>
  )
}

/** Bar with a rounded top anchored to the baseline (4px cap, min visible height). */
function bar(x: number, yTop: number, w: number, yBase: number, r = 3): string {
  const h = Math.max(yBase - yTop, 0)
  if (h <= 0.5) return `M${x},${yBase} h${w} v-1 h${-w} Z`
  const rr = Math.min(r, w / 2, h)
  return `M${x},${yBase} v${-(h - rr)} q0,${-rr} ${rr},${-rr} h${w - 2 * rr} q${rr},0 ${rr},${rr} v${h - rr} Z`
}

export function AnalyticsView() {
  const { state } = useAuth()
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [data, setData] = useState<{ cases: CaseRow[]; evidence: EvidenceRow[]; persons: PersonRow[] } | null>(null)
  const [loadedAt, setLoadedAt] = useState(0)
  const [tip, setTip] = useState<Tip | null>(null)
  const vCases = useTableVersion('cases')
  const vEvidence = useTableVersion('evidence')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    void fetchProfiles()
    const [cases, evidence, persons] = await Promise.all([
      list('cases', {}).catch(() => [] as CaseRow[]),
      list('evidence', {}).catch(() => [] as EvidenceRow[]),
      list('persons', {}).catch(() => [] as PersonRow[]),
    ])
    setData({ cases, evidence, persons })
    setLoadedAt(Date.now())
  }, [state, fetchProfiles])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vCases, vEvidence])

  const m = useMemo(() => {
    if (!data || !loadedAt) return null
    // Monday-start week buckets, oldest → newest.
    const anchor = new Date(loadedAt)
    anchor.setHours(0, 0, 0, 0)
    anchor.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7))
    const weeks = Array.from({ length: WEEKS }, (_, i) => anchor.getTime() - (WEEKS - 1 - i) * 7 * 86400000)
    const bucket = (ts: string | null | undefined): number => {
      if (!ts) return -1
      const t = Date.parse(ts)
      const i = Math.floor((t - weeks[0]) / (7 * 86400000))
      return i >= 0 && i < WEEKS ? i : -1
    }
    const opened = new Array<number>(WEEKS).fill(0)
    const closed = new Array<number>(WEEKS).fill(0)
    const evid = new Array<number>(WEEKS).fill(0)
    let closedCount = 0
    let daysToCloseSum = 0
    const workload: Record<string, number> = {}
    for (const c of data.cases) {
      const bi = bucket(c.created_at)
      if (bi >= 0) opened[bi]++
      if (CLOSED_STATES.has(String(c.status))) {
        closedCount++
        daysToCloseSum += Math.max(0, (Date.parse(c.updated_at) - Date.parse(c.created_at)) / 86400000)
        const bj = bucket(c.updated_at)
        if (bj >= 0) closed[bj]++
      } else if (isOpenCase(c)) {
        const who = officerName(c.lead_detective_id) || 'Unassigned'
        workload[who] = (workload[who] ?? 0) + 1
      }
    }
    for (const e of data.evidence) {
      const bi = bucket(e.created_at)
      if (bi >= 0) evid[bi]++
    }
    const openNow = data.cases.filter(isOpenCase).length
    const total = data.cases.length
    const week = (i: number) => new Date(weeks[i]).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
    return {
      weeks, weekLabel: week, opened, closed, evid,
      openNow,
      clearance: total ? Math.round((closedCount / total) * 100) : 0,
      avgClose: closedCount ? Math.round(daysToCloseSum / closedCount) : 0,
      bolos: data.persons.filter((p) => p.bolo).length,
      workload: Object.entries(workload).sort((a, b) => b[1] - a[1]).slice(0, 8),
    }
  }, [data, loadedAt])

  if (state !== 'in') return <Notice text="Sign in to view division analytics." />
  if (!m) return <Notice text="Crunching the numbers…" />

  // ---- chart geometry (shared) -------------------------------------------
  const W = 560, H = 190, PX = 30, PT = 12, PB = 22
  const plotW = W - PX * 2, plotH = H - PT - PB
  const maxPair = Math.max(...m.opened, ...m.closed, 1)
  const maxEv = Math.max(...m.evid, 1)
  const yFor = (v: number, vmax: number) => PT + plotH - (v / vmax) * plotH
  const slot = plotW / WEEKS
  const bw = Math.max((slot - 10) / 2, 4) // two bars + 2px inner gap + margins
  const gridLines = [0.25, 0.5, 0.75, 1]
  const showTip = (e: React.MouseEvent, lines: string[]) => {
    const host = (e.currentTarget as Element).closest('[data-chart]')?.getBoundingClientRect()
    if (!host) return
    setTip({ x: e.clientX - host.left, y: e.clientY - host.top - 8, lines })
  }
  const maxLoad = Math.max(...m.workload.map(([, n]) => n), 1)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Open cases" value={String(m.openNow)} sub="active + investigating" />
        <Tile label="Clearance rate" value={`${m.clearance}%`} sub="closed of all cases" />
        <Tile label="Avg days to close" value={String(m.avgClose)} sub="opened → last update" />
        <Tile label="Active BOLOs" value={String(m.bolos)} sub="at-large subjects" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={`Cases opened vs closed — last ${WEEKS} weeks`} legend={[['Opened', OPENED], ['Closed', CLOSED]]}>
          <div data-chart className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Cases opened versus closed per week">
              {gridLines.map((g) => (
                <g key={g}>
                  <line x1={PX} x2={W - PX} y1={yFor(maxPair * g, maxPair)} y2={yFor(maxPair * g, maxPair)} stroke={GRID} strokeWidth={1} />
                  <text x={PX - 4} y={yFor(maxPair * g, maxPair) + 3} textAnchor="end" fontSize={9} fill="#64748b">{Math.round(maxPair * g)}</text>
                </g>
              ))}
              {m.opened.map((v, i) => {
                const x0 = PX + i * slot + (slot - (bw * 2 + 2)) / 2
                const c = m.closed[i]
                const label = `${m.weekLabel(i)} — opened ${v}, closed ${c}`
                return (
                  <g key={i} onMouseEnter={(e) => showTip(e, [`Week of ${m.weekLabel(i)}`, `Opened ${v}`, `Closed ${c}`])} onMouseLeave={() => setTip(null)}>
                    {/* invisible full-slot hit target */}
                    <rect x={PX + i * slot} y={PT} width={slot} height={plotH} fill="transparent"><title>{label}</title></rect>
                    <path d={bar(x0, yFor(v, maxPair), bw, PT + plotH)} fill={OPENED} />
                    <path d={bar(x0 + bw + 2, yFor(c, maxPair), bw, PT + plotH)} fill={CLOSED} />
                    {i % 2 === 0 && <text x={PX + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="#64748b">{m.weekLabel(i)}</text>}
                  </g>
                )
              })}
              <line x1={PX} x2={W - PX} y1={PT + plotH} y2={PT + plotH} stroke="#26385a" strokeWidth={1} />
            </svg>
            {tip && <ChartTip tip={tip} />}
          </div>
        </Panel>

        <Panel title={`Evidence logged — last ${WEEKS} weeks`}>
          <div data-chart className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Evidence items logged per week">
              {gridLines.map((g) => (
                <g key={g}>
                  <line x1={PX} x2={W - PX} y1={yFor(maxEv * g, maxEv)} y2={yFor(maxEv * g, maxEv)} stroke={GRID} strokeWidth={1} />
                  <text x={PX - 4} y={yFor(maxEv * g, maxEv) + 3} textAnchor="end" fontSize={9} fill="#64748b">{Math.round(maxEv * g)}</text>
                </g>
              ))}
              <polyline
                points={m.evid.map((v, i) => `${PX + i * slot + slot / 2},${yFor(v, maxEv)}`).join(' ')}
                fill="none" stroke={OPENED} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
              />
              {m.evid.map((v, i) => (
                <g key={i} onMouseEnter={(e) => showTip(e, [`Week of ${m.weekLabel(i)}`, `${v} item${v === 1 ? '' : 's'} logged`])} onMouseLeave={() => setTip(null)}>
                  <rect x={PX + i * slot} y={PT} width={slot} height={plotH} fill="transparent" />
                  <circle cx={PX + i * slot + slot / 2} cy={yFor(v, maxEv)} r={3} fill={OPENED} stroke="#0b1220" strokeWidth={2} />
                  {i % 2 === 0 && <text x={PX + i * slot + slot / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="#64748b">{m.weekLabel(i)}</text>}
                </g>
              ))}
              <line x1={PX} x2={W - PX} y1={PT + plotH} y2={PT + plotH} stroke="#26385a" strokeWidth={1} />
            </svg>
            {tip && <ChartTip tip={tip} />}
          </div>
        </Panel>
      </div>

      <Panel title="Open-case workload per detective">
        {m.workload.length ? (
          <div className="space-y-2">
            {m.workload.map(([who, n]) => (
              <div key={who} className="flex items-center gap-3">
                <span className="w-40 truncate text-right text-xs text-slate-300">{who}</span>
                <div className="h-4 flex-1 overflow-hidden rounded-r bg-ink-950/60">
                  <div className="h-full rounded-r" style={{ width: `${(n / maxLoad) * 100}%`, background: OPENED }} />
                </div>
                <span className="w-8 text-xs font-black text-slate-200">{n}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No open cases assigned right now.</p>
        )}
      </Panel>

      <p className="text-[11px] text-slate-500">
        Live — covers the cases you can access. &ldquo;Closed&rdquo; weeks use the
        case&rsquo;s last update as the close date. Weeks start Monday.
      </p>
    </div>
  )
}

function ChartTip({ tip }: { tip: Tip }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-white/10 bg-ink-950/95 px-2.5 py-1.5 shadow-xl"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.lines.map((l, i) => (
        <p key={i} className={i === 0 ? 'text-[10px] font-black uppercase tracking-wider text-slate-400' : 'text-xs font-semibold text-white'}>{l}</p>
      ))}
    </div>
  )
}


