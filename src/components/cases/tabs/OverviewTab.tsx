'use client'

import { useCallback, useEffect, useState } from 'react'
import { insert, list, remove } from '@/lib/db'
import { timeAgo } from '@/lib/format'
import { officerName, activeProfiles } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { mutateThen, Stat, type AssignmentRow, type CaseRow } from './shared'

export function OverviewTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [evidence, setEvidence] = useState(0)
  const [reports, setReports] = useState(0)
  const vA = useTableVersion('case_assignments')
  const vE = useTableVersion('evidence')
  const vR = useTableVersion('reports')
  const refresh = useCallback(async () => {
    try {
      const [a, e, r] = await Promise.all([
        list('case_assignments', { eq: { case_id: c.id } }),
        list('evidence', { eq: { case_id: c.id } }),
        list('reports', { eq: { case_id: c.id } }),
      ])
      setAssignments(a); setEvidence(e.length); setReports(r.length)
    } catch { /* tab can render stale */ }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vA, vE, vR])

  const [assignBusy, setAssignBusy] = useState(false)
  const addAssignment = async () => {
    if (assignBusy) return
    const officer = activeProfiles()[0]?.id
    if (!officer) { toast('No active officers found.', 'warn'); return }
    setAssignBusy(true)
    const res = await insert('case_assignments', { case_id: c.id, officer_id: officer, role: 'support' })
    setAssignBusy(false)
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Officer assigned.', 'success'); void refresh() }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Evidence" value={evidence} />
        <Stat label="Reports" value={reports} />
        <Stat label="Lead" value={officerName(c.lead_detective_id) || 'Unassigned'} />
        <Stat label="Updated" value={timeAgo(c.updated_at).toUpperCase()} />
      </div>
      <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold text-white">Assigned Officers</h3>
          {canEdit && <button onClick={() => void addAssignment()} disabled={assignBusy} className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">Add support</button>}
        </div>
        <div className="flex flex-wrap gap-2">
          {assignments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm text-slate-200">
              {officerName(a.officer_id) || 'Officer'} <span className="text-xs uppercase text-slate-500">{a.role}</span>
              {canDelete && <button onClick={() => mutateThen(remove('case_assignments', a.id), refresh)} className="text-rose-300">x</button>}
            </span>
          ))}
          {!assignments.length && <p className="text-sm text-slate-500">No support assignments recorded.</p>}
        </div>
      </div>
    </div>
  )
}
