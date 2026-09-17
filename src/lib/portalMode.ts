/** Portal mode — one reversible, environment-controlled switch for the whole
 *  portal. `PORTAL_MODE` is read on the server (the proxy and the
 *  /unavailable page); the browser learns the mode from the `cid-portal-mode`
 *  cookie the proxy sets on every response, so a build never freezes the
 *  mode and a redeploy with the variable changed back is the whole rollback.
 *
 *  This module is deliberately dependency-free so it runs unchanged in the
 *  edge proxy, in server components and in the browser. It changes NOTHING
 *  in Supabase: no row, storage object, user or integration is touched by
 *  switching modes. It only decides what the portal will do for a request.
 *
 *    normal      — everything works as it does today.
 *    readonly    — signed-in users may view what they are authorized to view;
 *                  every write (create, edit, delete, upload, approval,
 *                  reassignment, status change) is refused before it leaves
 *                  the browser, and a banner says so.
 *    maintenance — the whole portal is replaced by a "temporarily unavailable"
 *                  screen; every route, every API path.
 *    retired     — the whole portal is replaced by the retirement notice.
 */

import { READ_RPCS, READ_SIDE_AUDIT_RPCS } from './portalModeReadRpcs'

export const PORTAL_MODES = ['normal', 'maintenance', 'readonly', 'retired'] as const
export type PortalMode = (typeof PORTAL_MODES)[number]

/** Cookie the proxy sets so the client can read the mode at runtime. Not
 *  HttpOnly on purpose — it carries one public word, and the client needs it. */
export const PORTAL_MODE_COOKIE = 'cid-portal-mode'
/** Response header carrying the mode (for operators and for tests). */
export const PORTAL_MODE_HEADER = 'x-portal-mode'

/** An unknown or missing value is `normal`: a typo in the variable must
 *  never take the portal down, and an unset variable is the default. */
export function parsePortalMode(raw: unknown): PortalMode {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return (PORTAL_MODES as readonly string[]).includes(v) ? (v as PortalMode) : 'normal'
}

/** The mode this server process is running in. Server side only — the
 *  variable is not NEXT_PUBLIC_, so the browser uses clientPortalMode(). */
export function getPortalMode(): PortalMode {
  return parsePortalMode(process.env.PORTAL_MODE)
}

/** Blocking modes replace the whole portal with a screen. */
export function isBlockingMode(mode: PortalMode): boolean {
  return mode === 'retired' || mode === 'maintenance'
}

export function isReadOnlyMode(mode: PortalMode): boolean {
  return mode === 'readonly'
}

let testOverride: PortalMode | null = null

/** Test seam — the browser reads a cookie, tests set the mode directly. */
export function setPortalModeForTests(mode: PortalMode | null): void {
  testOverride = mode
}

/** The mode as the browser knows it: the cookie the proxy set on the response
 *  that delivered this page. Outside a browser (SSR of a client component,
 *  prerender at build time) it is `normal`, which is why nothing that
 *  depends on it renders before mount. */
