// CID Portal worker — dispatcher.
//
// Postgres (public.background_jobs) is the system of record; Redis/BullMQ is
// transport only. For every queue this worker implements, a poller calls
// public.job_claim(p_worker, p_queues:[queue], p_kinds, p_batch) every 2 s
// with the free capacity (JOB_CONCURRENCY_<QUEUE>, default 2). A claimed row
// is then either processed in-process (no REDIS_URL) or mirrored into a
// BullMQ Queue per queue and processed by a BullMQ Worker with the same
// concurrency plus an optional limiter (JOB_RATE_<QUEUE> jobs/minute).
// Either way the processor is jobCore.runJob: heartbeat every 30 s,
// job_complete / job_fail (retryable flag), scrubbed logging, one span per job.
// SIGTERM/SIGINT stop polling, drain in-flight jobs and close cleanly; jobs
// claimed but not finished are reaped back to `queued` when their lease ends.
import os from 'node:os';
import { initTelemetry, shutdownTelemetry, withJobSpan, captureJobError, log } from './telemetry.ts';
import { buildDeps, env, serviceClient } from './deps.ts';
import { runJob, type CoreDeps, type JobRow } from './jobCore.ts';
import { HANDLERS, KINDS_BY_QUEUE, WORKER_QUEUES } from './jobs/index.ts';
import { ensureIndex, meiliConfigured } from './providers/meilisearch.ts';

const POLL_MS = 2000;
const JOB_BUDGET_MS = Number(env('JOB_BUDGET_MS') ?? 20 * 60_000);
const WORKER_NAME = env('WORKER_NAME') ?? `worker-${os.hostname()}-${process.pid}`;

function queueEnv(prefix: string, queue: string): string | undefined {
  return env(`${prefix}_${queue.toUpperCase()}`);
}

function concurrencyFor(queue: string): number {
  const n = Number(queueEnv('JOB_CONCURRENCY', queue) ?? env('JOB_CONCURRENCY') ?? 2);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 2;
}

