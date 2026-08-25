'use client'

/** Unified record avatar/thumbnail — the mugshot idiom RegistryCard and the
 *  gang roster's Mug each hand-rolled (raw <img> through safeUrl, broken-image
 *  → initials on bg-ink-700), declared once. Consumers: the RecordSearchPicker
 *  rows plus the RegistryCard/gang-roster call sites (sm = table rows,
 *  base = roster lines, md = registry cards). */
import { useState } from 'react'
import { initials } from '@/lib/format'
import { safeUrl } from '@/lib/safeUrl'

const SIZES = { sm: 'h-8 w-8 text-[10px]', base: 'h-10 w-10 text-[10px]', md: 'h-14 w-14 text-sm' } as const

export function RecordThumb({ url, label, size = 'sm', shape = 'square', placeholder }: {
  url?: string | null
  /** Record name — the alt-free image's context and the initials fallback. */
  label: string
  size?: 'sm' | 'base' | 'md'
  shape?: 'square' | 'circle'
  /** Fallback text override (e.g. 'POI'); defaults to initials(label). */
  placeholder?: string
}) {
  // Track WHICH src broke (not just a boolean) so a rerender with a new url
  // gets a fresh attempt without an effect.
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const src = safeUrl(url ?? '')
  const radius = shape === 'circle' ? 'rounded-full' : size === 'md' ? 'rounded-lg' : 'rounded-md'
  if (src && brokenSrc !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external media CDN (house policy: no next/image for user-supplied URLs)
      <img src={src} alt="" onError={() => setBrokenSrc(src)} className={`${SIZES[size]} ${radius} flex-shrink-0 object-cover`} />
    )
  }
  return (
    <div aria-hidden="true" className={`${SIZES[size]} ${radius} grid flex-shrink-0 place-items-center bg-ink-700 font-bold text-slate-400`}>
      {placeholder ?? initials(label)}
    </div>
  )
}
