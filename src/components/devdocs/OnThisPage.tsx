'use client'

/** "On this page" table of contents for a Developer Handbook article, plus the
 *  single scroll-spy observer that drives its highlight. Reuses the heading ids
 *  and DocHeading shape produced by docMarkdown (docHeadings()); it never
 *  duplicates heading parsing and never mutates the URL — hash changes happen
 *  only on explicit user clicks, routed through the page's goTo(). */
import { useEffect, useState } from 'react'
import type { DocHeading } from './docMarkdown'

/** ONE IntersectionObserver over the article's heading elements. Tracks a
 *  SINGLE active id — the topmost currently-intersecting heading — and is
 *  resilient: when nothing is on screen it keeps the last active id (no flicker
 *  back to null). It only sets local state; it never touches the URL hash. The
 *  observer is re-created/disconnected whenever the page (slug) or its headings
 *  change so it never observes detached nodes. */
export function useActiveHeading(slug: string, headings: DocHeading[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null)
  const ids = headings.map((h) => h.id).join(',')

  useEffect(() => {
    const els = ids
      ? ids.split(',').map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e)
      : []
    // No headings rendered (0/1-heading pages don't show a TOC anyway) — keep
    // whatever we had; avoids a synchronous setState in the effect body.
    if (!els.length) return

    // id → viewport top, for every heading currently intersecting.
    const visible = new Map<string, number>()
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.boundingClientRect.top)
          else visible.delete(e.target.id)
        }
        if (visible.size) {
          let topId = ''
          let topY = Infinity
          for (const [id, y] of visible) if (y < topY) { topY = y; topId = id }
          setActiveId(topId)
        }
        // else: nothing on screen — keep the last active id (resilient).
      },
      { rootMargin: '-10% 0px -70% 0px' },
    )
    els.forEach((e) => obs.observe(e))
    return () => obs.disconnect()
    // slug forces a rebuild across pages that happen to share heading ids.
  }, [slug, ids])

  return activeId
}

interface OnThisPageProps {
  headings: DocHeading[]
  activeId: string | null
  /** Explicit user navigation — routes to the page's goTo(null, anchor). */
  onGo: (anchor: string) => void
}

/** Renders nothing for empty / single-heading pages. Otherwise: a collapsible
 *  block above the article below xl, and a sticky right-hand column at xl. */
export function OnThisPage({ headings, activeId, onGo }: OnThisPageProps) {
  if (headings.length < 2) return null

  const list = (
    <ul className="space-y-0.5 border-l border-white/10">
      {headings.map((h) => (
        <li key={h.id}>
          <button
            onClick={() => onGo(h.id)}
            aria-current={activeId === h.id ? 'location' : undefined}
            className={`block w-full truncate border-l-2 py-1 pr-1 text-left text-[11px] transition ${h.level === 3 ? 'pl-5' : 'pl-3'} ${
              activeId === h.id ? 'border-badge-500 font-bold text-white' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  )

  return (
    <>
      {/* below xl: collapsible block placed above the article content */}
      <details className="order-1 mb-4 rounded-xl border border-white/10 bg-ink-900/60 xl:hidden">
        <summary className="flex min-h-[44px] cursor-pointer select-none items-center px-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          On this page
        </summary>
        <div className="px-4 pb-3">{list}</div>
      </details>

      {/* xl and up: sticky right-hand column */}
      <nav aria-label="On this page" className="order-3 sticky top-4 hidden w-56 flex-shrink-0 self-start xl:block">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">On this page</p>
        {list}
      </nav>
    </>
  )
}
