'use client'

/** Vehicle profile — panelled drill-down for a single plate (`?vehicle=`).
 *  Left: identity card (round icon tile, model, mono plate) over a labelled
 *  key-value list, then notes. Right: the structured Legal section (RLS-safe
 *  legal_request_exhibits vehicle targets — EntityLegalPanel) and derived
 *  linked cases — there is no vehicle↔case join, so the panel scans RLS-scoped
 *  report fields for the plate string (CrossrefPanel's approach) and folds in
 *  cases linked to the registered owner via case_intel_links. Both fail
 *  CLOSED: any query error shows a Retry banner, never a false "nothing". */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { insert, list, remove, rpc, withRetry } from '@/lib/db'
import { caseLink } from '@/lib/caseLinks'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { pushRecent } from '@/lib/recents'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { copyText, fmtDate, timeAgo } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { uiConfirm } from '@/components/ui/dialog'
import { WatchButton } from '@/components/cases/WatchButton'
import { RestrictToSiuButton } from '@/components/siu/RestrictToSiu'
import { EntityLegalPanel } from '@/components/justice/EntityLegalSection'
import { ObservationHistory } from '@/components/shared/ObservationHistory'
import { LinkEditPopover, LinkStatusBadge } from '@/components/shared/LinkEditPopover'
import { PinButton } from '@/components/shared/PinButton'
import { RecordPeekButton } from '@/components/shared/RecordPeekButton'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'
import { useToolNav } from '@/components/tools/useToolNav'
import {
  CONFIDENCE_LEVELS, LINK_STATUSES, VEHICLE_ROLES, confidenceLabel, linkStatusLabel, vehicleRoleLabel,
} from '@/components/persons/personIntel'
import { VehicleModal } from './VehiclesView'

type VehicleRow = Tables<'vehicles'>

/* ---- colour swatch --------------------------------------------------------
   `color` is a free-text name, not a hex. Map ~16 common names to a CSS
   swatch (case-insensitive substring; longest name wins, and compound names
   like navy/maroon are listed before their generic tone so "navy blue" reads
   navy). Unmatched text keeps a neutral dot. */
const COLOR_SWATCHES: Record<string, string> = {
  navy: '#1e3a8a', maroon: '#7f1d1d', silver: '#cbd5e1', beige: '#e7dcc7',
  yellow: '#facc15', orange: '#f97316', purple: '#9333ea', brown: '#78350f',
  black: '#111827', white: '#f8fafc', green: '#16a34a', gold: '#d4af37',
  gray: '#9ca3af', grey: '#9ca3af', blue: '#3b82f6', red: '#dc2626', tan: '#d2b48c',
}

function colorSwatch(color: string): string | null {
  const c = color.toLowerCase()
  const names = Object.keys(COLOR_SWATCHES).filter((n) => c.includes(n))
  if (!names.length) return null
  names.sort((a, b) => b.length - a.length) // stable: object order breaks ties
  return COLOR_SWATCHES[names[0]]
}

/* ---- building blocks ---------------------------------------------------- */

const PANEL_TITLE = 'text-[11px] font-semibold uppercase tracking-wider text-blue-300/70'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm text-slate-200">{children}</dd>
    </div>
  )
}

/* ---- derived linked-cases panel ------------------------------------------
   (a) plate string appearing in reports.fields JSON (word-boundary match,
       same escaping as CrossrefPanel), (b) cases linked to the OWNER person
       via case_intel_links kind='person'. Deduped by case id; both reasons
       shown when a case matches twice. All inputs RLS-scoped. */

type MatchReason = 'plate mentioned' | 'owner linked'
interface CaseMeta { id: string; case_number: string; title: string | null }
interface LinkedCase { id: string; reasons: MatchReason[]; meta: CaseMeta | null }

