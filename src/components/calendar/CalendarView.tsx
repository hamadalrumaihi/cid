'use client'

/** Division Calendar — flowintel-inspired month view of everything with a
 *  date: case follow-ups, open task deadlines, legal-request deadlines
 *  (response due / expiry) and shift-report weeks. Read-only aggregation;
 *  RLS scopes every source to what the viewer can see (a denied legal read
 *  simply contributes nothing). Click a day for its items with deep links. */
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { todayISO } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'

type CaseRow = Tables<'cases'>
type TaskRow = Tables<'case_tasks'>
type ShiftRow = Tables<'shift_reports'>
type LegalRow = Tables<'legal_requests'>

/** Slim legal projection — the calendar only needs identity + the two
 *  deadline timestamps, never form_data/narrative. */
const LEGAL_COLS = 'id,request_number,title,review_status,fulfilment_status,response_deadline,expires_at'
/** States whose deadlines no longer bind — mirrors legalShared's DeadlineChip
 *  (live requests warn; resolved records keep a quiet history). */
const LEGAL_DONE_FULFILMENT = new Set(['closed', 'returned', 'return_recorded', 'revoked'])
const LEGAL_DONE_REVIEW = new Set(['denied', 'withdrawn', 'closed'])

interface DayItem {
  key: string
  icon: string
  label: string
  sub: string
  href: string
  tone: 'amber' | 'blue' | 'rose' | 'slate'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

export function CalendarView() {
  const { state } = useAuth()
  const [data, setData] = useState<{ cases: CaseRow[]; tasks: TaskRow[]; shifts: ShiftRow[]; legal: LegalRow[] }>({ cases: [], tasks: [], shifts: [], legal: [] })
  const [loading, setLoading] = useState(true)
  // {y, m} of the displayed month; seeded from the client clock in an effect
  // (never during render) so prerender stays deterministic.
  const [month, setMonth] = useState<{ y: number; m: number } | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const vCases = useTableVersion('cases')
  const vTasks = useTableVersion('case_tasks')
  const vShifts = useTableVersion('shift_reports')
  const vLegal = useTableVersion('legal_requests')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    try {
      const [cases, tasks, shifts, legal] = await Promise.all([
        list('cases', {}).catch(() => [] as CaseRow[]),
        list('case_tasks', {}).catch(() => [] as TaskRow[]),
        list('shift_reports', {}).catch(() => [] as ShiftRow[]),
        // Fail-closed: only rows RLS returns; a denied read shows nothing.
        list('legal_requests', { select: LEGAL_COLS }).catch(() => [] as LegalRow[]),
      ])
      setData({ cases, tasks, shifts, legal })
    } finally { setLoading(false) }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => {
      const now = new Date()
      setMonth((m) => m ?? { y: now.getFullYear(), m: now.getMonth() })
      void refresh()
    }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vCases, vTasks, vShifts, vLegal])

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
    // Legal deadlines are read-only entries deep-linking into the request;
    // resolved requests keep a quiet history and stay off the calendar.
    for (const lr of data.legal) {
      if (LEGAL_DONE_FULFILMENT.has(lr.fulfilment_status) || LEGAL_DONE_REVIEW.has(lr.review_status)) continue
      const href = `/legal?request=${encodeURIComponent(lr.id)}`
      if (lr.response_deadline) push(lr.response_deadline, { icon: '⚖️', label: `${lr.request_number} response due`, sub: lr.title, href, tone: 'rose' })
      if (lr.expires_at) push(lr.expires_at, { icon: '⚖️', label: `${lr.request_number} expires`, sub: lr.title, href, tone: 'rose' })
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
  const tint: Record<DayItem['tone'], string> = { amber: 'bg-amber-500/15 text-amber-200', blue: 'bg-blue-500/15 text-blue-200', rose: 'bg-rose-500/15 text-rose-200', slate: 'bg-white/10 text-slate-300' }

  return (
    <div>
      <Card pad="sm" className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-black text-white">{MONTHS[month.m]} {month.y} <span className="ml-2 text-xs font-medium text-slate-400">{monthTotal} item{monthTotal === 1 ? '' : 's'}</span></h2>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => nav(-1)} aria-label="Previous month">←</Button>
          <Button size="sm" onClick={goToday}>Today</Button>
          <Button size="sm" onClick={() => nav(1)} aria-label="Next month">→</Button>
        </div>
      </Card>

      {loading && <Notice text="Loading calendar…" />}

      <Card pad="none" className="overflow-hidden">
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
      </Card>

      {sel && (byDay[sel]?.length ?? 0) > 0 && (
        <div className="mt-4 rounded-2xl border border-blue-500/20 bg-ink-900/70 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-100">{sel}{sel === today ? ' — today' : sel < today ? ' — past' : ''}</h3>
            <Button size="sm" className="-my-1" onClick={() => setSel(null)} aria-label="Close day details">✕</Button>
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
        📌 case follow-ups · ☑️ open task deadlines · ⚖️ legal-request deadlines · 📝 shift-report weeks. Scoped to records you can access; days in red have overdue items. Click a day for details.
      </p>
    </div>
  )
}
