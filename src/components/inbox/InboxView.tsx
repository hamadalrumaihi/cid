'use client'

/** My Dashboard (/inbox) — the personal landing surface (Phase-2A rebuild of
 *  the old "My Desk"). One prioritized "Needs your attention" panel (the TOP
 *  slice of the Action Center's useActionItems queue) replaces the former
 *  dead metric strip and the duplicated sign-off / returned / follow-up /
 *  task / mention panels — and their big unprojected table loads went with
 *  them. Everything this view fetches itself is a slim projection with a
 *  limit, RLS-scoped as ever. Empty panels render nothing (DashPanel
 *  `empty`); every count is clickable through to its owning surface. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useActionItems } from '@/components/actioncenter/useActionItems'
import { isFieldOnlyAccount } from '@/components/command-center/lib/membershipPending'
import { DashPanel } from '@/components/dash/DashPanel'
import { DashRow } from '@/components/dash/DashRow'
import { DashSwitcher } from '@/components/dash/DashSwitcher'
import { JumpBack } from '@/components/command/JumpBack'
import { SiuAccessRequestCard } from '@/components/siu/SiuAccessRequest'
import { useCreate } from '@/components/shell/CreateHost'
import { useToolNav } from '@/components/tools/useToolNav'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { uiConfirm } from '@/components/ui/dialog'
import { describeDraftKey } from '@/lib/actionItems'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import type { Json, Tables } from '@/lib/database.types'
import { list, removeWhere } from '@/lib/db'
import { useFieldStanding } from '@/lib/fieldStanding'
import { timeAgo } from '@/lib/format'
import { useJusticeRoster } from '@/lib/justiceRoster'
import { humanize } from '@/lib/legalWorkflow'
import { TAB_LABEL } from '@/lib/nav'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { ROLE_LABEL, bureauShort } from '@/lib/roles'
import { signoffLabel } from '@/lib/signoff'
import { Store } from '@/lib/store'
import { toast } from '@/lib/toast'
import { isToolTab, type ToolId } from '@/lib/toolsModel'
import { markWatchSeen, type WatchType } from '@/lib/watchlist'
import { listCaseHealth } from '@/lib/caseHealth'
import { fetchWatchTargets, type WatchTarget } from './watchItems'

/* ── slim projections — every self-fetch is select+limit bounded ─────────── */

type MyCaseRow = Pick<Tables<'cases'>,
  'id' | 'case_number' | 'title' | 'status' | 'bureau' | 'lead_detective_id'
  | 'created_by' | 'summary' | 'follow_up_at' | 'signoff_status'
  | 'signoff_submitted_by' | 'updated_at'>
type ReportLite = Pick<Tables<'reports'>, 'id' | 'case_id' | 'template' | 'finalized' | 'updated_at'>
type MessageLite = Pick<Tables<'case_messages'>,
  'id' | 'case_id' | 'author_id' | 'author_name' | 'body' | 'mentions' | 'created_at'>
type LegalLite = Pick<Tables<'legal_requests'>,
  'id' | 'request_number' | 'request_type' | 'review_status' | 'updated_at'>
type DraftLite = Pick<Tables<'user_drafts'>, 'key' | 'updated_at'>

const MY_CASE_COLS =
  'id,case_number,title,status,bureau,lead_detective_id,created_by,summary,'
  + 'follow_up_at,signoff_status,signoff_submitted_by,updated_at'
const REPORT_COLS = 'id,case_id,template,finalized,updated_at'
const MESSAGE_COLS = 'id,case_id,author_id,author_name,body,mentions,created_at'
const LEGAL_COLS = 'id,request_number,request_type,review_status,updated_at'
const DRAFT_COLS = 'key,updated_at'

interface DeskData {
  myCases: MyCaseRow[]
  /** Cases I submitted for sign-off (any state) — feeds the returned badge
   *  and the recent-decisions slice of the activity panel. */
  submissions: MyCaseRow[]
  watched: WatchTarget[]
  drafts: DraftLite[]
  reports: ReportLite[]
  messages: MessageLite[]
  legal: LegalLite[]
}

const EMPTY: DeskData = { myCases: [], submissions: [], watched: [], drafts: [], reports: [], messages: [], legal: [] }

const RETURNED_SIGNOFF = new Set(['changes_requested', 'denied'])
/** Sign-off states that represent a DECISION on a submission (for the
 *  activity feed) — everything except open/awaiting. */
