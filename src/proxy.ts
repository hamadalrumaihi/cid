import { NextResponse, type NextRequest } from 'next/server'
import {
  getPortalMode, isBlockingMode, PORTAL_MODE_COOKIE, PORTAL_MODE_HEADER, portalRefusal,
  type PortalMode,
} from '@/lib/portalMode'

/** Server-side enforcement of the portal mode (Next 16 proxy — the file that
 *  was middleware.ts). Runs before every page, RSC request and API path, so:
 *
 *  · retired / maintenance — every route is rewritten to /unavailable with a
 *    503, so the portal is the notice and nothing else, whatever address is
 *    typed. API paths and server actions get a JSON refusal instead of HTML.
 *    Static assets pass (the notice needs its stylesheet).
 *  · readonly / normal — the request continues; the browser client applies
 *    the write ban itself (src/lib/supabase.ts), from the cookie set below.
 *
 *  Every response carries the mode as a cookie and a header, so the browser
 *  learns the mode at runtime — a build never freezes it. The response says
 *  the mode and nothing else about the server. */

const UNAVAILABLE = '/unavailable'

function withMode(res: NextResponse, mode: PortalMode): NextResponse {
  res.headers.set(PORTAL_MODE_HEADER, mode)
  res.cookies.set(PORTAL_MODE_COOKIE, mode, { path: '/', sameSite: 'lax', httpOnly: false })
  return res
}

function wantsJson(req: NextRequest): boolean {
  if (req.nextUrl.pathname.startsWith('/api/')) return true
  if (req.headers.has('next-action')) return true
  const accept = req.headers.get('accept') ?? ''
  return accept.includes('application/json') && !accept.includes('text/html')
}

export function proxy(req: NextRequest): NextResponse {
  const mode = getPortalMode()
  if (!isBlockingMode(mode)) return withMode(NextResponse.next(), mode)

  const blocking = mode as 'retired' | 'maintenance'
  const headers = { 'cache-control': 'no-store', 'retry-after': '3600' }
  if (wantsJson(req)) {
    return withMode(NextResponse.json(portalRefusal(blocking), { status: 503, headers }), mode)
  }
  if (req.nextUrl.pathname === UNAVAILABLE) {
    return withMode(NextResponse.next({ status: 503, headers }), mode)
  }
  const url = req.nextUrl.clone()
  url.pathname = UNAVAILABLE
  url.search = ''
  return withMode(NextResponse.rewrite(url, { status: 503, headers }), mode)
}

export const config = {
  // Everything except the build's static output and the public files the
  // notice itself needs. Pages, RSC payloads, /api and the manifest all pass
  // through the mode check.
  matcher: [
    '/((?!_next/static|_next/image|icon\\.svg|favicon\\.ico|manifest\\.webmanifest|map/).*)',
  ],
}
