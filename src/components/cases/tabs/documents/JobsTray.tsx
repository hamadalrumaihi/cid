'use client'

/** The case's background jobs (RLS: the creator's own, or every job for an
 *  Owner) — kind, status, progress, error, and the two RPC actions: Cancel
 *  (creator while queued, Owner) and Retry (Owner, failed / cancelled). The
 *  UI never waits on a job; this tray is where "you'll be notified" can be
 *  watched when somebody wants to. */
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { uiPrompt } from '@/components/ui/dialog'
import { useAuth } from '@/lib/auth'
import { fmtDateTime, timeAgo } from '@/lib/format'
import {
  cancelJob, jobActive, jobCancellable, jobKindLabel, jobProgressOf, jobRetryable, jobStatusLabel, jobStatusTone, retryJob,
  type BackgroundJobRow,
} from '@/lib/packets'
import { toast } from '@/lib/toast'

export function JobsTray({ jobs, onChanged }: { jobs: BackgroundJobRow[]; onChanged: () => void }) {
  const { profile, isOwner } = useAuth()
  const viewerId = profile?.id ?? null
  const active = jobs.filter(jobActive).length
  const [open, setOpen] = useState(false)
  if (jobs.length === 0) return null
  const expanded = open || active > 0

  const cancel = async (j: BackgroundJobRow) => {
    const reason = await uiPrompt('Optional reason — recorded in the audit log.', { title: `Cancel ${jobKindLabel(j.kind).toLowerCase()}`, confirmText: 'Cancel job' })
    if (reason === null) return
    const r = await cancelJob(j.id, reason.trim() || 'Cancelled by requester')
    if (!r.ok) { toast(r.message ?? 'Could not cancel the job.', 'danger'); return }
    toast('Job cancelled.', 'success')
    onChanged()
  }
  const retry = async (j: BackgroundJobRow) => {
    const r = await retryJob(j.id)
    if (!r.ok) { toast(r.message ?? 'Could not retry the job.', 'danger'); return }
    toast('Job re-queued.', 'success')
    onChanged()
  }

  return (
    <section aria-label="Processing jobs" className="rounded-lg border border-white/10 bg-ink-950/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-left"
      >
        <span className="text-sm font-semibold text-white">
          Processing
          <span className="ml-2 text-xs font-medium text-slate-400 tabular-nums">
            {active > 0 ? `${active} active · ` : ''}{jobs.length} job{jobs.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="text-xs text-slate-400">{expanded ? 'Hide' : 'Show'}</span>
      </button>
      {expanded && (
        <ul className="divide-y divide-white/5 border-t border-white/5" aria-live="polite">
          {jobs.map((j) => {
            const p = jobProgressOf(j)
            const pct = p.pct
            return (
              <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-white">
                    <span className="font-medium">{jobKindLabel(j.kind)}</span>
                    <Badge tone={jobStatusTone(j.status)}>{jobStatusLabel(j.status)}</Badge>
                    {j.attempts > 1 && <span className="text-xs text-slate-400 tabular-nums">attempt {j.attempts}</span>}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    <time dateTime={j.created_at} title={fmtDateTime(j.created_at)}>{timeAgo(j.created_at)}</time>
                    {p.message && <span> · {p.message}</span>}
                  </p>
                  {jobActive(j) && pct !== null && (
                    <div
                      role="progressbar"
                      aria-label={`${jobKindLabel(j.kind)} progress`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct}
                      className="mt-1.5 h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/10"
                    >
                      <div className="h-full rounded-full bg-badge-500" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {j.error && j.status === 'failed' && <p className="mt-1 break-words text-xs text-rose-300">{j.error}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {jobCancellable(j, viewerId, isOwner) && <Button size="sm" onAction={() => cancel(j)}>Cancel</Button>}
                  {jobRetryable(j, isOwner) && <Button size="sm" onAction={() => retry(j)}>Retry</Button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
