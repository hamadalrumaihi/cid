'use client'

/** Personnel Management — the member work list (Command / Owner).
 *
 *  ONE table, not three. This surface used to be a roster table plus a
 *  "moved to DOJ" list plus a "permanently removed" list, each with its own
 *  shape; a member's account state decided which of the three they appeared
 *  in. State is a COLUMN now: every member is one row, the state is named and
 *  explained, and the filter narrows to the state command is working on.
 *
 *  It is deliberately not a directory. Browsing the division is
 *  /directory (lib/directory) — division-wide, member-safe, no controls. This
 *  is the acting surface: sorted by what is waiting, searched by the
 *  identifiers command types (name, email, callsign, rank, bureau), and every
 *  button leads to an audited SECURITY DEFINER RPC that re-checks authority
 *  server-side. The client gate is cosmetic, as always. */
import { useMemo, useState } from 'react'
import { rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useFieldStanding } from '@/lib/fieldStanding'
import { notify } from '@/lib/notify'
import {
  EMPTY_PERSONNEL_FILTER, PERSONNEL_ACCESS_LABEL, filterPersonnel, isFilteringPersonnel,
  personnelRow, sortPersonnel,
  type PersonnelAccess, type PersonnelFilter, type PersonnelRow,
} from '@/lib/personnel'
import type { RosterProfile } from '@/lib/profiles'
import { AGENCY_LABEL, justiceRoleLabel } from '@/lib/justice'
import type { JusticeIdentity } from '@/lib/justiceRoster'
import { toast } from '@/lib/toast'
import { fmtDate } from '@/lib/format'
import { uiConfirm } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Select } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/Notice'
import { pendingMembership, type RequestLite } from '@/components/command-center/lib/membershipPending'
import { canRestoreMember } from '@/lib/permissions'

interface AdminPanelProps {
  profiles: RosterProfile[]
  emails: Record<string, string>
  /** Active DOJ/Judiciary identities keyed by CID user id — members here were
   *  moved out of CID and must not resurface as pending sign-ins. */
  justiceByUser?: Record<string, JusticeIdentity>
  /** Membership requests (admin_membership_requests) — lets the quick-approve
   *  guard spot recorded rejections/withdrawals client-side. May be null when
   *  not loaded; the server refusal is still the authority. */
  requests?: RequestLite[] | null
  onManage: (p: RosterProfile) => void
  onChanged: () => void
}

const ACCESS_TONE: Record<PersonnelAccess, 'good' | 'warn' | 'danger' | 'neutral' | 'accent'> = {
  active: 'good',
  awaiting_approval: 'warn',
  denied: 'danger',
  field_officer: 'neutral',
  moved_to_justice: 'accent',
  removed: 'neutral',
}

const FILTERS: { id: PersonnelFilter['access']; label: string }[] = [
  { id: 'needs_decision', label: 'Waiting on command' },
  { id: 'all', label: 'Everyone' },
  ...(Object.keys(PERSONNEL_ACCESS_LABEL) as PersonnelAccess[]).map((a) => ({ id: a, label: PERSONNEL_ACCESS_LABEL[a] })),
]

