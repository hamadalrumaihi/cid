'use client'

/** Command Center — the single home for command-level administration. Gated
 *  to command roles (Bureau Lead / Deputy Director / Director) and the owner;
 *  the visible gate is UX only — every action still flows through the existing
 *  SECURITY DEFINER RPCs and RLS (`private.is_command()` / `is_owner()`),
 *  which are the real wall. Consolidates member administration, the approval
 *  queues, promotions/transfers, the chain of command, duty status and the
 *  permissions overview, and surfaces the division dashboard, analytics and
 *  announcement tools that also live on their own member-facing tabs.
 *
 *  Section pattern mirrors the Owner Portal (SECTIONS + `?s=` deep-links). */
import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { CommandCenterOverview } from './sections/Overview'
import { ChainOfCommand } from './sections/ChainOfCommand'
import { PersonnelAdmin } from './sections/PersonnelAdmin'
import { ApprovalQueue } from './sections/ApprovalQueue'
import { PromotionsTransfers } from './sections/PromotionsTransfers'
import { DutyStatus } from './sections/DutyStatus'
import { PermissionsOverview } from './sections/PermissionsOverview'
import { CommandComms } from './sections/CommandComms'

export const CC_SECTIONS = [
  { id: 'overview', icon: '🛰️', label: 'Overview', sub: 'Command KPIs and what needs a decision' },
  { id: 'chain', icon: '🏛️', label: 'Chain of Command', sub: 'Roles, bureaus and the sign-off chain' },
  { id: 'personnel', icon: '👥', label: 'Personnel & Admin', sub: 'Approve, manage, promote, transfer, remove' },
  { id: 'approvals', icon: '✅', label: 'Approval Queue', sub: 'Pending member approvals + sign-offs awaiting you' },
  { id: 'promotions', icon: '🎖️', label: 'Promotions & Transfers', sub: 'Rank + bureau changes, with history' },
  { id: 'duty', icon: '🟢', label: 'Duty Status', sub: 'Who is active or on LOA, by bureau' },
  { id: 'permissions', icon: '🔐', label: 'Permissions', sub: 'Who can do what — the access matrix' },
  { id: 'comms', icon: '📣', label: 'Announcements & Analytics', sub: 'Post division notices; division analytics' },
] as const
type SectionId = (typeof CC_SECTIONS)[number]['id']

export function CommandCenterView() {
  const { state, isCommand, isOwner } = useAuth()
  const sp = useSearchParams()
  const router = useRouter()
  const raw = sp.get('s') as SectionId | null
  // Derive the section from the URL — deep-links and back/forward just work.
  const section: SectionId = raw && CC_SECTIONS.some((s) => s.id === raw) ? raw : 'overview'

  const go = useCallback((id: SectionId) => {
    const params = new URLSearchParams(sp.toString())
    params.set('s', id)
    router.replace(`/command-center?${params.toString()}`)
  }, [sp, router])

  const canAccess = isCommand || isOwner
  const active = useMemo(() => CC_SECTIONS.find((s) => s.id === section) ?? CC_SECTIONS[0], [section])

  if (state !== 'in') {
    return <Notice text="Sign in to access the Command Center." />
  }
  if (!canAccess) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-200">
        <p className="font-semibold text-amber-100">Command access required</p>
        <p className="mt-1">The Command Center is for command staff (Bureau Lead and above) and the portal owner. Your account doesn’t hold a command role — this is enforced by the database, not just this screen.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <Card>
        <PageHeader
          title="🛡️ Command Center"
          subtitle={`The single home for command administration — ${active.sub.toLowerCase()}.`}
        />
      </Card>

      <div className="grid gap-5 lg:grid-cols-[15rem_1fr]">
        <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Command Center sections">
          {CC_SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => go(s.id)}
              aria-current={section === s.id ? 'page' : undefined}
              className={`flex flex-shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition lg:w-full ${
                section === s.id ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              <span aria-hidden>{s.icon}</span>
              <span className="whitespace-nowrap lg:whitespace-normal">{s.label}</span>
            </button>
          ))}
        </nav>

        <section className="min-w-0">
          {section === 'overview' && <CommandCenterOverview onGo={(id) => go(id as SectionId)} />}
          {section === 'chain' && <ChainOfCommand />}
          {section === 'personnel' && <PersonnelAdmin />}
          {section === 'approvals' && <ApprovalQueue />}
          {section === 'promotions' && <PromotionsTransfers />}
          {section === 'duty' && <DutyStatus />}
          {section === 'permissions' && <PermissionsOverview />}
          {section === 'comms' && <CommandComms />}
        </section>
      </div>
    </div>
  )
}
