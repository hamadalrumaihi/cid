'use client'

/** Report Templates — the `/report-templates` tab (plan §8.5, P5-02).
 *
 *  Bureau Leads and above propose DRAFT versions; the Director, Deputy
 *  Director or Owner publish, retire / restore, set the default and create
 *  new template keys. Those gates are mirrors of private.report_template_*
 *  (lib/permissions/mirrors): every RPC re-checks and answers
 *  `{ok:false, message}` when refused — this view only decides what to show. */
import { useMemo } from 'react'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState } from '@/components/ui/Notice'
import { LockIcon } from '@/components/shell/icons'
import { useAuth } from '@/lib/auth'
import { canProposeReportTemplate, canPublishReportTemplate, type CidViewer } from '@/lib/permissions'
import { ReportTemplatesAdmin } from './ReportTemplatesAdmin'

export function ReportTemplatesView() {
  const { state, profile } = useAuth()
  const viewer = useMemo<CidViewer>(() => ({ id: profile?.id, role: profile?.role, division: profile?.division, active: profile?.active, is_owner: profile?.is_owner }), [profile])
  const propose = canProposeReportTemplate(viewer)
  const publish = canPublishReportTemplate(viewer)
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Reports"
        title="Report Templates"
        subtitle="The forms detectives file reports on — versioned, with required fields and review rules. Reports stay pinned to the version they were filed under."
      />
      {state !== 'in' ? null : !propose
        ? <EmptyState icon={<LockIcon size={20} />} title="Command staff only" hint="Bureau Leads propose template drafts; the Director, Deputy Director or Owner publish them." />
        : <ReportTemplatesAdmin canPublish={publish} viewerId={profile?.id ?? null} />}
    </div>
  )
}
