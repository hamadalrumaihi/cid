'use client'

/** Action Center — ONE prioritized queue of everything awaiting a decision or
 *  action from the signed-in member. Data comes from useActionItems (slim
 *  projected fetches → the pure buildActionItems model, pre-sorted by
 *  urgency); this view only sections, filters and routes. Inline actions are
 *  limited to the canonical writes the owning pages already make (task
 *  complete, blocker resolve, access decision, mark-read) — everything
 *  server-authoritative (sign-off, transfers, membership, legal) deep-links
 *  to its owning surface. My Desk stays the broad personal overview. */
import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { ActionItem } from '@/lib/actionItems'
import { removeWhere, update } from '@/lib/db'
import { markRead } from '@/lib/notifications'
import { useAuth } from '@/lib/auth'
import { timeAgo, todayISO } from '@/lib/format'
import { PERMANENT_BUREAUS, bureauShort } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { useNow } from '@/lib/useNow'
import { Button } from '@/components/ui/Button'
import { uiConfirm } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { AccessDecisionModal } from './AccessDecisionModal'
import { ActionItemRow, notificationIdsOf, type InlineActionKind } from './ActionItemRow'
import { useActionItems } from './useActionItems'

/* ── Filter model — one type filter (?f=) + one status filter (?s=) ──────── */

const TYPE_FILTERS: { key: string; label: string; types: readonly ActionItem['sourceType'][] }[] = [
  { key: 'task', label: 'Tasks', types: ['task'] },
  { key: 'signoff', label: 'Sign-offs', types: ['signoff', 'returned_case'] },
  // Transfers covers both bureau transfer_requests and DOJ member_transfers
  // (one sourceType — distinct member_transfer: keys).
  { key: 'transfer', label: 'Transfers', types: ['transfer'] },
  { key: 'access', label: 'Access', types: ['access_request', 'membership_request', 'restricted_access'] },
  { key: 'legal', label: 'Legal', types: ['legal_request'] },
  // DOJ pipeline work (prosecutor queue pickups, assigned prosecutorial /
  // judicial reviews) — only justice-role viewers ever produce these.
  { key: 'doj', label: 'DOJ queue', types: ['legal_queue'] },
  { key: 'followup', label: 'Follow-ups', types: ['case_followup'] },
  { key: 'blocker', label: 'Blockers', types: ['blocker'] },
  { key: 'surveillance', label: 'Surveillance', types: ['unverified_observation', 'surveillance_expiring'] },
  { key: 'intel', label: 'Intel', types: ['unassigned_intel'] },
  { key: 'bolo', label: 'BOLOs', types: ['bolo_expiring'] },
  { key: 'draft', label: 'Drafts', types: ['draft'] },
  // Library governance is navigation-only by design: acknowledging happens in
  // the reader AFTER reading — never as a one-click inline write here.
  { key: 'library', label: 'Library', types: ['document_ack', 'document_review', 'document_approval', 'document_sync'] },
  { key: 'mention', label: 'Mentions', types: ['mention', 'handover'] },
]

const STATUS_FILTERS: Record<string, { label: string; test: (it: ActionItem, today: string) => boolean }> = {
  overdue: { label: 'Overdue', test: (it) => it.status === 'overdue' },
  due: { label: 'Due today', test: (it, today) => !!it.dueAt && it.dueAt.slice(0, 10) === today },
  waiting: { label: 'Waiting on others', test: (it) => it.status === 'waiting' },
  command: { label: 'Command decisions', test: (it) => it.isCommandItem },
  returns: {
    label: 'Returns & mentions',
    test: (it) => it.status === 'returned' || it.sourceType === 'mention' || it.sourceType === 'handover',
  },
}

/* ── Section model — pre-sorted items partition into ordered queues ──────── */

type SectionKey = 'overdue' | 'returned' | 'personal' | 'command' | 'intel' | 'bolo' | 'waiting' | 'drafts' | 'activity'