export function AdminPanel({ profiles, emails, justiceByUser = {}, requests = null, onManage, onChanged }: AdminPanelProps) {
  const { profile: me } = useAuth()
  const fieldIds = useFieldStanding((s) => s.ids)
  const fieldLoaded = useFieldStanding((s) => s.loaded)
  const [filter, setFilter] = useState<PersonnelFilter>(EMPTY_PERSONNEL_FILTER)

  const rows = useMemo(() => sortPersonnel(profiles.map((p) => personnelRow(p, {
    emails,
    justiceByUser,
    fieldOfficerIds: fieldLoaded ? fieldIds : null,
  }))), [profiles, emails, justiceByUser, fieldIds, fieldLoaded])

  const shown = useMemo(() => filterPersonnel(rows, filter), [rows, filter])
  const waiting = rows.filter((r) => r.needsDecision).length

  // Shared annotation (lib/membershipPending): a sign-in whose request was
  // rejected/withdrawn is not quick-approvable — that would bypass the
  // recorded decision. Empty when requests are null (the guard degrades to the
  // server refusal below).
  const pm = pendingMembership(profiles, requests, justiceByUser, null, fieldLoaded ? fieldIds : null)
  const signInById = new Map(pm.signIns.map((s) => [s.profile.id, s]))

  // One-click approve for a member genuinely waiting (keeps their current
  // role/bureau — assign_member is activation-only since v1.16).
  const approve = async (row: PersonnelRow) => {
    const entry = signInById.get(row.id)
    if (entry && !entry.actionable) {
      toast(`${row.name}'s membership request was ${entry.requestStatus === 'withdrawn' ? 'withdrawn' : 'rejected'} — re-review it from Membership Review instead.`, 'warn')
      return
    }
    const res = await rpc('assign_member', { target: row.id, set_active: true })
    if (res.error) {
      // Server-side mirror of the same guard — map it to the re-review flow.
      if (/reject|withdraw/i.test(String(res.error.message))) {
        toast(`${row.name} has a previously decided membership request — use Membership Review to record a new decision.`, 'warn')
      } else {
        toast(`Approve failed: ${res.error.message}`, 'danger')
      }
      return
    }
    toast(`${row.name} approved for access`, 'success')
    void notify(row.id, 'member_approved', { detective: me?.display_name || 'Command', reason: 'Your CID access has been approved — welcome aboard.' })
    onChanged()
  }

  const restore = async (row: PersonnelRow) => {
    const ok = await uiConfirm(`Restore ${row.name || 'this member'}? They return as an inactive account and must be re-approved to regain access.`, { confirmText: 'Restore' })
    if (!ok) return
    const res = await rpc('admin_restore_member', { p_target: row.id })
    if (res.error) { toast(`Restore failed: ${res.error.message}`, 'danger'); return }
    toast(`${row.name || 'Member'} restored — pending re-approval`, 'success')
    onChanged()
  }

  return (
    <Card pad="lg">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-white">Member administration</h4>
          <p className="text-xs text-slate-400">
            Approve, assign and manage accounts.{' '}
            {waiting > 0
              ? <span className="text-amber-300">{waiting} waiting on a command decision.</span>
              : <span>Nothing is waiting on a decision.</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="min-w-[12rem]">
            <span className="sr-only">Search members</span>
            <Input
              type="search"
              value={filter.q}
              onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
              placeholder="Name, email, callsign, rank…"
              className="min-h-[40px]"
            />
          </label>
          <label>
            <span className="sr-only">Account state</span>
            <Select
              value={filter.access}
              onChange={(e) => setFilter((f) => ({ ...f, access: e.target.value as PersonnelFilter['access'] }))}
              className="min-h-[40px]"
            >
              {FILTERS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </label>
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          title={isFilteringPersonnel(filter) ? 'No members match those filters' : 'No member accounts yet'}
          hint={isFilteringPersonnel(filter) ? `${rows.length} accounts in total.` : undefined}
          action={isFilteringPersonnel(filter) ? { label: 'Clear filters', onClick: () => setFilter(EMPTY_PERSONNEL_FILTER) } : undefined}
        />
      ) : (
        /* Phones scroll the table inside this wrapper instead of stretching
           the whole page. */
        <div className="overflow-x-auto">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <caption className="sr-only">
              Member accounts: identity, current assignment, access state and availability
            </caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-slate-400">
                <th scope="col" className="px-3 py-2">Member</th>
                <th scope="col" className="px-3 py-2">Assignment</th>
                <th scope="col" className="px-3 py-2">Access</th>
                <th scope="col" className="px-3 py-2">Availability</th>
                <th scope="col" className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {shown.map((row) => {
                const j = justiceByUser[row.id]
                return (
                  <tr key={row.id} className={row.needsDecision ? 'bg-amber-500/5' : ''}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-white">{row.name}</p>
                      <p className="text-[11px] text-slate-500">
                        <span className="font-mono">{row.callsign}</span>
                        {row.email && <> · {row.email}</>}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-slate-300">
                      {row.rankLabel}
                      <span className="block text-[11px] text-slate-500">{row.bureauLabel}</span>
                      {row.access === 'moved_to_justice' && j && (
                        <span className="block text-[11px] text-sky-300">
                          → {justiceRoleLabel(j.justice_role)}, {AGENCY_LABEL[j.agency]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={ACCESS_TONE[row.access]}>{row.accessLabel}</Badge>
                      <span className="mt-0.5 block max-w-[18rem] text-[11px] text-slate-500">{row.accessHint}</span>
                      {row.access === 'removed' && row.profile.removed_at && (
                        <span className="block text-[11px] text-slate-500">removed {fmtDate(row.profile.removed_at)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.onLoa
                        ? <Badge tone="warn">On LOA{row.loaSince ? ` · ${fmtDate(row.loaSince)}` : ''}</Badge>
                        : <span className="text-[11px] text-slate-500">Available</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {/* Approve appears for the one state that is a queue.
                            An external submitter applied for nothing, and a
                            member moved to the DOJ was moved deliberately —
                            one reflexive click on either is the mistake this
                            column exists to prevent. */}
                        {row.needsDecision && (
                          <Button size="sm" variant="secondary" onClick={() => void approve(row)}>Approve</Button>
                        )}
                        {row.access === 'removed'
                          ? canRestoreMember(me) && (
                            <Button size="sm" variant="ghost" onClick={() => void restore(row)}>Restore</Button>
                          )
                          : <Button size="sm" variant="ghost" onClick={() => onManage(row.profile)}>Manage</Button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-500">
        Browsing the division — who is where, and who is available — is the Division Directory. This list is for acting on an account.
      </p>
    </Card>
  )
}
