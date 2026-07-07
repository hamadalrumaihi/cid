'use client'

/** Crime analytics (command.js:272-329) — stat tiles + single-hue magnitude
 *  bars over the RLS-scoped caches. One hue per chart (magnitude, not
 *  identity); values are direct-labeled. */
import type { Tables } from '@/lib/database.types'
import type { CaseRow } from './commandUtils'

type PersonRow = Tables<'persons'>
type GangRow = Tables<'gangs'>
type EvidenceRow = Tables<'evidence'>

const loggedWithin30d = (iso: string | null): boolean =>
  !!iso && Date.now() - Date.parse(iso) < 30 * 86400000

function Bar({ label, val, max, hue }: { label: string; val: number; max: number; hue: string }) {
  const pct = max ? Math.round((val / max) * 100) : 0
  return (
    <div className="flex items-center gap-3" title={`${label}: ${val}`}>
      <span className="w-32 flex-shrink-0 truncate text-xs text-slate-400">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-900">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: hue }} />
      </div>
      <span className="w-8 flex-shrink-0 text-right font-mono text-xs text-slate-200">{val}</span>
    </div>
  )
}

function Tile({ label, val, sub }: { label: string; val: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-5">
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{val}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-5">
      <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

export function Analytics({ cases, persons, gangs, evidence }: {
  cases: CaseRow[]
  persons: PersonRow[]
  gangs: GangRow[]
  evidence: EvidenceRow[]
}) {
  if (!cases.length && !persons.length) return null

  // Headlines.
  const closed = cases.filter((c) => c.status === 'closed').length
  const clearance = cases.length ? Math.round((closed / cases.length) * 100) : 0
  const openCases = cases.filter((c) => c.status === 'open' || c.status === 'active').length
  const bolos = persons.filter((p) => p.bolo).length
  const ev30 = evidence.filter((e) => loggedWithin30d(e.created_at)).length

  // Cases opened per month (last 6 calendar months; UTC month key like vanilla).
  const months: { key: string; label: string; n: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('en-US', { month: 'short' }), n: 0 })
  }
  cases.forEach((c) => {
    const m = months.find((x) => x.key === (c.created_at || '').slice(0, 7))
    if (m) m.n++
  })
  const mMax = months.reduce((a, m) => Math.max(a, m.n), 0)

  // Evidence by type (top 6).
  const byType: Record<string, number> = {}
  evidence.forEach((e) => { const t = (e.type || 'other').toLowerCase(); byType[t] = (byType[t] || 0) + 1 })
  const types = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const tMax = types.reduce((a, t) => Math.max(a, t[1]), 0)

  // Top gangs by tracked members (top 6).
  const byGang: Record<string, number> = {}
  persons.forEach((p) => { if (p.gang_id) byGang[p.gang_id] = (byGang[p.gang_id] || 0) + 1 })
  const topGangs = Object.entries(byGang)
    .map(([id, n]) => ({ name: gangs.find((g) => g.id === id)?.name || 'Unknown', n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
  const gMax = topGangs.reduce((a, g) => Math.max(a, g.n), 0)

  return (
    <div>
      <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">📈 Crime Analytics</h4>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Tile label="Clearance rate" val={`${clearance}%`} sub={`${closed} of ${cases.length} cases closed`} />
        <Tile label="Open cases" val={openCases} sub="open + active" />
        <Tile label="Active BOLOs" val={bolos} sub="flagged persons at large" />
        <Tile label="Evidence (30d)" val={ev30} sub="items logged this month" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Cases opened per month">
          {months.length ? months.map((m) => <Bar key={m.key} label={m.label} val={m.n} max={mMax} hue="#3b82f6" />) : <p className="text-xs text-slate-500">No data.</p>}
        </Panel>
        <Panel title="Evidence by type">
          {types.length ? types.map(([t, n]) => <Bar key={t} label={t} val={n} max={tMax} hue="#10b981" />) : <p className="text-xs text-slate-500">No evidence logged yet.</p>}
        </Panel>
        <Panel title="Top gangs by tracked members">
          {topGangs.length ? topGangs.map((g) => <Bar key={g.name} label={g.name} val={g.n} max={gMax} hue="#8b5cf6" />) : <p className="text-xs text-slate-500">No gang-linked persons yet.</p>}
        </Panel>
      </div>
    </div>
  )
}
