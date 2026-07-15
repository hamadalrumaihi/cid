'use client'

/** Intelligence roster — hierarchy view (members grouped into controlled rank
 *  tiers) and table view, with filters, sort, search, and non-destructive
 *  duplicate detection. Free-text ranks are mapped to tiers by keyword
 *  (gangIntel.rankTier) while the original label stays on the row; unknown
 *  ranks are never hidden. A member row opens the linked person's intel profile
 *  when one is linked. */
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { safeUrl } from '@/lib/safeUrl'
import { Badge } from '@/components/ui/Badge'
import { ProvenanceBadge } from '@/components/ui/IntelBadges'
import { EmptyState } from '@/components/ui/Notice'
import {
  duplicateMemberIds, findDuplicateMembers, groupByTier, humanize, normalizeName,
  rankTier, tierMeta, type TierId,
} from './gangIntel'
import type { MemberRow } from './gangShared'

const felonyFlag = (n: number | null) => (n ?? 0) >= 8

function Mug({ url, size = 'h-10 w-10' }: { url: string | null; size?: string }) {
  const [broken, setBroken] = useState(false)
  const src = safeUrl(url ?? '')
  if (src && !broken)
    // eslint-disable-next-line @next/next/no-img-element -- external mugshot CDN
    return <img src={src} alt="" onError={() => setBroken(true)} className={`${size} flex-shrink-0 rounded-md object-cover`} />
  return <div className={`${size} grid flex-shrink-0 place-items-center rounded-md bg-ink-700 text-[10px] font-semibold text-slate-400`} aria-hidden="true">POI</div>
}

function MemberName({ m, dup, router }: { m: MemberRow; dup: boolean; router: ReturnType<typeof useRouter> }) {
  const inner = (
    <>
      {m.name}
      {felonyFlag(m.felony_count) && <span title="8 or more violent felonies" className="ml-1 text-rose-400">⚑</span>}
      {dup && <span title="Possible duplicate — see the duplicate review banner" className="ml-1 text-amber-400">⧉</span>}
    </>
  )
  return m.person_id ? (
    <button
      type="button"
      onClick={() => router.push(`/persons?person=${encodeURIComponent(m.person_id!)}`)}
      className="text-left font-semibold text-white hover:text-blue-200"
      title="Open linked person profile"
    >
      {inner}
    </button>
  ) : (
    <span className="font-semibold text-white">{inner}</span>
  )
}

function RankCell({ m }: { m: MemberRow }) {
  const tier = rankTier(m.rank)
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-slate-200">{m.rank || '—'}</span>
      {tier !== 'unknown' && <span className="text-[10px] uppercase tracking-wide text-slate-500">{tierMeta(tier).label}</span>}
    </span>
  )
}

function MemberLine({ m, dup, router, canEdit, onEdit }: {
  m: MemberRow; dup: boolean; router: ReturnType<typeof useRouter>; canEdit: boolean; onEdit: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-850 p-2.5">
      <Mug url={m.mugshot_url} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm"><MemberName m={m} dup={dup} router={router} /></div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
          {m.callsign && <span>“{m.callsign}”</span>}
          <span>{m.status || 'Status unknown'}</span>
          <span title="Carrying a concealed weapon">CCW {m.ccw ? 'Yes' : 'No'}</span>
          <span title="Violent crime history count">VCH {m.vch ?? 0}</span>
          <span>{m.felony_count ?? 0} felonies</span>
          {m.provenance && <ProvenanceBadge provenance={m.provenance} />}
        </p>
      </div>
      {canEdit && (
        <button onClick={onEdit} className="-my-1 flex-shrink-0 rounded border border-white/10 bg-white/5 px-2 py-2 text-[11px] text-slate-200 hover:bg-white/10">Edit</button>
      )}
    </div>
  )
}

type FelonyBand = 'any' | '1' | '4' | '8'
type Tri = 'any' | 'yes' | 'no'
type Sort = 'hierarchy' | 'name' | 'updated' | 'felony'

const selCls = 'rounded-lg border border-white/10 bg-ink-850 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-badge-500'
const activeSelCls = 'border-badge-500 text-white'

