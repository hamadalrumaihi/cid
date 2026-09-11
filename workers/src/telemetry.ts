// telemetry — optional Sentry (SENTRY_DSN) and OpenTelemetry
// (OTEL_EXPORTER_OTLP_ENDPOINT) for the worker process only. Both are inert
// without their env var. Spans carry job.id / job.kind / job.queue and
// nothing else; Sentry's beforeSend scrubs args, URLs and request bodies so
// no case content, evidence names or source URLs can leave the process.
import { context, trace, SpanStatusCode, type Span } from '@opentelemetry/api';

type SentryModule = typeof import('@sentry/node');
type SdkModule = typeof import('@opentelemetry/sdk-node');

let sentry: SentryModule | null = null;
let sdk: InstanceType<SdkModule['NodeSDK']> | null = null;

export function log(msg: string, meta: Record<string, unknown> = {}): void {
  const line = { ts: new Date().toISOString(), msg, ...meta };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(line));
}

const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;
const SCRUB_KEYS = new Set(['args', 'url', 'urls', 'body', 'data', 'payload', 'snapshot', 'text', 'markdown', 'html', 'content', 'query', 'q', 'headers', 'cookies']);

/** Recursively drop content-bearing keys and mask URLs inside strings. */
export function scrub<T>(value: T, depth = 0): T {
  if (depth > 6) return undefined as unknown as T;
  if (typeof value === 'string') return value.replace(URL_RE, '[url]') as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SCRUB_KEYS.has(k.toLowerCase())) continue;
      out[k] = scrub(v, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

export async function initTelemetry(serviceName: string): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (dsn) {
    sentry = await import('@sentry/node');
    sentry.init({
      dsn,
      environment: process.env.SENTRY_ENV || process.env.NODE_ENV || 'production',
      release: process.env.WORKER_RELEASE || undefined,
      tracesSampleRate: 0,
      sendDefaultPii: false,
      maxBreadcrumbs: 20,
      beforeSend(event) {
        delete event.request;
        delete event.user;
        if (event.extra) event.extra = scrub(event.extra);
        if (event.contexts) event.contexts = scrub(event.contexts);
        if (event.tags) event.tags = scrub(event.tags);
        if (event.message) event.message = event.message.replace(URL_RE, '[url]');
        if (event.exception?.values) {
          for (const ex of event.exception.values) if (ex.value) ex.value = ex.value.replace(URL_RE, '[url]').slice(0, 500);
        }
        return event;
      },
      beforeBreadcrumb(crumb) {
        if (crumb.category === 'http' || crumb.category === 'fetch' || crumb.category === 'console') return null;
        if (crumb.data) crumb.data = scrub(crumb.data);
        if (crumb.message) crumb.message = crumb.message.replace(URL_RE, '[url]');
        return crumb;
      },
    });
    log('sentry enabled');
  }
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (endpoint) {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    sdk = new NodeSDK({
      serviceName,
      traceExporter: new OTLPTraceExporter({ url: endpoint.replace(/\/$/, '') + '/v1/traces' }),
    });
    sdk.start();
    log('otel enabled');
  }
}

export async function shutdownTelemetry(): Promise<void> {
  try {
    await sdk?.shutdown();
  } catch {
    /* ignore */
  }
  try {
    await sentry?.flush(2000);
  } catch {
    /* ignore */
  }
}

export interface JobIdentity {
  id: string;
  kind: string;
  queue: string;
}

/** Run fn inside a span carrying only the job identity. */
export async function withJobSpan<T>(job: JobIdentity, fn: (span: Span) => Promise<T>): Promise<T> {
  const tracer = trace.getTracer('cid-worker');
  const span = tracer.startSpan(`job ${job.kind}`, { attributes: { 'job.id': job.id, 'job.kind': job.kind, 'job.queue': job.queue } });
  try {
    return await context.with(trace.setSpan(context.active(), span), () => fn(span));
  } catch (e) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw e;
  } finally {
    span.end();
  }
}

export function captureJobError(e: unknown, job: JobIdentity, retryable: boolean): void {
  if (!sentry) return;
  sentry.withScope((scope) => {
    scope.setTag('job.kind', job.kind);
    scope.setTag('job.queue', job.queue);
    scope.setTag('job.retryable', String(retryable));
    scope.setExtra('job.id', job.id);
    sentry!.captureException(e instanceof Error ? e : new Error(String(e)));
  });
}
