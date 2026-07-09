'use client'

/** Developer Handbook — the in-app documentation portal (owner-only, same
 *  gate as the Audit Log: UI mirror of the owner concept; there is no
 *  server data here to protect — the content is the repo's own docs,
 *  generated from docs/handbook/*.md by scripts/generate-handbook.mjs).
 *
 *  Documentation-first by design: learning and reference only. Management,
 *  diagnostics and developer operations belong in the (separate) Owner
 *  Dashboard, not here.
 *
 *  The generated content module (~90 KB of markdown) is lazy-imported so
 *  it never enters the shared bundle. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { SearchIcon } from '@/components/shell/icons'
import { anchorId, docHeadings, renderDocMarkdown, type DocHeading } from './docMarkdown'
import { DEP_KIND_META, DEP_NODES, dependentsOf, depsOf, type DepNode } from './depGraph'
import type { HandbookPage } from './handbookContent'

interface Content { pages: HandbookPage[]; updated: string }

interface SearchResult { slug: string; title: string; section: string; anchor: string | null; context: string }

const SECTION_ICON: Record<string, string> = {
  'Getting started': '🧭', 'The codebase': '🗂', 'Features & pages': '🧩',
  'Data & API': '🗄', 'Security & auth': '🛡', 'Working on it': '🔧', 'Reference': '📖',
}

export function DevDocsView() {
  const { state, isOwner } = useAuth()
  const router = useRouter()
  const sp = useSearchParams()
  const [content, setContent] = useState<Content | null>(null)
  const [loadErr, setLoadErr] = useState(false)
  const [query, setQuery] = useState('')
  const [navOpen, setNavOpen] = useState(false)

  const slug = sp.get('page') ?? 'home'

  // Lazy-load the generated content (keeps ~90 KB out of the shared bundle).
  useEffect(() => {
    if (state !== 'in' || !isOwner || content) return
    let cancelled = false
    import('./handbookContent')
      .then((m) => { if (!cancelled) setContent({ pages: m.HANDBOOK_PAGES, updated: m.HANDBOOK_UPDATED }) })
      .catch(() => { if (!cancelled) setLoadErr(true) })
    return () => { cancelled = true }
  }, [state, isOwner, content])

  const goTo = useCallback((target: string | null, anchor: string | null) => {
    setQuery('')
    setNavOpen(false)
    const next = target ?? slug
    if (target && target !== slug) router.push(`/devdocs?page=${encodeURIComponent(next)}${anchor ? `#${anchor}` : ''}`)
    if (anchor) {
      // Same-page (or after navigation) — scroll once the content exists.
      window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), target && target !== slug ? 350 : 0)
    } else if (target && target !== slug) {
      window.setTimeout(() => window.scrollTo({ top: 0 }), 50)
    }
  }, [router, slug])

  const sections = useMemo(() => {
    if (!content) return []
    const out: { title: string; pages: HandbookPage[] }[] = []
    for (const p of content.pages) {
      const s = out.find((x) => x.title === p.section)
      if (s) s.pages.push(p)
      else out.push({ title: p.section, pages: [p] })
    }
    return out
  }, [content])

  const results = useMemo((): SearchResult[] => {
    const q = query.trim().toLowerCase()
    if (!content || q.length < 2) return []
    const out: SearchResult[] = []
    for (const p of content.pages) {
      if (p.title.toLowerCase().includes(q)) {
        out.push({ slug: p.slug, title: p.title, section: p.section, anchor: null, context: 'page title' })
      }
      const lines = p.body.split('\n')
      let lastHeading: string | null = null
      for (const line of lines) {
        const h = line.match(/^##+\s+(.+)$/)
        if (h) { lastHeading = h[1]; continue }
        const idx = line.toLowerCase().indexOf(q)
        if (idx >= 0 && out.length < 30) {
          const clean = line.replace(/[|#>*`]/g, ' ').replace(/\s+/g, ' ').trim()
          if (!clean) continue
          const at = Math.max(0, clean.toLowerCase().indexOf(q) - 40)
          out.push({
            slug: p.slug, title: p.title, section: p.section,
            anchor: lastHeading ? anchorId(lastHeading) : null,
            context: (at > 0 ? '…' : '') + clean.slice(at, at + 110) + (clean.length > at + 110 ? '…' : ''),
          })
          break // one body hit per page keeps results scannable
        }
      }
    }
    return out.slice(0, 20)
  }, [content, query])

  if (state !== 'in') return <Notice text="Sign in to view the Developer Handbook." />
  if (!isOwner) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-200">
        Restricted — the Developer Handbook is owner-only.
      </div>
    )
  }
  if (loadErr) return <Notice text="Could not load the handbook content. Reload to retry." />
  if (!content) return <Notice text="Loading the handbook…" />

  const page = content.pages.find((p) => p.slug === slug) ?? null

  return (
    <div className="mx-auto max-w-7xl">
      {/* breadcrumbs + search */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-slate-400">
          <button onClick={() => goTo('home', null)} className="font-bold text-slate-300 hover:text-white">📘 Developer Handbook</button>
          {page && <><span aria-hidden className="text-slate-600">/</span><span>{page.section}</span><span aria-hidden className="text-slate-600">/</span><span className="font-semibold text-white">{page.title}</span></>}
          {!page && slug !== 'home' && <><span aria-hidden className="text-slate-600">/</span><span className="text-rose-300">unknown page</span></>}
        </nav>
        <div className="relative w-full sm:w-72">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 focus-within:border-badge-500">
            <SearchIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the handbook…"
              aria-label="Search the handbook"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
          </div>
          {results.length > 0 && (
            <div className="absolute right-0 top-full z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-white/10 bg-ink-900 p-1 shadow-2xl sm:w-96">
              {results.map((r, i) => (
                <button
                  key={`${r.slug}-${i}`}
                  onClick={() => goTo(r.slug, r.anchor)}
                  className="block w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/5"
                >
                  <p className="text-xs font-bold text-white">{r.title} <span className="font-normal text-slate-500">· {r.section}</span></p>
                  <p className="truncate text-[11px] text-slate-400">{r.context}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* mobile page picker */}
      <div className="mb-4 lg:hidden">
        <button
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
          className="w-full rounded-xl border border-white/10 bg-ink-900/60 px-4 py-2.5 text-left text-sm font-bold text-white"
        >
          ☰ {page ? page.title : 'Handbook home'} <span className="float-right text-slate-500">{navOpen ? '▲' : '▼'}</span>
        </button>
        {navOpen && (
          <div className="mt-2 rounded-xl border border-white/10 bg-ink-900/90 p-3">
            <DocsNav sections={sections} active={slug} onGo={goTo} />
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* sidebar (desktop) */}
        <aside className="sticky top-4 hidden w-56 flex-shrink-0 self-start lg:block" aria-label="Handbook navigation">
          <DocsNav sections={sections} active={slug} onGo={goTo} />
        </aside>

        {/* article */}
        <div className="min-w-0 flex-1">
          {slug === 'home'
            ? <HomePage content={content} sections={sections} onGo={goTo} />
            : page
              ? <ArticlePage page={page} onGo={goTo} />
              : <Notice text="That page doesn't exist — pick one from the sidebar." />}
        </div>
      </div>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">{text}</div>
}

/* ---- sidebar --------------------------------------------------------- */

function DocsNav({ sections, active, onGo }: {
  sections: { title: string; pages: HandbookPage[] }[]
  active: string
  onGo: (slug: string, anchor: string | null) => void
}) {
  return (
    <nav className="space-y-3">
      <button
        onClick={() => onGo('home', null)}
        className={`block w-full rounded-lg px-3 py-1.5 text-left text-xs font-bold transition ${active === 'home' ? 'bg-blue-500/15 text-white' : 'text-slate-300 hover:bg-white/5'}`}
      >
        🏠 Home
      </button>
      {sections.map((s) => (
        <div key={s.title}>
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span aria-hidden>{SECTION_ICON[s.title] ?? '·'}</span> {s.title}
          </p>
          <div className="space-y-0.5">
            {s.pages.map((p) => (
              <button
                key={p.slug}
                onClick={() => onGo(p.slug, null)}
                aria-current={p.slug === active ? 'page' : undefined}
                className={`block w-full rounded-lg px-3 py-1.5 text-left text-xs transition ${p.slug === active ? 'bg-blue-500/15 font-bold text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
              >
                {p.title}
              </button>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

/* ---- landing page ----------------------------------------------------- */

const STACK = ['Next.js 16', 'React 19', 'TypeScript', 'Tailwind v4', 'Supabase', 'zustand', 'React Flow', '@react-pdf', 'Tiptap', 'vitest']

const QUICK_LINKS: { slug: string; anchor: string | null; label: string; sub: string }[] = [
  { slug: 'learning-path', anchor: null, label: '🧭 Learning Path', sub: 'New here? Start with the first-two-weeks checklist.' },
  { slug: 'change-impact', anchor: null, label: '⚠️ Change Impact', sub: '"If I change X, what else must I check?"' },
  { slug: 'debugging', anchor: null, label: '🔧 Debugging', sub: 'Symptom → likely cause → where to look.' },
  { slug: 'database', anchor: null, label: '🗄 Database', sub: 'All 47 tables, policies, triggers.' },
  { slug: 'faq', anchor: null, label: '❓ FAQ', sub: 'First-week questions, answered for this repo.' },
  { slug: 'dependency-map', anchor: null, label: '🕸 Dependency Explorer', sub: 'What depends on what — interactive.' },
]

function HomePage({ content, sections, onGo }: {
  content: Content
  sections: { title: string; pages: HandbookPage[] }[]
  onGo: (slug: string, anchor: string | null) => void
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <p className="t-readout mb-3 inline-flex items-center gap-2 rounded border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-blue-200">
          <span className="t-dot t-dot-cyan" /> Internal documentation · updated {content.updated}
        </p>
        <h2 className="text-xl font-black text-white">How the CID Portal works — all of it</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          A Next.js single-page app on Vercel talking straight to a Supabase Postgres backend.
          There is no custom server: every security rule that matters lives in the database as
          Row Level Security, functions and triggers. <b className="text-slate-200">The database is the
          authority; the UI is a convenience</b> — keep that in mind and everything else follows.
        </p>
        <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Technology stack">
          {STACK.map((t) => <span key={t} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300">{t}</span>)}
        </div>
      </div>

      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <h3 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-400">Architecture at a glance</h3>
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-ink-950 p-4 font-mono text-[11px] leading-relaxed text-slate-300">{`┌───────────────────────────┐         ┌──────────────────────────────┐
│  The web app (this repo)  │  HTTPS  │  Supabase (hosted backend)   │
│  Next.js + React + TS     │ ──────► │  Postgres DB + Auth +        │
│  runs in the browser,     │ ◄────── │  auto-REST API + Realtime    │
│  hosted on Vercel         │  wss    │  websockets                  │
└───────────────────────────┘         └──────────────────────────────┘
                                             ▲
                     ┌───────────────────────┘
                     │ file uploads only
              ┌──────┴───────┐
              │  FiveManage  │  (external image/video host)
              └──────────────┘`}</pre>
        <p className="mt-2 text-xs text-slate-500">
          Full detail: <button onClick={() => onGo('overview', null)} className="text-blue-300 underline decoration-blue-300/40 hover:text-blue-200">Project Overview</button> and{' '}
          <button onClick={() => onGo('architecture', null)} className="text-blue-300 underline decoration-blue-300/40 hover:text-blue-200">Architecture Blocks</button>.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {QUICK_LINKS.map((q) => (
          <button key={q.slug} onClick={() => onGo(q.slug, q.anchor)} className="rounded-xl border border-white/10 bg-ink-950/50 p-4 text-left transition hover:border-blue-400/30 hover:bg-white/[0.03]">
            <p className="text-sm font-black text-white">{q.label}</p>
            <p className="mt-1 text-xs text-slate-400">{q.sub}</p>
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <h3 className="mb-3 text-sm font-black uppercase tracking-wider text-slate-400">All chapters</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {sections.map((s) => (
            <div key={s.title}>
              <p className="mb-1 text-xs font-bold text-slate-300"><span aria-hidden>{SECTION_ICON[s.title] ?? '·'}</span> {s.title}</p>
              <ul className="space-y-0.5">
                {s.pages.map((p) => (
                  <li key={p.slug}>
                    <button onClick={() => onGo(p.slug, null)} className="text-xs text-blue-300 hover:underline">{p.title}</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-white/5 pt-3 text-[11px] text-slate-500">
          Source of truth: <code className="rounded bg-white/10 px-1">docs/handbook/*.md</code> in the repository —
          this portal is generated from it (<code className="rounded bg-white/10 px-1">npm run gen:handbook</code>);
          CI fails if the two drift.
        </p>
      </div>
    </div>
  )
}

/* ---- article page ------------------------------------------------------ */

function ArticlePage({ page, onGo }: { page: HandbookPage; onGo: (slug: string | null, anchor: string | null) => void }) {
  const headings = useMemo(() => docHeadings(page.body), [page.body])
  const rendered = useMemo(() => renderDocMarkdown(page.body, onGo), [page.body, onGo])

  return (
    <div className="flex items-start gap-6">
      <article className="min-w-0 flex-1 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <h1 className="text-xl font-black text-white">{page.title}</h1>
        <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{page.section}</p>
        {rendered}
        {page.slug === 'dependency-map' && <DepExplorer />}
      </article>
      {headings.length > 1 && <PageToc headings={headings} />}
    </div>
  )
}

/** Right-rail table of contents with scroll-spy highlighting. */
function PageToc({ headings }: { headings: DocHeading[] }) {
  const [active, setActive] = useState<string | null>(null)
  const ids = useMemo(() => headings.map((h) => h.id).join(','), [headings])

  useEffect(() => {
    const els = ids.split(',').map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e)
    if (!els.length) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-10% 0px -70% 0px' },
    )
    els.forEach((e) => obs.observe(e))
    return () => obs.disconnect()
  }, [ids])

  return (
    <nav aria-label="On this page" className="sticky top-4 hidden w-44 flex-shrink-0 self-start xl:block">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">On this page</p>
      <div className="space-y-0.5 border-l border-white/10">
        {headings.map((h) => (
          <button
            key={h.id}
            onClick={() => document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className={`block w-full truncate border-l-2 py-1 pr-1 text-left text-[11px] transition ${h.level === 3 ? 'pl-5' : 'pl-3'} ${
              active === h.id ? 'border-badge-500 font-bold text-white' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {h.text}
          </button>
        ))}
      </div>
    </nav>
  )
}

/* ---- dependency explorer (rendered under the Dependency Map chapter;
   also reused by the Owner Portal's Change Impact Center) ------------------ */

export function DepExplorer() {
  const [sel, setSel] = useState<DepNode | null>(null)
  const [kindFilter, setKindFilter] = useState<string>('')
  const panelRef = useRef<HTMLDivElement>(null)

  const nodes = kindFilter ? DEP_NODES.filter((n) => n.kind === kindFilter) : DEP_NODES

  const pick = (n: DepNode) => {
    setSel(n)
    window.setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 0)
  }

  return (
    <section aria-label="Dependency explorer" className="mt-8 border-t border-white/10 pt-6">
      <h2 className="mb-1 text-lg font-black text-white">Interactive explorer</h2>
      <p className="mb-3 text-xs text-slate-500">
        Pick anything to see what it depends on, what depends on it, and what to check if you change it.
        Read-only — for understanding, not editing.
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <FilterChip label="All" active={!kindFilter} onClick={() => setKindFilter('')} />
        {Object.entries(DEP_KIND_META).map(([k, m]) => (
          <FilterChip key={k} label={m.label} active={kindFilter === k} onClick={() => setKindFilter(kindFilter === k ? '' : k)} />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {nodes.map((n) => (
          <button
            key={n.id}
            onClick={() => pick(n)}
            aria-pressed={sel?.id === n.id}
            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition ${DEP_KIND_META[n.kind].tint} ${sel?.id === n.id ? 'ring-2 ring-white/50' : 'hover:brightness-125'}`}
          >
            {n.label}
          </button>
        ))}
      </div>

      {sel && (
        <div ref={panelRef} className="mt-4 rounded-xl border border-white/10 bg-ink-950/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-white">{sel.label}
                <span className={`ml-2 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${DEP_KIND_META[sel.kind].tint}`}>{DEP_KIND_META[sel.kind].label}</span>
                <span className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${sel.risk === 'high' ? 'bg-rose-500/15 text-rose-300' : sel.risk === 'medium' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{sel.risk} risk</span>
              </p>
              <p className="mt-1 text-xs text-slate-400">{sel.about}</p>
            </div>
            <button onClick={() => setSel(null)} aria-label="Close details" className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300 hover:bg-white/10">✕</button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DepList title="Depends on" nodes={depsOf(sel.id)} empty="Nothing in this map — a foundation node." onPick={pick} />
            <DepList title="Depended on by" nodes={dependentsOf(sel.id)} empty="Nothing depends on it directly." onPick={pick} />
          </div>
          <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-300/80">If I change this…</p>
            <p className="mt-0.5 text-xs text-slate-300">{sel.ifChanged}</p>
          </div>
        </div>
      )}
    </section>
  )
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${active ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}
    >
      {label}
    </button>
  )
}

function DepList({ title, nodes, empty, onPick }: { title: string; nodes: DepNode[]; empty: string; onPick: (n: DepNode) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
      {nodes.length ? (
        <div className="flex flex-wrap gap-1">
          {nodes.map((n) => (
            <button key={n.id} onClick={() => onPick(n)} className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold transition hover:brightness-125 ${DEP_KIND_META[n.kind].tint}`}>
              {n.label}
            </button>
          ))}
        </div>
      ) : <p className="text-[11px] text-slate-600">{empty}</p>}
    </div>
  )
}
