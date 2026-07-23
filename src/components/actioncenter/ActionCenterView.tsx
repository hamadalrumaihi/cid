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
import { update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { timeAgo, todayISO } from '@/lib/format'
import { toast } from '@/lib/toast'
import { useNow } from '@/lib/useNow'
import { Button } from '@/components/ui/Button'
import { Field, Textarea } from '@/components/ui/Field'
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
  { key: 'transfer', label: 'Transfers', types: ['transfer'] },
  { key: 'access', label: 'Access', types: ['access_request', 'membership_request', 'restricted_access'] },
  { key: 'legal', label: 'Legal', types: ['legal_request'] },
  { key: 'followup', label: 'Follow-ups', types: ['case_followup'] },
  { key: 'blocker', label: 'Blockers', types: ['blocker'] },
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

type SectionKey = 'overdue' | 'returned' | 'personal' | 'command' | 'waiting' | 'activity'

const SECTION_ORDER: { key: SectionKey; title: string }[] = [
  { key: 'overdue', title: 'Overdue' },
  { key: 'returned', title: 'Returned to you' },
  { key: 'personal', title: 'Needs your action' },
  { key: 'command', title: 'Command decisions' },
  { key: 'waiting', title: 'Waiting on others' },
]

function sectionOf(it: ActionItem): SectionKey {
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

function QueueSection({ id, title, items, muted, now, onOpen, onAction }: {
  id: SectionKey
  title: string
  items: ActionItem[]
  muted?: boolean
  now: number
  onOpen: (item: ActionItem) => void
  onAction: (item: ActionItem, kind: InlineActionKind) => Promise<unknown> | void
}) {
  if (!items.length) return null
  return (
    <section aria-labelledby={`ac-sec-${id}`}>
      <h2 id={`ac-sec-${id}`} className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
        {title} <span className="font-semibold">({items.length})</span>
      </h2>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <ActionItemRow key={it.id} item={it} now={now} muted={muted} onOpen={onOpen} onAction={onAction} />
        ))}
      </ul>
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
  const { state, isCommand } = useAuth()
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
  const typeFilter = TYPE_FILTERS.find((t) => t.key === fParam) ?? null
  const statusFilter = sParam && STATUS_FILTERS[sParam] ? sParam : null

  const setParam = useCallback((key: 'f' | 's', value: string | null) => {
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
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [sp, router, pathname])

  /** Absorbed unread notifications get read when an item is acted on or its
   *  deep link is followed — fire-and-forget, the queue refreshes anyway. */
  const absorb = useCallback((it: ActionItem) => {
    for (const id of notificationIdsOf(it)) void update('notifications', id, { read: true })
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
    // mark_read — the item's own notification row + any absorbed ones.
    const ids = new Set(notificationIdsOf(it))
    if (it.sourceType === 'mention' || it.sourceType === 'handover' || it.sourceType === 'other') ids.add(it.sourceId)
    const results = await Promise.all([...ids].map((id) => update('notifications', id, { read: true })))
    const failed = results.find((r) => r.error)
    if (failed?.error) { toast(failed.error.message, 'danger'); return }
    toast('Marked read.', 'success')
    await refresh()
  }, [absorb, refresh])

  const filtered = useMemo(() => {
    let out = items
    if (typeFilter) out = out.filter((it) => (typeFilter.types as readonly string[]).includes(it.sourceType))
    if (statusFilter) out = out.filter((it) => STATUS_FILTERS[statusFilter].test(it, today))
    return out
  }, [items, typeFilter, statusFilter, today])

  const sections = useMemo(() => {
    const buckets: Record<SectionKey, ActionItem[]> = { overdue: [], returned: [], personal: [], command: [], waiting: [], activity: [] }
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

  const hasFilter = !!typeFilter || !!statusFilter
  const showEmpty = !loading && (error == null || items.length > 0) && filtered.length === 0

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

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by source type">
            <FilterChip active={!typeFilter} onClick={() => setParam('f', null)}>All</FilterChip>
            {TYPE_FILTERS.map((t) => (
              <FilterChip key={t.key} active={typeFilter?.key === t.key} onClick={() => setParam('f', typeFilter?.key === t.key ? null : t.key)}>
                {t.label}
              </FilterChip>
            ))}
            {statusFilter && (
              <button
                type="button"
                onClick={() => setParam('s', null)}
                className="ml-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-3 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/15"
              >
                {STATUS_FILTERS[statusFilter].label}
                <span aria-hidden>×</span>
                <span className="sr-only">— clear status filter</span>
              </button>
            )}
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

          {SECTION_ORDER.map(({ key, title }) => (
            <QueueSection
              key={key}
              id={key}
              title={title}
              items={sections[key]}
              muted={key === 'waiting'}
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
