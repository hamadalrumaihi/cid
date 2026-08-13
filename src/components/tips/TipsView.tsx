'use client'

/** Intel Tips — one triage queue for detective tips and patrol submissions
 *  (intelligence_tips). Submission is ordinary casework (guard-stamped
 *  insert); the triage lifecycle moves ONLY through the tip_triage RPC
 *  (review / accept / reject / close), mirrored here for command, the
 *  assigned detective and the owner. Confidential-source identity lives in
 *  intelligence_tip_sources behind a STRICTER wall — the panel renders only
 *  when RLS returns a row and stays quiet otherwise. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type { Tables } from '@/lib/database.types'
import { insert, list, rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { activeProfiles, officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { priorityTint, statusTint } from '@/lib/tint'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { uiPrompt } from '@/components/ui/dialog'

type TipRow = Tables<'intelligence_tips'>
type TipLinkRow = Tables<'intelligence_tip_links'>
type TipSourceRow = Tables<'intelligence_tip_sources'>
type CaseOption = { id: string; case_number: string; title: string | null; lead_detective_id: string | null; created_by: string | null }
interface PickOption { id: string; label: string }

const TIP_STATUSES = ['new', 'reviewing', 'actioned', 'closed', 'rejected'] as const
const TIP_SOURCE_LABEL: Record<string, string> = {
  cid_detective: 'CID detective',
  patrol: 'Patrol',
  confidential_source: 'Confidential source',
  imported: 'Imported',
  system: 'System',
  fivem_bridge: 'City bridge',
}
const humanize = (s: string | null | undefined): string =>
  (s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

export function TipsView() {
  const { state, profile, isCommand, isOwner } = useAuth()
  const me = profile?.id ?? null
  const [tips, setTips] = useState<TipRow[] | null>(null)
  const [links, setLinks] = useState<TipLinkRow[]>([])
  const [sources, setSources] = useState<TipSourceRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [caseNums, setCaseNums] = useState<Record<string, string>>({})
  const [myCases, setMyCases] = useState<CaseOption[]>([])
  const [persons, setPersons] = useState<PickOption[]>([])
  const [vehicles, setVehicles] = useState<PickOption[]>([])
  const [places, setPlaces] = useState<PickOption[]>([])
  const [gangs, setGangs] = useState<PickOption[]>([])
  const [err, setErr] = useState<unknown>(null)
  const [filter, setFilter] = useState('open') // open = new + reviewing
  const [triage, setTriage] = useState<{ tip: TipRow; action: 'review' | 'accept' } | null>(null)
  const vTips = useTableVersion('intelligence_tips')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    try {
      const rows = await list('intelligence_tips', { order: 'created_at', ascending: false, limit: 200 })
      setTips(rows)
      setErr(null)
      const ids = rows.map((t) => t.id)
      const [ls, ss, cs] = await Promise.all([
        ids.length
          ? list('intelligence_tip_links', { in: { tip_id: ids } }).catch(() => [] as TipLinkRow[])
          : Promise.resolve([] as TipLinkRow[]),
        // Source identity: STRICTER RLS — rows simply don't arrive for most
        // viewers; a failure stays quiet (fail-quiet by design).
        ids.length
          ? list('intelligence_tip_sources', { in: { tip_id: ids } }).catch(() => [] as TipSourceRow[])
          : Promise.resolve([] as TipSourceRow[]),
        (async () => {
          const caseIds = [...new Set(rows.map((t) => t.case_id).filter((x): x is string => !!x))]
          return caseIds.length
            ? ((await list('cases', { select: 'id,case_number', in: { id: caseIds } }).catch(() => [])) as unknown as { id: string; case_number: string }[])
            : []
        })(),
      ])
      setLinks(ls)
      setSources(ss)
      setCaseNums(Object.fromEntries(cs.map((c) => [c.id, c.case_number])))
      // Bounded label resolution for link chips (the IntelTab idiom).
      const want: Record<'person' | 'vehicle' | 'place' | 'gang' | 'account', Set<string>> = {
        person: new Set(), vehicle: new Set(), place: new Set(), gang: new Set(), account: new Set(),
      }
      for (const l of ls) want[l.kind as keyof typeof want]?.add(l.ref_id)
      const nameLookup = async (table: 'persons' | 'places' | 'gangs', ids2: Set<string>) =>
        ids2.size
          ? ((await list(table, { select: 'id,name', in: { id: [...ids2] } }).catch(() => [])) as unknown as { id: string; name: string }[])
          : []
      const [pn, pl, gn, vn] = await Promise.all([
        nameLookup('persons', want.person),
        nameLookup('places', want.place),
        nameLookup('gangs', want.gang),
        want.vehicle.size
          ? ((await list('vehicles', { select: 'id,plate', in: { id: [...want.vehicle] } }).catch(() => [])) as unknown as { id: string; plate: string }[])
            .map((v) => ({ id: v.id, name: v.plate }))
          : [],
      ])
      setNames(Object.fromEntries([...pn, ...pl, ...gn, ...vn].map((r) => [r.id, r.name])))
    } catch (e) { setErr(e) }
  }, [state])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vTips])

  // Form option pools — bounded, fail-open, loaded once per session.
  useEffect(() => {
    if (state !== 'in') return
    const t = window.setTimeout(() => {
      void list('cases', { select: 'id,case_number,title,lead_detective_id,created_by', order: 'updated_at', ascending: false, limit: 200 })
        .then((r) => setMyCases(r as unknown as CaseOption[]))
        .catch(() => {})
      void list('persons', { select: 'id,name', order: 'name', limit: 200 })
        .then((r) => setPersons((r as unknown as { id: string; name: string }[]).map((p) => ({ id: p.id, label: p.name }))))
        .catch(() => {})
      void list('vehicles', { select: 'id,plate,model', order: 'plate', limit: 200 })
        .then((r) => setVehicles((r as unknown as { id: string; plate: string; model: string | null }[]).map((v) => ({ id: v.id, label: `${v.plate}${v.model ? ` · ${v.model}` : ''}` }))))
        .catch(() => {})
      void list('places', { select: 'id,name', order: 'name', limit: 200 })
        .then((r) => setPlaces((r as unknown as { id: string; name: string }[]).map((p) => ({ id: p.id, label: p.name }))))
        .catch(() => {})
      void list('gangs', { select: 'id,name', order: 'name', limit: 200 })
        .then((r) => setGangs((r as unknown as { id: string; name: string }[]).map((g) => ({ id: g.id, label: g.name }))))
        .catch(() => {})
    }, 0)
    return () => window.clearTimeout(t)
  }, [state])

  const mine = useMemo(
    () => myCases.filter((c) => c.lead_detective_id === me || c.created_by === me),
    [myCases, me],
  )
  const linksByTip = useMemo(() => {
    const m = new Map<string, TipLinkRow[]>()
    for (const l of links) m.set(l.tip_id, [...(m.get(l.tip_id) ?? []), l])
    return m
  }, [links])
  const sourceByTip = useMemo(() => new Map(sources.map((s) => [s.tip_id, s])), [sources])
  const nameOf = useCallback((id: string) => names[id] || id.slice(0, 8), [names])

  const rows = useMemo(() => {
    const all = tips ?? []
    if (filter === 'all') return all
    if (filter === 'open') return all.filter((t) => t.status === 'new' || t.status === 'reviewing')
    return all.filter((t) => t.status === filter)
  }, [tips, filter])

  const canTriage = useCallback(
    (t: TipRow) => isCommand || isOwner || t.assigned_to === me,
    [isCommand, isOwner, me],
  )

  const reject = async (t: TipRow) => {
    const reason = await uiPrompt('Reject this tip? A reason is required and recorded as the disposition.', {
      title: 'Reject tip', placeholder: 'Reason (required)', confirmText: 'Reject',
    })
    if (reason === null) return
    if (!reason.trim()) { toast('A reason is required.', 'warn'); return }
    const res = await rpc('tip_triage', { p_tip: t.id, p_action: 'reject', p_notes: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Tip rejected.', 'success')
    void refresh()
  }

  const close = async (t: TipRow) => {
    const notes = await uiPrompt('Close this tip? Optional disposition notes are recorded.', {
      title: 'Close tip', placeholder: 'Disposition (optional)', confirmText: 'Close tip',
    })
    if (notes === null) return
    const res = await rpc('tip_triage', { p_tip: t.id, p_action: 'close', p_notes: notes.trim() || undefined })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Tip closed.', 'success')
    void refresh()
  }

  if (state !== 'in') return <Notice text="Sign in to view intelligence tips." />

  return (
    <section className="view-in space-y-4">
      <Card pad="lg">
        <PageHeader
          title="Intel Tips"
          subtitle="Tips & patrol submissions — one triage queue into cases and the observation pipeline."
        />
      </Card>

      <SubmitTipForm myCases={mine} onSaved={refresh} />

      <Card pad="sm" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Triage queue</h2>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter tips by status">
            {[{ key: 'open', label: 'Open' }, ...TIP_STATUSES.map((s) => ({ key: s, label: humanize(s) })), { key: 'all', label: 'All' }].map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`inline-flex min-h-[40px] items-center rounded-full border px-3 text-xs font-semibold transition ${
                  filter === f.key
                    ? 'border-amber-400/30 bg-amber-500/15 text-amber-200'
                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {err != null && tips === null ? (
          <ErrorNotice message={err} onRetry={() => void refresh()} />
        ) : tips === null ? (
          <ListSkeleton count={4} />
        ) : !rows.length ? (
          <EmptyState title="No tips in this view." hint="Submitted tips are visible to you, the assigned detective, command, and — when case-linked — the case team." />
        ) : rows.map((t) => (
          <TipRowCard
            key={t.id}
            t={t}
            links={linksByTip.get(t.id) ?? []}
            source={sourceByTip.get(t.id)}
            caseNumber={t.case_id ? caseNums[t.case_id] : undefined}
            canTriage={canTriage(t)}
            nameOf={nameOf}
            persons={persons} vehicles={vehicles} places={places} gangs={gangs}
            onReview={() => setTriage({ tip: t, action: 'review' })}
            onAccept={() => setTriage({ tip: t, action: 'accept' })}
            onReject={() => void reject(t)}
            onClose={() => void close(t)}
            onChanged={refresh}
          />
        ))}
      </Card>

      {triage && (
        <TriageModal
          tip={triage.tip}
          action={triage.action}
          myCases={myCases}
          onClose={() => setTriage(null)}
          onDone={() => { setTriage(null); void refresh() }}
        />
      )}
    </section>
  )
}

/* ── Submit form ──────────────────────────────────────────────────────────── */

