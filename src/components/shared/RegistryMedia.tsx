'use client'

/** One way to show a registry attachment — the thumbnail and the viewer.
 *
 *  Three dossiers had three thumbnails. The gang's was 112 px tall with no
 *  failure handling; the person's was the same height with no lazy loading and
 *  a different alt rule; the place's was 80 × 112 and, worse, returned NULL
 *  when the signed URL had not resolved — so a photo that was merely slow
 *  disappeared from a grid whose own count still included it. A reader
 *  counting photographs on a place got a different answer from the two lines
 *  of the same screen.
 *
 *  And the viewer: the portal has a real image viewer (ui/Lightbox) with a
 *  focus trap, Escape, a scroll lock and zoom — used, until now, by the guide
 *  library alone. Every dossier opened its photographs in a Modal instead,
 *  whose card chrome is built to frame a form and crops a picture, and none of
 *  them could zoom. Reference imagery that cannot be zoomed is reference
 *  imagery you cannot read.
 *
 *  Both live here now, and both are honest about the three states a signed URL
 *  has: resolved, not resolved yet, and failed. None of them is "absent". */
import { useState } from 'react'
import { useMediaSrc } from '@/lib/evidence'
import { safeUrl } from '@/lib/safeUrl'
import { FileTypeIcon } from '@/components/shell/icons'
import { Lightbox } from '@/components/ui/Lightbox'

/** The columns every registry attachment read projects. `media` rows and the
 *  slimmer per-dossier projections both satisfy it. */
export interface RegistryMediaRow {
  title: string
  type?: string | null
  /** Both nullable columns, not optional: `useMediaSrc` distinguishes a
   *  storage-hosted row from a legacy external one by which is null, and an
   *  absent key would read as neither. */
  external_url: string | null
  storage_path: string | null
}

const isImageRow = (m: RegistryMediaRow): boolean => m.type !== 'document' && m.type !== 'video' && m.type !== 'audio'

/** Two shapes, because two layouts genuinely differ: a grid cell fills its
 *  column, a strip chip is fixed. Everything else about the thumbnail — the
 *  failure contract, the alt rule, lazy loading — is the same either way, and
 *  that was the part that used to vary. */
const SHAPE = {
  tile: 'h-28 w-full',
  strip: 'h-20 w-28 rounded-lg border border-white/10',
} as const
export type RegistryMediaShape = keyof typeof SHAPE

/** The thumbnail. Always renders something the size of a tile: a picture, a
 *  type icon, or a quiet placeholder while the URL is being signed — never
 *  nothing, because a tile that vanishes makes the grid disagree with its own
 *  count. */
export function RegistryMediaThumb({ media, shape = 'tile', className = '' }: {
  media: RegistryMediaRow
  shape?: RegistryMediaShape
  className?: string
}) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const resolved = useMediaSrc(media)
  const src = safeUrl(resolved ?? '')
  const size = `${SHAPE[shape]} ${className}`

  if (src && isImageRow(media) && brokenSrc !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed storage / external media URL
      <img
        src={src}
        alt={media.title || 'Attachment'}
        loading="lazy"
        onError={() => setBrokenSrc(src)}
        className={`${size} object-cover transition group-hover:opacity-90`}
      />
    )
  }
  // A file we do not preview, an image that failed to load, or a URL still
  // being signed. Each says which, rather than all three reading as "no image".
  const label = !isImageRow(media) ? null
    : brokenSrc === src ? 'Image unavailable'
    : resolved === null ? 'Loading…'
    : 'No preview'
  return (
    <div className={`${size} grid place-items-center gap-1 bg-ink-850 text-slate-400`}>
      <FileTypeIcon type={media.type ?? 'document'} size={28} />
      {label && <span className="text-[10px] text-slate-500">{label}</span>}
    </div>
  )
}

/** The viewer. The shared Lightbox for a picture; for anything else — or a
 *  URL that will not resolve — a plain statement and a way out, because a
 *  black overlay with nothing in it is indistinguishable from a bug. */
export function RegistryMediaLightbox({ media, onClose, meta }: {
  media: RegistryMediaRow
  onClose: () => void
  /** Provenance under the caption — a source case, a capture date. */
  meta?: string
}) {
  const src = safeUrl(useMediaSrc(media) ?? '')
  if (src && isImageRow(media)) {
    return <Lightbox open onClose={onClose} src={src} alt={media.title || 'Attachment'} caption={media.title} meta={meta} />
  }
  return (
    <div role="dialog" aria-modal="true" aria-label={media.title || 'Attachment'} className="fixed inset-0 z-50 grid place-items-center bg-ink-950/90 p-6">
      <div className="max-w-md rounded-lg border border-white/10 bg-ink-900 p-5 text-center">
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center text-slate-400"><FileTypeIcon type={media.type ?? 'document'} size={32} /></div>
        <p className="text-sm font-semibold text-white">{media.title || 'Attachment'}</p>
        <p className="mt-1 text-xs text-slate-400">
          {src ? 'This file type is not previewed here.' : 'This attachment could not be loaded.'}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 min-h-[44px] rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
        >
          Close
        </button>
      </div>
    </div>
  )
}
