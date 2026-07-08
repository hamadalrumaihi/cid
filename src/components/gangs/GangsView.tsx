'use client'

/** Gangs & Turf - port of vanilla gangs.js. Covers the live gang list/detail,
 *  roster, turf, linked properties, attach-to-case references, unified intel
 *  profile, and undo-backed deletes. The Gang Intel document shelf waits on
 *  the shared SOP/document engine slice. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { deleteWithUndo, insert, list, remove, update, withRetry } from '@/lib/db'
import type { Database, Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { IntelProfile, type IntelTarget } from '@/components/persons/IntelProfile'

const PAGE = 24
const RANK_SUGGEST = ['Shot Caller', 'OG', 'Lieutenant', 'Enforcer', 'Soldier', 'Associate', 'Prospect']

type GangRow = Tables<'gangs'>
type MemberRow = Tables<'gang_members'>
type TurfRow = Tables<'gang_turf'>
type PersonRow = Tables<'persons'>
type PlaceRow = Tables<'places'>
type CaseOption = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title'>
type ThreatLevel = Database['public']['Enums']['threat_level']
type Density = Database['public']['Enums']['density']

const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Medium')

const threatTint = (t: string | null | undefined) => {
  if (t === 'high') return 'border-rose-500/30 bg-rose-500/10 text-rose-300'
  if (t === 'medium') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
}

const densityTint = (d: string | null | undefined) => {
  if (d === 'high') return 'bg-rose-500/15 text-rose-300'
  if (d === 'medium') return 'bg-amber-500/15 text-amber-300'
  return 'bg-emerald-500/15 text-emerald-300'
}

const GANG_DELETE_CHILDREN = [
  { table: 'gang_members' as const, column: 'gang_id' },
  { table: 'gang_ranks' as const, column: 'gang_id' },
  { table: 'gang_turf' as const, column: 'gang_id' },
]

const GANG_NULL_REFS = [{ table: 'persons' as const, column: 'gang_id' }]

export function GangsView() {
  const { state, canEdit, canDelete } = useAuth()
  const sp = useSearchParams()
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [people, setPeople] = useState<PersonRow[]>([])
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // `?q=` seeds the filter — how global-search results land here prefiltered.
  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  const [page, setPage] = useState({ q: '', shown: PAGE })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editor, setEditor] = useState<GangRow | 'new' | null>(null)
  const [profile, setProfile] = useState<IntelTarget | null>(null)
  const [attach, setAttach] = useState<GangRow | null>(null)

  const vGangs = useTableVersion('gangs')
  const vMembers = useTableVersion('gang_members')
  const vTurf = useTableVersion('gang_turf')
  const vPersons = useTableVersion('persons')
  const vCases = useTableVersion('cases')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      const [g, p, c] = await Promise.all([
        withRetry(() => list('gangs', { order: 'name', ascending: true })),
        list('persons', { order: 'name' }).catch(() => [] as PersonRow[]),
        list('cases', { select: 'id,case_number,title', order: 'updated_at', ascending: false })
          .then((rows) => rows as unknown as CaseOption[])
          .catch(() => [] as CaseOption[]),
      ])
      setGangs(g)
      setPeople(p)
      setCaseOptions(c)
      setSelected((sel) => new Set([...sel].filter((id) => g.some((x) => x.id === id))))
      setDetailId((id) => (id && g.some((x) => x.id === id) ? id : null))
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vGangs, vMembers, vTurf, vPersons, vCases])

  const q = query.trim().toLowerCase()
  const items = useMemo(
    () => gangs.filter((g) => !q || JSON.stringify(g).toLowerCase().includes(q)),
    [gangs, q],
  )
  const shown = page.q === q ? page.shown : PAGE
  const visible = items.slice(0, shown)
  const remaining = Math.max(0, items.length - visible.length)
  const detail = detailId ? gangs.find((g) => g.id === detailId) ?? null : null

  const toggleSelect = (id: string, on: boolean) =>
    setSelected((sel) => { const next = new Set(sel); if (on) next.add(id); else next.delete(id); return next })

  const deleteRows = async (rows: GangRow[]) => {
    if (!rows.length) return
    const n = rows.length
    if (!(await uiConfirm(`Delete ${n} selected gang${n > 1 ? 's' : ''}? This also removes roster, ranks, and turf.`, { confirmText: `Delete ${n}` }))) return
    setSelected(new Set())
    await deleteWithUndo('gangs', rows, {
      label: `${n} gang${n > 1 ? 's' : ''}`,
      noConfirm: true,
      after: () => void refresh(),
      children: GANG_DELETE_CHILDREN,
      setNullRefs: GANG_NULL_REFS,
    })
  }

  const deleteOne = async (g: GangRow) => {
    if (!(await uiConfirm(`Delete gang "${g.name}"? This removes its members, ranks, and turf.`, { confirmText: 'Delete' }))) return
    setDetailId(null)
    await deleteWithUndo('gangs', g, {
      label: `Gang "${g.name}"`,
      noConfirm: true,
      after: () => void refresh(),
      children: GANG_DELETE_CHILDREN,
      setNullRefs: GANG_NULL_REFS,
    })
  }

  if (detail) {
    return (
      <GangDetail
        gang={detail}
        people={people}
        caseOptions={caseOptions}
        canEdit={canEdit}
        canDelete={canDelete}
        onBack={() => setDetailId(null)}
        onRefresh={refresh}
        onEdit={() => setEditor(detail)}
        onDelete={() => void deleteOne(detail)}
        onProfile={() => setProfile({ type: 'gang', id: detail.id })}
        onAttach={() => setAttach(detail)}
      >
        {editor && <GangModal record={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void refresh() }} />}
        {profile && <IntelProfile initial={profile} gangs={gangs} onClose={() => setProfile(null)} />}
        {attach && <AttachGangModal gang={attach} caseOptions={caseOptions} onClose={() => setAttach(null)} />}
      </GangDetail>
    )
  }

  return (
    <section className="view-in space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold text-white">
            Gangs &amp; Turf
            {state === 'in' && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />live
              </span>
            )}
          </h3>
          <p className="text-sm text-slate-400">Organizations, rank structure, linked properties, and territory control.</p>
        </div>
        {canEdit && (
          <button onClick={() => setEditor('new')} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
            + New Gang
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter gangs..."
          className="min-w-[12rem] flex-1 rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-badge-500"
        />
        <button onClick={() => void refresh()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">Refresh</button>
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 backdrop-blur">
          <span className="text-sm font-semibold text-rose-200">{selected.size} selected</span>
          <span className="flex gap-2">
            <button onClick={() => void deleteRows(gangs.filter((g) => selected.has(g.id)))} className="rounded-md bg-rose-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-rose-500">Delete selected</button>
            <button onClick={() => setSelected(new Set())} className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Clear</button>
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {state !== 'in' ? (
          <Notice text="Live gang records require sign-in." />
        ) : err ? (
          <Notice text={`Could not load gangs: ${err}`} />
        ) : loading && !gangs.length ? (
          <Notice text="Loading gangs..." />
        ) : !items.length ? (
          <Notice text={gangs.length ? 'No gangs match your filter.' : `No gangs on file.${canEdit ? ' Use "+ New Gang".' : ''}`} />
        ) : (
          <>
            {visible.map((g) => (
              <GangCard
                key={g.id}
                gang={g}
                canDelete={canDelete}
                selected={selected.has(g.id)}
                onSelect={(on) => toggleSelect(g.id, on)}
                onOpen={() => setDetailId(g.id)}
                onProfile={() => setProfile({ type: 'gang', id: g.id })}
              />
            ))}
            {remaining > 0 && (
              <div className="col-span-full pt-1 text-center">
                <button onClick={() => setPage({ q, shown: shown + PAGE })} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10">
                  Load {Math.min(remaining, PAGE)} more · {remaining} remaining
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {editor && <GangModal record={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void refresh() }} />}
      {profile && <IntelProfile initial={profile} gangs={gangs} onClose={() => setProfile(null)} />}
    </section>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400 xl:col-span-2">{text}</div>
}

function GangCard({ gang, canDelete, selected, onSelect, onOpen, onProfile }: {
  gang: GangRow
  canDelete: boolean
  selected: boolean
  onSelect: (on: boolean) => void
  onOpen: () => void
  onProfile: () => void
}) {
  return (
    <div onClick={onOpen} className="cursor-pointer rounded-2xl border border-white/5 bg-ink-900/60 p-6 transition hover:border-blue-500/30 hover:bg-white/5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-lg font-bold text-white">{gang.name}</h4>
          <p className="mt-0.5 text-xs text-slate-400">Colors: {gang.colors || '-'}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className={`rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase ${threatTint(gang.threat_level)}`}>{cap(gang.threat_level)} Threat</span>
          <button
            onClick={(e) => { e.stopPropagation(); onProfile() }}
            title="Unified intel profile"
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-blue-200 transition hover:bg-white/10"
          >
            Profile
          </button>
          {canDelete && (
            <label onClick={(e) => e.stopPropagation()} className="flex items-center pl-0.5" title="Select for bulk delete">
              <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${gang.name} for bulk delete`} className="h-4 w-4 accent-rose-500" />
            </label>
          )}
        </div>
      </div>
      {gang.notes && <p className="mt-3 line-clamp-2 text-xs text-slate-400">{gang.notes}</p>}
      <p className="mt-3 text-[11px] text-blue-300">View roster &amp; turf</p>
    </div>
  )
}

function GangDetail({ gang, people, caseOptions, canEdit, canDelete, onBack, onRefresh, onEdit, onDelete, onProfile, onAttach, children }: {
  gang: GangRow
  people: PersonRow[]
  caseOptions: CaseOption[]
  canEdit: boolean
  canDelete: boolean
  onBack: () => void
  onRefresh: () => Promise<void>
  onEdit: () => void
  onDelete: () => void
  onProfile: () => void
  onAttach: () => void
  children?: React.ReactNode
}) {
  const [members, setMembers] = useState<MemberRow[]>([])
  const [turf, setTurf] = useState<TurfRow[]>([])
  const [places, setPlaces] = useState<PlaceRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [memberEditor, setMemberEditor] = useState<MemberRow | 'new' | null>(null)
  const [turfOpen, setTurfOpen] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [m, t, p] = await Promise.all([
        list('gang_members', { eq: { gang_id: gang.id } }),
        list('gang_turf', { eq: { gang_id: gang.id } }),
        list('places', { eq: { controlling_gang_id: gang.id } }).catch(() => [] as PlaceRow[]),
      ])
      setMembers(m)
      setTurf(t)
      setPlaces(p)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [gang.id])

  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load])

  const ranks = useMemo(() => {
    const grouped = new Map<string, MemberRow[]>()
    members.forEach((m) => {
      const key = m.rank || 'Unranked'
      grouped.set(key, [...(grouped.get(key) ?? []), m])
    })
    return [...grouped.entries()]
  }, [members])

  const deleteMember = async (m: MemberRow) => {
    await deleteWithUndo('gang_members', m, { label: `Member${m.name ? ` "${m.name}"` : ''}`, after: () => void load() })
  }

  const deleteTurf = async (t: TurfRow) => {
    if (!(await uiConfirm('Delete this turf entry?', { confirmText: 'Delete' }))) return
    const res = await remove('gang_turf', t.id)
    if (res.error) { toast(`Delete failed: ${res.error.message}`, 'danger'); return }
    toast('Turf deleted', 'success')
    void load()
  }

  return (
    <section className="view-in space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-slate-300 transition hover:text-white">Back to all gangs</button>
      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-xl font-bold text-white">{gang.name}</h3>
            <p className="mt-1 text-sm text-slate-400">Colors: {gang.colors || '-'}</p>
            {gang.notes && <p className="mt-1 text-sm text-slate-400">{gang.notes}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase ${threatTint(gang.threat_level)}`}>{cap(gang.threat_level)} Threat</span>
            <button onClick={onProfile} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-blue-200 transition hover:bg-white/10">Intel profile</button>
            {canEdit && <button onClick={onAttach} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-blue-200 transition hover:bg-white/10">Attach to case</button>}
            {canEdit && <button onClick={onEdit} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>}
            {canDelete && <button onClick={onDelete} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>}
          </div>
        </div>
      </div>

      {err && <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">Could not load gang detail: {err}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Roster ({members.length})</h4>
            {canEdit && <button onClick={() => setMemberEditor('new')} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">+ Member</button>}
          </div>
          {members.length ? (
            <div className="space-y-4">
              {ranks.map(([rank, rows]) => (
                <div key={rank}>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">{rank} ({rows.length})</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {rows.map((m) => (
                      <MemberCard key={m.id} member={m} canEdit={canEdit} onEdit={() => setMemberEditor(m)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No members yet.{canEdit ? ' Use "+ Member" above to add the first.' : ''}</p>
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Turf ({turf.length})</h4>
              {canEdit && <button onClick={() => setTurfOpen(true)} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">+ Turf</button>}
            </div>
            <div className="space-y-2">
              {turf.length ? turf.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-850 px-3 py-1.5 text-xs">
                  <span className="min-w-0 truncate text-slate-200">{t.block}{t.hotspot_area ? ` · ${t.hotspot_area}` : ''}</span>
                  <span className="flex flex-shrink-0 items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${densityTint(t.density)}`}>{cap(t.density)}</span>
                    {canDelete && <button aria-label="Remove turf" onClick={() => void deleteTurf(t)} className="text-rose-300">x</button>}
                  </span>
                </div>
              )) : <p className="text-xs text-slate-500">No turf logged.{canEdit ? ' Use "+ Turf" above.' : ''}</p>}
            </div>
          </div>

          <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
            <h4 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Linked Properties ({places.length})</h4>
            <div className="space-y-2">
              {places.length ? places.map((p) => (
                <div key={p.id} className="rounded-lg bg-ink-850 px-3 py-1.5 text-xs text-slate-200">{p.name} <span className="text-slate-500">· {p.type || ''}</span></div>
              )) : <p className="text-xs text-slate-500">No linked places. Set a controlling gang on a Place.</p>}
            </div>
          </div>
        </div>
      </div>

      {memberEditor && (
        <MemberModal
          gangId={gang.id}
          member={memberEditor === 'new' ? null : memberEditor}
          people={people}
          cases={caseOptions}
          canDelete={canDelete}
          onClose={() => setMemberEditor(null)}
          onSaved={() => { setMemberEditor(null); void load(); void onRefresh() }}
          onDelete={(m) => { setMemberEditor(null); void deleteMember(m) }}
        />
      )}
      {turfOpen && <TurfModal gangId={gang.id} onClose={() => setTurfOpen(false)} onSaved={() => { setTurfOpen(false); void load(); void onRefresh() }} />}
      {children}
    </section>
  )
}

function MemberCard({ member, canEdit, onEdit }: { member: MemberRow; canEdit: boolean; onEdit: () => void }) {
  const [imgBroken, setImgBroken] = useState(false)
  const mug = safeUrl(member.mugshot_url ?? '')
  const flag = (member.felony_count || 0) >= 8
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-850 p-2.5">
      {mug && !imgBroken ? (
        /* eslint-disable-next-line @next/next/no-img-element -- external mugshot CDN */
        <img src={mug} alt="" onError={() => setImgBroken(true)} className="h-10 w-10 flex-shrink-0 rounded-md object-cover" />
      ) : (
        <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-md bg-ink-700 text-sm" aria-hidden="true">POI</div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{member.name}{flag ? <span title="8 or more violent felonies"> !</span> : null}</p>
        <p className="text-[11px] text-slate-400">{member.status || ''} · CCW {member.ccw ? 'Yes' : 'No'} · VCH {member.vch || 0}</p>
      </div>
      {canEdit && <button onClick={onEdit} className="flex-shrink-0 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10">Edit</button>}
    </div>
  )
}

