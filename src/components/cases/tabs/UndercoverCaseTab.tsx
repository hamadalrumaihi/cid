'use client'

/** Undercover Operations — the restricted case area (procedure §2, §4, §7).
 *
 *  §2 ties every undercover capacity to an authorized CID case, so the case
 *  jacket is where an authorized reader expects to find it. §4 decides who
 *  that reader is, and this tab does NOT widen it: the list is a plain
 *  `uc_operations` read, so `uc_operations_sel` returns the Detective's own
 *  operations, a Bureau Lead's own bureau, and CID Command's division. Every
 *  other viewer — including a detective with full access to this case, and
 *  including a SIB user — gets zero rows.
 *
 *  Which is why `useUcCaseCount` gates the tab the way `useCiCaseCount` gates
 *  CI Intelligence: at zero the tab does not exist. A locked tab, a
 *  placeholder or an empty "Undercover" heading would itself disclose that an
 *  undercover operation is running on this case, and §4 does not authorize
 *  that disclosure to the people who would see it.
 *
 *  Nothing here is an access control. It renders what RLS already returned. */
import { useEffect, useState } from 'react'
import { list } from '@/lib/db'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { bureauShort } from '@/lib/roles'
import { useNow } from '@/lib/useNow'
import {
  retentionInfo, ucOutstandingCount, ucRecordingLabel, ucReviewLabel, ucStatusLabel,
  type UcOperation,
} from '@/lib/undercover'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/Notice'
import { SectionHeader } from '@/components/ui/PageHeader'

/** The rail count. CaseDetail lists the `uc` tab only while this is > 0.
 *  Null until the first read lands (the rail treats null like 0), so the tab
 *  never flickers into existence for a viewer who cannot see anything. */
export function useUcCaseCount(caseId: string): number | null {
  const v = useTableVersion('uc_operations')
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      const rows = await list('uc_operations', { select: 'id', eq: { case_id: caseId } })
        .catch(() => [] as { id: string }[])
      if (live) setCount(rows.length)
    })()
    return () => { live = false }
  }, [caseId, v])

  return count
}

export function UndercoverCaseTab({ caseId }: { caseId: string }) {
  const v = useTableVersion('uc_operations')
  const [rows, setRows] = useState<UcOperation[] | null>(null)
  const now = useNow()

  useEffect(() => {
    let live = true
    void (async () => {
      const data = await list('uc_operations', {
        eq: { case_id: caseId }, order: 'created_at', ascending: false,
      }).catch(() => [] as UcOperation[])
      if (live) setRows(data)
    })()
    return () => { live = false }
  }, [caseId, v])

  return (
    <div className="space-y-3">
      <SectionHeader
        title="Undercover operations"
        subtitle="§2 — undercover work on this case. Visible to the Detective running it, their Bureau Lead, CID Command and High Command only."
      />

      <p role="note" className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
        <span className="font-semibold uppercase tracking-wide">CID Restricted — CID access only.</span>{' '}
        <span className="text-amber-200/90">
          §4 — undercover identities are not to be disclosed outside the positions the procedure authorizes.
        </span>
      </p>

      {!rows?.length ? (
        <EmptyState title="No undercover operation recorded on this case that you are authorized to see." />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const ret = retentionInfo(r, now)
            const owed = ucOutstandingCount(r)
            return (
              <li key={r.id}>
                <Card pad="sm" interactive>
                  <a href={`/undercover?op=${r.id}`} className="block min-h-[44px] sm:min-h-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={r.status === 'compromised' ? 'danger' : r.status === 'active' ? 'good' : 'neutral'}>
                        {ucStatusLabel(r.status)}
                      </Badge>
                      <span className="text-sm font-semibold text-white">
                        {officerName(r.detective_id) || 'Detective'}
                      </span>
                      <Badge>{bureauShort(r.bureau)}</Badge>
                      {r.criminal_activity && (
                        <Badge tone="warn" title="Reported under §5 — a notification duty, not a finding.">
                          Criminal activity reported
                        </Badge>
                      )}
                      {owed > 0 && <Badge tone="warn">{owed} outstanding</Badge>}
                      {r.command_review_status !== 'not_required' && (
                        <Badge tone="accent">{ucReviewLabel(r.command_review_status)}</Badge>
                      )}
                    </div>
                    {r.alias && (
                      <p className="mt-1 text-sm text-slate-300">Identity: {r.alias}</p>
                    )}
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {ucRecordingLabel(r.recording_status)}
                      {r.started_at ? ` · started ${fmtDate(r.started_at)}` : ''}
                      {ret.state === 'holding' && ret.until
                        ? ` · retain until ${fmtDateTime(ret.until)} (${ret.hoursLeft}h)`
                        : ''}
                      {ret.state === 'elapsed' ? ' · 72-hour minimum met' : ''}
                    </p>
                  </a>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
