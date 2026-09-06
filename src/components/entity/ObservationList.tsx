'use client'

/** The observations recorded for a record across the cases the viewer can
 *  read, with **Promote to record** (reason → `promote_observation`: SrDet+
 *  applies now, a Detective's promotion queues as a suggestion). Rendered by
 *  SuggestedUpdates; split out to keep that file focused. */
import { useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { promoteObservation, refusalText } from '@/lib/entity'
import { fmtDateTime } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { uiPrompt } from '@/components/ui/dialog'
import { fieldLabel } from './labels'

export type ObservationRow = Tables<'entity_field_observations'>

const SOURCE_LABEL: Record<string, string> = {
  manual: 'recorded by hand', report: 'from a report', field_submission: 'from a field submission',
  legal: 'from a legal request', surveillance: 'from surveillance',
}

export function ObservationList({ rows, onChanged }: { rows: ObservationRow[]; onChanged: () => void }) {
  const [caseNumbers, setCaseNumbers] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const caseKey = [...new Set(rows.map((r) => r.case_id))].sort().join(',')

  // One bounded in:{id} lookup for the case numbers — RLS already let the
  // observation through, so the case is readable too.
  useEffect(() => {
    if (!caseKey) return
    let live = true
    list('cases', { select: 'id,case_number', in: { id: caseKey.split(',') } })
      .then((cs) => {
        if (!live) return
        const map: Record<string, string> = {}
        for (const c of cs as unknown as { id: string; case_number: string }[]) map[c.id] = c.case_number
        setCaseNumbers(map)
      })
      .catch(() => { /* the id stays as the fallback label */ })
    return () => { live = false }
  }, [caseKey])

  const promote = async (row: ObservationRow) => {
    const reason = await uiPrompt(
      `Write "${row.value}" to the record's ${fieldLabel(row.field).toLowerCase()}. A senior detective's promotion applies now; anyone else's is queued for review.`,
      { title: 'Promote to the record', placeholder: 'Why the record should carry this value.', confirmText: 'Promote' },
    )
    if (reason === null) return
    if (!reason.trim()) { toast('A reason is required.', 'warn'); return }
    setBusyId(row.id)
    const res = await promoteObservation(row.id, reason.trim())
    setBusyId(null)
    if (res.error || !res.data) { toast(res.error?.message ?? 'Promotion failed.', 'danger'); return }
    if (!res.data.ok) { toast(refusalText(res.data), 'danger'); return }
    toast(res.data.applied ? 'Promoted — the record now carries this value.' : 'Queued for review as a suggested update.', 'success')
    onChanged()
  }

  if (!rows.length) return <p className="text-sm text-slate-400">No case observations for this record.</p>

  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2">
          <Badge tone="neutral">{caseNumbers[r.case_id] ?? 'case'}</Badge>
          <span className="text-sm text-slate-200">
            <span className="font-semibold text-white">{fieldLabel(r.field)}:</span> {r.value}
          </span>
          <span className="text-xs text-slate-400">
            {SOURCE_LABEL[r.source_kind] ?? r.source_kind} · {officerName(r.recorded_by) ?? 'somebody'} · {fmtDateTime(r.created_at)}
          </span>
          {r.note && <span className="w-full text-xs text-slate-400">{r.note}</span>}
          <span className="ml-auto">
            {r.promoted_at ? (
              <Badge tone="good">Promoted</Badge>
            ) : (
              <Button size="sm" variant="secondary" loading={busyId === r.id} onClick={() => void promote(r)}>Promote to record</Button>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}
