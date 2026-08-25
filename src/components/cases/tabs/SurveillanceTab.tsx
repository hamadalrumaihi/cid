'use client'

/** Case Surveillance workspace — the portal side of SOP Title 7: authorization
 *  requests (surveillance_targets, lifecycle via SECURITY DEFINER RPCs only),
 *  the observation feed with detective verification, structured association
 *  events, §derived pattern analysis, rule-generated alerts and cross-case
 *  deconfliction stubs. Every authority check here is a cosmetic mirror
 *  (lib/surveillanceModel) — RLS and the RPCs re-decide server-side. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import type { Tables } from '@/lib/database.types'
import { insert, list, rpc } from '@/lib/db'
import { searchEntities, searchPersonHits, searchPlaceHits, searchVehicleHits, type EntityHit } from '@/lib/entitySearch'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import { fmtDateTime } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import {
  CONFIDENCE_LEVELS, SOURCE_TYPE_LABEL, TARGET_STATUS_LABEL, TARGET_TYPES,
  VERIFICATION_LABEL, VERIFICATION_TINT,
  canAuthorizeSurveillance, canManageTarget, effectiveStatus, isTargetEnded,
  observationPatterns, targetStatusTint, type SurvViewer,
} from '@/lib/surveillanceModel'
import { confidenceTint, priorityTint } from '@/lib/tint'
import { toast } from '@/lib/toast'
import { useNow } from '@/lib/useNow'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { RecordSearchPicker } from '@/components/shared/RecordSearchPicker'
import { type CaseRow } from './shared'

type TargetRow = Tables<'surveillance_targets'>
type ObservationRow = Tables<'surveillance_observations'>
type ObsEntityRow = Tables<'surveillance_observation_entities'>
type EventRow = Tables<'surveillance_association_events'>
type ParticipantRow = Tables<'surveillance_event_participants'>
type AlertRow = Tables<'surveillance_alerts'>
type TargetHistoryRow = Tables<'surveillance_target_history'>

interface DeconflictRow {
  kind: string
  ref_id: string
  my_count: number
  other_case_count: number
  visible_case_ids: string[]
}

const SECTION_TITLE = 'text-xs font-bold uppercase tracking-[0.14em] text-slate-400'
const humanize = (s: string | null | undefined): string =>
  (s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

/** Local datetime-local value → ISO, null for blank/invalid. */
function toIso(local: string): string | null {
  if (!local.trim()) return null
  const t = new Date(local).getTime()
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

const nowLocal = (): string => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function SurveillanceTab({ c }: { c: CaseRow }) {
  const { profile, canEdit, isCommand, isOwner } = useAuth()
  const now = useNow()
  const me = profile?.id ?? null
  const viewer: SurvViewer = useMemo(() => ({
    userId: me, role: profile?.role ?? null, division: profile?.division ?? null, isOwner,
  }), [me, profile?.role, profile?.division, isOwner])

  const [targets, setTargets] = useState<TargetRow[]>([])
  const [observations, setObservations] = useState<ObservationRow[]>([])
  const [entities, setEntities] = useState<ObsEntityRow[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [participants, setParticipants] = useState<ParticipantRow[]>([])
  const [alerts, setAlerts] = useState<AlertRow[]>([])
  const [deconflict, setDeconflict] = useState<DeconflictRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [err, setErr] = useState<unknown>(null)
  const [requestOpen, setRequestOpen] = useState(false)
  const [eventOpen, setEventOpen] = useState(false)

  const vT = useTableVersion('surveillance_targets')
  const vO = useTableVersion('surveillance_observations')
  const vA = useTableVersion('surveillance_alerts')

  const refresh = useCallback(async () => {
    try {
      const [t, o, a, e] = await Promise.all([
        list('surveillance_targets', { eq: { case_id: c.id }, order: 'created_at', ascending: false }),
        list('surveillance_observations', { eq: { case_id: c.id }, order: 'observed_at', ascending: false, limit: 300 }),
        list('surveillance_alerts', { eq: { case_id: c.id }, order: 'created_at', ascending: false }).catch(() => [] as AlertRow[]),
        list('surveillance_association_events', { eq: { case_id: c.id }, order: 'occurred_at', ascending: false }).catch(() => [] as EventRow[]),
      ])
      setTargets(t)
      setObservations(o)
      setAlerts(a)
      setEvents(e)
      setErr(null)
      const [ents, parts, dec] = await Promise.all([
        o.length
          ? list('surveillance_observation_entities', { in: { observation_id: o.map((x) => x.id) } }).catch(() => [] as ObsEntityRow[])
          : Promise.resolve([] as ObsEntityRow[]),
        e.length
          ? list('surveillance_event_participants', { in: { event_id: e.map((x) => x.id) } }).catch(() => [] as ParticipantRow[])
          : Promise.resolve([] as ParticipantRow[]),
        rpc('surveillance_deconflict', { p_case: c.id })
          .then((r) => (Array.isArray(r.data) ? (r.data as unknown as DeconflictRow[]) : []))
          .catch(() => [] as DeconflictRow[]),
      ])
      setEntities(ents)
      setParticipants(parts)
      setDeconflict(dec)

      // Bounded label resolution (the IntelTab idiom) — only referenced ids;
      // rows the viewer cannot read simply keep their id fallback.
      const want: Record<'person' | 'vehicle' | 'place' | 'gang', Set<string>> = {
        person: new Set(), vehicle: new Set(), place: new Set(), gang: new Set(),
      }
      const note = (kind: string, id: string | null) => {
        if (id && (kind === 'person' || kind === 'vehicle' || kind === 'place' || kind === 'gang')) want[kind].add(id)
      }
      for (const x of o) { note('person', x.person_id); note('vehicle', x.vehicle_id); note('place', x.place_id) }
      for (const x of ents) note(x.kind, x.ref_id)
      for (const x of parts) note(x.kind, x.ref_id)
      for (const x of e) note('place', x.place_id)
      for (const x of t) if (x.ref_id) note(x.target_type, x.ref_id)
      for (const x of dec) note(x.kind, x.ref_id)
      const lookup = async (table: 'persons' | 'places' | 'gangs', ids: Set<string>) =>
        ids.size
          ? ((await list(table, { select: 'id,name', in: { id: [...ids] } }).catch(() => [])) as unknown as { id: string; name: string }[])
          : []
      const [pn, pl, gn, vn] = await Promise.all([
        lookup('persons', want.person),
        lookup('places', want.place),
        lookup('gangs', want.gang),
        want.vehicle.size
          ? ((await list('vehicles', { select: 'id,plate', in: { id: [...want.vehicle] } }).catch(() => [])) as unknown as { id: string; plate: string }[])
            .map((v) => ({ id: v.id, name: v.plate }))
          : [],
      ])
      setNames(Object.fromEntries([...pn, ...pl, ...gn, ...vn].map((r) => [r.id, r.name])))
    } catch (e) { setErr(e) }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vT, vO, vA])

  const nameOf = useCallback((id: string | null | undefined) => (id ? names[id] || id.slice(0, 8) : ''), [names])

  const patterns = useMemo(() => observationPatterns(observations, entities, now), [observations, entities, now])
  const openAlerts = useMemo(() => alerts.filter((a) => a.status === 'open'), [alerts])
  const entitiesByObs = useMemo(() => {
    const m = new Map<string, ObsEntityRow[]>()
    for (const e of entities) m.set(e.observation_id, [...(m.get(e.observation_id) ?? []), e])
    return m
  }, [entities])
  const participantsByEvent = useMemo(() => {
    const m = new Map<string, ParticipantRow[]>()
    for (const p of participants) m.set(p.event_id, [...(m.get(p.event_id) ?? []), p])
    return m
  }, [participants])

  if (err) return <ErrorNotice message={err} onRetry={() => void refresh()} />

  return (
    <div className="space-y-4">
      <AlertsStrip alerts={openAlerts} onChanged={refresh} />
      <TargetsSection
        c={c} targets={targets} viewer={viewer} me={me} isCommand={isCommand} isOwner={isOwner}
        canEdit={canEdit} now={now} nameOf={nameOf}
        onRequest={() => setRequestOpen(true)} onChanged={refresh}
      />
      <ObservationsSection
        c={c} observations={observations} entitiesByObs={entitiesByObs} targets={targets}
        canEdit={canEdit} nameOf={nameOf}
        onChanged={refresh}
      />
      <EventsSection
        events={events} participantsByEvent={participantsByEvent} canEdit={canEdit}
        nameOf={nameOf}
        onCreate={() => setEventOpen(true)} onChanged={refresh}
      />
      <PatternsPanel patterns={patterns} nameOf={nameOf} />
      <DeconflictionPanel rows={deconflict} nameOf={nameOf} />
      {requestOpen && <RequestModal caseId={c.id} onClose={() => setRequestOpen(false)} onSaved={() => { setRequestOpen(false); void refresh() }} />}
      {eventOpen && <EventModal caseId={c.id} onClose={() => setEventOpen(false)} onSaved={() => { setEventOpen(false); void refresh() }} />}
    </div>
  )
}

/* ── Alerts strip ─────────────────────────────────────────────────────────── */

function AlertsStrip({ alerts, onChanged }: { alerts: AlertRow[]; onChanged: () => void }) {
  if (!alerts.length) return null
  const ack = async (a: AlertRow, dismiss: boolean) => {
    const res = await rpc('surveillance_alert_ack', { p_alert: a.id, p_dismiss: dismiss })
    if (res.error) { toast(res.error.message, 'danger'); return }
    onChanged()
  }
  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <div key={a.id} className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-200">⚠ {a.title}</p>
              <p className="mt-1 text-xs text-amber-100/80">{a.explanation}</p>
            </div>
            <div className="flex flex-shrink-0 gap-2">
              <Button size="sm" onAction={() => ack(a, false)}>Acknowledge</Button>
              <Button size="sm" variant="ghost" onAction={() => ack(a, true)}>Dismiss</Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Targets ──────────────────────────────────────────────────────────────── */

function TargetsSection({ c, targets, viewer, me, isCommand, isOwner, canEdit, now, nameOf, onRequest, onChanged }: {
  c: CaseRow
  targets: TargetRow[]
  viewer: SurvViewer
  me: string | null
  isCommand: boolean
  isOwner: boolean
  canEdit: boolean
  now: number
  nameOf: (id: string | null | undefined) => string
  onRequest: () => void
  onChanged: () => void
}) {
  const mayAuthorize = canAuthorizeSurveillance(viewer, c.bureau)
  return (
    <Card pad="sm" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>Surveillance targets</h3>
        {canEdit && <Button size="sm" variant="primary" onClick={onRequest}>Request surveillance</Button>}
      </div>
      {!targets.length ? (
        <EmptyState
          title="No surveillance targets on this case"
          hint={canEdit ? 'Surveillance requires an authorized target — start with “Request surveillance”.' : undefined}
        />
      ) : targets.map((t) => (
        <TargetRowCard
          key={t.id} t={t} now={now} nameOf={nameOf}
          canManage={canManageTarget(viewer, t)}
          mayDecide={mayAuthorize && t.requested_by !== me}
          isCommand={isCommand || isOwner}
          onChanged={onChanged}
        />
      ))}
    </Card>
  )
}

function TargetRowCard({ t, now, nameOf, canManage, mayDecide, isCommand, onChanged }: {
  t: TargetRow
  now: number
  nameOf: (id: string | null | undefined) => string
  canManage: boolean
  mayDecide: boolean
  isCommand: boolean
  onChanged: () => void
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const status = effectiveStatus(t, now)
  const ended = isTargetEnded(status)

  const decide = async (decision: 'authorize' | 'deny' | 'return') => {
    // The generated RPC arg types are `?: string` — omit with undefined.
    let reason: string | undefined
    let expiresAt: string | undefined
    if (decision === 'authorize') {
      const exp = await uiPrompt(
        `Authorize surveillance on “${t.label}”?\n\nSet the authorization expiry (blank = no expiry).`,
        { title: 'Authorize surveillance', placeholder: 'YYYY-MM-DD (optional)', confirmText: 'Authorize' },
      )
      if (exp === null) return
      if (exp.trim()) {
        const ms = Date.parse(`${exp.trim()}T23:59:59`)
        if (Number.isNaN(ms)) { toast('Enter the expiry as YYYY-MM-DD.', 'warn'); return }
        expiresAt = new Date(ms).toISOString()
      }
    } else {
      const entered = await uiPrompt(
        decision === 'deny'
          ? `Deny the surveillance request “${t.label}”? A reason is required and recorded.`
          : `Return “${t.label}” to the requester for changes? A reason is required.`,
        { title: decision === 'deny' ? 'Deny request' : 'Return for changes', placeholder: 'Reason (required)', confirmText: decision === 'deny' ? 'Deny' : 'Return' },
      )
      if (entered === null) return
      if (!entered.trim()) { toast('A reason is required.', 'warn'); return }
      reason = entered.trim()
    }
    const res = await rpc('surveillance_decide', { p_target: t.id, p_decision: decision, p_reason: reason, p_expires_at: expiresAt })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(decision === 'authorize' ? 'Surveillance authorized.' : decision === 'deny' ? 'Request denied.' : 'Returned for changes.', 'success')
    onChanged()
  }

  const transition = async (action: 'activate' | 'suspend' | 'complete' | 'cancel' | 'extend') => {
    let reason: string | undefined
    let newExpiry: string | undefined
    if (action === 'suspend' || action === 'complete' || action === 'cancel') {
      const entered = await uiPrompt(
        action === 'suspend'
          ? `Suspend surveillance on “${t.label}”? A reason is required.`
          : `${action === 'complete' ? 'Complete' : 'Cancel'} surveillance on “${t.label}”? Outcome notes are recorded.`,
        {
          title: `${humanize(action)} surveillance`,
          placeholder: action === 'suspend' ? 'Reason (required)' : 'Outcome notes (optional)',
          confirmText: humanize(action),
        },
      )
      if (entered === null) return
      if (action === 'suspend' && !entered.trim()) { toast('Suspension requires a reason.', 'warn'); return }
      reason = entered.trim() || undefined
    }
    if (action === 'extend') {
      const exp = await uiPrompt(
        `Extend the authorization for “${t.label}”. An extension is a NEW approval — enter the new expiry.`,
        { title: 'Extend authorization', placeholder: 'YYYY-MM-DD (required)', confirmText: 'Next' },
      )
      if (exp === null) return
      const ms = Date.parse(`${exp.trim()}T23:59:59`)
      if (!exp.trim() || Number.isNaN(ms) || ms <= Date.now()) { toast('An extension needs a future expiry (YYYY-MM-DD).', 'warn'); return }
      newExpiry = new Date(ms).toISOString()
      const entered = await uiPrompt('Renewed justification for the extension (required, recorded).', {
        title: 'Extend authorization', placeholder: 'Justification (required)', confirmText: 'Extend',
      })
      if (entered === null) return
      if (!entered.trim()) { toast('An extension requires renewed justification.', 'warn'); return }
      reason = entered.trim()
    }
    const res = await rpc('surveillance_transition', { p_target: t.id, p_action: action, p_reason: reason, p_new_expiry: newExpiry })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Surveillance updated.', 'success')
    onChanged()
  }

  const submit = async () => {
    const res = await rpc('surveillance_request_submit', { p_target: t.id })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Request submitted for approval.', 'success')
    onChanged()
  }

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tint={targetStatusTint(status)}>{TARGET_STATUS_LABEL[status] ?? humanize(status)}</Badge>
        <span className="font-semibold text-white">{t.label}</span>
        <Badge>{TARGET_TYPES.find((x) => x.id === t.target_type)?.label ?? humanize(t.target_type)}</Badge>
        {t.ref_id && <span className="text-xs text-slate-400">{nameOf(t.ref_id)}</span>}
        <Badge tint={priorityTint(t.priority)}>{humanize(t.priority)}</Badge>
        {t.risk_level && <Badge tint={priorityTint(t.risk_level)}>Risk: {humanize(t.risk_level)}</Badge>}
        {t.expires_at && !ended && <DeadlineChip at={t.expires_at} kind="expires" now={now} />}
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        Requested by {officerName(t.requested_by) || 'unknown'} · {fmtDateTime(t.created_at)}
        {t.approved_at ? ` · authorized by ${officerName(t.approved_by) || 'command'} ${fmtDateTime(t.approved_at)}` : ''}
      </p>
      {t.reason && <p className="mt-1 text-sm text-slate-300">{t.reason}</p>}
      {t.objective && <p className="mt-0.5 text-xs text-slate-400">Objective: {t.objective}</p>}
      {t.outcome_notes && <p className="mt-0.5 text-xs text-slate-400">Outcome: {t.outcome_notes}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {t.status === 'draft' && canManage && <Button size="sm" variant="warn" onAction={submit}>Submit for approval</Button>}
        {t.status === 'pending_approval' && mayDecide && (
          <>
            <Button size="sm" variant="success" onClick={() => void decide('authorize')}>Authorize</Button>
            <Button size="sm" variant="danger" onClick={() => void decide('deny')}>Deny</Button>
            <Button size="sm" onClick={() => void decide('return')}>Return</Button>
          </>
        )}
        {canManage && !ended && (status === 'authorized' || status === 'suspended') && (
          <Button size="sm" variant="success" onClick={() => void transition('activate')}>Activate</Button>
        )}
        {canManage && status === 'active' && (
          <Button size="sm" onClick={() => void transition('suspend')}>Suspend</Button>
        )}
        {canManage && !ended && status !== 'draft' && status !== 'pending_approval' && (
          <>
            <Button size="sm" onClick={() => void transition('complete')}>Complete</Button>
            <Button size="sm" variant="ghost" onClick={() => void transition('cancel')}>Cancel</Button>
          </>
        )}
        {mayDecide && (status === 'authorized' || status === 'active' || status === 'suspended' || status === 'expired') && (
          <Button size="sm" onClick={() => void transition('extend')}>Extend…</Button>
        )}
        {(t.status === 'pending_approval') && !mayDecide && isCommand && (
          <span className="text-[11px] text-slate-400">Awaiting a Bureau Lead+ decision (requesters never approve their own).</span>
        )}
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          aria-expanded={historyOpen}
          className="ml-auto inline-flex min-h-[40px] items-center rounded px-2 text-[11px] font-semibold text-slate-400 transition hover:text-slate-200 sm:min-h-0"
        >
          {historyOpen ? 'Hide history' : 'History'}
        </button>
      </div>
      {historyOpen && <TargetHistory targetId={t.id} />}
    </div>
  )
}

function TargetHistory({ targetId }: { targetId: string }) {
  const [rows, setRows] = useState<TargetHistoryRow[] | null>(null)
  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(async () => {
      const r = await list('surveillance_target_history', { eq: { target_id: targetId }, order: 'created_at', ascending: false })
        .catch(() => [] as TargetHistoryRow[])
      if (!cancelled) setRows(r)
    }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [targetId])
  if (rows === null) return <p className="mt-2 text-xs text-slate-400">Loading history…</p>
  if (!rows.length) return <p className="mt-2 text-xs text-slate-400">No recorded decisions yet.</p>
  return (
    <ul className="mt-2 space-y-1 border-t border-white/5 pt-2">
      {rows.map((h) => (
        <li key={h.id} className="text-xs text-slate-400">
          <span className="font-semibold text-slate-300">{humanize(h.action)}</span>
          {h.from_status && h.to_status ? ` · ${humanize(h.from_status)} → ${humanize(h.to_status)}` : ''}
          {' · '}{officerName(h.actor_id) || 'system'} · {fmtDateTime(h.created_at)}
          {h.reason ? <span className="text-slate-500"> — {h.reason}</span> : null}
        </li>
      ))}
    </ul>
  )
}

/* ── Observations ─────────────────────────────────────────────────────────── */

function ObservationsSection({ c, observations, entitiesByObs, targets, canEdit, nameOf, onChanged }: {
  c: CaseRow
  observations: ObservationRow[]
  entitiesByObs: ReadonlyMap<string, ObsEntityRow[]>
  targets: TargetRow[]
  canEdit: boolean
  nameOf: (id: string | null | undefined) => string
  onChanged: () => void
}) {
  const [verFilter, setVerFilter] = useState('')
  const [srcFilter, setSrcFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const rows = observations.filter((o) =>
    (!verFilter || o.verification_status === verFilter) && (!srcFilter || o.source_type === srcFilter))
  return (
    <Card pad="sm" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>Observations</h3>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`obs-ver-${c.id}`}>Filter by verification</label>
          <Select id={`obs-ver-${c.id}`} value={verFilter} onChange={(e) => setVerFilter(e.target.value)} className="w-auto py-1.5 text-xs">
            <option value="">All statuses</option>
            {Object.entries(VERIFICATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <label className="sr-only" htmlFor={`obs-src-${c.id}`}>Filter by source</label>
          <Select id={`obs-src-${c.id}`} value={srcFilter} onChange={(e) => setSrcFilter(e.target.value)} className="w-auto py-1.5 text-xs">
            <option value="">All sources</option>
            {Object.entries(SOURCE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {canEdit && <Button size="sm" variant="primary" onClick={() => setFormOpen((v) => !v)}>{formOpen ? 'Close form' : 'Log observation'}</Button>}
        </div>
      </div>
      {formOpen && canEdit && (
        <LogObservationForm
          caseId={c.id} targets={targets}
          onSaved={() => { setFormOpen(false); onChanged() }}
        />
      )}
      {!rows.length ? (
        <EmptyState
          title={observations.length ? 'No observations match the filters.' : 'No observations logged yet'}
          hint={!observations.length && canEdit ? 'Log manual sightings here — automated feeds arrive through the bridge once it exists.' : undefined}
        />
      ) : rows.map((o) => (
        <ObservationRowCard key={o.id} o={o} entities={entitiesByObs.get(o.id) ?? []} canEdit={canEdit} nameOf={nameOf} onChanged={onChanged} />
      ))}
    </Card>
  )
}

function LogObservationForm({ caseId, targets, onSaved }: {
  caseId: string
  targets: TargetRow[]
  onSaved: () => void
}) {
  const [observedAt, setObservedAt] = useState(nowLocal)
  const [activity, setActivity] = useState('')
  // Bounded entity-search pickers (lib/entitySearch) — no registry preloads.
  const [person, setPerson] = useState<EntityHit | null>(null)
  const [vehicle, setVehicle] = useState<EntityHit | null>(null)
  const [place, setPlace] = useState<EntityHit | null>(null)
  const [plate, setPlate] = useState('')
  const [locationText, setLocationText] = useState('')
  const [targetId, setTargetId] = useState('')
  const [confidence, setConfidence] = useState('possible')
  const [restricted, setRestricted] = useState(false)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!activity.trim()) { toast('Describe the observed activity.', 'warn'); return }
    const at = toIso(observedAt)
    if (!at) { toast('Enter a valid observation time.', 'warn'); return }
    setBusy(true)
    const res = await insert('surveillance_observations', {
      case_id: caseId,
      target_id: targetId || null,
      observed_at: at,
      source_type: 'detective_manual',
      activity: activity.trim(),
      person_id: person?.id ?? null,
      vehicle_id: vehicle?.id ?? null,
      place_id: place?.id ?? null,
      plate_snapshot: plate.trim() || null,
      location_text: locationText.trim() || null,
      confidence,
      restricted,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Observation logged — it enters the queue unverified.', 'success')
    onSaved()
  }

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-ink-950/50 p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Observed at" required>
          {(id) => <Input id={id} type="datetime-local" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} />}
        </Field>
        <Field label="Surveillance target (optional)">
          {(id) => (
            <Select id={id} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
              <option value="">— none —</option>
              {targets.filter((t) => !isTargetEnded(t.status)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Confidence">
          {(id) => (
            <Select id={id} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
              {CONFIDENCE_LEVELS.filter((l) => l !== 'confirmed').map((l) => <option key={l} value={l}>{humanize(l)}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Activity observed" required>
        {(id) => <Textarea id={id} rows={2} value={activity} onChange={(e) => setActivity(e.target.value)} placeholder="What was seen, plainly and factually" />}
      </Field>
      <div className="grid gap-3 md:grid-cols-3">
        <RecordSearchPicker<EntityHit>
          label="Person (optional)"
          value={person}
          onChange={setPerson}
          search={searchPersonHits}
          placeholder="Search name, alias, phone…"
          getThumb={(h) => h.thumbUrl}
          peekType="person"
        />
        <RecordSearchPicker<EntityHit>
          label="Vehicle (optional)"
          value={vehicle}
          onChange={setVehicle}
          search={searchVehicleHits}
          placeholder="Search plate, model…"
          peekType="vehicle"
        />
        <RecordSearchPicker<EntityHit>
          label="Place (optional)"
          value={place}
          onChange={setPlace}
          search={searchPlaceHits}
          placeholder="Search place name, area…"
          peekType="place"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Plate snapshot (optional)" hint="As read at the scene — kept even if no registry vehicle matches.">
          {(id) => <Input id={id} value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="SA 12345" />}
        </Field>
        <Field label="Location (optional)">
          {(id) => <Input id={id} value={locationText} onChange={(e) => setLocationText(e.target.value)} placeholder="Free-text location" />}
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="inline-flex min-h-[40px] items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} className="h-4 w-4 accent-amber-500" />
          Restricted — command, the logger and the reviewer only
        </label>
        <Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Logging…' : 'Log observation'}</Button>
      </div>
    </div>
  )
}

function ObservationRowCard({ o, entities, canEdit, nameOf, onChanged }: {
  o: ObservationRow
  entities: ObsEntityRow[]
  canEdit: boolean
  nameOf: (id: string | null | undefined) => string
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  // Restricted-view audit — once per expansion of a restricted row.
  const logged = useRef(false)
  const expand = () => {
    setOpen((v) => !v)
    if (o.restricted && !logged.current) {
      logged.current = true
      void rpc('log_restricted_view', { p_entity_type: 'observation', p_entity: o.id })
    }
  }

  const review = async (decision: 'verify' | 'reject' | 'needs_information') => {
    let notes: string | undefined
    if (decision !== 'verify') {
      const entered = await uiPrompt(
        decision === 'reject'
          ? 'Reject this observation? Notes are required and recorded in the review trail.'
          : 'Request more information from the logger? Notes are required.',
        { title: decision === 'reject' ? 'Reject observation' : 'Needs information', placeholder: 'Notes (required)', confirmText: decision === 'reject' ? 'Reject' : 'Request info' },
      )
      if (entered === null) return
      if (!entered.trim()) { toast('Notes are required.', 'warn'); return }
      notes = entered.trim()
    }
    const res = await rpc('observation_review', { p_observation: o.id, p_decision: decision, p_notes: notes })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Review recorded.', 'success')
    onChanged()
  }

  const promote = async () => {
    const ok = await uiConfirm(
      'Promote this VERIFIED observation to the case record? Its media links to the case under the surveillance category. This is deliberate and audited.',
      { title: 'Promote observation', confirmText: 'Promote', danger: false },
    )
    if (!ok) return
    const res = await rpc('observation_promote', { p_observation: o.id })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Observation promoted to the case record.', 'success')
    onChanged()
  }

  const chips: Array<{ key: string; label: string; href: string | null }> = []
  if (o.person_id) chips.push({ key: `p:${o.person_id}`, label: `👤 ${nameOf(o.person_id)}`, href: `/persons?person=${encodeURIComponent(o.person_id)}` })
  if (o.vehicle_id) chips.push({ key: `v:${o.vehicle_id}`, label: `🚗 ${nameOf(o.vehicle_id)}`, href: `/vehicles?vehicle=${encodeURIComponent(o.vehicle_id)}` })
  if (o.place_id) chips.push({ key: `pl:${o.place_id}`, label: `📍 ${nameOf(o.place_id)}`, href: `/places?place=${encodeURIComponent(o.place_id)}` })
  for (const e of entities) {
    const href = e.kind === 'person' ? `/persons?person=${encodeURIComponent(e.ref_id)}`
      : e.kind === 'vehicle' ? `/vehicles?vehicle=${encodeURIComponent(e.ref_id)}`
        : e.kind === 'place' ? `/places?place=${encodeURIComponent(e.ref_id)}`
          : e.kind === 'gang' ? `/gangs?gang=${encodeURIComponent(e.ref_id)}` : null
    chips.push({ key: `e:${e.id}`, label: `${humanize(e.kind)}: ${nameOf(e.ref_id)}`, href })
  }

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tint={VERIFICATION_TINT[o.verification_status] ?? 'bg-white/5 text-slate-400'}>
          {VERIFICATION_LABEL[o.verification_status] ?? humanize(o.verification_status)}
        </Badge>
        <Badge>{SOURCE_TYPE_LABEL[o.source_type] ?? humanize(o.source_type)}</Badge>
        <Badge tint={confidenceTint(o.confidence)}>{humanize(o.confidence)}</Badge>
        {o.restricted && <Badge tone="warn">🔒 Restricted</Badge>}
        {o.promoted_at && <Badge tone="good">Promoted</Badge>}
        <span className="ml-auto text-xs text-slate-400">{fmtDateTime(o.observed_at)}</span>
      </div>
      <p className="mt-1.5 text-sm text-slate-200">{o.activity}</p>
      {(chips.length > 0 || o.plate_snapshot || o.location_text) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          {chips.map((ch) => ch.href ? (
            <Link key={ch.key} href={ch.href} className="rounded-full bg-white/5 px-2 py-0.5 text-badge-300 hover:underline">{ch.label}</Link>
          ) : (
            <span key={ch.key} className="rounded-full bg-white/5 px-2 py-0.5 text-slate-300">{ch.label}</span>
          ))}
          {o.plate_snapshot && <span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-slate-300">{o.plate_snapshot}</span>}
          {o.location_text && <span className="text-slate-400">📍 {o.location_text}</span>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canEdit && o.verification_status !== 'verified' && o.verification_status !== 'rejected' && (
          <>
            <Button size="sm" variant="success" onClick={() => void review('verify')}>Verify</Button>
            <Button size="sm" variant="danger" onClick={() => void review('reject')}>Reject</Button>
            <Button size="sm" onClick={() => void review('needs_information')}>Needs info</Button>
          </>
        )}
        {canEdit && o.verification_status === 'verified' && !o.promoted_at && (
          <Button size="sm" onClick={() => void promote()}>Promote to case record</Button>
        )}
        <button
          type="button"
          onClick={expand}
          aria-expanded={open}
          className="ml-auto inline-flex min-h-[40px] items-center rounded px-2 text-[11px] font-semibold text-slate-400 transition hover:text-slate-200 sm:min-h-0"
        >
          {open ? 'Less' : 'Details'}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-1 border-t border-white/5 pt-2 text-xs text-slate-400">
          <p>Logged by {officerName(o.created_by) || 'bridge/system'} · received {fmtDateTime(o.received_at)}</p>
          {o.subject_description && <p>Subject: {o.subject_description}</p>}
          {o.reviewed_at && <p>Reviewed by {officerName(o.reviewed_by) || 'unknown'} · {fmtDateTime(o.reviewed_at)}{o.review_notes ? ` — ${o.review_notes}` : ''}</p>}
          {o.promoted_at && <p>Promoted by {officerName(o.promoted_by) || 'unknown'} · {fmtDateTime(o.promoted_at)}</p>}
          {o.source_ref && <p>Source ref: {o.source_ref}</p>}
        </div>
      )}
    </div>
  )
}

/* ── Association events ───────────────────────────────────────────────────── */

function EventsSection({ events, participantsByEvent, canEdit, nameOf, onCreate, onChanged }: {
  events: EventRow[]
  participantsByEvent: ReadonlyMap<string, ParticipantRow[]>
  canEdit: boolean
  nameOf: (id: string | null | undefined) => string
  onCreate: () => void
  onChanged: () => void
}) {
  return (
    <Card pad="sm" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className={SECTION_TITLE}>Association events</h3>
        {canEdit && <Button size="sm" onClick={onCreate}>Record event</Button>}
      </div>
      {!events.length ? (
        <EmptyState title="No association events recorded" hint={canEdit ? 'Record meetings and co-presence here, then add the participants.' : undefined} />
      ) : events.map((e) => (
        <EventRowCard
          key={e.id} e={e} participants={participantsByEvent.get(e.id) ?? []}
          canEdit={canEdit} nameOf={nameOf}
          onChanged={onChanged}
        />
      ))}
    </Card>
  )
}

function EventRowCard({ e, participants, canEdit, nameOf, onChanged }: {
  e: EventRow
  participants: ParticipantRow[]
  canEdit: boolean
  nameOf: (id: string | null | undefined) => string
  onChanged: () => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [kind, setKind] = useState<'person' | 'vehicle' | 'place'>('person')
  const [ref, setRef] = useState<EntityHit | null>(null)
  // Bounded per-kind arm of the shared entity-search registry.
  const search = useCallback((q: string) => searchEntities(kind, q), [kind])

  const review = async (decision: 'verify' | 'reject') => {
    let notes: string | undefined
    if (decision === 'reject') {
      const entered = await uiPrompt('Reject this event? Notes are required.', { title: 'Reject event', placeholder: 'Notes (required)', confirmText: 'Reject' })
      if (entered === null) return
      if (!entered.trim()) { toast('Notes are required.', 'warn'); return }
      notes = entered.trim()
    }
    const res = await rpc('surveillance_event_review', { p_event: e.id, p_decision: decision, p_notes: notes })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Event review recorded.', 'success')
    onChanged()
  }

  const addParticipant = async () => {
    if (!ref) return
    const res = await insert('surveillance_event_participants', { event_id: e.id, kind, ref_id: ref.id })
    if (res.error) {
      toast(res.error.code === '23505' ? 'Already a participant.' : res.error.message, res.error.code === '23505' ? 'warn' : 'danger')
      return
    }
    setRef(null)
    onChanged()
  }

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tint={VERIFICATION_TINT[e.verification_status] ?? 'bg-white/5 text-slate-400'}>
          {VERIFICATION_LABEL[e.verification_status] ?? humanize(e.verification_status)}
        </Badge>
        <Badge>{humanize(e.event_type)}</Badge>
        <Badge tint={confidenceTint(e.confidence)}>{humanize(e.confidence)}</Badge>
        <span className="ml-auto text-xs text-slate-400">{fmtDateTime(e.occurred_at)}</span>
      </div>
      <p className="mt-1.5 text-sm text-slate-200">{e.summary}</p>
      {(e.place_id || e.location_text) && (
        <p className="mt-0.5 text-xs text-slate-400">📍 {e.place_id ? nameOf(e.place_id) : e.location_text}</p>
      )}
      {participants.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
          {participants.map((p) => (
            <span key={p.id} className="rounded-full bg-white/5 px-2 py-0.5 text-slate-300">
              {humanize(p.kind)}: {nameOf(p.ref_id)}{p.role ? ` · ${p.role}` : ''}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canEdit && e.verification_status === 'unverified' && (
          <>
            <Button size="sm" variant="success" onClick={() => void review('verify')}>Verify</Button>
            <Button size="sm" variant="danger" onClick={() => void review('reject')}>Reject</Button>
          </>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            aria-expanded={addOpen}
            className="inline-flex min-h-[40px] items-center rounded px-2 text-[11px] font-semibold text-slate-400 transition hover:text-slate-200 sm:min-h-0"
          >
            {addOpen ? 'Close' : '+ Participant'}
          </button>
        )}
      </div>
      {addOpen && canEdit && (
        <div className="mt-2 space-y-2 border-t border-white/5 pt-2">
          <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Field label="Kind">
              {(id) => (
                <Select id={id} value={kind} onChange={(ev) => { setKind(ev.target.value as 'person' | 'vehicle' | 'place'); setRef(null) }}>
                  <option value="person">Person</option>
                  <option value="vehicle">Vehicle</option>
                  <option value="place">Place</option>
                </Select>
              )}
            </Field>
            <RecordSearchPicker<EntityHit>
              // Remount per kind: a kind switch must not reuse the previous
              // kind's rows or typed query.
              key={kind}
              label="Record"
              value={ref}
              onChange={setRef}
              search={search}
              placeholder={`Search ${kind}s…`}
              peekType={kind}
              {...(kind === 'person' ? { getThumb: (h: EntityHit) => h.thumbUrl } : {})}
            />
          </div>
          <Button size="sm" onAction={addParticipant} disabled={!ref}>Add participant</Button>
        </div>
      )}
    </div>
  )
}

/* ── Patterns (§derived) ──────────────────────────────────────────────────── */

function PatternsPanel({ patterns, nameOf }: {
  patterns: ReturnType<typeof observationPatterns>
  nameOf: (id: string | null | undefined) => string
}) {
  const peak = Math.max(1, ...patterns.hourHistogram)
  const empty = !patterns.repeatedLocations.length && !patterns.repeatedVehicles.length
    && !patterns.repeatedPersons.length && !patterns.coOccurrence.length
  return (
    <Card pad="sm" className="space-y-3">
      <div>
        <h3 className={SECTION_TITLE}>Patterns</h3>
        <p className="mt-1 text-xs text-slate-400">
          Derived from verified observations — investigative leads, not conclusions.
        </p>
      </div>
      {patterns.consideredCount === 0 ? (
        <EmptyState title="No verified observations yet" hint="Patterns appear once observations are verified." />
      ) : empty ? (
        <p className="text-sm text-slate-400">
          {patterns.consideredCount} verified observation{patterns.consideredCount === 1 ? '' : 's'} — no repeated sightings yet.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {patterns.repeatedPersons.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Repeated persons</p>
              <ul className="space-y-1 text-sm text-slate-200">
                {patterns.repeatedPersons.map((p) => (
                  <li key={p.personId}>👤 {nameOf(p.personId)} <span className="text-xs text-slate-400">— seen {p.count}×</span></li>
                ))}
              </ul>
            </div>
          )}
          {patterns.repeatedVehicles.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Repeated vehicles</p>
              <ul className="space-y-1 text-sm text-slate-200">
                {patterns.repeatedVehicles.map((v) => (
                  <li key={v.vehicleId ?? v.plate ?? ''}>
                    🚗 {v.vehicleId ? nameOf(v.vehicleId) : <span className="font-mono">{v.plate}</span>}
                    {' '}<span className="text-xs text-slate-400">— seen {v.count}×</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {patterns.repeatedLocations.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Repeated locations</p>
              <ul className="space-y-1 text-sm text-slate-200">
                {patterns.repeatedLocations.map((l) => (
                  <li key={l.placeId ?? l.locationText ?? ''}>
                    📍 {l.placeId ? nameOf(l.placeId) : l.locationText}
                    {' '}<span className="text-xs text-slate-400">— {l.count}× · {fmtDateTime(l.firstSeen)} → {fmtDateTime(l.lastSeen)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {patterns.coOccurrence.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Seen together (≥2 observations)</p>
              <ul className="space-y-1 text-sm text-slate-200">
                {patterns.coOccurrence.map((p) => (
                  <li key={`${p.aKind}:${p.aRefId}|${p.bKind}:${p.bRefId}`}>
                    {nameOf(p.aRefId)} + {nameOf(p.bRefId)} <span className="text-xs text-slate-400">— {p.count}×</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {patterns.consideredCount > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Activity by hour (UTC)</p>
          <div className="flex h-12 items-end gap-0.5" role="img" aria-label="Verified observations by hour of day">
            {patterns.hourHistogram.map((n, h) => (
              <div
                key={h}
                title={`${String(h).padStart(2, '0')}:00 — ${n} observation${n === 1 ? '' : 's'}`}
                className={`flex-1 rounded-t ${n ? 'bg-badge-500/60' : 'bg-white/5'}`}
                style={{ height: `${Math.max(8, (n / peak) * 100)}%` }}
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

/* ── Deconfliction ────────────────────────────────────────────────────────── */

function DeconflictionPanel({ rows, nameOf }: {
  rows: DeconflictRow[]
  nameOf: (id: string | null | undefined) => string
}) {
  const [caseNums, setCaseNums] = useState<Record<string, string>>({})
  const visibleIds = useMemo(() => [...new Set(rows.flatMap((r) => r.visible_case_ids ?? []))], [rows])
  useEffect(() => {
    if (!visibleIds.length) return
    let cancelled = false
    const t = window.setTimeout(async () => {
      const cs = (await list('cases', { select: 'id,case_number', in: { id: visibleIds } }).catch(() => [])) as unknown as { id: string; case_number: string }[]
      if (!cancelled) setCaseNums(Object.fromEntries(cs.map((x) => [x.id, x.case_number])))
    }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [visibleIds])
  if (!rows.length) return null
  return (
    <Card pad="sm" className="space-y-2">
      <div>
        <h3 className={SECTION_TITLE}>Deconfliction</h3>
        <p className="mt-1 text-xs text-slate-400">
          Entities from this case&apos;s verified observations that also appear in other cases. Hidden cases show existence only — never their contents.
        </p>
      </div>
      {rows.map((r) => {
        const visible = r.visible_case_ids ?? []
        const hidden = Number(r.other_case_count) - visible.length
        return (
          <div key={`${r.kind}:${r.ref_id}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-ink-950/50 px-3 py-2 text-sm">
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">{humanize(r.kind)}</span>
            <span className="text-slate-200">{nameOf(r.ref_id)}</span>
            <span className="text-xs text-slate-400">
              seen in {r.other_case_count} other case{Number(r.other_case_count) === 1 ? '' : 's'}
            </span>
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              {visible.map((id) => (
                <Link key={id} href={caseLink(id, 'surveillance')} className="rounded-full bg-blue-500/10 px-2 py-0.5 font-mono text-[11px] text-blue-300 hover:underline">
                  {caseNums[id] ?? 'case'}
                </Link>
              ))}
              {hidden > 0 && (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-slate-400" title="Cases outside your access — contact command to deconflict">
                  🔒 {hidden} restricted
                </span>
              )}
            </span>
          </div>
        )
      })}
    </Card>
  )
}

/* ── Request surveillance modal ───────────────────────────────────────────── */

function RequestModal({ caseId, onClose, onSaved }: { caseId: string; onClose: () => void; onSaved: () => void }) {
  const [targetType, setTargetType] = useState('person')
  const [label, setLabel] = useState('')
  const [reason, setReason] = useState('')
  const [objective, setObjective] = useState('')
  const [priority, setPriority] = useState('medium')
  const [risk, setRisk] = useState('')
  const [requestedStart, setRequestedStart] = useState('')
  const [submitNow, setSubmitNow] = useState(true)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!label.trim() || !reason.trim()) { toast('A target label and justification are required.', 'warn'); return }
    setBusy(true)
    const res = await rpc('surveillance_request_create', {
      p_case: caseId,
      p_target_type: targetType,
      p_label: label.trim(),
      p_reason: reason.trim(),
      p_objective: objective.trim() || undefined,
      p_priority: priority,
      p_risk: risk || undefined,
      p_requested_start: toIso(requestedStart) ?? undefined,
      p_submit: submitNow,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(submitNow ? 'Surveillance request submitted for approval.' : 'Surveillance request saved as draft.', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!(label || reason || objective)}>
      <div className="p-6">
        <ModalHeader title="Request surveillance" onClose={onClose} />
        <p className="mb-4 text-sm text-slate-400">
          Surveillance requires Bureau Lead+ authorization (SOP Title 7). Requesters can never approve their own request.
        </p>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Target type">
              {(id) => (
                <Select id={id} value={targetType} onChange={(e) => setTargetType(e.target.value)}>
                  {TARGET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Target label" required hint="Who/what is being surveilled — plain words.">
              {(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Vespucci docks warehouse" />}
            </Field>
          </div>
          <Field label="Justification" required>
            {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why surveillance is necessary on this case" />}
          </Field>
          <Field label="Objective (optional)">
            {(id) => <Input id={id} value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="What the surveillance should establish" />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Priority">
              {(id) => (
                <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {['low', 'medium', 'high', 'critical'].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Risk level">
              {(id) => (
                <Select id={id} value={risk} onChange={(e) => setRisk(e.target.value)}>
                  <option value="">— unset —</option>
                  {['low', 'medium', 'high', 'critical'].map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Requested start">
              {(id) => <Input id={id} type="datetime-local" value={requestedStart} onChange={(e) => setRequestedStart(e.target.value)} />}
            </Field>
          </div>
          <label className="inline-flex min-h-[40px] items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={submitNow} onChange={(e) => setSubmitNow(e.target.checked)} className="h-4 w-4 accent-amber-500" />
            Submit for approval now (unchecked saves a draft)
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !label.trim() || !reason.trim()}>
            {busy ? 'Saving…' : submitNow ? 'Submit request' : 'Save draft'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Record association event modal ───────────────────────────────────────── */

function EventModal({ caseId, onClose, onSaved }: {
  caseId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [eventType, setEventType] = useState('meeting')
  const [occurredAt, setOccurredAt] = useState(nowLocal)
  const [place, setPlace] = useState<EntityHit | null>(null)
  const [locationText, setLocationText] = useState('')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!summary.trim()) { toast('Summarize what happened.', 'warn'); return }
    const at = toIso(occurredAt)
    if (!at) { toast('Enter a valid event time.', 'warn'); return }
    setBusy(true)
    const res = await insert('surveillance_association_events', {
      case_id: caseId,
      event_type: eventType,
      occurred_at: at,
      place_id: place?.id ?? null,
      location_text: locationText.trim() || null,
      summary: summary.trim(),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Event recorded — add its participants from the list.', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!summary.trim()}>
      <div className="p-6">
        <ModalHeader title="Record association event" onClose={onClose} />
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type">
              {(id) => (
                <Select id={id} value={eventType} onChange={(e) => setEventType(e.target.value)}>
                  {['meeting', 'co_presence', 'group_activity', 'organization_activity', 'other'].map((t) => (
                    <option key={t} value={t}>{humanize(t)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Occurred at" required>
              {(id) => <Input id={id} type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />}
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <RecordSearchPicker<EntityHit>
              label="Place (optional)"
              value={place}
              onChange={setPlace}
              search={searchPlaceHits}
              placeholder="Search place name, area…"
              peekType="place"
            />
            <Field label="Location text (optional)">
              {(id) => <Input id={id} value={locationText} onChange={(e) => setLocationText(e.target.value)} />}
            </Field>
          </div>
          <Field label="Summary" required>
            {(id) => <Textarea id={id} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Who met whom, where, and what was observed" />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !summary.trim()}>{busy ? 'Saving…' : 'Record event'}</Button>
        </div>
      </div>
    </Modal>
  )
}
