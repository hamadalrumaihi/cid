/** Background jobs — the pure model the UI and the tests share (platform
 *  upgrade §2.2). The database is the system of record: `background_jobs`
 *  rows move queued → claimed → running → succeeded | failed | cancelled, the
 *  in-Supabase runner and the optional BullMQ worker both drive them through
 *  `job_claim` / `job_heartbeat` / `job_complete` / `job_fail`. This module
 *  mirrors the two formulas the server owns so a card can show "retries in
 *  40 s" without asking the database and a test can pin the server's rule:
 *
 *    retry delay  = min(1 hour, 5 s · 2^attempts)      (`job_fail`, retryable)
 *    lease        = 5 minutes from the claim / heartbeat (`job_claim`, `job_heartbeat`)
 *
 *  Nothing here talks to the network. */

export const JOB_STATUSES = ['queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled'] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const JOB_QUEUES = ['pdf', 'crawler', 'documents', 'ocr', 'search', 'embeddings', 'evidence', 'exports', 'notifications', 'health'] as const
export type JobQueue = (typeof JOB_QUEUES)[number]

/** The job kinds of contract §4 and the queue each one rides. */
export const JOB_KINDS = {
  'evidence.verify': 'evidence',
  'evidence.derive': 'evidence',
  'packet.render': 'pdf',
  'pdf.tool': 'pdf',
  'bundle.build': 'exports',
  'source.fetch': 'crawler',
  'document.extract': 'documents',
  'search.sync': 'search',
  'embeddings.generate': 'embeddings',
  'health.probe': 'health',
} as const satisfies Record<string, JobQueue>
export type JobKind = keyof typeof JOB_KINDS

/** `job_fail` base delay and cap. */
export const JOB_BACKOFF_BASE_MS = 5_000
export const JOB_BACKOFF_CAP_MS = 3_600_000
/** `job_claim` / `job_heartbeat` lease length. */
export const JOB_LEASE_MS = 300_000

/** Delay before the next attempt after `attempts` failures — the server's
 *  `least(interval '1 hour', interval '5 seconds' * power(2, attempts))`.
 *  Attempts below zero count as zero; non-finite input takes the cap. */
export function backoffMs(attempts: number): number {
  if (!Number.isFinite(attempts)) return JOB_BACKOFF_CAP_MS
  const n = Math.max(0, Math.floor(attempts))
  // 2^n overflows past 2^1023; clamp the exponent so the min() stays exact.
  const raw = n >= 40 ? Infinity : JOB_BACKOFF_BASE_MS * 2 ** n
  return Math.min(JOB_BACKOFF_CAP_MS, raw)
}

/** `run_after` for a retry that failed at `failedAt` on its `attempts`-th try. */
export function nextRunAfter(failedAt: Date | string | number, attempts: number): Date {
  const t = failedAt instanceof Date ? failedAt.getTime() : typeof failedAt === 'string' ? Date.parse(failedAt) : failedAt
  return new Date(t + backoffMs(attempts))
}

/** Whether `job_fail(retryable=true)` re-queues (attempts < max_attempts) or
 *  lands the job in `failed` and notifies. */
export function willRetry(attempts: number, maxAttempts: number): boolean {
  return Number.isFinite(attempts) && Number.isFinite(maxAttempts) && attempts < maxAttempts
}

/** A job the runner / worker will not touch again. */
export function isTerminalJobStatus(status: string | null | undefined): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

/** `job_reap` puts a claimed / running job back in the queue once its lease
 *  is behind `now` — a crashed worker never holds a job forever. */
export function leaseExpired(leaseUntil: string | null | undefined, now: Date | number = Date.now()): boolean {
  if (!leaseUntil) return false
  const t = Date.parse(leaseUntil)
  return Number.isFinite(t) && t < (now instanceof Date ? now.getTime() : now)
}

/** Progress as the runner reports it: `{pct, step, message}` — a missing or
 *  malformed value renders as 0 % with no step, never as NaN. */
export function jobProgress(progress: unknown): { pct: number; step: string | null; message: string | null } {
  const p = progress && typeof progress === 'object' && !Array.isArray(progress) ? (progress as Record<string, unknown>) : {}
  const pct = Number(p.pct)
  return {
    pct: Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : 0,
    step: typeof p.step === 'string' && p.step.trim() ? p.step : null,
    message: typeof p.message === 'string' && p.message.trim() ? p.message : null,
  }
}
