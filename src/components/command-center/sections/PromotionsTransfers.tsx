'use client'

/** Command Center → Promotions & Transfers. Dedicated rank/bureau-change flow
 *  plus a role-change history log. The change itself goes through the same
 *  `assign_member` RPC (via the Manage Officer modal); history is read from
 *  the `role_events` table the RPC writes. History rendering is added in the
 *  phase that ships the migration — until then this section drives the same
 *  modal and explains where changes are recorded. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { list } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { type RosterProfile, useProfilesStore, officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { ROLE_LABEL, roleLabel } from '@/lib/roles'
import { timeAgo } from '@/lib/format'
import { AssignModal } from '@/components/personnel/AssignModal'

type RoleEvent = Tables<'role_events'>

export function PromotionsTransfers() {
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [target, setTarget] = useState<RosterProfile | null>(null)
  const [events, setEvents] = useState<RoleEvent[]>([])
  const [q, setQ] = useState('')
  const v = useTableVersion('profiles')
  const vE = useTableVersion('role_events')

  const refresh = useCallback(async () => {
    void fetchProfiles()
    // role_events is command-readable; tolerate its absence pre-migration.
    try { setEvents(await list('role_events', { order: 'created_at', ascending: false })) } catch { setEvents([]) }
  }, [fetchProfiles])
  useEffect(() => { const t = window.setTimeout(() => { void refresh() }, 0); return () => window.clearTimeout(t) }, [refresh, v, vE])

  const roster = useMemo(() => profiles.filter((p) => !p.removed_at && p.active), [profiles])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return roster.filter((p) => !s || (p.display_name || '').toLowerCase().includes(s) || (p.role || '').includes(s) || (p.division || '').toLowerCase().includes(s))
  }, [roster, q])

  const describe = (e: RoleEvent) => {
    const parts: string[] = []
    if (e.old_role !== e.new_role) parts.push(`${ROLE_LABEL[e.old_role ?? ''] || e.old_role || '—'} → ${ROLE_LABEL[e.new_role ?? ''] || e.new_role || '—'}`)
    if (e.old_division !== e.new_division) parts.push(`${e.old_division || '—'} → ${e.new_division || '—'}`)
    if (e.old_active !== e.new_active) parts.push(e.new_active ? 'activated' : 'deactivated')
    return parts.join(' · ') || 'no change'
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-ink-900/45 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold text-white">Change rank or bureau</h3>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find officer…" aria-label="Find officer" className="w-52 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, 24).map((p) => (
            <button key={p.id} onClick={() => setTarget(p)} className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-950/50 px-3 py-2 text-left transition hover:border-badge-400/50">
              <span><span className="block text-sm font-semibold text-white">{p.display_name}</span><span className="text-[11px] text-slate-400">{roleLabel(p.role)} · {p.division}</span></span>
              <span className="text-xs font-semibold text-badge-200">Manage</span>
            </button>
          ))}
          {!filtered.length && <p className="text-sm text-slate-500">No matching officers.</p>}
        </div>
        <p className="mt-3 text-[11px] text-slate-500">Promotions, demotions and transfers all go through <b>Manage Officer</b> — the same <code>assign_member</code> RPC used on the Personnel admin panel. Bureau Leads can only manage their own bureau and can’t promote above Senior Detective.</p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-ink-900/45 p-5">
        <h3 className="mb-1 font-bold text-white">Role-change history <span className="text-slate-500">({events.length})</span></h3>
        {events.length ? (
          <div className="space-y-1.5">
            {events.slice(0, 50).map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-950/50 px-3 py-2 text-sm">
                <span className="text-slate-200">{officerName(e.target_id) || 'Officer'} — <span className="text-slate-400">{describe(e)}</span></span>
                <span className="text-[11px] text-slate-500">by {officerName(e.actor_id) || 'command'} · {timeAgo(e.created_at)}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-slate-500">No role changes recorded yet.</p>}
      </section>

      {target && (
        <AssignModal p={target} email="" onClose={() => setTarget(null)} onChanged={() => void refresh()} />
      )}
    </div>
  )
}
