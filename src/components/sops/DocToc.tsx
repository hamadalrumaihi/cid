'use client'

/** Document reader table of contents — renders the H2/H3 list that
 *  renderDocumentMarkdown emitted (never a second heading parse) with a
 *  scroll-spy highlight. The IntersectionObserver hook mirrors the Developer
 *  Handbook's OnThisPage approach (own implementation — devdocs is a separate
 *  surface): one observer, topmost intersecting heading wins, and the last
 *  active id is kept when nothing is on screen so the highlight never
 *  flickers back to nothing. The URL hash changes only on explicit clicks. */
import { useEffect, useState } from 'react'
import type { DocHeading } from '@/lib/markdown'
import { copyText } from '@/lib/format'

/** Single scroll-spy observer over the article's rendered headings. Local
 *  state only — it never mutates the URL. Rebuilt whenever the document or
 *  its heading set changes so it never observes detached nodes. */
export function useActiveHeading(docId: string, headings: DocHeading[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null)
  const ids = headings.map((h) => h.id).join(',')

  useEffect(() => {
    // No reset needed on doc change: observers fire their initial callback on
    // observe(), so the first intersecting heading replaces any stale id.
    const els = ids
      ? ids.split(',').map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e)
      : []
    if (!els.length) return

    const visible = new Map<string, number>() // id → viewport top
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
    // docId forces a rebuild across documents that share heading ids.
  }, [docId, ids])

  return activeId
}

/** Scroll to a rendered heading and reflect it in the hash — replaceState so
 *  section-hopping never pollutes browser history. Explicit-user-action only. */
export function scrollToHeading(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ block: 'start' })
  try { history.replaceState(null, '', `#${id}`) } catch { /* sandboxed iframe etc. */ }
}

/** The list itself. `rail` is the compact sticky sidebar; `sheet` is the
 *  mobile drawer with full-size touch targets. The parent owns the actual
 *  scroll (onSelect) so the drawer can close before jumping. Renders nothing
 *  under two headings — a TOC with one entry is noise. */
export function DocToc({ headings, activeId, onSelect, size = 'rail' }: {
  headings: DocHeading[]
  activeId: string | null
  onSelect: (id: string) => void
  size?: 'rail' | 'sheet'
}) {
  if (headings.length < 2) return null
  const sheet = size === 'sheet'

  const copySectionLink = (id: string) => {
    const { origin, pathname, search } = window.location
    copyText(`${origin}${pathname}${search}#${id}`, 'Section link')
  }

  return (
    <nav aria-label="On this page">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">On this page</p>
      <ul className={`border-l border-white/10 ${sheet ? 'space-y-1' : 'space-y-0.5'}`}>
        {headings.map((h) => {
          const active = activeId === h.id
          return (
            <li key={h.id} className="flex items-center gap-1">
              <button
                onClick={() => onSelect(h.id)}
                aria-current={active ? 'location' : undefined}
                className={`block min-w-0 flex-1 truncate border-l-2 py-1 pr-1 text-left transition ${
                  sheet ? 'min-h-[44px] text-sm' : 'text-[11px]'
                } ${h.level === 3 ? 'pl-6' : 'pl-3'} ${
                  active ? 'border-badge-500 font-bold text-white' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {h.text}
              </button>
              {active && (
                <button
                  onClick={() => copySectionLink(h.id)}
                  aria-label={`Copy link to section “${h.text}”`}
                  title="Copy section link"
                  className={`grid flex-shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-white ${
                    sheet ? 'h-10 w-10' : 'h-7 w-7'
                  }`}
                >
                  <span aria-hidden>⧉</span>
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
