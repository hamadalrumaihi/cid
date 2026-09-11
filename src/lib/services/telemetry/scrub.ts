/** Sentry `beforeSend` scrubber — PURE (no SDK, no DOM). What may leave the
 *  browser is an error message, a stack, the route path and a few tags;
 *  everything that could carry case content is removed:
 *
 *   · request bodies, cookies, headers and query strings are dropped; every
 *     URL (request, breadcrumbs, extras, tags, contexts) keeps only its
 *     origin + path;
 *   · breadcrumb messages and data are redacted (DOM text, fetch bodies and
 *     console lines are the classic leak channels);
 *   · any key named like body / text / narrative / summary / notes / fields /
 *     token / authorization / cookie / url is removed wherever it appears
 *     (extra, tags, contexts, user, nested);
 *   · messages and exception values are truncated to 300 characters;
 *   · an event whose message / exception mentions a CI number (`CI-` +
 *     digits) is DROPPED — a confidential source's identifier never leaves
 *     the portal, not even inside an error string.
 *
 *  Mirrors the server posture: `private.action_notify` strips free text from
 *  notification payloads and `case_audit_feed` whitelists `detail`. */
import type { ScrubBreadcrumb, ScrubEvent } from './types'

export const MESSAGE_MAX = 300
export const REDACTED = '[redacted]'

/** Key names (case-insensitive substring match) that never leave the
 *  browser, wherever they appear. */
export const SENSITIVE_KEY_RE = /body|text|narrative|summary|notes?|fields|token|authori[sz]ation|cookie|url|password|secret|email|phone/i

/** `CI-` followed by digits, anywhere in a string (a CI number). */
export const CI_NUMBER_RE = /\bCI-\d+/i

export const truncate = (s: unknown, max = MESSAGE_MAX): string => {
  const str = typeof s === 'string' ? s : String(s ?? '')
  return str.length > max ? `${str.slice(0, max)}…` : str
}

/** Origin + path only. Anything unparsable becomes the redaction marker. */
export function stripQuery(url: unknown): string {
  if (typeof url !== 'string' || !url) return ''
  const cut = url.split(/[?#]/)[0]
  try {
    const u = new URL(cut, 'https://portal.invalid')
    return u.origin === 'https://portal.invalid' ? u.pathname : `${u.origin}${u.pathname}`
  } catch {
    return REDACTED
  }
}

/** Remove sensitive keys recursively; strip query strings from any string
 *  that looks like a URL; truncate long strings. Arrays are walked. */
export function scrubValue(v: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED
  if (typeof v === 'string') {
    if (/^https?:\/\//i.test(v) || v.startsWith('/')) return stripQuery(v)
    return truncate(v)
  }
  if (Array.isArray(v)) return v.map((x) => scrubValue(x, depth + 1))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) continue
      out[k] = scrubValue(val, depth + 1)
    }
    return out
  }
  return v
}

function scrubBreadcrumb(b: ScrubBreadcrumb): ScrubBreadcrumb {
  const out: ScrubBreadcrumb = { type: b.type, category: b.category, level: b.level, timestamp: b.timestamp }
  if (b.message !== undefined) out.message = REDACTED
  if (b.data && typeof b.data === 'object') {
    // Keep only the structural, non-content fields a fetch/navigation crumb
    // carries; URLs lose their query string.
    const d = b.data as Record<string, unknown>
    const kept: Record<string, unknown> = {}
    if (typeof d.method === 'string') kept.method = d.method
    if (typeof d.status_code === 'number') kept.status_code = d.status_code
    if (typeof d.url === 'string') kept.url = stripQuery(d.url)
    if (typeof d.to === 'string') kept.to = stripQuery(d.to)
    if (typeof d.from === 'string') kept.from = stripQuery(d.from)
    out.data = kept
  }
  return out
}

/** The `beforeSend` implementation. Returns `null` to drop the event. */
export function scrubEvent<T extends ScrubEvent>(event: T): T | null {
  const texts: string[] = []
  if (typeof event.message === 'string') texts.push(event.message)
  for (const ex of event.exception?.values ?? []) if (typeof ex.value === 'string') texts.push(ex.value)
  if (texts.some((t) => CI_NUMBER_RE.test(t))) return null

  const out: ScrubEvent = { ...event }
  if (typeof out.message === 'string') out.message = truncate(out.message)
  if (out.exception?.values) {
    out.exception = { ...out.exception, values: out.exception.values.map((ex) => ({ ...ex, value: ex.value === undefined ? undefined : truncate(ex.value) })) }
  }
  if (out.request) {
    const r = out.request
    out.request = { ...(r.url ? { url: stripQuery(r.url) } : {}), ...(r.method ? { method: r.method } : {}) }
  }
  if (Array.isArray(out.breadcrumbs)) out.breadcrumbs = out.breadcrumbs.map(scrubBreadcrumb)
  for (const key of ['extra', 'tags', 'contexts', 'user'] as const) {
    if (out[key] && typeof out[key] === 'object') out[key] = scrubValue(out[key]) as Record<string, unknown>
  }
  if (typeof out.transaction === 'string') out.transaction = stripQuery(out.transaction) || out.transaction
  return out as T
}
