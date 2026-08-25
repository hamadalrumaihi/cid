'use client'

/** Global search palette — merges the vanilla command palette (Cmd/Ctrl-K,
 *  app.js openPalette) and the top-bar deep search (supaSearch) into one
 *  overlay backed by the `search_all` pg_trgm RPC: typo-tolerant, ranked,
 *  RLS-scoped server-side. Charges and division members are matched from
 *  client caches; intel submissions ride the `field_submission_search` RPC.
 *
 *  Beyond search, the palette runs COMMANDS (Raycast-style): "Go to <tab>"
 *  for every screen the viewer may actually open (owner/command/SIB routes
 *  are gated), a permission-gated New-record set (via useCreate), Set/Clear
 *  LOA and Sign out. Empty query shows quick actions + recent searches;
 *  typing filters actions and records together (one shared selection).
 *
 *  Open with Cmd/Ctrl-K anywhere, or Enter in the header search box (which
 *  seeds the query). `/` focuses the header box (vanilla parity). Arrow keys
 *  move the selection, Enter opens/runs, Esc closes — including when focus
 *  has wandered off the input (document-level capture while open). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import { PAGE_META, TAB_LABEL } from '@/lib/nav'
import { useProfilesStore } from '@/lib/profiles'
import { pushRecent } from '@/lib/recents'
import { recentSearches, rememberSearch, runSearch, SEARCH_KINDS, SEARCH_SECTION_ORDER, type SearchHit } from '@/lib/search'
import { Store } from '@/lib/store'
import { toast } from '@/lib/toast'
import { useSiu } from '@/lib/useSiu'
import { useCreate, type CreateKind } from '@/components/shell/CreateHost'
import { CalendarIcon, CaseIcon, ChevronIcon, ClockIcon, KindIcon, PlusIcon, RadioIcon, ScaleIcon, XMarkIcon } from '@/components/shell/icons'
import { useToolNav } from '@/components/tools/useToolNav'

interface Row {
  hit: SearchHit
  /** First row of its section carries the heading. */
  heading: string | null
}

interface Action {
  id: string
  icon: React.ReactNode
  label: string
  keywords: string
  run: () => void | Promise<void>
}

/** Tabs whose views seed their filter input from `?q=` (persons/gangs/
 *  vehicles/places/penal; others navigate plain until their slices land or
 *  have no filter box). */
const Q_SEEDED_TABS = new Set(['persons', 'gangs', 'vehicles', 'places', 'penal'])

/** Actions surfaced on an empty query (the everyday verbs). */
const QUICK_IDS = new Set(['new-case', 'my-cases', 'go:inbox', 'go:action', 'go:calendar', 'loa', 'signout'])

/** The permission-gated create set, run through the shared CreateHost. */
const CREATE_ACTIONS: { id: string; kind: CreateKind; label: string; keywords: string }[] = [
  { id: 'new-person', kind: 'person', label: 'New person…', keywords: 'new create person suspect poi' },
  { id: 'new-vehicle', kind: 'vehicle', label: 'New vehicle…', keywords: 'new create vehicle plate car' },
  { id: 'new-gang', kind: 'gang', label: 'New gang…', keywords: 'new create gang organization club' },
  { id: 'new-place', kind: 'place', label: 'New place…', keywords: 'new create place location lab stash' },
  { id: 'new-account', kind: 'account', label: 'New account…', keywords: 'new create account handle social' },
  { id: 'new-indicator', kind: 'indicator', label: 'New indicator…', keywords: 'new create indicator phone serial alias address' },
  { id: 'new-operation', kind: 'operation', label: 'New operation…', keywords: 'new create operation task force jtf' },
]

