'use client'

/** Background-jobs adapter (platform upgrade §2.2 / §5.1). The
 *  `background_jobs` table is the record: RLS lets a member read the jobs
 *  they created (the Owner reads every row); every mutation is a definer
 *  RPC — `background_job_cancel` (Owner, or the creator while the job is
 *  still queued) and `background_job_retry` (Owner). Nothing here claims,
 *  completes or fails a job — those are service-role paths.
 *
 *  `useMyJobs` is the creator-scoped live list (Client B's JobsTray reads it
 *  per case; the Owner panel reads the table directly). The pure helpers
 *  (`jobLabel`, `jobProgressPct`, `jobProgressText`, `canCancelJob`,
 *  `jobStatusTone`) are what every job row renders with. */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list, rpc, type DbError } from '@/lib/db'
import { useCaseTableVersion, useTableVersion } from '@/lib/realtime'

export type JobRow = Tables<'background_jobs'>

/** Still moving: the runner / worker may pick it up or is on it. */
export const JOB_ACTIVE: ReadonlySet<string> = new Set(['queued', 'claimed', 'running'])

/** Human label per job kind (§4 job kinds). Unknown kinds humanise. */
export const JOB_KIND_LABEL: Record<string, string> = {
  'evidence.verify': 'Evidence integrity check',
  'evidence.derive': 'Evidence derivatives',
  'packet.render': 'Case packet',
  'bundle.build': 'Evidence bundle',
  'pdf.tool': 'Document tool',
  'document.extract': 'Document extraction',
  'source.fetch': 'External source fetch',
  'search.sync': 'Search index sync',
  'embeddings.generate': 'Embeddings',
  'health.probe': 'Health probe',
}

export function jobLabel(kind: string | null | undefined): string {
  const k = String(kind ?? '').trim()
  if (!k) return 'Background job'
  if (JOB_KIND_LABEL[k]) return JOB_KIND_LABEL[k]
  return k.replace(/[._-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** `progress.pct` clamped to 0–100, or null when the job reports none. */
export function jobProgressPct(progress: unknown): number | null {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return null
  const pct = (progress as { pct?: unknown }).pct
  const n = typeof pct === 'number' ? pct : typeof pct === 'string' ? Number(pct) : NaN
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** `progress.step` / `progress.message` as one short line, or null. */
export function jobProgressText(progress: unknown): string | null {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return null
  const p = progress as { step?: unknown; message?: unknown }
  const parts = [p.step, p.message].filter((v): v is string => typeof v === 'string' && !!v.trim())
  return parts.length ? parts.join(' · ').slice(0, 200) : null
}

export type JobTone = 'neutral' | 'accent' | 'good' | 'warn' | 'danger'
export function jobStatusTone(status: string | null | undefined): JobTone {
  switch (status) {
    case 'running': case 'claimed': return 'accent'
    case 'succeeded': return 'good'
    case 'failed': return 'danger'
    case 'queued': return 'warn'
    default: return 'neutral'
  }
}

/** Cosmetic mirror of `background_job_cancel`'s rule: the Owner may cancel
 *  any active job, the creator only while it is still queued. The RPC
 *  re-decides. */
export function canCancelJob(job: Pick<JobRow, 'status' | 'created_by'>, me: string | null | undefined, isOwner: boolean): boolean {
  if (isOwner) return JOB_ACTIVE.has(job.status)
  return !!me && job.created_by === me && job.status === 'queued'
}

/** `{ok:false, code, message}` → `{error}` (the jsonb refusal shape). */
const asResult = (res: { data: unknown; error: DbError | null }): { error: DbError | null } => {
  if (res.error) return { error: res.error }
  const d = (res.data ?? null) as { ok?: boolean; code?: string; message?: string } | null
  if (d && d.ok === false) return { error: { message: d.message || 'The server refused this action.', code: d.code } }
  return { error: null }
}

export async function cancelJob(id: string, reason: string): Promise<{ error: DbError | null }> {
  return asResult(await rpc('background_job_cancel', { p_id: id, p_reason: reason }))
}

export async function retryJob(id: string): Promise<{ error: DbError | null }> {
  return asResult(await rpc('background_job_retry', { p_id: id }))
}

export interface JobsQuery {
  /** Scope to one case (the Documents tab's JobsTray); realtime follows the
   *  case-filtered channel. */
  caseId?: string
  limit?: number
}

/** Creator-scoped live list (RLS: own jobs, or every job for the Owner),
 *  newest first, refetched on every `background_jobs` change. */
export function useMyJobs(opts: JobsQuery = {}): { jobs: JobRow[]; loading: boolean; error: string | null; refresh: () => Promise<void> } {
  const { caseId, limit = 50 } = opts
  const tableVersion = useTableVersion('background_jobs')
  const caseVersion = useCaseTableVersion('background_jobs', caseId ?? '')
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const rows = await list('background_jobs', {
        order: 'created_at', ascending: false, limit,
        ...(caseId ? { eq: { case_id: caseId } } : {}),
      })
      setJobs(rows)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [caseId, limit])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, tableVersion, caseVersion])

  return { jobs, loading, error, refresh }
}
