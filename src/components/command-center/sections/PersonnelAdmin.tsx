'use client'

/** Command Center → Personnel & Admin. The member-administration surface,
 *  moved here from the Personnel tab (which is now a read-only directory).
 *  Reuses the existing AdminPanel (approve/manage) + AssignModal (role /
 *  bureau / active / LOA / remove) verbatim — all writes still go through the
 *  `assign_member` / `admin_*` SECURITY DEFINER RPCs. */
import { useCallback, useEffect, useState } from 'react'
import { rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { type RosterProfile, useProfilesStore } from '@/lib/profiles'
import { useJusticeRoster } from '@/lib/justiceRoster'
import { useTableVersion } from '@/lib/realtime'
import { AdminPanel } from '@/components/personnel/AdminPanel'
import { AssignModal } from '@/components/personnel/AssignModal'

export function PersonnelAdmin() {
  const { isCommand } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const justiceByUser = useJusticeRoster((s) => s.byUser)
  const fetchJustice = useJusticeRoster((s) => s.fetch)
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [target, setTarget] = useState<RosterProfile | null>(null)
  const v = useTableVersion('profiles')
  const vj = useTableVersion('justice_memberships')

  const refresh = useCallback(async () => {
    void fetchProfiles()
    void fetchJustice()
    if (isCommand) {
      const r = await rpc('admin_member_emails', undefined as never)
      if (!r.error && Array.isArray(r.data)) setEmails(Object.fromEntries(r.data.map((x) => [x.id, x.email])))
    }
  }, [fetchProfiles, fetchJustice, isCommand])
  useEffect(() => { const t = window.setTimeout(() => { void refresh() }, 0); return () => window.clearTimeout(t) }, [refresh, v, vj])

  return (
    <div className="space-y-4">
      <AdminPanel profiles={profiles} emails={emails} justiceByUser={justiceByUser} onManage={setTarget} onChanged={() => void refresh()} />
      {target && (
        <AssignModal p={target} email={emails[target.id] || ''} onClose={() => setTarget(null)} onChanged={() => void refresh()} />
      )}
      <p className="text-[11px] text-slate-500">The full roster (all officers, with commendations) is on the member-facing <b>Personnel</b> tab; this panel is the command-only administration surface.</p>
    </div>
  )
}
