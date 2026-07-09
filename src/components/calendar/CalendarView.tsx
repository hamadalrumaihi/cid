'use client'

/** Division Calendar — flowintel-inspired month view of everything with a
 *  date: case follow-ups, open task deadlines, and shift-report weeks.
 *  Read-only aggregation; RLS scopes every source to what the viewer can
 *  see. Click a day for its items with deep links. */
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { todayISO } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { Notice } from '@/components/ui/Notice'

type CaseRow = Tables<'cases'>
type TaskRow = Tables<'case_tasks'>
type ShiftRow = Tables<'shift_reports'>

interface DayItem {
  key: string
  icon: string
  label: string
  sub: string
  href: string
  tone: 'amber' | 'blue' | 'slate'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export function CalendarView() {
  const { state } = useAuth()
  const [data, setData] = useState<{ cases: CaseRow[]; tasks: TaskRow[]; shifts: ShiftRow[] }>({ cases: [], tasks: [], shifts: [] })
  const [loading, setLoading] = useState(true)
  // {y, m} of the displayed month; seeded from the client clock in an effect
  // (never during render) so prerender stays deterministic.
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const vCases = useTableVersion('cases')
  const vTasks = useTableVersion('case_tasks')
  const vShifts = useTableVersion('shift_reports')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    try {
      const [cases, tasks, shifts] = await Promise.all([
        list('cases', {}).catch(() => [] as CaseRow[]),
        list('case_tasks', {}).catch(() => [] as TaskRow[]),
        list('shift_reports', {}).catch(() => [] as ShiftRow[]),
      ])
      setData({ cases, tasks, shifts })
    } finally { setLoading(false) }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => {
      const now = new Date()
      setMonth((m) => m ?? { y: now.getFullYear(), m: now.getMonth() })
      void refresh()
    }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vCases, vTasks, vShifts])

  const byDay = useMemo(() => {
    const map: Record<string, DayItem[]> = {}
    const push = (date: string | null | undefined, item: Omit<DayItem, 'key'>) => {
      const d = String(date ?? '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
      ;(map[d] = map[d] ?? []).push({ ...item, key: `${d}:${map[d]?.length ?? 0}` })
    }
    const caseById = new Map(data.cases.map((c) => [c.id, c]))
    for (const c of data.cases) {
      if (c.follow_up_at && c.status !== 'closed') {
        push(c.follow_up_at, { icon: '📌', label: `${c.case_number} follow-up`, sub: c.title || 'Untitled', href: `/cases?case=${encodeURIComponent(c.id)}`, tone: 'amber' })
      }
    }
    for (const t of data.tasks) {
      if (t.due && !t.done) {
        const c = caseById.get(t.case_id)
        push(t.due, { icon: '☑️', label: t.title, sub: c ? `${c.case_number} task` : 'Case task', href: c ? `/cases?case=${encodeURIComponent(c.id)}&tab=tasks` : '/cases', tone: 'blue' })
      }
    }
    for (const s of data.shifts) {
      push(s.week_start, { icon: '📝', label: `Shift report — ${s.author_name || 'Officer'}`, sub: `Week of ${s.week_start}`, href: '/shifts', tone: 'slate' })
    }
    return map
  }, [data])

  if (state !== 'in') return <Notice text="Sign in to view the division calendar." />
  if (!month) return <Notice text="Loading calendar…" />

  const today = todayISO()
  const first = new Date(month.y, month.m, 1)
  const daysInMonth = new Date(month.y, month.m + 1, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // Monday-first offset
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)

  const nav = (delta: number) => {
    setSel(null)
    setMonth((cur) => {
      if (!cur) return cur
      const d = new Date(cur.y, cur.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }
  const goToday = () => { setSel(null); setMonth({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }) }

  const monthTotal = Object.entries(byDay).filter(([d]) => d.startsWith(`${month.y}-${String(month.m + 1).padStart(2, '0')}-`)).reduce((n, [, v]) => n + v.length, 0)
  const tint: Record<DayItem['tone'], string> = { amber: 'bg-amber-500/15 text-amber-200', blue: 'bg-blue-500/15 text-blue-200', slate: 'bg-white/10 text-slate-300' }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-ink-900/60 p-4">
        <h2 className="text-lg font-black text-white">{MONTHS[month.m]} {month.y} <span className="ml-2 text-xs font-medium text-slate-400">{monthTotal} item{monthTotal === 1 ? '' : 's'}</span></h2>
        <div className="flex gap-2">
          <button onClick={() => nav(-1)} aria-label="Previous month" className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-bold text-slate-200 hover:bg-white/10">←</button>
          <button onClick={goToday} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-bold text-slate-200 hover:bg-white/10">Today</button>
          <button onClick={() => nav(1)} aria-label="Next month" className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-bold text-slate-200 hover:bg-white/10">→</button>
        </div>
      </div>

      {loading && <Notice text="Loading calendar…" />}

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60">
        <div className="grid grid-cols-7 border-b border-white/5">
          {DOW.map((d) => <div key={d} className="px-2 py-2 text-center text-[10px] font-black uppercase tracking-widest text-slate-500">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            if (day === null) return <div key={i} className="min-h-[4.5rem] border-b border-r border-white/5 bg-ink-950/40" />
            const date = iso(month.y, month.m, day)
            const items = byDay[date] ?? []
            const isToday = date === today
            const overdue = items.length > 0 && date < today && items.some((it) => it.tone !== 'slate')
            return (
              <button
                key={i}
                onClick={() => setSel(items.length ? date : null)}
                className={`min-h-[4.5rem] border-b border-r border-white/5 p-1.5 text-left align-top transition hover:bg-white/[0.04] ${sel === date ? 'bg-blue-500/10' : ''}`}
              >
                <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-xs font-black ${isToday ? 'bg-blue-500 text-white' : overdue ? 'text-rose-300' : 'text-slate-400'}`}>{day}</span>
                <span className="mt-1 block space-y-0.5">
                  {items.slice(0, 2).map((it) => (
                    <span key={it.key} className={`block truncate rounded px-1 py-0.5 text-[10px] font-semibold ${tint[it.tone]}`}>{it.icon} {it.label}</span>
                  ))}
                  {items.length > 2 && <span className="block px-1 text-[10px] font-bold text-slate-500">+{items.length - 2} more</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {sel && (byDay[sel]?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-2xl border border-blue-500/20 bg-ink-900/70 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-100">{sel}{sel === today ? ' — today' : sel < today ? ' — past' : ''}</h3>
            <button onClick={() => setSel(null)} aria-label="Close day details" className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold text-slate-300 hover:bg-white/10">✕</button>
          </div>
          <div className="space-y-1.5">
            {(byDay[sel] ?? []).map((it) => (
              <Link key={it.key} href={it.href} className="flex items-center gap-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-sm hover:border-blue-300/30">
                <span aria-hidden>{it.icon}</span>
                <span className="min-w-0 flex-1 truncate font-semibold text-white">{it.label}</span>
                <span className="truncate text-xs text-slate-400">{it.sub}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      <p className="mt-4 text-[11px] text-slate-400">
        📌 case follow-ups · ☑️ open task deadlines · 📝 shift-report weeks. Scoped to records you can access; days in red have overdue items. Click a day for details.
      </p>
    </div>
  )
}
