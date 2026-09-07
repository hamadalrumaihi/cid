'use client'

/** "Mentioned in reports" (P5-04) — the reports whose entity set names this
 *  record, for the dossiers. Two bounded reads, both RLS-filtered:
 *  `report_entities` by (kind, ref_id) — the parent report must be readable
 *  for a row to come back — then the reports and their cases by id. A
 *  report the viewer cannot read is simply absent; the section never hints
 *  at how many are hidden. Each row deep-links into the case's Reports tab
 *  (`?report=<id>`). */
import { useEffect, useState } from 'react'
import { useToolNav } from '@/components/tools/useToolNav'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { caseLink } from '@/lib/caseLinks'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { fmtDate } from '@/lib/format'
import { tplById } from '@/lib/forms'

/** Contract §4 labels — mirrored locally so the section has no dependency
 *  on the reports model. */
const REVIEW_LABEL: Record<string, string> = {
  draft: 'Draft', submitted: 'Awaiting review', returned: 'Returned for revision', approved: 'Sealed',
}
const REVIEW_TONE: Record<string, 'neutral' | 'accent' | 'good' | 'warn'> = {
  draft: 'neutral', submitted: 'accent', returned: 'warn', approved: 'good',
}
const humanize = (s: string | null | undefined): string =>
  s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : ''

type EntityRow = Pick<Tables<'report_entities'>, 'id' | 'report_id' | 'role' | 'label' | 'created_at'>
type ReportLite = Pick<Tables<'reports'>, 'id' | 'case_id' | 'template' | 'kind' | 'seq' | 'review_status' | 'finalized' | 'updated_at'>
type CaseLite = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title'>

interface MentionRow {
  report: ReportLite
  caseRow: CaseLite | null
  roles: string[]
  /** Most recent entity insert for this report. */
  at: string
}

export function ReportMentions({ kind, refId, className = '' }: {
  kind: string
  refId: string
  className?: string
}) {
  const nav = useToolNav()
  const [rows, setRows] = useState<MentionRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  // No realtime hook: report_entities is not in the publication, and the
  // section reloads with the dossier it sits in.
  useEffect(() => {
    let alive = true
    const t = window.setTimeout(async () => {
      try {
        const ents = (await list('report_entities', {
          select: 'id,report_id,role,label,created_at', eq: { kind, ref_id: refId }, order: 'created_at', ascending: false, limit: 200,
        })) as unknown as EntityRow[]
        const reportIds = [...new Set(ents.map((e) => e.report_id))]
        const reports = reportIds.length
          ? (await list('reports', { select: 'id,case_id,template,kind,seq,review_status,finalized,updated_at', in: { id: reportIds } })) as unknown as ReportLite[]
          : []
        const caseIds = [...new Set(reports.map((r) => r.case_id))]
        const cases = caseIds.length
          ? (await list('cases', { select: 'id,case_number,title', in: { id: caseIds } }).catch(() => [])) as unknown as CaseLite[]
          : []
        const byCase = new Map(cases.map((c) => [c.id, c]))
        const out: MentionRow[] = reports.map((r) => {
          const mine = ents.filter((e) => e.report_id === r.id)
          return {
            report: r,
            caseRow: byCase.get(r.case_id) ?? null,
            roles: [...new Set(mine.map((e) => e.role ?? 'reference'))],
            at: mine[0]?.created_at ?? r.updated_at,
          }
        }).sort((a, b) => b.at.localeCompare(a.at))
        if (alive) { setRows(out); setError(null) }
      } catch (e) { if (alive) setError(e) }
    }, 0)
    return () => { alive = false; window.clearTimeout(t) }
  }, [kind, refId])

  const title = (r: ReportLite): string => {
    const base = tplById(r.template)?.name ?? 'Report'
    if (r.kind === 'supplemental') return `${base} — Supplemental #${r.seq ?? ''}`
    if (r.kind === 'followup') return `${base} — Follow-up #${r.seq ?? ''}`
    return base
  }

  return (
    <Card className={className}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-white">Mentioned in reports</h3>
        {rows && rows.length > 0 && <Badge>{rows.length}</Badge>}
      </div>
      {error ? (
        <ErrorNotice message={error} />
      ) : rows === null ? (
        <ListSkeleton count={2} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">No reports you can read reference this record.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {rows.map(({ report, caseRow, roles, at }) => {
            const status = report.finalized ? 'approved' : report.review_status
            return (
              <li key={report.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => nav.openHref(caseLink(report.case_id, 'reports', { report: report.id }))}
                    className="min-h-[40px] text-left text-sm font-semibold text-white hover:text-blue-200 sm:min-h-0"
                    title="Open in the case's Reports tab"
                  >
                    <span className="font-mono text-blue-300">{caseRow?.case_number ?? 'Case'}</span>
                    <span className="font-normal text-slate-400"> · {title(report)}</span>
                  </button>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    <Badge tone={REVIEW_TONE[status] ?? 'neutral'}>{REVIEW_LABEL[status] ?? humanize(status)}</Badge>
                    {roles.map((role) => <Badge key={role} tone="neutral">{humanize(role)}</Badge>)}
                    <span>{fmtDate(at)}</span>
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
