'use client'

/** Personnel, Roster & Commendations — the member-facing read-only directory.
 *  Member administration (approve / manage / promote / transfer / remove) moved
 *  to the Command Center (Command → Personnel & Admin); command staff get a
 *  link here. Officers can still toggle their own LOA and open their profile.
 *  The roster reads the shared non-email profiles cache. */
import { useCallback, useEffect, useState } from 'react'
import { list } from '@/lib/db'
import { initials } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { type RosterProfile, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { ROLE_LABEL } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { useNav } from '@/components/shell/useNav'
import { PageHeader } from '@/components/ui/PageHeader'
import { Commendations, type CommendationRow } from './Commendations'
import { Card } from '@/components/ui/Card'

const ROSTER_PAGE = 30

export function PersonnelView() {
  const { profile: me, state, isCommand } = useAuth()
  const { navigate } = useNav()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [commendations, setCommendations] = useState<CommendationRow[]>([])
  const [shown, setShown] = useState(ROSTER_PAGE)
  const vProfiles = useTableVersion('profiles')
  const vCommendations = useTableVersion('commendations')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    void fetchProfiles()
    try { setCommendations(await list('commendations', { order: 'created_at', ascending: false })) }
    catch { toast('Could not load commendations — check your connection.', 'danger') }
  }, [state, fetchProfiles])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, vProfiles, vCommendations])

  const roster = profiles.filter((p) => !p.removed_at)
  const visible = roster.slice(0, shown)
  const remaining = Math.max(0, roster.length - visible.length)

  return (
    <section className="view-in space-y-6">
      <Card pad="lg">
        <PageHeader title="👥 Personnel, Roster & Commendations" subtitle="CID roster & digital commendations" />
      </Card>

      {state === 'in' && isCommand && (
        <button
          onClick={() => navigate('command-center')}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-badge-500/30 bg-badge-500/5 p-4 text-left transition hover:bg-badge-500/10"
        >
          <span>
            <span className="block text-sm font-bold text-white">🛡️ Manage personnel in the Command Center</span>
            <span className="text-xs text-slate-400">Approvals, promotions, transfers, duty status and the chain of command now live there.</span>
          </span>
          <span className="flex-shrink-0 text-sm font-semibold text-badge-200">Open →</span>
        </button>
      )}

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Active Roster</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {state !== 'in' ? (
            <p className="text-sm text-slate-500 sm:col-span-2 xl:col-span-3">Sign in to view the roster.</p>
          ) : !roster.length ? (
            <p className="text-sm text-slate-500 sm:col-span-2 xl:col-span-3">No officers on the roster yet.</p>
          ) : (
            <>
              {visible.map((p) => (
                <RosterCard
                  key={p.id}
                  p={p}
                  isMe={!!me && p.id === me.id}
                  onEditMe={() => navigate('profile')}
                  onChanged={() => void refresh()}
                />
              ))}
              {remaining > 0 && (
                <div className="col-span-full pt-1 text-center">
                  <button onClick={() => setShown((s) => s + ROSTER_PAGE)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10">
                    Load {Math.min(remaining, ROSTER_PAGE)} more · {remaining} remaining
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Commendations rows={commendations} onChanged={() => void refresh()} />
    </section>
  )
}

function RosterCard({ p, isMe, onEditMe, onChanged }: { p: RosterProfile; isMe: boolean; onEditMe: () => void; onChanged: () => void }) {
  const { setMyLoa } = useAuth()

  const toggleMyLoa = async () => {
    const r = await setMyLoa(!p.loa)
    if (r.error) { toast(`LOA update failed: ${r.error.message}`, 'danger'); return }
    toast(p.loa ? 'Welcome back — LOA cleared' : 'You are marked On LOA', 'success')
    onChanged()
  }

  const status = p.loa ? 'On LOA' : p.active ? 'Active' : 'Pending'
  return (
    <div className={`rounded-2xl border bg-ink-900/60 p-5 transition hover:border-white/10 ${p.loa ? 'border-amber-500/20' : 'border-white/5'}`}>
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 text-sm font-bold text-white">
          {initials(p.display_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">
            {p.display_name}
            {p.loa && <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">On LOA</span>}
          </p>
          <p className="text-xs text-slate-400">{ROLE_LABEL[p.role] || p.role}</p>
        </div>
        <span className={`pulse-dot h-2.5 w-2.5 rounded-full ${p.loa ? 'bg-amber-400' : p.active ? 'bg-emerald-400' : 'bg-slate-500'}`} title={status} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-ink-850 py-2"><p className="font-mono font-bold text-blue-300">{p.badge_number || '—'}</p><p className="text-[10px] text-slate-500">Badge</p></div>
        <div className="rounded-lg bg-ink-850 py-2"><p className="font-semibold text-slate-200">{p.division}</p><p className="text-[10px] text-slate-500">Bureau</p></div>
        <div className="rounded-lg bg-ink-850 py-2"><p className={`font-semibold ${p.loa ? 'text-amber-300' : 'text-slate-200'}`}>{status}</p><p className="text-[10px] text-slate-500">Status</p></div>
      </div>
      {isMe && (
        <>
          <button
            onClick={() => void toggleMyLoa()}
            className={`mt-3 w-full rounded-lg border px-3 py-2 text-xs font-semibold transition ${p.loa ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/5 text-amber-200 hover:bg-amber-500/10'}`}
          >
            {p.loa ? 'Clear my LOA — return active' : 'Set myself On LOA'}
          </button>
          <button onClick={onEditMe} className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10">
            ✎ Edit my profile
          </button>
        </>
      )}
    </div>
  )
}
