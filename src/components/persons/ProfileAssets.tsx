'use client'

/** Person dossier — Vehicles, Locations and Media sections plus their link
 *  modals. `vehicles.owner_id` stays the canonical registered owner (labelled
 *  as such); every other person↔vehicle relation is a person_vehicles row.
 *  Legacy `persons.properties` addresses are listed separately and are only
 *  ever migrated to Places by a human via the per-row "Link to Place…" action
 *  — never automatically, and the legacy row always stays. */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { insert, list, remove, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { fmConfigured, fmUpload } from '@/lib/fivemanage'
import { fmtDate } from '@/lib/format'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EntityLink } from '@/components/ui/EntityLink'
import { Field, Input, Select } from '@/components/ui/Field'
import { ConfidenceBadge, ProvenanceBadge } from '@/components/ui/IntelBadges'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/Notice'
import { PROVENANCE_KINDS, humanize } from '@/components/gangs/gangIntel'
import { CONFIDENCE_LEVELS, LINK_STATUSES, PLACE_ROLES, VEHICLE_ROLES, linkStatusLabel, placeRoleLabel, vehicleRoleLabel } from './personIntel'
import { parseProperties, type PersonRow, type PersonProperty } from './PersonModal'
import {
  PLACE_LITE_COLS, VEHICLE_LITE_COLS,
  type MediaRow, type PersonPlaceRow, type PersonVehicleRow, type PlaceLite, type PlacesData,
  type VehicleLite, type VehiclesData,
} from './profileLoad'

const linkStatusTint = (s: string) =>
  s === 'current' ? 'bg-emerald-500/15 text-emerald-300' : s === 'disputed' ? 'bg-rose-500/15 text-rose-300' : 'bg-white/5 text-slate-400'

function canRemoveLink(createdBy: string | null, meId: string | undefined, isCommand: boolean): boolean {
  return isCommand || (!!createdBy && createdBy === meId)
}

