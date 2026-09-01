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
import { useCapabilities } from '@/lib/capabilities'
import { bureauLabel } from '@/lib/roles'
import { Badge } from '@/components/ui/Badge'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { CommandCenterOverview } from './sections/Overview'
import { CasesAssignments } from './sections/CasesAssignments'
import { IntelOversight } from './sections/IntelOversight'
import { ChainOfCommand } from './sections/ChainOfCommand'
import { PersonnelAdmin } from './sections/PersonnelAdmin'
import { ApprovalQueue } from './sections/ApprovalQueue'
import { PromotionsTransfers } from './sections/PromotionsTransfers'
import { DutyStatus } from './sections/DutyStatus'
import { PermissionsOverview } from './sections/PermissionsOverview'
import { CommandComms } from './sections/CommandComms'
import { FieldOfficers } from './sections/FieldOfficers'

export const CC_SECTIONS = [
  { id: 'overview', label: 'Overview', sub: 'Decision queues, bureau workload and what awaits you' },
  { id: 'cases', label: 'Cases & Assignments', sub: 'Unassigned, awaiting review, returned, stale and overdue queues' },
  { id: 'intel', label: 'Intelligence Oversight', sub: 'Field intel queues, MDT export approvals and registry hygiene' },
  { id: 'chain', label: 'Chain of Command', sub: 'Roles, bureaus and the sign-off chain' },
  { id: 'personnel', label: 'Personnel & Admin', sub: 'Approve, manage, promote, transfer, remove' },
  { id: 'approvals', label: 'Approval Queue', sub: 'Pending member approvals + sign-offs awaiting you' },
  { id: 'promotions', label: 'Promotions & Transfers', sub: 'Rank + bureau changes, with history' },
  { id: 'duty', label: 'Duty Status', sub: 'Who is active or on LOA, by bureau' },
  { id: 'permissions', label: 'Permissions', sub: 'Who can do what — the access matrix' },
  { id: 'field', label: 'Field Intelligence Officers', sub: 'Appoint SAHP, BCSO and LSPD accounts — portal access only, never CID' },
  { id: 'comms', label: 'Announcements & Analytics', sub: 'Post division notices; division analytics' },
] as const
type SectionId = (typeof CC_SECTIONS)[number]['id']

export function CommandCenterView() {
  const { state, isCommand, isOwner } = useAuth()
  const { commandScope } = useCapabilities()
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
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-200">
        <p className="font-semibold text-amber-100">Command access required</p>
        <p className="mt-1">The Command Center is for command staff (Bureau Lead and above) and the portal owner. Your account doesn’t hold a command role. Contact Command if you believe this is an error.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Command Center"
        subtitle={`The single home for command administration — ${active.sub.toLowerCase()}.`}
        actions={
          // Command reach, on every section: a Bureau Lead acts within their
          // bureau; DD/Director (and the Owner) see the whole division.
          <Badge tone={commandScope?.level === 'bureau' ? 'accent' : 'neutral'}>
            {commandScope?.level === 'bureau'
              ? `Your bureau: ${bureauLabel(commandScope.bureau)}`
              : 'Scope: Division-wide'}
          </Badge>
        }
      />

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
              <span className="whitespace-nowrap lg:whitespace-normal">{s.label}</span>
            </button>
          ))}
        </nav>

        <section className="min-w-0">
          {section === 'overview' && <CommandCenterOverview onGo={(id) => go(id as SectionId)} />}
          {section === 'cases' && <CasesAssignments />}
          {section === 'intel' && <IntelOversight onGo={(id) => go(id as SectionId)} />}
          {section === 'chain' && <ChainOfCommand />}
          {section === 'personnel' && <PersonnelAdmin />}
          {section === 'approvals' && <ApprovalQueue />}
          {section === 'promotions' && <PromotionsTransfers />}
          {section === 'duty' && <DutyStatus />}
          {section === 'permissions' && <PermissionsOverview />}
          {section === 'field' && <FieldOfficers />}
          {section === 'comms' && <CommandComms />}
        </section>
      </div>
    </div>
  )
}
