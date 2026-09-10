'use client'

/** Brief — the case facts as a card (no table), read-only on the phone. */
import { fmtDate } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { bureauLabel } from '@/lib/roles'
import { Card } from '@/components/ui/Card'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { DesktopOnlyCard, type MobileCase } from './mobileShared'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="flex-shrink-0 text-xs font-medium text-slate-400">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-200">{children}</dd>
    </div>
  )
}

export function MobileOverview({ c }: { c: MobileCase }) {
  return (
    <>
      <Card pad="sm">
        <dl className="divide-y divide-white/5">
          <Fact label="Case number"><span className="font-mono font-semibold text-white">{c.case_number}</span></Fact>
          <Fact label="Bureau">{bureauLabel(c.bureau)}{c.is_joint_case ? ' · joint' : ''}</Fact>
          <Fact label="Lead">{officerName(c.lead_detective_id) || 'Unassigned'}</Fact>
          <Fact label="Stage">{c.investigative_stage.replace(/_/g, ' ')}</Fact>
          {c.area && <Fact label="Area">{c.area}</Fact>}
          <Fact label="Opened">{fmtDate(c.created_at)}</Fact>
          <Fact label="Updated">{fmtDate(c.updated_at)}</Fact>
          {c.follow_up_at && <Fact label="Follow-up"><DeadlineChip at={c.follow_up_at} kind="due" /></Fact>}
        </dl>
      </Card>
      <Card pad="sm">
        <h3 className="mb-1 text-[13px] font-semibold text-white">Summary</h3>
        {c.summary?.trim()
          ? <p className="whitespace-pre-wrap text-sm text-slate-200">{c.summary}</p>
          : <p className="text-sm text-slate-400">No summary yet.</p>}
      </Card>
      <DesktopOnlyCard caseId={c.id} section="overview" title="Edit the case on the desktop" hint="Title, status, lead, bureau and the summary are edited in the workspace." />
    </>
  )
}
