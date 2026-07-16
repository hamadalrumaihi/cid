'use client'

/** Command Center → Overview. Command-focused KPIs and "what needs a
 *  decision" counts, each deep-linking into the relevant section. Reads the
 *  shared roster cache + cases; every count is RLS-scoped to what the caller
 *  can see (command staff see across bureaus). */
import { useCallback, useEffect, useState } from 'react'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { useJusticeRoster } from '@/lib/justiceRoster'
import { useTableVersion } from '@/lib/realtime'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { canReviewCase } from '../lib/approvals'
import { pendingMembership, type JusticeRequestLite } from '../lib/membershipPending'

type CaseRow = Tables<'cases'>
type RequestRow = Tables<'membership_requests'>

function Tile({ label, value, hint, onClick }: { label: string; value: number | string; hint?: string; onClick?: () => void }) {
  const body = (
    <>
      <p className="font-mono text-2xl font-black text-white">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </>
  )
  return onClick ? (
    <button onClick={onClick} className="rounded-2xl border border-white/5 bg-ink-900/60 p-4 text-left transition hover:border-badge-400/50 hover:bg-white/5">{body}</button>
  ) : (
    <Card pad="sm">{body}</Card>
  )
}

export function CommandCenterOverview({ onGo }: { onGo: (id: string) => void }) {
  const { profile, isCommand, isOwner } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const justiceByUser = useJusticeRoster((s) => s.byUser)
  const fetchJustice = useJusticeRoster((s) => s.fetch)
  const [cases, setCases] = useState<CaseRow[]>([])
  // null until loaded — the tile then falls back to the profiles-only count.
  const [requests, setRequests] = useState<RequestRow[] | null>(null)
  // Open DOJ/Judiciary applications: their applicants are not CID work and
  // must not inflate the tile (they're decided in the Justice portal).
  const [justiceReqs, setJusticeReqs] = useState<JusticeRequestLite[] | null>(null)
  const vProfiles = useTableVersion('profiles')
  const vCases = useTableVersion('cases')
  const vRequests = useTableVersion('membership_requests')
  const vJustice = useTableVersion('justice_memberships')
  const vJusticeReqs = useTableVersion('justice_membership_requests')
  const canAdmin = isCommand || isOwner

  const refresh = useCallback(async () => {
    void fetchProfiles()
    void fetchJustice()
    try { setCases(await list('cases', {})) } catch { /* stale ok */ }
    if (canAdmin) {
      const rq = await rpc('admin_membership_requests', undefined as never)
      if (!rq.error && Array.isArray(rq.data)) setRequests(rq.data)
      try {
        setJusticeReqs(await list('justice_membership_requests', {
          select: 'applicant_id,status',
          in: { status: ['draft', 'pending', 'correction_requested'] },
        }) as JusticeRequestLite[])
      } catch { /* degrade to the pre-fix blended count */ }
    }
  }, [fetchProfiles, fetchJustice, canAdmin])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vProfiles, vCases, vRequests, vJustice, vJusticeReqs])

  const roster = profiles.filter((p) => !p.removed_at)
  // Shared membership model — the tile shows the same awaitingCount as the
  // nav badge, the Approval Queue and the Action Center (lib/membershipPending).
  const pm = pendingMembership(profiles, requests, justiceByUser, justiceReqs)
  const pendingHint = pm.requestsLoaded
    ? `${pm.signIns.filter((s) => s.actionable).length} sign-ins · ${pm.submitted.length} requests${pm.ghosts.length ? ` · ${pm.ghosts.length} to reconcile` : ''}${pm.justiceApplicants ? ` · ${pm.justiceApplicants} in Justice portal` : ''}`
    : 'new sign-ins awaiting activation'
  const onLoa = roster.filter((p) => p.active && p.loa).length
  const active = roster.filter((p) => p.active).length
  const awaitingMe = cases.filter((c) => canReviewCase(c, profile)).length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Pending approvals" value={pm.awaitingCount} hint={pendingHint} onClick={() => onGo('approvals')} />
        <Tile label="Sign-offs awaiting you" value={awaitingMe} hint="cases at your decision stage" onClick={() => onGo('approvals')} />
        <Tile label="Active officers" value={active} hint="approved & on the roster" onClick={() => onGo('duty')} />
        <Tile label="On LOA" value={onLoa} hint="active but on leave" onClick={() => onGo('duty')} />
      </div>

      <div className="rounded-2xl border border-white/5 bg-ink-900/45 p-5">
        <h3 className="mb-2 font-bold text-white">Jump to</h3>
        <div className="flex flex-wrap gap-2">
          {[
            ['chain', '🏛️ Chain of Command'],
            ['personnel', '👥 Personnel & Admin'],
            ['promotions', '🎖️ Promotions & Transfers'],
            ['permissions', '🔐 Permissions'],
            ['comms', '📣 Announcements & Analytics'],
          ].map(([id, label]) => (
            <Button key={id} size="sm" onClick={() => onGo(id)}>{label}</Button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">The full division dashboard (KPIs, scorecards, activity feed) lives on the member-facing <b>Dashboard</b> tab; this Overview focuses on command decisions.</p>
      </div>
    </div>
  )
}
