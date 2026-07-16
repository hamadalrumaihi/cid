'use client'

/** Criminal Places & Production - port of vanilla places.js. Live place cards,
 * FK-preserving create/edit modal, linked gang/case/narcotic chips, attach-to-
 * case, and undo-backed deletes. Drug labs surface a non-actionable "suspected
 * production site" summary that deep-links the canonical substance dossier —
 * no production recipe or step-by-step workflow is generated or rendered. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Database, Json, Tables } from '@/lib/database.types'
import { deleteWithUndo, insert, list, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { fmConfigured, fmUpload } from '@/lib/fivemanage'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice, EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { EntityLink } from '@/components/ui/EntityLink'

type PlaceRow = Tables<'places'>
type GangRow = Tables<'gangs'>
type NarcoticRow = Tables<'narcotics'>
type PrecursorRow = Tables<'narcotic_precursors'>
type HotspotRow = Tables<'narcotic_hotspots'>
type LocationType = Database['public']['Enums']['location_type']
type CaseOption = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title'>
type PlacePhoto = Pick<Tables<'media'>, 'id' | 'title' | 'type' | 'external_url' | 'storage_path' | 'place_id'>

const LOC_TYPES: { value: LocationType; label: string }[] = [
  { value: 'drug_lab', label: 'Drug Lab' },
  { value: 'stash_house', label: 'Stash House' },
  { value: 'dead_drop', label: 'Dead Drop' },
  { value: 'front_business', label: 'Front Business' },
  { value: 'chop_shop', label: 'Chop Shop' },
]

const locLabel = (value: string | null | undefined) => LOC_TYPES.find((t) => t.value === value)?.label || value || 'Location'

const PLACE_DELETE_CHILDREN = [{ table: 'place_process_steps' as const, column: 'place_id' }]

interface DrugBundle {
  row: NarcoticRow
  precursors: PrecursorRow[]
  hotspots: HotspotRow[]
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

/** Generalized, non-actionable stage LABELS shown on a suspected production
 *  site. These are broad phase names for intelligence context only — never
 *  instructions, quantities or ordered steps. */
const PRODUCTION_STAGES = ['Cultivation', 'Processing', 'Packaging', 'Distribution'] as const