// ── Vehicles ─────────────────────────────────────────────────────────────────
export function PersonVehiclesSection({ data, canEdit, onLink, onRefresh }: {
  data: VehiclesData
  canEdit: boolean
  onLink: () => void
  onRefresh: () => void
}) {
  const router = useRouter()
  const { profile, isCommand } = useAuth()

  const unlink = async (l: PersonVehicleRow) => {
    if (!(await uiConfirm('Unlink this vehicle from the person? The vehicle record itself is kept.', { confirmText: 'Unlink' }))) return
    const res = await remove('person_vehicles', l.id)
    if (res.error) { toast(`Unlink failed: ${res.error.message}`, 'danger'); return }
    toast('Vehicle unlinked', 'success')
    onRefresh()
  }

  const plateChip = (v: VehicleLite | undefined) => (
    <button
      onClick={() => v && router.push(`/vehicles?vehicle=${encodeURIComponent(v.id)}`)}
      className="flex-shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] font-bold text-badge-200 hover:bg-white/10"
      title="Open in the vehicle registry"
    >
      {v?.plate || 'Vehicle'}
    </button>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Vehicles</h3><Badge>{data.owned.length + data.links.length}</Badge></div>
        {canEdit && <Button size="sm" onClick={onLink}>Link vehicle</Button>}
      </div>
      {!data.owned.length && !data.links.length ? (
        <EmptyState title="No vehicles on file" hint={canEdit ? 'Registered vehicles appear automatically; use “Link vehicle” for driver/passenger/seen-using relations.' : undefined} />
      ) : (
        <div className="space-y-2">
          {data.owned.map((v) => (
            <Card key={v.id} pad="sm" className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {plateChip(v)}
                <span className="min-w-0 truncate text-sm text-slate-200">{[v.model, v.color].filter(Boolean).join(' · ') || 'Vehicle'}</span>
              </div>
              <Badge tone="accent" title="vehicles.owner_id — the canonical registration">Registered owner</Badge>
            </Card>
          ))}
          {data.links.map((l) => {
            const v = data.vehicles.get(l.vehicle_id)
            return (
              <Card key={l.id} pad="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {plateChip(v)}
                    <span className="text-sm text-slate-200">{[v?.model, v?.color].filter(Boolean).join(' · ')}</span>
                    <Badge tone="neutral">{vehicleRoleLabel(l.role)}</Badge>
                    <Badge tint={linkStatusTint(l.link_status)}>{linkStatusLabel(l.link_status)}</Badge>
                    <ConfidenceBadge confidence={l.confidence} />
                    <ProvenanceBadge provenance={l.provenance} />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {l.first_observed ? `First seen ${fmtDate(l.first_observed)} · ` : ''}
                    {l.last_confirmed ? `Confirmed ${fmtDate(l.last_confirmed)} · ` : ''}
                    Linked {fmtDate(l.created_at)}
                  </p>
                  {l.note && <p className="mt-0.5 text-xs text-slate-400">{l.note}</p>}
                </div>
                {canRemoveLink(l.created_by, profile?.id, isCommand) && (
                  <button onClick={() => void unlink(l)} className="flex-shrink-0 text-[11px] text-rose-300 hover:text-rose-200">Unlink</button>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Link vehicle — projected plate search + a REQUIRED role (person_vehicles
 *  is for non-owner relations; ownership is edited on the vehicle itself). */
export function LinkVehicleModal({ person, existing, onClose, onSaved }: {
  person: PersonRow
  existing: PersonVehicleRow[]
  onClose: () => void
  onSaved: () => void
}) {
  const [pool, setPool] = useState<VehicleLite[] | null>(null)
  const [q, setQ] = useState('')
  const [vehicleId, setVehicleId] = useState('')
  const [role, setRole] = useState<string>('seen_using')
  const [linkStatus, setLinkStatus] = useState('current')
  const [confidence, setConfidence] = useState('')
  const [provenance, setProvenance] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void list('vehicles', { select: VEHICLE_LITE_COLS, order: 'plate' })
      .then((r) => { if (live) setPool(r as unknown as VehicleLite[]) })
      .catch(() => { if (live) setPool([]) })
    return () => { live = false }
  }, [])

  const linked = useMemo(() => new Set(existing.map((l) => l.vehicle_id)), [existing])
  const needle = q.trim().toLowerCase()
  const options = useMemo(
    () => (pool ?? [])
      .filter((v) => !linked.has(v.id) && v.owner_id !== person.id)
      .filter((v) => !needle || [v.plate, v.model, v.color].some((s) => (s || '').toLowerCase().includes(needle)))
      .slice(0, 20),
    [pool, linked, needle, person.id],
  )

  const save = async () => {
    if (!vehicleId) { toast('Pick a vehicle first.', 'warn'); return }
    setBusy(true)
    const res = await insert('person_vehicles', {
      person_id: person.id,
      vehicle_id: vehicleId,
      role,
      link_status: linkStatus,
      confidence: confidence || null,
      provenance: provenance || null,
      note: note.trim() || null,
    })
    setBusy(false)
    if (res.error) {
      toast(res.error.code === '23505' ? 'This person is already linked to that vehicle.' : `Link failed: ${res.error.message}`, 'danger')
      return
    }
    toast('Vehicle linked', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!vehicleId || !!note.trim()}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <ModalHeader title={`Link vehicle — ${person.name}`} onClose={onClose} />
        <div className="space-y-3">
          <Field label="Search plate / model">
            {(id) => <Input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ABC123…" />}
          </Field>
          {pool === null ? (
            <p className="text-sm text-slate-400">Loading vehicles…</p>
          ) : options.length ? (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-white/5 bg-ink-900 p-1.5" role="listbox" aria-label="Vehicle results">
              {options.map((v) => (
                <button key={v.id} role="option" aria-selected={vehicleId === v.id} onClick={() => setVehicleId(v.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${vehicleId === v.id ? 'bg-badge-500/20 text-white' : 'text-slate-200 hover:bg-white/5'}`}>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] font-bold text-badge-200">{v.plate}</span>
                  <span className="min-w-0 truncate">{[v.model, v.color].filter(Boolean).join(' · ') || 'Vehicle'}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No unlinked vehicles match. Registered vehicles are already listed; new plates are added in the Vehicle Registry.</p>
          )}
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
                  {LINK_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Confidence">
              {(id) => (
                <Select id={id} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
                  <option value="">—</option>
                  {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Source">
              {(id) => (
                <Select id={id} value={provenance} onChange={(e) => setProvenance(e.target.value)}>
                  <option value="">—</option>
                  {PROVENANCE_KINDS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <Button variant="primary" className="w-full" loading={busy} disabled={!vehicleId} onClick={() => void save()}>Link vehicle</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Locations ─────────────────────────────────────────────────────────────────
export function PersonPlacesSection({ person, data, canEdit, onLink, onRefresh }: {
  person: PersonRow
  data: PlacesData
  canEdit: boolean
  /** Open the link modal, optionally prefilled from a legacy property row. */
  onLink: (legacy?: PersonProperty) => void
  onRefresh: () => void
}) {
  const { profile, isCommand } = useAuth()
  const legacy = useMemo(() => parseProperties(person.properties), [person.properties])

  const unlink = async (l: PersonPlaceRow) => {
    if (!(await uiConfirm('Unlink this place from the person? The place record itself is kept.', { confirmText: 'Unlink' }))) return
    const res = await remove('person_places', l.id)
    if (res.error) { toast(`Unlink failed: ${res.error.message}`, 'danger'); return }
    toast('Place unlinked', 'success')
    onRefresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Locations</h3><Badge>{data.links.length}</Badge></div>
        {canEdit && <Button size="sm" onClick={() => onLink()}>Link place</Button>}
      </div>
      {!data.links.length ? (
        <EmptyState title="No linked places" hint={canEdit ? 'Use “Link place” to attach an existing Place with a role.' : undefined} />
      ) : (
        <div className="space-y-2">
          {data.links.map((l) => {
            const pl: PlaceLite | undefined = data.places.get(l.place_id)
            return (
              <Card key={l.id} pad="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <EntityLink kind="place" label={pl?.name ?? 'Place'} />
                    {pl && <span className="text-[11px] text-slate-400">{humanize(pl.type)}{pl.area ? ` · ${pl.area}` : ''}</span>}
                    <Badge tone="neutral">{placeRoleLabel(l.role)}</Badge>
                    <Badge tint={linkStatusTint(l.link_status)}>{linkStatusLabel(l.link_status)}</Badge>
                    <ConfidenceBadge confidence={l.confidence} />
                    <ProvenanceBadge provenance={l.provenance} />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {l.first_observed ? `First seen ${fmtDate(l.first_observed)} · ` : ''}
                    {l.last_confirmed ? `Confirmed ${fmtDate(l.last_confirmed)} · ` : ''}
                    Linked {fmtDate(l.created_at)}
                  </p>
                  {l.note && <p className="mt-0.5 text-xs text-slate-400">{l.note}</p>}
                </div>
                {canRemoveLink(l.created_by, profile?.id, isCommand) && (
                  <button onClick={() => void unlink(l)} className="flex-shrink-0 text-[11px] text-rose-300 hover:text-rose-200">Unlink</button>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* Legacy jsonb addresses — human-reviewed migration only. Rows are never
          auto-converted and never deleted by linking; they stay until someone
          edits the person record. */}
      {legacy.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Legacy addresses (unlinked) — {legacy.length}</p>
          <div className="space-y-1.5">
            {legacy.map((pr, i) => (
              <Card key={i} pad="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 text-sm text-slate-200">
                  🏠 {pr.address || '—'}{pr.type ? <span className="text-slate-400"> · {pr.type}</span> : null}
                  {pr.notes && <p className="mt-0.5 text-[11px] text-slate-400">{pr.notes}</p>}
                </div>
                {canEdit && (
                  <Button size="sm" onClick={() => onLink(pr)} title="Review and link this legacy address to a structured Place (the legacy row stays)">
                    Link to Place…
                  </Button>
                )}
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Link place — projected place search with role/confidence/provenance. When
 *  opened from a legacy address row, the note is prefilled with that address
 *  so the reviewer keeps the original wording; the legacy row is untouched. */
export function LinkPersonPlaceModal({ person, existing, legacy, onClose, onSaved }: {
  person: PersonRow
  existing: PersonPlaceRow[]
  legacy?: PersonProperty
  onClose: () => void
  onSaved: () => void
}) {
  const [pool, setPool] = useState<PlaceLite[] | null>(null)
  const [q, setQ] = useState(() => legacy?.address || '')
  const [placeId, setPlaceId] = useState('')
  const [role, setRole] = useState<string>(() => (legacy?.type === 'Residence' ? 'residence' : legacy?.type === 'Stash House' ? 'stash' : 'other'))
  const [linkStatus, setLinkStatus] = useState('current')
  const [confidence, setConfidence] = useState('')
  const [provenance, setProvenance] = useState(() => (legacy ? 'imported' : ''))
  const [note, setNote] = useState(() => (legacy ? `Legacy address: ${legacy.address}${legacy.notes ? ` — ${legacy.notes}` : ''}` : ''))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void list('places', { select: PLACE_LITE_COLS, order: 'name' })
      .then((r) => { if (live) setPool(r as unknown as PlaceLite[]) })
      .catch(() => { if (live) setPool([]) })
    return () => { live = false }
  }, [])

  const linked = useMemo(() => new Set(existing.map((l) => l.place_id)), [existing])
  const needle = q.trim().toLowerCase()
  const options = useMemo(
    () => (pool ?? [])
      .filter((p) => !linked.has(p.id))
      .filter((p) => !needle || [p.name, p.area].some((s) => (s || '').toLowerCase().includes(needle)))
      .slice(0, 20),
    [pool, linked, needle],
  )

  const save = async () => {
    if (!placeId) { toast('Pick a place first.', 'warn'); return }
    setBusy(true)
    const res = await insert('person_places', {
      person_id: person.id,
      place_id: placeId,
      role: role || null,
      link_status: linkStatus,
      confidence: confidence || null,
      provenance: provenance || null,
      note: note.trim() || null,
    })
    setBusy(false)
    if (res.error) {
      toast(res.error.code === '23505' ? 'This person is already linked to that place.' : `Link failed: ${res.error.message}`, 'danger')
      return
    }
    toast(legacy ? 'Place linked — the legacy address row is kept for reference' : 'Place linked', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!placeId}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <ModalHeader title={`Link place — ${person.name}`} onClose={onClose} />
        {legacy && (
          <p className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-slate-300">
            Reviewing legacy address <span className="text-white">“{legacy.address}”</span>. Pick the matching Place (or create one in the Places area first) — the legacy row stays untouched.
          </p>
        )}
        <div className="space-y-3">
          <Field label="Search places">
            {(id) => <Input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or area…" />}
          </Field>
          {pool === null ? (
            <p className="text-sm text-slate-400">Loading places…</p>
          ) : options.length ? (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-white/5 bg-ink-900 p-1.5" role="listbox" aria-label="Place results">
              {options.map((p) => (
                <button key={p.id} role="option" aria-selected={placeId === p.id} onClick={() => setPlaceId(p.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition ${placeId === p.id ? 'bg-badge-500/20 text-white' : 'text-slate-200 hover:bg-white/5'}`}>
                  <span className="min-w-0 truncate">📍 {p.name}<span className="text-slate-400"> · {humanize(p.type)}{p.area ? ` · ${p.area}` : ''}</span></span>
                  {placeId === p.id && <span aria-hidden className="flex-shrink-0 text-badge-500">✓</span>}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No matching unlinked places. Create the place in the Places area first, then link it here.</p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Role">
              {(id) => (
                <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                  {PLACE_ROLES.map((r) => <option key={r} value={r}>{placeRoleLabel(r)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Status">
              {(id) => (
                <Select id={id} value={linkStatus} onChange={(e) => setLinkStatus(e.target.value)}>
                  {LINK_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Confidence">
              {(id) => (
                <Select id={id} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
                  <option value="">—</option>
                  {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Source">
              {(id) => (
                <Select id={id} value={provenance} onChange={(e) => setProvenance(e.target.value)}>
                  <option value="">—</option>
                  {PROVENANCE_KINDS.map((p) => <option key={p} value={p}>{humanize(p)}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <Button variant="primary" className="w-full" loading={busy} disabled={!placeId} onClick={() => void save()}>Link place</Button>
        </div>
      </div>
    </Modal>
  )
}

// ── Media ─────────────────────────────────────────────────────────────────────
export function PersonMediaSection({ person, media, canEdit, onAdd, onOpen, onRefresh }: {
  person: PersonRow
  media: MediaRow[]
  canEdit: boolean
  onAdd: () => void
  onOpen: (m: MediaRow) => void
  onRefresh: () => void
}) {
  const mugshot = safeUrl(person.mugshot_url ?? '')

  const setMugshot = async (m: MediaRow) => {
    const src = safeUrl(m.external_url || m.storage_path || '')
    if (!src) { toast('This media item has no usable image URL.', 'warn'); return }
    // Points persons.mugshot_url at the existing media URL — no file duplication.
    const res = await update('persons', person.id, { mugshot_url: src })
    if (res.error) { toast(`Update failed: ${res.error.message}`, 'danger'); return }
    toast('Mugshot updated', 'success')
    onRefresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Media</h3><Badge>{media.length}</Badge></div>
        {canEdit && <Button size="sm" onClick={onAdd}>+ Add media</Button>}
      </div>
      {!media.length ? (
        <EmptyState title="No media" hint={canEdit ? 'Add a photo or link imagery to this person.' : undefined} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((m) => {
            const src = safeUrl(m.external_url || m.storage_path || '')
            const isImage = !!src && m.type !== 'document' && m.type !== 'video'
            const isMugshot = !!src && !!mugshot && src === mugshot
            return (
              <div key={m.id} className={`overflow-hidden rounded-lg border bg-ink-850 ${isMugshot ? 'border-badge-500/60' : 'border-white/5'}`}>
                <button onClick={() => onOpen(m)} className="block w-full text-left" title={`Open ${m.title || 'media'}`}>
                  {isImage ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external media CDN
                    <img src={src} alt={m.title || 'Media item'} className="h-28 w-full object-cover transition hover:opacity-90" />
                  ) : (
                    <div className="grid h-28 w-full place-items-center text-2xl" aria-hidden>{m.type === 'video' ? '🎬' : '📄'}</div>
                  )}
                </button>
                <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                  <span className="min-w-0 truncate text-[11px] text-slate-400">
                    {isMugshot && <Badge tone="accent" className="mr-1" title="Current mugshot">Mugshot</Badge>}
                    {m.title || m.kind || 'Media'}
                  </span>
                  <span className="flex flex-shrink-0 items-center gap-1.5">
                    {m.case_id && <EntityLink kind="case" id={m.case_id} label="Case" title="Source case" className="!px-1.5" />}
                    {canEdit && isImage && !isMugshot && (
                      <button onClick={() => void setMugshot(m)} className="text-[10px] font-semibold text-blue-300 hover:text-blue-200" title="Use this image as the mugshot">
                        Set mugshot
                      </button>
                    )}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Add media — FiveManage upload when configured, else paste a URL. Mirrors
 *  the gang photo flow but writes media.person_id. */
export function AddPersonMediaModal({ person, onClose, onSaved }: { person: PersonRow; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const canUpload = fmConfigured()

  const persist = async (externalUrl: string, kind: string) => {
    const res = await insert('media', {
      title: title.trim() || `${person.name} photo`, type: 'image', kind, external_url: externalUrl,
      person_id: person.id, tags: { labels: ['Person'] },
    })
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return false }
    return true
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const { url: up, kind } = await fmUpload(file)
      if (await persist(up, kind)) { toast('Media added', 'success'); onSaved() }
    } catch (e) { toast(e instanceof Error ? e.message : 'Upload failed', 'danger') } finally { setBusy(false) }
  }

  const saveUrl = async () => {
    const clean = safeUrl(url.trim())
    if (!clean) { toast('Enter a valid image URL.', 'warn'); return }
    setBusy(true)
    if (await persist(clean, 'image')) { toast('Media added', 'success'); onSaved() }
    setBusy(false)
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title={`Add media — ${person.name}`} onClose={onClose} />
        <div className="space-y-3">
          <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${person.name} photo`} />}</Field>
          {canUpload ? (
            <Field label="Upload image" hint="Uploads to the media host and links it to this person.">
              {(id) => (
                <input id={id} type="file" accept="image/*" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])}
                  className="block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-badge-500 file:px-3 file:py-1.5 file:text-white" />
              )}
            </Field>
          ) : (
            <>
              <Field label="Image URL">{(id) => <Input id={id} value={url} onChange={(e) => setUrl(e.target.value)} />}</Field>
              <Button variant="primary" className="w-full" loading={busy} onClick={() => void saveUrl()}>Add media</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
