'use client'

/** Photos & Media — the case's canonical visual record, backed by the `media`
 *  table (typed FK columns, category, featured, archived_at). Replaces the
 *  frozen Evidence tab: category pills filter INSIDE the tab, cards open a
 *  focus-trapped detail lightbox (same Modal engine as the vault), and "Add
 *  photos" reuses the MediaView FiveManage upload machinery (multi-file, edit
 *  metadata after upload). Archive never deletes — archived_at only; hard
 *  delete stays command-only via the shared delete/undo path. The three
 *  frozen legacy `evidence` rows render read-only at the bottom (writes are
 *  revoked server-side; custody UI is gone — the table never held a row). */
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { Json, Tables } from '@/lib/database.types'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { uiPrompt } from '@/components/ui/dialog'
import { deleteWithUndo, insert, list, rpc, update } from '@/lib/db'
import { caseLink } from '@/lib/caseLinks'
import { CASE_MEDIA_CATEGORIES, caseMediaCategoryLabel, filterCaseMedia, legacyEvidenceRef } from '@/lib/caseMedia'
import { fmConfigured, fmUpload } from '@/lib/fivemanage'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { reportTitle } from '@/lib/forms'
import { parseFormValues } from '@/lib/jsonShapes'
import { useAuth } from '@/lib/auth'
import { officerName } from '@/lib/profiles'
import { useNow } from '@/lib/useNow'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { mutateThen, type CaseRow, type EvidenceRow, type MediaRow } from './shared'

const PAGE = 24
const FETCH_STEP = PAGE * 4

// Local slim shapes (projected selects return partial rows).
interface ReportLite { id: string; template: string; kind: string | null; seq: number | null }
interface VehicleLite { id: string; plate: string }
interface NameMaps { persons: Map<string, string>; gangs: Map<string, string>; places: Map<string, string>; narcotics: Map<string, string> }

const EMPTY_NAMES: NameMaps = { persons: new Map(), gangs: new Map(), places: new Map(), narcotics: new Map() }

type GrantRow = Tables<'restricted_access_grants'>

/** Live = decided 'granted', unrevoked, unexpired — mirrors the server's
 *  has_media_break_glass predicate (cosmetic; RLS is the real gate). */
const grantIsLive = (g: GrantRow, nowMs: number) =>
  g.status === 'granted' && !g.revoked_at && new Date(g.expires_at).getTime() > nowMs

