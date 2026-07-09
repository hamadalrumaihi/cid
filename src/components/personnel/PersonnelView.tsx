'use client'

/** Personnel, Roster & Commendations — port of vanilla personnel.js (§8) plus
 *  the command-only member-administration panel (app.js renderAdmin). The
 *  roster reads the shared non-email profiles cache; addresses come from the
 *  command-gated admin_member_emails RPC only. The Division Rosters doc shelf
 *  (drive.js reader/structured editor) lands with the SOPs slice. */
import { useCallback, useEffect, useState } from 'react'
import { list, rpc } from '@/lib/db'
import { initials } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { type RosterProfile, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { ROLE_LABEL } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { useNav } from '@/components/shell/useNav'
import { AdminPanel } from './AdminPanel'
import { AssignModal } from './AssignModal'
import { Commendations, type CommendationRow } from './Commendations'

const ROSTER_PAGE = 30

export function PersonnelView() {
  const { profile: me, state, isCommand } = useAuth()
  const { navigate } = useNav()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [commendations, setCommendations] = useState<CommendationRow[]>([])
  const [shown, setShown] = useState(ROSTER_PAGE)
  const [assignTarget, setAssignTarget] = useState<RosterProfile | null>(null)
  const vProfiles = useTableVersion('profiles')
  const vCommendations = useTableVersion('commendations')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    void fetchProfiles()
    try { setCommendations(await list('commendations', { order: 'created_at', ascending: false })) }
    catch { toast('Could not load commendations — check your connection.', 'danger') }
    if (isCommand) {
      // profiles.email is column-granted to command; everyone else never asks.
      const r = await rpc('admin_member_emails', undefined as never)
      if (!r.error && Array.isArray(r.data)) {
        setEmails(Object.fromEntries(r.data.map((x) => [x.id, x.email])))
      }
    }
  }, [state, isCommand, fetchProfiles])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, vProfiles, vCommendations])

  // Permanently-removed members stay in the cache for historical name
  // resolution but never appear on the live roster.
  const roster = profiles.filter((p) => !p.removed_at)
  const visible = roster.slice(0, shown)
  const remaining = Math.max(0, roster.length - visible.length)

  return (
    <section className="view-in space-y-6">
      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <h3 className="text-xl font-bold text-white">👥 Personnel, Roster &amp; Commendations</h3>
        <p className="text-sm text-slate-400">CID roster &amp; digital commendations</p>
      </div>

      {state === 'in' && isCommand && (
        <AdminPanel profiles={profiles} emails={emails} onManage={setAssignTarget} onChanged={() => void refresh()} />
      )}

      <div>
        <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Active Roster</h4>
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
                  admin={isCommand}
                  onEdit={() => { if (isCommand) setAssignTarget(p); else navigate('profile') }}
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

      {assignTarget && (
        <AssignModal p={assignTarget} email={emails[assignTarget.id] || ''} onClose={() => setAssignTarget(null)} onChanged={() => void refresh()} />
      )}
    </section>
  )
}

interface RosterCardProps {
  p: RosterProfile
  isMe: boolean
  admin: boolean
  onEdit: () => void
  onChanged: () => void
}

function RosterCard({ p, isMe, admin, onEdit, onChanged }: RosterCardProps) {
  const { setMyLoa } = useAuth()

  const toggleMyLoa = async () => {
    const r = await setMyLoa(!p.loa)
    if (r.error) { toast(`LOA update failed: ${r.error.message}`, 'danger'); return }
    toast(p.loa ? 'Welcome back — LOA cleared' : 'You are marked On LOA', 'success')
    onChanged()
  }

  // Deactivate (kept on the roster, unlike the permanent Danger-zone removal).
  const removeFromRoster = async () => {
    const ok = await uiConfirm(`Remove ${p.display_name || 'this officer'} from the active roster? They keep their account but can't act until reactivated.`, { confirmText: 'Deactivate' })
    if (!ok) return
    const res = await rpc('assign_member', { target: p.id, new_role: p.role, new_division: p.division, set_active: false })
    if (res.error) { toast(`Remove failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name || 'Officer'} removed from active roster`, 'warn')
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
        <button
          onClick={() => void toggleMyLoa()}
          className={`mt-3 w-full rounded-lg border px-3 py-2 text-xs font-semibold transition ${p.loa ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/5 text-amber-200 hover:bg-amber-500/10'}`}
        >
          {p.loa ? 'Clear my LOA — return active' : 'Set myself On LOA'}
        </button>
      )}
      {(admin || isMe) && (
        <button onClick={onEdit} className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10">
          ✎ Edit {isMe && !admin ? 'my profile' : 'officer'}
        </button>
      )}
      {admin && !isMe && p.active && (
        <button onClick={() => void removeFromRoster()} className="mt-2 w-full rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">
          Remove from roster
        </button>
      )}
    </div>
  )
}