/** Every section explains itself: a one-line subtitle saying what belongs
 *  here, and a specific empty message rendered when the (unfiltered) queue
 *  has nothing in that lane. `gate` names the viewer flag that must hold for
 *  the section to render at all when it is empty. */
const SECTION_ORDER: { key: Exclude<SectionKey, 'activity'>; title: string; subtitle: string; empty: string; gate?: 'isCommand' | 'canEdit' }[] = [
  { key: 'overdue', title: 'Overdue', subtitle: 'Deadlines that have already passed.', empty: 'Nothing is overdue.' },
  { key: 'returned', title: 'Returned to you', subtitle: 'Work sent back for changes — revise and resubmit.', empty: 'Nothing has been returned to you.' },
  { key: 'personal', title: 'Needs your action', subtitle: 'Tasks, reviews and replies waiting on you personally.', empty: 'Nothing is waiting on you personally.' },
  { key: 'command', title: 'Command decisions', subtitle: 'Approvals and authorizations your command role owns.', empty: 'Nothing is awaiting your command decision.', gate: 'isCommand' },
  { key: 'intel', title: 'Unassigned intel', subtitle: 'Field intelligence no reviewer has claimed yet.', empty: 'Nothing is awaiting intel review.', gate: 'canEdit' },
  { key: 'bolo', title: 'Expiring BOLOs', subtitle: 'BOLO windows closing within 7 days — renew or stand down.', empty: 'No BOLOs are close to expiry.', gate: 'canEdit' },
  { key: 'waiting', title: 'Waiting on others', subtitle: 'Your requests sitting in someone else’s queue — nothing for you to do yet.', empty: 'Nothing of yours is waiting on others.' },
  { key: 'drafts', title: 'Drafts', subtitle: 'Unfinished work you saved — resume it or discard it.', empty: 'No saved drafts.' },
]

function sectionOf(it: ActionItem): SectionKey {
  // The Wave-3 lanes are keyed by source, not status — a lapsed BOLO stays in
  // its own section instead of drowning the general Overdue list.
  if (it.sourceType === 'draft') return 'drafts'
  if (it.sourceType === 'unassigned_intel') return 'intel'
  if (it.sourceType === 'bolo_expiring') return 'bolo'
  if (it.status === 'overdue') return 'overdue'
  if (it.status === 'returned') return 'returned'
  if (it.status === 'waiting') return 'waiting'
  if (it.status === 'informational') return 'activity'
  return it.isCommandItem ? 'command' : 'personal' // needs_action / due_soon / blocked
}

/* ── Module-scope pieces (react-hooks/static-components) ─────────────────── */

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex min-h-[40px] items-center rounded-full border px-3 text-xs font-semibold transition ${
        active
          ? 'border-amber-400/30 bg-amber-500/15 text-amber-200'
          : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

function QueueSection({ id, title, subtitle, emptyText, showWhenEmpty, items, muted, now, onOpen, onAction }: {
  id: SectionKey
  title: string
  subtitle: string
  /** Specific empty message for this lane. */
  emptyText: string
  /** Filtered views hide empty sections; the full queue explains them. */
  showWhenEmpty: boolean
  items: ActionItem[]
  muted?: boolean
  now: number
  onOpen: (item: ActionItem) => void
  onAction: (item: ActionItem, kind: InlineActionKind) => Promise<unknown> | void
}) {
  if (!items.length && !showWhenEmpty) return null
  return (
    <section aria-labelledby={`ac-sec-${id}`}>
      <h2 id={`ac-sec-${id}`} className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
        {title} <span className="font-semibold">({items.length})</span>
      </h2>
      <p className="mb-2 mt-0.5 text-xs text-slate-400">{subtitle}</p>
      {items.length ? (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <ActionItemRow key={it.id} item={it} now={now} muted={muted} onOpen={onOpen} onAction={onAction} />
          ))}
        </ul>
      ) : (
        <EmptyState title={emptyText} />
      )}
    </section>
  )
}

