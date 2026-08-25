'use client'

/** Command Center → Cases & Assignments. The command case queues in one
 *  place: unassigned, awaiting review, returned, stale, and overdue tasks —
 *  bounded projected reads over the RLS-scoped cases window, scoped to a
 *  Bureau Lead's own bureau client-side. Rows LINK into the case detail where
 *  the existing per-case actions (assign lead, sign-off decisions, bureau
 *  reassign, archive) live; bulk assign-lead/status stays on the Cases board.
 *  Nothing here re-implements a write path. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { list } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useCapabilities } from '@/lib/capabilities'
import { fmtDate, timeAgo, todayISO } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { bureauShort } from '@/lib/roles'
import { signoffLabel, signoffTint } from '@/lib/signoff'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/Notice'
import { DashPanel } from '@/components/dash/DashPanel'
import { DashRow } from '@/components/dash/DashRow'
import { caseStaleDays } from '@/components/cases/caseUtils'

type CaseRow = Tables<'cases'>
type TaskRow = Tables<'case_tasks'>

const CASE_COLS =
  'id,case_number,title,status,bureau,lead_detective_id,signoff_status,signoff_assignee_id,signoff_submitted_at,created_at,updated_at,closed_at'
const TASK_COLS = 'id,case_id,title,due,assignee,done,created_at,updated_at'
/** Rows shown per queue — the count chip carries the full number. */
const ROW_CAP = 8

