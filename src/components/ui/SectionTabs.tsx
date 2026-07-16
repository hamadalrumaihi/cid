'use client'

/** Accessible, horizontally-scrolling section nav — a generalisation of the
 *  case-detail tab strip (overflow fades tracked to real scroll position,
 *  roving-tabindex keyboard focus, active-tab-into-view on change, reduced
 *  motion respected). The parent owns the active id and the URL: `onChange`
 *  fires on activation so the caller can `router.replace(?section=…)`. Panels
 *  wire up with `id={panelId(active)}` + `aria-labelledby={tabId(active)}`.
 *
 *  Kept presentational — no data fetching, no router coupling — so any detail
 *  screen (gangs, and future dossiers) can share one keyboard-correct strip
 *  instead of re-deriving the mechanics. */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface SectionTab<Id extends string = string> {
  id: Id
  label: string
  /** Optional count shown as a trailing pill. `undefined` renders no pill;
   *  `0` renders a muted “0”. */
  count?: number
  /** Amber attention dot (e.g. stale intel / needs review). */
  marker?: boolean
  markerLabel?: string
}

/** Optional visual grouping for dense strips (e.g. the case workspace).
 *  Groups reorder the strip (group order wins); tabs not named in any group
 *  render after the last group, ungrouped. Purely presentational — the
 *  tablist semantics, roving focus and activation are unchanged. */
export interface SectionTabGroup<Id extends string = string> {
  label: string
  tabs: ReadonlyArray<Id>
}

export function tabDomId(base: string, id: string) { return `${base}-tab-${id}` }
export function panelDomId(base: string, id: string) { return `${base}-panel-${id}` }

export function SectionTabs<Id extends string>({
  tabs,
  active,
  onChange,
  idBase,
  ariaLabel = 'Sections',
  className = '',
  groups,
}: {
  tabs: ReadonlyArray<SectionTab<Id>>
  active: Id
  onChange: (id: Id) => void
  /** Stable prefix for tab/panel element ids so `aria-controls` resolves. */
  idBase: string
  ariaLabel?: string
  className?: string
  /** Render the strip as labelled groups (see SectionTabGroup). Omitted →
   *  the flat strip renders exactly as before. */
  groups?: ReadonlyArray<SectionTabGroup<Id>>
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Partial<Record<Id, HTMLButtonElement | null>>>({})
  const rafRef = useRef<number | undefined>(undefined)
  const [fade, setFade] = useState({ left: false, right: false })

  // Grouped rendering plan: [groupLabel|null, its tabs][] in display order,
  // plus the flattened order the roving focus walks. Without `groups` this
  // degenerates to one unlabelled section — the pre-existing flat strip.
  const sections = useMemo((): Array<{ label: string | null; items: Array<SectionTab<Id>> }> => {
    if (!groups?.length) return [{ label: null, items: [...tabs] }]
    const byId = new Map(tabs.map((t) => [t.id, t]))
    const seen = new Set<Id>()
    const out: Array<{ label: string | null; items: Array<SectionTab<Id>> }> = []
    for (const g of groups) {
      const items: Array<SectionTab<Id>> = []
      for (const id of g.tabs) {
        const t = byId.get(id)
        if (t && !seen.has(id)) { seen.add(id); items.push(t) }
      }
      if (items.length) out.push({ label: g.label, items })
    }
    const rest = tabs.filter((t) => !seen.has(t.id))
    if (rest.length) out.push({ label: null, items: [...rest] })
    return out
  }, [tabs, groups])
  const ordered = useMemo(() => sections.flatMap((s) => s.items), [sections])

  const readFades = useCallback(() => {
    const el = stripRef.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }))
  }, [])

  const onScroll = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = undefined; readFades() })
  }, [readFades])

  useEffect(() => {
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('resize', onScroll)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [onScroll])

  // Bring the active tab into view on mount and on every change, then re-measure.
  useEffect(() => {
    const el = tabRefs.current[active]
    if (el) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
    }
    readFades()
  }, [active, readFades])

  // Roving focus only — arrows/Home/End move focus; activation stays on click
  // so the URL isn't churned as focus roams the strip.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const el = document.activeElement
    let idx = ordered.findIndex((t) => tabRefs.current[t.id] === el)
    if (idx < 0) idx = ordered.findIndex((t) => t.id === active)
    const n = ordered.length
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : e.key === 'ArrowLeft' ? (idx - 1 + n) % n
      : (idx + 1) % n
    tabRefs.current[ordered[next].id]?.focus()
  }

  const renderTab = (t: SectionTab<Id>) => {
    const on = t.id === active
    return (
      <button
        key={t.id}
        ref={(el) => { tabRefs.current[t.id] = el }}
        role="tab"
        id={tabDomId(idBase, t.id)}
        aria-selected={on}
        aria-controls={panelDomId(idBase, t.id)}
        tabIndex={on ? 0 : -1}
        title={t.marker ? (t.markerLabel ?? 'Needs attention') : undefined}
        onClick={() => onChange(t.id)}
        className={`relative flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold sm:min-h-0 ${
          on ? 'bg-badge-500 text-ink-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'
        }`}
      >
        {t.label}
        {t.count !== undefined && (
          <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${on ? 'bg-white/20 text-ink-950' : 'bg-white/10 text-slate-400'}`}>
            {t.count}
          </span>
        )}
        {t.marker && (
          <>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            <span className="sr-only">{t.markerLabel ?? 'Needs attention'}</span>
          </>
        )}
      </button>
    )
  }

  return (
    <div className={`relative ${className}`}>
      {fade.left && <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-ink-950 to-transparent" />}
      {fade.right && <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-ink-950 to-transparent" />}
      <div
        ref={stripRef}
        role="tablist"
        aria-label={ariaLabel}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        className="flex gap-2 overflow-x-auto py-1"
      >
        {sections.map((s, i) => (
          <Fragment key={s.label ?? `section-${i}`}>
            {/* Group chrome is decorative — the tabs themselves stay the only
                interactive/announced children of the tablist. */}
            {s.label !== null && (
              <span aria-hidden className="flex flex-shrink-0 items-center gap-2 self-center">
                {i > 0 && <span className="h-6 w-px bg-white/10" />}
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{s.label}</span>
              </span>
            )}
            {s.label === null && i > 0 && <span aria-hidden className="h-6 w-px flex-shrink-0 self-center bg-white/10" />}
            {s.items.map(renderTab)}
          </Fragment>
        ))}
      </div>
    </div>
  )
}