export function SearchPalette({ open, initialQuery, onClose }: { open: boolean; initialQuery: string; onClose: () => void }) {
  // Workspace-aware push: tool hrefs land as Investigative Tools tabs, every
  // other href behaves exactly like router.push; openRecord lands person/
  // vehicle/gang/narcotic hits on their record tabs (and records the recent).
  const { openHref, openRecord } = useToolNav()
  const { profile, canEdit, isCommand, isOwner, signOut, setMyLoa } = useAuth()
  const siu = useSiu()
  const create = useCreate()
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
      // Warm the roster cache so member matches can appear (chargeHits idiom:
      // until it lands, that section simply contributes nothing).
      const profiles = useProfilesStore.getState()
      if (!profiles.loaded) void profiles.fetch()
    }, 0)
    return () => clearTimeout(t)
  }, [open, initialQuery])

  // Escape must close even when focus left the input (a result was clicked,
  // then Esc); ⌘/Ctrl-K while open refocuses the input instead of blanking
  // (the Header's opener leaves an already-open palette alone). Capture phase
  // so this wins before any bubbling handler sees the key.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

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
  const siuCanAccess = siu.canAccess
  const siuIsAgent = siu.isAgent
  const actions = useMemo<Action[]>(() => {
    const go = (path: string) => { onClose(); openHref(path) }
    const out: Action[] = []
    if (canEdit) out.push({ id: 'new-case', icon: <PlusIcon size={15} />, label: 'New case…', keywords: 'new create case open file', run: () => go('/cases?new=1') })
    if (canEdit) {
      for (const a of CREATE_ACTIONS) {
        out.push({ id: a.id, icon: <PlusIcon size={15} />, label: a.label, keywords: a.keywords, run: () => { onClose(); create.open(a.kind) } })
      }
      // No `?create=` deep link on the legal wizard today — land on the Legal
      // overview, where the drafting entry points live.
      out.push({ id: 'new-legal', icon: <ScaleIcon size={15} />, label: 'New legal request…', keywords: 'new create legal request warrant subpoena', run: () => go('/legal') })
    }
    if (siuIsAgent) out.push({ id: 'new-siu', icon: <PlusIcon size={15} />, label: 'New SIB investigation…', keywords: 'new create sib siu investigation', run: () => { onClose(); create.open('siu') } })
    // Every signed-in member may submit intelligence (the Intelligence
    // workspace's investigator submit form).
    out.push({ id: 'submit-intel', icon: <RadioIcon size={15} />, label: 'Submit intelligence…', keywords: 'submit intelligence intel tip field report', run: () => go('/field-review') })
    out.push({
      id: 'my-cases', icon: <CaseIcon size={15} />, label: 'My active cases', keywords: 'my active cases mine assigned caseload',
      // CasesView persists its scope filter; seed it before landing there.
      run: () => { Store.set('casesScope', 'mine'); go('/cases') },
    })
    out.push({
      id: 'loa', icon: <CalendarIcon size={15} />,
      label: onLoa ? 'Clear LOA — back in rotation' : 'Set LOA — mark yourself away',
      keywords: 'loa leave absence away rotation',
      run: async () => {
        onClose()
        const r = await setMyLoa(!onLoa)
        if (r.error) toast(r.error.message, 'danger')
        else toast(onLoa ? 'LOA cleared — you are back in rotation.' : 'Marked On LOA — sign-off routing will skip you.', 'success')
      },
    })
    out.push({ id: 'signout', icon: <XMarkIcon size={15} />, label: 'Sign out', keywords: 'sign out log out exit quit', run: async () => { onClose(); await signOut() } })
    // "Go to …" — gated to what this viewer may actually open. A UX gate only
    // (the routes self-gate and RLS decides data), but an ungated command list
    // would advertise owner/command/SIB surfaces to everyone.
    const gates: Record<string, boolean> = {
      owner: isOwner,
      audit: isOwner,
      devdocs: isOwner,
      'command-center': isCommand || isOwner,
      siu: siuCanAccess,
    }
    for (const [tab, meta] of Object.entries(PAGE_META)) {
      if (tab in gates && !gates[tab]) continue
      out.push({
        id: `go:${tab}`, icon: <ChevronIcon dir="right" />,
        label: `Go to ${meta.title}`,
        keywords: `go open ${tab} ${TAB_LABEL[tab] ?? ''} ${meta.title}`.toLowerCase(),
        run: () => go(`/${tab}`),
      })
    }
    return out
  }, [canEdit, isCommand, isOwner, siuCanAccess, siuIsAgent, onLoa, onClose, openHref, create, setMyLoa, signOut])

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
    const enc = encodeURIComponent
    // Reports, evidence and tasks live inside a case — search_all returns the
    // CASE id for those kinds (the task's own id rides in `term`), so open the
    // case on the matching tab. Landing on a case is an open: record it.
    if (hit.kind === 'case') { pushRecent('case', hit.id); openHref(caseLink(hit.id)) }
    else if (hit.kind === 'report') { pushRecent('case', hit.id); openHref(caseLink(hit.id, 'reports')) }
    else if (hit.kind === 'task') { pushRecent('case', hit.id); openHref(caseLink(hit.id, 'tasks', hit.term ? { task: hit.term } : {})) }
    // Legacy evidence hits land on the Photos & Media tab (its new home).
    else if (hit.kind === 'evidence') { pushRecent('case', hit.id); openHref(caseLink(hit.id, 'media')) }
    else if (hit.kind === 'legal') { pushRecent('legal_request', hit.id); openHref(`/legal?request=${enc(hit.id)}`) }
    // Documents deep-link straight into the reader (SopsView reads ?doc=).
    else if (hit.kind === 'document') { pushRecent('document', hit.id); openHref(`/sops?doc=${enc(hit.id)}`) }
    // Record-tab tools open the actual record (openRecord pushes the recent).
    // A BOLO is a flag on a person record — same destination as a person hit.
    else if (hit.kind === 'person' || hit.kind === 'bolo') openRecord('persons', hit.id, hit.label)
    else if (hit.kind === 'vehicle') openRecord('vehicles', hit.id, hit.label)
    else if (hit.kind === 'gang') openRecord('gangs', hit.id, hit.label)
    else if (hit.kind === 'narcotic') openRecord('narcotics', hit.id, hit.label)
    // Operations have a real record deep link (?op= opens the detail).
    else if (hit.kind === 'operation') { pushRecent('operation', hit.id); openHref(`/operations?op=${enc(hit.id)}`) }
    // Accounts have no per-record deep link yet — land on the registry.
    else if (hit.kind === 'account') openHref('/accounts')
    // No ?q= support on the roster / review queue yet — land on the view.
    else if (hit.kind === 'member') openHref('/personnel')
    else if (hit.kind === 'tip') openHref('/field-review')
    else if (hit.term && Q_SEEDED_TABS.has(meta.tab)) openHref(`/${meta.tab}?q=${enc(hit.term)}`)
    else openHref(`/${meta.tab}`)
  }, [onClose, query, openHref, openRecord])

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
  const optId = (i: number) => `cid-palette-opt-${i}`

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/70 backdrop-blur-sm lg:p-4 lg:pt-[12vh]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
    >
      {/* Full-screen sheet below lg (safe-area padded, results scroll under
          the fixed input); the familiar centered card from lg up. */}
      <div className="flex h-full w-full flex-col overflow-hidden bg-ink-850 pt-[env(safe-area-inset-top)] shadow-glow lg:h-auto lg:max-w-xl lg:rounded-2xl lg:border lg:border-white/10 lg:pt-0">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          type="text"
          placeholder="Search everything, or type a command…"
          aria-label="Search everything"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          aria-controls="cid-palette-listbox"
          aria-activedescendant={total > 0 && sel < total ? optId(sel) : undefined}
          autoComplete="off"
          className="w-full flex-shrink-0 border-b border-white/10 bg-transparent px-4 py-3 text-sm text-white outline-none"
        />
        <div ref={listRef} id="cid-palette-listbox" role="listbox" aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto p-1.5 lg:max-h-[55vh] lg:flex-none">
          {matchedActions.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-300/70">Actions</p>
              {matchedActions.map((a, i) => (
                <button
                  key={a.id}
                  id={optId(i)}
                  data-i={i}
                  role="option"
                  aria-selected={i === sel}
                  onClick={() => void a.run()}
                  onMouseEnter={() => setSel(i)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${i === sel ? 'bg-emerald-500/15 text-white' : 'text-slate-200 hover:bg-white/5'}`}
                >
                  <span aria-hidden className="flex w-5 justify-center text-slate-400">{a.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{a.label}</span>
                  <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-slate-500">command</span>
                </button>
              ))}
            </>
          )}
          {state === 'loading' && <p className="px-3 py-6 text-center text-sm text-slate-400">Searching…</p>}
          {state === 'error' && <p className="px-3 py-6 text-center text-sm text-rose-300">Search failed — check your connection and try again.</p>}
          {state === 'ready' && !rows.length && !matchedActions.length && <p className="px-3 py-6 text-center text-sm text-slate-400">No matches across cases, legal requests, persons, BOLOs, gangs, places, vehicles, narcotics, ballistics, documents, intelligence, members or charges.</p>}
          {state === 'idle' && recents.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Recent searches</p>
              {recents.map((r) => (
                <button key={r} onClick={() => setQuery(r)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5">
                  <span aria-hidden className="text-slate-500"><ClockIcon size={14} /></span> {r}
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
                  id={optId(gi)}
                  data-i={gi}
                  role="option"
                  aria-selected={gi === sel}
                  onClick={() => openHit(row.hit)}
                  onMouseEnter={() => setSel(gi)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${gi === sel ? 'bg-blue-500/15 text-white' : 'text-slate-200 hover:bg-white/5'}`}
                >
                  <span aria-hidden className="flex w-5 justify-center text-slate-400"><KindIcon kind={row.hit.kind} /></span>
                  <span className="min-w-0 flex-1 truncate">{row.hit.label}</span>
                  {row.hit.sublabel && <span className="max-w-[40%] flex-shrink-0 truncate text-[11px] text-slate-400">{row.hit.sublabel}</span>}
                  <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-slate-500">{SEARCH_KINDS[row.hit.kind]?.tag ?? row.hit.kind}</span>
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex-shrink-0 border-t border-white/10 px-3 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] text-[10px] text-slate-500 lg:pb-1.5">↑↓ navigate · ↵ open/run · esc close</div>
      </div>
    </div>,
    document.body,
  )
}