const mediaSrc = (m: MediaRow) => m.external_url || m.storage_path || ''
const tagsOf = (m: MediaRow): Record<string, unknown> => parseFormValues(m.tags)
const tagStr = (m: MediaRow, key: string): string | null => {
  const v = tagsOf(m)[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function MediaTab({ c, canEdit, canDelete, holdActive = false }: { c: CaseRow; canEdit: boolean; canDelete: boolean; holdActive?: boolean }) {
  const { profile, isCommand } = useAuth()
  const [rows, setRows] = useState<MediaRow[]>([])
  const [evidence, setEvidence] = useState<EvidenceRow[]>([])
  const [reports, setReports] = useState<ReportLite[]>([])
  const [vehicles, setVehicles] = useState<VehicleLite[]>([])
  const [names, setNames] = useState<NameMaps>(EMPTY_NAMES)
  const [category, setCategory] = useState('all')
  const [showArchived, setShowArchived] = useState(false)
  const [page, setPage] = useState(1)
  const [fetchLimit, setFetchLimit] = useState(FETCH_STEP)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  // First-load gate: the gallery must not flash "No case photos yet" before
  // the initial fetch resolves, and a failed load must say so (BUG-027).
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  // Restricted media (Phase 6): the total restricted count in this case
  // (server-computed, gated on can_access_case) tells us whether there are
  // restricted items the current viewer can't see — the delta drives the
  // request-access offer. Grants carry the request → decision lifecycle.
  const [restrictedCount, setRestrictedCount] = useState(0)
  const [requestOpen, setRequestOpen] = useState(false)
  const [grants, setGrants] = useState<GrantRow[]>([])
  const vM = useTableVersion('media')
  const vG = useTableVersion('restricted_access_grants')

  const refresh = useCallback(async () => {
    try {
      const [m, ev, rp, vh] = await Promise.all([
        // Bounded metadata load — Load more raises the cap; images lazy-load.
        list('media', { eq: { case_id: c.id }, order: 'created_at', ascending: false, limit: fetchLimit }),
        list('evidence', { eq: { case_id: c.id }, order: 'created_at', ascending: false }).catch(() => [] as EvidenceRow[]),
        list('reports', { select: 'id,template,kind,seq', eq: { case_id: c.id }, order: 'created_at' })
          .then((r) => r as unknown as ReportLite[]).catch(() => [] as ReportLite[]),
        list('vehicles', { select: 'id,plate', order: 'plate' })
          .then((r) => r as unknown as VehicleLite[]).catch(() => [] as VehicleLite[]),
      ])
      setRows(m)
      setEvidence(ev)
      setReports(rp)
      setVehicles(vh)
      setLoadError(false)
      // Best-effort: how many restricted items exist here vs. how many the
      // viewer can actually load. A positive delta means some are hidden.
      void rpc('restricted_media_count', { p_case: c.id })
        .then((r) => setRestrictedCount(typeof r.data === 'number' ? r.data : 0))
        .catch(() => setRestrictedCount(0))
    } catch { setLoadError(true) /* loaded rows keep rendering stale */ }
    finally { setLoading(false) }
  }, [c.id, fetchLimit])
  // A grant decision flips restricted-media visibility, so grant bumps
  // refetch the gallery too.
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vM, vG])

  // One RLS-scoped read drives both restricted-access surfaces: command sees
  // every grant row on the case; a member sees only their own (rag_sel).
  const refreshGrants = useCallback(async () => {
    try {
      setGrants(await list('restricted_access_grants', { eq: { case_id: c.id }, order: 'granted_at', ascending: false }))
    } catch { setGrants([]) }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refreshGrants() }) }, [refreshGrants, vG])

  // Resolve linked-entity names for chips — bounded `in` lookups over the ids
  // the loaded rows actually reference. Best-effort; a miss just hides a chip.
  useEffect(() => {
    let alive = true
    void (async () => {
      const ids = (k: 'person_id' | 'gang_id' | 'place_id' | 'narcotic_id') =>
        [...new Set(rows.map((m) => m[k]).filter((x): x is string => !!x))]
      const pid = ids('person_id'), gid = ids('gang_id'), plid = ids('place_id'), nid = ids('narcotic_id')
      const slim = (r: unknown[]) => new Map((r as { id: string; name: string | null }[]).map((x) => [x.id, x.name || '—']))
      const [p, g, pl, n] = await Promise.all([
        pid.length ? list('persons', { select: 'id,name', in: { id: pid } }).catch(() => []) : Promise.resolve([]),
        gid.length ? list('gangs', { select: 'id,name', in: { id: gid } }).catch(() => []) : Promise.resolve([]),
        plid.length ? list('places', { select: 'id,name', in: { id: plid } }).catch(() => []) : Promise.resolve([]),
        nid.length ? list('narcotics', { select: 'id,name', in: { id: nid } }).catch(() => []) : Promise.resolve([]),
      ])
      if (alive) setNames({ persons: slim(p), gangs: slim(g), places: slim(pl), narcotics: slim(n) })
    })()
    return () => { alive = false }
  }, [rows])

  // Legacy ?evidence= deep links: open the collapsed legacy section and
  // highlight the referenced line (scroll once; focus never moves).
  const sp = useSearchParams()
  const evParam = sp.get('evidence')
  const legacyRefs = useRef<Record<string, HTMLElement | null>>({})
  const scrolledRef = useRef<string | null>(null)
  useEffect(() => {
    if (!evParam || scrolledRef.current === evParam) return
    const el = legacyRefs.current[evParam]
    if (!el) return
    scrolledRef.current = evParam
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [evParam, evidence])

  // Restricted items the viewer can't load → offer a request (Phase 6).
  const visibleRestricted = rows.filter((m) => m.restricted).length
  const hiddenRestricted = Math.max(0, restrictedCount - visibleRestricted)

  // My grant lifecycle: a pending request or a live grant hides the request
  // button; the newest denied/revoked row explains itself and re-opens it.
  // (useNow keeps render pure; realtime/refresh cycles re-mount fresh data.)
  const nowMs = useNow()
  const me = profile?.id ?? null
  const mine = me ? grants.filter((g) => g.user_id === me) : [] // granted_at desc
  const myPending = mine.find((g) => g.status === 'pending') ?? null
  const myLive = mine.find((g) => grantIsLive(g, nowMs)) ?? null
  const myLatest = mine[0] ?? null
  // Command panel inputs (RLS already hands non-command members only their
  // own rows, so these stay empty for them anyway — the gate is cosmetic).
  const pendingRequests = grants.filter((g) => g.status === 'pending' && g.user_id !== me)
  const liveGrants = grants.filter((g) => grantIsLive(g, nowMs))

  const decide = async (g: GrantRow, decision: 'grant' | 'deny') => {
    let note: string | undefined
    if (decision === 'deny') {
      const v = await uiPrompt('A note is required — the requester sees it with the denial.', {
        title: 'Deny restricted access',
        placeholder: 'e.g. Not needed for your current assignment — coordinate with the case lead.',
        confirmText: 'Deny request',
      })
      if (v === null) return
      if (!v.trim()) { toast('A note is required to deny a request.', 'warn'); return }
      note = v.trim()
    }
    const res = await rpc('restricted_media_decide_access', { p_grant: g.id, p_decision: decision, ...(note ? { p_note: note } : {}) })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(decision === 'grant' ? 'Access granted — the 24-hour clock starts now.' : 'Request denied.', 'success')
    void refreshGrants()
  }
  const revoke = async (g: GrantRow) => {
    const v = await uiPrompt('A reason is required — it is logged and sent to the holder.', {
      title: `Revoke access — ${officerName(g.user_id) || 'officer'}`,
      confirmText: 'Revoke access',
    })
    if (v === null) return
    if (!v.trim()) { toast('A reason is required to revoke a grant.', 'warn'); return }
    const res = await rpc('restricted_media_revoke_access', { p_grant: g.id, p_reason: v.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Access revoked.', 'success')
    void refreshGrants()
  }

  const filtered = filterCaseMedia(rows, { category, showArchived })
  const visible = filtered.slice(0, PAGE * page)
  const hasMore = filtered.length > visible.length || rows.length >= fetchLimit
  const loadMore = () => {
    setPage((p) => p + 1)
    if (rows.length >= fetchLimit) setFetchLimit((f) => f + FETCH_STEP)
  }
  const pickCategory = (next: string) => { setCategory(next); setPage(1) }

  const detail = detailId ? rows.find((m) => m.id === detailId) ?? null : null
  const reportLabel = (id: string | null) => {
    if (!id) return null
    const r = reports.find((x) => x.id === id)
    return r ? reportTitle(r) : 'Report'
  }

  return (
    <div className="space-y-4">
      {/* Category pills (scrollable on mobile) + archived toggle + primary add */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 flex min-w-0 flex-1 gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Filter by category">
          {[{ id: 'all', label: 'All' }, ...CASE_MEDIA_CATEGORIES].map((cat) => (
            <button
              key={cat.id}
              onClick={() => pickCategory(cat.id)}
              aria-pressed={category === cat.id}
              className={`flex-shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition ${category === cat.id ? 'border-badge-500 bg-blue-500/10 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
            >
              {cat.label}
            </button>
          ))}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            onClick={() => { setShowArchived((v) => !v); setPage(1) }}
            aria-pressed={showArchived}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${showArchived ? 'border-amber-400/40 bg-amber-500/10 text-amber-200' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
          >
            Archived
          </button>
          {canEdit && <Button variant="primary" onClick={() => setAddOpen(true)}>＋ Add photos</Button>}
        </div>
      </div>

      {/* Restricted access (Phase 6): request → Lead decision → 24h grant.
          A live grant makes the hidden items visible (hiddenRestricted drops
          to 0), so its countdown banner renders on its own branch. */}
      {myLive ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] px-4 py-3">
          <span aria-hidden className="text-lg">🔓</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-emerald-100">Temporary restricted access active</p>
            <p className="text-xs text-emerald-200/70">
              Granted by {officerName(myLive.decided_by) || 'command'} — every view and download is logged.
            </p>
          </div>
          <DeadlineChip at={myLive.expires_at} kind="expires" />
        </div>
      ) : hiddenRestricted > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-400/30 bg-rose-500/[0.07] px-4 py-3">
          <span aria-hidden className="text-lg">🔒</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-rose-100">
              {hiddenRestricted} restricted {hiddenRestricted === 1 ? 'item is' : 'items are'} hidden
            </p>
            <p className="text-xs text-rose-200/70">
              Restricted media is limited to cleared members. A Bureau Lead can approve a 24-hour view grant — every access is logged.
            </p>
          </div>
          {myPending ? (
            <Badge tint="bg-amber-500/15 text-amber-300">Awaiting command approval</Badge>
          ) : (
            <Button size="sm" variant="warn" onClick={() => setRequestOpen(true)}>Request restricted access</Button>
          )}
          {!myPending && myLatest?.status === 'denied' && (
            <p className="w-full text-xs text-rose-200/80">
              Your last request was denied{myLatest.decision_note ? ` — “${myLatest.decision_note}”` : ''}. You can submit a new request.
            </p>
          )}
          {!myPending && myLatest?.status === 'revoked' && (
            <p className="w-full text-xs text-rose-200/80">
              Your access was revoked{myLatest.revoke_reason ? ` — “${myLatest.revoke_reason}”` : ''}. You can submit a new request.
            </p>
          )}
        </div>
      ) : null}

      {/* Command decision panel — pending requests + live grants (rag_sel
          gives command every row; the isCommand gate mirrors the server's). */}
      {isCommand && (pendingRequests.length > 0 || liveGrants.length > 0) && (
        <section aria-label="Restricted access — command decisions" className="space-y-2 rounded-xl border border-white/10 bg-ink-950/50 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Restricted access — command</h3>
          {pendingRequests.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/20 bg-amber-500/[0.05] px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">
                  {officerName(g.user_id) || 'Officer'}{' '}
                  <span className="font-normal text-slate-400">requested access · {fmtDateTime(g.granted_at)}</span>
                </p>
                <p className="text-xs text-slate-300">{g.reason}</p>
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <Button size="sm" variant="success" onAction={() => decide(g, 'grant')}>Grant 24h</Button>
                <Button size="sm" variant="danger" onAction={() => decide(g, 'deny')}>Deny…</Button>
              </div>
            </div>
          ))}
          {liveGrants.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-200">
                  <span className="font-semibold text-white">{officerName(g.user_id) || 'Officer'}</span> holds temporary access{' '}
                  <DeadlineChip at={g.expires_at} kind="expires" />
                </p>
                <p className="text-xs text-slate-400">
                  Granted by {officerName(g.decided_by) || 'command'}
                  {g.reason ? ` · ${g.reason}` : ''}
                </p>
              </div>
              <Button size="sm" variant="danger" onAction={() => revoke(g)}>Revoke…</Button>
            </div>
          ))}
        </section>
      )}

      {/* Gallery grid — cards are buttons (keyboard-navigable), lazy images. */}
      {loading ? (
        <Notice text="Loading case media…" />
      ) : !rows.length && loadError ? (
        <ErrorNotice message="Could not load case media." onRetry={() => { void refresh() }} />
      ) : visible.length ? (
        <>
          <ul className="grid list-none grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((m) => (
              <li key={m.id} className="min-w-0">
                <MediaCard m={m} names={names} vehicles={vehicles} reportLabel={reportLabel} onOpen={() => setDetailId(m.id)} />
              </li>
            ))}
          </ul>
          {hasMore && (
            <div className="flex justify-center">
              <Button onClick={loadMore}>Load more</Button>
            </div>
          )}
        </>
      ) : rows.length ? (
        <p className="rounded-xl border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-400">
          No {showArchived ? '' : 'active '}media in this category.
        </p>
      ) : (
        <EmptyState
          icon="🖼️"
          title="No case photos yet"
          hint={canEdit ? 'Add scene shots, documents, surveillance stills — anything visual the case relies on.' : 'No photos or media have been added to this case yet.'}
          action={canEdit ? { label: '＋ Add photos', onClick: () => setAddOpen(true) } : undefined}
        />
      )}

      {/* Legacy evidence — frozen table, read-only list (server revokes writes). */}
      {evidence.length > 0 && (
        <details open={!!evParam} className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 hover:text-slate-300">
            Legacy evidence records ({evidence.length})
          </summary>
          <p className="mt-2 text-xs text-slate-400">Historical entries from the retired evidence log — read-only.</p>
          <ul className="mt-3 space-y-1.5">
            {evidence.map((ev) => (
              <li
                key={ev.id}
                ref={(el) => { legacyRefs.current[ev.id] = el }}
                className={`rounded-lg border px-3 py-2 text-sm ${ev.id === evParam ? 'border-badge-400/60 ring-1 ring-badge-400/40' : 'border-white/5 bg-white/[0.03]'}`}
              >
                <span className="font-mono font-bold text-badge-200">{ev.item_code || 'EV-?'}</span>{' '}
                <span className="text-slate-200">{ev.description || ev.type || 'Untitled item'}</span>
                <span className="block text-xs text-slate-400">
                  {fmtDate(ev.collected_at || ev.created_at)}
                  {officerName(ev.collected_by) ? ` · collected by ${officerName(ev.collected_by)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {detail && (
        <MediaDetailModal
          m={detail}
          c={c}
          canEdit={canEdit}
          canDelete={canDelete}
          holdActive={holdActive}
          names={names}
          vehicles={vehicles}
          reports={reports}
          onClose={() => setDetailId(null)}
          onChanged={() => void refresh()}
          onDeleted={() => { setDetailId(null); void refresh() }}
        />
      )}
      {addOpen && (
        <AddPhotosModal
          c={c}
          uploaderId={profile?.id ?? null}
          reports={reports}
          vehicles={vehicles}
          onClose={() => { setAddOpen(false); void refresh() }}
        />
      )}
      {requestOpen && (
        <RequestAccessModal
          c={c}
          hiddenCount={hiddenRestricted}
          onClose={() => setRequestOpen(false)}
          onRequested={() => { setRequestOpen(false); void refreshGrants() }}
        />
      )}
    </div>
  )
}

/* ── Restricted-access request (Phase 6) ─────────────────────────────────────
 * Accountable view-access to a case's restricted media for a member without
 * narcotics clearance: a mandatory reason, a Bureau Lead (or higher) decision,
 * and a 24h server-side grant from approval. Never edit — read-only widening. */

function RequestAccessModal({ c, hiddenCount, onClose, onRequested }: {
  c: CaseRow
  hiddenCount: number
  onClose: () => void
  onRequested: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const trimmed = reason.trim()
    if (!trimmed) { toast('A reason is required to request access.', 'warn'); return }
    setBusy(true)
    const res = await rpc('restricted_media_request_access', { p_case: c.id, p_reason: trimmed })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Request sent — a Bureau Lead must approve it.', 'success')
    onRequested()
  }

  return (
    <Modal open onClose={onClose} dirty={() => reason.trim().length > 0}>
      <div className="p-5">
        <ModalHeader title="Request restricted access" onClose={onClose} />
        <div className="mt-1 space-y-3">
          <p className="rounded-lg border border-rose-400/30 bg-rose-500/[0.07] p-3 text-sm text-rose-100">
            This case has {hiddenCount} restricted {hiddenCount === 1 ? 'item' : 'items'} you aren&apos;t cleared to view.
            A Bureau Lead (or higher) must approve your request; approval grants <strong>24-hour</strong> read-only
            access and your reason is permanently logged.
          </p>
          <Field label="Reason for access" hint="Required — this is recorded in the restricted-access audit trail.">
            {(id) => (
              <textarea
                id={id}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-badge-400 focus:outline-none"
                placeholder="e.g. Urgent lead review — surveillance stills needed to identify a suspect before an imminent operation."
              />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => void submit()} disabled={busy || !reason.trim()}>
              {busy ? 'Sending…' : 'Send request'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* ── Card ─────────────────────────────────────────────────────────────────── */

function typeGlyph(m: MediaRow): string {
  if (m.type === 'video') return '🎬'
  if (m.type === 'document') return '📄'
  return '📡'
}

function MediaCard({ m, names, vehicles, reportLabel, onOpen }: {
  m: MediaRow
  names: NameMaps
  vehicles: VehicleLite[]
  reportLabel: (id: string | null) => string | null
  onOpen: () => void
}) {
  const [imgFailed, setImgFailed] = useState(false)
  const safe = safeUrl(mediaSrc(m))
  const chips: string[] = []
  if (m.vehicle_id) { const v = vehicles.find((x) => x.id === m.vehicle_id); if (v) chips.push(`🚗 ${v.plate}`) }
  if (m.person_id && names.persons.get(m.person_id)) chips.push(`👤 ${names.persons.get(m.person_id)}`)
  if (m.gang_id && names.gangs.get(m.gang_id)) chips.push(`🏴 ${names.gangs.get(m.gang_id)}`)
  if (m.place_id && names.places.get(m.place_id)) chips.push(`📍 ${names.places.get(m.place_id)}`)
  if (m.narcotic_id && names.narcotics.get(m.narcotic_id)) chips.push(`💊 ${names.narcotics.get(m.narcotic_id)}`)
  const linkedReport = reportLabel(m.report_id)
  return (
    <button
      onClick={onOpen}
      className={`block w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-950/50 text-left transition hover:border-white/20 hover:bg-ink-950/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-400 ${m.archived_at ? 'opacity-70' : ''}`}
    >
      {m.type === 'image' && safe && !imgFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- external media URL
        <img src={safe} alt={m.title} loading="lazy" onError={() => setImgFailed(true)} className="h-36 w-full object-cover" />
      ) : (
        <span aria-hidden className="flex h-36 w-full items-center justify-center bg-ink-800 text-4xl">{typeGlyph(m)}</span>
      )}
      <span className="block p-3">
        <span className="block truncate text-sm font-semibold text-white">{m.title}</span>
        <span className="mt-0.5 block truncate text-xs text-slate-400">
          {caseMediaCategoryLabel(m.category)} · {fmtDate(m.created_at)}
          {officerName(m.uploaded_by) ? ` · ${officerName(m.uploaded_by)}` : ''}
        </span>
        {(linkedReport || m.restricted || m.featured || m.archived_at) && (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {linkedReport && <Badge tone="accent" title={linkedReport}>Report media</Badge>}
            {m.restricted && <Badge tone="danger">Restricted</Badge>}
            {m.featured && <Badge tone="warn">Featured</Badge>}
            {m.archived_at && <Badge tone="neutral">Archived</Badge>}
          </span>
        )}
        {chips.length > 0 && (
          <span className="mt-1.5 flex flex-wrap gap-1">
            {chips.map((chip) => (
              <span key={chip} className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">{chip}</span>
            ))}
          </span>
        )}
      </span>
    </button>
  )
}

/* ── Detail lightbox ──────────────────────────────────────────────────────── */

function MediaDetailModal({ m, c, canEdit, canDelete, holdActive, names, vehicles, reports, onClose, onChanged, onDeleted }: {
  m: MediaRow
  c: CaseRow
  canEdit: boolean
  canDelete: boolean
  holdActive: boolean
  names: NameMaps
  vehicles: VehicleLite[]
  reports: ReportLite[]
  onClose: () => void
  onChanged: () => void
  onDeleted: () => void
}) {
  const [title, setTitle] = useState(m.title)
  const [cat, setCat] = useState(m.category ?? '')
  // Dirty-tracking baseline: advances on save so a successful save doesn't
  // keep the discard-confirm armed while the parent list refetches.
  const [saved, setSaved] = useState<{ title: string; category: string | null }>({ title: m.title, category: m.category })
  // Audit every view of a restricted item (D6). Server de-dups per viewer/hour
  // and quietly ignores non-restricted ids, so this is safe to fire on open.
  useEffect(() => {
    if (m.restricted) void rpc('log_restricted_view', { p_entity_type: 'media', p_entity: m.id })
  }, [m.id, m.restricted])
  const src = mediaSrc(m)
  const safe = safeUrl(src)
  const isVid = m.type === 'video' || /\.(mp4|webm|mov|m4v)($|\?)/i.test(src)
  const isAud = /\.(mp3|wav|ogg|m4a)($|\?)/i.test(src)
  const legacy = legacyEvidenceRef(m.tags)
  const capturedAt = tagStr(m, 'captured_at')
  const sourceName = tagStr(m, 'source_filename') || m.kind
  const dirty = title.trim() !== saved.title || (cat || null) !== saved.category

  const saveDetails = async () => {
    if (!title.trim()) { toast('A title is required.', 'warn'); return }
    const res = await update('media', m.id, { title: title.trim(), category: cat || null })
    if (res.error) { toast(res.error.message, 'danger'); return }
    setSaved({ title: title.trim(), category: cat || null })
    toast('Details saved.', 'success')
    onChanged()
  }
  const setReport = (id: string) => mutateThen(update('media', m.id, { report_id: id || null }), onChanged)
  const setVehicle = (id: string) => mutateThen(update('media', m.id, { vehicle_id: id || null }), onChanged)
  const toggleFeatured = () => mutateThen(update('media', m.id, { featured: !m.featured }), onChanged)
  const toggleArchived = () =>
    mutateThen(update('media', m.id, { archived_at: m.archived_at ? null : new Date().toISOString() }), onChanged)

  const entityLines: [string, string][] = []
  if (m.vehicle_id) { const v = vehicles.find((x) => x.id === m.vehicle_id); if (v) entityLines.push(['Vehicle', v.plate]) }
  if (m.person_id) entityLines.push(['Person', names.persons.get(m.person_id) ?? '—'])
  if (m.gang_id) entityLines.push(['Gang', names.gangs.get(m.gang_id) ?? '—'])
  if (m.place_id) entityLines.push(['Place', names.places.get(m.place_id) ?? '—'])
  if (m.narcotic_id) entityLines.push(['Narcotic', names.narcotics.get(m.narcotic_id) ?? '—'])
  const linkedReport = m.report_id ? reports.find((r) => r.id === m.report_id) ?? null : null

  return (
    <Modal open onClose={onClose} wide dirty={() => dirty}>
      <div className="p-5">
        <ModalHeader title={m.title} onClose={onClose} />
        {!safe ? (
          <div aria-hidden className="flex h-64 items-center justify-center rounded-lg bg-ink-800 text-5xl">{typeGlyph(m)}</div>
        ) : m.type === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element -- external media URL
          <img src={safe} alt={m.title} className="max-h-[55vh] w-full rounded-lg bg-black object-contain" />
        ) : isVid ? (
          <video src={safe} controls playsInline className="max-h-[55vh] w-full rounded-lg bg-black" />
        ) : isAud ? (
          <div className="rounded-lg bg-ink-800 p-6"><audio src={safe} controls className="w-full" /></div>
        ) : (
          <div className="flex h-40 items-center justify-center rounded-lg bg-ink-800 text-5xl" aria-hidden>{typeGlyph(m)}</div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            {canEdit ? (
              <>
                <Field label="Caption / title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
                <Field label="Category">
                  {(id) => (
                    <Select id={id} value={cat} onChange={(e) => setCat(e.target.value)}>
                      <option value="">Uncategorized</option>
                      {CASE_MEDIA_CATEGORIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </Select>
                  )}
                </Field>
                {dirty && <Button size="sm" variant="primary" onClick={() => void saveDetails()}>Save details</Button>}
                <Field label="Linked report" hint={linkedReport ? undefined : 'One report per photo — set from here or from the report editor.'}>
                  {(id) => (
                    <Select id={id} value={m.report_id ?? ''} onChange={(e) => setReport(e.target.value)}>
                      <option value="">— none —</option>
                      {reports.map((r) => <option key={r.id} value={r.id}>{reportTitle(r)}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Linked vehicle">
                  {(id) => (
                    <Select id={id} value={m.vehicle_id ?? ''} onChange={(e) => setVehicle(e.target.value)}>
                      <option value="">— none —</option>
                      {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
                    </Select>
                  )}
                </Field>
              </>
            ) : (
              <dl className="space-y-2 text-sm">
                <MetaRow k="Category" v={caseMediaCategoryLabel(m.category)} />
                {linkedReport && <MetaRow k="Linked report" v={reportTitle(linkedReport)} />}
              </dl>
            )}
          </div>
          <dl className="space-y-2 text-sm">
            <MetaRow k="Case" v={c.case_number} />
            <MetaRow k="Uploaded" v={`${fmtDateTime(m.created_at)}${officerName(m.uploaded_by) ? ` · ${officerName(m.uploaded_by)}` : ''}`} />
            {capturedAt && <MetaRow k="Captured" v={capturedAt} />}
            {sourceName && <MetaRow k="Source" v={sourceName} />}
            {entityLines.map(([k, v]) => <MetaRow key={k} k={k} v={v} />)}
            <MetaRow k="Classification" v={m.restricted ? 'Restricted — narcotics command only' : 'Standard'} />
            {legacy && <MetaRow k="Provenance" v={`Migrated from evidence ${legacy}`} muted />}
          </dl>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
          {linkedReport && (
            <Link href={caseLink(c.id, 'reports', { report: linkedReport.id })} className="rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-badge-200 hover:bg-white/5">
              Open report
            </Link>
          )}
          {safe && (
            <a
              href={safe}
              target="_blank"
              rel="noopener noreferrer"
              // Opening the original is download-grade egress for a restricted
              // item — audit it as such (fire-and-forget; server de-dups/hour).
              onClick={() => { if (m.restricted) void rpc('log_restricted_view', { p_entity_type: 'media', p_entity: m.id, p_action: 'download' }) }}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm font-bold text-badge-200 hover:bg-white/5"
            >
              Open original ↗
            </a>
          )}
          <span className="flex-1" />
          {canEdit && (
            <Button size="sm" onClick={toggleFeatured}>{m.featured ? '★ Unfeature' : '☆ Feature'}</Button>
          )}
          {canEdit && (
            <Button size="sm" variant={m.archived_at ? 'success' : 'warn'} onClick={toggleArchived}>
              {m.archived_at ? 'Restore' : 'Archive'}
            </Button>
          )}
          {canDelete && (holdActive ? (
            <span title="A legal hold preserves this case's media" className="rounded-lg border border-rose-400/20 px-3 py-2 text-sm font-bold text-rose-300/50">
              Delete — blocked by legal hold
            </span>
          ) : (
            <button
              onClick={() => { void deleteWithUndo('media', m, { label: m.title, after: onDeleted }) }}
              className="rounded-lg border border-rose-400/30 px-3 py-2 text-sm font-bold text-rose-300 hover:bg-rose-500/10"
            >
              Delete
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function MetaRow({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="flex-shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500">{k}</dt>
      <dd className={`min-w-0 text-right ${muted ? 'text-xs text-slate-400' : 'text-slate-200'}`}>{v}</dd>
    </div>
  )
}

/* ── Add photos (multi-file FiveManage upload) ───────────────────────────────
 * ONE primary action: pick files, each uploads to FiveManage and lands as a
 * media row immediately (current case, current user, now, original filename
 * as the title fallback + kept in tags.source_filename). Category/caption/
 * links are edited AFTER upload — inline here per file, or later from the
 * detail view. Paste-a-URL fallback covers the unconfigured-key case and
 * external clips. */

interface UploadedItem { row: MediaRow; caption: string; category: string; reportId: string; vehicleId: string; saved: boolean }

function AddPhotosModal({ c, uploaderId, reports, vehicles, onClose }: {
  c: CaseRow
  uploaderId: string | null
  reports: ReportLite[]
  vehicles: VehicleLite[]
  onClose: () => void
}) {
  const [items, setItems] = useState<UploadedItem[]>([])
  const [pending, setPending] = useState(0)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkTitle, setLinkTitle] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const insertRow = async (title: string, type: MediaRow['type'], url: string, sourceFilename?: string) => {
    const res = await insert('media', {
      case_id: c.id,
      title,
      type,
      external_url: url,
      uploaded_by: uploaderId,
      tags: (sourceFilename ? { source_filename: sourceFilename } : {}) as Json,
    })
    if (res.error || !res.data?.[0]) throw new Error(res.error?.message || 'Insert failed')
    return res.data[0]
  }

  const uploadFiles = async (files: File[]) => {
    setPending((n) => n + files.length)
    for (const file of files) {
      try {
        const out = await fmUpload(file)
        const type: MediaRow['type'] = out.kind === 'video' ? 'video' : out.kind === 'audio' ? 'fivemanage' : 'image'
        const row = await insertRow(file.name.replace(/\.[a-z0-9]+$/i, '') || file.name, type, out.url, file.name)
        setItems((xs) => [...xs, { row, caption: row.title, category: '', reportId: '', vehicleId: '', saved: false }])
      } catch (e) {
        toast(`${file.name}: ${e instanceof Error ? e.message : String(e)}`, 'danger')
      } finally {
        setPending((n) => n - 1)
      }
    }
  }

  const addLink = async () => {
    const url = safeUrl(linkUrl)
    if (!url) { toast('Enter a valid http(s) URL.', 'warn'); return }
    try {
      const row = await insertRow(linkTitle.trim() || url.replace(/^https?:\/\//, '').slice(0, 60), 'image', url)
      setItems((xs) => [...xs, { row, caption: row.title, category: '', reportId: '', vehicleId: '', saved: false }])
      setLinkUrl(''); setLinkTitle('')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'danger')
    }
  }

  const setItem = (id: string, patch: Partial<UploadedItem>) =>
    setItems((xs) => xs.map((x) => (x.row.id === id ? { ...x, ...patch, saved: false } : x)))

  const saveItem = async (item: UploadedItem) => {
    const res = await update('media', item.row.id, {
      title: item.caption.trim() || item.row.title,
      category: item.category || null,
      report_id: item.reportId || null,
      vehicle_id: item.vehicleId || null,
    })
    if (res.error) { toast(res.error.message, 'danger'); return }
    setItems((xs) => xs.map((x) => (x.row.id === item.row.id ? { ...x, saved: true } : x)))
  }

  return (
    <Modal open onClose={onClose} wide dirty={() => pending > 0 || items.some((x) => !x.saved)}>
      <div className="p-5">
        <ModalHeader title="Add photos" onClose={onClose} />
        {fmConfigured() ? (
          <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-6 text-center">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              className="hidden"
              onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) void uploadFiles(fs); e.target.value = '' }}
            />
            <Button variant="primary" onClick={() => fileRef.current?.click()} disabled={pending > 0}>
              {pending > 0 ? `Uploading ${pending}…` : '📤 Choose photos to upload'}
            </Button>
            <p className="mt-2 text-xs text-slate-400">Multiple files supported. Details are editable after upload — nothing to fill in first.</p>
          </div>
        ) : (
          <p className="rounded-lg bg-white/5 p-3 text-xs text-slate-400">
            File upload is not configured (NEXT_PUBLIC_FIVEMANAGE_API_KEY) — paste a hosted URL below instead.
          </p>
        )}

        <details className="mt-3" open={!fmConfigured()}>
          <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-300">Or paste a hosted URL</summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Field label="Title">{(id) => <Input id={id} value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="e.g. Dashcam still" />}</Field>
            <Field label="URL">{(id) => <Input id={id} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" className="font-mono text-xs" />}</Field>
            <div className="flex items-end"><Button onAction={addLink}>Add</Button></div>
          </div>
        </details>

        {items.length > 0 && (
          <div className="mt-4 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">Added to the case ({items.length})</h4>
            {items.map((item) => {
              const thumb = safeUrl(mediaSrc(item.row))
              return (
                <div key={item.row.id} className="flex gap-3 rounded-xl border border-white/10 bg-ink-950/50 p-3">
                  {item.row.type === 'image' && thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external media URL
                    <img src={thumb} alt={item.row.title} loading="lazy" className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span aria-hidden className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-ink-800 text-2xl">{typeGlyph(item.row)}</span>
                  )}
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                    <Field label="Caption">{(id) => <Input id={id} value={item.caption} onChange={(e) => setItem(item.row.id, { caption: e.target.value })} />}</Field>
                    <Field label="Category">
                      {(id) => (
                        <Select id={id} value={item.category} onChange={(e) => setItem(item.row.id, { category: e.target.value })}>
                          <option value="">Uncategorized</option>
                          {CASE_MEDIA_CATEGORIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                        </Select>
                      )}
                    </Field>
                    <Field label="Link report (optional)">
                      {(id) => (
                        <Select id={id} value={item.reportId} onChange={(e) => setItem(item.row.id, { reportId: e.target.value })}>
                          <option value="">— none —</option>
                          {reports.map((r) => <option key={r.id} value={r.id}>{reportTitle(r)}</option>)}
                        </Select>
                      )}
                    </Field>
                    <Field label="Link vehicle (optional)">
                      {(id) => (
                        <Select id={id} value={item.vehicleId} onChange={(e) => setItem(item.row.id, { vehicleId: e.target.value })}>
                          <option value="">— none —</option>
                          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate}</option>)}
                        </Select>
                      )}
                    </Field>
                    <div className="sm:col-span-2">
                      {item.saved
                        ? <p className="text-xs font-semibold text-emerald-300">Details saved.</p>
                        : <Button size="sm" onClick={() => void saveItem(item)}>Save details</Button>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-5 flex justify-end">
          <Button variant="primary" onClick={onClose} disabled={pending > 0}>Done</Button>
        </div>
      </div>
    </Modal>
  )
}