export function PlacesView() {
  const { state, canEdit, canDelete } = useAuth()
  const [places, setPlaces] = useState<PlaceRow[]>([])
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [cases, setCases] = useState<CaseOption[]>([])
  const [drugs, setDrugs] = useState<DrugBundle[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [photos, setPhotos] = useState<PlacePhoto[]>([])
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [editor, setEditor] = useState<PlaceRow | 'new' | null>(null)
  const [attach, setAttach] = useState<PlaceRow | null>(null)
  const [addPhoto, setAddPhoto] = useState<PlaceRow | null>(null)
  const [lightbox, setLightbox] = useState<PlacePhoto | null>(null)

  const vPlaces = useTableVersion('places')
  const vGangs = useTableVersion('gangs')
  const vCases = useTableVersion('cases')
  const vNarcotics = useTableVersion('narcotics')
  const vMedia = useTableVersion('media')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      const [pl, g, c, n, prec, hot, ph] = await Promise.all([
        withRetry(() => list('places', { order: 'updated_at', ascending: false })),
        list('gangs', { order: 'name' }).catch(() => [] as GangRow[]),
        list('cases', { select: 'id,case_number,title', order: 'updated_at', ascending: false })
          .then((rows) => rows as unknown as CaseOption[])
          .catch(() => [] as CaseOption[]),
        list('narcotics', { order: 'name' }).catch(() => [] as NarcoticRow[]),
        list('narcotic_precursors', {}).catch(() => [] as PrecursorRow[]),
        list('narcotic_hotspots', {}).catch(() => [] as HotspotRow[]),
        list('media', { select: 'id,title,type,external_url,storage_path,place_id', order: 'created_at' })
          .then((rows) => (rows as unknown as PlacePhoto[]).filter((m) => m.place_id))
          .catch(() => [] as PlacePhoto[]),
      ])
      setPlaces(pl)
      setGangs(g)
      setCases(c)
      setPhotos(ph)
      setDrugs(n.map((row) => ({
        row,
        precursors: prec.filter((p) => p.narcotic_id === row.id),
        hotspots: hot.filter((h) => h.narcotic_id === row.id),
      })))
      setSelected((sel) => new Set([...sel].filter((id) => pl.some((x) => x.id === id))))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vPlaces, vGangs, vCases, vNarcotics, vMedia])

  const gangName = (id: string | null) => (id && gangs.find((g) => g.id === id)?.name) || null
  const caseNum = (id: string | null) => (id && cases.find((c) => c.id === id)?.case_number) || null
  const drugById = (id: string | null) => (id && drugs.find((d) => d.row.id === id)) || null
  const photosByPlace = useMemo(() => {
    const m = new Map<string, PlacePhoto[]>()
    photos.forEach((p) => { if (p.place_id) m.set(p.place_id, [...(m.get(p.place_id) ?? []), p]) })
    return m
  }, [photos])

  const toggleSelect = (id: string, on: boolean) =>
    setSelected((sel) => { const next = new Set(sel); if (on) next.add(id); else next.delete(id); return next })

  const deleteRows = async (rows: PlaceRow[]) => {
    if (!rows.length) return
    const n = rows.length
    if (!(await uiConfirm(`Delete ${n} selected location${n > 1 ? 's' : ''}? Restorable via Undo.`, { confirmText: `Delete ${n}` }))) return
    setSelected(new Set())
    await deleteWithUndo('places', rows, {
      label: `${n} location${n > 1 ? 's' : ''}`,
      noConfirm: true,
      after: () => void refresh(),
      children: PLACE_DELETE_CHILDREN,
    })
  }

  const deleteOne = async (place: PlaceRow) => {
    if (!(await uiConfirm(`Delete location "${place.name}"?`, { confirmText: 'Delete' }))) return
    await deleteWithUndo('places', place, {
      label: `Location "${place.name}"`,
      noConfirm: true,
      after: () => void refresh(),
      children: PLACE_DELETE_CHILDREN,
    })
  }

  return (
    <section className="view-in space-y-4">
      <Card pad="lg">
        <PageHeader
          title="Criminal Places & Production"
          subtitle="Drug labs, stash houses, dead drops and fronts, with linked gangs, cases and substance intelligence."
          actions={
            <>
              {state === 'in' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />live
                </span>
              )}
              {canEdit && (
                <Button variant="primary" onClick={() => setEditor('new')}>
                  + New Location
                </Button>
              )}
            </>
          }
        />
      </Card>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 backdrop-blur">
          <span className="text-sm font-semibold text-rose-200">{selected.size} selected</span>
          <span className="flex gap-2">
            <Button size="sm" variant="danger" onClick={() => void deleteRows(places.filter((p) => selected.has(p.id)))}>Delete selected</Button>
            <Button size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {state !== 'in' ? (
          <Notice text="Live location records require sign-in." className="lg:col-span-2" />
        ) : err ? (
          <ErrorNotice message={err} onRetry={refresh} className="lg:col-span-2" />
        ) : loading && !places.length ? (
          <div className="lg:col-span-2">
            <CardGridSkeleton count={4} cols="lg:grid-cols-2" />
          </div>
        ) : !places.length ? (
          <EmptyState
            title="No locations logged yet"
            hint={canEdit ? 'Add a drug lab, stash house, dead drop or front with the New Location button.' : undefined}
            className="lg:col-span-2"
          />
        ) : (
          places.map((place) => (
            <PlaceCard
              key={place.id}
              place={place}
              gang={gangName(place.controlling_gang_id)}
              caseNumber={caseNum(place.case_id)}
              drug={drugById(place.narcotic_id)}
              photos={photosByPlace.get(place.id) ?? []}
              onOpenPhoto={setLightbox}
              onAddPhoto={() => setAddPhoto(place)}
              canEdit={canEdit}
              canDelete={canDelete}
              selected={selected.has(place.id)}
              onSelect={(on) => toggleSelect(place.id, on)}
              onEdit={() => setEditor(place)}
              onDelete={() => void deleteOne(place)}
              onAttach={() => setAttach(place)}
            />
          ))
        )}
      </div>

      {editor && (
        <PlaceModal
          record={editor === 'new' ? null : editor}
          gangs={gangs}
          cases={cases}
          drugs={drugs}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); void refresh() }}
        />
      )}
      {attach && <AttachPlaceModal place={attach} caseOptions={cases} onClose={() => setAttach(null)} />}
      {addPhoto && <AddPlacePhotoModal place={addPhoto} onClose={() => setAddPhoto(null)} onSaved={() => { setAddPhoto(null); void refresh() }} />}
      {lightbox && <PhotoLightbox photo={lightbox} onClose={() => setLightbox(null)} />}
    </section>
  )
}