export function clientPortalMode(): PortalMode {
  if (testOverride) return testOverride
  if (typeof document === 'undefined') return 'normal'
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${PORTAL_MODE_COOKIE}=([^;]*)`))
  return parsePortalMode(m ? decodeURIComponent(m[1]) : '')
}

// ---------------------------------------------------------------------------
// Copy — the words the screens and refusals show. Retirement text verbatim.
// ---------------------------------------------------------------------------

export const RETIRED_HEADING = 'CID Portal Retired'
export const RETIRED_LINES: readonly string[] = [
  'The CID Portal has been retired and is no longer available.',
  'The owner and developer no longer feels that his time, work, and service have been properly appreciated, either within his original department or within CID.',
  'As a result, he will no longer be maintaining, developing, or operating the service.',
]

export const MAINTENANCE_HEADING = 'Portal temporarily unavailable for maintenance'
export const MAINTENANCE_LINES: readonly string[] = [
  'The CID Portal is undergoing maintenance and is not available right now.',
  'No records have been changed. Please try again later.',
]

export const READONLY_MESSAGE = 'Read-only mode — the portal can be viewed but nothing can be created, changed, uploaded, approved or deleted right now.'

export type PortalRefusalCode = 'portal_retired' | 'portal_maintenance' | 'portal_readonly'

export interface PortalRefusal {
  ok: false
  code: PortalRefusalCode
  message: string
}

/** The body every refused request gets — the same shape whether the proxy
 *  answers an /api path or the browser client refuses a write. It names the
 *  mode and nothing else: no variables, no stack, no internals. */
export function portalRefusal(mode: Exclude<PortalMode, 'normal'>): PortalRefusal {
  switch (mode) {
    case 'retired':
      return { ok: false, code: 'portal_retired', message: 'Portal retired. The CID Portal has been retired and is no longer available.' }
    case 'maintenance':
      return { ok: false, code: 'portal_maintenance', message: 'Portal unavailable. The CID Portal is temporarily unavailable for maintenance.' }
    case 'readonly':
      return { ok: false, code: 'portal_readonly', message: 'Portal is in read-only mode. Viewing is allowed; this change was not made.' }
  }
}

// ---------------------------------------------------------------------------
// The request classifier — what the browser client lets through per mode.
// ---------------------------------------------------------------------------

export type Verdict = 'allow' | 'refuse'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** Read-only mode, one Supabase request: is it a read?
 *
 *  · GET / HEAD / OPTIONS are reads everywhere (PostgREST selects, storage
 *    downloads, function health).
 *  · /auth/v1 is session management, not CID data — sign-in, refresh and
 *    sign-out must keep working or nobody can even view.
 *  · /rest/v1/rpc/<name> is a POST whatever it does; the name decides, against
 *    the STABLE list (see portalModeReadRpcs.ts) plus the view-audit RPCs.
 *  · Storage POSTs that only produce a signed URL, a listing or metadata are
 *    reads; uploads, moves, copies and deletes are not.
 *  · Edge functions: only the search/query functions are reads.
 *  Everything else — inserts, updates, deletes, upserts, uploads, every
 *  VOLATILE RPC — is refused. Unknown fails closed. */
export function readOnlyVerdict(method: string, url: string): Verdict {
  const m = method.toUpperCase()
  let path: string
  try { path = new URL(url, 'https://portal.invalid').pathname } catch { return 'refuse' }
  if (SAFE_METHODS.has(m)) return 'allow'
  if (path.startsWith('/auth/v1/') || path.startsWith('/realtime/v1')) return 'allow'
  if (m === 'POST') {
    const rpc = /^\/rest\/v1\/rpc\/([^/?]+)/.exec(path)
    if (rpc) return READ_RPCS.has(rpc[1]) || READ_SIDE_AUDIT_RPCS.has(rpc[1]) ? 'allow' : 'refuse'
    if (/^\/storage\/v1\/object\/(sign|list|info)\//.test(path)) return 'allow'
    if (/^\/storage\/v1\/bucket\/?$/.test(path)) return 'refuse'
    const fn = /^\/functions\/v1\/([^/?]+)/.exec(path)
    if (fn) return /search|query/.test(fn[1]) ? 'allow' : 'refuse'
  }
  return 'refuse'
}

/** The verdict for any mode. Normal allows everything; blocking modes allow
 *  only session management (so a signed-in browser can still sign out); read-only
 *  applies readOnlyVerdict. */
export function portalVerdict(mode: PortalMode, method: string, url: string): Verdict {
  if (mode === 'normal') return 'allow'
  if (isBlockingMode(mode)) {
    try { return new URL(url, 'https://portal.invalid').pathname.startsWith('/auth/v1/') ? 'allow' : 'refuse' } catch { return 'refuse' }
  }
  return readOnlyVerdict(method, url)
}