function GangModal({ record, onClose, onSaved }: { record: GangRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(record?.name || '')
  const [colors, setColors] = useState(record?.colors || '')
  const [threat, setThreat] = useState<ThreatLevel>(record?.threat_level || 'medium')
  const [notes, setNotes] = useState(record?.notes || '')
  const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'

  const save = async () => {
    if (!name.trim()) { toast('Gang name is required.', 'warn'); return }
    const payload = { name: name.trim(), colors: colors.trim() || null, threat_level: threat, notes: notes.trim() || null }
    const res = record ? await update('gangs', record.id, payload) : await insert('gangs', payload)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(record ? 'Gang updated' : 'Gang created', 'success')
    onSaved()
  }

  const dirty = () =>
    name.trim() !== (record?.name || '') || colors.trim() !== (record?.colors || '') ||
    threat !== (record?.threat_level || 'medium') || notes.trim() !== (record?.notes || '')

  return (
    <Modal open wide onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title={`${record ? 'Edit' : 'New'} Gang`} onClose={onClose} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input value={name} onChange={(e) => setName(e.target.value)} className={input} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Colors</label><input value={colors} onChange={(e) => setColors(e.target.value)} className={input} /></div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Threat Level</label>
            <select value={threat} onChange={(e) => setThreat(e.target.value as ThreatLevel)} className={input}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} /></div>
        </div>
        <button onClick={() => void save()} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
          {record ? 'Save changes' : 'Create gang'}
        </button>
      </div>
    </Modal>
  )
}

