'use client'

/** Tiny ⓘ contextual-help disclosure — one or two sentences of "what does
 *  this mean", discoverable on click instead of hover-only tooltips (which
 *  never work on touch). Deliberately NOT a banner: it renders a 20px chip
 *  with a ≥40px hit area, opens a small popover, and closes on Escape,
 *  outside click, or focus leaving it. Optional `guide` renders a
 *  "User guide →" link into the matching GuideView section (`/guide#g-<id>`
 *  — GuideView's section headings carry `id="g-<id>"`). */
import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'

export interface HelpTipProps {
  /** Accessible name for the icon-only trigger, e.g. "About sign-off". */
  label: string
  /** GuideView section id ('in' | 'map' | 'case' | 'legal' | 'intake' |
   *  'siu' | 'tools' | 'fix') — adds a "User guide →" link to /guide#g-<id>. */
  guide?: string
  /** Popover edge relative to the trigger; default hangs left-aligned. */
  align?: 'left' | 'right'
  className?: string
  children: React.ReactNode
}

export function HelpTip({ label, guide, align = 'left', className = '', children }: HelpTipProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLSpanElement>(null)

  // Escape + outside-click close, wired only while open.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex ${className}`}
      // Tab/click away closes; moving INTO the popover (the guide link) keeps it.
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false) }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-describedby={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        title={open ? undefined : label}
        /* after:-inset-2.5 grows the 20px chip to a ~40px hit target without
           the visual bulk of a 40px button beside an 11px chip. */
        className="relative grid h-5 w-5 place-items-center rounded-full border border-white/15 bg-white/5 font-serif text-[11px] font-bold italic leading-none text-slate-400 transition after:absolute after:-inset-2.5 after:content-[''] hover:border-white/30 hover:text-white"
      >
        <span aria-hidden>i</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="note"
          className={`absolute top-full z-30 mt-2 w-64 rounded-lg border border-white/15 bg-ink-850 p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-slate-300 shadow-xl shadow-black/40 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children}
          {guide && (
            <Link
              href={`/guide#g-${guide}`}
              onClick={() => setOpen(false)}
              className="mt-2 block text-[11px] font-semibold text-badge-200 hover:text-white"
            >
              User guide →
            </Link>
          )}
        </div>
      )}
    </span>
  )
}
