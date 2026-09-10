'use client'

/** Action Center — ONE prioritized queue of everything awaiting a decision or
 *  action from the signed-in member. Data comes from useActionQueue (the
 *  shared store: slim projected fetches → the pure buildActionItems model,
 *  pre-sorted by urgency, with the viewer's own snooze / dismiss state and
 *  the escalation ledger merged in); this view only sections, filters,
 *  selects and routes. Inline actions are whatever `inlineActionsFor` offers
 *  (the canonical writes the owning pages already make) — everything else
 *  deep-links to its owning surface. My Dashboard (/dashboard) stays the
 *  broad personal overview.
 *
 *  Phase 7: per-row Snooze (≤ 48 h) / Dismiss (dismissable kinds only) with
 *  Snoozed / Dismissed folds, a bulk bar (mark read / snooze / dismiss —
 *  never a decision), Reassign for task / blocker rows the lead or command
 *  owns, the Escalated badge + filter, role presets + saved views
 *  (`?preset=` / `?view=`), and a card layout below 640 px.
 *
 *  This IS the personal home (/inbox, the default landing): with no
 *  `?preset=` / `?view=` / filter in the URL the viewer's role preset
 *  (defaultPresetFor — or their default saved view, which wins) is applied,
 *  and `?lane=activity` opens the Recent activity lane (the bell's View All). */
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { SOURCE_TYPE_LABEL, type ActionItem } from '@/lib/actionItems'
import {
  ACTION_STATUS_KEYS, availableTypeFilters, defaultPresetFor, normalizeActionConfig, presetById,
  type ActionSectionKey, type ActionStatusKey, type ActionViewConfig, type PresetViewer,
} from '@/lib/actionPresets'
import { isDbError, isDismissable, type ActionStateOp } from '@/lib/actionState'
import { markRead } from '@/lib/notifications'
import { useAuth } from '@/lib/auth'
import { ciInvolved, useCiContext } from '@/lib/ci'
import { canReassignCaseWork, useSiu, type CidViewer } from '@/lib/permissions'
import { useSavedViews } from '@/lib/savedViews'
import { timeAgo, todayISO } from '@/lib/format'
import { PERMANENT_BUREAUS, bureauShort } from '@/lib/roles'
import { humanizeError, toast } from '@/lib/toast'
import { useNarrow } from '@/lib/useNarrow'
import { useNow } from '@/lib/useNow'
import { Button } from '@/components/ui/Button'
import { uiConfirm } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { CheckIcon } from '@/components/shell/icons'
import { AccessDecisionModal, type AccessTarget } from './AccessDecisionModal'
import { ActionCard } from './ActionCard'
import { ActionItemRow, type RowLane } from './ActionItemRow'
import { BulkBar } from './BulkBar'
import { inlineActionsFor, notificationIdsOf, runInlineAction, type InlineAction, type InlineViewer } from './inlineActions'
import { ReassignDialog } from './ReassignDialog'
import { useActionQueue } from './useActionQueue'
import { ViewsMenu } from './ViewsMenu'

/* ── Filter model — one type filter (?f=) + one status filter (?s=) ──────── */

/** Type chips come from lib/actionPresets (unit-tested to cover every
 *  SOURCE_TYPE_LABEL kind) — `availableTypeFilters(viewer)` in the view, so a
 *  gated chip (Informants) exists only for the accounts the CI compartment
 *  involves; the status predicates live here. */
const STATUS_FILTERS: Record<ActionStatusKey, { label: string; test: (it: ActionItem, today: string) => boolean }> = {
  overdue: { label: 'Overdue', test: (it) => it.status === 'overdue' },
  due: { label: 'Due today', test: (it, today) => !!it.dueAt && it.dueAt.slice(0, 10) === today },
  waiting: { label: 'Waiting on others', test: (it) => it.status === 'waiting' },
  command: { label: 'Command decisions', test: (it) => it.isCommandItem },
  escalated: { label: 'Escalated', test: (it) => !!it.escalatedAt },
  returns: {
    label: 'Returns & mentions',
    test: (it) => it.status === 'returned' || it.sourceType === 'mention' || it.sourceType === 'handover',
  },
}

