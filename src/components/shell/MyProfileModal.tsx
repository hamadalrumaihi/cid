'use client'

/** My Profile editor — vanilla collab.js openMyProfile(): display name, badge
 *  number and the LOA self-service toggle. Saves via updateNoSelect because a
 *  member cannot read back their own email column (command-only grant).
 *  Mounted fresh per open, so field state initializes from the profile. */
import { useState } from 'react'
import { updateNoSelect } from '@/lib/db'
import { initials } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { deptLabel, roleLabel } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { safeUrl } from '@/lib/safeUrl'

/* eslint-disable @next/next/no-img-element -- tiny external OAuth avatar */

export function MyProfileModal({ onClose }: { onClose: () => void }) {
  const { profile, refresh } = useAuth()
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [name, setName] = useState(profile?.display_name || '')
  const [badge, setBadge] = useState(profile?.badge_number || '')
  const [loa, setLoa] = useState(!!profile?.loa)

  if (!profile) return null
  const avatar = safeUrl(profile.avatar_url ?? '')

  const dirty = () =>
    name.trim() !== (profile.display_name || '') || badge.trim() !== (profile.badge_number || '') || loa !== !!profile.loa

  const save = async () => {
    const patch = {
      display_name: name.trim() || profile.display_name,
      badge_number: badge.trim() || null,
      loa,
      loa_since: loa ? profile.loa_since || new Date().toISOString() : null,
    }
    const res = await updateNoSelect('profiles', profile.id, patch)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Profile updated', 'success')
    void refresh()
    void fetchProfiles()
    onClose()
  }

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title="My Profile" onClose={onClose} />
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-600 to-slate-700 text-lg font-bold text-white">
            {avatar ? <img src={avatar} className="h-14 w-14 rounded-2xl object-cover" alt="" /> : initials(profile.display_name)}
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider text-blue-300/80">{roleLabel(profile.role)}</p>
            <p className="text-sm text-slate-300">{deptLabel(profile.division)} · {profile.email || ''}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Display name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Badge number</label>
            <input value={badge} onChange={(e) => setBadge(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-badge-500" />
          </div>
        </div>
        <label className="mt-4 flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-3 text-sm text-slate-200">
          <input type="checkbox" checked={loa} onChange={(e) => setLoa(e.target.checked)} className="accent-amber-500" />
          <span><b>On Leave of Absence (LOA)</b> — informational only. You can still sign in and sign off cases; sign-off auto-routes around you while on LOA.</span>
        </label>
        <button onClick={() => void save()} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
          Save
        </button>
      </div>
    </Modal>
  )
}
