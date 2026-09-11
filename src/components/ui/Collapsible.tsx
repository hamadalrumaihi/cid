'use client'

/** Disclosure primitive. The app had two incompatible habits — native
 *  `<details>/<summary>` (no control over the open state, so nothing can
 *  expand a section from outside, e.g. an in-page search) and hand-rolled
 *  `useState` toggles with no aria wiring at all. This is the real ARIA
 *  disclosure pattern: a `<button aria-expanded aria-controls>` inside a
 *  heading of the caller's level, and a labelled region that is only in the
 *  DOM while open.
 *
 *  Uncontrolled by default (`defaultOpen`); pass `open` + `onOpenChange` to
 *  drive it from the outside. Keyboard support is the button's own — Enter
 *  and Space — which is the whole point of using a button rather than a div. */
import { useId, useState } from 'react'

export interface CollapsibleProps {
  /** The trigger's text. Rendered inside a heading so the section stays
   *  reachable from a screen reader's heading list. */
  title: React.ReactNode
  /** Optional secondary line under the title (quiet, inside the trigger). */
  hint?: React.ReactNode
  /** Right-aligned trigger content — a count chip, a Badge, a status. */
  meta?: React.ReactNode
  /** Heading rank wrapping the trigger. Pick the one the outline needs. */
  headingLevel?: 2 | 3 | 4
  /** Initial state when uncontrolled. */
  defaultOpen?: boolean
  /** Controlled state — pair with `onOpenChange`. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Id for the panel (deep links / aria-controls from elsewhere). */
  panelId?: string
  className?: string
  /** Extra classes for the panel wrapper. */
  panelClassName?: string
  children: React.ReactNode
}

export function Collapsible({
  title,
  hint,
  meta,
  headingLevel = 3,
  defaultOpen = false,
  open,
  onOpenChange,
  panelId,
  className = '',
  panelClassName = '',
  children,
}: CollapsibleProps) {
  const autoId = useId()
  const id = panelId ?? `${autoId}-panel`
  // The panel is a region, so it needs a name: the trigger provides it.
  const triggerId = `${autoId}-trigger`
  const [selfOpen, setSelfOpen] = useState(defaultOpen)
  const isOpen = open ?? selfOpen
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'

  const toggle = () => {
    const next = !isOpen
    if (open === undefined) setSelfOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div className={className}>
      <Heading className="m-0">
        <button
          type="button"
          id={triggerId}
          onClick={toggle}
          aria-expanded={isOpen}
          aria-controls={id}
          className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-white/5"
        >
          <span
            aria-hidden
            className={`flex-shrink-0 text-xs text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          >
            ▶
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-white">{title}</span>
            {hint && <span className="mt-0.5 block text-xs text-slate-400">{hint}</span>}
          </span>
          {meta && <span className="flex flex-shrink-0 items-center gap-2">{meta}</span>}
        </button>
      </Heading>
      {isOpen && (
        <div id={id} role="region" aria-labelledby={triggerId} className={`px-3 pb-3 pt-1 ${panelClassName}`}>
          {children}
        </div>
      )}
    </div>
  )
}