const isStatusKey = (v: string | null): v is ActionStatusKey => !!v && (ACTION_STATUS_KEYS as readonly string[]).includes(v)

/* ── Section model — pre-sorted items partition into ordered queues ──────── */

type SectionKey = ActionSectionKey

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

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
/** The case lead the builder attached to a task / blocker row (Phase 7 —
 *  `sourceMetadata.caseLeadId`); null means only command may reassign. */
const leadOf = (it: ActionItem): string | null => str((it.sourceMetadata as { caseLeadId?: unknown }).caseLeadId)

const fmtUntil = (iso: string): string =>
  new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })

/* ── Module-scope pieces (react-hooks/static-components) ─────────────────── */

function FilterChip({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`inline-flex min-h-[40px] flex-shrink-0 items-center rounded-full border px-3 text-xs font-semibold transition ${
        active
          ? 'border-amber-400/30 bg-amber-500/15 text-amber-200'
          : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  )
}

interface RowHandlers {
  now: number
  narrow: boolean
  actionsFor: (item: ActionItem) => InlineAction[]
  isSelected: (item: ActionItem) => boolean
  onSelect: (item: ActionItem, range: boolean) => void
  onOpen: (item: ActionItem) => void
  onAction: (item: ActionItem, action: InlineAction) => Promise<unknown> | void
  onState: (item: ActionItem, op: ActionStateOp, until?: string) => Promise<unknown> | void
}

function RowList({ items, muted, lane, h }: { items: ActionItem[]; muted?: boolean; lane?: RowLane; h: RowHandlers }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it) => {
        const props = {
          item: it, now: h.now, muted, lane, actions: h.actionsFor(it), selected: h.isSelected(it),
          onSelect: h.onSelect, onOpen: h.onOpen, onAction: h.onAction, onState: h.onState,
        }
        return h.narrow ? <ActionCard key={it.id} {...props} /> : <ActionItemRow key={it.id} {...props} />
      })}
    </ul>
  )
}

function QueueSection({ id, title, subtitle, emptyText, showWhenEmpty, items, muted, h, className }: {
  id: SectionKey
  title: string
  subtitle: string
  /** Specific empty message for this lane. */
  emptyText: string
  /** Filtered views hide empty sections; the full queue explains them. */
  showWhenEmpty: boolean
  items: ActionItem[]
  muted?: boolean
  h: RowHandlers
  /** Grid placement only (e.g. the full-width Overdue lane). */
  className?: string
}) {
  if (!items.length && !showWhenEmpty) return null
  const heading = (
    <h2 id={`ac-sec-${id}`} className="inline text-[13px] font-semibold text-white">
      {title} <span className="font-normal text-slate-400">({items.length})</span>
    </h2>
  )
  const body = items.length ? <RowList items={items} muted={muted} h={h} /> : <EmptyState title={emptyText} />
  if (h.narrow) {
    // Phones: every lane is a native disclosure (open by default) so a long
    // queue can be folded lane by lane.
    return (
      <details open className={className}>
        <summary className="flex min-h-[44px] cursor-pointer items-center rounded text-white transition hover:text-slate-300">{heading}</summary>
        <p className="mb-2 mt-0.5 text-xs text-slate-400">{subtitle}</p>
        {body}
      </details>
    )
  }
  return (
    <section aria-labelledby={`ac-sec-${id}`} className={className}>
      <div>{heading}</div>
      <p className="mb-2 mt-0.5 text-xs text-slate-400">{subtitle}</p>
      {body}
    </section>
  )
}

/** Snoozed / Dismissed folds — the viewer's own hidden rows, one click back. */
function HiddenLane({ lane, items, open, h }: { lane: 'snoozed' | 'dismissed'; items: ActionItem[]; open?: boolean; h: RowHandlers }) {
  if (!items.length) return null
  const title = lane === 'snoozed' ? 'Snoozed' : 'Dismissed'
  const hint = lane === 'snoozed'
    ? 'Hidden until the snooze lapses (48 h at most). Unsnooze to bring one back now.'
    : 'Informational items you dismissed. Restore to see one again.'
  return (
    <details open={open}>
      <summary className="flex min-h-[44px] cursor-pointer items-center rounded text-[13px] font-semibold text-white transition hover:text-slate-300 lg:min-h-0">
        <h2 className="inline">{title} <span className="font-normal text-slate-400">({items.length})</span></h2>
      </summary>
      <p className="mb-2 mt-0.5 text-xs text-slate-400">{hint}</p>
      <RowList items={items} muted lane={lane} h={h} />
    </details>
  )
}

interface ReasonTarget { item: ActionItem; action: InlineAction }

/** Copy for the `reason` modal kinds; anything unlisted gets the generic form. */
const REASON_COPY: Record<string, { title: string; body: (it: ActionItem) => React.ReactNode; label: string; placeholder?: string }> = {
  resolve_blocker: {
    title: 'Resolve blocker',
    body: (it) => <>Mark <span className="font-semibold text-white">{it.title}</span> as resolved? It moves to the case&apos;s resolved history with your note.</>,
    label: 'Resolution note (optional)',
    placeholder: 'e.g. Lab results received and logged as evidence',
  },
  approve_restricted_export: {
    title: 'Approve restricted export',
    body: (it) => <>Approve the restricted-media packet export for <span className="font-semibold text-white">{it.title}</span>? The approval is audited on the case.</>,
    label: 'Note (optional)',
  },
}

/** One small note dialog for every `modal: 'reason'` inline action — the
 *  note is optional here (the server validates what it requires). */
function ReasonModal({ target, onClose, onDone }: { target: ReasonTarget | null; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const copy = target ? REASON_COPY[target.action.kind] : null
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!target || busy) return
    setBusy(true)
    try {
      const text = note.trim() || undefined
      const res = await runInlineAction(target.item, target.action.kind, { reason: text, note: text })
      if (!res.ok) { toast(humanizeError(res.message), 'danger'); return }
      toast(res.message ?? 'Done.', 'success')
      onDone()
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={!!target} onClose={onClose} dirty={() => note.trim().length > 0}>
      <form onSubmit={submit} className="p-5">
        <ModalHeader title={copy?.title ?? target?.action.label ?? ''} onClose={onClose} />
        <p className="text-sm text-slate-300">
          {target && (copy ? copy.body(target.item) : <>{target.action.label} <span className="font-semibold text-white">{target.item.title}</span>?</>)}
        </p>
        <div className="mt-4">
          <Field label={copy?.label ?? 'Note (optional)'}>
            {(id) => (
              <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={copy?.placeholder} />
            )}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" className="min-h-[44px] sm:min-h-0" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="success" className="min-h-[44px] sm:min-h-0" loading={busy}>{target?.action.label ?? 'Confirm'}</Button>
        </div>
      </form>
    </Modal>
  )
}

const CONFIRM_COPY: Record<string, string> = {
  discard_draft: 'Discard this draft? The saved work-in-progress is deleted; anything already saved to the record itself is untouched.',
}

const EMPTY_SECTIONS = (): Record<SectionKey, ActionItem[]> =>
  ({ overdue: [], returned: [], personal: [], command: [], intel: [], bolo: [], waiting: [], drafts: [], activity: [] })

/* ── The view ─────────────────────────────────────────────────────────────── */

export function ActionCenterView() {
  const { state, profile, isCommand, isOwner, canEdit, justiceRole } = useAuth()
  const siu = useSiu()
  const ci = useCiContext()
  const queue = useActionQueue()
  const { items, snoozed, dismissed, suppressedCount, loading, refreshing, error, refresh, lastRefreshed, setState, counts } = queue
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const now = useNow()
  const today = todayISO()
  const narrow = useNarrow()
  const sv = useSavedViews<ActionViewConfig>('action')

  const [reasonTarget, setReasonTarget] = useState<ReasonTarget | null>(null)
  const [accessTarget, setAccessTarget] = useState<AccessTarget | null>(null)
  const [reassignTarget, setReassignTarget] = useState<ActionItem | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const lastPick = useRef<string | null>(null)

  /* ── URL state: f / s / b are the source of truth; preset / view apply them ── */

  const fParam = sp.get('f')
  const sParam = sp.get('s')
  const bParam = sp.get('b')
  const presetParam = sp.get('preset')
  const viewParam = sp.get('view')
  /** `?lane=activity` (the bell's View All): the Recent activity lane renders
   *  expanded — and renders even when the active preset hides it. */
  const activityOpen = sp.get('lane') === 'activity'
  const statusFilter = isStatusKey(sParam) ? sParam : null
  const bureauFilter = bParam && (PERMANENT_BUREAUS as readonly string[]).includes(bParam) ? bParam : null

  const activePreset = presetById(presetParam)
  const activeView = useMemo(() => (viewParam ? sv.views.find((v) => v.name === viewParam) ?? null : null), [viewParam, sv.views])
  // A saved view's config is stored JSON (opaque to lib/savedViews) — shape-
  // check it before anything reads `.sections`; presets are source constants.
  const activeConfig: ActionViewConfig | null = useMemo(
    () => (activeView ? normalizeActionConfig(activeView.config) : activePreset?.config ?? null),
    [activeView, activePreset],
  )

  const replaceParams = useCallback((mutate: (p: URLSearchParams) => void) => {
    const params = new URLSearchParams(sp.toString())
    mutate(params)
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [sp, router, pathname])

  /** A manual chip / bureau change leaves the preset or view (the URL's
   *  f / s / b stay authoritative; the menu falls back to "Full queue"). */
  const setParam = useCallback((key: 'f' | 's' | 'b', value: string | null) => {
    replaceParams((params) => {
      if (value) params.set(key, value)
      else params.delete(key)
      params.delete('preset')
      params.delete('view')
    })
  }, [replaceParams])

  const clearFilters = useCallback(() => {
    replaceParams((params) => { for (const k of ['f', 's', 'b', 'preset', 'view']) params.delete(k) })
  }, [replaceParams])

  const selectView = useCallback((sel: { preset?: string; view?: string } | null) => {
    replaceParams((params) => {
      for (const k of ['f', 's', 'b', 'preset', 'view']) params.delete(k)
      if (sel?.preset) params.set('preset', sel.preset)
      else if (sel?.view) params.set('view', sel.view)
    })
  }, [replaceParams])

  // Apply the active preset / view's f / s / b to the URL (once they differ).
  // A config field left undefined keeps whatever the URL says; null clears.
  useEffect(() => {
    if (!activeConfig) return
    const params = new URLSearchParams(sp.toString())
    let changed = false
    for (const k of ['f', 's', 'b'] as const) {
      const want = activeConfig[k]
      if (want === undefined) continue
      if ((want ?? null) !== params.get(k)) {
        changed = true
        if (want) params.set(k, want)
        else params.delete(k)
      }
    }
    if (changed) router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [activeConfig, sp, router, pathname])

  /* ── Viewer shapes for the cosmetic gates ── */

  const inlineViewer = useMemo<InlineViewer>(() => ({ isCommand, canEdit, userId: profile?.id ?? null }), [isCommand, canEdit, profile?.id])
  const cidViewer = useMemo<CidViewer>(() => ({
    id: profile?.id ?? null, role: profile?.role ?? null, division: profile?.division ?? null,
    active: profile?.active ?? null, is_owner: profile?.is_owner ?? null,
  }), [profile?.id, profile?.role, profile?.division, profile?.active, profile?.is_owner])
  const ciOn = ciInvolved(ci.ctx)
  const presetViewer = useMemo<PresetViewer>(() => ({
    role: profile?.role ?? null, isCommand, isOwner, justiceRole,
    sib: { canAccess: siu.canAccess, isAgent: siu.isAgent, isCommand: siu.isCommand },
    ci: ciOn,
  }), [profile?.role, isCommand, isOwner, justiceRole, siu.canAccess, siu.isAgent, siu.isCommand, ciOn])
  /** The type chips this viewer is offered; an `?f=` naming a chip they are
   *  not offered filters nothing (the URL is left alone). */
  const typeFilters = useMemo(() => availableTypeFilters(presetViewer), [presetViewer])
  const typeFilter = typeFilters.find((t) => t.key === fParam) ?? null

  // The default view opens once per mount — only on a clean slate (no filter,
  // preset or view in the URL), so it never stomps a deep link. The member's
  // DEFAULT saved view wins; otherwise the role preset (defaultPresetFor).
  // Waits for the saved views, the profile and the SIB standing so the
  // preset is chosen for the real viewer, not a half-loaded one. Other params
  // (`?lane=`) ride along.
  const defaultApplied = useRef(false)
  useEffect(() => {
    if (defaultApplied.current || !sv.loaded || state !== 'in' || !profile || siu.loading) return
    defaultApplied.current = true
    if (sp.get('f') || sp.get('s') || sp.get('b') || sp.get('preset') || sp.get('view')) return
    const params = new URLSearchParams(sp.toString())
    const d = sv.defaultView
    if (d) params.set('view', d.name)
    else {
      const preset = defaultPresetFor(presetViewer)
      if (preset) params.set('preset', preset)
    }
    if (params.toString() !== sp.toString()) router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    // Snapshot semantics: runs once when the inputs finish loading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv.loaded, state, profile, siu.loading])

  /** The row's inline actions — B's table, with Reassign additionally gated
   *  by the permissions mirror (lead / command / Owner, active). */
  const actionsFor = useCallback((it: ActionItem): InlineAction[] =>
    inlineActionsFor(it, inlineViewer).filter((a) =>
      a.kind !== 'reassign' || canReassignCaseWork({ lead_detective_id: leadOf(it) }, cidViewer)),
  [inlineViewer, cidViewer])

  /* ── State + notification writes ── */

  /** Absorbed unread notifications get read and the row is marked seen when
   *  its deep link is followed — fire-and-forget; the queue refreshes anyway. */
  const onOpen = useCallback((it: ActionItem) => {
    void markRead(notificationIdsOf(it))
    void setState(it.dedupeKey, 'seen')
  }, [setState])

  const applyState = useCallback(async (keys: string[], op: ActionStateOp, until?: string) => {
    const res = await setState(keys.length === 1 ? keys[0] : keys, op, until)
    if (isDbError(res)) { toast(humanizeError(res.message), 'danger'); return null }
    return res
  }, [setState])

  const onRowState = useCallback(async (it: ActionItem, op: ActionStateOp, until?: string) => {
    const res = await applyState([it.dedupeKey], op, until)
    if (!res) return
    if (op === 'snooze' && until) toast(`Snoozed until ${fmtUntil(until)}.`, 'success')
    else if (op === 'dismiss') toast('Dismissed.', 'success')
    else if (op === 'unsnooze') toast('Back in your queue.', 'success')
    else if (op === 'undismiss') toast('Restored to your queue.', 'success')
  }, [applyState])

  const runInline = useCallback(async (it: ActionItem, a: InlineAction) => {
    if (a.modal === 'access') { setAccessTarget({ item: it, kind: a.kind }); return }
    if (a.modal === 'reassign') { setReassignTarget(it); return }
    if (a.modal === 'reason') { setReasonTarget({ item: it, action: a }); return }
    if (a.modal === 'confirm') {
      const ok = await uiConfirm(CONFIRM_COPY[a.kind] ?? `${a.label} — ${it.title}?`, { title: a.label, confirmText: a.confirmText ?? a.label })
      if (!ok) return
    }
    const res = await runInlineAction(it, a.kind, {})
    if (!res.ok) { toast(humanizeError(res.message), 'danger'); return }
    toast(res.message ?? 'Done.', 'success')
    await refresh()
  }, [refresh])

  /* ── Filtering + sectioning ── */

  const filtered = useMemo(() => {
    let out = items
    if (typeFilter) out = out.filter((it) => (typeFilter.types as readonly string[]).includes(it.sourceType))
    if (statusFilter) out = out.filter((it) => STATUS_FILTERS[statusFilter].test(it, today))
    if (bureauFilter) out = out.filter((it) => it.bureau === bureauFilter)
    return out
  }, [items, typeFilter, statusFilter, bureauFilter, today])

  const sections = useMemo(() => {
    const buckets = EMPTY_SECTIONS()
    for (const it of filtered) buckets[sectionOf(it)].push(it)
    return buckets
  }, [filtered])

  /** Lanes the active preset / view keeps (null = all). */
  const laneSet = useMemo(() => (activeConfig?.sections ? new Set<SectionKey>(activeConfig.sections) : null), [activeConfig])
  const laneOn = useCallback((k: SectionKey) => !laneSet || laneSet.has(k), [laneSet])

  /** What is actually on screen, in reading order — the Ctrl/⌘+A set and the
   *  Shift+click range space. */
  const rendered = useMemo(() => {
    const out: ActionItem[] = []
    for (const s of SECTION_ORDER) if (laneOn(s.key)) out.push(...sections[s.key])
    if (laneOn('activity')) out.push(...sections.activity)
    return out
  }, [sections, laneOn])
  const renderedKeys = useMemo(() => rendered.map((it) => it.dedupeKey), [rendered])
  const selectedItems = useMemo(() => rendered.filter((it) => selected.has(it.dedupeKey)), [rendered, selected])

  /* ── Selection ── */

  const isSelected = useCallback((it: ActionItem) => selected.has(it.dedupeKey), [selected])
  const clearSelection = useCallback(() => { setSelected(new Set()); lastPick.current = null }, [])
  const selectAll = useCallback(() => setSelected(new Set(renderedKeys)), [renderedKeys])

  const onSelect = useCallback((it: ActionItem, range: boolean) => {
    const key = it.dedupeKey
    const next = new Set(selected)
    const anchor = lastPick.current
    const a = anchor ? renderedKeys.indexOf(anchor) : -1
    const b = renderedKeys.indexOf(key)
    if (range && a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      for (let i = lo; i <= hi; i++) next.add(renderedKeys[i])
    } else if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    lastPick.current = key
    setSelected(next)
  }, [selected, renderedKeys])

  /** Ctrl/⌘+A inside the queue selects the rendered rows; Escape clears.
   *  Text controls keep their native behaviour. */
  const onQueueKey = useCallback((e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement
    const editable = t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
      || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox')
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'a' && !editable) {
      e.preventDefault()
      selectAll()
    } else if (e.key === 'Escape' && selected.size) {
      clearSelection()
    }
  }, [selectAll, clearSelection, selected.size])

  /* ── Bulk actions (never a decision) ── */

  const bulkMarkRead = useCallback(async (list: ActionItem[]) => {
    const ids = new Set<string>()
    for (const it of list) {
      for (const id of notificationIdsOf(it)) ids.add(id)
      if (it.dedupeKey.startsWith('notif:')) ids.add(it.sourceId)
    }
    const err = await markRead([...ids])
    if (err) { toast(humanizeError(err.message), 'danger'); return }
    toast(`Marked ${list.length} read.`, 'success')
    clearSelection()
    await refresh()
  }, [clearSelection, refresh])

  const bulkSnooze = useCallback(async (list: ActionItem[], until: string) => {
    const res = await applyState(list.map((it) => it.dedupeKey), 'snooze', until)
    if (!res) return
    toast(`Snoozed ${res.applied} item${res.applied === 1 ? '' : 's'} until ${fmtUntil(until)}.`, 'success')
    clearSelection()
  }, [applyState, clearSelection])

  const bulkDismiss = useCallback(async (list: ActionItem[]) => {
    // The bar hands over the dismissable subset; name what stayed behind.
    const skippedLocal = selectedItems.filter((it) => !isDismissable(it.dedupeKey))
    const res = await applyState(list.map((it) => it.dedupeKey), 'dismiss')
    if (!res) return
    const skippedKeys = new Set([...skippedLocal.map((it) => it.dedupeKey), ...res.skipped])
    if (skippedKeys.size) {
      const names = rendered.filter((it) => skippedKeys.has(it.dedupeKey)).map((it) => it.title)
      const shown = names.slice(0, 3).join(', ')
      toast(`Kept ${skippedKeys.size} that can’t be dismissed (decisions and assigned work)${shown ? `: ${shown}${names.length > 3 ? '…' : ''}` : ''}. Snooze them instead.`, 'warn')
    }
    if (res.applied) toast(`Dismissed ${res.applied}.`, 'success')
    clearSelection()
  }, [applyState, clearSelection, selectedItems, rendered])

  /* ── Metrics count the FULL visible queue (never the filtered slice) ── */

  const localCounts = useMemo(() => {
    let needsNow = 0, dueToday = 0, waiting = 0, returnsMentions = 0
    for (const it of items) {
      if (it.status === 'needs_action' || it.status === 'overdue' || it.status === 'due_soon' || it.status === 'returned') needsNow++
      if (it.dueAt && it.dueAt.slice(0, 10) === today) dueToday++
      if (it.status === 'waiting') waiting++
      if (it.status === 'returned' || it.sourceType === 'mention' || it.sourceType === 'handover') returnsMentions++
    }
    return { needsNow, dueToday, waiting, returnsMentions }
  }, [items, today])

  const metrics = useMemo<Metric[]>(() => {
    const m: Metric[] = [
      { label: 'Needs action now', value: localCounts.needsNow, onClick: () => setParam('s', null) },
      { label: 'Due today', value: localCounts.dueToday, tint: localCounts.dueToday > 0 ? 'bg-amber-500/15 text-amber-300' : undefined, onClick: () => setParam('s', 'due') },
      { label: 'Overdue', value: counts.overdue, tint: counts.overdue > 0 ? 'bg-rose-500/15 text-rose-300' : undefined, onClick: () => setParam('s', 'overdue') },
      { label: 'Escalated', value: counts.escalated, tint: counts.escalated > 0 ? 'bg-rose-500/15 text-rose-300' : undefined, onClick: () => setParam('s', 'escalated') },
      { label: 'Waiting on others', value: localCounts.waiting, onClick: () => setParam('s', 'waiting') },
    ]
    if (isCommand) m.push({ label: 'Command decisions', value: counts.command, onClick: () => setParam('s', 'command') })
    m.push({ label: 'Unread returns & mentions', value: localCounts.returnsMentions, onClick: () => setParam('s', 'returns') })
    return m
  }, [localCounts, counts.overdue, counts.escalated, counts.command, isCommand, setParam])

  if (state !== 'in') return <Notice text="Sign in to view your Action Center." />

  const hasFilter = !!typeFilter || !!statusFilter || !!bureauFilter
  const showEmpty = !loading && (error == null || items.length > 0) && filtered.length === 0
  // With the full queue on screen, empty lanes explain themselves; filtered
  // views (and the all-caught-up state) hide them instead.
  const explainEmpties = !hasFilter && filtered.length > 0
  const gates: Record<'isCommand' | 'canEdit', boolean> = { isCommand, canEdit }
  const currentConfig: ActionViewConfig = { f: fParam, s: statusFilter, b: bParam, sections: activeConfig?.sections ?? null, showSnoozed: activeConfig?.showSnoozed ?? false }
  const h: RowHandlers = { now, narrow, actionsFor, isSelected, onSelect, onOpen, onAction: runInline, onState: onRowState }

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

          <div className="space-y-2">
            {/* Chips scroll sideways on phones instead of wrapping into a wall. */}
            <div
              className={`flex items-center gap-1.5 ${narrow ? '-mx-4 flex-nowrap overflow-x-auto px-4 pb-1 [scrollbar-width:thin]' : 'flex-wrap'}`}
              role="group"
              aria-label="Queue filters"
            >
              <FilterChip active={!typeFilter} onClick={() => setParam('f', null)}>All</FilterChip>
              {typeFilters.map((t) => (
                <FilterChip
                  key={t.key}
                  active={typeFilter?.key === t.key}
                  title={t.types.map((k) => SOURCE_TYPE_LABEL[k]).join(' · ')}
                  onClick={() => setParam('f', typeFilter?.key === t.key ? null : t.key)}
                >
                  {t.label}
                </FilterChip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <ViewsMenu
                viewer={presetViewer}
                sv={sv}
                activePreset={activePreset?.id ?? null}
                activeView={activeView?.name ?? null}
                currentConfig={currentConfig}
                onSelect={selectView}
              />
              <span className="ml-auto flex items-center gap-1.5">
                {statusFilter && (
                  <button
                    type="button"
                    aria-pressed
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
          </div>

          {showEmpty && (hasFilter ? (
            <EmptyState
              title="No items match this filter."
              hint="Clear the filters to see the full queue."
              action={{ label: 'Clear filters', onClick: clearFilters }}
            />
          ) : (
            <EmptyState
              icon={<CheckIcon size={22} />}
              title="You're all caught up."
              hint={snoozed.length
                ? `Nothing needs your action right now — ${snoozed.length} snoozed item${snoozed.length === 1 ? '' : 's'} will come back later.`
                : 'Nothing needs your action right now. My Dashboard keeps the broader overview of your cases, drafts and watched items.'}
              action={{ label: 'Open My Dashboard', onClick: () => router.push('/dashboard') }}
            />
          ))}

          {/* The queue proper: keyboard selection scope + the sticky bulk bar. */}
          <div onKeyDown={onQueueKey} className="space-y-5">
            {/* Wide screens: the Overdue lane stays full-width on top, the rest
                flow into two columns (My Dashboard's grid idiom). Source order and
                section semantics are untouched — layout only. */}
            <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
              {SECTION_ORDER.filter((s) => laneOn(s.key)).map(({ key, title, subtitle, empty, gate }) => (
                <QueueSection
                  key={key}
                  id={key}
                  title={title}
                  subtitle={subtitle}
                  emptyText={empty}
                  showWhenEmpty={explainEmpties && (!gate || gates[gate])}
                  items={sections[key]}
                  muted={key === 'waiting' || key === 'drafts'}
                  h={h}
                  className={key === 'overdue' ? 'xl:col-span-2' : undefined}
                />
              ))}
            </div>

            {(activityOpen || (laneOn('activity') && sections.activity.length > 0)) && (
              <details id="ac-lane-activity" open={activityOpen || undefined}>
                <summary className="flex min-h-[44px] cursor-pointer items-center rounded text-[13px] font-semibold text-white transition hover:text-slate-300 lg:min-h-0">
                  <h2 className="inline">Recent activity ({sections.activity.length})</h2>
                </summary>
                <p className="mb-2 mt-0.5 text-xs text-slate-400">Notifications and informational items — the bell shows the latest few; the full history is here.</p>
                <div className="mt-2">
                  {sections.activity.length
                    ? <RowList items={sections.activity} muted h={h} />
                    : <EmptyState title="No recent activity." />}
                </div>
              </details>
            )}

            <HiddenLane lane="snoozed" items={snoozed} open={activeConfig?.showSnoozed} h={h} />
            <HiddenLane lane="dismissed" items={dismissed} h={h} />

            <BulkBar
              selected={selectedItems}
              visibleCount={rendered.length}
              onClear={clearSelection}
              onSelectAll={selectAll}
              onMarkRead={bulkMarkRead}
              onSnooze={bulkSnooze}
              onDismiss={bulkDismiss}
            />
          </div>
        </>
      )}

      <p className="text-xs text-slate-400">
        <Link href="/dashboard" className="rounded font-semibold text-badge-200 transition hover:text-white">My Dashboard</Link>
        {' '}keeps the broader overview — your cases, drafts, open workspace tabs and watched items.
        {suppressedCount > 0 && <> {suppressedCount} low-signal notification{suppressedCount === 1 ? ' was' : 's were'} folded into the items above.</>}
        {' '}Select rows to mark read, snooze or dismiss several at once (Shift+click for a range, Ctrl/⌘+A for all).
      </p>

      <ReasonModal
        key={reasonTarget ? `${reasonTarget.action.kind}:${reasonTarget.item.id}` : 'none'}
        target={reasonTarget}
        onClose={() => setReasonTarget(null)}
        onDone={() => void refresh()}
      />
      <AccessDecisionModal
        key={accessTarget ? `${accessTarget.kind}:${accessTarget.item.id}` : 'none'}
        target={accessTarget}
        onClose={() => setAccessTarget(null)}
        onDecided={() => void refresh()}
      />
      <ReassignDialog
        key={reassignTarget?.id ?? 'none'}
        item={reassignTarget}
        onClose={() => setReassignTarget(null)}
        onDone={() => void refresh()}
      />
    </section>
  )
}
