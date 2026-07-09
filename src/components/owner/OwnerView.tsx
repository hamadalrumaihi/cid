'use client'

/** Owner Portal — the project owner's control center: project intelligence,
 *  feedback triage, change planning and engineering workflow in one
 *  owner-only place. Documentation lives in the Developer Handbook
 *  (Reference → Developer Handbook); this portal is for browsing,
 *  management, diagnostics and action planning.
 *
 *  Access: useAuth().isOwner (profiles.is_owner) gates the UI; RLS
 *  (private.is_owner()) is the real wall on feedback/feedback_meta/audit.
 *  NOT a CID operational screen — division data appears only as high-level
 *  counts and health signals. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { countRows, insert, list, update, updateWhere, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { isConfigured } from '@/lib/supabase'
import { fmConfigured } from '@/lib/fivemanage'
import { useRealtimeStore } from '@/lib/realtime'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { SearchIcon } from '@/components/shell/icons'
import { DepExplorer } from '@/components/devdocs/DevDocsView'
import {
  ENV_VARS, FB_PRIORITIES, FB_PRIORITY_TINT, FB_STATUSES, FB_STATUS_TINT, FB_TYPES,
  LEARNING, MATRIX_NOTE, PERMISSIONS_MATRIX, REALTIME_DOC, ROUTES, SUGGESTIONS, WORKFLOW, fbLabel,
} from './ownerData'

type FeedbackRow = Tables<'feedback'>
type MetaRow = Tables<'feedback_meta'>
interface FbItem { fb: FeedbackRow; meta: MetaRow | null }

const SECTIONS: { id: string; icon: string; label: string; sub: string }[] = [
  { id: 'home', icon: '🏠', label: 'Overview', sub: 'What this portal is and where everything lives' },
  { id: 'health', icon: '🩺', label: 'Health & statistics', sub: 'Service checks, safety warnings & live counts' },
  { id: 'feedback', icon: '📨', label: 'Feedback & Bugs', sub: 'The owner inbox — triage, catalog, resolve' },
  { id: 'suggestions', icon: '💡', label: 'Suggestions', sub: 'The improvement roadmap from the repo analysis' },
  { id: 'impact', icon: '🎯', label: 'Change Impact', sub: '"If I change this, what else must I check?"' },
  { id: 'architecture', icon: '🏗️', label: 'Architecture', sub: 'The system at a glance + deep links' },
  { id: 'routes', icon: '🗺️', label: 'Routes', sub: 'Every screen, its access rule and risk' },
  { id: 'env', icon: '🔐', label: 'Environment', sub: 'Variables — configured or not, never values' },
  { id: 'realtime', icon: '📡', label: 'Realtime', sub: 'Channels, session activity & failure points' },
  { id: 'workflow', icon: '🚦', label: 'Workflow', sub: 'Safe development, deploys, rollback & permissions' },
  { id: 'learning', icon: '🎓', label: 'Learning Center', sub: 'Paths, common mistakes, what to avoid early' },
]

export function OwnerView() {
  const { state, isOwner } = useAuth()
  const router = useRouter()
  const sp = useSearchParams()
  const section = sp.get('s') ?? 'home'
  const [query, setQuery] = useState('')
  const [handbookTitles, setHandbookTitles] = useState<{ slug: string; title: string }[]>([])

  const go = useCallback((s: string) => {
    setQuery('')
    router.push(s === 'home' ? '/owner' : `/owner?s=${s}`)
    window.setTimeout(() => window.scrollTo({ top: 0 }), 50)
  }, [router])

  // Handbook titles for global search (lazy — same generated module devdocs uses).
  useEffect(() => {
    if (state !== 'in' || !isOwner || handbookTitles.length) return
    let cancelled = false
    import('@/components/devdocs/handbookContent')
      .then((m) => { if (!cancelled) setHandbookTitles(m.HANDBOOK_PAGES.map((p) => ({ slug: p.slug, title: p.title }))) })
      .catch(() => { /* search just won't include handbook pages */ })
    return () => { cancelled = true }
  }, [state, isOwner, handbookTitles.length])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const out: { type: string; label: string; sub: string; go: () => void }[] = []
    for (const s of SECTIONS) if (`${s.label} ${s.sub}`.toLowerCase().includes(q)) out.push({ type: 'Section', label: s.label, sub: s.sub, go: () => go(s.id) })
    for (const r of ROUTES) if (`${r.path} ${r.component}`.toLowerCase().includes(q)) out.push({ type: 'Route', label: r.path, sub: r.component, go: () => go('routes') })
    for (const sug of SUGGESTIONS) if (sug.title.toLowerCase().includes(q)) out.push({ type: 'Suggestion', label: sug.title, sub: sug.group, go: () => go('suggestions') })
    for (const e of ENV_VARS) if (e.name.toLowerCase().includes(q)) out.push({ type: 'Env', label: e.name, sub: e.purpose, go: () => go('env') })
    for (const h of handbookTitles) if (h.title.toLowerCase().includes(q)) out.push({ type: 'Handbook', label: h.title, sub: 'Developer Handbook', go: () => router.push(`/devdocs?page=${h.slug}`) })
    return out.slice(0, 12)
  }, [query, handbookTitles, go, router])

  if (state !== 'in') return <Notice text="Sign in to view the Owner Portal." />
  if (!isOwner) {
    return (
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-200">
        Restricted — the Owner Portal is owner-only. If you believe you should have access,
        ownership is granted on the database profile, not in the app.
      </div>
    )
  }

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]

  return (
    <div className="mx-auto max-w-7xl">
      {/* breadcrumbs + global portal search */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-slate-400">
          <button onClick={() => go('home')} className="font-bold text-slate-300 hover:text-white">🛠️ Owner Portal</button>
          {active.id !== 'home' && <><span aria-hidden className="text-slate-600">/</span><span className="font-semibold text-white">{active.label}</span></>}
        </nav>
        <div className="relative w-full sm:w-80">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 focus-within:border-badge-500">
            <SearchIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
            <input
              type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sections, routes, env, suggestions, docs…"
              aria-label="Search the Owner Portal"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
          </div>
          {results.length > 0 && (
            <div className="absolute right-0 top-full z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-white/10 bg-ink-900 p-1 shadow-2xl">
              {results.map((r, i) => (
                <button key={i} onClick={() => { setQuery(''); r.go() }} className="block w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/5">
                  <p className="text-xs font-bold text-white">
                    <span className="mr-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-slate-400">{r.type}</span>
                    {r.label}
                  </p>
                  <p className="truncate text-[11px] text-slate-400">{r.sub}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        <aside className="sticky top-4 hidden w-52 flex-shrink-0 self-start lg:block" aria-label="Owner Portal navigation">
          <nav className="space-y-0.5">
            {SECTIONS.map((s) => (
              <button
                key={s.id} onClick={() => go(s.id)}
                aria-current={s.id === active.id ? 'page' : undefined}
                className={`block w-full rounded-lg px-3 py-1.5 text-left text-xs transition ${s.id === active.id ? 'bg-blue-500/15 font-bold text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
              >
                <span aria-hidden>{s.icon}</span> {s.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          {/* mobile section picker */}
          <div className="mb-4 lg:hidden">
            <select
              value={active.id} onChange={(e) => go(e.target.value)} aria-label="Owner Portal section"
              className="w-full rounded-xl border border-white/10 bg-ink-900 px-3 py-2.5 text-sm font-bold text-white outline-none"
            >
              {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
            </select>
          </div>

          {active.id === 'home' && <HomeSection onGo={go} />}
          {active.id === 'health' && <HealthSection />}
          {active.id === 'feedback' && <FeedbackInbox />}
          {active.id === 'suggestions' && <SuggestionsSection />}
          {active.id === 'impact' && <ImpactSection />}
          {active.id === 'architecture' && <ArchitectureSection />}
          {active.id === 'routes' && <RoutesSection />}
          {active.id === 'env' && <EnvSection />}
          {active.id === 'realtime' && <RealtimeSection />}
          {active.id === 'workflow' && <WorkflowSection />}
          {active.id === 'learning' && <LearningSection />}
        </div>
      </div>
    </div>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">{text}</div>
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/5 bg-ink-900/60 p-5">
      <h3 className="text-sm font-black uppercase tracking-wider text-slate-400">{title}</h3>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/* ---- home ---------------------------------------------------------------- */

function HomeSection({ onGo }: { onGo: (s: string) => void }) {
  const router = useRouter()
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <p className="t-readout mb-3 inline-flex items-center gap-2 rounded border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-blue-200">
          <span className="t-dot t-dot-cyan" /> Owner &amp; developer operations
        </p>
        <h2 className="text-xl font-black text-white">The project&rsquo;s control center</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          One owner-only place to understand, monitor, maintain and safely evolve the portal:
          health and statistics, the feedback inbox, the improvement roadmap, change-impact
          planning, and the engineering workflow. Learning and reference live in the{' '}
          <button onClick={() => router.push('/devdocs')} className="text-blue-300 underline decoration-blue-300/40 hover:text-blue-200">Developer Handbook</button> —
          this portal is for deciding and doing.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SECTIONS.filter((s) => s.id !== 'home').map((s) => (
          <button key={s.id} onClick={() => onGo(s.id)} className="rounded-xl border border-white/10 bg-ink-950/50 p-4 text-left transition hover:border-blue-400/30 hover:bg-white/[0.03]">
            <p className="text-sm font-black text-white"><span aria-hidden>{s.icon}</span> {s.label}</p>
            <p className="mt-1 text-xs text-slate-400">{s.sub}</p>
          </button>
        ))}
        <button onClick={() => router.push('/devdocs')} className="rounded-xl border border-white/10 bg-ink-950/50 p-4 text-left transition hover:border-blue-400/30 hover:bg-white/[0.03]">
          <p className="text-sm font-black text-white"><span aria-hidden>📘</span> Developer Handbook</p>
          <p className="mt-1 text-xs text-slate-400">The reference library — 24 chapters, searchable, generated from the repo docs.</p>
        </button>
        <button onClick={() => router.push('/audit')} className="rounded-xl border border-white/10 bg-ink-950/50 p-4 text-left transition hover:border-blue-400/30 hover:bg-white/[0.03]">
          <p className="text-sm font-black text-white"><span aria-hidden>🧾</span> Audit Log</p>
          <p className="mt-1 text-xs text-slate-400">Every mutation, trigger-written, exportable to CSV (owner-only screen).</p>
        </button>
      </div>
    </div>
  )
}

/* ---- health & statistics --------------------------------------------------- */

interface HealthState {
  db: { ok: boolean; ms: number } | null
  counts: Record<string, number | null>
  at: number
}

const STAT_TABLES = ['profiles', 'cases', 'evidence', 'reports', 'persons', 'gangs', 'vehicles', 'indicators', 'media', 'feedback', 'notifications', 'audit_log'] as const

function HealthSection() {
  const { session } = useAuth()
  const versions = useRealtimeStore((s) => s.versions)
  const [h, setH] = useState<HealthState | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    const t0 = performance.now()
    let db: HealthState['db'] = null
    try { await countRows('profiles'); db = { ok: true, ms: Math.round(performance.now() - t0) } }
    catch { db = { ok: false, ms: Math.round(performance.now() - t0) } }
    const counts: Record<string, number | null> = {}
    await Promise.all(STAT_TABLES.map(async (t) => {
      try { counts[t] = await countRows(t) } catch { counts[t] = null }
    }))
    setH({ db, counts, at: Date.now() })
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const commit = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null
  const branch = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ?? null
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV ?? null
  const liveTables = Object.keys(versions).length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HealthCard label="Database" ok={h?.db?.ok ?? null} detail={h?.db ? `${h.db.ms} ms round-trip` : 'checking…'} />
        <HealthCard label="Authentication" ok={!!session} detail={session ? 'session active, auto-refreshing' : 'no session'} />
        <HealthCard label="Realtime" ok={liveTables > 0 ? true : null} detail={liveTables > 0 ? `events from ${liveTables} tables this session` : 'no events yet this session (signal, not a failure)'} />
        <HealthCard label="Media host" ok={fmConfigured()} detail={fmConfigured() ? 'FiveManage configured (not pinged — pinging would upload)' : 'not configured — uploads disabled'} />
      </div>

      <Panel title="Application" sub="Build metadata comes from Vercel system env vars — 'Unavailable' means the project doesn't expose them, not an error.">
        <div className="grid grid-cols-1 gap-2 text-xs text-slate-300 sm:grid-cols-2">
          <p>Environment: <b className="text-white">{vercelEnv ?? (process.env.NODE_ENV === 'production' ? 'production build' : 'development')}</b></p>
          <p>Deployed branch: <b className="text-white">{branch ?? 'Unavailable'}</b></p>
          <p>Commit: <b className="font-mono text-white">{commit ? commit.slice(0, 10) : 'Unavailable'}</b></p>
          <p>Supabase client: <b className="text-white">{isConfigured ? 'configured' : 'NOT CONFIGURED'}</b></p>
        </div>
      </Panel>

      <Panel title="Safety" sub="Checks that should always be green.">
        <ul className="space-y-1.5 text-xs">
          <SafetyLine ok={isConfigured} text="Supabase env vars present" bad="Missing NEXT_PUBLIC_SUPABASE_* — the app cannot function" />
          <SafetyLine ok={fmConfigured()} text="FiveManage configured (optional)" bad="Uploads disabled — Attachments/Media fall back to paste-a-URL" warnOnly />
          <SafetyLine ok={h?.db?.ok ?? true} text="Database reachable" bad="Profile count query failed — check Supabase status/logs" />
          <li className="text-slate-500">Owner-dashboard items that live OUTSIDE this repo: Supabase OTP expiry + leaked-password protection + backups (see docs/HARDENING.md), GitHub branch protection (see Workflow).</li>
        </ul>
      </Panel>

      <Panel title="Statistics" sub="Live row counts (RLS-scoped — these are the rows YOUR account can see, which for the owner+command account is everything). 'Unavailable' = the count query failed.">
        {loading && !h ? <p className="text-xs text-slate-500">Counting…</p> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {STAT_TABLES.map((t) => (
              <div key={t} className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
                <p className="font-mono text-lg font-black text-white">{h?.counts[t] ?? '—'}</p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{t.replace(/_/g, ' ')}</p>
              </div>
            ))}
          </div>
        )}
        <button onClick={() => void refresh()} disabled={loading} className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50">
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </Panel>
    </div>
  )
}

function HealthCard({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400">
        <span className={`t-dot ${ok === true ? 't-dot-green' : ok === false ? 't-dot-rose' : 't-dot-amber'}`} /> {label}
      </p>
      <p className="mt-1.5 text-xs text-slate-300">{detail}</p>
    </div>
  )
}

function SafetyLine({ ok, text, bad, warnOnly }: { ok: boolean; text: string; bad: string; warnOnly?: boolean }) {
  return (
    <li className={ok ? 'text-emerald-300' : warnOnly ? 'text-amber-300' : 'text-rose-300'}>
      {ok ? '✓' : warnOnly ? '⚠' : '✗'} {ok ? text : bad}
    </li>
  )
}

/* ---- feedback & bugs inbox --------------------------------------------------- */

const FB_VIEWS: { id: string; label: string; match: (i: FbItem) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'new', label: 'New / Unreviewed', match: (i) => !i.meta || i.meta.status === 'new' },
  { id: 'bugs', label: 'Bugs', match: (i) => (i.meta?.type ?? (i.fb.kind === 'bug' ? 'bug' : '')) === 'bug' },
  { id: 'suggestions', label: 'Suggestions', match: (i) => (i.meta?.type ??
      (i.fb.kind === 'feature' ? 'feature_request' : '')) === 'suggestion' },
  { id: 'features', label: 'Feature requests', match: (i) => (i.meta?.type ?? (i.fb.kind === 'feature' ? 'feature_request' : '')) === 'feature_request' },
  { id: 'high', label: 'High priority', match: (i) => i.meta?.priority === 'high' || i.meta?.priority === 'critical' },
  { id: 'progress', label: 'In progress', match: (i) => i.meta?.status === 'in_progress' },
  { id: 'resolved', label: 'Resolved', match: (i) => i.meta?.status === 'resolved' },
  { id: 'archived', label: 'Archived', match: (i) => i.meta?.status === 'archived' },
]

function FeedbackInbox() {
  const [items, setItems] = useState<FbItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [view, setView] = useState('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('newest')
  const [detail, setDetail] = useState<FbItem | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const [fbs, metas] = await Promise.all([
        withRetry(() => list('feedback', { order: 'created_at', ascending: false })),
        list('feedback_meta', {}),
      ])
      const byId = new Map(metas.map((m) => [m.feedback_id, m]))
      setItems(fbs.map((fb) => ({ fb, meta: byId.get(fb.id) ?? null })))
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    useProfilesStore.getState().fetch()
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const activeView = FB_VIEWS.find((v) => v.id === view) ?? FB_VIEWS[0]
    // Archived items stay out of every view except All + Archived.
    let out = items.filter((i) => activeView.match(i) &&
      (view === 'all' || view === 'archived' || i.meta?.status !== 'archived'))
    if (needle) {
      out = out.filter((i) => [
        i.fb.title, i.fb.details, i.meta?.category, i.meta?.internal_notes, i.meta?.resolution_notes,
        i.meta?.related_feature, i.meta?.related_route, JSON.stringify(i.meta?.tags ?? ''),
        officerName(i.fb.created_by),
      ].some((s) => (s || '').toLowerCase().includes(needle)))
    }
    const prio = (i: FbItem) => ['critical', 'high', 'medium', 'low'].indexOf(i.meta?.priority ?? 'zz')
    out = [...out]
    if (sort === 'newest') out.sort((a, b) => b.fb.created_at.localeCompare(a.fb.created_at))
    else if (sort === 'oldest') out.sort((a, b) => a.fb.created_at.localeCompare(b.fb.created_at))
    else if (sort === 'priority') out.sort((a, b) => (prio(a) === -1 ? 9 : prio(a)) - (prio(b) === -1 ? 9 : prio(b)))
    else if (sort === 'status') out.sort((a, b) => (a.meta?.status ?? 'new').localeCompare(b.meta?.status ?? 'new'))
    else if (sort === 'updated') out.sort((a, b) => (b.meta?.updated_at ?? b.fb.updated_at).localeCompare(a.meta?.updated_at ?? a.fb.updated_at))
    return out
  }, [items, view, q, sort])

  return (
    <div className="space-y-4">
      <Panel title="Feedback & Bugs — owner inbox" sub="Submissions come in through the existing Feedback screen (unchanged). Cataloging lives in an owner-only side table (feedback_meta) so internal notes can never reach submitters; every triage action is audit-logged automatically.">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {FB_VIEWS.map((v) => {
            const n = items.filter((i) => v.match(i)).length
            return (
              <button key={v.id} onClick={() => setView(v.id)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${view === v.id ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}>
                {v.label} <span className="text-slate-500">{n}</span>
              </button>
            )
          })}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, notes, tags, submitter…" aria-label="Search feedback"
            className="w-64 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 text-xs text-white outline-none focus:border-badge-500" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort feedback"
            className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-white outline-none">
            <option value="newest">Newest</option><option value="oldest">Oldest</option>
            <option value="priority">Priority</option><option value="status">Status</option>
            <option value="updated">Recently updated</option>
          </select>
          <button onClick={() => void refresh()} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">↻</button>
        </div>

        {loading ? <p className="text-xs text-slate-500">Loading submissions…</p>
          : err ? <p className="text-xs text-rose-300">Could not load: {err}</p>
          : !shown.length ? <p className="rounded-xl border border-white/5 bg-ink-950/50 p-6 text-center text-xs text-slate-500">Nothing in this view.</p>
          : (
            <div className="space-y-2">
              {shown.map((i) => (
                <button key={i.fb.id} onClick={() => setDetail(i)} className="block w-full rounded-xl border border-white/10 bg-ink-950/50 p-3 text-left transition hover:border-blue-400/30">
                  <div className="flex flex-wrap items-center gap-2">
                    <span aria-hidden>{(i.meta?.type ?? i.fb.kind) === 'bug' ? '🐞' : '✨'}</span>
                    <p className="min-w-0 flex-1 truncate text-sm font-bold text-white">{i.fb.title}</p>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${FB_STATUS_TINT[i.meta?.status ?? 'new']}`}>{fbLabel(i.meta?.status ?? 'new')}</span>
                    {i.meta?.priority && <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${FB_PRIORITY_TINT[i.meta.priority]}`}>{fbLabel(i.meta.priority)}</span>}
                    {i.meta?.type && <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{fbLabel(i.meta.type)}</span>}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {officerName(i.fb.created_by) ?? 'Unknown member'} · {timeAgo(i.fb.created_at)}
                    {i.meta?.category && <> · {i.meta.category}</>}
                    {i.fb.details && <> — <span className="text-slate-400">{i.fb.details.slice(0, 90)}{i.fb.details.length > 90 ? '…' : ''}</span></>}
                  </p>
                </button>
              ))}
            </div>
          )}
      </Panel>

      {detail && (
        <FeedbackDetailModal
          item={detail}
          onClose={() => setDetail(null)}
          onSaved={() => { setDetail(null); void refresh() }}
        />
      )}
    </div>
  )
}

function FeedbackDetailModal({ item, onClose, onSaved }: { item: FbItem; onClose: () => void; onSaved: () => void }) {
  const m = item.meta
  const [status, setStatus] = useState(m?.status ?? 'new')
  const [type, setType] = useState(m?.type ?? (item.fb.kind === 'bug' ? 'bug' : 'feature_request'))
  const [priority, setPriority] = useState(m?.priority ?? '')
  const [category, setCategory] = useState(m?.category ?? '')
  const [tags, setTags] = useState(Array.isArray(m?.tags) ? (m.tags as string[]).join(', ') : '')
  const [feature, setFeature] = useState(m?.related_feature ?? '')
  const [route, setRoute] = useState(m?.related_route ?? '')
  const [notes, setNotes] = useState(m?.internal_notes ?? '')
  const [resolution, setResolution] = useState(m?.resolution_notes ?? '')
  const [publicStatus, setPublicStatus] = useState(item.fb.status)
  const [busy, setBusy] = useState(false)

  const dirty = () =>
    status !== (m?.status ?? 'new') || type !== (m?.type ?? '') || priority !== (m?.priority ?? '') ||
    category !== (m?.category ?? '') || notes !== (m?.internal_notes ?? '') || resolution !== (m?.resolution_notes ?? '') ||
    publicStatus !== item.fb.status

  const save = async () => {
    setBusy(true)
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean)
    const patch = {
      status, type: type || null, priority: priority || null, category: category.trim() || null,
      tags: tagList, internal_notes: notes.trim() || null, resolution_notes: resolution.trim() || null,
      related_feature: feature.trim() || null, related_route: route.trim() || null,
      resolved_at: status === 'resolved' ? (m?.resolved_at ?? new Date().toISOString()) : null,
      archived_at: status === 'archived' ? (m?.archived_at ?? new Date().toISOString()) : null,
    }
    const res = m
      ? await updateWhere('feedback_meta', { eq: { feedback_id: item.fb.id } }, patch)
      : await insert('feedback_meta', { feedback_id: item.fb.id, ...patch })
    if (res.error) { setBusy(false); toast(`Save failed: ${res.error.message}`, 'danger'); return }
    if (m && Array.isArray(res.data) && res.data.length === 0) {
      setBusy(false); toast('Save was blocked — are you still the owner?', 'warn'); return
    }
    if (publicStatus !== item.fb.status) {
      const pub = await update('feedback', item.fb.id, { status: publicStatus, updated_at: new Date().toISOString() })
      if (pub.error) { setBusy(false); toast(`Catalog saved, but the public status failed: ${pub.error.message}`, 'warn'); onSaved(); return }
    }
    setBusy(false)
    toast('Catalog saved', 'success')
    onSaved()
  }

  const inputCls = 'w-full rounded-lg border border-white/10 bg-ink-950 px-2.5 py-1.5 text-xs text-white outline-none focus:border-badge-500'
  const labelCls = 'mb-1 block text-[10px] font-bold uppercase tracking-wider text-slate-500'

  return (
    <Modal open onClose={onClose} dirty={dirty} wide>
      <ModalHeader title={item.fb.title} onClose={onClose} />
      <p className="-mt-2 mb-3 text-[11px] text-slate-500">
        {officerName(item.fb.created_by) ?? 'Unknown member'} · submitted {timeAgo(item.fb.created_at)} ·
        public kind: {item.fb.kind}
      </p>
      {item.fb.details && (
        <div className="mb-4 rounded-xl border border-white/10 bg-ink-950/60 p-3">
          <p className="whitespace-pre-wrap text-xs text-slate-300">{item.fb.details}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className={labelCls}>Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
            {FB_STATUSES.map((s) => <option key={s} value={s}>{fbLabel(s)}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            {FB_TYPES.map((t) => <option key={t} value={t}>{fbLabel(t)}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Priority</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
            <option value="">—</option>
            {FB_PRIORITIES.map((p) => <option key={p} value={p}>{fbLabel(p)}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Public status <span className="normal-case text-slate-600">(submitter sees)</span></label>
          <select value={publicStatus} onChange={(e) => setPublicStatus(e.target.value)} className={inputCls}>
            <option value="open">open</option><option value="done">done</option><option value="wontfix">wontfix</option>
          </select>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className={labelCls}>Category</label><input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. cases, uploads, search" className={inputCls} /></div>
        <div><label className={labelCls}>Tags (comma-separated)</label><input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="mobile, regression" className={inputCls} /></div>
        <div><label className={labelCls}>Related feature</label><input value={feature} onChange={(e) => setFeature(e.target.value)} placeholder="e.g. Case chat" className={inputCls} /></div>
        <div><label className={labelCls}>Related route</label><input value={route} onChange={(e) => setRoute(e.target.value)} placeholder="/cases" className={inputCls} /></div>
      </div>
      <div className="mt-3">
        <label className={labelCls}>Internal notes (owner-only — never visible to the submitter)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className={inputCls} />
      </div>
      <div className="mt-3">
        <label className={labelCls}>Resolution notes</label>
        <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} className={inputCls} />
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={() => void save()} disabled={busy} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-2.5 text-sm font-bold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
          {busy ? 'Saving…' : 'Save catalog'}
        </button>
      </div>
      <p className="mt-2 text-[10px] text-slate-600">
        Archive instead of delete — nothing here is destructive. Status changes to
        &ldquo;resolved&rdquo;/&ldquo;archived&rdquo; stamp their timestamps automatically; all writes are audit-logged.
      </p>
    </Modal>
  )
}

/* ---- suggestions ------------------------------------------------------------- */

function SuggestionsSection() {
  const [group, setGroup] = useState('')
  const groups = [...new Set(SUGGESTIONS.map((s) => s.group))]
  const shown = group ? SUGGESTIONS.filter((s) => s.group === group) : SUGGESTIONS
  return (
    <Panel title="Improvement roadmap" sub="From the July 2026 repository analysis (handbook Ch. 19). Recommendations only — nothing here changes code. 'Wait' = do after a prerequisite or at larger scale.">
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button onClick={() => setGroup('')} className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${!group ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}>All ({SUGGESTIONS.length})</button>
        {groups.map((g) => (
          <button key={g} onClick={() => setGroup(group === g ? '' : g)} className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold ${group === g ? 'border-badge-500/50 bg-badge-500/15 text-white' : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'}`}>{g}</button>
        ))}
      </div>
      <div className="space-y-2">
        {shown.map((s) => (
          <div key={s.title} className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-sm font-bold text-white">{s.title}</p>
              <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">{s.group}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${s.difficulty === 'S' ? 'bg-emerald-500/15 text-emerald-300' : s.difficulty === 'M' ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300'}`}>{s.difficulty === 'S' ? 'small' : s.difficulty === 'M' ? 'medium' : 'large'}</span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${s.safeNow ? 'bg-blue-500/15 text-blue-300' : 'bg-slate-500/20 text-slate-400'}`}>{s.safeNow ? 'safe now' : 'wait'}</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">{s.why}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Files: <span className="font-mono">{s.files}</span> · risk {s.risk} · benefit {s.benefit} · verify: {s.verify}
            </p>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ---- change impact / architecture / routes / env / realtime ------------------- */

function ImpactSection() {
  const router = useRouter()
  return (
    <div className="space-y-4">
      <Panel title="Change Impact Center" sub="Pick anything below — libraries, components, hooks, tables, RPCs, services, config — to see what it depends on, what depends on it, and what to check if you change it. Impact lists are curated from the repository analysis; treat them as informed inference, not proof.">
        <DepExplorer />
      </Panel>
      <Panel title="Before any change — the universal checklist">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-300">
          <li>Branch off main; never experiment on production.</li>
          <li>Check the item above + the handbook&rsquo;s <button onClick={() => router.push('/devdocs?page=change-impact')} className="text-blue-300 underline decoration-blue-300/40">Change Impact tables</button>.</li>
          <li>Schema changes: additive migration + database.types.ts in the same PR.</li>
          <li>Run the four gates; test the changed flow on the PR preview (two browsers for realtime).</li>
          <li>High-risk items (CSP, auth, sign-off, delete cascades) get a line-by-line self-review.</li>
        </ol>
      </Panel>
    </div>
  )
}

function ArchitectureSection() {
  const router = useRouter()
  const link = (page: string, label: string) => (
    <button onClick={() => router.push(`/devdocs?page=${page}`)} className="text-blue-300 underline decoration-blue-300/40 hover:text-blue-200">{label}</button>
  )
  return (
    <div className="space-y-4">
      <Panel title="The system at a glance">
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-ink-950 p-4 font-mono text-[11px] leading-relaxed text-slate-300">{`Browser (Next.js SPA, static)          Supabase (the backend)
  29 screens ── shell ── ui             Auth ─ profiles trigger
       │                                PostgREST ─ RLS ─ 47 tables
   lib/auth ─ lib/nav ─ lib/toast       15 RPCs ─ private.* helpers
       │                                Realtime publication
   lib/db ◄── domain libs               audit/touch/guard triggers
       │            │
   lib/supabase ─ lib/realtime (wss)    FiveManage (media URLs only)
                                        Discord (OAuth + DM edge fn)
   Vercel (hosting/previews/rollback) · GitHub Actions (4 gates + drift check)`}</pre>
        <p className="mt-2 text-xs text-slate-500">
          Flows in depth: {link('architecture', 'Architecture Blocks')} (nine blocks, risk levels, common mistakes) ·{' '}
          {link('auth', 'Auth flow')} · {link('api', 'API flow')} · {link('database', 'Database')} ·{' '}
          {link('state', 'State & realtime flow')} · {link('dependency-map', 'Dependency Map')}.
        </p>
      </Panel>
      <Panel title="The nine blocks, one line each" sub="Full detail with common mistakes lives in the handbook chapter.">
        <ul className="space-y-1 text-xs text-slate-300">
          <li><b className="text-white">Config & build</b> — CSP + deploy machinery (HIGH risk: exact allow-lists).</li>
          <li><b className="text-white">Routing & shell</b> — one [tab] route + chrome (nav three-way contract).</li>
          <li><b className="text-white">Auth & identity</b> — state machine + capability booleans (~40 consumers).</li>
          <li><b className="text-white">Data access</b> — db.ts, the only path to Postgres (throw-vs-return contract).</li>
          <li><b className="text-white">Realtime</b> — one channel per table → version counters.</li>
          <li><b className="text-white">Feature views</b> — 29 screens, one uniform skeleton.</li>
          <li><b className="text-white">Domain libs</b> — sign-off vocabulary, forms, penal, exports, search, notify.</li>
          <li><b className="text-white">UI primitives</b> — Modal/dialog/DataTable/editor + safeUrl/markdown (XSS surfaces).</li>
          <li><b className="text-white">The database</b> — where every rule that matters lives (HIGHEST risk).</li>
        </ul>
      </Panel>
    </div>
  )
}

function RoutesSection() {
  return (
    <Panel title="Route explorer" sub="Every screen, its component, access rule and edit risk. Access is enforced by RLS + view gates, not by the router — all routes serve the same static shell.">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <th className="px-2 py-2">Path</th><th className="px-2 py-2">Component</th><th className="px-2 py-2">Access</th><th className="px-2 py-2">Data</th><th className="px-2 py-2">Risk</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {ROUTES.map((r) => (
              <tr key={r.path}>
                <td className="px-2 py-2 font-mono text-blue-300">{r.path}</td>
                <td className="px-2 py-2 text-slate-300">{r.component}</td>
                <td className="px-2 py-2 text-slate-400">{r.access}</td>
                <td className="px-2 py-2 text-slate-400">{r.data}</td>
                <td className="px-2 py-2"><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${r.risk === 'high' ? 'bg-rose-500/15 text-rose-300' : r.risk === 'medium' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}>{r.risk}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function EnvSection() {
  const configured: Record<string, boolean> = {
    NEXT_PUBLIC_SUPABASE_URL: isConfigured,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: isConfigured,
    NEXT_PUBLIC_FIVEMANAGE_API_KEY: fmConfigured(),
    NEXT_PUBLIC_FIVEMANAGE_BASE_URL: fmConfigured(),
  }
  return (
    <Panel title="Environment overview" sub="Names and purpose only — values are never displayed (they are public client keys, but the habit matters). Changing any of these requires a REBUILD, and vercel.json + ci.yml carry duplicate copies that must agree.">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/10 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
              <th className="px-2 py-2">Variable</th><th className="px-2 py-2">Purpose</th><th className="px-2 py-2">Required</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">Used in</th><th className="px-2 py-2">If missing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {ENV_VARS.map((e) => (
              <tr key={e.name}>
                <td className="px-2 py-2 font-mono text-blue-300">{e.name}</td>
                <td className="px-2 py-2 text-slate-300">{e.purpose}</td>
                <td className="px-2 py-2 text-slate-400">{e.required ? 'required' : 'optional'}</td>
                <td className="px-2 py-2">{configured[e.name] ? <span className="text-emerald-300">✓ configured</span> : <span className={e.required ? 'text-rose-300' : 'text-amber-300'}>✗ missing</span>}</td>
                <td className="px-2 py-2 font-mono text-slate-400">{e.usedIn}</td>
                <td className="px-2 py-2 text-slate-400">{e.ifMissing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function RealtimeSection() {
  const versions = useRealtimeStore((s) => s.versions)
  const entries = Object.entries(versions).sort((a, b) => b[1] - a[1])
  return (
    <div className="space-y-4">
      <Panel title="How realtime works here">
        <p className="text-xs text-slate-300">{REALTIME_DOC.how}</p>
        <p className="mt-2 text-xs text-slate-400"><b className="text-slate-300">Not published</b> (refresh on remount only, by design): {REALTIME_DOC.notPublished.join(' · ')}</p>
        <p className="mt-2 text-xs text-slate-400"><b className="text-slate-300">Security:</b> {REALTIME_DOC.security}</p>
      </Panel>
      <Panel title="This session's channel activity" sub="Version counters = events received since you signed in. A quiet table is not a failure — it just hasn't changed.">
        {entries.length ? (
          <div className="flex flex-wrap gap-1.5">
            {entries.map(([t, v]) => (
              <span key={t} className="rounded-lg border border-white/10 bg-ink-950/50 px-2 py-1 font-mono text-[11px] text-slate-300">
                {t} <b className="text-emerald-300">{v}</b>
              </span>
            ))}
          </div>
        ) : <p className="text-xs text-slate-500">No events yet this session.</p>}
      </Panel>
      <Panel title="Common failure points">
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-300">
          {REALTIME_DOC.failures.map((f) => <li key={f}>{f}</li>)}
        </ul>
      </Panel>
    </div>
  )
}

function WorkflowSection() {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
        <p className="text-sm font-bold text-amber-200">⚠ All code changes go through a branch + PR preview first.</p>
        <p className="mt-1 text-xs text-amber-200/80">Production tracks main. A broken merge deploys immediately — the preview deployment IS the safe development version. {WORKFLOW.notVerified}</p>
      </div>
      <Panel title="Branching & gates"><p className="text-xs text-slate-300">{WORKFLOW.branch}</p><p className="mt-2 font-mono text-[11px] text-slate-400">{WORKFLOW.gates}</p></Panel>
      <Panel title="Database changes"><p className="text-xs text-slate-300">{WORKFLOW.db}</p></Panel>
      <Panel title="Deploy & verify"><p className="text-xs text-slate-300">{WORKFLOW.deploy}</p></Panel>
      <Panel title="Rollback & emergencies"><p className="text-xs text-slate-300">{WORKFLOW.rollback}</p><p className="mt-2 text-xs text-slate-300">{WORKFLOW.emergency}</p></Panel>
      <Panel title="Permissions matrix" sub={MATRIX_NOTE}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <th className="px-2 py-2">Area</th><th className="px-2 py-2">Owner</th><th className="px-2 py-2">Command</th><th className="px-2 py-2">Member</th><th className="px-2 py-2">Inactive/Guest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {PERMISSIONS_MATRIX.map((r) => (
                <tr key={r.area}>
                  <td className="px-2 py-2 text-slate-300">{r.area}</td>
                  <td className="px-2 py-2 text-slate-400">{r.owner}</td>
                  <td className="px-2 py-2 text-slate-400">{r.command}</td>
                  <td className="px-2 py-2 text-slate-400">{r.member}</td>
                  <td className="px-2 py-2 text-slate-400">{r.inactive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}

function LearnPath({ title, items }: { title: string; items: { step: string; where: string; why: string }[] }) {
  return (
    <Panel title={title}>
      <ol className="list-decimal space-y-2 pl-5 text-xs text-slate-300">
        {items.map((i) => (
          <li key={i.step}><b className="text-white">{i.step}</b> — <span className="font-mono text-blue-300">{i.where}</span><br /><span className="text-slate-500">{i.why}</span></li>
        ))}
      </ol>
    </Panel>
  )
}

function LearningSection() {
  const router = useRouter()
  return (
    <div className="space-y-4">
      <LearnPath title="Beginner path" items={LEARNING.beginner} />
      <LearnPath title="Intermediate path" items={LEARNING.intermediate} />
      <LearnPath title="Advanced path" items={LEARNING.advanced} />
      <Panel title="Avoid changing early">
        <div className="flex flex-wrap gap-1.5">
          {LEARNING.avoidEarly.map((f) => <span key={f} className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-2 py-1 font-mono text-[11px] text-rose-300">{f}</span>)}
        </div>
      </Panel>
      <Panel title="Common mistakes (all real)">
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-300">
          {LEARNING.mistakes.map((mk) => <li key={mk}>{mk}</li>)}
        </ul>
      </Panel>
      <p className="text-xs text-slate-500">
        The full checklist with milestones lives in the handbook&rsquo;s{' '}
        <button onClick={() => router.push('/devdocs?page=learning-path')} className="text-blue-300 underline decoration-blue-300/40">Learning Path</button>,
        with the <button onClick={() => router.push('/devdocs?page=glossary')} className="text-blue-300 underline decoration-blue-300/40">Glossary</button> and{' '}
        <button onClick={() => router.push('/devdocs?page=faq')} className="text-blue-300 underline decoration-blue-300/40">FAQ</button> beside it.
      </p>
    </div>
  )
}
