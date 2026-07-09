'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { deleteWithUndo, list, remove } from '@/lib/db'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { MemberModal, TurfModal } from './gangModals'
import { cap, densityTint, threatTint, type CaseOption, type GangRow, type MemberRow, type PersonRow, type PlaceRow, type TurfRow } from './gangShared'

export function GangCard({ gang, canDelete, selected, onSelect, onOpen, onProfile }: {
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

export function GangDetail({ gang, people, caseOptions, canEdit, canDelete, onBack, onRefresh, onEdit, onDelete, onProfile, onAttach, children }: {
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

export function MemberCard({ member, canEdit, onEdit }: { member: MemberRow; canEdit: boolean; onEdit: () => void }) {
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
