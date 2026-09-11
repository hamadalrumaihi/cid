'use client'

/** Reports — the case's report rows with their review state, a link into
 *  the Reports tab and, on demand, the SAME recorded export menu the
 *  Reports tab renders (report_record_export first, then the file). The
 *  export inputs (pinned template version, latest sealed version, entities)
 *  are resolved only when somebody asks, so the list stays one query. */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/Notice'
import { ReportIcon } from '@/components/shell/icons'
import { ReportExportMenu, type ReportExportInputs } from '../reports/ReportExportMenu'
import { loadReportEntities, toEntityItem } from '../reports/ReportEntities'
import { caseLink } from '@/lib/caseLinks'
import { list } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import type { ReportRow } from '@/lib/documents'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { reportTitle } from '@/lib/forms'
import { officerName } from '@/lib/profiles'
import { parseSignatureLike } from '@/lib/reportExport'
import {
  REPORT_REVIEW_LABEL, loadPublishedTemplates, reportReviewTone, resolveReportVersion, reviewStatusOf, type TemplateCatalog,
} from '@/lib/reportTemplates'
import { toast } from '@/lib/toast'
import type { CaseRow } from '../shared'

export function ReportsSection({ c, rows }: { c: Pick<CaseRow, 'id' | 'case_number' | 'title'>; rows: ReportRow[] }) {
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null)
  useEffect(() => {
    let alive = true
    void loadPublishedTemplates().then((cat) => { if (alive) setCatalog(cat) }).catch(() => undefined)
    return () => { alive = false }
  }, [])
  const titleOf = (r: ReportRow) => reportTitle(r, catalog?.templates.find((t) => t.key === r.template)?.name)

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ReportIcon className="h-5 w-5" />}
        title="No reports on this case"
        hint="Reports written on the Reports tab are listed here with their review state and recorded export."
      />
    )
  }
  return (
    <ul className="divide-y divide-white/5 rounded-lg border border-white/10" aria-label="Reports">
      {rows.map((r) => <ReportLine key={r.id} c={c} r={r} title={titleOf(r)} catalog={catalog} />)}
    </ul>
  )
}

function ReportLine({ c, r, title, catalog }: { c: Pick<CaseRow, 'id' | 'case_number' | 'title'>; r: ReportRow; title: string; catalog: TemplateCatalog | null }) {
  const status = reviewStatusOf(r)
  const [exportInput, setExportInput] = useState<ReportExportInputs | null>(null)
  const [loading, setLoading] = useState(false)

  const prepareExport = async () => {
    if (exportInput || loading) return
    setLoading(true)
    try {
      const [version, latest, entities] = await Promise.all([
        resolveReportVersion(r, catalog?.templates ?? null),
        r.finalized
          ? list('report_versions', { eq: { report_id: r.id }, order: 'version_number', ascending: false, limit: 1 }).then((v) => (v[0] as Tables<'report_versions'> | undefined) ?? null)
          : Promise.resolve(null),
        loadReportEntities(r.id).catch(() => []),
      ])
      if (!version) { toast('The report’s template could not be resolved.', 'danger'); return }
      setExportInput({
        report: r, version: latest, schema: version.schema, templateName: title, templateVersion: version.versionNumber || null,
        caseNumber: c.case_number, caseTitle: c.title, entities: entities.map(toEntityItem),
        authorSignature: parseSignatureLike(r.signature), reviewerSignature: parseSignatureLike(r.reviewer_signature),
        reviewStatusLabel: (st) => REPORT_REVIEW_LABEL[reviewStatusOf({ review_status: st, finalized: r.finalized })],
      } as ReportExportInputs)
    } finally {
      setLoading(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
      <span className="min-w-0 flex-1 basis-48 truncate text-sm font-medium text-white" title={title}>{title}</span>
      <Badge tone={reportReviewTone(status)}>{REPORT_REVIEW_LABEL[status]}</Badge>
      <span className="text-xs text-slate-400">{officerName(r.author_id) ?? 'Officer'}</span>
      <time dateTime={r.created_at} title={fmtDateTime(r.created_at)} className="text-xs text-slate-400 tabular-nums">{fmtDate(r.created_at)}</time>
      <span className="flex flex-wrap items-center gap-1">
        <Link
          href={caseLink(c.id, 'reports', { report: r.id })}
          className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-slate-200 transition hover:bg-white/10 lg:min-h-0 lg:py-1.5"
        >
          Open
        </Link>
        {exportInput
          ? <ReportExportMenu input={exportInput} />
          : <Button size="sm" loading={loading} onClick={() => void prepareExport()}>Export…</Button>}
      </span>
    </li>
  )
}
