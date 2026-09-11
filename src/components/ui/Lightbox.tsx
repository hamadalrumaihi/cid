'use client'

/** Full-screen image viewer. Modal is the wrong surface for a picture —
 *  its card chrome (border, ink-850 fill, max-w-3xl) crops and frames the
 *  picture, and reference imagery has to be readable at its own aspect
 *  ratio. So this is a sibling primitive with Modal's accessibility contract
 *  and none of its chrome: a portalled overlay, `role="dialog"` +
 *  `aria-modal`, a focus trap, Escape to close, focus restored to whatever
 *  opened it, and a reference-counted body scroll lock (stacked overlays must
 *  not unlock the page under a survivor).
 *
 *  The image is `object-contain` inside the viewport box — never stretched,
 *  never cropped — and the caption sits under it, outside the picture.
 *
 *  Zoom is a scale on the image alone: the box, the caption and the controls
 *  do not move, so a zoomed image scrolls inside its own frame rather than
 *  pushing the dialog off-screen. 1x always fits the viewport, and every open
 *  starts there — zoom is keyed to the viewing session, so reopening the same
 *  image begins fitted rather than where it was left. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const CONTROL =
  'grid h-11 w-11 place-items-center rounded-lg border border-white/10 bg-ink-900/80 text-2xl leading-none text-slate-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-ink-900/80 disabled:hover:text-slate-300'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Shared with Modal's intent, not its module: whichever overlay closes last
// releases the lock.
let scrollLocks = 0

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.5

export interface LightboxProps {
  open: boolean
  onClose: () => void
  /** Image URL (an app-relative path under public/, or an absolute URL). */
  src: string
  /** Real alternative text — what the image shows, not the word "image". */
  alt: string
  /** Visible caption under the image; also names the dialog. */
  caption?: string
  /** Extra line under the caption (file name, source, provenance). */
  meta?: string
}

export function Lightbox({ open, onClose, src, alt, caption, meta }: LightboxProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const lastFocused = useRef<Element | null>(null)
  const onCloseRef = useRef(onClose)
  const [zoom, setZoom] = useState(1)
  // Zoom belongs to one viewing session. Rather than reset it from an effect
  // (which the React Compiler lint rejects, rightly — it is a second render),
  // the session is keyed and the state is adjusted during render: React
  // re-renders immediately with the corrected value and nothing flashes.
  const session = open ? src : ''
  const [zoomSession, setZoomSession] = useState(session)
  if (zoomSession !== session) { setZoomSession(session); setZoom(1) }

  useEffect(() => { onCloseRef.current = onClose })

  const close = useCallback(() => { onCloseRef.current() }, [])

  useEffect(() => {
    if (!open) return
    lastFocused.current = document.activeElement
    scrollLocks++
    document.body.classList.add('overflow-hidden')
    const card = cardRef.current
    ;(card?.querySelector<HTMLElement>(FOCUSABLE) ?? card)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2))); return }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2))); return }
      if (e.key === '0') { e.preventDefault(); setZoom(1); return }
      if (e.key !== 'Tab' || !card) return
      const f = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!f.length) { e.preventDefault(); card.focus(); return }
      const firstEl = f[0], lastEl = f[f.length - 1]
      if (e.shiftKey && document.activeElement === firstEl) { e.preventDefault(); lastEl.focus() }
      else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); firstEl.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      scrollLocks = Math.max(0, scrollLocks - 1)
      if (scrollLocks === 0) document.body.classList.remove('overflow-hidden')
      const lf = lastFocused.current
      if (lf instanceof HTMLElement && document.contains(lf)) lf.focus()
    }
  }, [open, close])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/95 p-4 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={caption ? `Image — ${caption}` : alt}
        tabIndex={-1}
        className="relative flex max-h-full w-full max-w-6xl flex-col items-center gap-3"
      >
        <div className="absolute right-0 top-0 z-10 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)))}
            disabled={zoom <= MIN_ZOOM}
            aria-label="Zoom out"
            className={CONTROL}
          >
            <span aria-hidden>&minus;</span>
          </button>
          <span className="min-w-[3.25rem] rounded-lg border border-white/10 bg-ink-900/80 px-2 py-1 text-center font-mono text-xs text-slate-300" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)))}
            disabled={zoom >= MAX_ZOOM}
            aria-label="Zoom in"
            className={CONTROL}
          >
            <span aria-hidden>+</span>
          </button>
          <button type="button" onClick={close} aria-label="Close image" className={CONTROL}>
            <span aria-hidden>&times;</span>
          </button>
        </div>
        <div className={`flex max-h-[80dvh] w-full justify-center ${zoom > 1 ? 'overflow-auto' : 'overflow-hidden'}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- intrinsic size is unknown (reference imagery varies); next/image needs fixed dimensions and would letterbox or crop. House policy matches RecordThumb. */}
          <img
            src={src}
            alt={alt}
            style={zoom > 1 ? { width: `${zoom * 100}%`, maxWidth: 'none' } : undefined}
            className="max-h-[80dvh] w-auto max-w-full flex-none self-start rounded-lg object-contain shadow-2xl shadow-black/60"
          />
        </div>
        {(caption || meta) && (
          <div className="max-w-3xl text-center">
            {caption && <p className="text-sm text-slate-200">{caption}</p>}
            {meta && <p className="mt-0.5 font-mono text-[11px] text-slate-400">{meta}</p>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
