'use client'

/** Bottom action bar that owns its own geometry: sticky above the mobile
 *  BottomNav (+ home-indicator safe area) via the shared --bottom-nav-h token,
 *  a plain 1rem inset on desktop, z-40 (above BottomNav's z-30, below Modal's
 *  z-50). The geometry lives in globals.css (.sticky-action-bar); callers
 *  keep styling the surface itself (border, fill, padding) via className —
 *  see the cases bulk bar, the dossier decision panel and the SOP ack bar. */

export function StickyActionBar({ className = '', ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`sticky-action-bar ${className}`} {...rest} />
}