function SubmitTipForm({ myCases, onSaved }: { myCases: CaseOption[]; onSaved: () => void }) {
  const [kind, setKind] = useState('tip')
  const [sourceType, setSourceType] = useState('cid_detective')
  const [summary, setSummary] = useState('')
  const [details, setDetails] = useState('')
  const [urgency, setUrgency] = useState('medium')
  const [observedAt, setObservedAt] = useState('')
  const [locationText, setLocationText] = useState('')
  const [caseId, setCaseId] = useState('')
  const [srcName, setSrcName] = useState('')
  const [srcContact, setSrcContact] = useState('')
  const [srcNotes, setSrcNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!summary.trim()) { toast('A summary is required.', 'warn'); return }
    setBusy(true)
    const observedIso = observedAt.trim() ? new Date(observedAt).toISOString() : null
    const res = await insert('intelligence_tips', {
      kind,
      source_type: sourceType,
      summary: summary.trim(),
      details: details.trim() || null,
      urgency,
      observed_at: observedIso,
      location_text: locationText.trim() || null,
      case_id: caseId || null,
    })
    if (res.error) { setBusy(false); toast(res.error.message, 'danger'); return }
    const tip = res.data?.[0]
    // Confidential-source identity rides in its own, stricter table — the tip
    // stays useful even if this second insert is denied.
    if (tip && sourceType === 'confidential_source' && (srcName.trim() || srcContact.trim() || srcNotes.trim())) {
      const src = await insert('intelligence_tip_sources', {
        tip_id: tip.id,
        source_name: srcName.trim() || null,
        source_contact: srcContact.trim() || null,
        handler_notes: srcNotes.trim() || null,
      })
      if (src.error) toast(`Tip filed, but the source identity could not be saved: ${src.error.message}`, 'warn')
    }
    setBusy(false)
    setSummary(''); setDetails(''); setObservedAt(''); setLocationText(''); setCaseId('')
    setSrcName(''); setSrcContact(''); setSrcNotes('')
    toast('Tip submitted for triage.', 'success')
    onSaved()
  }

  return (
    <Card pad="sm" className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Submit a tip</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Kind">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="tip">Tip</option>
              <option value="patrol_submission">Patrol submission</option>
            </Select>
          )}
        </Field>
        <Field label="Source">
          {(id) => (
            <Select id={id} value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
              {['cid_detective', 'patrol', 'confidential_source'].map((s) => (
                <option key={s} value={s}>{TIP_SOURCE_LABEL[s]}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Urgency">
          {(id) => (
            <Select id={id} value={urgency} onChange={(e) => setUrgency(e.target.value)}>
              {['low', 'medium', 'high', 'critical'].map((u) => <option key={u} value={u}>{humanize(u)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Observed at (optional)">
          {(id) => <Input id={id} type="datetime-local" value={observedAt} onChange={(e) => setObservedAt(e.target.value)} />}
        </Field>
      </div>
      <Field label="Summary" required>
        {(id) => <Input id={id} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="One line — what was reported" />}
      </Field>
      <Field label="Details (optional)">
        {(id) => <Textarea id={id} rows={2} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="The full account, verbatim where possible" />}
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Location (optional)">
          {(id) => <Input id={id} value={locationText} onChange={(e) => setLocationText(e.target.value)} />}
        </Field>
        <Field label="Attach to one of my cases (optional)">
          {(id) => (
            <Select id={id} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">— none —</option>
              {myCases.map((c) => <option key={c.id} value={c.id}>{c.case_number} · {c.title || ''}</option>)}
            </Select>
          )}
        </Field>
      </div>
      {sourceType === 'confidential_source' && (
        <div className="space-y-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
          <p className="text-xs text-amber-200">
            Source identity is stored separately behind a stricter wall — handler (you), the assigned detective, command and the owner only. It is never exposed through case visibility.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Source name">
              {(id) => <Input id={id} value={srcName} onChange={(e) => setSrcName(e.target.value)} />}
            </Field>
            <Field label="Contact">
              {(id) => <Input id={id} value={srcContact} onChange={(e) => setSrcContact(e.target.value)} />}
            </Field>
          </div>
          <Field label="Handler notes">
            {(id) => <Textarea id={id} rows={2} value={srcNotes} onChange={(e) => setSrcNotes(e.target.value)} />}
          </Field>
        </div>
      )}
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => void save()} disabled={busy || !summary.trim()}>
          {busy ? 'Submitting…' : 'Submit tip'}
        </Button>
      </div>
    </Card>
  )
}

/* ── Queue row ────────────────────────────────────────────────────────────── */

function TipRowCard({ t, links, source, caseNumber, canTriage, nameOf, persons, vehicles, places, gangs, onReview, onAccept, onReject, onClose, onChanged }: {
  t: TipRow
  links: TipLinkRow[]
  source: TipSourceRow | undefined
  caseNumber: string | undefined
  canTriage: boolean
  nameOf: (id: string) => string
  persons: PickOption[]
  vehicles: PickOption[]
  places: PickOption[]
  gangs: PickOption[]
  onReview: () => void
  onAccept: () => void
  onReject: () => void
  onClose: () => void
  onChanged: () => void
}) {
  const [addOpen, setAddOpen] = useState(false)
  const [kind, setKind] = useState('person')
  const [refId, setRefId] = useState('')
  const open = t.status === 'new' || t.status === 'reviewing'
  const options = kind === 'person' ? persons : kind === 'vehicle' ? vehicles : kind === 'place' ? places : gangs

  const addLink = async () => {
    if (!refId) return
    const res = await insert('intelligence_tip_links', { tip_id: t.id, kind, ref_id: refId })
    if (res.error) {
      toast(res.error.code === '23505' ? 'Already linked.' : res.error.message, res.error.code === '23505' ? 'warn' : 'danger')
      return
    }
    setRefId('')
    onChanged()
  }

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tint={statusTint(t.status === 'new' ? 'open' : t.status === 'reviewing' ? 'in_progress' : t.status === 'rejected' ? 'archived' : t.status)}>
          {humanize(t.status)}
        </Badge>
        <Badge>{t.kind === 'patrol_submission' ? 'Patrol' : 'Tip'}</Badge>
        <Badge tint={priorityTint(t.urgency)}>{humanize(t.urgency)}</Badge>
        <Badge>{TIP_SOURCE_LABEL[t.source_type] ?? humanize(t.source_type)}</Badge>
        {t.case_id && caseNumber && (
          <Link href={caseLink(t.case_id)} className="rounded-full bg-blue-500/10 px-2 py-0.5 font-mono text-[11px] text-blue-300 hover:underline">
            {caseNumber}
          </Link>
        )}
        <span className="ml-auto text-xs text-slate-400">{timeAgo(t.created_at)}</span>
      </div>
      <p className="mt-1.5 text-sm font-semibold text-white">{t.summary}</p>
      {t.details && <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-300">{t.details}</p>}
      <p className="mt-1 text-xs text-slate-400">
        By {officerName(t.created_by) || 'unknown'}
        {t.assigned_to ? ` · assigned to ${officerName(t.assigned_to) || 'a detective'}` : ''}
        {t.observed_at ? ` · observed ${fmtDateTime(t.observed_at)}` : ''}
        {t.location_text ? ` · 📍 ${t.location_text}` : ''}
      </p>
      {t.disposition && <p className="mt-1 text-xs text-slate-400">Disposition: {t.disposition} ({officerName(t.decided_by) || 'command'})</p>}
      {links.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
          {links.map((l) => (
            <span key={l.id} className="rounded-full bg-white/5 px-2 py-0.5 text-slate-300">
              {humanize(l.kind)}: {nameOf(l.ref_id)}
            </span>
          ))}
        </div>
      )}
      {/* Source panel — renders ONLY when the stricter RLS returned a row. */}
      {source && (
        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-xs">
          <p className="font-semibold text-amber-200">Confidential source (restricted)</p>
          <p className="mt-0.5 text-slate-300">
            {source.source_name || 'Unnamed source'}
            {source.source_contact ? ` · ${source.source_contact}` : ''}
          </p>
          {source.handler_notes && <p className="mt-0.5 text-slate-400">{source.handler_notes}</p>}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canTriage && open && (
          <>
            {t.status === 'new' && <Button size="sm" onClick={onReview}>Review…</Button>}
            <Button size="sm" variant="success" onClick={onAccept}>Accept…</Button>
            <Button size="sm" variant="danger" onClick={onReject}>Reject</Button>
            <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
          </>
        )}
        {open && (
          <button
            type="button"
            onClick={() => setAddOpen((v) => !v)}
            aria-expanded={addOpen}
            className="ml-auto inline-flex min-h-[40px] items-center rounded px-2 text-[11px] font-semibold text-slate-400 transition hover:text-slate-200 sm:min-h-0"
          >
            {addOpen ? 'Close' : '+ Link entity'}
          </button>
        )}
      </div>
      {addOpen && (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-white/5 pt-2">
          <Field label="Kind" className="w-32">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => { setKind(e.target.value); setRefId('') }}>
                <option value="person">Person</option>
                <option value="vehicle">Vehicle</option>
                <option value="place">Place</option>
                <option value="gang">Gang</option>
              </Select>
            )}
          </Field>
          <Field label="Record" className="min-w-48 flex-1">
            {(id) => (
              <Select id={id} value={refId} onChange={(e) => setRefId(e.target.value)}>
                <option value="">Select…</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </Select>
            )}
          </Field>
          <Button size="sm" onAction={addLink} disabled={!refId}>Add</Button>
        </div>
      )}
    </div>
  )
}

/* ── Triage modal (review / accept) ───────────────────────────────────────── */

function TriageModal({ tip, action, myCases, onClose, onDone }: {
  tip: TipRow
  action: 'review' | 'accept'
  myCases: CaseOption[]
  onClose: () => void
  onDone: () => void
}) {
  const [assign, setAssign] = useState(tip.assigned_to ?? '')
  const [caseId, setCaseId] = useState(tip.case_id ?? '')
  const [createObservation, setCreateObservation] = useState(false)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (action === 'accept' && createObservation && !caseId && !tip.case_id) {
      toast('Creating an observation requires a case.', 'warn')
      return
    }
    setBusy(true)
    const res = await rpc('tip_triage', {
      p_tip: tip.id,
      p_action: action,
      p_notes: notes.trim() || undefined,
      p_assign: action === 'review' ? (assign || undefined) : undefined,
      p_case: action === 'accept' ? (caseId || undefined) : undefined,
      p_create_observation: action === 'accept' ? createObservation : false,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(action === 'review' ? 'Tip moved to reviewing.' : 'Tip accepted.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => notes.trim().length > 0}>
      <div className="p-6">
        <ModalHeader title={action === 'review' ? 'Review tip' : 'Accept tip'} onClose={onClose} />
        <p className="mb-4 text-sm text-slate-300">{tip.summary}</p>
        <div className="space-y-3">
          {action === 'review' && (
            <Field label="Assign to (optional — defaults to you)">
              {(id) => (
                <Select id={id} value={assign} onChange={(e) => setAssign(e.target.value)}>
                  <option value="">— me —</option>
                  {activeProfiles().map((p) => <option key={p.id} value={p.id}>{officerName(p.id) || p.display_name}</option>)}
                </Select>
              )}
            </Field>
          )}
          {action === 'accept' && (
            <>
              <Field label="Attach to case (optional)">
                {(id) => (
                  <Select id={id} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                    <option value="">{tip.case_id ? '— keep current case —' : '— none —'}</option>
                    {myCases.map((c) => <option key={c.id} value={c.id}>{c.case_number} · {c.title || ''}</option>)}
                  </Select>
                )}
              </Field>
              <label className="inline-flex min-h-[40px] items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={createObservation} onChange={(e) => setCreateObservation(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                Create an (unverified) observation on the case from this tip
              </label>
            </>
          )}
          <Field label={action === 'review' ? 'Triage notes (optional)' : 'Disposition notes (optional)'}>
            {(id) => <Textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void run()} disabled={busy}>
            {busy ? 'Working…' : action === 'review' ? 'Start review' : 'Accept tip'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