function MemberModal({ gangId, member, people, cases, canDelete, onClose, onSaved, onDelete }: {
  gangId: string
  member: MemberRow | null
  people: PersonRow[]
  cases: CaseOption[]
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
  onDelete: (member: MemberRow) => void
}) {
  const [name, setName] = useState(member?.name || '')
  const [rank, setRank] = useState(member?.rank || 'Soldier')
  const [callsign, setCallsign] = useState(member?.callsign || '')
  const [status, setStatus] = useState(member?.status || 'At Large')
  const [personId, setPersonId] = useState(member?.person_id || '')
  const [caseId, setCaseId] = useState(member?.case_id || '')
  const [ccw, setCcw] = useState(!!member?.ccw)
  const [vch, setVch] = useState(String(member?.vch ?? 0))
  const [felonies, setFelonies] = useState(String(member?.felony_count ?? 0))
  const [mugshot, setMugshot] = useState(member?.mugshot_url || '')

  const personKnown = !personId || people.some((p) => p.id === personId)
  const caseKnown = !caseId || cases.some((c) => c.id === caseId)
  const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'

  const save = async () => {
    if (!name.trim()) { toast('Name is required.', 'warn'); return }
    const payload = {
      gang_id: gangId,
      name: name.trim(),
      rank: rank.trim() || null,
      callsign: callsign.trim() || null,
      status: status.trim() || null,
      person_id: personId || null,
      case_id: caseId || null,
      ccw,
      vch: Number(vch) || 0,
      felony_count: Number(felonies) || 0,
      mugshot_url: mugshot.trim() || null,
    }
    const res = member ? await update('gang_members', member.id, payload) : await insert('gang_members', payload)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Member saved', 'success')
    onSaved()
  }

  return (
    <Modal open wide onClose={onClose}>
      <div className="p-6">
        <ModalHeader title={`${member ? 'Edit' : 'Add'} Member`} onClose={onClose} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input value={name} onChange={(e) => setName(e.target.value)} className={input} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Rank</label><input list="gang-rank-list" value={rank} onChange={(e) => setRank(e.target.value)} className={input} /><datalist id="gang-rank-list">{RANK_SUGGEST.map((r) => <option key={r} value={r} />)}</datalist></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Callsign</label><input value={callsign} onChange={(e) => setCallsign(e.target.value)} className={input} /></div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Status</label><input value={status} onChange={(e) => setStatus(e.target.value)} className={input} /></div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Link Person</label>
            <select value={personId} onChange={(e) => setPersonId(e.target.value)} className={input}>
              <option value="">- link person (optional) -</option>
              {!personKnown && <option value={personId}>(linked person - loading...)</option>}
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Link Case</label>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className={input}>
              <option value="">- link case (optional) -</option>
              {!caseKnown && <option value={caseId}>(linked case - other bureau)</option>}
              {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">CCW</label>
            <select value={ccw ? 'true' : 'false'} onChange={(e) => setCcw(e.target.value === 'true')} className={input}>
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-xs font-semibold text-slate-400">VCH</label><input type="number" value={vch} onChange={(e) => setVch(e.target.value)} className={input} /></div>
            <div><label className="mb-1 block text-xs font-semibold text-slate-400">Felonies</label><input type="number" value={felonies} onChange={(e) => setFelonies(e.target.value)} className={input} /></div>
          </div>
          <div className="sm:col-span-2"><label className="mb-1 block text-xs font-semibold text-slate-400">Mugshot URL</label><input value={mugshot} onChange={(e) => setMugshot(e.target.value)} className={input} /></div>
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={() => void save()} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
            {member ? 'Save' : 'Add member'}
          </button>
          {member && canDelete && <button onClick={() => onDelete(member)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>}
        </div>
      </div>
    </Modal>
  )
}

function TurfModal({ gangId, onClose, onSaved }: { gangId: string; onClose: () => void; onSaved: () => void }) {
  const [block, setBlock] = useState('')
  const [density, setDensity] = useState<Density>('low')
  const [hotspot, setHotspot] = useState('')
  const input = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'

  const save = async () => {
    if (!block.trim()) { toast('Block is required.', 'warn'); return }
    const res = await insert('gang_turf', { gang_id: gangId, block: block.trim(), density, hotspot_area: hotspot.trim() || null })
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Turf added', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose}>
      <div className="p-6">
        <ModalHeader title="Add Turf Block" onClose={onClose} />
        <div className="space-y-3">
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Block / Territory *</label><input value={block} onChange={(e) => setBlock(e.target.value)} className={input} /></div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Density</label>
            <select value={density} onChange={(e) => setDensity(e.target.value as Density)} className={input}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div><label className="mb-1 block text-xs font-semibold text-slate-400">Hotspot Area</label><input value={hotspot} onChange={(e) => setHotspot(e.target.value)} className={input} /></div>
        </div>
        <button onClick={() => void save()} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Add Turf</button>
      </div>
    </Modal>
  )
}

function AttachGangModal({ gang, caseOptions, onClose }: { gang: GangRow; caseOptions: CaseOption[]; onClose: () => void }) {
  const { profile } = useAuth()
  const sorted = useMemo(
    () => caseOptions.slice().sort((a, b) => (a.case_number || '').localeCompare(b.case_number || '')),
    [caseOptions],
  )
  const [caseId, setCaseId] = useState(sorted[0]?.id || '')
  const label = `Gang - ${gang.name}${gang.colors ? ` (${gang.colors})` : ''} · ${cap(gang.threat_level)} threat`

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
            <button onClick={() => void go()} className="mt-4 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
              Attach reference
            </button>
          </>
        ) : (
          <p className="text-sm text-slate-500">No cases available to attach to.</p>
        )}
      </div>
    </Modal>
  )
}
