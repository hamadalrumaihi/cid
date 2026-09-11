'use client'

/** Owner Console → System Health → Jobs: the latest 50 `background_jobs`
 *  rows (RLS hands the Owner every row) with status, progress, attempts and
 *  the Cancel / Retry actions. Reads through the shared jobs adapter
 *  (lib/services/queues/jobs — the same hook the Documents tab's JobsTray
 *  uses per case) so the two surfaces never disagree on a job's state. */
import { useAuth } from '@/lib/auth'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { canCancelJob, cancelJob, jobLabel, jobProgressPct, jobProgressText, jobStatusTone, retryJob, useMyJobs, type JobRow } from '@/lib/services/queues/jobs'
import { humanizeError, toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'
import { uiPrompt } from '@/components/ui/dialog'
import { ErrorNotice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { OwnerPanel } from './OwnerPanel'

function Progress({ job }: { job: JobRow }) {
  const pct = jobProgressPct(job.progress)
  const text = jobProgressText(job.progress)
  if (pct === null && !text) return <span className="text-slate-400">—</span>
  return (
    <div className="min-w-[8rem]">
      {pct !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${jobLabel(job.kind)} progress`}>
          <div className="h-full rounded-full bg-badge-500" style={{ width: `${pct}%` }} />
        </div>
      )}
      <p className="mt-0.5 truncate text-[11px] text-slate-400">{pct !== null ? `${pct}%` : ''}{pct !== null && text ? ' · ' : ''}{text ?? ''}</p>
    </div>
  )
}

export function JobsPanel() {
  const { profile, isOwner } = useAuth()
  const { jobs, loading, error, refresh } = useMyJobs({ limit: 50 })
  const me = profile?.id ?? null

  const act = async (fn: () => Promise<{ error: { message: string } | null }>, ok: string) => {
    const r = await fn()
    if (r.error) { toast(humanizeError(r.error.message), 'danger'); return }
    toast(ok, 'success')
    await refresh()
  }
  const cancel = async (job: JobRow) => {
    const reason = await uiPrompt(`Why cancel “${jobLabel(job.kind)}”? The reason is recorded in the audit log.`, { title: 'Cancel job', placeholder: 'Reason', confirmText: 'Cancel job' })
    if (reason === null) return
    await act(() => cancelJob(job.id, reason.trim() || 'cancelled by the Owner'), 'Job cancelled.')
  }

  const columns: DataColumn<JobRow>[] = [
    { key: 'kind', label: 'Job', value: (j) => `${jobLabel(j.kind)} ${j.kind}`, render: (j) => (
      <span className="block min-w-0">
        <span className="block text-sm text-white">{jobLabel(j.kind)}</span>
        <span className="block font-mono text-[11px] text-slate-400">{j.kind}</span>
      </span>
    ) },
    { key: 'queue', label: 'Queue', value: (j) => j.queue, render: (j) => <span className="font-mono text-blue-300">{j.queue}</span> },
    { key: 'status', label: 'Status', value: (j) => j.status, render: (j) => <Badge tone={jobStatusTone(j.status)}>{j.status}</Badge> },
    { key: 'progress', label: 'Progress', value: (j) => String(jobProgressPct(j.progress) ?? ''), render: (j) => <Progress job={j} /> },
    { key: 'attempts', label: 'Attempts', value: (j) => `${j.attempts}/${j.max_attempts}`, sortValue: (j) => j.attempts, className: 'tabular-nums' },
    { key: 'created', label: 'Created', value: (j) => fmtDateTime(j.created_at), sortValue: (j) => j.created_at, render: (j) => <span title={fmtDateTime(j.created_at)}>{timeAgo(j.created_at)}</span> },
    { key: 'finished', label: 'Finished', value: (j) => (j.finished_at ? fmtDateTime(j.finished_at) : ''), sortValue: (j) => j.finished_at ?? '', render: (j) => (j.finished_at ? <span title={fmtDateTime(j.finished_at)}>{timeAgo(j.finished_at)}</span> : <span className="text-slate-400">—</span>) },
    { key: 'error', label: 'Error', value: (j) => j.error ?? '', render: (j) => (j.error ? <span className="block max-w-[16rem] truncate text-rose-200/80" title={j.error}>{j.error}</span> : <span className="text-slate-400">—</span>) },
    { key: 'actions', label: '', value: () => '', render: (j) => (
      <span className="flex justify-end gap-1">
        {canCancelJob(j, me, isOwner) && <Button size="sm" variant="ghost" className="text-rose-300 hover:text-rose-200" onAction={() => cancel(j)}>Cancel</Button>}
        {isOwner && (j.status === 'failed' || j.status === 'cancelled') && <Button size="sm" variant="secondary" onAction={() => act(() => retryJob(j.id), 'Job queued again.')}>Retry</Button>}
      </span>
    ) },
  ]

  return (
    <OwnerPanel title="Jobs" sub="The latest 50 background jobs (every creator — RLS hands the Owner the whole table). Live: rows move as the runner or worker heartbeats." actions={<Button size="sm" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh'}</Button>}>
      {error ? <ErrorNotice message={error} onRetry={() => void refresh()} /> : loading && !jobs.length ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : (
        <DataTable<JobRow>
          columns={columns}
          rows={jobs}
          rowKey={(j) => j.id}
          pageSize={25}
          initialSort={{ key: 'created', dir: 'desc' }}
          filterPlaceholder="Filter jobs…"
          emptyText="No background jobs yet — the first upload, packet or source fetch creates one."
          dense
        />
      )}
    </OwnerPanel>
  )
}
