'use client'

/** Owner Console — the project owner's control center, consolidated
 *  (Phase 2C) into five areas: the Owner Dashboard (warnings, queues, recent
 *  administrative changes), Portal Management (global controls + runbook),
 *  Roles & Access (oversight + the owner-only grant RPCs), the Safety
 *  surfaces (Permanent Deletion, Security & Audit, System Health) and one
 *  Handbook & Reference section. The static documentation walls that used to
 *  live here moved to the Developer Handbook (/devdocs) — this console is for
 *  deciding and doing.
 *
 *  Access: useAuth().isOwner (profiles.is_owner) gates the UI; RLS
 *  (private.is_owner()) is the real wall on feedback/feedback_meta/audit/
 *  deleted_member_ledger, and every dangerous action here is an owner-only,
 *  self-auditing SECURITY DEFINER RPC — the console never writes its own
 *  audit rows. NOT a CID operational screen — division data appears only as
 *  high-level counts and health signals. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { countRows, insert, list, remove, rpc, update, updateWhere, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { isConfigured } from '@/lib/supabase'
import { fmConfigured } from '@/lib/fivemanage'
import { useRealtimeStore, useTableVersion } from '@/lib/realtime'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { timeAgo } from '@/lib/format'
import { toast } from '@/lib/toast'
import { parseSecurityOverview, type SecurityOverview } from '@/lib/schemas'
import { parseStringArray } from '@/lib/jsonShapes'
import { AGENCY_LABEL, justiceRoleLabel, type JusticeAgency } from '@/lib/justice'
import { PERMANENT_BUREAUS, bureauLabel, roleLabel } from '@/lib/roles'
import { uiConfirm } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/PageHeader'
import { Notice, EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { Badge } from '@/components/ui/Badge'
import { inputCls, labelCls } from '@/components/ui/Field'
import { ArchiveIcon, SearchIcon } from '@/components/shell/icons'
import { DashPanel } from '@/components/dash/DashPanel'
import { DashRow } from '@/components/dash/DashRow'
import { DepExplorer } from '@/components/devdocs/DevDocsView'
import {
  ENV_VARS, FB_PRIORITIES, FB_PRIORITY_TINT, FB_STATUSES, FB_STATUS_TINT, FB_TYPES,
  MANUAL_ACTIONS, RECOVERY_NOTES, fbLabel,
} from './ownerData'
import { ADMIN_AUDIT_ACTIONS, adminActionLabel, ledgerReferenceCount, ownerQueue } from './ownerQueue'
import { SecurityTestingSection } from './SecurityTestingSection'
import { PermanentDeletionSection } from './PermanentDeletionSection'

type FeedbackRow = Tables<'feedback'>
type MetaRow = Tables<'feedback_meta'>
interface FbItem { fb: FeedbackRow; meta: MetaRow | null }

const SECTIONS: { id: string; label: string; sub: string }[] = [
  { id: 'home', label: 'Owner Dashboard', sub: 'Warnings, the pending queue & recent administrative changes' },
  { id: 'manage', label: 'Portal Management', sub: 'SIB release gate, reference data, feature status & the runbook' },
  { id: 'access', label: 'Roles & Access', sub: 'Membership oversight, justice grants & test-fixture flagging' },
  { id: 'feedback', label: 'Feedback & Bugs', sub: 'The owner inbox — triage, catalog, resolve' },
  { id: 'deletion', label: 'Permanent Deletion', sub: 'Irreversible member erasure + the deletion ledger' },
  { id: 'security', label: 'Security & Audit', sub: 'Live RLS suite results, client errors & the audit log' },
  { id: 'system', label: 'System Health', sub: 'DB round-trip, environment, realtime & live table counts' },
  { id: 'reference', label: 'Handbook & Reference', sub: 'Deep links into the Developer Handbook + the dependency explorer' },
]

/** Desktop rail grouping — same section ids + deep-links, grouped by purpose. */
const NAV_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'Overview', ids: ['home'] },
  { label: 'Operations', ids: ['manage', 'access', 'feedback'] },
  { label: 'Safety', ids: ['deletion', 'security', 'system'] },
  { label: 'Reference', ids: ['reference'] },
]

/** ?s= compatibility — every retired section id maps to its successor, so old
 *  deep links keep resolving. Unknown values fall through to home. The ids
 *  'feedback', 'security' and 'deletion' survived the reorganization. */
const LEGACY_SECTION: Record<string, string> = {
  health: 'system', ops: 'manage', realtime: 'system', env: 'system',
  suggestions: 'reference', impact: 'reference', architecture: 'reference',
  routes: 'reference', workflow: 'reference', learning: 'reference',
}

