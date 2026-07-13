'use client'

/** Manage Officer modal — vanilla app.js openAssignModal(). Role/bureau/active
 *  go through the SECURITY DEFINER assign_member RPC (the client never patches
 *  profiles.role); name/badge and command-set LOA are plain profile updates
 *  via updateNoSelect. Danger zone: permanent removal via admin_remove_member
 *  (self-removal blocked). Mounted fresh per open. */
import { useState } from 'react'
import type { Database } from '@/lib/database.types'
import { rpc, updateNoSelect } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import type { RosterProfile } from '@/lib/profiles'
import { ROLE_ORDER, ROLE_LABEL, isCommandRole } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'

type AppRole = Database['public']['Enums']['app_role']
type Bureau = Database['public']['Enums']['bureau']

const BUREAU_KEYS: Bureau[] = ['LSB', 'BCB', 'SAB', 'JTF']

interface AssignModalProps {
  p: RosterProfile
  email: string
  onClose: () => void
  /** Refetch the roster (and admin panel) after any change. */
  onChanged: () => void
}

export function AssignModal({ p, email, onClose, onChanged }: AssignModalProps) {
  const { profile: me } = useAuth()
  const [name, setName] = useState(p.display_name || '')
  const [badge, setBadge] = useState(p.badge_number || '')
  const [role, setRole] = useState<string>(p.role)
  const [bureau, setBureau] = useState<string>(p.division || 'LSB')
  const [active, setActive] = useState(!!p.active)
  const [loa, setLoa] = useState(!!p.loa)

  const save = async () => {
    const res = await rpc('assign_member', { target: p.id, new_role: role as AppRole, new_division: bureau as Bureau, set_active: active })
    if (res.error) { toast(`Update failed: ${res.error.message}`, 'danger'); return }
    const nm = name.trim(), bd = badge.trim()
    if (nm !== (p.display_name || '') || bd !== (p.badge_number || '')) {
      const pr = await updateNoSelect('profiles', p.id, { display_name: nm || p.display_name, badge_number: bd || null })
      if (pr.error) toast(`Name/badge save failed: ${pr.error.message}`, 'warn')
    }
    if (loa !== !!p.loa) {
      const lr = await updateNoSelect('profiles', p.id, { loa, loa_since: loa ? new Date().toISOString() : null })
      if (lr.error) toast(`Role saved; LOA update failed: ${lr.error.message}`, 'warn')
    }
    toast('Member updated', 'success')
    onChanged()
    onClose()
  }

  // Command/Owner may deny a person portal access (app-level block) or restore
  // it. Bureau-lead scoping is enforced server-side by deny_member_login().
  const canDenyThis = !!me && (me.is_owner || (isCommandRole(me.role) && !p.is_owner && me.id !== p.id))

  const denyLogin = async () => {
    if (me && me.id === p.id) { toast('You cannot deny your own login.', 'warn'); return }
    const reason = await uiPrompt(
      `Deny ${p.display_name || 'this member'} access to the CID Portal?\n\nThey can still sign in but will see an "Access denied" screen with your reason and cannot submit a membership request. This is reversible.`,
      { title: 'Deny login', placeholder: 'Reason shown to the member (optional)', confirmText: 'Deny access' },
    )
    if (reason === null) return
    const res = await rpc('deny_member_login', { p_target: p.id, p_reason: reason })
    if (res.error) { toast(`Deny failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name || 'Member'} denied access`, 'warn')
    onChanged()
    onClose()
  }

  const restoreLogin = async () => {
    const ok = await uiConfirm(
      `Restore ${p.display_name || 'this member'}'s access?\n\nThey return to inactive and can submit a membership request again (Command still approves before they are active).`,
      { confirmText: 'Restore access' },
    )
    if (!ok) return
    const res = await rpc('restore_member_login', { p_target: p.id })
    if (res.error) { toast(`Restore failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name || 'Member'} access restored`, 'success')
    onChanged()
    onClose()
  }

  const removePermanently = async () => {
    if (me && me.id === p.id) { toast('You cannot remove yourself.', 'warn'); return }
    const ok = await uiConfirm(
      `Permanently remove ${p.display_name || 'this member'} from CID?\n\nThey lose all access immediately and their sign-in email is cleared. Their authored cases, reports and audit trail are preserved. This is reversible only by a director restoring them.`,
      { confirmText: 'Remove permanently', danger: true },
    )
    if (!ok) return
    const res = await rpc('admin_remove_member', { p_target: p.id })
    if (res.error) { toast(`Remove failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name || 'Member'} permanently removed`, 'warn')
    onChanged()
    onClose()
  }

  const dirty = () =>
    name.trim() !== (p.display_name || '') || badge.trim() !== (p.badge_number || '') ||
    role !== p.role || bureau !== (p.division || 'LSB') || active !== !!p.active || loa !== !!p.loa

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title="Manage Officer" onClose={onClose} />
        <p className="mb-3 text-[11px] text-slate-500">{email}</p>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Display Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Badge #</label>
            <input value={badge} onChange={(e) => setBadge(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-badge-500" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">
              {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Bureau</label>
            <select value={bureau} onChange={(e) => setBureau(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">
              {BUREAU_KEYS.map((b) => <option key={b}>{b}</option>)}
            </select>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-emerald-500" /> Active (approved for access)
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={loa} onChange={(e) => setLoa(e.target.checked)} className="accent-amber-500" /> On LOA (Leave of Absence) — informational; auto-routes sign-offs around this officer
        </label>
        <button onClick={() => void save()} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
          Save
        </button>
        <div className="mt-4 border-t border-white/5 pt-3">
          <p className="mb-2 text-[11px] uppercase tracking-wider text-rose-300/70">Danger zone</p>
          {canDenyThis && (p.login_denied ? (
            <div className="mb-2">
              <button onClick={() => void restoreLogin()} className="w-full rounded-lg border border-emerald-500/30 bg-emerald-500/5 py-2.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/10">
                Restore login access
              </button>
              <p className="mt-1.5 text-[10px] text-slate-500">This member is currently <b className="text-rose-300">denied access</b>. Restoring returns them to inactive so they can request access again.</p>
            </div>
          ) : (
            <div className="mb-2">
              <button onClick={() => void denyLogin()} className="w-full rounded-lg border border-rose-500/30 bg-rose-500/5 py-2.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">
                Deny login access
              </button>
              <p className="mt-1.5 text-[10px] text-slate-500">Blocks the portal with an “Access denied” screen (reason shown) and stops them submitting a membership request. Reversible.</p>
            </div>
          ))}
          <button onClick={() => void removePermanently()} className="w-full rounded-lg border border-rose-500/30 bg-rose-500/5 py-2.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">
            Permanently remove from CID
          </button>
          <p className="mt-1.5 text-[10px] text-slate-500">
            Blocks all access, clears their sign-in email, unassigns their cases and hides them from the roster. Cases, reports and audit history they authored are kept. A director can restore them (they return inactive, pending re-approval).
          </p>
        </div>
      </div>
    </Modal>
  )
}
