'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Json, Tables } from '@/lib/database.types'
import { list, update } from '@/lib/db'
import { todayISO, timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { ROLE_LABEL } from '@/lib/roles'
import { notifDetail, notifSub, notifTitle } from '@/lib/notifText'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { caseStaleDays, isStaleCase } from '@/components/cases/caseUtils'
import { StaleBadge } from '@/components/cases/StaleBadge'
import { caseStatusTint, signoffLabel, signoffTint } from '@/lib/signoff'
import { Store } from '@/lib/store'
import { toast } from '@/lib/toast'
import { markWatchSeen, type WatchType } from '@/lib/watchlist'
import { useJusticeRoster } from '@/lib/justiceRoster'
import { canReviewCase } from '@/components/command-center/lib/approvals'
import { PageHeader } from '@/components/ui/PageHeader'

type CaseRow = Tables<'cases'>
type TaskRow = Tables<'case_tasks'>
type MessageRow = Tables<'case_messages'>
type NotificationRow = Tables<'notifications'>
type ReportRow = Tables<'reports'>
type WatchRow = Tables<'watchlist'>
type PersonRow = Tables<'persons'>
type VehicleRow = Tables<'vehicles'>

interface InboxData {
  cases: CaseRow[]
  tasks: TaskRow[]
  messages: MessageRow[]
  notifications: NotificationRow[]
  reports: ReportRow[]
  watchlist: WatchRow[]
  persons: PersonRow[]
  vehicles: VehicleRow[]
}

const EMPTY: InboxData = { cases: [], tasks: [], messages: [], notifications: [], reports: [], watchlist: [], persons: [], vehicles: [] }

/** Followed target resolved against the desk caches — port of vanilla
 *  watchlist.js resolveWatchTarget/isWatchNew. Targets hidden by RLS (or
 *  deleted) resolve to nothing and are skipped, exactly like vanilla. */
interface WatchItem {
  w: WatchRow
  icon: string
  title: string
  sub: string
  ts: string | null
  href: string
  fresh: boolean
}

function resolveWatchItems(data: InboxData, seen: Record<string, string>): WatchItem[] {
  const items: WatchItem[] = []
  for (const w of data.watchlist) {
    let it: Omit<WatchItem, 'fresh' | 'w'> | null = null
    if (w.target_type === 'case') {
      const c = data.cases.find((x) => x.id === w.target_id)
      if (c) it = { icon: '🗂️', title: `${c.case_number} · ${c.title || 'Untitled'}`, sub: `${c.bureau} · ${c.status}`, ts: c.updated_at, href: caseHref(c.id) }
    } else if (w.target_type === 'person') {
      const p = data.persons.find((x) => x.id === w.target_id)
      if (p) it = { icon: '👤', title: p.name || 'Person', sub: [p.alias ? `“${p.alias}”` : '', p.status || ''].filter(Boolean).join(' · ') || 'Person of interest', ts: p.updated_at, href: `/persons?q=${encodeURIComponent(p.name ?? '')}` }
    } else if (w.target_type === 'vehicle') {
      const v = data.vehicles.find((x) => x.id === w.target_id)
      if (v) it = { icon: '🚗', title: v.plate, sub: [v.model, v.color].filter(Boolean).join(' · ') || 'Registered plate', ts: v.updated_at, href: `/vehicles?q=${encodeURIComponent(v.plate)}` }
    }
    if (!it) continue
    const stamp = seen[`${w.target_type}:${w.target_id}`]
    // No activity ts → nothing new; followed before the marker existed → new-ish.
    const fresh = !!it.ts && (!stamp || it.ts > stamp)
    items.push({ ...it, w, fresh })
  }
  items.sort((a, b) => Number(b.fresh) - Number(a.fresh) || String(b.ts ?? '').localeCompare(String(a.ts ?? '')))
  return items
}
const CLOSED_SIGNOFF = new Set(['none', 'ready_doj', 'approved_complete'])

const isJsonArray = (v: Json): v is Json[] => Array.isArray(v)

function jsonHasId(v: Json, id: string): boolean {
  if (!id) return false
  if (typeof v === 'string') return v === id
  if (isJsonArray(v)) return v.some((x) => jsonHasId(x, id))
  if (v && typeof v === 'object') return Object.values(v).some((x) => jsonHasId((x ?? null) as Json, id))
  return false
}

function isDue(date?: string | null): boolean {
  return !!date && date <= todayISO()
}

function daysUntil(date?: string | null): number | null {
  if (!date) return null
  const start = new Date(todayISO() + 'T00:00:00').getTime()
  const end = new Date(date + 'T00:00:00').getTime()
  return Math.round((end - start) / 86400000)
}

function caseHref(id: string): string {
  return `/cases?case=${encodeURIComponent(id)}`
}

function Stat({ label, value, tone = 'slate' }: { label: string; value: number; tone?: 'slate' | 'amber' | 'rose' | 'emerald' | 'blue' }) {
  const tint: Record<typeof tone, string> = {
    slate: 'border-white/10 bg-white/[0.03] text-slate-100',
    amber: 'border-amber-400/20 bg-amber-500/10 text-amber-100',
    rose: 'border-rose-400/20 bg-rose-500/10 text-rose-100',
    emerald: 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100',
    blue: 'border-blue-400/20 bg-blue-500/10 text-blue-100',
  }
  return (
    <div className={`rounded border px-3 py-2 ${tint[tone]}`}>
      <p className="t-readout text-[10px] uppercase tracking-widest opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  )
}

function EmptyLine({ text }: { text: string }) {
  return <p className="rounded border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-slate-500">{text}</p>
}

function CaseLine({ c, meta }: { c: CaseRow; meta?: React.ReactNode }) {
  return (
    <Link href={caseHref(c.id)} className="group block rounded border border-white/10 bg-white/[0.03] p-3 transition hover:border-amber-300/30 hover:bg-white/[0.06]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-black text-slate-100">{c.case_number}</span>
        <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase ${caseStatusTint(c.status)}`}>{c.status}</span>
        <span className="rounded border border-white/10 px-2 py-0.5 text-[10px] font-black text-slate-300">{c.bureau}</span>
        <StaleBadge c={c} />
      </div>
      <p className="mt-1 truncate text-sm font-bold text-white group-hover:text-amber-100">{c.title || 'Untitled case'}</p>
      <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
        <span>Lead: {officerName(c.lead_detective_id) || 'Unassigned'}</span>
        <span>Updated {timeAgo(c.updated_at)}</span>
        {meta}
      </div>
    </Link>
  )
}

function Panel({ title, count, action, children }: { title: string; count: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-white/10 bg-ink-900/55 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-100">{title}</h2>
        <span className="flex items-center gap-2">
          {action}
          <span className="rounded border border-white/10 px-2 py-0.5 text-xs font-black text-slate-300">{count}</span>
        </span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

export function InboxView() {
  const { profile, state, isCommand } = useAuth()
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const rosterProfiles = useProfilesStore((s) => s.profiles)
  const justiceByUser = useJusticeRoster((s) => s.byUser)
  const fetchJustice = useJusticeRoster((s) => s.fetch)
  const [data, setData] = useState<InboxData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // Bumped whenever a watchSeen stamp is written so `fresh` chips recompute.
  const [seenVer, setSeenVer] = useState(0)

  const vCases = useTableVersion('cases')
  const vTasks = useTableVersion('case_tasks')
  const vMessages = useTableVersion('case_messages')
  const vNotifications = useTableVersion('notifications')
  const vReports = useTableVersion('reports')
  const vWatch = useTableVersion('watchlist')
  const vPersons = useTableVersion('persons')
  const vVehicles = useTableVersion('vehicles')
  const vJustice = useTableVersion('justice_memberships')

  const refresh = useCallback(async () => {
    if (state !== 'in' || !profile) return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      await fetchProfiles()
      void fetchJustice()
      const [cases, tasks, messages, notifications, reports, watchlist, persons, vehicles] = await Promise.all([
        list('cases', { order: 'updated_at', ascending: false }),
        list('case_tasks', { order: 'due', nullsFirst: false }),
        list('case_messages', { order: 'created_at', ascending: false, limit: 120 }),
        list('notifications', { eq: { user_id: profile.id }, order: 'created_at', ascending: false, limit: 40 }),
        list('reports', { order: 'updated_at', ascending: false, limit: 120 }),
        list('watchlist', { eq: { user_id: profile.id }, order: 'created_at', ascending: false }),
        // Only needed to resolve followed targets — a failure shouldn't sink the desk.
        list('persons', {}).catch(() => [] as PersonRow[]),
        list('vehicles', {}).catch(() => [] as VehicleRow[]),
      ])
      setData({ cases, tasks, messages, notifications, reports, watchlist, persons, vehicles })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [fetchProfiles, fetchJustice, profile, state])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, vCases, vTasks, vMessages, vNotifications, vReports, vWatch, vPersons, vVehicles, vJustice])

  // Command-only: pending CID sign-ins awaiting a decision. Mirrors the roster
  // rule — a deactivated member who now holds an active justice identity was
  // moved out by an organization correction and is NOT a pending sign-in.
  const pendingApprovals = isCommand
    ? rosterProfiles.filter((p) => !p.active && !p.removed_at && !justiceByUser[p.id]).length
    : 0

  const model = useMemo(() => {
    const myId = profile?.id ?? ''
    const review = data.cases.filter((c) => canReviewCase(c, profile))
    const bounced = data.cases.filter((c) => c.signoff_submitted_by === myId && (c.signoff_status === 'changes_requested' || c.signoff_status === 'denied'))
    const mineInFlight = data.cases.filter((c) => c.signoff_submitted_by === myId && !CLOSED_SIGNOFF.has(c.signoff_status) && !bounced.some((b) => b.id === c.id))
    const followUps = data.cases.filter((c) => c.status !== 'closed' && isDue(c.follow_up_at)).sort((a, b) => String(a.follow_up_at).localeCompare(String(b.follow_up_at)))
    const stale = data.cases.filter(isStaleCase).sort((a, b) => caseStaleDays(b) - caseStaleDays(a))
    const tasks = data.tasks.filter((t) => !t.done && (t.assignee === myId || t.created_by === myId)).sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')))
    const overdueTasks = tasks.filter((t) => isDue(t.due))
    const mentions = data.messages.filter((m) => m.author_id !== myId && (jsonHasId(m.mentions, myId) || (profile?.display_name && m.body.toLowerCase().includes(`@${profile.display_name.toLowerCase()}`)))).slice(0, 12)
    const watched = resolveWatchItems(data, Store.get<Record<string, string>>('watchSeen', {}))
    const draftReports = data.reports.filter((r) => r.author_id === myId && !r.finalized).slice(0, 12)
    const unread = data.notifications.filter((n) => !n.read)
    return { review, bounced, mineInFlight, followUps, stale, tasks, overdueTasks, mentions, watched, draftReports, unread }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seenVer invalidates the Store-read watchSeen map
  }, [data, profile, seenVer])

  async function markNotificationRead(n: NotificationRow) {
    const res = await update('notifications', n.id, { read: true })
    if (res.error) {
      toast(`Could not mark notification read: ${res.error.message}`, 'danger')
      return
    }
    setData((prev) => ({ ...prev, notifications: prev.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }))
  }

  if (state !== 'in') return <EmptyLine text="Sign in to view My Desk." />

  return (
    <section className="view-in space-y-5">
      <div>
        <p className="t-readout inline-flex items-center gap-2 rounded border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-emerald-200">
          <span className="t-dot t-dot-emerald" /> Live desk
        </p>
        <PageHeader
          className="mt-2"
          title="My Desk"
          subtitle={`${profile?.display_name || 'Officer'} - ${ROLE_LABEL[profile?.role ?? ''] || profile?.role || 'Member'}`}
          actions={
            <button onClick={() => { void refresh() }} className="rounded border border-white/10 px-3 py-2 text-sm font-bold text-slate-200 hover:border-amber-300/30 hover:text-amber-100">
              Refresh
            </button>
          }
        />
      </div>

      {err && <p className="rounded border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">Desk refresh failed: {err}</p>}
      {loading && <p className="rounded border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-400">Loading desk...</p>}

      {isCommand && (
        <Link
          href="/command-center"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/25 bg-amber-500/10 px-4 py-3 transition hover:border-amber-300/40 hover:bg-amber-500/15"
        >
          <span className="text-sm font-bold text-amber-100">
            Command administration
            <span className="ml-2 font-normal text-amber-200/80">
              {pendingApprovals > 0
                ? `${pendingApprovals} sign-in ${pendingApprovals === 1 ? 'request' : 'requests'} awaiting approval`
                : 'Approvals, promotions & transfers'}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {pendingApprovals > 0 && <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-black text-amber-100">{pendingApprovals}</span>}
            <span className="text-xs font-semibold text-amber-200">Open Command Center ↗</span>
          </span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Review" value={model.review.length} tone={model.review.length ? 'amber' : 'slate'} />
        <Stat label="Bounced" value={model.bounced.length} tone={model.bounced.length ? 'rose' : 'slate'} />
        <Stat label="Follow-ups" value={model.followUps.length} tone={model.followUps.length ? 'amber' : 'slate'} />
        <Stat label="Stale" value={model.stale.length} tone={model.stale.length ? 'rose' : 'slate'} />
        <Stat label="Tasks" value={model.tasks.length} tone={model.overdueTasks.length ? 'rose' : model.tasks.length ? 'blue' : 'slate'} />
        <Stat label="Mentions" value={model.mentions.length} tone={model.mentions.length ? 'blue' : 'slate'} />
        <Stat label="Unread" value={model.unread.length} tone={model.unread.length ? 'emerald' : 'slate'} />
        <Stat label="Drafts" value={model.draftReports.length} tone={model.draftReports.length ? 'amber' : 'slate'} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Sign-off waiting on me" count={model.review.length}>
          {model.review.length ? model.review.map((c) => (
            <CaseLine key={c.id} c={c} meta={<span className={`rounded px-1.5 py-0.5 font-bold ${signoffTint(c.signoff_status)}`}>{signoffLabel(c.signoff_status)}</span>} />
          )) : <EmptyLine text="No sign-off reviews are waiting on you." />}
        </Panel>

        <Panel title="Returned or in-flight sign-off" count={model.bounced.length + model.mineInFlight.length}>
          {[...model.bounced, ...model.mineInFlight].length ? [...model.bounced, ...model.mineInFlight].map((c) => (
            <CaseLine key={c.id} c={c} meta={<span className={`rounded px-1.5 py-0.5 font-bold ${signoffTint(c.signoff_status)}`}>{signoffLabel(c.signoff_status)}</span>} />
          )) : <EmptyLine text="No submitted cases need your attention." />}
        </Panel>

        <Panel title="Due follow-ups" count={model.followUps.length}>
          {model.followUps.length ? model.followUps.map((c) => (
            <CaseLine key={c.id} c={c} meta={<span>Follow-up {c.follow_up_at}</span>} />
          )) : <EmptyLine text="No follow-ups are due today." />}
        </Panel>

        <Panel title="Stale active cases" count={model.stale.length}>
          {model.stale.length ? model.stale.slice(0, 12).map((c) => (
            <CaseLine key={c.id} c={c} meta={<span>{caseStaleDays(c)} days quiet</span>} />
          )) : <EmptyLine text="No stale active cases visible to you." />}
        </Panel>

        <Panel title="My open tasks" count={model.tasks.length}>
          {model.tasks.length ? model.tasks.slice(0, 12).map((t) => (
            <Link key={t.id} href={caseHref(t.case_id)} className="block rounded border border-white/10 bg-white/[0.03] p-3 hover:border-amber-300/30">
              <p className="text-sm font-bold text-white">{t.title}</p>
              <p className={`mt-1 text-xs ${isDue(t.due) ? 'text-rose-300' : 'text-slate-500'}`}>
                {t.due ? `${isDue(t.due) ? 'Due' : 'Due in ' + daysUntil(t.due)} ${t.due}` : 'No due date'} - {t.assignee ? `Assigned to ${officerName(t.assignee) || 'officer'}` : 'Unassigned'}
              </p>
            </Link>
          )) : <EmptyLine text="No open tasks are assigned to or created by you." />}
        </Panel>

        <Panel title="Mentions" count={model.mentions.length}>
          {model.mentions.length ? model.mentions.map((m) => (
            <Link key={m.id} href={caseHref(m.case_id)} className="block rounded border border-white/10 bg-white/[0.03] p-3 hover:border-blue-300/30">
              <p className="text-xs font-bold text-slate-400">{m.author_name || officerName(m.author_id) || 'Officer'} - {timeAgo(m.created_at)}</p>
              <p className="mt-1 line-clamp-2 text-sm text-slate-100">{m.body}</p>
            </Link>
          )) : <EmptyLine text="No recent case-chat mentions." />}
        </Panel>

        <Panel
          title="Following"
          count={model.watched.length}
          action={model.watched.some((it) => it.fresh) ? (
            <span className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-amber-300">{model.watched.filter((it) => it.fresh).length} updated</span>
              <button
                onClick={() => { for (const it of model.watched) markWatchSeen(it.w.target_type as WatchType, it.w.target_id, it.ts ?? undefined); setSeenVer((v) => v + 1) }}
                className="-my-1.5 rounded border border-white/10 bg-white/5 px-2 py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10"
              >
                Mark all seen
              </button>
            </span>
          ) : undefined}
        >
          {model.watched.length ? model.watched.map((it) => (
            <Link
              key={it.w.id}
              href={it.href}
              onClick={() => { markWatchSeen(it.w.target_type as WatchType, it.w.target_id, it.ts ?? undefined); setSeenVer((v) => v + 1) }}
              className={`block rounded border p-3 transition hover:bg-white/[0.06] ${it.fresh ? 'border-amber-400/25 bg-amber-500/[0.04]' : 'border-white/10 bg-white/[0.03] hover:border-amber-300/30'}`}
            >
              <p className="truncate text-sm font-bold text-white">
                <span aria-hidden>{it.icon}</span> {it.title}
                {it.fresh && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-black uppercase text-amber-300">updated</span>}
              </p>
              <p className="mt-1 text-xs text-slate-500">{it.sub}{it.ts ? ` · ${timeAgo(it.ts)}` : ''}</p>
            </Link>
          )) : <EmptyLine text="Follow cases, persons or vehicles (the ☆ Follow button) to pin their changes here." />}
        </Panel>

        <Panel title="Notifications" count={model.unread.length}>
          {data.notifications.length ? data.notifications.slice(0, 12).map((n) => (
            <button key={n.id} onClick={() => { if (!n.read) void markNotificationRead(n) }} className={`block w-full rounded border p-3 text-left ${n.read ? 'border-white/10 bg-white/[0.02] text-slate-500' : 'border-emerald-400/20 bg-emerald-500/10 text-emerald-100'}`}>
              <p className="text-xs font-black uppercase tracking-wide">{notifTitle(n)}</p>
              <p className="mt-1 line-clamp-2 text-sm">{[notifDetail(n), notifSub(n)].filter(Boolean).join(' — ') || 'Notification'}</p>
              <p className="mt-1 text-xs opacity-70">{timeAgo(n.created_at)}{n.read ? '' : ' - click to mark read'}</p>
            </button>
          )) : <EmptyLine text="No notifications yet." />}
        </Panel>

        <Panel title="Draft reports" count={model.draftReports.length}>
          {model.draftReports.length ? model.draftReports.map((r) => (
            <Link key={r.id} href={`${caseHref(r.case_id)}&tab=reports`} className="block rounded border border-white/10 bg-white/[0.03] p-3 hover:border-amber-300/30">
              <p className="text-sm font-bold text-white">{r.template}</p>
              <p className="mt-1 text-xs text-slate-500">Updated {timeAgo(r.updated_at)} - case report draft</p>
            </Link>
          )) : <EmptyLine text="No unfinalized report rows authored by you." />}
        </Panel>
      </div>
    </section>
  )
}
