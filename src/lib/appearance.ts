'use client'

/** Device appearance preferences (accent + density), stored in the SAME
 *  `cid-portal-v3` localStorage blob and applied to the SAME data attributes
 *  as the vanilla app (continuity hard rule) and the boot-time PREF_APPLIER
 *  in app/layout.tsx. Extracted from the former AppearanceModal so the
 *  profile page (and anything else) can drive appearance without the modal. */
import { Store } from './store'

export const ACCENTS: Array<[key: string, label: string, hex: string]> = [
  ['blue', 'Electric Blue', '#3b82f6'],
  ['amber', 'Amber', '#f59e0b'],
  ['emerald', 'Emerald', '#10b981'],
  ['rose', 'Rose', '#f43f5e'],
]

export const DENSITIES: Array<[key: string, label: string]> = [
  ['comfortable', 'Comfortable'],
  ['compact', 'Compact'],
]

/** Re-apply the saved accent/density to the DOM (matches the boot applier). */
export function applyAppearance() {
  if (typeof document === 'undefined') return
  document.body.dataset.accent = Store.get('accent', 'amber')
  document.documentElement.dataset.density = Store.get('density', 'comfortable')
}