const DECIDED_SIGNOFF = new Set(['changes_requested', 'denied', 'approved_deputy', 'approved_complete', 'ready_doj'])

const isJsonArray = (v: Json): v is Json[] => Array.isArray(v)

function jsonHasId(v: Json, id: string): boolean {
  if (!id) return false
  if (typeof v === 'string') return v === id
  if (isJsonArray(v)) return v.some((x) => jsonHasId(x, id))
  if (v && typeof v === 'object') return Object.values(v).some((x) => jsonHasId((x ?? null) as Json, id))
  return false
}

/* ── open Investigative Tools tabs (sessionStorage, ids only) ─────────────
 * Same key/shape ToolsView persists ({tabs:[{toolId,recordId?}],activeKey}).
 * Read directly — tools/ readStored is module-private and this must not
 * import from tools/ views. IDS ONLY: list tabs label via TAB_LABEL; record
 * tabs render as "<tool label> record" WITHOUT fetching titles (no reads,
 * nothing leaked — the workspace re-verifies titles through RLS on open). */

interface OpenToolTab { toolId: ToolId; recordId?: string }

function readToolTabs(uid: string | null): OpenToolTab[] {
  if (!uid || typeof window === 'undefined') return []
  try {
    const raw = window.sessionStorage.getItem(`cid-tools-workspace:${uid}`)
    if (!raw) return []
    const parsed = JSON.parse(raw) as { tabs?: Array<{ toolId?: unknown; recordId?: unknown }> }
    if (!Array.isArray(parsed?.tabs)) return []
    const out: OpenToolTab[] = []
    for (const t of parsed.tabs) {
      if (typeof t?.toolId === 'string' && isToolTab(t.toolId)) {
        out.push(typeof t.recordId === 'string' && t.recordId
          ? { toolId: t.toolId, recordId: t.recordId }
          : { toolId: t.toolId })
      }
    }
    return out
  } catch { return [] }
}

interface ActivityRow { key: string; ts: string; title: string; why: string; href: string }

