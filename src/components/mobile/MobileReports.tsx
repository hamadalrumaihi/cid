'use client'

/** Reports — cards over the case's reports (ReportsTab's list query), each
 *  with its review state, author and age. "Edit narrative" appears only
 *  where P8-07 applies (canEditNarrativeOnMobile: the author, draft or
 *  returned, not sealed, on a writable case) and opens MobileNarrativeEditor
 *  in place; everything else — new report, full form, submit, review, seal,
 *  warrant status, export — is the desktop's. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { list } from '@/lib/db'
import { reportTitle } from '@/lib/forms'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useCaseTableVersion } from '@/lib/realtime'
import { canEditNarrativeOnMobile } from '@/lib/reportNarrative'
import { REPORT_REVIEW_LABEL, loadPublishedTemplates, reportReviewTone, reviewStatusOf, type TemplateCatalog } from '@/lib/reportTemplates'
import type { ReportRow } from '@/components/cases/tabs/shared'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { MobileNarrativeEditor } from './MobileNarrativeEditor'
import { DesktopOnlyCard, OpenOnDesktop, type MobileCase } from './mobileShared'

export function MobileReports({ c, canEdit, viewerId }: { c: MobileCase; canEdit: boolean; viewerId: string | null }) {
  const [reports, setReports] = useState<ReportRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null)
  const [editing, setEditing] = useState<ReportRow | null>(null)
  const v = useCaseTableVersion('reports', c.id)

  const refresh = useCallback(async () => {
    try {
      setReports(await list('reports', { eq: { case_id: c.id }, order: 'created_at', ascending: false }))
      setError(null)
    } catch (e) { setError(e) }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  useEffect(() => {
    let alive = true
    void loadPublishedTemplates().then((cat) => { if (alive) setCatalog(cat) })
    return () => { alive = false }
  }, [])
  const nameByKey = useMemo(() => new Map((catalog?.templates ?? []).map((t) => [t.key, t.name])), [catalog])
  const titleOf = (r: ReportRow) => reportTitle(r, nameByKey.get(r.template))

  if (editing) {
    return (
      <MobileNarrativeEditor
        report={editing}
        title={titleOf(editing)}
        catalog={catalog}
        onBack={() => { setEditing(null); void refresh() }}
      />
    )
  }

  return (
    <>
      {error ? (
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      ) : reports === null ? (
        <ListSkeleton count={3} />
      ) : reports.length === 0 ? (
        <EmptyState title="No reports yet" hint="Reports are started from the desktop; their narrative can then be written here." />
      ) : (
        <ul className="space-y-2" aria-label="Case reports">
          {reports.map((r) => {
            const review = reviewStatusOf(r)
            const editable = canEdit && canEditNarrativeOnMobile(r, viewerId)
            return (
              <li key={r.id} className="rounded-lg border border-white/10 bg-ink-950/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 text-sm font-semibold text-white">{titleOf(r)}</p>
                  <Badge tone={reportReviewTone(review)}>{REPORT_REVIEW_LABEL[review]}</Badge>
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
                  <span>{officerName(r.author_id) || 'Officer'}</span>
                  <time dateTime={r.created_at} title={fmtDateTime(r.created_at)}>{timeAgo(r.created_at)}</time>
                  {r.review_note && review === 'returned' && <span className="text-amber-300">Returned: {r.review_note}</span>}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {editable && <Button variant="primary" size="md" onClick={() => setEditing(r)}>Edit narrative</Button>}
                  <OpenOnDesktop caseId={c.id} section="reports" report={r.id} look="ghost">Open on desktop</OpenOnDesktop>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <DesktopOnlyCard caseId={c.id} section="reports" title="New reports, review and sealing happen on the desktop" />
    </>
  )
}
