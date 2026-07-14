'use client'

/** Global search palette — merges the vanilla command palette (Cmd/Ctrl-K,
 *  app.js openPalette) and the top-bar deep search (supaSearch) into one
 *  overlay backed by the `search_all` pg_trgm RPC: typo-tolerant, ranked,
 *  RLS-scoped server-side. Charges come from the client penal catalog.
 *
 *  Beyond search, the palette runs COMMANDS (Raycast-style): "Go to <tab>"
 *  for every screen, New case, Set/Clear LOA and Sign out. Empty query shows
 *  quick actions + recent searches; typing filters actions and records
 *  together (actions listed first, one shared keyboard selection).
 *
 *  Open with Cmd/Ctrl-K anywhere, or Enter in the header search box (which
 *  seeds the query). `/` focuses the header box (vanilla parity). Arrow keys
 *  move the selection, Enter opens/runs, Esc closes. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { PAGE_META, TAB_LABEL } from '@/lib/nav'
import { recentSearches, rememberSearch, runSearch, SEARCH_KINDS, SEARCH_SECTION_ORDER, type SearchHit } from '@/lib/search'
import { toast } from '@/lib/toast'

interface Row {
  hit: SearchHit
  /** First row of its section carries the heading. */
  heading: string | null
}

interface Action {
  id: string
  icon: string
  label: string
  keywords: string
  run: () => void | Promise<void>
}

/** Tabs whose views seed their filter input from `?q=` (persons/gangs/vehicles
 *  today; others navigate plain until their slices land or have no filter box). */
const Q_SEEDED_TABS = new Set(['persons', 'gangs', 'vehicles', 'penal'])

/** Actions surfaced on an empty query (the everyday verbs). */
const QUICK_IDS = new Set(['new-case', 'go:inbox', 'go:calendar', 'loa', 'signout'])

