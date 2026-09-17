import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PortalModeScreen } from '@/components/portal/PortalModeScreen'
import { getPortalMode, isBlockingMode, MAINTENANCE_HEADING, RETIRED_HEADING } from '@/lib/portalMode'

/** The one route that renders while the portal is retired or in maintenance.
 *  The proxy rewrites EVERY other route here with a 503, so a user cannot
 *  reach a protected page by typing its address. Dynamic on purpose: the
 *  mode is read per request from PORTAL_MODE, never baked into a build, so
 *  changing the variable back is the entire rollback. In normal and
 *  read-only mode this path is a 404 — nothing to see. */
export const dynamic = 'force-dynamic'

export function generateMetadata(): Metadata {
  const mode = getPortalMode()
  const title = mode === 'retired' ? RETIRED_HEADING : mode === 'maintenance' ? MAINTENANCE_HEADING : 'CID Portal'
  return { title, robots: { index: false, follow: false } }
}

export default function UnavailablePage() {
  const mode = getPortalMode()
  if (!isBlockingMode(mode)) notFound()
  return <PortalModeScreen mode={mode as 'retired' | 'maintenance'} />
}