export function InboxView() {
  const { profile, state, isCommand, canEdit } = useAuth()
  const create = useCreate()
  const { openHref } = useToolNav()
  const ac = useActionItems()
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const rosterProfiles = useProfilesStore((s) => s.profiles)
  const justiceByUser = useJusticeRoster((s) => s.byUser)
  const fetchJustice = useJusticeRoster((s) => s.fetch)
  const fieldIds = useFieldStanding((s) => s.ids)
  const fieldLoaded = useFieldStanding((s) => s.loaded)
  const fetchFieldStanding = useFieldStanding((s) => s.fetch)

  const [data, setData] = useState<DeskData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // Bumped whenever a watchSeen stamp is written so `fresh` chips recompute.
  const [seenVer, setSeenVer] = useState(0)
  const [openTabs, setOpenTabs] = useState<OpenToolTab[]>([])

  const vCases = useTableVersion('cases')
  const vMessages = useTableVersion('case_messages')
  const vReports = useTableVersion('reports')
  const vWatch = useTableVersion('watchlist')
  const vDrafts = useTableVersion('user_drafts')
  const vLegal = useTableVersion('legal_requests')
  const vPersons = useTableVersion('persons')
  const vVehicles = useTableVersion('vehicles')
  const vJustice = useTableVersion('justice_memberships')

  const refresh = useCallback(async () => {
    if (state !== 'in' || !profile) return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      await fetchProfiles() // officerName for mention authors / case leads
      if (isCommand) { void fetchJustice(); void fetchFieldStanding() }
      const me = profile.id
      const [myCases, submissions, watched, drafts, reports, messages, legal] = await Promise.all([
        // My cases: lead OR creator = me, live rows, newest movement first.
        list('cases', {
          select: MY_CASE_COLS, or: `lead_detective_id.eq.${me},created_by.eq.${me}`,
          is: { archived_at: null }, order: 'updated_at', ascending: false, limit: 40,
        }).then((r) => r as unknown as MyCaseRow[]),
        // My sign-off submissions — recent decisions + the returned badge.
        list('cases', {
          select: MY_CASE_COLS, eq: { signoff_submitted_by: me },
          order: 'updated_at', ascending: false, limit: 10,
        }).then((r) => r as unknown as MyCaseRow[]).catch(() => [] as MyCaseRow[]),
        fetchWatchTargets(me).catch(() => [] as WatchTarget[]),
        // user_drafts is RLS owner-only; the eq is belt-and-braces. Keys only.
        list('user_drafts', {
          select: DRAFT_COLS, eq: { user_id: me }, order: 'updated_at', ascending: false, limit: 8,
        }).then((r) => r as unknown as DraftLite[]).catch(() => [] as DraftLite[]),
        // Unfinalized reports authored by me (finalized filtered client-side —
        // the column is nullable).
        list('reports', {
          select: REPORT_COLS, eq: { author_id: me }, order: 'updated_at', ascending: false, limit: 20,
        }).then((r) => r as unknown as ReportLite[]).catch(() => [] as ReportLite[]),
        // Recent case chat — mention matching happens client-side over one
        // bounded page (RLS scopes it to cases I can read).
        list('case_messages', {
          select: MESSAGE_COLS, order: 'created_at', ascending: false, limit: 40,
        }).then((r) => r as unknown as MessageLite[]).catch(() => [] as MessageLite[]),
        // My legal requests, newest movement first — activity feed only.
        list('legal_requests', {
          select: LEGAL_COLS, eq: { created_by: me }, order: 'updated_at', ascending: false, limit: 5,
        }).then((r) => r as unknown as LegalLite[]).catch(() => [] as LegalLite[]),
      ])
      setData({ myCases, submissions, watched, drafts, reports, messages, legal })
      // profiles.id IS the auth uid — the same key ToolsView persists under.
      setOpenTabs(readToolTabs(profile.id))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [fetchProfiles, fetchJustice, fetchFieldStanding, isCommand, profile, state])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, vCases, vMessages, vReports, vWatch, vDrafts, vLegal, vPersons, vVehicles, vJustice])

  // Command-only banner count: pending CID sign-ins awaiting a decision.
  // Mirrors the roster rule — an inactive member holding an active justice
  // identity was moved out by an organization correction, and a Field
  // Intelligence submitter is inactive by design (applied for nothing).
  const pendingApprovals = isCommand
    ? rosterProfiles.filter((p) => !p.active && !p.removed_at && !justiceByUser[p.id]
        && !isFieldOnlyAccount(p.id, fieldLoaded ? fieldIds : null)).length
    : 0

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
    const mentions = data.messages.filter((m) => m.author_id !== myId
      && (jsonHasId(m.mentions, myId)
        || (!!profile?.display_name && m.body.toLowerCase().includes(`@${profile.display_name.toLowerCase()}`))))

    // Recent activity: three bounded self-scoped sources, merged newest-first.
    const activity: ActivityRow[] = [
      ...mentions.slice(0, 6).map((m) => ({
        key: `msg:${m.id}`, ts: m.created_at,
        title: `${m.author_name || officerName(m.author_id) || 'Officer'} mentioned you`,
        why: m.body, href: caseLink(m.case_id, 'chat'),
      })),
      ...data.legal.map((l) => ({
        key: `legal:${l.id}`, ts: l.updated_at,
        title: `${l.request_number} — ${humanize(l.request_type || 'request')}`,
        why: `Your legal request · ${humanize(l.review_status || 'submitted')}`,
        href: `/legal?request=${encodeURIComponent(l.id)}`,
      })),
      ...data.submissions.filter((c) => DECIDED_SIGNOFF.has(c.signoff_status)).slice(0, 5).map((c) => ({
        key: `signoff:${c.id}`, ts: c.updated_at,
        title: `${c.case_number} · ${c.title || 'Untitled case'}`,
        why: `Sign-off decision on your submission — ${signoffLabel(c.signoff_status)}`,
        href: caseLink(c.id, 'signoff'),
      })),
    ].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 8)

    return { myId, myCases, returnedIds, watched, draftReports, activity }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seenVer invalidates the Store-read watchSeen map
  }, [data, profile, seenVer])

  const attention = ac.items.slice(0, 8)
  const freshWatched = model.watched.filter((it) => it.fresh)

  const markAllSeen = () => {
    for (const it of model.watched) markWatchSeen(it.w.target_type as WatchType, it.w.target_id, it.ts ?? undefined)
    setSeenVer((v) => v + 1)
  }

  const discardDraft = async (key: string) => {
    const ok = await uiConfirm(
      'Discard this draft? The saved work-in-progress is deleted; anything already saved to the record itself is untouched.',
      { title: 'Discard draft', confirmText: 'Discard draft' },
    )
    if (!ok) return
    // The viewer's own user_drafts row (RLS owner-only) — same write path the
    // Action Center's discard uses.
    const res = await removeWhere('user_drafts', { eq: { key } })
    if (res.error) { toast(`Could not discard the draft: ${res.error.message}`, 'danger'); return }
    setData((d) => ({ ...d, drafts: d.drafts.filter((x) => x.key !== key) }))
    toast('Draft discarded.', 'success')
  }

  if (state !== 'in') return <p className="px-3 py-2.5 text-sm text-slate-400">Sign in to view your dashboard.</p>

  const draftsCount = data.drafts.length + model.draftReports.length
  const allQuiet = !loading && !ac.loading && ac.items.length === 0 && model.myCases.length === 0
    && openTabs.length === 0 && draftsCount === 0 && model.watched.length === 0 && model.activity.length === 0

  return (
    <section className="view-in space-y-4">
      {/* The visible page title lives in the shell Header (PAGE_META.inbox);
          this keeps the one-h1-per-view contract without duplicating it. */}
      <h1 className="sr-only">My Dashboard</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DashSwitcher />
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

      {isCommand && (
        <button
          onClick={() => openHref('/command-center')}
          className="flex w-full flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-left transition hover:border-amber-300/40 hover:bg-amber-500/15"
        >
          <span className="text-sm font-bold text-amber-100">
            Command administration
            <span className="ml-2 font-normal text-amber-200/80">
              {pendingApprovals > 0
                ? `${pendingApprovals} sign-in ${pendingApprovals === 1 ? 'request' : 'requests'} awaiting approval`
                : 'Approvals, promotions & transfers'}
            </span>
          </span>
          <span className="flex items-center gap-2">
            {pendingApprovals > 0 && <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-black text-amber-100">{pendingApprovals}</span>}
            <span className="text-xs font-semibold text-amber-200">Open Command Center →</span>
          </span>
        </button>
      )}

      {loading && <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-400">Loading your dashboard…</p>}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        <DashPanel
          title="Needs your attention"
          count={ac.items.length}
          action={{ label: `Open Action Center (${ac.items.length}) →`, href: '/action' }}
          empty={ac.items.length === 0}
        >
          {attention.map((it) => (
            <DashRow
              key={it.id}
              title={it.title}
              why={it.reason || it.summary}
              meta={it.caseNumber ?? timeAgo(it.updatedAt)}
              overdue={it.status === 'overdue'}
              badge={it.priority === 'critical'
                ? <Badge tone="danger">critical</Badge>
                : it.priority === 'high' ? <Badge tone="warn">high</Badge> : undefined}
              onClick={() => openHref(it.deepLink)}
            />
          ))}
        </DashPanel>

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
          title="Open investigative tabs"
          count={openTabs.length}
          hint="Tabs still open in your Investigative Tools workspace this session."
          empty={openTabs.length === 0}
        >
          {openTabs.map((t, i) => (
            <DashRow
              key={`${t.toolId}:${t.recordId ?? i}`}
              title={t.recordId ? `${TAB_LABEL[t.toolId] ?? t.toolId} record` : TAB_LABEL[t.toolId] ?? t.toolId}
              why={t.recordId
                ? 'An open record tab — its title reloads when you return'
                : 'An open tool tab in your workspace'}
              onClick={() => openHref(t.recordId
                ? `/tools?tool=${t.toolId}&record=${encodeURIComponent(t.recordId)}`
                : `/tools?tool=${t.toolId}`)}
            />
          ))}
        </DashPanel>

        <DashPanel title="Drafts" count={draftsCount} empty={draftsCount === 0}>
          {data.drafts.map((d) => {
            const desc = describeDraftKey(d.key)
            return (
              <div key={d.key} className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <DashRow
                    title={desc.title}
                    why={desc.summary}
                    meta={timeAgo(d.updated_at)}
                    onClick={() => openHref(desc.deepLink)}
                  />
                </div>
                <button
                  onClick={() => { void discardDraft(d.key) }}
                  aria-label={`Discard draft: ${desc.title}`}
                  className="min-h-10 flex-shrink-0 rounded-lg px-2.5 text-[11px] font-semibold text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300"
                >
                  Discard
                </button>
              </div>
            )
          })}
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
              title={`${it.icon} ${it.title}`}
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

        <DashPanel title="Recent activity" count={model.activity.length} empty={model.activity.length === 0}>
          {model.activity.map((r) => (
            <DashRow key={r.key} title={r.title} why={r.why} meta={timeAgo(r.ts)} onClick={() => openHref(r.href)} />
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
