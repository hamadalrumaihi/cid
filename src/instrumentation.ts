/** Next.js instrumentation hook (platform upgrade §5.2 Telemetry, decision
 *  #9 — OpenTelemetry PARTIAL). Registers `@vercel/otel` for the Node
 *  runtime ONLY when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; with the endpoint
 *  unset (every deployment today) this is a no-op and nothing is exported.
 *  The portal has no route handlers or server actions, so the value of this
 *  hook is bounded — the worker process carries the real tracing
 *  (`workers/src/telemetry.ts`). Browser tracing is deliberately absent:
 *  the SDK would land in the shared first-load chunk (bundle budget). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT) return
  const { registerOTel } = await import('@vercel/otel')
  registerOTel({ serviceName: 'cid-portal' })
}