/** Resolve-blocker modal — mirrors CaseBlockersPanel's resolve flow exactly
 *  (status='resolved' + optional note + who/when). Keyed by the target item
 *  in the parent so the note resets per blocker. */
function ResolveBlockerModal({ item, onClose, onResolved }: {
  item: ActionItem | null
  onClose: () => void
  onResolved: () => void
}) {
  const { profile } = useAuth()
  const [note, setNote] = useState('')
  const confirmResolve = async () => {
    if (!item) return
    const res = await update('case_blockers', item.sourceId, {
      status: 'resolved',
      resolution_note: note.trim() || null,
      resolved_by: profile?.id ?? null,
      resolved_at: new Date().toISOString(),
    })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Blocker resolved.', 'success')
    onResolved()
    onClose()
  }
  return (
    <Modal open={!!item} onClose={onClose} dirty={() => note.trim().length > 0}>
      <div className="p-5">
        <ModalHeader title="Resolve blocker" onClose={onClose} />
        <p className="text-sm text-slate-300">
          Mark <span className="font-semibold text-white">{item?.title ?? ''}</span> as resolved?
          It moves to the case&apos;s resolved history with your note.
        </p>
        <div className="mt-4">
          <Field label="Resolution note (optional)">
            {(id) => (
              <Textarea
                id={id}
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Lab results received and logged as evidence"
              />
            )}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button className="min-h-[44px] sm:min-h-0" onClick={onClose}>Cancel</Button>
          <Button variant="success" className="min-h-[44px] sm:min-h-0" onAction={confirmResolve}>Resolve blocker</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── The view ─────────────────────────────────────────────────────────────── */

export function ActionCenterView() {
  const { state, isCommand, canEdit } = useAuth()
  const { items, suppressedCount, loading, refreshing, error, refresh, lastRefreshed } = useActionItems()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const now = useNow()
  const today = todayISO()

  const [resolveTarget, setResolveTarget] = useState<ActionItem | null>(null)
  const [accessTarget, setAccessTarget] = useState<ActionItem | null>(null)

  const fParam = sp.get('f')
  const sParam = sp.get('s')
  const bParam = sp.get('b')
  const typeFilter = TYPE_FILTERS.find((t) => t.key === fParam) ?? null
  const statusFilter = sParam && STATUS_FILTERS[sParam] ? sParam : null
  const bureauFilter = bParam && (PERMANENT_BUREAUS as readonly string[]).includes(bParam) ? bParam : null

  const setParam = useCallback((key: 'f' | 's' | 'b', value: string | null) => {
    const params = new URLSearchParams(sp.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [sp, router, pathname])

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams(sp.toString())
    params.delete('f')
    params.delete('s')
    params.delete('b')
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [sp, router, pathname])

  /** Absorbed unread notifications get read when an item is acted on or its
   *  deep link is followed — fire-and-forget through the shared helper, the
   *  queue refreshes anyway. */
  const absorb = useCallback((it: ActionItem) => {
    void markRead(notificationIdsOf(it))
  }, [])

  const runInline = useCallback(async (it: ActionItem, kind: InlineActionKind) => {
    if (kind === 'resolve_blocker') { setResolveTarget(it); return }
    if (kind === 'decide_access') { setAccessTarget(it); return }
    if (kind === 'complete_task') {
      // Same write the case Tasks tab makes.
      const res = await update('case_tasks', it.sourceId, { done: true })
      if (res.error) { toast(res.error.message, 'danger'); return }
      toast('Task completed.', 'success')
      absorb(it)
      await refresh()
      return
    }
    if (kind === 'discard_draft') {
      // The viewer's own user_drafts row (RLS owner-only) — the finished
      // record, if one exists, is untouched.
      const ok = await uiConfirm('Discard this draft? The saved work-in-progress is deleted; anything already saved to the record itself is untouched.', {
        title: 'Discard draft', confirmText: 'Discard draft',
      })
      if (!ok) return
      const res = await removeWhere('user_drafts', { eq: { key: it.sourceId } })
      if (res.error) { toast(res.error.message, 'danger'); return }
      toast('Draft discarded.', 'success')
      await refresh()
      return
    }
    // mark_read — the item's own notification row + any absorbed ones.
    const ids = new Set(notificationIdsOf(it))
    if (it.sourceType === 'mention' || it.sourceType === 'handover' || it.sourceType === 'other') ids.add(it.sourceId)
    const err = await markRead([...ids])
    if (err) { toast(err.message, 'danger'); return }
    toast('Marked read.', 'success')
    await refresh()
  }, [absorb, refresh])

  const filtered = useMemo(() => {
    let out = items
    if (typeFilter) out = out.filter((it) => (typeFilter.types as readonly string[]).includes(it.sourceType))
    if (statusFilter) out = out.filter((it) => STATUS_FILTERS[statusFilter].test(it, today))
    if (bureauFilter) out = out.filter((it) => it.bureau === bureauFilter)
    return out
  }, [items, typeFilter, statusFilter, bureauFilter, today])

  const sections = useMemo(() => {
    const buckets: Record<SectionKey, ActionItem[]> = { overdue: [], returned: [], personal: [], command: [], intel: [], bolo: [], waiting: [], drafts: [], activity: [] }
    for (const it of filtered) buckets[sectionOf(it)].push(it)
    return buckets
  }, [filtered])

  // Metrics count the FULL queue (never the filtered slice) — real numbers only.
  const counts = useMemo(() => {
    let needsNow = 0, dueToday = 0, overdue = 0, waiting = 0, command = 0, returnsMentions = 0
    for (const it of items) {
      if (it.status === 'needs_action' || it.status === 'overdue' || it.status === 'due_soon' || it.status === 'returned') needsNow++
      if (it.dueAt && it.dueAt.slice(0, 10) === today) dueToday++
      if (it.status === 'overdue') overdue++
      if (it.status === 'waiting') waiting++
      if (it.isCommandItem) command++
      if (it.status === 'returned' || it.sourceType === 'mention' || it.sourceType === 'handover') returnsMentions++
    }
    return { needsNow, dueToday, overdue, waiting, command, returnsMentions }
  }, [items, today])

  const metrics = useMemo<Metric[]>(() => {
    const m: Metric[] = [
      { label: 'Needs action now', value: counts.needsNow, onClick: () => setParam('s', null) },
      { label: 'Due today', value: counts.dueToday, tint: counts.dueToday > 0 ? 'bg-amber-500/15 text-amber-300' : undefined, onClick: () => setParam('s', 'due') },
      { label: 'Overdue', value: counts.overdue, tint: counts.overdue > 0 ? 'bg-rose-500/15 text-rose-300' : undefined, onClick: () => setParam('s', 'overdue') },
      { label: 'Waiting on others', value: counts.waiting, onClick: () => setParam('s', 'waiting') },
    ]
    if (isCommand) m.push({ label: 'Command decisions', value: counts.command, onClick: () => setParam('s', 'command') })
    m.push({ label: 'Unread returns & mentions', value: counts.returnsMentions, onClick: () => setParam('s', 'returns') })
    return m
  }, [counts, isCommand, setParam])

  if (state !== 'in') return <Notice text="Sign in to view your Action Center." />

  const hasFilter = !!typeFilter || !!statusFilter || !!bureauFilter
  const showEmpty = !loading && (error == null || items.length > 0) && filtered.length === 0
  // With the full queue on screen, empty lanes explain themselves; filtered
  // views (and the all-caught-up state) hide them instead.
  const explainEmpties = !hasFilter && filtered.length > 0
  const gates: Record<'isCommand' | 'canEdit', boolean> = { isCommand, canEdit }

  return (
    <section className="view-in space-y-5">
      <PageHeader
        title="Action Center"
        subtitle="Prioritized work requiring your attention across cases, command, and personnel."
        actions={
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
              {refreshing && <span aria-hidden className="btn-spinner" />}
              {lastRefreshed ? `Updated ${timeAgo(lastRefreshed)}` : refreshing ? 'Refreshing…' : null}
            </span>
            <Button variant="secondary" onAction={refresh}>Refresh</Button>
          </>
        }
      />

      {loading && <ListSkeleton count={8} />}
      {!loading && error != null && items.length === 0 && <ErrorNotice message={error} onRetry={() => void refresh()} />}

      {!loading && (error == null || items.length > 0) && (
        <>
          <MetricStrip metrics={metrics} />

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Queue filters">
            <FilterChip active={!typeFilter} onClick={() => setParam('f', null)}>All</FilterChip>
            {TYPE_FILTERS.map((t) => (
              <FilterChip key={t.key} active={typeFilter?.key === t.key} onClick={() => setParam('f', typeFilter?.key === t.key ? null : t.key)}>
                {t.label}
              </FilterChip>
            ))}
            <span className="ml-auto flex items-center gap-1.5">
              {statusFilter && (
                <button
                  type="button"
                  onClick={() => setParam('s', null)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-3 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/15"
                >
                  {STATUS_FILTERS[statusFilter].label}
                  <span aria-hidden>×</span>
                  <span className="sr-only">— clear status filter</span>
                </button>
              )}
              <Select
                aria-label="Filter by bureau"
                value={bureauFilter ?? ''}
                onChange={(e) => setParam('b', e.target.value || null)}
                className="w-auto min-w-[9rem] py-2 text-xs"
              >
                <option value="">All bureaus</option>
                {PERMANENT_BUREAUS.map((b) => (
                  <option key={b} value={b}>{bureauShort(b)}</option>
                ))}
              </Select>
            </span>
          </div>

          {showEmpty && (hasFilter ? (
            <EmptyState
              title="No items match this filter."
              hint="Clear the filters to see the full queue."
              action={{ label: 'Clear filters', onClick: clearFilters }}
            />
          ) : (
            <EmptyState
              icon="✓"
              title="You're all caught up."
              hint="Nothing needs your action right now. My Desk keeps the broader overview of your cases, drafts and mentions."
              action={{ label: 'Open My Desk', onClick: () => router.push('/inbox') }}
            />
          ))}

          {SECTION_ORDER.map(({ key, title, subtitle, empty, gate }) => (
            <QueueSection
              key={key}
              id={key}
              title={title}
              subtitle={subtitle}
              emptyText={empty}
              showWhenEmpty={explainEmpties && (!gate || gates[gate])}
              items={sections[key]}
              muted={key === 'waiting' || key === 'drafts'}
              now={now}
              onOpen={absorb}
              onAction={runInline}
            />
          ))}

          {sections.activity.length > 0 && (
            <details>
              <summary className="cursor-pointer rounded text-xs font-black uppercase tracking-[0.14em] text-slate-400 transition hover:text-slate-300">
                <h2 className="inline">Recent activity ({sections.activity.length})</h2>
              </summary>
              <ul className="mt-2 space-y-1.5">
                {sections.activity.map((it) => (
                  <ActionItemRow key={it.id} item={it} now={now} muted onOpen={absorb} onAction={runInline} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <p className="text-xs text-slate-400">
        This is the actionable slice of your{' '}
        <Link href="/inbox" className="rounded font-semibold text-badge-200 transition hover:text-white">My Desk</Link>
        {' '}— the same reviews and tasks appear there in context.
        {suppressedCount > 0 && <> {suppressedCount} low-signal notification{suppressedCount === 1 ? ' was' : 's were'} folded into the items above.</>}
      </p>

      <ResolveBlockerModal
        key={resolveTarget?.id ?? 'none'}
        item={resolveTarget}
        onClose={() => setResolveTarget(null)}
        onResolved={() => void refresh()}
      />
      <AccessDecisionModal
        item={accessTarget}
        onClose={() => setAccessTarget(null)}
        onDecided={() => void refresh()}
      />
    </section>
  )
}