function LinkedCasesPanel({ plate, ownerId }: { plate: string; ownerId: string | null }) {
  const router = useRouter()
  const [scan, setScan] = useState<'loading' | 'failed' | 'done'>('loading')
  const [rows, setRows] = useState<LinkedCase[]>([])
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(async () => {
      setScan('loading')
      try {
        // Fail-closed: no per-query .catch(() => []) here — a degraded leg
        // would masquerade as an authoritative "no linked cases".
        const [reports, links] = await Promise.all([
          // Bounded scan: the plate match only needs case_id + fields, and the
          // reports table grows without bound — read the newest 500 rows
          // instead of every column of every report the viewer can see.
          list('reports', { select: 'case_id,fields', order: 'created_at', ascending: false, limit: 500 })
            .then((r) => r as unknown as Pick<Tables<'reports'>, 'case_id' | 'fields'>[]),
          ownerId
            ? list('case_intel_links', { select: 'case_id', eq: { kind: 'person', ref_id: ownerId } })
                .then((r) => r as unknown as { case_id: string }[])
            : Promise.resolve([] as { case_id: string }[]),
        ])
        const reasons = new Map<string, Set<MatchReason>>()
        const add = (cid: string, why: MatchReason) => {
          const s = reasons.get(cid) ?? new Set<MatchReason>()
          s.add(why)
          reasons.set(cid, s)
        }
        const re = new RegExp('\\b' + plate.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')
        for (const r of reports) {
          if (r.case_id && re.test(JSON.stringify(r.fields ?? {}).toUpperCase())) add(r.case_id, 'plate mentioned')
        }
        for (const l of links) add(l.case_id, 'owner linked')
        const ids = [...reasons.keys()]
        const cases = ids.length
          ? ((await list('cases', { select: 'id,case_number,title', in: { id: ids } })) as unknown as CaseMeta[])
          : []
        if (cancelled) return
        const byId = new Map(cases.map((c) => [c.id, c]))
        const out: LinkedCase[] = ids.map((id) => ({ id, reasons: [...(reasons.get(id) ?? [])], meta: byId.get(id) ?? null }))
        out.sort((a, b) => (a.meta?.case_number ?? '').localeCompare(b.meta?.case_number ?? ''))
        setRows(out)
        setScan('done')
      } catch {
        if (!cancelled) setScan('failed')
      }
    }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [plate, ownerId, retry])

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className={PANEL_TITLE}>Linked cases</h3>
        {scan === 'done' && rows.length > 0 && <span className="text-[11px] text-slate-400">{rows.length}</span>}
      </div>
      {scan === 'loading' ? (
        <div role="status" aria-busy="true" className="space-y-2">
          <span className="sr-only">Scanning case reports…</span>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : scan === 'failed' ? (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          ⚠ Could not scan case reports for this plate (connection issue).{' '}
          <button onClick={() => setRetry((n) => n + 1)} className="rounded p-1 font-semibold underline">Retry</button>
        </div>
      ) : !rows.length ? (
        <EmptyState
          title="NO LINKED CASES"
          hint="Cases appear here when a report mentions this plate or the registered owner is linked to a case."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) =>
            r.meta ? (
              <button
                key={r.id}
                onClick={() => router.push(`/cases?case=${r.id}`)}
                className="flex min-h-[44px] w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5 text-left text-sm transition hover:bg-white/5"
              >
                <span className="font-mono text-blue-300">{r.meta.case_number}</span>
                <span className="min-w-0 flex-1 truncate text-slate-200">{r.meta.title || 'Untitled case'}</span>
                {r.reasons.map((why) => (
                  <Badge key={why} tone={why === 'plate mentioned' ? 'warn' : 'accent'}>{why}</Badge>
                ))}
              </button>
            ) : (
              // Belt-and-braces: an id from an RLS-visible report whose case
              // row still isn't readable renders as a restricted stub.
              <div key={r.id} className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5 text-sm text-slate-400">
                Linked case — access restricted (other bureau).
              </div>
            ),
          )}
        </div>
      )}
    </Card>
  )
}

/* ---- photos strip ---------------------------------------------------------
   media.vehicle_id is a typed FK (RLS trims what the viewer may see). Live
   rows only (archived hidden); image thumbs click through to the source
   case's Photos & Media tab, caseless rows open the hosted file. */

type VehicleMediaRow = Pick<Tables<'media'>, 'id' | 'title' | 'type' | 'external_url' | 'storage_path' | 'case_id'>

