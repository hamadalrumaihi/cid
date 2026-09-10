'use client'

/** My Dashboard (/dashboard) — the broad personal overview: My cases, Jump
 *  back in, Open workspace tabs, Report drafts and Watched items. The queue
 *  itself is the Action Center (/inbox, the default landing) — this view
 *  carries ONE line pointing there ("n items need your attention") from the
 *  shared useActionQueue counts, never a second rendering of the items.
 *  Everything this view fetches itself is a slim projection with a limit,
 *  RLS-scoped as ever. Empty panels render nothing (DashPanel `empty`); every
 *  count is clickable through to its owning surface. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useActionQueue } from '@/components/actioncenter/useActionQueue'
import { DashPanel } from '@/components/dash/DashPanel'
import { DashRow } from '@/components/dash/DashRow'
import { JumpBack } from './JumpBack'
import { SiuAccessRequestCard } from '@/components/siu/SiuAccessRequest'
import { useCreate } from '@/components/shell/CreateHost'
import { useToolNav } from '@/components/tools/useToolNav'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { timeAgo } from '@/lib/format'
import { humanize } from '@/lib/legalWorkflow'
import { TAB_LABEL } from '@/lib/nav'
import { useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { ROLE_LABEL, bureauShort } from '@/lib/roles'
import { signoffLabel } from '@/lib/signoff'
import { Store } from '@/lib/store'
import { humanizeError } from '@/lib/toast'
import { isToolTab, type ToolId } from '@/lib/toolsModel'
import { readMirror } from '@/lib/workspace/storage'
import { workspaceCaseHref } from '@/lib/workspace/model'
import { markWatchSeen, type WatchType } from '@/lib/watchlist'
import { listCaseHealth } from '@/lib/caseHealth'
import { fetchWatchTargets, type WatchTarget } from './watchItems'

/* ── slim projections — every self-fetch is select+limit bounded ─────────── */

type MyCaseRow = Pick<Tables<'cases'>,
  'id' | 'case_number' | 'title' | 'status' | 'bureau' | 'lead_detective_id'
  | 'created_by' | 'summary' | 'follow_up_at' | 'signoff_status'
  | 'signoff_submitted_by' | 'updated_at'>
type ReportLite = Pick<Tables<'reports'>, 'id' | 'case_id' | 'template' | 'finalized' | 'updated_at'>

const MY_CASE_COLS =
  'id,case_number,title,status,bureau,lead_detective_id,created_by,summary,'
  + 'follow_up_at,signoff_status,signoff_submitted_by,updated_at'
const REPORT_COLS = 'id,case_id,template,finalized,updated_at'

interface DeskData {
  myCases: MyCaseRow[]
  /** Cases I submitted for sign-off (any state) — feeds the returned badge. */
  submissions: MyCaseRow[]
  watched: WatchTarget[]
  /** Unfinalized report rows only — saved user_drafts are the Action Center
   *  queue's `draft` items, not a second list here. */
  reports: ReportLite[]
}

const EMPTY: DeskData = { myCases: [], submissions: [], watched: [], reports: [] }

const RETURNED_SIGNOFF = new Set(['changes_requested', 'denied'])

/* ── open workspace tabs (sessionStorage mirror, ids only) ────────────────
 * The unified workspace's per-user mirror (lib/workspace/storage readMirror;
 * `{tabs:[{kind,id,toolId?,section?}],active}`). IDS ONLY: list tabs label
 * via TAB_LABEL; record and case tabs render as "<tool label> record" /
 * "Case" WITHOUT fetching titles (no reads, nothing leaked — the workspace
 * re-verifies titles through RLS on open and closes what it cannot see). */

interface OpenToolTab { toolId?: ToolId; recordId?: string; caseId?: string }

function readToolTabs(uid: string | null): OpenToolTab[] {
  if (!uid || typeof window === 'undefined') return []
  const stored = readMirror(uid)
  if (!stored) return []
  const out: OpenToolTab[] = []
  for (const t of stored.tabs) {
    if (t.kind === 'case') out.push({ caseId: t.id })
    else if (t.kind === 'record' && t.toolId && isToolTab(t.toolId)) out.push({ toolId: t.toolId, recordId: t.id })
    else if (t.kind === 'tool' && isToolTab(t.id)) out.push({ toolId: t.id })
  }
  return out
}

