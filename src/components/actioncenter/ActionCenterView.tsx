'use client'

/** Action Center — one prioritized queue of everything awaiting a DECISION or
 *  ACTION from the signed-in member, each row deep-linking to where the action
 *  happens. It shares My Desk's data sources (sign-off reviews, my tasks) and
 *  adds the command decision items (membership approvals, transfer decisions,
 *  access requests) that My Desk only linked to. My Desk stays the broad
 *  personal overview; this is the focused "what needs me" list. Every write
 *  still happens in the owning surface (the RPCs are the authority) — this only
 *  aggregates and routes. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { list, rpc } from '@/lib/db'
import { caseLink } from '@/lib/caseLinks'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { todayISO } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { signoffLabel } from '@/lib/signoff'
import { canReviewCase } from '@/components/command-center/lib/approvals'
import { PageHeader } from '@/components/ui/PageHeader'

type CaseRow = Tables<'cases'>
type TaskRow = Tables<'case_tasks'>
type TransferRow = Tables<'transfer_requests'>
type AccessRow = Tables<'case_access_requests'>

type Severity = 'urgent' | 'warn' | 'info'
interface Item { key: string; group: string; label: string; sub?: string; href: string; severity: Severity }

const SEV_ORDER: Severity[] = ['urgent', 'warn', 'info']
const DOT: Record<Severity, string> = { urgent: 'bg-rose-400', warn: 'bg-amber-400', info: 'bg-slate-400' }
const RING: Record<Severity, string> = {
  urgent: 'border-rose-400/25 hover:border-rose-300/40',
  warn: 'border-amber-400/25 hover:border-amber-300/40',
  info: 'border-white/10 hover:border-white/20',
}

const isDue = (d?: string | null) => !!d && d <= todayISO()

export function ActionCenterView() {
  const { profile, state, isCommand } = useAuth()
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [cases, setCases] = useState<CaseRow[]>([])
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [transfers, setTransfers] = useState<TransferRow[]>([])
  const [access, setAccess] = useState<AccessRow[]>([])
  const [membershipCount, setMembershipCount] = useState(0)
  const [loading, setLoading] = useState(true)

  const vCases = useTableVersion('cases')
  const vTasks = useTableVersion('case_tasks')
  const vTransfers = useTableVersion('transfer_requests')
  const vAccess = useTableVersion('case_access_requests')
  const vProfiles = useTableVersion('profiles')

  const refresh = useCallback(async () => {
    if (state !== 'in' || !profile) return
    setLoading((prev) => prev && cases.length === 0)
    void fetchProfiles()
    const [c, t, tr, ar] = await Promise.all([
      list('cases', {}).catch(() => [] as CaseRow[]),
      list('case_tasks', { eq: { assignee: profile.id, done: false } }).catch(() => [] as TaskRow[]),
      list('transfer_requests', {}).catch(() => [] as TransferRow[]),
      list('case_access_requests', { eq: { status: 'pending' } }).catch(() => [] as AccessRow[]),
    ])
    setCases(c); setTasks(t); setTransfers(tr); setAccess(ar)
    if (isCommand) {
      const rq = await rpc('admin_membership_requests', undefined as never)
      setMembershipCount(!rq.error && Array.isArray(rq.data) ? rq.data.filter((r) => r.status === 'pending').length : 0)
    } else setMembershipCount(0)
    setLoading(false)
  }, [state, profile, isCommand, fetchProfiles, cases.length])

  useEffect(() => { const id = window.setTimeout(() => { void refresh() }, 0); return () => window.clearTimeout(id) },
    [refresh, vCases, vTasks, vTransfers, vAccess, vProfiles])

  const items = useMemo<Item[]>(() => {
    if (!profile) return []
    const me = profile.id
    const out: Item[] = []
    for (const c of cases) {
      if (canReviewCase(c, profile)) out.push({ key: `sign-${c.id}`, group: 'Sign-offs to decide', label: `${c.case_number} · ${c.title || 'Untitled'}`, sub: signoffLabel(c.signoff_status), href: caseLink(c.id, 'signoff'), severity: 'urgent' })
      if (c.signoff_submitted_by === me && (c.signoff_status === 'changes_requested' || c.signoff_status === 'denied')) out.push({ key: `ret-${c.id}`, group: 'Returned to you', label: `${c.case_number} · ${c.title || 'Untitled'}`, sub: `${signoffLabel(c.signoff_status)} — revise & resubmit`, href: caseLink(c.id, 'signoff'), severity: 'urgent' })
    }
    for (const t of tasks) {
      const overdue = isDue(t.due)
      out.push({ key: `task-${t.id}`, group: overdue ? 'Overdue tasks' : 'Your open tasks', label: t.title, sub: t.due ? (overdue ? `Due ${t.due}` : `Due ${t.due}`) : 'No due date', href: caseLink(t.case_id, 'tasks', { task: t.id }), severity: overdue ? 'urgent' : 'info' })
    }
    const openTransfers = transfers.filter((r) => r.status === 'pending_source' || r.status === 'pending_target')
    for (const r of openTransfers) out.push({ key: `xfer-${r.id}`, group: 'Transfer decisions', label: `Transfer — ${officerName(r.target_id) || 'officer'}`, sub: `${r.from_bureau} → ${r.to_bureau} · ${r.status === 'pending_source' ? 'source approval' : 'destination approval'}`, href: '/command-center', severity: 'warn' })
    for (const a of access) out.push({ key: `acc-${a.id}`, group: 'Access requests', label: `${a.requester_name || officerName(a.requester_id) || 'Officer'} requested case access`, sub: a.reason || undefined, href: caseLink(a.case_id), severity: 'warn' })
    if (isCommand && membershipCount > 0) out.push({ key: 'membership', group: 'Membership approvals', label: `${membershipCount} membership request${membershipCount === 1 ? '' : 's'} awaiting review`, href: '/command-center', severity: 'warn' })
    return out.sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity))
  }, [profile, cases, tasks, transfers, access, isCommand, membershipCount])

  // Group in priority order, preserving first-seen group order.
  const groups = useMemo(() => {
    const map = new Map<string, Item[]>()
    for (const it of items) { const g = map.get(it.group) || []; g.push(it); map.set(it.group, g) }
    return [...map.entries()]
  }, [items])

  if (state !== 'in') return <p className="rounded border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-400">Sign in to view your Action Center.</p>

  return (
    <section className="view-in space-y-5">
      <PageHeader
        title="Action Center"
        subtitle="Everything waiting on a decision or action from you — sign-offs, tasks, transfers, access and approvals."
        actions={<button onClick={() => { void refresh() }} className="rounded border border-white/10 px-3 py-2 text-sm font-bold text-slate-200 hover:border-amber-300/30 hover:text-amber-100">Refresh</button>}
      />
      {loading && <p className="rounded border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-400">Loading…</p>}
      {!loading && items.length === 0 && (
        <p className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 p-4 text-sm text-emerald-200">✓ You&apos;re all caught up — nothing needs your action right now.</p>
      )}
      {groups.map(([group, rows]) => (
        <section key={group}>
          <h2 className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">{group} <span className="text-slate-600">({rows.length})</span></h2>
          <div className="space-y-1.5">
            {rows.map((it) => (
              <Link key={it.key} href={it.href} className={`flex items-start gap-2.5 rounded-lg border bg-ink-900/55 p-3 transition ${RING[it.severity]}`}>
                <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${DOT[it.severity]}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">{it.label}</span>
                  {it.sub && <span className="block truncate text-xs text-slate-400">{it.sub}</span>}
                </span>
                <span className="flex-shrink-0 self-center text-[11px] font-semibold text-slate-500">Open →</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <p className="text-[11px] text-slate-500">This is the actionable slice of your <b>My Desk</b> — the same reviews and tasks appear there in context.</p>
    </section>
  )
}
