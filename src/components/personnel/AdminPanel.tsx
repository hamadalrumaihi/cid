'use client'

/** Member administration (Director / Command) — vanilla app.js renderAdmin().
 *  Pending sign-ins sort to the top; one-click approve keeps their current
 *  role/bureau and flips active. Permanently-removed members list below with
 *  a restore action (they return inactive, pending re-approval). */
import { rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import type { RosterProfile } from '@/lib/profiles'
import { ROLE_LABEL } from '@/lib/roles'
import { AGENCY_LABEL, justiceRoleLabel } from '@/lib/justice'
import type { JusticeIdentity } from '@/lib/justiceRoster'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'

interface AdminPanelProps {
  profiles: RosterProfile[]
  emails: Record<string, string>
  /** Active DOJ/Judiciary identities keyed by CID user id — members here were
   *  moved out of CID and must not resurface as pending sign-ins. */
  justiceByUser?: Record<string, JusticeIdentity>
  onManage: (p: RosterProfile) => void
  onChanged: () => void
}

export function AdminPanel({ profiles, emails, justiceByUser = {}, onManage, onChanged }: AdminPanelProps) {
  const { profile: me } = useAuth()
  // A deactivated CID member who now holds an active justice identity was moved
  // out by an organization correction — list them separately, never as a
  // pending sign-in with a (re-dual-ing) Approve button.
  const movedToJustice = (p: RosterProfile) => !p.active && !p.removed_at && !!justiceByUser[p.id]
  const rows = profiles.filter((p) => !p.removed_at && !movedToJustice(p)).slice().sort((a, b) => Number(a.active) - Number(b.active))
  const moved = profiles.filter(movedToJustice).slice().sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
  const removed = profiles.filter((p) => p.removed_at).slice().sort((a, b) => (b.removed_at || '').localeCompare(a.removed_at || ''))

  // One-click approve for pending sign-ins (keeps their current role/bureau —
  // assign_member is activation-only since v1.16).
  const approve = async (p: RosterProfile) => {
    const res = await rpc('assign_member', { target: p.id, set_active: true })
    if (res.error) { toast(`Approve failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name} approved for access`, 'success')
    void notify(p.id, 'member_approved', { detective: me?.display_name || 'Command', reason: 'Your CID access has been approved — welcome aboard.' })
    onChanged()
  }

  const restore = async (p: RosterProfile) => {
    const ok = await uiConfirm(`Restore ${p.display_name || 'this member'}? They return as an inactive account and must be re-approved to regain access.`, { confirmText: 'Restore' })
    if (!ok) return
    const res = await rpc('admin_restore_member', { p_target: p.id })
    if (res.error) { toast(`Restore failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name || 'Member'} restored — pending re-approval`, 'success')
    onChanged()
  }

  return (
    <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
      <h4 className="mb-1 text-sm font-semibold uppercase tracking-wider text-amber-300/80">⚙️ Member Administration (Director / Command)</h4>
      <p className="mb-4 text-xs text-slate-400">Approve and assign officers. New sign-ins are inactive until activated.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-slate-400">
              <th className="px-3 py-2">Officer</th><th className="px-3 py-2">Role</th><th className="px-3 py-2">Bureau</th><th className="px-3 py-2">Active</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.length ? rows.map((p) => (
              <tr key={p.id} className={p.active ? '' : 'bg-amber-500/5'}>
                <td className="px-3 py-2">
                  <p className="text-white">
                    {p.display_name}
                    {p.loa && <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">On LOA</span>}
                  </p>
                  <p className="text-[11px] text-slate-500">{emails[p.id] || ''}</p>
                </td>
                <td className="px-3 py-2 text-slate-300">{ROLE_LABEL[p.role] || p.role}</td>
                <td className="px-3 py-2 text-slate-300">{p.division}</td>
                <td className="px-3 py-2">{p.active ? <span className="text-emerald-300">Yes</span> : <span className="text-amber-300">Pending</span>}</td>
                <td className="px-3 py-2 text-right">
                  {!p.active && (
                    <button onClick={() => void approve(p)} className="mr-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20">
                      ✓ Approve
                    </button>
                  )}
                  <button onClick={() => onManage(p)} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10">
                    Manage
                  </button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={5} className="px-3 py-3 text-slate-500">No profiles yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {moved.length > 0 && (
        <div className="mt-5 border-t border-white/5 pt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-sky-300/70">Moved to DOJ / Judiciary ({moved.length})</p>
          <div className="space-y-1.5">
            {moved.map((p) => {
              const j = justiceByUser[p.id]
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900 px-3 py-2">
                  <span className="text-sm text-slate-400">
                    <span className="text-slate-300">{p.display_name}</span> ·{' '}
                    <span className="text-[11px]">CID {ROLE_LABEL[p.role] || p.role} · {p.division} → <span className="text-sky-300">{justiceRoleLabel(j?.justice_role)}{j ? `, ${AGENCY_LABEL[j.agency]}` : ''}</span></span>
                  </span>
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-[10px] text-slate-500">Their CID membership is inactive and kept as history. Reactivating CID here is blocked — use <b>Manage → Move to CID</b> (organization correction) to bring them back.</p>
        </div>
      )}
      {removed.length > 0 && (
        <div className="mt-5 border-t border-white/5 pt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-rose-300/70">Permanently removed ({removed.length})</p>
          <div className="space-y-1.5">
            {removed.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900 px-3 py-2">
                <span className="text-sm text-slate-400">
                  <span className="text-slate-300">{p.display_name}</span> ·{' '}
                  <span className="text-[11px]">removed {p.removed_at ? new Date(p.removed_at).toLocaleDateString('en-GB') : ''}</span>
                </span>
                <button onClick={() => void restore(p)} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/10">
                  Restore
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