/** Attach a photo to one place: FiveManage upload when the key is configured,
 *  paste-a-URL fallback otherwise — same intake contract as the Media Vault,
 *  but the row lands pre-linked to the place so it shows on the card. */
function AddPlacePhotoModal({ place, onClose, onSaved }: { place: PlaceRow; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState('')
  const [src, setSrc] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'

  const upload = async (file: File) => {
    setUploading(true)
    try {
      const out = await fmUpload(file)
      setSrc(out.url)
      if (!title) setTitle(file.name.replace(/\.[a-z0-9]+$/i, ''))
      toast('Uploaded to FiveManage', 'success')
    } catch (e) {
      toast(`Upload failed: ${e instanceof Error ? e.message : String(e)}`, 'danger')
    } finally { setUploading(false) }
  }

  const save = async () => {
    if (!src.trim()) { toast('Upload a photo or paste an image URL first.', 'warn'); return }
    setBusy(true)
    const res = await insert('media', {
      title: title.trim() || place.name,
      type: 'image',
      kind: 'image',
      external_url: src.trim(),
      place_id: place.id,
      tags: { labels: ['Place'], location: place.area || place.name } as Json,
    })
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(`Photo added to "${place.name}"`, 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!(title || src)}>
      <div className="p-6">
        <ModalHeader title={`Add photo — ${place.name}`} onClose={onClose} />
        <div className="space-y-3">
          <div>
            <label htmlFor="pp-title" className="mb-1 block text-xs font-semibold text-slate-400">Title</label>
            <input id="pp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={place.name} className={input} />
          </div>
          {fmConfigured() && (
            <div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
              <button onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full rounded-lg border border-dashed border-white/20 bg-white/5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50">
                {uploading ? 'Uploading…' : '📷 Upload photo'}
              </button>
            </div>
          )}
          <div>
            <label htmlFor="pp-src" className="mb-1 block text-xs font-semibold text-slate-400">{fmConfigured() ? 'Or paste an image URL' : 'Image URL'}</label>
            <input id="pp-src" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="https://…" className={input} />
          </div>
          {safeUrl(src) && (
            // eslint-disable-next-line @next/next/no-img-element -- external evidence URL
            <img src={safeUrl(src)!} alt="Preview" className="max-h-48 w-full rounded-lg border border-white/10 object-contain" />
          )}
        </div>
        <Button variant="primary" className="mt-5 w-full" disabled={busy || uploading} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Add photo'}
        </Button>
      </div>
    </Modal>
  )
}

function PhotoLightbox({ photo, onClose }: { photo: PlacePhoto; onClose: () => void }) {
  const safe = safeUrl(photo.external_url || photo.storage_path || '')
  return (
    <Modal open onClose={onClose} wide>
      <div className="p-6">
        <ModalHeader title={photo.title} onClose={onClose} />
        {safe ? (
          // eslint-disable-next-line @next/next/no-img-element -- external evidence URL
          <img src={safe} alt={photo.title} className="max-h-[70vh] w-full rounded-lg object-contain" />
        ) : (
          <div className="flex h-64 items-center justify-center rounded-lg bg-ink-800 text-5xl" aria-hidden>📡</div>
        )}
        {safe && (
          <div className="mt-3 text-right">
            <a href={safe} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-300 underline">Open ↗</a>
          </div>
        )}
      </div>
    </Modal>
  )
}

function PlaceCard({ place, gang, caseNumber, drug, photos, onOpenPhoto, onAddPhoto, canEdit, canDelete, selected, onSelect, onEdit, onDelete, onAttach }: {
  place: PlaceRow
  gang: string | null
  caseNumber: string | null
  drug: DrugBundle | null
  photos: PlacePhoto[]
  onOpenPhoto: (p: PlacePhoto) => void
  onAddPhoto: () => void
  canEdit: boolean
  canDelete: boolean
  selected: boolean
  onSelect: (on: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onAttach: () => void
}) {
  const productionSite = place.type === 'drug_lab' && drug
  return (
    <Card pad="lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-base font-semibold text-white">{place.name}</h4>
          <p className="mt-0.5 text-xs text-slate-400">{locLabel(place.type)} · {place.area || '-'}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {canEdit && <button onClick={onAddPhoto} className="-my-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-emerald-200 transition hover:bg-white/10" title="Add a photo of this location">📷</button>}
          {canEdit && <button onClick={onAttach} className="-my-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-blue-200 transition hover:bg-white/10" title="Attach to case">Attach</button>}
          {canEdit && <button onClick={onEdit} className="-my-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-200 transition hover:bg-white/10">Edit</button>}
          {canDelete && <button aria-label="Remove location" onClick={onDelete} className="-my-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-rose-300 transition hover:bg-rose-500/10">Delete</button>}
          {canDelete && (
            <label className="flex items-center pl-0.5" title="Select for bulk delete">
              <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${place.name} for bulk delete`} className="h-4 w-4 accent-rose-500" />
            </label>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        {gang && <span className="rounded-md bg-violet-500/10 px-2 py-1 text-violet-300">{gang}</span>}
        {caseNumber && <span className="rounded-md bg-blue-500/10 px-2 py-1 font-mono text-blue-300">{caseNumber}</span>}
        {drug && <EntityLink kind="narcotic" id={drug.row.id} label={drug.row.name} title={`Open ${drug.row.name} dossier`} />}
      </div>
      {place.notes && <p className="mt-3 text-xs text-slate-400">{place.notes}</p>}
      {photos.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {photos.map((p) => {
            const safe = safeUrl(p.external_url || p.storage_path || '')
            if (!safe) return null
            return (
              // eslint-disable-next-line @next/next/no-img-element -- external evidence URL
              <img
                key={p.id}
                src={safe}
                alt={p.title}
                title={p.title}
                loading="lazy"
                onClick={() => onOpenPhoto(p)}
                className="h-20 w-28 cursor-zoom-in rounded-lg border border-white/10 object-cover transition hover:brightness-110"
              />
            )
          })}
        </div>
      )}
      {productionSite && drug && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-300/70">Suspected production site</p>
          <p className="text-xs text-slate-300">
            <span className="text-white">{drug.row.name}</span>
            {drug.row.category ? ` · ${cap(drug.row.category)}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Generalized production stages">
            {PRODUCTION_STAGES.map((stage) => (
              <span key={stage} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">{stage}</span>
            ))}
          </div>
          {drug.precursors.length > 0 && (
            <p className="mt-2 text-[11px] text-slate-400">Precursors of interest recorded on linked cases/evidence.</p>
          )}
          <div className="mt-3">
            <EntityLink kind="narcotic" id={drug.row.id} label="View substance intelligence →" title={`Open ${drug.row.name} dossier`} />
          </div>
        </div>
      )}
    </Card>
  )
}

function PlaceModal({ record, gangs, cases, drugs, onClose, onSaved }: {
  record: PlaceRow | null
  gangs: GangRow[]
  cases: CaseOption[]
  drugs: DrugBundle[]
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(record?.name || '')
  const [type, setType] = useState<LocationType>(record?.type || 'drug_lab')
  const [area, setArea] = useState(record?.area || '')
  const [gangId, setGangId] = useState(record?.controlling_gang_id || '')
  const [caseId, setCaseId] = useState(record?.case_id || '')
  const [narcoticId, setNarcoticId] = useState(record?.narcotic_id || '')
  const [notes, setNotes] = useState(record?.notes || '')
  const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'
  const gangKnown = !gangId || gangs.some((g) => g.id === gangId)
  const caseKnown = !caseId || cases.some((c) => c.id === caseId)
  const drugKnown = !narcoticId || drugs.some((d) => d.row.id === narcoticId)

  const save = async () => {
    if (!name.trim()) { toast('Location name is required.', 'warn'); return }
    const payload = {
      name: name.trim(),
      type,
      area: area.trim() || null,
      controlling_gang_id: gangId || null,
      case_id: caseId || null,
      narcotic_id: type === 'drug_lab' && narcoticId ? narcoticId : null,
      notes: notes.trim() || null,
    }
    const res = record ? await update('places', record.id, payload) : await insert('places', payload)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(record ? 'Location updated' : 'Location created', 'success')
    onSaved()
  }

  const dirty = () =>
    name.trim() !== (record?.name || '') || type !== (record?.type || 'drug_lab') ||
    area.trim() !== (record?.area || '') || gangId !== (record?.controlling_gang_id || '') ||
    caseId !== (record?.case_id || '') || narcoticId !== (record?.narcotic_id || '') ||
    notes.trim() !== (record?.notes || '')

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title={`${record ? 'Edit' : 'New'} Location`} onClose={onClose} />
        <div className="space-y-3">
          <div><label htmlFor="place-name" className="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input id="place-name" value={name} onChange={(e) => setName(e.target.value)} className={input} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="place-type" className="mb-1 block text-xs font-semibold text-slate-400">Type</label>
              <select id="place-type" value={type} onChange={(e) => setType(e.target.value as LocationType)} className={input}>
                {LOC_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div><label htmlFor="place-area" className="mb-1 block text-xs font-semibold text-slate-400">Area</label><input id="place-area" value={area} onChange={(e) => setArea(e.target.value)} className={input} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="place-gang" className="mb-1 block text-xs font-semibold text-slate-400">Controlling Gang</label>
              <select id="place-gang" value={gangId} onChange={(e) => setGangId(e.target.value)} className={input}>
                <option value="">- none -</option>
                {!gangKnown && <option value={gangId}>(current gang - loading...)</option>}
                {gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="place-case" className="mb-1 block text-xs font-semibold text-slate-400">Linked Case</label>
              <select id="place-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} className={input}>
                <option value="">- none -</option>
                {!caseKnown && <option value={caseId}>(linked case - other bureau)</option>}
                {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number}</option>)}
              </select>
            </div>
          </div>
          {type === 'drug_lab' && (
            <div>
              <label htmlFor="place-narcotic" className="mb-1 block text-xs font-semibold text-slate-400">Produced Narcotic</label>
              <select id="place-narcotic" value={narcoticId} onChange={(e) => setNarcoticId(e.target.value)} className={input}>
                <option value="">- none -</option>
                {!drugKnown && <option value={narcoticId}>(current narcotic - loading...)</option>}
                {drugs.map((d) => <option key={d.row.id} value={d.row.id}>{d.row.name}</option>)}
              </select>
            </div>
          )}
          <div><label htmlFor="place-notes" className="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea id="place-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} /></div>
        </div>
        <Button variant="primary" className="mt-5 w-full" onClick={() => void save()}>
          {record ? 'Save changes' : 'Create location'}
        </Button>
      </div>
    </Modal>
  )
}

function AttachPlaceModal({ place, caseOptions, onClose }: { place: PlaceRow; caseOptions: CaseOption[]; onClose: () => void }) {
  const { profile } = useAuth()
  const sorted = useMemo(
    () => caseOptions.slice().sort((a, b) => (a.case_number || '').localeCompare(b.case_number || '')),
    [caseOptions],
  )
  const [caseId, setCaseId] = useState(place.case_id || sorted[0]?.id || '')
  const label = `Place - ${place.name} (${locLabel(place.type)})${place.area ? ` · ${place.area}` : ''}`

  const go = async () => {
    if (!caseId) return
    const res = await insert('case_messages', {
      case_id: caseId,
      author_name: profile?.display_name || 'CID',
      body: `Intel reference - ${label}`,
      mentions: [],
      links: [],
    })
    if (res.error) { toast(`Attach failed: ${res.error.message}`, 'danger'); return }
    const num = sorted.find((c) => c.id === caseId)?.case_number || 'case'
    toast(`Reference posted to ${num} channel`, 'success')
    onClose()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="Attach to case" onClose={onClose} />
        <p className="mb-3 text-sm text-slate-400">Posts a reference to <span className="text-white">{label}</span> into the case channel.</p>
        {sorted.length ? (
          <>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Case to attach the reference to" className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">
              {sorted.map((c) => <option key={c.id} value={c.id}>{c.case_number} · {c.title || ''}</option>)}
            </select>
            <Button variant="primary" className="mt-4 w-full" onClick={() => void go()}>
              Attach reference
            </Button>
          </>
        ) : (
          <p className="text-sm text-slate-400">No cases available to attach to.</p>
        )}
      </div>
    </Modal>
  )
}
