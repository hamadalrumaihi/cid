'use client'

/** The pieces every guide page is built from.
 *
 *  A guide is a reference document, not a live screen: these components read
 *  nothing, write nothing, and hold no portal state. They are deliberately
 *  presentational so that a second guide can be added as data plus a view,
 *  without new plumbing.
 *
 *  Optional imagery is handled here once, and the rule is absolute: when a
 *  slot has no image the components render NOTHING for it. No placeholder, no
 *  empty frame, no "image pending" copy, and no View image action. Written
 *  content and imagery are independent — deleting every image changes nothing
 *  else on the page. */
import { useState } from 'react'
import { Lightbox } from '@/components/ui/Lightbox'
import { CHIP, CHIP_NEUTRAL, GOLD_TEXT, PANEL, SLAB } from './guideSurfaces'

/* ---- optional media ------------------------------------------------------ */

/** One image a guide may carry. `section` is null for the guide's cover. */
export interface GuideImageRef {
  id: string
  section: string | null
  order: number
  src: string
  alt: string
  caption?: string
}

/** Cover image, or nothing at all. Renders no frame when absent. */
export function GuideCover({ image }: { image: GuideImageRef | null }) {
  const [open, setOpen] = useState(false)
  if (!image) return null
  return (
    <div className={`${PANEL} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full cursor-zoom-in"
        aria-label={`View image — ${image.caption ?? image.alt}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- intrinsic size varies per guide; next/image needs fixed dimensions and would letterbox or crop. */}
        <img src={image.src} alt={image.alt} className="h-auto w-full object-contain" />
      </button>
      {image.caption && <p className="px-4 py-2 text-xs text-slate-400">{image.caption}</p>}
      <Lightbox open={open} onClose={() => setOpen(false)} src={image.src} alt={image.alt} caption={image.caption} />
    </div>
  )
}

/** A section's images, in editor order. Renders nothing when there are none,
 *  so a section with no imagery looks exactly as it would have without the
 *  feature. */
export function GuideImages({ images }: { images: readonly GuideImageRef[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  if (!images.length) return null
  const active = images.find((i) => i.id === openId) ?? null
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {images.map((img) => (
          <figure key={img.id} className={`${SLAB} overflow-hidden`}>
            <button
              type="button"
              onClick={() => setOpenId(img.id)}
              className="block w-full cursor-zoom-in"
              aria-label={`View image — ${img.caption ?? img.alt}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- see GuideCover. */}
              <img src={img.src} alt={img.alt} className="h-auto w-full object-contain" />
            </button>
            {img.caption && (
              <figcaption className="px-3 py-2 text-xs text-slate-400">{img.caption}</figcaption>
            )}
          </figure>
        ))}
      </div>
      {active && (
        <Lightbox
          open
          onClose={() => setOpenId(null)}
          src={active.src}
          alt={active.alt}
          caption={active.caption}
        />
      )}
    </>
  )
}

/* ---- header -------------------------------------------------------------- */

export interface GuideHeaderProps {
  title: string
  summary?: string
  /** ISO date of the last review. */
  lastUpdated?: string
  /** Rendered date — the caller formats it, so this file imports no locale. */
  lastUpdatedText?: string
  /** Breadcrumbs, a back action, a bookmark control — supplied by the page. */
  actions?: React.ReactNode
  /** The one-line statement that this document is not live. */
  note?: string
  cover?: GuideImageRef | null
}

/** A guide's masthead. Deliberately carries NO author, rank, source or
 *  confidence field: a guide is reference material, and attributing it to a
 *  person invites reading it as a personal claim rather than a description. */
export function GuideHeader({
  title, summary, lastUpdated, lastUpdatedText, actions, note, cover = null,
}: GuideHeaderProps) {
  return (
    <header className="flex flex-col gap-4">
      {actions}
      <div className="flex flex-col gap-2">
        <h1 className={`text-2xl font-black uppercase tracking-[0.18em] sm:text-3xl ${GOLD_TEXT}`}>
          {title}
        </h1>
        {summary && <p className="max-w-3xl text-sm text-slate-300">{summary}</p>}
        {lastUpdatedText && (
          <p className="text-xs text-slate-500">
            Last updated{' '}
            <time dateTime={lastUpdated}>{lastUpdatedText}</time>
          </p>
        )}
      </div>
      <GuideCover image={cover} />
      {note && (
        <p className={`${SLAB} px-4 py-3 text-xs leading-relaxed text-slate-400`}>{note}</p>
      )}
    </header>
  )
}

/* ---- section ------------------------------------------------------------- */

export interface GuideSectionProps {
  /** DOM id — also the anchor target and the table-of-contents key. */
  id: string
  title: string
  /** Quiet line under the heading. */
  subtitle?: string
  /** Right-aligned heading content. */
  meta?: React.ReactNode
  /** Optional imagery for this section; nothing renders when empty. */
  images?: readonly GuideImageRef[]
  children: React.ReactNode
}

/** One anchor section of a guide. `scroll-mt` keeps the heading clear of the
 *  sticky app header when a hash link or the contents rail jumps to it. */
export function GuideSection({ id, title, subtitle, meta, images = [], children }: GuideSectionProps) {
  return (
    <section id={id} className={`${PANEL} scroll-mt-24 p-4 sm:p-6`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={`text-sm font-black uppercase tracking-[0.2em] ${GOLD_TEXT}`}>{title}</h2>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-slate-300">{subtitle}</p>}
        </div>
        {meta}
      </div>
      <div className="flex flex-col gap-4">
        {children}
        <GuideImages images={images} />
      </div>
    </section>
  )
}

/* ---- statistic card ------------------------------------------------------ */

export interface StatisticCardProps {
  label: string
  value: string
  /** Quiet line under the value. */
  hint?: string
}

/** One number and what it counts. */
export function StatisticCard({ label, value, hint }: StatisticCardProps) {
  return (
    <div className={`${SLAB} px-4 py-3`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${GOLD_TEXT}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
    </div>
  )
}

/* ---- recorded-value marker ----------------------------------------------- */

/** Says, once per block, that the figures below were written down rather than
 *  read live. Every recorded block on every guide carries the same chip, so a
 *  reader learns the convention once. */
export function RecordedChip({ className = '' }: { className?: string }) {
  return (
    <span className={`${CHIP} ${CHIP_NEUTRAL} ${className}`}>Recorded reference</span>
  )
}