export function OwnerView() {
  const { state, isOwner } = useAuth()
  const router = useRouter()
  const sp = useSearchParams()
  const rawSection = sp.get('s') ?? 'home'
  const section = SECTIONS.some((s) => s.id === rawSection) ? rawSection : LEGACY_SECTION[rawSection] ?? 'home'
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
    for (const e of ENV_VARS) if (e.name.toLowerCase().includes(q)) out.push({ type: 'Env', label: e.name, sub: e.purpose, go: () => go('system') })
    for (const h of handbookTitles) if (h.title.toLowerCase().includes(q)) out.push({ type: 'Handbook', label: h.title, sub: 'Developer Handbook', go: () => router.push(`/devdocs?page=${h.slug}`) })
    return out.slice(0, 12)
  }, [query, handbookTitles, go, router])

  if (state !== 'in') return <Notice text="Sign in to view the Owner Console." />
  if (!isOwner) {
    return (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-200">
        Restricted — the Owner Console is owner-only. If you believe you should have access,
        ownership is granted on the database profile, not in the app.
      </div>
    )
  }

  const active = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]

  return (
    <div className="mx-auto max-w-7xl">
      {/* One real h1 per view: home renders its hero heading; every other
          section carries a visually-hidden one so the outline stays honest. */}
      {active.id !== 'home' && <h1 className="sr-only">Owner Console — {active.label}</h1>}

      {/* breadcrumbs + global console search */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-slate-400">
          <button onClick={() => go('home')} className="font-bold text-slate-300 hover:text-white">Owner Console</button>
          {active.id !== 'home' && <><span aria-hidden className="text-slate-600">/</span><span className="font-semibold text-white">{active.label}</span></>}
        </nav>
        <div className="relative w-full sm:w-80">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 focus-within:border-badge-500">
            <SearchIcon className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
            <input
              type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sections, env, handbook…"
              aria-label="Search the Owner Console"
              className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            />
          </div>
          {results.length > 0 && (
            <div className="absolute right-0 top-full z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-white/10 bg-ink-900 p-1 shadow-2xl">
              {results.map((r, i) => (
                <button key={i} onClick={() => { setQuery(''); r.go() }} className="block w-full rounded-lg px-3 py-2 text-left transition hover:bg-white/5">
                  <p className="text-sm font-bold text-white">
                    <span className="mr-1.5 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-400">{r.type}</span>
                    {r.label}
                  </p>
                  <p className="truncate text-xs text-slate-400">{r.sub}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-6">
        <aside className="sticky-below-header hidden w-52 flex-shrink-0 self-start lg:block" aria-label="Owner Console navigation">
          <nav className="space-y-4">
            {NAV_GROUPS.map((g) => (
              <div key={g.label} className="space-y-0.5">
                <p className="px-3 pb-0.5 text-xs font-bold uppercase tracking-wider text-slate-400">{g.label}</p>
                {g.ids.map((id) => {
                  const s = SECTIONS.find((x) => x.id === id)
                  if (!s) return null
                  const activeItem = s.id === active.id
                  return (
                    <button
                      key={s.id} onClick={() => go(s.id)}
                      aria-current={activeItem ? 'page' : undefined}
                      className={`block w-full rounded-lg border-l-2 py-1.5 pl-2.5 pr-3 text-left text-xs transition ${activeItem ? 'border-badge-500 bg-badge-500/15 font-bold text-white' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-white'}`}
                    >
                      {s.label}
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1">
          {/* mobile section picker */}
          <div className="mb-4 lg:hidden">
            <select
              value={active.id} onChange={(e) => go(e.target.value)} aria-label="Owner Console section"
              className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm font-bold text-white outline-none"
            >
              {SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>

          {active.id === 'home' && <DashboardSection onGo={go} />}
          {active.id === 'manage' && <ManageSection onGo={go} />}
          {active.id === 'access' && <AccessSection />}
          {active.id === 'feedback' && <FeedbackInbox />}
          {active.id === 'deletion' && <DeletionSection />}
          {active.id === 'security' && <SecurityAuditSection />}
          {active.id === 'system' && <SystemSection />}
          {active.id === 'reference' && <ReferenceSection />}
        </div>
      </div>
    </div>
  )
}

function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <Card pad="md">
      <SectionHeader title={title} subtitle={sub} />
      <div className="mt-3">{children}</div>
    </Card>
  )
}

/* ---- owner dashboard ------------------------------------------------------ */

interface DashState {
  /** null on any field = that fetch failed / not authorized — shown honestly. */
  errCount: number | null
  errRows: Tables<'client_errors'>[]
  sec: SecurityOverview | null
  openFeedback: number | null
  admin: Tables<'audit_log'>[] | null
  at: number
}

function DashboardSection({ onGo }: { onGo: (s: string) => void }) {
  const router = useRouter()
  const [d, setD] = useState<DashState | null>(null)
  const [loading, setLoading] = useState(true)
  const errV = useTableVersion('client_errors')

  const refresh = useCallback(async () => {
    setLoading(true)
    // Each signal fails independently to null — an unreadable signal renders
    // as unknown, never as a false all-clear. All reads are bounded.
    const [errCount, errRows, secRaw, fbs, metas, admin] = await Promise.all([
      countRows('client_errors').catch(() => null),
      list('client_errors', { order: 'created_at', ascending: false, limit: 5 }).catch(() => []),
      rpc('owner_security_overview', {} as never).then((r) => (r.error ? null : r.data)).catch(() => null),
      list('feedback', { select: 'id' }).catch(() => null),
      list('feedback_meta', { select: 'feedback_id,status' }).catch(() => null),
      list('audit_log', {
        in: { action: [...ADMIN_AUDIT_ACTIONS] }, order: 'created_at', ascending: false, limit: 10,
      }).catch(() => null),
    ])
    let openFeedback: number | null = null
    if (fbs !== null && metas !== null) {
      const closed = new Set(['resolved', 'archived', 'rejected', 'duplicate'])
      const statusById = new Map(metas.map((m) => [m.feedback_id, m.status]))
      openFeedback = fbs.filter((f) => !closed.has(statusById.get(f.id) ?? 'new')).length
    }
    setD({
      errCount, errRows,
      sec: secRaw === null ? null : parseSecurityOverview(secRaw),
      openFeedback, admin, at: Date.now(),
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, errV])

  // Latest run per suite → failing assertions right now; fixture drift count.
  const latestBySuite = new Map<string, SecurityOverview['runs'][number]>()
  for (const r of d?.sec?.runs ?? []) if (!latestBySuite.has(r.suite)) latestBySuite.set(r.suite, r)
  const securityFailures = d?.sec ? [...latestBySuite.values()].reduce((n, r) => n + r.failed, 0) : null
  const fixtureIssues = d?.sec ? d.sec.fixtures.filter((f) => !f.present || f.issues.length > 0).length : null
  const queue = ownerQueue({
    clientErrors: d?.errCount ?? null,
    securityFailures,
    fixtureIssues,
    openFeedback: d?.openFeedback ?? null,
  })

  return (
    <div className="space-y-4">
      <Card pad="lg">
        <p className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">
          <span className="t-dot t-dot-cyan" /> Owner &amp; developer operations
        </p>
        <h1 className="text-xl font-semibold text-white">Owner Console</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          The owner-only control center: what needs you now, the portal&rsquo;s global controls,
          role &amp; access oversight, and the safety surfaces. Learning and reference live in the{' '}
          <button onClick={() => router.push('/devdocs')} className="text-blue-300 underline decoration-blue-300/40 hover:text-blue-200">Developer Handbook</button> —
          this console is for deciding and doing.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <p className="text-xs text-slate-400">
            {d ? <>Signals checked {timeAgo(new Date(d.at).toISOString())}.</> : 'Checking signals…'}
          </p>
          <Button size="sm" disabled={loading} onClick={() => void refresh()}>{loading ? 'Checking…' : '↻ Re-check'}</Button>
        </div>
      </Card>

      <DashPanel
        title="Pending owner actions"
        count={queue.length}
        hint="Derived from the real signals only: client errors, RLS-suite failures, fixture drift and open feedback."
      >
        {queue.length === 0 ? (
          <p className="px-2.5 py-2 text-sm text-emerald-300">✓ Nothing pending — every checked signal is clear.</p>
        ) : queue.map((i) => (
          <DashRow
            key={i.id} title={i.label} why={i.why} onClick={() => onGo(i.section)}
            badge={<Badge tone={i.id === 'open_feedback' ? 'accent' : 'danger'}>{i.count}</Badge>}
          />
        ))}
      </DashPanel>

      <DashPanel
        title="Critical warnings"
        count={d?.errCount ?? undefined}
        hint="Uncaught client exceptions (latest 5) — the full panel with stacks lives in Security & Audit."
        action={{ label: 'All →', onClick: () => onGo('security') }}
        empty={!loading && (d?.errCount ?? 0) === 0}
      >
        {d?.errRows.map((r) => (
          <DashRow
            key={r.id}
            title={r.message.slice(0, 100)}
            why={`${r.route || 'unknown route'} · ${officerName(r.reporter_id) || 'unknown reporter'}`}
            meta={timeAgo(r.created_at)}
            overdue
            onClick={() => onGo('security')}
          />
        ))}
      </DashPanel>

      <DashPanel
        title="Security suite"
        hint="Latest reported run per suite + fixture health. Full results, failures and the access matrix live in Security & Audit."
        action={{ label: 'Detail →', onClick: () => onGo('security') }}
      >
        {d?.sec === null && !loading && (
          <p className="px-2.5 py-2 text-sm text-slate-400">The security overview could not be read — open Security &amp; Audit to retry.</p>
        )}
        {latestBySuite.size === 0 && d?.sec && (
          <p className="px-2.5 py-2 text-sm text-slate-400">No reported runs yet — run <code className="text-blue-300">npm run test:rls</code> or let CI report.</p>
        )}
        {[...latestBySuite.values()].map((r) => (
          <DashRow
            key={r.id}
            title={r.suite}
            why={`${r.passed} passed · ${r.failed} failed · ${r.skipped} skipped (${r.source === 'ci' ? 'CI' : 'local'})`}
            meta={timeAgo(r.created_at)}
            badge={<Badge tone={r.failed > 0 ? 'danger' : 'good'}>{r.failed > 0 ? `${r.failed} failed` : 'passing'}</Badge>}
            overdue={r.failed > 0}
            onClick={() => onGo('security')}
          />
        ))}
        {d?.sec && (
          <DashRow
            title="Fixture health"
            why={fixtureIssues ? 'rls-test fixtures missing or drifted — detail in Security & Audit' : 'all rls-test fixtures match their expected identity'}
            badge={<Badge tone={fixtureIssues ? 'warn' : 'good'}>{fixtureIssues ? `${fixtureIssues} issue${fixtureIssues === 1 ? '' : 's'}` : 'healthy'}</Badge>}
            onClick={() => onGo('security')}
          />
        )}
      </DashPanel>

      <DashPanel
        title="Recent administrative changes"
        count={d?.admin?.length ?? undefined}
        hint="Latest curated admin actions from the audit log (role, membership, justice, deletion & owner controls)."
        action={{ label: 'Audit log →', onClick: () => router.push('/audit') }}
      >
        {d?.admin === null && !loading && (
          <p className="px-2.5 py-2 text-sm text-slate-400">The audit log could not be read — retry, or open it directly.</p>
        )}
        {d?.admin?.length === 0 && (
          <p className="px-2.5 py-2 text-sm text-slate-400">No recent administrative changes.</p>
        )}
        {d?.admin?.map((r) => (
          <DashRow
            key={r.id}
            title={adminActionLabel(r.action)}
            why={`${r.entity}${r.actor_id ? ` · by ${officerName(r.actor_id) || 'unknown'}` : ''}`}
            meta={timeAgo(r.created_at)}
            onClick={() => router.push('/audit')}
          />
        ))}
      </DashPanel>

      {/* Ordinary bureau workload stays in the Command Center — one link row,
          not KPI cards, per the consolidation spec. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/5 bg-ink-900/40 px-3 py-1.5 text-xs">
        <span className="font-bold uppercase tracking-wider text-slate-400">Command queues</span>
        <button onClick={() => router.push('/command-center?s=approvals')} className="rounded px-1.5 py-2 font-semibold text-blue-300 transition hover:text-white">Approvals →</button>
        <button onClick={() => router.push('/command-center?s=promotions')} className="rounded px-1.5 py-2 font-semibold text-blue-300 transition hover:text-white">Promotions &amp; transfers →</button>
        <button onClick={() => router.push('/cases?archived=1')} className="rounded px-1.5 py-2 font-semibold text-blue-300 transition hover:text-white">Archived cases →</button>
      </div>
    </div>
  )
}

/* ---- portal management ---------------------------------------------------- */

function ManageSection({ onGo }: { onGo: (s: string) => void }) {
  const router = useRouter()
  const versions = useRealtimeStore((s) => s.versions)
  const liveTables = Object.keys(versions).length
  const branch = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ?? null
  const vercelEnv = process.env.NEXT_PUBLIC_VERCEL_ENV ?? null
  const openActions = MANUAL_ACTIONS.filter((a) => !a.done)

  return (
    <div className="space-y-4">
      <SibReleasePanel />

      <Panel title="Reference data & communications" sub="The owner-relevant global surfaces — content lives on its own screen; this is the door.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LinkCard title="Announcements" sub="Division-wide notices — posting is a command power your account holds." onClick={() => router.push('/announce')} />
          <LinkCard title="Penal Code" sub="Statutes, sentences & fines — the administration tools live on the screen itself." onClick={() => router.push('/penal')} />
          <LinkCard title="SOP Library" sub="Policy & reference documents, including the owner-classified SOPs." onClick={() => router.push('/sops')} />
        </div>
      </Panel>

      <Panel title="Feature & environment status" sub="Condensed readouts — the full environment table and live counts are in System Health.">
        <ul className="space-y-1.5 text-sm">
          <SafetyLine ok={isConfigured} text="Supabase configured" bad="Missing NEXT_PUBLIC_SUPABASE_* — the app cannot function" />
          <SafetyLine ok={fmConfigured()} text="FiveManage configured (optional)" bad="Uploads disabled — Attachments/Media fall back to paste-a-URL" warnOnly />
          <li className={liveTables > 0 ? 'text-emerald-300' : 'text-slate-400'}>
            {liveTables > 0 ? `✓ Realtime live — events from ${liveTables} tables this session` : '— No realtime events yet this session (signal, not a failure)'}
          </li>
          <li className="text-slate-300">
            Deploy: <b className="text-white">{vercelEnv ?? (process.env.NODE_ENV === 'production' ? 'production build' : 'development')}</b>
            {branch && <span className="text-slate-400"> · {branch}</span>}
          </li>
        </ul>
        <button onClick={() => onGo('system')} className="mt-3 rounded px-1.5 py-2 text-xs font-semibold text-blue-300 transition hover:text-white">Full detail → System Health</button>
      </Panel>

      <Panel title="Runbook — manual actions" sub="Work only a person with dashboard access can do — the app cannot verify these, so this checklist is maintained by hand (update ownerData.ts when an item is completed).">
        {openActions.length === 0 && <p className="text-sm text-emerald-300">✓ Nothing outstanding.</p>}
        <div className="space-y-2">
          {MANUAL_ACTIONS.map((a) => (
            <div key={a.title} className={`rounded-lg p-3 ${a.done ? 'bg-ink-950/40' : 'bg-amber-500/5'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 text-sm font-bold text-white">{a.title}</p>
                {a.done
                  ? <Badge tone="good">Done {a.done}</Badge>
                  : <Badge tone={a.status === 'not_configured' ? 'neutral' : a.status === 'recurring' ? 'warn' : 'danger'}>
                      {a.status === 'not_configured' ? 'Not configured' : a.status === 'recurring' ? 'Recurring' : 'Action required'}
                    </Badge>}
              </div>
              <p className="mt-1 text-sm text-slate-400">{a.detail}</p>
              <p className="mt-1 text-xs text-slate-400">Where: {a.where}</p>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1.5 border-t border-white/5 pt-3 text-sm text-slate-300">
          <p><Badge tone="neutral">Unknown</Badge> <span className="ml-1">{RECOVERY_NOTES.backups}</span></p>
          <p><Badge tone="danger">Action</Badge> <span className="ml-1">{RECOVERY_NOTES.restore}</span></p>
        </div>
      </Panel>
    </div>
  )
}

/** The SIB release gate — first UI for public.siu_set_release(). While the
 *  gate is CLOSED, siu_settings.enabled_for_non_owner is false and SIU
 *  resolves to the owner alone; flipping it turns on the production
 *  permission model that is already written (lib/siu.ts). Owner-only,
 *  reason-required, audited server-side as SIU_RELEASE_SET — no client audit
 *  writes here. */
function SibReleasePanel() {
  // undefined = loading; null = the bounded read failed (state unknown).
  const [row, setRow] = useState<Tables<'siu_settings'> | null | undefined>(undefined)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try { setRow((await list('siu_settings', { limit: 1 }))[0] ?? null) }
    catch { setRow(null) }
  }, [])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const enabled = row?.enabled_for_non_owner ?? null
  const flip = async () => {
    const r = reason.trim()
    if (!r) { toast('A reason is required — the RPC refuses without one.', 'warn'); return }
    const next = !(enabled ?? false)
    const ok = await uiConfirm(
      next
        ? 'siu_settings.enabled_for_non_owner flips to TRUE.\n\nAppointed SIB members (and the Attorney General’s ex-officio oversight) go LIVE for non-owner accounts — the production permission model that is already written turns on. Nothing is rebuilt and nothing else changes.\n\nThe flip is audited server-side (SIU_RELEASE_SET) with your reason. Other signed-in sessions pick it up on their next context load.'
        : 'siu_settings.enabled_for_non_owner flips to FALSE.\n\nSIB returns to the owner-only build phase: every non-owner account loses SIB standing and SIB tables return zero rows to them. Appointments are kept, just dormant.\n\nThe flip is audited server-side (SIU_RELEASE_SET) with your reason. Other signed-in sessions pick it up on their next context load.',
      { title: next ? 'Open the SIB release gate?' : 'Close the SIB release gate?', confirmText: next ? 'Open the gate' : 'Close the gate' },
    )
    if (!ok) return
    setBusy(true)
    const res = await rpc('siu_set_release', { p_enabled: next, p_reason: r })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(next ? 'SIB release gate opened' : 'SIB release gate closed', 'success')
    setReason('')
    void refresh()
  }

  return (
    <Panel title="SIB release gate" sub="One flag controls whether the Special Investigations Bureau exists for anyone but you. Owner-only, reason-required, audited (SIU_RELEASE_SET).">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-300">Current state:</span>
        {row === undefined
          ? <Badge tone="neutral">checking…</Badge>
          : enabled === null
            ? <Badge tone="warn">unknown — siu_settings unreadable</Badge>
            : enabled
              ? <Badge tone="good">OPEN — released to appointed members</Badge>
              : <Badge tone="neutral">CLOSED — owner-only build phase</Badge>}
        {row?.updated_at && <span className="text-xs text-slate-400">last changed {timeAgo(row.updated_at)}</span>}
      </div>
      <div className="mt-3 max-w-xl">
        <label htmlFor="sib-release-reason" className={labelCls}>Reason (required — recorded in the audit log)</label>
        <input
          id="sib-release-reason" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={enabled ? 'Why the gate is closing…' : 'Why SIB is being released…'}
          className={inputCls}
        />
      </div>
      <Button
        variant="danger" className="mt-3" disabled={busy || row === undefined || enabled === null}
        onClick={() => void flip()}
      >
        {busy ? 'Applying…' : enabled ? 'Close the release gate' : 'Open the release gate'}
      </Button>
      <p className="mt-2 text-xs text-slate-400">
        Exactly what flips: <code className="text-blue-300">siu_settings.enabled_for_non_owner</code>.
        The rules themselves (lib/siu.ts + private.siu_standing()) are already in place on both sides of the gate.
      </p>
    </Panel>
  )
}

function LinkCard({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-lg border border-white/10 bg-ink-950/50 p-4 text-left transition hover:border-blue-400/30 hover:bg-white/[0.03]">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{sub}</p>
    </button>
  )
}

/* ---- roles & access ------------------------------------------------------- */

interface AccessState {
  activeMembers: number | null
  pendingCid: number | null
  legacyTransfers: number | null
  /** Active prosecutor assignment per bureau (null = the fetch failed). */
  coverage: { bureau: string; primaryId: string | null; actingId: string | null }[] | null
  at: number
}

function AccessSection() {
  const router = useRouter()
  const [a, setA] = useState<AccessState | null>(null)
  const [loading, setLoading] = useState(true)
  // Subscribe to the roster so prosecutor names resolve as soon as it loads —
  // and so an UNRESOLVABLE assignee (test fixtures are hidden from profile
  // reads by RLS) can be surfaced as a warning instead of a blank.
  const roster = useProfilesStore((s) => s.profiles)

  const refresh = useCallback(async () => {
    setLoading(true)
    void useProfilesStore.getState().fetch()
    const [activeMembers, pendingCid, legacy, pba] = await Promise.all([
      countRows('profiles', { eq: { active: true } }).catch(() => null),
      countRows('membership_requests', { eq: { status: 'pending' } }).catch(() => null),
      list('transfer_requests', { in: { status: ['pending_source', 'pending_target', 'approved'] }, select: 'id' }).catch(() => null),
      list('prosecutor_bureau_assignments', { is: { ends_at: null } }).catch(() => null),
    ])
    const coverage = pba === null ? null : PERMANENT_BUREAUS.map((b) => ({
      bureau: b,
      primaryId: pba.find((r) => r.bureau === b && r.assignment_type === 'primary')?.prosecutor_id ?? null,
      actingId: pba.find((r) => r.bureau === b && r.assignment_type === 'acting')?.prosecutor_id ?? null,
    }))
    setA({
      activeMembers, pendingCid,
      legacyTransfers: legacy === null ? null : legacy.length,
      coverage, at: Date.now(),
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  return (
    <div className="space-y-4">
      <Panel title="Membership oversight" sub="High-level counts only — day-to-day personnel administration lives in the Command Center, and that stays true for the owner.">
        <div className="flex justify-end">
          <Button size="sm" disabled={loading} onClick={() => void refresh()}>{loading ? 'Checking…' : '↻ Re-check'}</Button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <LinkCard
            title={`${a?.activeMembers ?? '—'} active members`}
            sub="The roster — approve, manage, promote, transfer, remove (Command Center → Personnel)."
            onClick={() => router.push('/command-center?s=personnel')}
          />
          <LinkCard
            title={`${a?.pendingCid ?? '—'} pending applications`}
            sub="Membership requests awaiting review (Command Center → Approvals)."
            onClick={() => router.push('/command-center?s=approvals')}
          />
          <LinkCard
            title={`${a?.legacyTransfers ?? '—'} legacy open transfers`}
            sub="Transfers now apply instantly — old two-sided rows need approving or cancelling (→ Promotions)."
            onClick={() => router.push('/command-center?s=promotions')}
          />
          <LinkCard
            title="Field officer roster"
            sub="SAHP / BCSO / LSPD Field Intelligence accounts — portal access only, never CID."
            onClick={() => router.push('/command-center?s=field')}
          />
        </div>
      </Panel>

      <Panel title="Justice coverage" sub="Each bureau needs an active prosecutor (primary or acting) or its classified legal requests go unseen at the DOJ — exactly the failure repaired in July 2026.">
        {a?.coverage === null && <p className="text-sm text-slate-400"><Badge tone="neutral">Unknown</Badge> <span className="ml-1">The assignment table could not be read — retry, and check Supabase if it persists.</span></p>}
        {a?.coverage && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {a.coverage.map((c) => {
              const covererId = c.primaryId ?? c.actingId
              // A held slot whose holder is invisible on the roster is a real
              // signal: test fixtures and removed accounts are hidden from
              // profile reads, so "held by someone you can't see" warrants a
              // look — never a green light. (Direct roster lookup, NOT
              // officerName(): that helper returns an 'Officer' placeholder
              // for unknown ids, which would mask exactly this case.)
              const holder = covererId ? roster.find((p) => p.id === covererId) : undefined
              const name = holder?.display_name ?? null
              const unresolvable = !!covererId && roster.length > 0 && !holder
              const tone = !covererId ? 'danger' : unresolvable ? 'warn' : name ? 'good' : 'neutral'
              const label = !covererId ? 'Uncovered' : unresolvable ? 'Verify' : name ? 'Covered' : 'Unknown'
              return (
                <div key={c.bureau} className="rounded-lg bg-ink-950/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-white">{bureauLabel(c.bureau)}</p>
                    <Badge tone={tone as 'danger' | 'warn' | 'good' | 'neutral'}>{label}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {covererId
                      ? <>{c.primaryId ? 'Primary' : 'Acting'}: {name || 'not on the visible roster — likely a test fixture or removed account; verify in Justice Portal → Coverage'}</>
                      : 'No active prosecutor — classified requests from this bureau are invisible at the DOJ until one is assigned (Justice Portal → Coverage).'}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </Panel>

      <JusticeGrantPanel roster={roster} />
      <TestFlagPanel roster={roster} />
    </div>
  )
}

/** Mirrors owner_grant_justice_membership()'s server validation exactly:
 *  DOJ takes the three prosecutorial titles, the Judiciary takes judge. */
const GRANTABLE_JUSTICE: { role: string; agency: JusticeAgency }[] = [
  { role: 'assistant_district_attorney', agency: 'doj' },
  { role: 'district_attorney', agency: 'doj' },
  { role: 'attorney_general', agency: 'doj' },
  { role: 'judge', agency: 'judiciary' },
]

/** First UI for public.owner_grant_justice_membership() — the dual-identity
 *  grant. The RPC is owner-only, reason-required and self-auditing
 *  (JUSTICE_GRANTED); it refuses test fixtures and removed/login-denied
 *  accounts server-side. */
function JusticeGrantPanel({ roster }: { roster: ReturnType<typeof useProfilesStore.getState>['profiles'] }) {
  const { profile } = useAuth()
  const [targetId, setTargetId] = useState('')
  const [role, setRole] = useState(GRANTABLE_JUSTICE[0].role)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const candidates = useMemo(() =>
    roster
      .filter((p) => p.active && !p.is_system && !p.removed_at)
      .slice()
      .sort((x, y) => (x.display_name || '').localeCompare(y.display_name || '')),
  [roster])
  const target = candidates.find((p) => p.id === targetId) ?? null
  const agency = GRANTABLE_JUSTICE.find((g) => g.role === role)?.agency ?? 'doj'

  const grant = async () => {
    const r = reason.trim()
    if (!target) { toast('Pick a member first.', 'warn'); return }
    if (!r) { toast('A reason is required — the RPC refuses without one.', 'warn'); return }
    const ok = await uiConfirm(
      `Grant ${justiceRoleLabel(role)} (${AGENCY_LABEL[agency]}) to ${target.display_name}?\n\nThis inserts or REPLACES their justice membership immediately — a dual identity alongside their CID role (${roleLabel(target.role)}, ${bureauLabel(target.division)}). They are notified, and the grant is audited server-side (JUSTICE_GRANTED) with your reason.\n\nLegacy ADA/DA titles act with the effective role ‘prosecutor’; the AG additionally holds ex-officio SIB oversight once the release gate is open.`,
      { title: 'Grant a justice membership?', confirmText: 'Grant' },
    )
    if (!ok) return
    setBusy(true)
    const res = await rpc('owner_grant_justice_membership', {
      p_target: target.id, p_agency: agency, p_justice_role: role, p_reason: r,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(`${justiceRoleLabel(role)} granted to ${target.display_name}`, 'success')
    setTargetId(''); setReason('')
  }

  return (
    <Panel title="Justice grant (dual identity)" sub="Direct owner appointment into the DOJ/Judiciary — the ordinary signup path deliberately blocks active CID members from applying; dual identity is an owner decision.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="jg-target" className={labelCls}>Member (active CID)</label>
          <select id="jg-target" value={targetId} onChange={(e) => setTargetId(e.target.value)} className={inputCls}>
            <option value="">— select a member —</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name} · {roleLabel(p.role)}/{bureauLabel(p.division)}{p.id === profile?.id ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="jg-role" className={labelCls}>Role (agency follows)</label>
          <select id="jg-role" value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
            {GRANTABLE_JUSTICE.map((g) => (
              <option key={g.role} value={g.role}>{justiceRoleLabel(g.role)} — {AGENCY_LABEL[g.agency]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="jg-reason" className={labelCls}>Reason (required, audited)</label>
          <input id="jg-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this appointment…" className={inputCls} />
        </div>
      </div>
      <Button variant="primary" className="mt-3" disabled={busy || !targetId} onClick={() => void grant()}>
        {busy ? 'Granting…' : 'Grant justice membership'}
      </Button>
    </Panel>
  )
}

/** First UI for public.set_profile_test_flag(). Flagging hides the profile
 *  from EVERY real member's profile reads — this owner account included — so
 *  clearing a flag takes the exact user id rather than a picker. Owner-only,
 *  audited server-side (TEST_FLAG_SET). */
function TestFlagPanel({ roster }: { roster: ReturnType<typeof useProfilesStore.getState>['profiles'] }) {
  const { profile } = useAuth()
  const [targetId, setTargetId] = useState('')
  const [clearId, setClearId] = useState('')
  const [busy, setBusy] = useState(false)

  const candidates = useMemo(() =>
    roster
      .filter((p) => p.id !== profile?.id && !p.is_system)
      .slice()
      .sort((x, y) => (x.display_name || '').localeCompare(y.display_name || '')),
  [roster, profile?.id])
  const target = candidates.find((p) => p.id === targetId) ?? null

  const setFlag = async (id: string, isTest: boolean, name: string | null) => {
    const ok = await uiConfirm(
      isTest
        ? `Flag ${name ?? id} as a TEST FIXTURE?\n\nEffect: the profile disappears from every real member's profile reads (roster, pickers, analytics, search) — including this owner account. It is excluded from ex-officio SIB standings and treated as a fixture by the security suites. The account itself keeps working.\n\nAudited server-side (TEST_FLAG_SET). To undo, you will need the exact user id: ${id}`
        : `Clear the test-fixture flag on ${id}?\n\nEffect: the profile becomes visible on the roster and in every profile read again, and stops being treated as a fixture.\n\nAudited server-side (TEST_FLAG_SET).`,
      { title: isTest ? 'Flag as test fixture?' : 'Clear test-fixture flag?', confirmText: isTest ? 'Flag as fixture' : 'Clear flag' },
    )
    if (!ok) return
    setBusy(true)
    const res = await rpc('set_profile_test_flag', { p_target: id, p_is_test: isTest })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(isTest ? 'Profile flagged as a test fixture' : 'Test-fixture flag cleared', 'success')
    setTargetId(''); setClearId('')
    void useProfilesStore.getState().fetch()
  }

  return (
    <Panel title="Test-fixture flagging" sub="profiles.is_test hides an account from every real member's reads — how the rls-test fixtures stay off the roster. Flagged profiles vanish from this picker too, so clearing takes the exact user id.">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <label htmlFor="tf-target" className={labelCls}>Flag a visible member as a fixture</label>
          <select id="tf-target" value={targetId} onChange={(e) => setTargetId(e.target.value)} className={inputCls}>
            <option value="">— select a member —</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name} · {roleLabel(p.role)}/{bureauLabel(p.division)}{p.active ? '' : ' · inactive'}
              </option>
            ))}
          </select>
          <Button variant="danger" size="sm" className="mt-2" disabled={busy || !target}
            onClick={() => { if (target) void setFlag(target.id, true, target.display_name) }}>
            Flag as test fixture
          </Button>
        </div>
        <div>
          <label htmlFor="tf-clear" className={labelCls}>Clear a flag by user id</label>
          <input id="tf-clear" value={clearId} onChange={(e) => setClearId(e.target.value)}
            placeholder="profile UUID of the hidden fixture" className={inputCls} />
          <Button size="sm" className="mt-2" disabled={busy || !clearId.trim()}
            onClick={() => void setFlag(clearId.trim(), false, null)}>
            Clear flag
          </Button>
        </div>
      </div>
    </Panel>
  )
}

/* ---- permanent deletion --------------------------------------------------- */

function DeletionSection() {
  const router = useRouter()
  return (
    <div className="space-y-4">
      <PermanentDeletionSection />
      <DeletionLedgerPanel />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LinkCard
          title="Case permanent deletion"
          sub="Performed from the case header — owner only, archived cases only, reason + preview required (Cases → Archived)."
          onClick={() => router.push('/cases')}
        />
        <LinkCard
          title="Field-record undelete"
          sub="Deleted field submissions are recoverable — Intelligence → the Deleted filter (owner)."
          onClick={() => router.push('/field-review')}
        />
      </div>
    </div>
  )
}

/** Read-only window onto deleted_member_ledger — the owner-only table that
 *  preserves the identity snapshot, reason and reference counts of every
 *  permanent deletion. First UI ever for it; bounded to the latest 20. */
function DeletionLedgerPanel() {
  // undefined = loading; null = the read failed.
  const [rows, setRows] = useState<Tables<'deleted_member_ledger'>[] | null | undefined>(undefined)
  useEffect(() => {
    const t = window.setTimeout(() => {
      void list('deleted_member_ledger', { order: 'executed_at', ascending: false, limit: 20 })
        .then(setRows)
        .catch(() => setRows(null))
    }, 0)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <Panel title="Deletion ledger" sub="Owner-only record of every executed permanent deletion — identity snapshot, reason and how many references each account held. Read-only; latest 20.">
      {rows === undefined && <p className="text-sm text-slate-400">Loading the ledger…</p>}
      {rows === null && <p className="text-sm text-slate-400">The ledger could not be read — it is owner-only by RLS; retry from a signed-in owner session.</p>}
      {rows?.length === 0 && <p className="text-sm text-emerald-300">✓ No permanent deletions have ever been executed.</p>}
      {!!rows?.length && (
        <div className="space-y-2">
          {rows.map((r) => {
            const refs = ledgerReferenceCount(r.references)
            return (
              <div key={r.id} className="rounded-lg bg-ink-950/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 text-sm font-bold text-white">
                    {r.display_name}
                    <span className="ml-2 font-normal text-slate-400">
                      {roleLabel(r.role)}{r.division ? ` / ${bureauLabel(r.division)}` : ''}{r.badge_number ? ` · #${r.badge_number}` : ''}
                    </span>
                  </p>
                  <Badge tone="neutral">{refs === null ? 'refs unknown' : `${refs} reference${refs === 1 ? '' : 's'}`}</Badge>
                  <span className="text-xs text-slate-400">executed {timeAgo(r.executed_at)}</span>
                </div>
                <p className="mt-1 text-sm text-slate-300">Reason: {r.reason}</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  by {officerName(r.deleted_by) || 'unknown'}{r.armed_at ? ` · armed ${timeAgo(r.armed_at)}` : ''}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

/* ---- security & audit ----------------------------------------------------- */

function SecurityAuditSection() {
  const router = useRouter()
  return (
    <div className="space-y-4">
      <SecurityTestingSection />
      <ClientErrorsPanel />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <LinkCard
          title="Audit Log"
          sub="Every mutation, trigger-written, exportable to CSV — owner-only screen."
          onClick={() => router.push('/audit')}
        />
        <LinkCard
          title="Documentation governance"
          sub="Doc-governance warnings (stale required reading, unacknowledged campaigns) render on the Audit Log screen."
          onClick={() => router.push('/audit')}
        />
      </div>
    </div>
  )
}

/** Uncaught client exceptions reported by src/lib/errorReport.ts. Live via
 *  realtime; owners also get a throttled bell notification (DB trigger). */
function ClientErrorsPanel() {
  const [rows, setRows] = useState<Tables<'client_errors'>[]>([])
  const [busy, setBusy] = useState(false)
  const v = useTableVersion('client_errors')
  const refresh = useCallback(async () => {
    // Cap in the query, not client-side — the panel only ever shows 25.
    try { setRows(await list('client_errors', { order: 'created_at', ascending: false, limit: 25 })) }
    catch { /* offline — panel shows empty */ }
  }, [])
  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, v])
  const clearAll = async () => {
    setBusy(true)
    for (const r of rows) {
      const res = await remove('client_errors', r.id)
      if (res.error) { toast(res.error.message, 'danger'); break }
    }
    setBusy(false)
    void refresh()
  }
  return (
    <Panel title="Client errors" sub="Uncaught exceptions reported from members' browsers (max 5 per session per user, deduplicated). You also get a bell notification, throttled to one per 15 minutes.">
      {rows.length === 0 ? (
        <p className="text-sm text-emerald-300">✓ No errors reported.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <details key={r.id} className="rounded-lg bg-rose-500/5 p-3">
              <summary className="cursor-pointer text-sm text-slate-200">
                <span className="font-bold text-rose-200">{r.message.slice(0, 120)}</span>
                <span className="ml-2 text-slate-400">{r.route || ''} · {officerName(r.reporter_id) || 'unknown'} · {timeAgo(r.created_at)}</span>
              </summary>
              {r.stack && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-950 p-2 text-xs text-slate-400">{r.stack}</pre>}
              {r.user_agent && <p className="mt-1 text-xs text-slate-400">{r.user_agent}</p>}
            </details>
          ))}
          <Button size="sm" disabled={busy} onClick={() => void clearAll()}>
            {busy ? 'Clearing…' : 'Clear shown'}
          </Button>
        </div>
      )}
    </Panel>
  )
}

/* ---- system health -------------------------------------------------------- */

interface HealthState {
  db: { ok: boolean; ms: number } | null
  counts: Record<string, number | null>
  at: number
}

const STAT_TABLES = ['profiles', 'cases', 'evidence', 'reports', 'persons', 'gangs', 'vehicles', 'indicators', 'media', 'feedback', 'notifications', 'audit_log'] as const

function SystemSection() {
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
  const rtEntries = Object.entries(versions).sort((x, y) => y[1] - x[1])
  const liveTables = rtEntries.length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <HealthCard label="Database" ok={h?.db?.ok ?? null} detail={h?.db ? `${h.db.ms} ms round-trip` : 'checking…'} />
        <HealthCard label="Authentication" ok={!!session} detail={session ? 'session active, auto-refreshing' : 'no session'} />
        <HealthCard label="Realtime" ok={liveTables > 0 ? true : null} detail={liveTables > 0 ? `events from ${liveTables} tables this session` : 'no events yet this session (signal, not a failure)'} />
        <HealthCard label="Media host" ok={fmConfigured()} detail={fmConfigured() ? 'FiveManage configured (not pinged — pinging would upload)' : 'not configured — uploads disabled'} />
      </div>

      <Panel title="Application" sub="Build metadata comes from Vercel system env vars — 'Unavailable' means the project doesn't expose them, not an error.">
        <div className="grid grid-cols-1 gap-2 text-sm text-slate-300 sm:grid-cols-2">
          <p>Environment: <b className="text-white">{vercelEnv ?? (process.env.NODE_ENV === 'production' ? 'production build' : 'development')}</b></p>
          <p>Deployed branch: <b className="text-white">{branch ?? 'Unavailable'}</b></p>
          <p>Commit: <b className="font-mono text-white">{commit ? commit.slice(0, 10) : 'Unavailable'}</b></p>
          <p>Supabase client: <b className="text-white">{isConfigured ? 'configured' : 'NOT CONFIGURED'}</b></p>
        </div>
      </Panel>

      <Panel title="Safety" sub="Checks that should always be green.">
        <ul className="space-y-1.5 text-sm">
          <SafetyLine ok={isConfigured} text="Supabase env vars present" bad="Missing NEXT_PUBLIC_SUPABASE_* — the app cannot function" />
          <SafetyLine ok={fmConfigured()} text="FiveManage configured (optional)" bad="Uploads disabled — Attachments/Media fall back to paste-a-URL" warnOnly />
          <SafetyLine ok={h?.db?.ok ?? true} text="Database reachable" bad="Profile count query failed — check Supabase status/logs" />
          <li className="text-slate-400">Owner-dashboard items that live OUTSIDE this repo: Supabase OTP expiry + leaked-password protection + backups (see docs/HARDENING.md), GitHub branch protection (see the handbook&rsquo;s workflow chapter).</li>
        </ul>
      </Panel>

      <Panel title="Environment overview" sub="Names and purpose only — values are never displayed (they are public client keys, but the habit matters). Changing any of these requires a REBUILD, and vercel.json + ci.yml carry duplicate copies that must agree.">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] font-bold uppercase tracking-wider text-slate-400">
                <th className="px-2 py-2">Variable</th><th className="px-2 py-2">Purpose</th><th className="px-2 py-2">Required</th><th className="px-2 py-2">Status</th><th className="px-2 py-2">If missing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {ENV_VARS.map((e) => {
                const ok = e.name.startsWith('NEXT_PUBLIC_SUPABASE') ? isConfigured : fmConfigured()
                return (
                  <tr key={e.name}>
                    <td className="px-2 py-2 font-mono text-blue-300">{e.name}</td>
                    <td className="px-2 py-2 text-slate-300">{e.purpose}</td>
                    <td className="px-2 py-2 text-slate-400">{e.required ? 'required' : 'optional'}</td>
                    <td className="px-2 py-2">{ok ? <span className="text-emerald-300">✓ configured</span> : <span className={e.required ? 'text-rose-300' : 'text-amber-300'}>✗ missing</span>}</td>
                    <td className="px-2 py-2 text-slate-400">{e.ifMissing}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="This session's realtime activity" sub="Version counters = events received since you signed in. A quiet table is not a failure — it just hasn't changed. Full realtime documentation lives in the handbook (State & Realtime).">
        {rtEntries.length ? (
          <div className="flex flex-wrap gap-1.5">
            {rtEntries.map(([t, ver]) => (
              <span key={t} className="rounded-lg border border-white/10 bg-ink-950/50 px-2 py-1 font-mono text-[11px] text-slate-300">
                {t} <b className="text-emerald-300">{ver}</b>
              </span>
            ))}
          </div>
        ) : <p className="text-sm text-slate-400">No events yet this session.</p>}
      </Panel>

      <Panel title="Statistics" sub="Live row counts (RLS-scoped — these are the rows YOUR account can see, which for the owner+command account is everything). 'Unavailable' = the count query failed.">
        {loading && !h ? <p className="text-sm text-slate-400">Counting…</p> : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {STAT_TABLES.map((t) => (
              <div key={t} className="rounded-lg bg-ink-950/50 p-3">
                <p className="font-mono text-lg font-semibold text-white">{h?.counts[t] ?? '—'}</p>
                <p className="text-xs font-medium text-slate-500">{t.replace(/_/g, ' ')}</p>
              </div>
            ))}
          </div>
        )}
        <Button size="sm" className="mt-3" disabled={loading} onClick={() => void refresh()}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </Button>
      </Panel>
    </div>
  )
}

function HealthCard({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-ink-950/50 p-4">
      <p className="flex items-center gap-2 text-[13px] font-semibold text-white">
        <span className={`t-dot ${ok === true ? 't-dot-green' : ok === false ? 't-dot-rose' : 't-dot-amber'}`} /> {label}
      </p>
      <p className="mt-1.5 text-sm text-slate-300">{detail}</p>
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

/** Stroke glyph for the inbox rows — bug report vs. idea/request. Local to
 *  this owner-only surface; follows the shell icon idiom (currentColor,
 *  aria-hidden, sits beside a text label). */
function KindGlyph({ bug }: { bug: boolean }) {
  return (
    <svg aria-hidden="true" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-slate-400">
      {bug
        ? <><rect x="8" y="7" width="8" height="11" rx="4" /><path d="M9 4l1.5 2M15 4l-1.5 2M3.5 9.5L8 11M3.5 17l4.5-1.5M20.5 9.5L16 11M20.5 17L16 15.5M12 7v11" /></>
        : <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />}
    </svg>
  )
}

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
    void useProfilesStore.getState().fetch()
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
        <div className="mb-3 flex flex-wrap gap-1 rounded-lg bg-ink-950/40 p-1" role="group" aria-label="Feedback views">
          {FB_VIEWS.map((v) => {
            const n = items.filter((i) => v.match(i)).length
            const on = view === v.id
            return (
              <button key={v.id} onClick={() => setView(v.id)} aria-pressed={on}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${on ? 'bg-badge-500/15 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
                {v.label} <span className={on ? 'text-slate-300' : 'text-slate-500'}>{n}</span>
              </button>
            )
          })}
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, notes, tags, submitter…" aria-label="Search feedback"
            className="w-64 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 text-sm text-white outline-none focus:border-badge-500" />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort feedback"
            className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-sm text-white outline-none">
            <option value="newest">Newest</option><option value="oldest">Oldest</option>
            <option value="priority">Priority</option><option value="status">Status</option>
            <option value="updated">Recently updated</option>
          </select>
          <Button size="sm" aria-label="Refresh" title="Refresh" onClick={() => void refresh()}>↻</Button>
        </div>

        {loading ? <p className="text-sm text-slate-400">Loading submissions…</p>
          : err ? <ErrorNotice message={err} onRetry={() => void refresh()} />
          : !shown.length ? <EmptyState icon={<ArchiveIcon size={26} />} title="Nothing in this view." hint="Try another filter or clear the search." />
          : (
            <div className="space-y-2">
              {shown.map((i) => (
                <button key={i.fb.id} onClick={() => setDetail(i)} className="block w-full rounded-lg border border-white/10 bg-ink-950/50 p-3 text-left transition hover:border-blue-400/30">
                  <div className="flex flex-wrap items-center gap-2">
                    <KindGlyph bug={(i.meta?.type ?? i.fb.kind) === 'bug'} />
                    <p className="min-w-0 flex-1 truncate text-sm font-bold text-white">{i.fb.title}</p>
                    <Badge tint={FB_STATUS_TINT[i.meta?.status ?? 'new']}>{fbLabel(i.meta?.status ?? 'new')}</Badge>
                    {i.meta?.priority && <Badge tint={FB_PRIORITY_TINT[i.meta.priority]}>{fbLabel(i.meta.priority)}</Badge>}
                    {i.meta?.type && <Badge tone="neutral">{fbLabel(i.meta.type)}</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {officerName(i.fb.created_by) ?? 'Unknown member'} · {timeAgo(i.fb.created_at)}
                    {i.meta?.category && <> · {i.meta.category}</>}
                    {i.fb.details && <> — <span className="text-slate-300">{i.fb.details.slice(0, 90)}{i.fb.details.length > 90 ? '…' : ''}</span></>}
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
  const [tags, setTags] = useState(parseStringArray(m?.tags).join(', '))
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

  return (
    <Modal open onClose={onClose} dirty={dirty} wide>
      <ModalHeader title={item.fb.title} onClose={onClose} />
      <p className="-mt-2 mb-3 text-xs text-slate-400">
        {officerName(item.fb.created_by) ?? 'Unknown member'} · submitted {timeAgo(item.fb.created_at)} ·
        public kind: {item.fb.kind}
      </p>
      {item.fb.details && (
        <div className="mb-4 rounded-lg bg-ink-950/60 p-3">
          <p className="whitespace-pre-wrap text-sm text-slate-300">{item.fb.details}</p>
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
          <label className={labelCls}>Public status <span className="font-normal text-slate-400">(submitter sees)</span></label>
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
        <Button variant="primary" className="flex-1" disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save catalog'}
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Archive instead of delete — nothing here is destructive. Status changes to
        &ldquo;resolved&rdquo;/&ldquo;archived&rdquo; stamp their timestamps automatically; all writes are audit-logged.
      </p>
    </Modal>
  )
}

/* ---- handbook & reference ------------------------------------------------- */

const HANDBOOK_LINKS: { page: string; label: string; sub: string }[] = [
  { page: 'architecture', label: 'Architecture Blocks', sub: 'The nine blocks, risk levels & common mistakes' },
  { page: 'database', label: 'Database Guide', sub: 'Tables, RLS policies & triggers — where every rule lives' },
  { page: 'auth', label: 'Auth Flow', sub: 'Gate states, capability booleans & the owner flag' },
  { page: 'api', label: 'API Flow', sub: 'How a read/write travels db.ts → PostgREST → RLS' },
  { page: 'state', label: 'State & Realtime', sub: 'Stores, version counters & the refetch pattern' },
  { page: 'dependency-map', label: 'Dependency Map', sub: 'What imports what, across the repo' },
  { page: 'change-impact', label: 'Change Impact Tables', sub: '"If I change this, what else must I check?"' },
  { page: 'learning-path', label: 'Learning Path', sub: 'Beginner → advanced milestones, and what to avoid early' },
  { page: 'glossary', label: 'Glossary', sub: 'The project vocabulary, defined' },
  { page: 'faq', label: 'FAQ', sub: 'Common questions, answered from the repo' },
]

function ReferenceSection() {
  const router = useRouter()
  return (
    <div className="space-y-4">
      <Panel title="Developer Handbook" sub="The reference library — searchable, generated from the repo docs. The suggestions roadmap, route registry, workflow guide and learning paths that used to be duplicated here live in these chapters.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <LinkCard title="Open the Handbook" sub="All chapters, with full-text search." onClick={() => router.push('/devdocs')} />
          {HANDBOOK_LINKS.map((h) => (
            <LinkCard key={h.page} title={h.label} sub={h.sub} onClick={() => router.push(`/devdocs?page=${h.page}`)} />
          ))}
        </div>
      </Panel>
      <Panel title="Change Impact — dependency explorer" sub="Pick anything — libraries, components, hooks, tables, RPCs, services, config — to see what it depends on, what depends on it, and what to check if you change it. Impact lists are curated from the repository analysis; treat them as informed inference, not proof.">
        <DepExplorer />
      </Panel>
    </div>
  )
}