export function SearchPalette({ open, initialQuery, onClose }: { open: boolean; initialQuery: string; onClose: () => void }) {
  const router = useRouter()
  const { profile, canEdit, signOut, setMyLoa } = useAuth()
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

  const onLoa = !!profile?.loa
  const actions = useMemo<Action[]>(() => {
    const go = (path: string) => { onClose(); router.push(path) }
    const out: Action[] = []
    if (canEdit) out.push({ id: 'new-case', icon: '📂', label: 'New case…', keywords: 'new create case open file', run: () => go('/cases?new=1') })
    out.push({
      id: 'loa', icon: '🌴',
      label: onLoa ? 'Clear LOA — back in rotation' : 'Set LOA — mark yourself away',
      keywords: 'loa leave absence away rotation',
      run: async () => {
        onClose()
        const r = await setMyLoa(!onLoa)
        if (r.error) toast(r.error.message, 'danger')
        else toast(onLoa ? 'LOA cleared — you are back in rotation.' : 'Marked On LOA — sign-off routing will skip you.', 'success')
      },
    })
    out.push({ id: 'signout', icon: '🚪', label: 'Sign out', keywords: 'sign out log out exit quit', run: async () => { onClose(); await signOut() } })
    for (const [tab, meta] of Object.entries(PAGE_META)) {
      out.push({
        id: `go:${tab}`, icon: '➜',
        label: `Go to ${meta.title}`,
        keywords: `go open ${tab} ${TAB_LABEL[tab] ?? ''} ${meta.title}`.toLowerCase(),
        run: () => go(`/${tab}`),
      })
    }
    return out
  }, [canEdit, onLoa, onClose, router, setMyLoa, signOut])

  const matchedActions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return actions.filter((a) => QUICK_IDS.has(a.id))
    return actions.filter((a) => a.label.toLowerCase().includes(q) || a.keywords.includes(q)).slice(0, 6)
  }, [actions, query])

  // Flatten ranked hits into section-ordered rows with headings.
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    for (const kind of SEARCH_SECTION_ORDER) {
      const inKind = hits.filter((h) => (kind === 'bench' ? h.kind === 'bench' || h.kind === 'footprint' : h.kind === kind))
      inKind.forEach((hit, i) => out.push({ hit, heading: i === 0 ? SEARCH_KINDS[kind].title : null }))
    }
    return out
  }, [hits])

  /** One shared selection across actions (first) then record hits. */
  const total = matchedActions.length + rows.length

  const openHit = useCallback((hit: SearchHit) => {
    rememberSearch(query)
    onClose()
    const meta = SEARCH_KINDS[hit.kind]
    if (!meta) return
    // Reports and evidence live inside a case — search_all returns the CASE id
    // for those kinds, so open the case on the matching tab.
    if (hit.kind === 'case') router.push(`/cases?case=${hit.id}`)
    else if (hit.kind === 'report') router.push(`/cases?case=${hit.id}&tab=reports`)
    else if (hit.kind === 'evidence') router.push(`/cases?case=${hit.id}&tab=evidence`)
    else if (hit.kind === 'legal') router.push(`/legal?request=${encodeURIComponent(hit.id)}`)
    else if (hit.term && Q_SEEDED_TABS.has(meta.tab)) router.push(`/${meta.tab}?q=${encodeURIComponent(hit.term)}`)
    else router.push(`/${meta.tab}`)
  }, [onClose, query, router])

  const activate = useCallback((i: number) => {
    if (i < matchedActions.length) void matchedActions[i].run()
    else {
      const row = rows[i - matchedActions.length]
      if (row) openHit(row.hit)
    }
  }, [matchedActions, rows, openHit])

  // Keyboard: arrows/enter/esc (vanilla palMove parity).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!total) return
      const d = e.key === 'ArrowDown' ? 1 : -1
      const next = (sel + d + total) % total
      setSel(next)
      listRef.current?.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (sel < total) activate(sel)
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
          placeholder="Search everything, or type a command…"
          aria-label="Search everything"
          autoComplete="off"
          className="w-full border-b border-white/10 bg-transparent px-4 py-3 text-sm text-white outline-none"
        />
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-1.5">
          {matchedActions.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-300/70">Actions</p>
              {matchedActions.map((a, i) => (
                <button
                  key={a.id}
                  data-i={i}
                  onClick={() => void a.run()}
                  onMouseEnter={() => setSel(i)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${i === sel ? 'bg-emerald-500/15 text-white' : 'text-slate-200 hover:bg-white/5'}`}
                >
                  <span aria-hidden className="w-5 text-center">{a.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                  <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-slate-600">command</span>
                </button>
              ))}
            </>
          )}
          {state === 'loading' && <p className="px-3 py-6 text-center text-sm text-slate-500">Searching…</p>}
          {state === 'error' && <p className="px-3 py-6 text-center text-sm text-rose-300">Search failed — check your connection and try again.</p>}
          {state === 'ready' && !rows.length && !matchedActions.length && <p className="px-3 py-6 text-center text-sm text-slate-500">No matches across cases, legal requests, persons, gangs, places, vehicles, narcotics, ballistics, documents or charges.</p>}
          {state === 'idle' && recents.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Recent searches</p>
              {recents.map((r) => (
                <button key={r} onClick={() => setQuery(r)} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5">
                  🕘 {r}
                </button>
              ))}
            </>
          )}
          {rows.map((row, i) => {
            const gi = i + matchedActions.length
            return (
              <div key={`${row.hit.kind}:${row.hit.id}`}>
                {row.heading && <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">{row.heading}</p>}
                <button
                  data-i={gi}
                  onClick={() => openHit(row.hit)}
                  onMouseEnter={() => setSel(gi)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${gi === sel ? 'bg-blue-500/15 text-white' : 'text-slate-200 hover:bg-white/5'}`}
                >
                  <span aria-hidden>{SEARCH_KINDS[row.hit.kind]?.icon ?? '🔎'}</span>
                  <span className="min-w-0 flex-1 truncate">{row.hit.label}</span>
                  {row.hit.sublabel && <span className="max-w-[40%] flex-shrink-0 truncate text-[11px] text-slate-500">{row.hit.sublabel}</span>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="border-t border-white/10 px-3 py-1.5 text-[10px] text-slate-500">↑↓ navigate · ↵ open/run · esc close</div>
      </div>
    </div>,
    document.body,
  )
}
