'use client'

/** Command Center → Approval Queue. One aggregated view of everything waiting
 *  on a command decision: (1) pending member sign-ins to activate, and (2)
 *  cases whose sign-off stage THIS command user can decide. Both actions reuse
 *  the existing server-authoritative paths — one-click approve calls the same
 *  `assign_member` RPC as the Personnel admin panel; case decisions deep-link
 *  into the case Sign-off tab (the `signoff_decide` RPC is the authority). No
 *  new approval workflow — this only surfaces the two that already exist. */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { type RosterProfile, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { ROLE_LABEL } from '@/lib/roles'
import { signoffLabel, signoffTint } from '@/lib/signoff'
import { toast } from '@/lib/toast'
import { canReviewCase } from '../lib/approvals'

type CaseRow = Tables<'cases'>

export function ApprovalQueue() {
  const { profile } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const router = useRouter()
  const [cases, setCases] = useState<CaseRow[]>([])
  const vP = useTableVersion('profiles')
  const vC = useTableVersion('cases')

  const refresh = useCallback(async () => {
    void fetchProfiles()
    try { setCases(await list('cases', { order: 'updated_at', ascending: false })) } catch { /* stale */ }
  }, [fetchProfiles])
  useEffect(() => { const t = window.setTimeout(() => { void refresh() }, 0); return () => window.clearTimeout(t) }, [refresh, vP, vC])

  const pending = profiles.filter((p) => !p.removed_at && !p.active)
  const reviews = cases.filter((c) => canReviewCase(c, profile))

  const approve = async (p: RosterProfile) => {
    const res = await rpc('assign_member', { target: p.id, new_role: p.role, new_division: p.division, set_active: true })
    if (res.error) { toast(`Approve failed: ${res.error.message}`, 'danger'); return }
    toast(`${p.display_name} approved for access`, 'success')
    void notify(p.id, 'member_approved', { detective: profile?.display_name || 'Command', reason: 'Your CID access has been approved — welcome aboard.' })
    void refresh()
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-ink-900/45 p-5">
        <h3 className="mb-1 font-bold text-white">Pending member approvals <span className="text-slate-500">({pending.length})</span></h3>
        <p className="mb-3 text-xs text-slate-400">New sign-ins are inactive until a command user activates them.</p>
        {pending.length ? (
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5">
                <div><p className="text-sm font-semibold text-white">{p.display_name}</p><p className="text-[11px] text-slate-400">{ROLE_LABEL[p.role] || p.role} · {p.division}</p></div>
                <button onClick={() => void approve(p)} className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20">✓ Approve</button>
              </div>
            ))}
          </div>
        ) : <p className="text-sm text-emerald-300">✓ No pending sign-ins.</p>}
      </section>

      <section className="rounded-2xl border border-white/10 bg-ink-900/45 p-5">
        <h3 className="mb-1 font-bold text-white">Sign-offs awaiting your decision <span className="text-slate-500">({reviews.length})</span></h3>
        <p className="mb-3 text-xs text-slate-400">Cases at a stage your role can decide. Opens the case Sign-off tab, where the decision is recorded.</p>
        {reviews.length ? (
          <div className="space-y-2">
            {reviews.map((c) => (
              <button key={c.id} onClick={() => router.push(`/cases?case=${c.id}&tab=signoff`)} className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-950/50 px-4 py-2.5 text-left transition hover:border-badge-400/50">
                <div><p className="font-mono text-sm font-bold text-white">{c.case_number}</p><p className="text-[11px] text-slate-400">{c.title || 'Untitled'} · {c.bureau}</p></div>
                <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${signoffTint(c.signoff_status)}`}>{signoffLabel(c.signoff_status)}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-sm text-emerald-300">✓ No sign-offs waiting on you.</p>}
      </section>
      <p className="text-[11px] text-slate-500">The same reviews appear on your <b>My Desk</b> tab; this is the command-wide aggregate. Decisions and member activation are unchanged — the database enforces who may decide each stage.</p>
    </div>
  )
}
