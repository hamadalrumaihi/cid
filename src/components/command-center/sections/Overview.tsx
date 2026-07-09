'use client'

/** Command Center → Overview. Command-focused KPIs and "what needs a
 *  decision" counts, each deep-linking into the relevant section. Reads the
 *  shared roster cache + cases; every count is RLS-scoped to what the caller
 *  can see (command staff see across bureaus). */
import { useCallback, useEffect, useState } from 'react'
import { list } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { canReviewCase } from '../lib/approvals'

type CaseRow = Tables<'cases'>

function Tile({ label, value, hint, onClick }: { label: string; value: number | string; hint?: string; onClick?: () => void }) {
  const body = (
    <>
      <p className="font-mono text-2xl font-black text-white">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </>
  )
  return onClick ? (
    <button onClick={onClick} className="rounded-2xl border border-white/10 bg-ink-900/60 p-4 text-left transition hover:border-badge-400/50 hover:bg-white/5">{body}</button>
  ) : (
    <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-4">{body}</div>
  )
}

export function CommandCenterOverview({ onGo }: { onGo: (id: string) => void }) {
  const { profile } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [cases, setCases] = useState<CaseRow[]>([])
  const vProfiles = useTableVersion('profiles')
  const vCases = useTableVersion('cases')

  const refresh = useCallback(async () => {
    void fetchProfiles()
    try { setCases(await list('cases', {})) } catch { /* stale ok */ }
  }, [fetchProfiles])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vProfiles, vCases])

  const roster = profiles.filter((p) => !p.removed_at)
  const pending = roster.filter((p) => !p.active).length
  const onLoa = roster.filter((p) => p.active && p.loa).length
  const active = roster.filter((p) => p.active).length
  const awaitingMe = cases.filter((c) => canReviewCase(c, profile)).length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Pending approvals" value={pending} hint="new sign-ins awaiting activation" onClick={() => onGo('approvals')} />
        <Tile label="Sign-offs awaiting you" value={awaitingMe} hint="cases at your decision stage" onClick={() => onGo('approvals')} />
        <Tile label="Active officers" value={active} hint="approved & on the roster" onClick={() => onGo('duty')} />
        <Tile label="On LOA" value={onLoa} hint="active but on leave" onClick={() => onGo('duty')} />
      </div>

      <div className="rounded-2xl border border-white/10 bg-ink-900/45 p-5">
        <h3 className="mb-2 font-bold text-white">Jump to</h3>
        <div className="flex flex-wrap gap-2">
          {[
            ['chain', '🏛️ Chain of Command'],
            ['personnel', '👥 Personnel & Admin'],
            ['promotions', '🎖️ Promotions & Transfers'],
            ['permissions', '🔐 Permissions'],
            ['comms', '📣 Announcements & Analytics'],
          ].map(([id, label]) => (
            <button key={id} onClick={() => onGo(id)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10">{label}</button>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">The full division dashboard (KPIs, scorecards, activity feed) lives on the member-facing <b>Dashboard</b> tab; this Overview focuses on command decisions.</p>
      </div>
    </div>
  )
}