function VehiclePhotosPanel({ vehicleId }: { vehicleId: string }) {
  const [rows, setRows] = useState<VehicleMediaRow[] | null>(null)
  const vMedia = useTableVersion('media')
  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(async () => {
      const m = await list('media', {
        select: 'id,title,type,external_url,storage_path,case_id',
        eq: { vehicle_id: vehicleId },
        is: { archived_at: null },
        order: 'created_at', ascending: false, limit: 12,
      }).then((r) => r as unknown as VehicleMediaRow[]).catch(() => [] as VehicleMediaRow[])
      if (!cancelled) setRows(m)
    }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [vehicleId, vMedia])

  if (!rows?.length) return null
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className={PANEL_TITLE}>Photos</h3>
        <span className="text-[11px] text-slate-400">{rows.length}</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {rows.map((m) => {
          const url = safeUrl(m.external_url || m.storage_path || '')
          const tile = m.type === 'image' && url
            // eslint-disable-next-line @next/next/no-img-element -- external media URL
            ? <img src={url} alt={m.title} loading="lazy" className="h-20 w-20 rounded-lg border border-white/10 object-cover transition hover:brightness-110" />
            : <span aria-hidden className="flex h-20 w-20 items-center justify-center rounded-lg border border-white/10 bg-ink-800 text-2xl">{m.type === 'video' ? '🎬' : '📄'}</span>
          return (
            <li key={m.id}>
              {m.case_id ? (
                <Link href={caseLink(m.case_id, 'media')} title={`${m.title} — open source case`} aria-label={`${m.title} — open source case`}>{tile}</Link>
              ) : url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" title={m.title} aria-label={`Open ${m.title}`}>{tile}</a>
              ) : (
                <span title={m.title}>{tile}</span>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

/* ---- linked people (person_vehicles) -------------------------------------
   The non-owner person↔vehicle relations (driver / passenger / seen-using…)
   read from the person dossier's Vehicles section were invisible from the
   vehicle side. This panel shows them, editable in BOTH directions: the same
   link row can be promoted/marked Historical here or on the person profile.
   Registered ownership stays on the vehicle record itself (VehicleModal). */

type PersonVehicleLink = Tables<'person_vehicles'>
interface PersonLiteRow { id: string; name: string | null; alias: string | null; lifecycle: string }

function VehiclePersonsPanel({ vehicleId, canEdit }: { vehicleId: string; canEdit: boolean }) {
  const nav = useToolNav()
  const { profile, isCommand } = useAuth()
  const [links, setLinks] = useState<PersonVehicleLink[] | null>(null)
  const [people, setPeople] = useState<Map<string, PersonLiteRow>>(new Map())
  const [linkOpen, setLinkOpen] = useState(false)
  const [editLink, setEditLink] = useState<PersonVehicleLink | null>(null)
  const v = useTableVersion('person_vehicles')

  const load = useCallback(async () => {
    const rows = await list('person_vehicles', { eq: { vehicle_id: vehicleId }, order: 'created_at', ascending: false })
      .catch(() => [] as PersonVehicleLink[])
    setLinks(rows)
    const ids = [...new Set(rows.map((l) => l.person_id))]
    const persons = ids.length
      ? await list('persons', { select: 'id,name,alias,lifecycle', in: { id: ids } })
          .then((r) => r as unknown as PersonLiteRow[]).catch(() => [] as PersonLiteRow[])
      : []
    setPeople(new Map(persons.map((p) => [p.id, p])))
  }, [vehicleId])
  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load, v])

  const unlink = async (l: PersonVehicleLink) => {
    if (!(await uiConfirm('Remove this person link? If the association simply ended, prefer editing the link and marking it Historical — both records are kept either way.', { confirmText: 'Unlink' }))) return
    const res = await remove('person_vehicles', l.id)
    if (res.error) { toast(`Unlink failed: ${res.error.message}`, 'danger'); return }
    toast('Person unlinked', 'success')
    void load()
  }

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className={PANEL_TITLE}>Linked people</h3>
        <div className="flex items-center gap-2">
          {links && links.length > 0 && <span className="text-[11px] text-slate-400">{links.length}</span>}
          {canEdit && <Button size="sm" onClick={() => setLinkOpen(true)}>Link person</Button>}
        </div>
      </div>
      {links === null ? (
        <div role="status" aria-busy="true" className="space-y-2">
          <span className="sr-only">Loading linked people…</span>
          <Skeleton className="h-11 w-full" />
        </div>
      ) : !links.length ? (
        <EmptyState
          title="NO LINKED PEOPLE"
          hint={canEdit
            ? 'Use "Link person" for driver / passenger / seen-using relations. Registered ownership is set with Edit on the vehicle.'
            : 'Driver / passenger / seen-using relations recorded on the person dossier appear here.'}
        />
      ) : (
        <div className="space-y-2">
          {links.map((l) => {
            const p = people.get(l.person_id)
            const mayManage = isCommand || (!!l.created_by && l.created_by === profile?.id)
            return (
              <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {p ? (
                      <button onClick={() => nav.openRecord('persons', l.person_id, p.name || undefined)} className="text-sm font-semibold text-white hover:text-blue-200">
                        {p.name || 'Person'}
                      </button>
                    ) : (
                      /* RLS returned nothing for this id — restricted stub. */
                      <span className="text-sm text-slate-400">Linked person — access restricted.</span>
                    )}
                    <RecordPeekButton type="person" id={l.person_id} label={p?.name || 'Person'} />
                    <Badge tone="neutral">{vehicleRoleLabel(l.role)}</Badge>
                    <LinkStatusBadge status={l.link_status} />
                    <StatusBadge domain="confidence" value={l.confidence ?? 'unverified'} />
                    {l.provenance && <StatusBadge domain="provenance" value={l.provenance} />}
                  </div>
                  {l.note && <p className="mt-0.5 text-xs text-slate-400">{l.note}</p>}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {canEdit && mayManage && (
                    <button onClick={() => setEditLink(l)} className="text-[11px] font-semibold text-blue-300 hover:text-blue-200" title="Edit role, confidence, status, or note">Edit</button>
                  )}
                  {mayManage && (
                    <button onClick={() => void unlink(l)} className="text-[11px] text-rose-300 hover:text-rose-200">Unlink</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editLink && (
        <LinkEditPopover
          title="Edit person link"
          table="person_vehicles"
          id={editLink.id}
          role={editLink.role}
          roleOptions={VEHICLE_ROLES}
          roleLabel={vehicleRoleLabel}
          roleRequired
          status={editLink.link_status}
          confidence={editLink.confidence}
          note={editLink.note}
          onClose={() => setEditLink(null)}
          onSaved={() => { setEditLink(null); void load() }}
        />
      )}
      {linkOpen && (
        <LinkPersonToVehicleModal
          vehicleId={vehicleId}
          existing={links ?? []}
          onClose={() => setLinkOpen(false)}
          onSaved={() => { setLinkOpen(false); void load() }}
        />
      )}
    </Card>
  )
}

/** Link a person to this vehicle — the mirror of the person dossier's
 *  LinkVehicleModal: indexed search_persons RPC picker + a REQUIRED role.
 *  The pair-unique key backs the friendly duplicate message. */
function LinkPersonToVehicleModal({ vehicleId, existing, onClose, onSaved }: {
  vehicleId: string
  existing: PersonVehicleLink[]
  onClose: () => void
  onSaved: () => void
}) {
  const [picked, setPicked] = useState<PickedRecord | null>(null)
  const [role, setRole] = useState<string>('seen_using')
  const [linkStatus, setLinkStatus] = useState('current')
  const [confidence, setConfidence] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const linked = useMemo(() => new Set(existing.map((l) => l.person_id)), [existing])
  const searchPersons = useCallback(async (q: string): Promise<PickedRecord[]> => {
    const query = q.trim()
    const toPicks = (rows: PersonLiteRow[]) => rows
      .filter((r) => r.lifecycle !== 'merged' && !linked.has(r.id))
      .map<PickedRecord>((r) => ({ id: r.id, label: r.name || 'Person', ...(r.alias ? { sublabel: `“${r.alias}”` } : {}) }))
    if (!query) {
      const rows = await list('persons', { select: 'id,name,alias,lifecycle', order: 'created_at', ascending: false, limit: 12 })
        .then((r) => r as unknown as PersonLiteRow[]).catch(() => [] as PersonLiteRow[])
      return toPicks(rows)
    }
    const res = await rpc('search_persons', { p_q: query, p_limit: 12 })
    const hits = (res.data ?? []).map((h) => h.id)
    if (!hits.length) return []
    const rows = await list('persons', { select: 'id,name,alias,lifecycle', in: { id: hits } })
      .then((r) => r as unknown as PersonLiteRow[]).catch(() => [] as PersonLiteRow[])
    const order = new Map(hits.map((hid, i) => [hid, i]))
    return toPicks(rows).sort((x, y) => (order.get(x.id) ?? 99) - (order.get(y.id) ?? 99))
  }, [linked])

  const save = async () => {
    if (!picked) { toast('Pick a person first.', 'warn'); return }
    setBusy(true)
    const res = await insert('person_vehicles', {
      person_id: picked.id,
      vehicle_id: vehicleId,
      role,
      link_status: linkStatus,
      confidence: confidence || null,
      note: note.trim() || null,
    })
    setBusy(false)
    if (res.error) {
      toast(res.error.code === '23505' ? 'That person is already linked to this vehicle.' : `Link failed: ${res.error.message}`, 'danger')
      return
    }
    toast('Person linked', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!picked || !!note.trim()}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <ModalHeader title="Link person to vehicle" onClose={onClose} />
        <div className="space-y-3">
          <RecordSearchPicker
            label="Person"
            required
            placeholder="Search name, alias, phone, plate…"
            value={picked}
            onChange={setPicked}
            search={searchPersons}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Role" required hint="Ownership is set on the vehicle record itself.">
              {(id) => (
                <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                  {VEHICLE_ROLES.map((r) => <option key={r} value={r}>{vehicleRoleLabel(r)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Status">
              {(id) => (
                <Select id={id} value={linkStatus} onChange={(e) => setLinkStatus(e.target.value)}>
                  {LINK_STATUSES.map((s) => <option key={s} value={s}>{linkStatusLabel(s)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Confidence" className="sm:col-span-2">
              {(id) => (
                <Select id={id} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
                  <option value="">— Unverified —</option>
                  {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{confidenceLabel(c)}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Note">{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="How is this known?" />}</Field>
          <Button variant="primary" className="w-full" loading={busy} disabled={!picked} onClick={() => void save()}>Link person</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ---- profile view -------------------------------------------------------- */

export function VehicleProfile({ id, onBack }: { id: string; onBack: () => void }) {
  const { state, canEdit } = useAuth()
  const nav = useToolNav()
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const [ownerName, setOwnerName] = useState<string | null>(null)
  const [gangName, setGangName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const vVehicles = useTableVersion('vehicles')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      // Primary lookup stays unwrapped (real error message, not "not found");
      // owner/gang name lookups are bounded in:{id} probes on just the linked
      // ids and degrade to null like the old best-effort option fetches.
      const v = await withRetry(() => list('vehicles', { eq: { id } }))
      if (!v[0]) throw new Error('Vehicle not found — it may have been deleted.')
      setVehicle(v[0])
      const [p, g] = await Promise.all([
        v[0].owner_id ? list('persons', { select: 'id,name', in: { id: [v[0].owner_id] } }).catch(() => []) : Promise.resolve([]),
        v[0].gang_id ? list('gangs', { select: 'id,name', in: { id: [v[0].gang_id] } }).catch(() => []) : Promise.resolve([]),
      ])
      setOwnerName((p as unknown as { id: string; name: string }[])[0]?.name ?? null)
      setGangName((g as unknown as { id: string; name: string }[])[0]?.name ?? null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state, id])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vVehicles])

  // Deliberate open of this profile — record it in the recents trail.
  useEffect(() => { pushRecent('vehicle', id) }, [id])

  const v = vehicle
  const owner = v?.owner_id ? ownerName : null
  const gang = v?.gang_id ? gangName : null
  const swatch = v?.color ? colorSwatch(v.color) : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs items={[{ label: 'Vehicles', onClick: onBack }, { label: v?.plate ?? 'Vehicle' }]} />
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <WatchButton type="vehicle" id={id} label={v?.plate} />
          <PinButton type="vehicle" id={id} label={v?.plate} />
          {canEdit && v && <Button onClick={() => setEditing(true)}>Edit</Button>}
          <RestrictToSiuButton type="vehicle" id={id} />
        </div>
      </div>

      {loading ? (
        <div role="status" aria-busy="true" className="flex flex-col gap-4 lg:flex-row">
          <span className="sr-only">Loading vehicle…</span>
          <div className="space-y-4 lg:w-80 lg:flex-shrink-0">
            <Card>
              <Skeleton className="mx-auto h-16 w-16 rounded-full" />
              <Skeleton className="mx-auto mt-3 h-5 w-2/3" />
              <Skeleton className="mx-auto mt-2 h-6 w-1/3" />
              <div className="mt-5 space-y-3">
                {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-4 w-full" />)}
              </div>
            </Card>
            <Card>
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="mt-3 h-3 w-full" />
            </Card>
          </div>
          <div className="min-w-0 flex-1">
            <Card>
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="mt-3 h-11 w-full" />
              <Skeleton className="mt-2 h-11 w-full" />
            </Card>
          </div>
        </div>
      ) : err || !v ? (
        <ErrorNotice message={err ?? 'Vehicle not found.'} onRetry={() => void refresh()} />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* LEFT — identity + key-values, then notes. Owner lives here only
              (no separate right-hand Owner panel — avoids duplication). */}
          <div className="space-y-4 lg:w-80 lg:flex-shrink-0">
            <Card className="text-center">
              <div aria-hidden className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-ink-800 text-3xl">🚗</div>
              <h2 className="mt-3 text-xl font-black text-white">{v.model || 'Unknown model'}</h2>
              <p className="mt-2 inline-block rounded-md border border-white/15 bg-ink-800 px-2.5 py-1 font-mono text-sm font-bold tracking-widest text-white">{v.plate}</p>
              <dl className="mt-5 divide-y divide-white/5 border-t border-white/5 text-left">
                <Row label="Model">{v.model || <span className="text-slate-400">Unknown</span>}</Row>
                <Row label="Plate">
                  <button
                    onClick={() => copyText(v.plate, 'Plate')}
                    title="Copy plate"
                    className="-my-1 rounded px-1 py-1 font-mono font-bold tracking-widest text-white transition hover:bg-white/5 hover:text-badge-200"
                  >
                    {v.plate}
                  </button>
                </Row>
                <Row label="Color">
                  {v.color ? (
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden
                        className="h-3.5 w-3.5 flex-shrink-0 rounded-full border border-white/25"
                        style={{ backgroundColor: swatch ?? 'rgba(255,255,255,0.12)' }}
                      />
                      {v.color}
                    </span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </Row>
                <Row label="Owner">
                  {owner && v.owner_id ? (
                    <button
                      onClick={() => nav.openRecord('persons', v.owner_id!, owner)}
                      className="-my-1 rounded px-1 py-1 text-blue-300 transition hover:text-blue-200"
                    >
                      👤 {owner}
                    </button>
                  ) : (
                    <span className="text-slate-400">Unknown</span>
                  )}
                </Row>
                <Row label="Gang">
                  {gang ? (
                    <button
                      onClick={() => nav.openHref(`/gangs?q=${encodeURIComponent(gang)}`)}
                      className="rounded-md bg-violet-500/10 px-2 py-1 text-[11px] text-violet-300 transition hover:bg-violet-500/20"
                    >
                      🚩 {gang}
                    </button>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </Row>
                <Row label="Added">{fmtDate(v.created_at)}</Row>
                <Row label="Updated">{timeAgo(v.updated_at)}</Row>
              </dl>
            </Card>
            <Card>
              <h3 className={PANEL_TITLE}>Notes</h3>
              {v.notes
                ? <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{v.notes}</p>
                : <p className="mt-2 text-sm text-slate-400">No notes.</p>}
            </Card>
          </div>

          {/* RIGHT — derived intelligence. Legal comes from the STRUCTURED
              legal_request_exhibits target rows (RLS-trimmed, sealed-safe);
              linked cases stay a text-scan derivation. */}
          <div className="min-w-0 flex-1 space-y-4">
            <VehiclePersonsPanel vehicleId={id} canEdit={canEdit} />
            <VehiclePhotosPanel vehicleId={id} />
            <EntityLegalPanel exhibitType="vehicle" sourceId={id} noun="vehicle" />
            <LinkedCasesPanel plate={v.plate} ownerId={v.owner_id} />
            {/* Verified-observation history (RLS-trimmed — restricted or
                out-of-scope rows simply never arrive). */}
            <Card>
              <h3 className={PANEL_TITLE}>Surveillance history</h3>
              <div className="mt-3">
                <ObservationHistory kind="vehicle" refId={id} />
              </div>
            </Card>
          </div>
        </div>
      )}

      {editing && v && (
        <VehicleModal
          record={v}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void refresh() }}
        />
      )}
    </div>
  )
}