export function RosterSection({ members, canEdit, onAddMember, onEditMember }: {
  members: MemberRow[]
  canEdit: boolean
  onAddMember: () => void
  onEditMember: (m: MemberRow) => void
}) {
  const router = useRouter()
  const [view, setView] = useState<'hierarchy' | 'table'>('hierarchy')
  const [q, setQ] = useState('')
  const [tier, setTier] = useState<TierId | 'any'>('any')
  const [status, setStatus] = useState('any')
  const [poi, setPoi] = useState<'any' | 'linked' | 'unlinked'>('any')
  const [ccw, setCcw] = useState<Tri>('any')
  const [felony, setFelony] = useState<FelonyBand>('any')
  const [noPhoto, setNoPhoto] = useState(false)
  const [dupOnly, setDupOnly] = useState(false)
  const [sort, setSort] = useState<Sort>('hierarchy')
  const [showDups, setShowDups] = useState(false)

  const dupIds = useMemo(() => duplicateMemberIds(members), [members])
  const dupClusters = useMemo(() => findDuplicateMembers(members), [members])
  const statuses = useMemo(() => [...new Set(members.map((m) => m.status).filter(Boolean))] as string[], [members])

  const filtered = useMemo(() => {
    const needle = normalizeName(q)
    const band = felony === '8' ? 8 : felony === '4' ? 4 : felony === '1' ? 1 : 0
    return members.filter((m) => {
      if (tier !== 'any' && rankTier(m.rank) !== tier) return false
      if (status !== 'any' && m.status !== status) return false
      if (poi === 'linked' && !m.person_id) return false
      if (poi === 'unlinked' && m.person_id) return false
      if (ccw === 'yes' && !m.ccw) return false
      if (ccw === 'no' && m.ccw) return false
      if (band && (m.felony_count ?? 0) < band) return false
      if (noPhoto && m.mugshot_url) return false
      if (dupOnly && !dupIds.has(m.id)) return false
      if (needle) {
        const hay = normalizeName([m.name, m.callsign].filter(Boolean).join(' '))
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [members, tier, status, poi, ccw, felony, noPhoto, dupOnly, dupIds, q])

  const sorted = useMemo(() => {
    if (sort === 'hierarchy') return filtered
    const c = [...filtered]
    if (sort === 'name') c.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    else if (sort === 'felony') c.sort((a, b) => (b.felony_count ?? 0) - (a.felony_count ?? 0))
    else if (sort === 'updated') c.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    return c
  }, [filtered, sort])

  const tiers = useMemo(() => groupByTier(sorted), [sorted])
  const activeFilters = tier !== 'any' || status !== 'any' || poi !== 'any' || ccw !== 'any' || felony !== 'any' || noPhoto || dupOnly || !!q.trim()

  const resetFilters = () => { setTier('any'); setStatus('any'); setPoi('any'); setCcw('any'); setFelony('any'); setNoPhoto(false); setDupOnly(false); setQ('') }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-white">Roster</h3>
          <Badge tone="neutral">{members.length}</Badge>
          <div role="tablist" aria-label="Roster view" className="inline-flex rounded-lg border border-white/10 bg-ink-850 p-0.5">
            {(['hierarchy', 'table'] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold capitalize ${view === v ? 'bg-badge-500 text-white' : 'text-slate-300 hover:bg-white/10'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
        {canEdit && (
          <button onClick={onAddMember} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">+ Member</button>
        )}
      </div>

      {dupClusters.length > 0 && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-amber-200">
              {dupClusters.length} possible duplicate {dupClusters.length === 1 ? 'name' : 'names'} in this roster ({dupIds.size} rows)
            </p>
            <button onClick={() => setShowDups((v) => !v)} className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20">
              {showDups ? 'Hide' : 'Review duplicates'}
            </button>
          </div>
          {showDups && (
            <ul className="mt-2 space-y-2">
              {dupClusters.map((c) => (
                <li key={c.key} className="rounded-lg bg-ink-900/60 p-2">
                  <p className="text-[11px] text-amber-200/80">{c.reason} — {c.members.length} rows</p>
                  <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {c.members.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-2 rounded bg-ink-850 px-2 py-1 text-xs">
                        <span className="truncate text-slate-200">{m.name}{m.callsign ? ` · “${m.callsign}”` : ''} · {m.rank || '—'}</span>
                        {canEdit && <button onClick={() => onEditMember(m)} className="flex-shrink-0 rounded border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-slate-200 hover:bg-white/10">Open</button>}
                      </div>
                    ))}
                  </div>
                </li>
              ))}
              <li className="text-[11px] text-slate-500">Detection is non-destructive — records are never merged or removed automatically. Open a row to correct or unlink it.</li>
            </ul>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search name / alias…" className={`min-w-[10rem] flex-1 ${selCls} ${q ? activeSelCls : ''}`} />
        <select aria-label="Rank tier" value={tier} onChange={(e) => setTier(e.target.value as TierId | 'any')} className={`${selCls} ${tier !== 'any' ? activeSelCls : ''}`}>
          <option value="any">All ranks</option>
          {(['leader', 'command', 'senior', 'member', 'associate', 'unknown'] as TierId[]).map((t) => <option key={t} value={t}>{tierMeta(t).label}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={`${selCls} ${status !== 'any' ? activeSelCls : ''}`}>
          <option value="any">Any status</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Linked person" value={poi} onChange={(e) => setPoi(e.target.value as 'any' | 'linked' | 'unlinked')} className={`${selCls} ${poi !== 'any' ? activeSelCls : ''}`}>
          <option value="any">POI: any</option>
          <option value="linked">POI linked</option>
          <option value="unlinked">POI unlinked</option>
        </select>
        <select aria-label="CCW" value={ccw} onChange={(e) => setCcw(e.target.value as Tri)} className={`${selCls} ${ccw !== 'any' ? activeSelCls : ''}`}>
          <option value="any">CCW: any</option>
          <option value="yes">CCW yes</option>
          <option value="no">CCW no</option>
        </select>
        <select aria-label="Felony threshold" value={felony} onChange={(e) => setFelony(e.target.value as FelonyBand)} className={`${selCls} ${felony !== 'any' ? activeSelCls : ''}`}>
          <option value="any">Felonies: any</option>
          <option value="1">≥ 1</option>
          <option value="4">≥ 4</option>
          <option value="8">≥ 8</option>
        </select>
        <label className={`flex items-center gap-1.5 ${selCls} ${noPhoto ? activeSelCls : ''}`}><input type="checkbox" checked={noPhoto} onChange={(e) => setNoPhoto(e.target.checked)} className="h-3.5 w-3.5 accent-badge-500" />No photo</label>
        <label className={`flex items-center gap-1.5 ${selCls} ${dupOnly ? activeSelCls : ''}`}><input type="checkbox" checked={dupOnly} onChange={(e) => setDupOnly(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />Dupes</label>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={selCls}>
          <option value="hierarchy">Sort: hierarchy</option>
          <option value="name">Sort: name</option>
          <option value="updated">Sort: recently updated</option>
          <option value="felony">Sort: felony count</option>
        </select>
        {activeFilters && <button onClick={resetFilters} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/10">Clear</button>}
      </div>

      {!members.length ? (
        <EmptyState title="No members on file" hint={canEdit ? 'Add the first with “+ Member”.' : undefined} />
      ) : !sorted.length ? (
        <p className="rounded-xl border border-white/5 bg-ink-900/60 p-4 text-sm text-slate-400">No members match these filters.</p>
      ) : view === 'table' ? (
        <div className="overflow-x-auto rounded-xl border border-white/5">
          <table className="w-full min-w-[46rem] text-left text-sm">
            <thead className="bg-ink-850 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">Member</th>
                <th scope="col" className="px-3 py-2 font-semibold">Rank</th>
                <th scope="col" className="px-3 py-2 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2 font-semibold"><abbr title="Carrying a concealed weapon">CCW</abbr></th>
                <th scope="col" className="px-3 py-2 font-semibold"><abbr title="Violent crime history count">VCH</abbr></th>
                <th scope="col" className="px-3 py-2 font-semibold">Felonies</th>
                <th scope="col" className="px-3 py-2 font-semibold">Source</th>
                {canEdit && <th scope="col" className="px-3 py-2 font-semibold sr-only">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sorted.map((m) => (
                <tr key={m.id} className="hover:bg-white/5">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Mug url={m.mugshot_url} size="h-8 w-8" />
                      <div className="min-w-0">
                        <div className="truncate"><MemberName m={m} dup={dupIds.has(m.id)} router={router} /></div>
                        {m.callsign && <p className="truncate text-[11px] text-slate-500">“{m.callsign}”</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2"><RankCell m={m} /></td>
                  <td className="px-3 py-2 text-slate-300">{m.status || '—'}</td>
                  <td className="px-3 py-2 text-slate-300">{m.ccw ? 'Yes' : 'No'}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">{m.vch ?? 0}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-300">{m.felony_count ?? 0}</td>
                  <td className="px-3 py-2">{m.provenance ? <ProvenanceBadge provenance={m.provenance} /> : <span className="text-slate-600">—</span>}</td>
                  {canEdit && <td className="px-3 py-2 text-right"><button onClick={() => onEditMember(m)} className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10">Edit</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          {tiers.map(({ tier: t, members: rows }) => (
            <div key={t.id}>
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-blue-300/70">
                {t.label} <span className="rounded-full bg-white/10 px-1.5 text-slate-400">{rows.length}</span>
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {rows.map((m) => (
                  <MemberLine key={m.id} m={m} dup={dupIds.has(m.id)} router={router} canEdit={canEdit} onEdit={() => onEditMember(m)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export { humanize }