export function MyDashboardView() {
  const { profile, state, canEdit } = useAuth()
  const create = useCreate()
  const { openHref } = useToolNav()
  const ac = useActionQueue()
  const fetchProfiles = useProfilesStore((s) => s.fetch)

  const [data, setData] = useState<DeskData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // Bumped whenever a watchSeen stamp is written so `fresh` chips recompute.
  const [seenVer, setSeenVer] = useState(0)
  const [openTabs, setOpenTabs] = useState<OpenToolTab[]>([])

  const vCases = useTableVersion('cases')
  const vReports = useTableVersion('reports')
  const vWatch = useTableVersion('watchlist')
  const vPersons = useTableVersion('persons')
  const vVehicles = useTableVersion('vehicles')

  const refresh = useCallback(async () => {
    if (state !== 'in' || !profile) return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      await fetchProfiles() // officerName for case leads
      const me = profile.id
      const [myCases, submissions, watched, reports] = await Promise.all([
        // My cases: lead OR creator = me, live rows, newest movement first.
        list('cases', {
          select: MY_CASE_COLS, or: `lead_detective_id.eq.${me},created_by.eq.${me}`,
          is: { archived_at: null }, order: 'updated_at', ascending: false, limit: 40,
        }).then((r) => r as unknown as MyCaseRow[]),
        // My sign-off submissions — the returned badge.
        list('cases', {
          select: MY_CASE_COLS, eq: { signoff_submitted_by: me },
          order: 'updated_at', ascending: false, limit: 10,
        }).then((r) => r as unknown as MyCaseRow[]).catch(() => [] as MyCaseRow[]),
        fetchWatchTargets(me).catch(() => [] as WatchTarget[]),
        // Unfinalized reports authored by me (finalized filtered client-side —
        // the column is nullable).
        list('reports', {
          select: REPORT_COLS, eq: { author_id: me }, order: 'updated_at', ascending: false, limit: 20,
        }).then((r) => r as unknown as ReportLite[]).catch(() => [] as ReportLite[]),
      ])
      setData({ myCases, submissions, watched, reports })
      // profiles.id IS the auth uid — the same key the workspace persists under.
      setOpenTabs(readToolTabs(profile.id))
    } catch (e) {
      // humanizeError: raw PostgREST/RLS text (table/policy names) must never
      // render on a member-facing surface (security review W1).
      setErr(humanizeError(e))
    } finally {
      setLoading(false)
    }
  }, [fetchProfiles, profile, state])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, vCases, vReports, vWatch, vPersons, vVehicles])

  const model = useMemo(() => {
    const myId = profile?.id ?? ''
    const returnedIds = new Set(
      data.submissions
        .filter((c) => c.signoff_submitted_by === myId && RETURNED_SIGNOFF.has(c.signoff_status))
        .map((c) => c.id),
    )
    const myCases = data.myCases.filter((c) => c.status !== 'closed').slice(0, 8)
    const seen = Store.get<Record<string, string>>('watchSeen', {})
    const watched = data.watched
      .map((it) => {
        const stamp = seen[`${it.w.target_type}:${it.w.target_id}`]
        // No activity ts → nothing new; followed before the marker → new-ish.
        return { ...it, fresh: !!it.ts && (!stamp || it.ts > stamp) }
      })
      .sort((a, b) => Number(b.fresh) - Number(a.fresh) || String(b.ts ?? '').localeCompare(String(a.ts ?? '')))
    const draftReports = data.reports.filter((r) => !r.finalized).slice(0, 5)
    return { myId, myCases, returnedIds, watched, draftReports }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seenVer invalidates the Store-read watchSeen map
  }, [data, profile, seenVer])

  const freshWatched = model.watched.filter((it) => it.fresh)

  const markAllSeen = () => {
    for (const it of model.watched) markWatchSeen(it.w.target_type as WatchType, it.w.target_id, it.ts ?? undefined)
    setSeenVer((v) => v + 1)
  }

  if (state !== 'in') return <p className="px-3 py-2.5 text-sm text-slate-400">Sign in to view your dashboard.</p>

  // The ONE Action Center pointer: everything waiting on the viewer
  // personally plus the command decisions they own (0 for non-command).
  const attention = ac.counts.personal + ac.counts.command
  const draftsCount = model.draftReports.length
  const allQuiet = !loading && !ac.loading && attention === 0 && model.myCases.length === 0
    && openTabs.length === 0 && draftsCount === 0 && model.watched.length === 0

  return (
    <section className="view-in space-y-4">
      {/* The visible page title lives in the shell Header (PAGE_META.dashboard);
          this keeps the one-h1-per-view contract without duplicating it. */}
      <h1 className="sr-only">My Dashboard</h1>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <>
              <Button onClick={() => create.open('case')}>New case</Button>
              <Button onClick={() => create.open('person')}>New person</Button>
              <Button onClick={() => create.open('vehicle')}>New vehicle</Button>
            </>
          )}
          <Button onClick={() => { void refresh(); void ac.refresh() }}>Refresh</Button>
        </div>
      </div>

      <p className="text-sm text-slate-400">
        <span className="font-semibold text-slate-200">{profile?.display_name || 'Officer'}</span>
        {' — '}
        {ROLE_LABEL[profile?.role ?? ''] || profile?.role || 'Member'}
        {profile?.division ? <> · {bureauShort(profile.division)}</> : null}
      </p>

      {err && <p className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100">Dashboard refresh failed: {err}</p>}

      {/* Renders for the Director of CID alone. They hold no SIU standing and
          cannot reach the SIU workspace at all, so the request surface has to
          live on their own dashboard. */}
      <SiuAccessRequestCard />

      {/* One line, not a second queue: the Action Center owns the items. */}
      {!ac.loading && (
        <button
          type="button"
          onClick={() => openHref('/inbox')}
          className={`flex min-h-[44px] w-full flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition ${
            attention > 0
              ? 'border-amber-400/25 bg-amber-500/10 text-amber-100 hover:border-amber-300/40 hover:bg-amber-500/15'
              : 'border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/5'
          }`}
        >
          <span>
            {attention > 0
              ? <><span className="font-semibold">{attention} item{attention === 1 ? '' : 's'}</span> need{attention === 1 ? 's' : ''} your attention</>
              : 'Nothing needs your action right now'}
          </span>
          <span className={`text-xs font-semibold ${attention > 0 ? 'text-amber-200' : 'text-badge-200'}`}>Action Center →</span>
        </button>
      )}

      {loading && <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-400">Loading your dashboard…</p>}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        <DashPanel
          title="My cases"
          count={model.myCases.length}
          action={{ label: 'All my cases →', onClick: () => { Store.set('casesScope', 'mine'); openHref('/cases') } }}
          empty={model.myCases.length === 0}
        >
          {model.myCases.map((c) => {
            const flags = listCaseHealth(c)
            const returned = model.returnedIds.has(c.id)
              || (c.signoff_submitted_by === model.myId && RETURNED_SIGNOFF.has(c.signoff_status))
            return (
              <DashRow
                key={c.id}
                title={`${c.case_number} · ${c.title || 'Untitled case'}`}
                badge={
                  <>
                    <StatusBadge domain="case" value={c.status} className="uppercase" />
                    {returned && <Badge tone="danger" title={signoffLabel(c.signoff_status)}>Returned to you</Badge>}
                    {flags.length > 0 && (
                      <Badge tone="warn" title={`Needs attention:\n${flags.map((f) => `• ${f.label}`).join('\n')}`}>
                        {flags.length}
                      </Badge>
                    )}
                  </>
                }
                why={`${c.lead_detective_id === model.myId ? 'You lead this case' : 'You opened this case'} · ${bureauShort(c.bureau)}${flags.length ? ` · ${flags.length} attention flag${flags.length === 1 ? '' : 's'}` : ''}`}
                meta={timeAgo(c.updated_at)}
                onClick={() => openHref(caseLink(c.id))}
              />
            )
          })}
        </DashPanel>

        {/* Pins + recents — ids-only stores, titles re-resolved through RLS. */}
        <JumpBack />

        <DashPanel
          title="Open workspace tabs"
          count={openTabs.length}
          hint="Tabs still open in your workspace."
          empty={openTabs.length === 0}
        >
          {openTabs.map((t, i) => (
            <DashRow
              key={`${t.caseId ?? t.toolId}:${t.recordId ?? i}`}
              title={t.caseId ? 'Case' : t.recordId ? `${TAB_LABEL[t.toolId ?? ''] ?? t.toolId} record` : TAB_LABEL[t.toolId ?? ''] ?? t.toolId}
              why={t.caseId
                ? 'An open case tab — its number reloads when you return'
                : t.recordId
                  ? 'An open record tab — its title reloads when you return'
                  : 'An open tool tab in your workspace'}
              onClick={() => openHref(t.caseId
                ? workspaceCaseHref(t.caseId)
                : t.recordId
                  ? `/workspace?tool=${t.toolId}&record=${encodeURIComponent(t.recordId)}`
                  : `/workspace?tool=${t.toolId}`)}
            />
          ))}
        </DashPanel>

        <DashPanel title="Report drafts" count={draftsCount} empty={draftsCount === 0}>
          {model.draftReports.map((r) => (
            <DashRow
              key={r.id}
              title={`Report draft — ${humanize(r.template || 'report')}`}
              why="Unfinalized case report — finish and finalize it"
              meta={timeAgo(r.updated_at)}
              onClick={() => openHref(caseLink(r.case_id, 'reports'))}
            />
          ))}
        </DashPanel>

        <DashPanel
          title="Watched items"
          count={model.watched.length}
          action={freshWatched.length > 0 ? { label: `Mark all seen (${freshWatched.length})`, onClick: markAllSeen } : undefined}
          empty={model.watched.length === 0}
        >
          {model.watched.map((it) => (
            <DashRow
              key={it.w.id}
              title={it.title}
              badge={it.fresh ? <Badge tone="warn">updated</Badge> : undefined}
              why={it.sub}
              meta={it.ts ? timeAgo(it.ts) : undefined}
              onClick={() => {
                markWatchSeen(it.w.target_type as WatchType, it.w.target_id, it.ts ?? undefined)
                setSeenVer((v) => v + 1)
                openHref(it.href)
              }}
            />
          ))}
        </DashPanel>
      </div>

      {allQuiet && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
          All clear — nothing is waiting on you right now.
        </p>
      )}
    </section>
  )
}
