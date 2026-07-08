'use client'

/** Global search palette — merges the vanilla command palette (Cmd/Ctrl-K,
 *  app.js openPalette) and the top-bar deep search (supaSearch) into one
 *  overlay backed by the `search_all` pg_trgm RPC: typo-tolerant, ranked,
 *  RLS-scoped server-side. Charges come from the client penal catalog.
 *
 *  Open with Cmd/Ctrl-K anywhere, or Enter in the header search box (which
 *  seeds the query). `/` focuses the header box (vanilla parity). Arrow keys
 *  move the selection, Enter opens, Esc closes. Empty query shows recent
 *  searches. Result navigation: cases deep-link (`/cases?case=<id>`);
 *  list views open with `?q=<term>` prefilled where supported. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { recentSearches, rememberSearch, runSearch, SEARCH_KINDS, SEARCH_SECTION_ORDER, type SearchHit } from '@/lib/search'

interface Row {
  hit: SearchHit
  /** First row of its section carries the heading. */
  heading: string | null
}

/** Tabs whose views seed their filter input from `?q=` (persons/gangs/vehicles
 *  today; others navigate plain until their slices land or have no filter box). */
const Q_SEEDED_TABS = new Set(['persons', 'gangs', 'vehicles'])

export function SearchPalette({ open, initialQuery, onClose }: { open: boolean; initialQuery: string; onClose: () => void }) {
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  // Reset per open: seed the query, focus, and run it if non-empty. Deferred a
  // tick — the codebase's lint-clean pattern for state writes inside effects.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      setQuery(initialQuery)
      setHits([])
      setState('idle')
      setSel(0)
      inputRef.current?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [open, initialQuery])

  // Debounced search — 200ms, sequence-guarded against out-of-order replies.
  // All state writes happen inside the timer (lint-clean effect pattern).
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    const mine = ++seq.current
    if (!q) {
      const t = setTimeout(() => { setHits([]); setState('idle'); setSel(0) }, 0)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setState('loading')
      runSearch(q)
        .then((rows) => { if (seq.current === mine) { setHits(rows); setState('ready'); setSel(0) } })
        .catch(() => { if (seq.current === mine) { setHits([]); setState('error') } })
    }, 200)
    return () => clearTimeout(t)
  }, [open, query])

  // Flatten ranked hits into section-ordered rows with headings.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const kind of SEARCH_SECTION_ORDER) {
      const inKind = hits.filter((h) => (kind === 'bench' ? h.kind === 'bench' || h.kind === 'footprint' : h.kind === kind))
      inKind.forEach((hit, i) => out.push({ hit, heading: i === 0 ? SEARCH_KINDS[kind].title : null }))
    }
    return out
  }, [hits])

  const openHit = useCallback((hit: SearchHit) => {
    rememberSearch(query)
    onClose()
    const meta = SEARCH_KINDS[hit.kind]
    if (!meta) return
    if (hit.kind === 'case') router.push(`/cases?case=${hit.id}`)
    else if (hit.term && Q_SEEDED_TABS.has(meta.tab)) router.push(`/${meta.tab}?q=${encodeURIComponent(hit.term)}`)
    else router.push(`/${meta.tab}`)
  }, [onClose, query, router])

  // Keyboard: arrows/enter/esc (vanilla palMove parity).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!rows.length) return
      const d = e.key === 'ArrowDown' ? 1 : -1
      const next = (sel + d + rows.length) % rows.length
      setSel(next)
      listRef.current?.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[sel]
      if (row) openHit(row.hit)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  if (!open || typeof document === 'undefined') return null
  const recents = query.trim() ? [] : recentSearches()

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/70 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-ink-850 shadow-glow">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          type="text"
          placeholder="Search cases, people, gangs, places, plates, charges…"
          aria-label="Search everything"
          autoComplete="off"
          className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-sm text-white outline-none"
        />
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-1.5">
          {state === 'loading' && <p className="px-3 py-6 text-center text-sm text-slate-500">Searching…</p>}
          {state === 'error' && <p className="px-3 py-6 text-center text-sm text-rose-300">Search failed — check your connection and try again.</p>}
          {state === 'ready' && !rows.length && <p className="px-3 py-6 text-center text-sm text-slate-500">No matches across cases, persons, gangs, places, vehicles, narcotics, ballistics, documents or charges.</p>}
          {state === 'idle' && (
            recents.length ? (
              <>
                <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Recent searches</p>
                {recents.map((r) => (
                  <button key={r} onClick={() => setQuery(r)} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5">
                    🕘 {r}
                  </button>
                ))}
              </>
            ) : (
              <p className="px-3 py-6 text-center text-sm text-slate-500">Type to search everything — typos are fine.</p>
            )
          )}
          {rows.map((row, i) => (
            <div key={`${row.hit.kind}:${row.hit.id}`}>
              {row.heading && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">{row.heading}</p>}
              <button
                data-i={i}
                onClick={() => openHit(row.hit)}
                onMouseEnter={() => setSel(i)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${i === sel ? 'bg-blue-500/15 text-white' : 'text-slate-200 hover:bg-white/5'}`}
              >
                <span aria-hidden>{SEARCH_KINDS[row.hit.kind]?.icon ?? '🔎'}</span>
                <span className="min-w-0 flex-1 truncate">{row.hit.label}</span>
                {row.hit.sublabel && <span className="max-w-[40%] flex-shrink-0 truncate text-[11px] text-slate-500">{row.hit.sublabel}</span>}
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-slate-500">↑↓ navigate · ↵ open · esc close</div>
      </div>
    </div>,
    document.body,
  )
}
