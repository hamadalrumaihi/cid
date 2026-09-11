'use client'

/** Lazy Sentry boot (platform upgrade decision #10, audit/jobs.md
 *  recommendation B). `@sentry/browser` is `await import()`-ed ONCE, the
 *  first time an error is reported, and only when `NEXT_PUBLIC_SENTRY_DSN`
 *  is set — so the SDK never enters the shared first-load chunk (bundle
 *  budget) and a deployment without a DSN never loads or contacts anything.
 *  `client_errors` (src/lib/errorReport.ts) stays the primary record; this
 *  is an additional sink. Every event passes `scrubEvent` before it leaves
 *  the browser; PII defaults are off. Never throws. */
import { scrubEvent } from './scrub'
import type { ReportContext, ScrubEvent } from './types'

type SentryModule = typeof import('@sentry/browser')

let boot: Promise<SentryModule | null> | null = null

/** The DSN read at call time (an inlined `NEXT_PUBLIC_` literal). */
export const sentryConfigured = (): boolean => !!process.env.NEXT_PUBLIC_SENTRY_DSN

async function load(): Promise<SentryModule | null> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn || typeof window === 'undefined') return null
  try {
    const Sentry = await import('@sentry/browser')
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV || undefined,
      release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
      sendDefaultPii: false,
      // No performance / replay integrations: errors only, scrubbed.
      tracesSampleRate: 0,
      beforeSend: (event) => scrubEvent(event as unknown as ScrubEvent) as unknown as typeof event | null,
      beforeBreadcrumb: (crumb) => {
        // Console and DOM crumbs carry screen text; drop them outright.
        if (crumb.category === 'console' || crumb.category === 'ui.click' || crumb.category === 'ui.input') return null
        return crumb
      },
    })
    return Sentry
  } catch {
    return null
  }
}

/** Report an error to Sentry (lazy boot on first use). Fire-and-forget. */
export async function reportToSentry(error: unknown, context: ReportContext = {}): Promise<void> {
  if (!sentryConfigured()) return
  try {
    if (!boot) boot = load()
    const Sentry = await boot
    if (!Sentry) return
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'Unknown error')
    Sentry.captureException(err, {
      tags: { ...(context.tags ?? {}), ...(context.route ? { route: context.route.split(/[?#]/)[0] } : {}) },
    })
  } catch { /* never throw from the reporter */ }
}
