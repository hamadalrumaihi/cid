'use client'

/** Owner Console → System Health (platform upgrade §2.9 / §5.2). One
 *  `system_health()` read (Owner-gated, SECURITY DEFINER) drives the service
 *  cards, the queue depth, the failed-jobs list and the recent cron runs;
 *  the Jobs table, the Feature flags panel and the Crawler policy editor
 *  read their own tables. Realtime: `background_jobs` and
 *  `service_health_events` bump a reload (debounced by lib/realtime).
 *
 *  Services show a name, a status word, a latency and a checked-at time —
 *  never a URL, a key or the probe's detail. Retry / Cancel go through the
 *  audited RPCs (`background_job_retry` / `background_job_cancel`); a
 *  refusal surfaces through humanizeError. The legacy client-side cards
 *  (database round-trip, session, realtime counters, env table, row counts)
 *  stay below this section in OwnerView. */
import { useCallback, useEffect, useState } from 'react'
import { rpc } from '@/lib/db'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { useTableVersion } from '@/lib/realtime'
import { cancelJob, jobLabel, retryJob } from '@/lib/services/queues/jobs'
import { humanizeError, toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { uiPrompt } from '@/components/ui/dialog'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { CrawlerPolicyEditor } from './CrawlerPolicyEditor'
import { FeatureFlagsPanel } from './FeatureFlagsPanel'
import { JobsPanel } from './JobsPanel'
import { OwnerPanel } from './OwnerPanel'
import {
  SERVICE_LABEL, SERVICE_ROLE, SERVICE_STATUS_LABEL, cronTone, durationSeconds, fmtDuration, parseSystemHealth, queueDepths, serviceTone,
  type HealthService, type ServiceHealth, type SystemHealth,
} from './systemHealthModel'

const TH = 'px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400'
const TD = 'px-2 py-2'

function ServiceCard({ s }: { s: ServiceHealth }) {
  const known = (s.service in SERVICE_LABEL) ? (s.service as HealthService) : null
  return (
    <div className="rounded-lg border border-white/10 bg-ink-950/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[13px] font-semibold text-white">{known ? SERVICE_LABEL[known] : s.service}</p>
        <Badge tone={serviceTone(s.status)}>{SERVICE_STATUS_LABEL[s.status]}</Badge>
      </div>
      <p className="mt-1 text-xs text-slate-400">{known ? SERVICE_ROLE[known] : 'Reported by the health probe.'}</p>
      <p className="mt-2 text-xs text-slate-300 tabular-nums">
        {s.latencyMs != null ? `${s.latencyMs} ms` : 'no latency'}
        <span className="text-slate-400"> · {s.checkedAt ? `checked ${timeAgo(s.checkedAt)}` : 'never probed'}</span>
      </p>
    </div>
  )
}

export function SystemHealthSection() {
  const jobsVersion = useTableVersion('background_jobs')
  const healthVersion = useTableVersion('service_health_events')
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await rpc('system_health', {})
    setLoading(false)
    if (res.error) { setError(res.error.message); return }
    setError(null)
    setHealth(parseSystemHealth(res.data))
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load, jobsVersion, healthVersion])

  const retry = async (id: string) => {
    const r = await retryJob(id)
    if (r.error) { toast(humanizeError(r.error.message), 'danger'); return }
    toast('Job queued again.', 'success')
    await load()
  }
  const cancel = async (id: string, kind: string) => {
    const reason = await uiPrompt(`Why cancel “${jobLabel(kind)}”? The reason is recorded in the audit log.`, { title: 'Cancel job', placeholder: 'Reason', confirmText: 'Cancel job' })
    if (reason === null) return
    const r = await cancelJob(id, reason.trim() || 'cancelled by the Owner')
    if (r.error) { toast(humanizeError(r.error.message), 'danger'); return }
    toast('Job cancelled.', 'success')
    await load()
  }

  const depths = health ? queueDepths(health.jobs.byQueue) : []
  const refresh = <Button size="sm" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh'}</Button>

  return (
    <div className="space-y-4">
      <OwnerPanel title="Services" sub="Latest probe per service (health.probe runs every 10 minutes). Names only — endpoints and keys are never shown here. A service that was never probed is not configured, which is a supported state." actions={refresh}>
        {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : !health ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {health.services.map((s) => <ServiceCard key={s.service} s={s} />)}
          </div>
        )}
      </OwnerPanel>

      {health && (
        <OwnerPanel title="Queues" sub="Depth per queue from background_jobs — queued waits for a runner, running is claimed with a live lease, failed exhausted its retries.">
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-ink-950/50 p-3">
              <p className="font-mono text-lg font-semibold text-white tabular-nums">{health.jobs.failed24h}</p>
              <p className="text-xs font-medium text-slate-400">failed in 24 h</p>
            </div>
            <div className="rounded-lg bg-ink-950/50 p-3">
              <p className="font-mono text-lg font-semibold text-white tabular-nums">{fmtDuration(health.jobs.oldestQueuedSeconds)}</p>
              <p className="text-xs font-medium text-slate-400">oldest queued</p>
            </div>
            <div className="rounded-lg bg-ink-950/50 p-3">
              <p className="font-mono text-lg font-semibold text-white tabular-nums">{health.jobs.activeWorkers}</p>
              <p className="text-xs font-medium text-slate-400">active workers (5 min)</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10">
                  <th className={TH}>Queue</th><th className={`${TH} text-right`}>Queued</th><th className={`${TH} text-right`}>Running</th><th className={`${TH} text-right`}>Failed</th><th className={`${TH} text-right`}>Succeeded</th><th className={`${TH} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {depths.map((d) => (
                  <tr key={d.queue}>
                    <td className={`${TD} font-mono text-blue-300`}>{d.queue}</td>
                    <td className={`${TD} text-right tabular-nums ${d.queued ? 'text-amber-300' : 'text-slate-400'}`}>{d.queued}</td>
                    <td className={`${TD} text-right tabular-nums ${d.running ? 'text-blue-300' : 'text-slate-400'}`}>{d.running}</td>
                    <td className={`${TD} text-right tabular-nums ${d.failed ? 'text-rose-300' : 'text-slate-400'}`}>{d.failed}</td>
                    <td className={`${TD} text-right tabular-nums text-slate-300`}>{d.succeeded}</td>
                    <td className={`${TD} text-right tabular-nums text-slate-300`}>{d.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </OwnerPanel>
      )}

      {health && (
        <OwnerPanel title="Failed jobs" sub="The last 20 jobs that exhausted their retries. Retry queues the job again with a fresh attempt count; Cancel records a reason. Both are audited.">
          {health.failures.length === 0 ? <EmptyState title="No failed jobs" hint="Every job in the window succeeded, was cancelled, or is still running." /> : (
            <ul className="divide-y divide-white/5">
              {health.failures.map((f, i) => (
                <li key={f.id ?? i} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{jobLabel(f.kind)} <span className="font-mono text-[11px] text-slate-400">{f.kind}</span></p>
                    <p className="truncate text-xs text-rose-200/80" title={f.error ?? undefined}>{f.error ? f.error.slice(0, 200) : 'No error text recorded'}</p>
                    <p className="text-[11px] text-slate-400">{f.finishedAt ? `failed ${timeAgo(f.finishedAt)}` : 'finish time unknown'}</p>
                  </div>
                  {f.id && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onAction={() => retry(f.id!)}>Retry</Button>
                      <Button size="sm" variant="ghost" className="text-rose-300 hover:text-rose-200" onAction={() => cancel(f.id!, f.kind)}>Cancel</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </OwnerPanel>
      )}

      {health && (
        <OwnerPanel title="Scheduled jobs" sub="The last 20 pg_cron runs (scheduled_job_runs) — sweeps, chain verification, the jobs kick and reap, the health probe.">
          {health.cron.length === 0 ? <EmptyState title="No runs recorded yet" hint="pg_cron writes a row per run; an empty list on a fresh project is expected." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className={TH}>Job</th><th className={TH}>Status</th><th className={TH}>Started</th><th className={`${TH} text-right`}>Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {health.cron.map((c, i) => (
                    <tr key={`${c.job}-${c.startedAt ?? i}`}>
                      <td className={`${TD} font-mono text-blue-300`}>{c.job}</td>
                      <td className={TD}><Badge tone={cronTone(c.status)}>{c.status}</Badge></td>
                      <td className={`${TD} text-slate-300`} title={c.startedAt ? fmtDateTime(c.startedAt) : undefined}>{c.startedAt ? timeAgo(c.startedAt) : '—'}</td>
                      <td className={`${TD} text-right tabular-nums text-slate-300`}>{fmtDuration(durationSeconds(c.startedAt, c.finishedAt))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </OwnerPanel>
      )}

      <JobsPanel />
      <FeatureFlagsPanel />
      <CrawlerPolicyEditor />
    </div>
  )
}