function rateFor(queue: string): number | null {
  const n = Number(queueEnv('JOB_RATE', queue) ?? env('JOB_RATE') ?? NaN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Simple per-minute token bucket for in-process rate limiting. */
class RateLimiter {
  private stamps: number[] = [];
  constructor(private perMinute: number | null) {}
  take(): boolean {
    if (!this.perMinute) return true;
    const now = Date.now();
    this.stamps = this.stamps.filter((t) => now - t < 60_000);
    if (this.stamps.length >= this.perMinute) return false;
    this.stamps.push(now);
    return true;
  }
}

interface QueueState {
  queue: string;
  kinds: string[];
  concurrency: number;
  limiter: RateLimiter;
  inflight: Set<Promise<unknown>>;
  bull?: { queue: import('bullmq').Queue; worker: import('bullmq').Worker };
}

let stopping = false;

async function processJob(job: JobRow, deps: CoreDeps): Promise<void> {
  await withJobSpan({ id: job.id, kind: job.kind, queue: job.queue }, async () => {
    const outcome = await runJob(job, deps, HANDLERS, JOB_BUDGET_MS);
    if (outcome.status === 'failed') captureJobError(new Error(`job ${job.kind} failed`), { id: job.id, kind: job.kind, queue: job.queue }, outcome.retryable ?? true);
  });
}

async function claim(deps: CoreDeps, state: QueueState, batch: number): Promise<JobRow[]> {
  if (batch <= 0) return [];
  const { data, error } = await deps.supa.rpc('job_claim', { p_worker: WORKER_NAME, p_queues: [state.queue], p_kinds: state.kinds, p_batch: batch });
  if (error) {
    log('job_claim failed', { queue: state.queue, error: error.message.slice(0, 120) });
    return [];
  }
  return (data ?? []) as JobRow[];
}

async function pollInProcess(deps: CoreDeps, state: QueueState): Promise<void> {
  while (!stopping) {
    const free = state.concurrency - state.inflight.size;
    let batch = 0;
    for (let i = 0; i < free; i++) if (state.limiter.take()) batch++;
    if (batch > 0) {
      const jobs = await claim(deps, state, batch);
      for (const job of jobs) {
        const p = processJob(job, deps).finally(() => state.inflight.delete(p));
        state.inflight.add(p);
      }
      if (jobs.length === batch) continue; // queue is hot: claim again immediately
    }
    await sleep(POLL_MS);
  }
}

async function pollRedis(deps: CoreDeps, state: QueueState): Promise<void> {
  const bull = state.bull!;
  while (!stopping) {
    const [waiting, active] = await Promise.all([bull.queue.getWaitingCount(), bull.queue.getActiveCount()]);
    const pending = waiting + active;
    const room = state.concurrency * 2 - pending; // keep a small prefetch so the worker never idles
    let batch = 0;
    for (let i = 0; i < room; i++) if (state.limiter.take()) batch++;
    if (batch > 0) {
      const jobs = await claim(deps, state, batch);
      for (const job of jobs) {
        await bull.queue.add(job.kind, { job }, { jobId: job.id, attempts: 1, removeOnComplete: true, removeOnFail: true });
      }
      if (jobs.length === batch) continue;
    }
    await sleep(POLL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  await initTelemetry('cid-worker');
  const supa = serviceClient();
  const deps = await buildDeps(supa);
  if (meiliConfigured()) await ensureIndex(deps).catch((e) => log('meilisearch index setup failed', { error: String(e?.message ?? e).slice(0, 120) }));
  const redisUrl = env('REDIS_URL');
  const states: QueueState[] = WORKER_QUEUES.map((queue) => ({
    queue,
    kinds: KINDS_BY_QUEUE[queue],
    concurrency: concurrencyFor(queue),
    limiter: new RateLimiter(rateFor(queue)),
    inflight: new Set(),
  }));
  log('worker starting', {
    worker: WORKER_NAME,
    transport: redisUrl ? 'redis' : 'in-process',
    queues: states.map((s) => `${s.queue}:${s.concurrency}${rateFor(s.queue) ? `@${rateFor(s.queue)}/min` : ''}`),
    providers: {
      stirling: !!env('STIRLING_URL'),
      crawl4ai: !!env('CRAWL4AI_URL'),
      docling: !!env('DOCLING_URL'),
      meilisearch: meiliConfigured(),
      embeddings: !!env('EMBEDDINGS_API_KEY'),
      sharp: !!deps.images,
    },
  });

  const pollers: Promise<void>[] = [];
  if (redisUrl) {
    const { Queue, Worker } = await import('bullmq');
    const { Redis } = await import('ioredis');
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
    for (const state of states) {
      const queue = new Queue(`cid:${state.queue}`, { connection });
      const rate = rateFor(state.queue);
      const worker = new Worker(
        `cid:${state.queue}`,
        async (bjob) => {
          const job = (bjob.data as { job: JobRow }).job;
          const p = processJob(job, deps).finally(() => state.inflight.delete(p));
          state.inflight.add(p);
          await p;
        },
        { connection, concurrency: state.concurrency, ...(rate ? { limiter: { max: rate, duration: 60_000 } } : {}) },
      );
      worker.on('error', (e) => log('bullmq worker error', { queue: state.queue, error: String(e?.message ?? e).slice(0, 120) }));
      state.bull = { queue, worker };
      pollers.push(pollRedis(deps, state));
    }
  } else {
    for (const state of states) pollers.push(pollInProcess(deps, state));
  }

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log('shutdown requested', { signal });
    await Promise.allSettled(pollers);
    await Promise.allSettled(states.flatMap((s) => Array.from(s.inflight)));
    for (const s of states) {
      if (s.bull) {
        await s.bull.worker.close().catch(() => undefined);
        await s.bull.queue.close().catch(() => undefined);
      }
    }
    await shutdownTelemetry();
    log('worker stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  await Promise.all(pollers);
}

main().catch((e) => {
  log('worker crashed', { error: String((e as Error)?.message ?? e).slice(0, 200) });
  process.exit(1);
});