export function CasesAssignments() {
  const router = useRouter()
  const { commandScope } = useCapabilities()
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [cases, setCases] = useState<CaseRow[]>([])
  const [overdueTasks, setOverdueTasks] = useState<TaskRow[]>([])
  const vCases = useTableVersion('cases')
  const vTasks = useTableVersion('case_tasks')

  const refresh = useCallback(async () => {
    void fetchProfiles()
    const [cs, tasks] = await Promise.all([
      list('cases', { select: CASE_COLS, is: { archived_at: null }, order: 'updated_at', ascending: false, limit: 400 })
        .catch(() => [] as CaseRow[]),
      list('case_tasks', { select: TASK_COLS, eq: { done: false }, or: `due.lt.${todayISO()}`, order: 'due', limit: 200 })
        .catch(() => [] as TaskRow[]),
    ])
    setCases(cs)
    setOverdueTasks(tasks)
  }, [fetchProfiles])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vCases, vTasks])

  // Bureau Leads see their bureau's queues; DD/Director/Owner see everything
  // RLS returned. UX scoping only — the reads above are already RLS-trimmed.
  const myBureau = commandScope?.level === 'bureau' ? commandScope.bureau : null
  const scoped = useMemo(
    () => (myBureau ? cases.filter((c) => c.bureau === myBureau) : cases),
    [cases, myBureau],
  )
  const caseById = useMemo(() => new Map(scoped.map((c) => [c.id, c])), [scoped])

  const isOpen = (c: CaseRow) => c.status === 'open' || c.status === 'active'
  const unassigned = scoped
    .filter((c) => isOpen(c) && !c.lead_detective_id)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const awaiting = scoped
    .filter((c) => /^awaiting_/.test(c.signoff_status || ''))
    .sort((a, b) => new Date(a.signoff_submitted_at || a.updated_at).getTime() - new Date(b.signoff_submitted_at || b.updated_at).getTime())
  const returned = scoped.filter((c) => c.signoff_status === 'changes_requested' || c.signoff_status === 'denied')
  const stale = scoped
    .filter((c) => isOpen(c) && caseStaleDays(c) >= 14)
    .sort((a, b) => caseStaleDays(b) - caseStaleDays(a))
  // Overdue tasks attribute through the scoped case window (a task on a case
  // outside it can't be shown with context, so it's omitted here).
  const overdue = overdueTasks.filter((t) => t.case_id && caseById.has(t.case_id))

  const openCase = (id: string) => router.push(`/cases?case=${encodeURIComponent(id)}`)
  const caseTitle = (c: CaseRow) => `${c.case_number} — ${c.title || 'Untitled'}`
  const allClear = !unassigned.length && !awaiting.length && !returned.length && !stale.length && !overdue.length

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400">
        Assign leads, decide sign-offs, reassign bureaus and archive from each case.
        Bulk actions — assigning a lead or changing status for many cases at once — live on the{' '}
        <Link href="/cases" className="rounded font-semibold text-badge-200 transition hover:text-white">Cases board</Link>.
      </p>

      {allClear && (
        <EmptyState
          title="All case queues are clear"
          hint={myBureau ? `Nothing in ${bureauShort(myBureau)} needs a command decision right now.` : 'Nothing needs a command decision right now.'}
        />
      )}

      <DashPanel
        title="Unassigned cases"
        count={unassigned.length}
        hint="Open cases with no lead detective — open one and assign a lead."
        empty={unassigned.length === 0}
      >
        {unassigned.slice(0, ROW_CAP).map((c) => (
          <DashRow
            key={c.id}
            title={caseTitle(c)}
            why={`No lead detective — ${bureauShort(c.bureau)}`}
            meta={timeAgo(c.created_at)}
            onClick={() => openCase(c.id)}
          />
        ))}
      </DashPanel>

      <DashPanel
        title="Awaiting sign-off review"
        count={awaiting.length}
        hint="Stuck in the approval chain, oldest first. Your own decisions also surface in the Approval Queue."
        empty={awaiting.length === 0}
      >
        {awaiting.slice(0, ROW_CAP).map((c) => (
          <DashRow
            key={c.id}
            title={caseTitle(c)}
            why={`${signoffLabel(c.signoff_status)} — waiting on ${officerName(c.signoff_assignee_id) || 'reviewer'}`}
            badge={<Badge tint={signoffTint(c.signoff_status)}>{signoffLabel(c.signoff_status)}</Badge>}
            meta={timeAgo(c.signoff_submitted_at || c.updated_at)}
            onClick={() => openCase(c.id)}
          />
        ))}
      </DashPanel>

      <DashPanel
        title="Returned"
        count={returned.length}
        hint="Sign-off came back — changes requested or denied; the lead must revise and resubmit."
        empty={returned.length === 0}
      >
        {returned.slice(0, ROW_CAP).map((c) => (
          <DashRow
            key={c.id}
            title={caseTitle(c)}
            why={`${signoffLabel(c.signoff_status)} — lead: ${officerName(c.lead_detective_id) || 'unassigned'}`}
            meta={timeAgo(c.updated_at)}
            onClick={() => openCase(c.id)}
          />
        ))}
      </DashPanel>

      <DashPanel
        title="Stale ≥14d"
        count={stale.length}
        hint="Open cases gone quiet past the two-week policy — nudge the lead or move them to cold."
        empty={stale.length === 0}
      >
        {stale.slice(0, ROW_CAP).map((c) => (
          <DashRow
            key={c.id}
            title={caseTitle(c)}
            why={`${caseStaleDays(c)}d without activity — lead: ${officerName(c.lead_detective_id) || 'unassigned'}`}
            meta={timeAgo(c.updated_at)}
            onClick={() => openCase(c.id)}
          />
        ))}
      </DashPanel>

      <DashPanel
        title="Overdue tasks"
        count={overdue.length}
        hint="Case tasks past their due date, across the cases you can see."
        empty={overdue.length === 0}
      >
        {overdue.slice(0, ROW_CAP).map((t) => {
          const c = t.case_id ? caseById.get(t.case_id) : undefined
          return (
            <DashRow
              key={t.id}
              title={t.title}
              why={`Due ${fmtDate(t.due)} — ${officerName(t.assignee) || 'unassigned'}${c ? ` · ${c.case_number}` : ''}`}
              meta={c ? bureauShort(c.bureau) : undefined}
              overdue
              onClick={() => { if (t.case_id) openCase(t.case_id) }}
            />
          )
        })}
      </DashPanel>
    </div>
  )
}
