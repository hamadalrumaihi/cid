'use client'

/** Gangs & Turf registry — the live gang list + orchestration. The detail
 *  screen is the intelligence dossier (gangCards re-exports GangDossier as
 *  GangDetail). Registry cards, search, and filters run off aggregate rollups
 *  computed once from a handful of small tables (not per-card queries and not
 *  JSON.stringify), and the whole area is deep-linkable via ?gang= / ?section=. */
import { useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { deleteWithUndo, list, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { useRegistry } from '@/lib/useRegistry'
import { useNow } from '@/lib/useNow'
import { uiConfirm } from '@/components/ui/dialog'
import { Notice, EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { IntelProfile, type IntelTarget } from '@/components/persons/IntelProfile'
import { GangCard, GangDetail, type GangCardStats } from './gangCards'
import { GangModal } from './gangModals'
import { GANG_CLASSIFICATIONS, GANG_STATUSES, humanize, isGangStale, normalizeName, rankTier } from './gangIntel'
import { GANG_DELETE_CHILDREN, GANG_NULL_REFS, PAGE, type CaseOption, type GangPlaceRow, type GangRow, type IntelLinkRow, type MemberRow, type PersonRow, type PlaceRow, type TurfRow } from './gangShared'

interface CaseLite { id: string; case_number: string; title: string | null; status: string | null }

export function GangsView() {
  const { state, canEdit, canDelete } = useAuth()
  const router = useRouter()
  const sp = useSearchParams()
  const now = useNow()
  const [people, setPeople] = useState<PersonRow[]>([])
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([])
  // Aggregate source tables — small (a few hundred rows total), fetched once
  // and rolled up client-side rather than one query per card.
  const [members, setMembers] = useState<MemberRow[]>([])
  const [turf, setTurf] = useState<TurfRow[]>([])
  const [places, setPlaces] = useState<PlaceRow[]>([])
  const [gangPlaces, setGangPlaces] = useState<GangPlaceRow[]>([])
  const [intelLinks, setIntelLinks] = useState<IntelLinkRow[]>([])
  const [caseStatus, setCaseStatus] = useState<Map<string, string | null>>(new Map())

  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  const [pageState, setPageState] = useState({ q: '', shown: PAGE })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(() => sp.get('gang'))
  const [editor, setEditor] = useState<GangRow | 'new' | null>(null)
  const [profile, setProfile] = useState<IntelTarget | null>(null)
  const [view, setView] = useState<'grid' | 'list'>('grid')

  // Filters
  const [threat, setThreat] = useState('any')
  const [status, setStatus] = useState('any')
  const [classification, setClassification] = useState('any')
  const [hasTurf, setHasTurf] = useState(false)
  const [openCases, setOpenCases] = useState(false)
  const [staleOnly, setStaleOnly] = useState(false)
  const [noLeader, setNoLeader] = useState(false)
  const [noSummary, setNoSummary] = useState(false)

  const vMembers = useTableVersion('gang_members')
  const vTurf = useTableVersion('gang_turf')
  const vPersons = useTableVersion('persons')
  const vCases = useTableVersion('cases')
  const vGangPlaces = useTableVersion('gang_places')
  const vLinks = useTableVersion('case_intel_links')

  const { rows: gangs, loading, error: err, refresh } = useRegistry<GangRow>({
    table: 'gangs',
    watch: [vMembers, vTurf, vPersons, vCases, vGangPlaces, vLinks],
    load: async () => {
      const [g, p, c, m, t, pl, gp, il] = await Promise.all([
        withRetry(() => list('gangs', { order: 'name', ascending: true })),
        list('persons', { order: 'name' }).catch(() => [] as PersonRow[]),
        list('cases', { select: 'id,case_number,title,status', order: 'updated_at', ascending: false }).then((r) => r as unknown as CaseLite[]).catch(() => [] as CaseLite[]),
        list('gang_members').catch(() => [] as MemberRow[]),
        list('gang_turf').catch(() => [] as TurfRow[]),
        list('places').catch(() => [] as PlaceRow[]),
        list('gang_places').catch(() => [] as GangPlaceRow[]),
        list('case_intel_links', { eq: { kind: 'gang' } }).catch(() => [] as IntelLinkRow[]),
      ])
      setPeople(p)
      setCaseOptions(c.map((x) => ({ id: x.id, case_number: x.case_number, title: x.title })))
      setCaseStatus(new Map(c.map((x) => [x.id, x.status])))
      setMembers(m); setTurf(t); setPlaces(pl); setGangPlaces(gp); setIntelLinks(il)
      setSelected((sel) => new Set([...sel].filter((id) => g.some((x) => x.id === id))))
      setDetailId((id) => (id && !g.some((x) => x.id === id) ? null : id))
      return g
    },
  })

  // ── Aggregate rollups (one pass each) ──────────────────────────────────────
  const statsByGang = useMemo(() => {
    const map = new Map<string, GangCardStats & { search: string }>()
    for (const g of gangs) map.set(g.id, { members: 0, leaders: [], turf: 0, places: 0, openCases: 0, search: '' })
    const searchParts = new Map<string, string[]>()
    const push = (id: string, ...tokens: (string | null | undefined)[]) => {
      const arr = searchParts.get(id) ?? []
      for (const t of tokens) if (t) arr.push(t)
      searchParts.set(id, arr)
    }
    for (const g of gangs) push(g.id, g.name, g.aliases, g.colors, g.status, g.classification)
    for (const m of members) {
      const s = map.get(m.gang_id); if (!s) continue
      s.members++
      if (['leader', 'command'].includes(rankTier(m.rank))) s.leaders.push(m.name)
      push(m.gang_id, m.name, m.callsign)
    }
    for (const t of turf) { const s = map.get(t.gang_id); if (s) { s.turf++; push(t.gang_id, t.block, t.hotspot_area) } }
    const placeName = new Map(places.map((p) => [p.id, p.name]))
    for (const p of places) if (p.controlling_gang_id) { const s = map.get(p.controlling_gang_id); if (s) { s.places++; push(p.controlling_gang_id, p.name, p.area) } }
    for (const gp of gangPlaces) { const s = map.get(gp.gang_id); if (s) { s.places++; push(gp.gang_id, placeName.get(gp.place_id)) } }
    for (const l of intelLinks) {
      const s = map.get(l.ref_id); if (!s) continue
      const st = caseStatus.get(l.case_id)
      if (st && !['closed', 'archived'].includes(st)) s.openCases++
      push(l.ref_id, caseOptions.find((c) => c.id === l.case_id)?.case_number)
    }
    for (const [id, parts] of searchParts) { const s = map.get(id); if (s) s.search = normalizeName(parts.join(' ')) }
    return map
  }, [gangs, members, turf, places, gangPlaces, intelLinks, caseStatus, caseOptions])

  const anyFilter = threat !== 'any' || status !== 'any' || classification !== 'any' || hasTurf || openCases || staleOnly || noLeader || noSummary
  const q = normalizeName(query)
  const items = useMemo(() => {
    return gangs.filter((g) => {
      const s = statsByGang.get(g.id)
      if (threat !== 'any' && g.threat_level !== threat) return false
      if (status !== 'any' && (g.status ?? '') !== status) return false
      if (classification !== 'any' && (g.classification ?? '') !== classification) return false
      if (hasTurf && (s?.turf ?? 0) === 0) return false
      if (openCases && (s?.openCases ?? 0) === 0) return false
      if (staleOnly && !isGangStale(g, now)) return false
      if (noLeader && g.lead_detective_id) return false
      if (noSummary) {
        const hasSummary = g.intelligence_summary && typeof g.intelligence_summary === 'object' && Object.keys(g.intelligence_summary).length > 0
        if (hasSummary) return false
      }
      if (q && !(s?.search ?? '').includes(q)) return false
      return true
    })
  }, [gangs, statsByGang, threat, status, classification, hasTurf, openCases, staleOnly, noLeader, noSummary, q, now])

  const shown = pageState.q === q ? pageState.shown : PAGE
  const visible = items.slice(0, shown)
  const remaining = Math.max(0, items.length - visible.length)
  const detail = detailId ? gangs.find((g) => g.id === detailId) ?? null : null

  const openGang = (id: string) => {
    setDetailId(id)
    const params = new URLSearchParams(sp.toString())
    params.set('gang', id); params.delete('q')
    router.replace(`/gangs?${params.toString()}`)
  }
  const closeDetail = () => {
    setDetailId(null)
    const params = new URLSearchParams(sp.toString())
    params.delete('gang'); params.delete('section')
    router.replace(params.toString() ? `/gangs?${params.toString()}` : '/gangs')
  }

  const toggleSelect = (id: string, on: boolean) =>
    setSelected((sel) => { const next = new Set(sel); if (on) next.add(id); else next.delete(id); return next })

  const deleteRows = async (rows: GangRow[]) => {
    if (!rows.length) return
    const n = rows.length
    if (!(await uiConfirm(`Delete ${n} selected gang${n > 1 ? 's' : ''}? This also removes roster, ranks, turf, and place links.`, { confirmText: `Delete ${n}` }))) return
    setSelected(new Set())
    await deleteWithUndo('gangs', rows, { label: `${n} gang${n > 1 ? 's' : ''}`, noConfirm: true, after: () => void refresh(), children: GANG_DELETE_CHILDREN, setNullRefs: GANG_NULL_REFS })
  }
  const deleteOne = async (g: GangRow) => {
    if (!(await uiConfirm(`Delete gang "${g.name}"? This removes its members, ranks, turf, and place links.`, { confirmText: 'Delete' }))) return
    closeDetail()
    await deleteWithUndo('gangs', g, { label: `Gang "${g.name}"`, noConfirm: true, after: () => void refresh(), children: GANG_DELETE_CHILDREN, setNullRefs: GANG_NULL_REFS })
  }

  const resetFilters = () => { setThreat('any'); setStatus('any'); setClassification('any'); setHasTurf(false); setOpenCases(false); setStaleOnly(false); setNoLeader(false); setNoSummary(false) }

  if (detail) {
    return (
      <GangDetail
        gang={detail}
        people={people}
        caseOptions={caseOptions}
        canEdit={canEdit}
        canDelete={canDelete}
        onBack={closeDetail}
        onRefresh={refresh}
        onEdit={() => setEditor(detail)}
        onDelete={() => void deleteOne(detail)}
        onProfile={() => setProfile({ type: 'gang', id: detail.id })}
      >
        {editor && <GangModal record={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void refresh() }} />}
        {profile && <IntelProfile initial={profile} gangs={gangs} onClose={() => setProfile(null)} />}
      </GangDetail>
    )
  }

  const sel = 'rounded-lg border border-white/10 bg-ink-850 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-badge-500'
  const active = 'border-badge-500 text-white'

  return (
    <section className="view-in space-y-4">
      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <PageHeader
          title="Gangs & Turf"
          subtitle="Organizations, rank structure, linked properties, and territory control."
          actions={
            <>
              {state === 'in' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" />live
                </span>
              )}
              {canEdit && (
                <button onClick={() => setEditor('new')} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">+ New Gang</button>
              )}
            </>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search gang, alias, member, callsign, turf, place, case…" className={`min-w-[14rem] flex-1 rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-badge-500`} />
        <div role="tablist" aria-label="Layout" className="inline-flex rounded-lg border border-white/10 bg-ink-850 p-0.5">
          {(['grid', 'list'] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize ${view === v ? 'bg-badge-500 text-ink-950' : 'text-slate-300 hover:bg-white/10'}`}>{v}</button>
          ))}
        </div>
        <button onClick={() => void refresh()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">Refresh</button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Threat" value={threat} onChange={(e) => setThreat(e.target.value)} className={`${sel} ${threat !== 'any' ? active : ''}`}><option value="any">Any threat</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${sel} ${status !== 'any' ? active : ''}`}><option value="any">Any status</option>{GANG_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
        <select aria-label="Classification" value={classification} onChange={(e) => setClassification(e.target.value)} className={`${sel} ${classification !== 'any' ? active : ''}`}><option value="any">Any type</option>{GANG_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}</select>
        <label className={`flex items-center gap-1.5 ${sel} ${hasTurf ? active : ''}`}><input type="checkbox" checked={hasTurf} onChange={(e) => setHasTurf(e.target.checked)} className="h-3.5 w-3.5 accent-badge-500" />Has turf</label>
        <label className={`flex items-center gap-1.5 ${sel} ${openCases ? active : ''}`}><input type="checkbox" checked={openCases} onChange={(e) => setOpenCases(e.target.checked)} className="h-3.5 w-3.5 accent-badge-500" />Open cases</label>
        <label className={`flex items-center gap-1.5 ${sel} ${staleOnly ? active : ''}`}><input type="checkbox" checked={staleOnly} onChange={(e) => setStaleOnly(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />Stale intel</label>
        <label className={`flex items-center gap-1.5 ${sel} ${noLeader ? active : ''}`}><input type="checkbox" checked={noLeader} onChange={(e) => setNoLeader(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />No lead</label>
        <label className={`flex items-center gap-1.5 ${sel} ${noSummary ? active : ''}`}><input type="checkbox" checked={noSummary} onChange={(e) => setNoSummary(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />No summary</label>
        {anyFilter && <button onClick={resetFilters} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10">Clear filters</button>}
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

      <div className={view === 'grid' ? 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3' : 'grid grid-cols-1 gap-3'}>
        {state !== 'in' ? (
          <Notice text="Live gang records require sign-in." className="md:col-span-2 xl:col-span-3" />
        ) : err ? (
          <ErrorNotice message={err} onRetry={refresh} className="md:col-span-2 xl:col-span-3" />
        ) : loading && !gangs.length ? (
          <div className="md:col-span-2 xl:col-span-3"><CardGridSkeleton count={6} cols="md:grid-cols-2 xl:grid-cols-3" /></div>
        ) : !items.length ? (
          gangs.length ? (
            <Notice text="No gangs match your search or filters." className="md:col-span-2 xl:col-span-3" />
          ) : (
            <EmptyState title="No gangs on file yet" hint={canEdit ? 'Add one with the New Gang button.' : undefined} className="md:col-span-2 xl:col-span-3" />
          )
        ) : (
          <>
            {visible.map((g) => (
              <GangCard
                key={g.id}
                gang={g}
                stats={statsByGang.get(g.id)}
                canDelete={canDelete}
                selected={selected.has(g.id)}
                now={now}
                onSelect={(on) => toggleSelect(g.id, on)}
                onOpen={() => openGang(g.id)}
                onProfile={() => setProfile({ type: 'gang', id: g.id })}
              />
            ))}
            {remaining > 0 && (
              <div className="col-span-full pt-1 text-center">
                <button onClick={() => setPageState({ q, shown: shown + PAGE })} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10">
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
