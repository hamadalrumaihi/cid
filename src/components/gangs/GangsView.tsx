'use client'

/** Gangs & Turf — the live gang list + orchestration. Detail, cards, and the
 *  create/edit modals live in gangCards.tsx / gangModals.tsx; shared types and
 *  helpers in gangShared.tsx. Port of vanilla gangs.js. */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { deleteWithUndo, list, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { useRegistry } from '@/lib/useRegistry'
import { uiConfirm } from '@/components/ui/dialog'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { IntelProfile, type IntelTarget } from '@/components/persons/IntelProfile'
import { GangCard, GangDetail } from './gangCards'
import { GangModal, AttachGangModal } from './gangModals'
import { GANG_DELETE_CHILDREN, GANG_NULL_REFS, Notice, PAGE, type CaseOption, type GangRow, type PersonRow } from './gangShared'

export function GangsView() {
  const { state, canEdit, canDelete } = useAuth()
  const sp = useSearchParams()
  const [people, setPeople] = useState<PersonRow[]>([])
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([])
  // `?q=` seeds the filter — how global-search results land here prefiltered.
  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  const [page, setPage] = useState({ q: '', shown: PAGE })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editor, setEditor] = useState<GangRow | 'new' | null>(null)
  const [profile, setProfile] = useState<IntelTarget | null>(null)
  const [attach, setAttach] = useState<GangRow | null>(null)

  const vMembers = useTableVersion('gang_members')
  const vTurf = useTableVersion('gang_turf')
  const vPersons = useTableVersion('persons')
  const vCases = useTableVersion('cases')

  const { rows: gangs, loading, error: err, refresh } = useRegistry<GangRow>({
    table: 'gangs',
    watch: [vMembers, vTurf, vPersons, vCases],
    load: async () => {
      const [g, p, c] = await Promise.all([
        withRetry(() => list('gangs', { order: 'name', ascending: true })),
        list('persons', { order: 'name' }).catch(() => [] as PersonRow[]),
        list('cases', { select: 'id,case_number,title', order: 'updated_at', ascending: false })
          .then((rows) => rows as unknown as CaseOption[])
          .catch(() => [] as CaseOption[]),
      ])
      setPeople(p)
      setCaseOptions(c)
      setSelected((sel) => new Set([...sel].filter((id) => g.some((x) => x.id === id))))
      setDetailId((id) => (id && g.some((x) => x.id === id) ? id : null))
      return g
    },
  })

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
          <CardGridSkeleton count={4} cols="xl:grid-cols-2" />
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
