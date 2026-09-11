/** Telemetry adapter types (platform upgrade §5.1 / decision #10). The
 *  shapes below are the SUBSET of a Sentry event the scrubber touches —
 *  declared locally so the pure scrubber (and its test) never import the
 *  SDK, which stays a lazy dynamic import inside `sentry.ts`. */

export interface ScrubBreadcrumb {
  type?: string
  category?: string
  message?: string
  data?: Record<string, unknown>
  level?: string
  timestamp?: number
}

export interface ScrubRequest {
  url?: string
  method?: string
  headers?: Record<string, string>
  cookies?: unknown
  data?: unknown
  query_string?: unknown
}

/** What the scrubber reads and writes. Every field optional — an event is
 *  whatever the SDK hands `beforeSend`. */
export interface ScrubEvent {
  message?: string
  level?: string
  request?: ScrubRequest
  breadcrumbs?: ScrubBreadcrumb[]
  extra?: Record<string, unknown>
  tags?: Record<string, unknown>
  contexts?: Record<string, unknown>
  user?: Record<string, unknown>
  transaction?: string
  exception?: { values?: Array<{ type?: string; value?: string; stacktrace?: unknown }> }
  [key: string]: unknown
}

export interface ReportContext {
  /** Route path only (no query string — the scrubber strips it anyway). */
  route?: string
  /** A short, non-sensitive tag set (e.g. { source: 'window.error' }). */
  tags?: Record<string, string>
}
