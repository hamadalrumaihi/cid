'use client'

/** BOLO Board - port of vehicles.js BOLO section. Shows persons flagged
 *  `bolo=true`, enriched with latest RLS-visible warrant status where one
 *  names the subject. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Json, Tables } from '@/lib/database.types'
import { list, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { WARRANT_TINT, WARRANT_TPLS, warrantStatusOf } from '@/lib/forms'
import { IntelProfile, type IntelTarget } from '@/components/persons/IntelProfile'
import { PersonModal, type GangRow, type PersonRow } from '@/components/persons/PersonModal'

type ReportRow = Tables<'reports'>

interface WarrantHit {
  status: string
  updatedAt: string
}

function namesFromReport(r: ReportRow): string[] {
  const fields = (r.fields ?? {}) as Record<string, Json | undefined>
  const names: string[] = []
  if (Array.isArray(fields.suspects)) {
    for (const suspect of fields.suspects) {
      if (suspect && typeof suspect === 'object' && 'full_name' in suspect) {
        const value = (suspect as Record<string, Json>).full_name
        if (typeof value === 'string') names.push(value)
      }
    }
  }
  if (typeof fields.full_name === 'string') names.push(fields.full_name)
  return names
}

function warrantLookup(reports: ReportRow[]): Map<string, WarrantHit> {
  const m = new Map<string, WarrantHit>()
  const warrants = reports
    .filter((r) => !!r.template && WARRANT_TPLS[r.template])
    .slice()
    .sort((a, b) => new Date(a.updated_at || a.created_at || 0).getTime() - new Date(b.updated_at || b.created_at || 0).getTime())
  for (const r of warrants) {
    const status = warrantStatusOf(r)
    const updatedAt = r.updated_at || r.created_at
    namesFromReport(r).forEach((name) => {
      const key = name.trim().toLowerCase()
      if (key) m.set(key, { status, updatedAt })
    })
  }
  return m
}

export function BoloView() {
  const { state, canEdit } = useAuth()
  const [persons, setPersons] = useState<PersonRow[]>([])
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [reports, setReports] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [profile, setProfile] = useState<IntelTarget | null>(null)
  const [editor, setEditor] = useState<PersonRow | null>(null)
  const vPersons = useTableVersion('persons')
  const vReports = useTableVersion('reports')
  const vGangs = useTableVersion('gangs')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      const [p, g, r] = await Promise.all([
        withRetry(() => list('persons', { order: 'updated_at', ascending: false })),
        list('gangs', { order: 'name' }).catch(() => [] as GangRow[]),
        list('reports', {}).catch(() => [] as ReportRow[]),
      ])
      setPersons(p)
      setGangs(g)
      setReports(r)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vPersons, vReports, vGangs])

  const gangName = useCallback((id: string | null) => (id && gangs.find((g) => g.id === id)?.name) || null, [gangs])
  const warrants = useMemo(() => warrantLookup(reports), [reports])
  const allBolos = useMemo(() => persons.filter((p) => p.bolo), [persons])
  const q = query.trim().toLowerCase()
  const items = useMemo(
    () => allBolos.filter((p) => !q || [p.name, p.alias, p.status, gangName(p.gang_id)].some((s) => (s || '').toLowerCase().includes(q))),
    [allBolos, q, gangName],
  )

  const clearBolo = async (p: PersonRow) => {
    if (!(await uiConfirm(`Clear the BOLO on ${p.name || 'this person'}?`, { confirmText: 'Clear' }))) return
    const res = await update('persons', p.id, { bolo: false })
    if (res.error) { toast(`Update failed: ${res.error.message}`, 'danger'); return }
    toast('BOLO cleared', 'info')
    void refresh()
  }

  return (
    <section className="view-in space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-rose-500/20 bg-ink-900/60 p-6">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold text-white">
            BOLO Board
            {state === 'in' && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-medium text-rose-300">
                <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-rose-400" />live
              </span>
            )}
          </h3>
          <p className="text-sm text-slate-400">At-large subjects flagged be-on-the-lookout, with warrant status where one exists.</p>
        </div>
        {allBolos.length > 0 && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter name, alias, gang..."
            aria-label="Filter BOLOs"
            className="w-56 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {state !== 'in' ? (
          <Notice text="Sign in to view the BOLO board." />
        ) : err ? (
          <Notice text={`Could not load BOLOs: ${err}`} />
        ) : loading && !persons.length ? (
          <Notice text="Loading BOLO board..." />
        ) : !allBolos.length ? (
          <Notice text="NO ACTIVE BOLOS // SECTOR QUIET. Flag a person via Persons -> Edit -> Active BOLO." />
        ) : !items.length ? (
          <Notice text={`No BOLOs match "${query.trim()}".`} />
        ) : (
          items.map((p) => (
            <BoloCard
              key={p.id}
              person={p}
              gang={gangName(p.gang_id)}
              warrant={warrants.get((p.name || '').trim().toLowerCase())}
              canEdit={canEdit}
              onProfile={() => setProfile({ type: 'person', id: p.id })}
              onEdit={() => setEditor(p)}
              onClear={() => void clearBolo(p)}
            />
          ))
        )}
      </div>

      {profile && <IntelProfile initial={profile} gangs={gangs} onClose={() => setProfile(null)} />}
      {editor && <PersonModal record={editor} gangs={gangs} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void refresh() }} />}
    </section>
  )
}

function Notice({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400 sm:col-span-2 xl:col-span-3">{text}</div>
}

function BoloCard({ person, gang, warrant, canEdit, onProfile, onEdit, onClear }: {
  person: PersonRow
  gang: string | null
  warrant?: WarrantHit
  canEdit: boolean
  onProfile: () => void
  onEdit: () => void
  onClear: () => void
}) {
  const [imgBroken, setImgBroken] = useState(false)
  const mug = safeUrl(person.mugshot_url ?? '')
  const tint = warrant ? WARRANT_TINT[warrant.status] || WARRANT_TINT.draft : ''

  return (
    <div className="overflow-hidden rounded-2xl border border-rose-500/20 bg-ink-900/60">
      <div className="flex items-center justify-between gap-2 bg-rose-500/10 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-rose-300">Be on the lookout</span>
        {warrant && <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${tint}`}>warrant: {warrant.status}</span>}
      </div>
      <div className="flex gap-4 p-4">
        {mug && !imgBroken ? (
          /* eslint-disable-next-line @next/next/no-img-element -- external mugshot CDN */
          <img src={mug} alt="" onError={() => setImgBroken(true)} className="h-20 w-20 flex-shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="grid h-20 w-20 flex-shrink-0 place-items-center rounded-lg bg-ink-800 text-lg font-bold text-slate-400" aria-hidden="true">POI</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-white">{person.name}</p>
          {person.alias && <p className="text-xs text-slate-400">&ldquo;{person.alias}&rdquo;</p>}
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-slate-300">{person.status || 'Suspect'}</span>
            {gang && <span className="rounded bg-violet-500/10 px-1.5 py-0.5 text-violet-300">{gang}</span>}
            {person.ccw && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-semibold text-rose-300" title="May be armed - exercise caution">ARMED RISK</span>}
            {!!person.felony_count && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">{person.felony_count} felonies</span>}
          </div>
        </div>
      </div>
      <div className="flex gap-2 border-t border-white/5 px-4 py-2.5">
        <button onClick={onProfile} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-blue-200 transition hover:bg-white/10">Profile</button>
        {canEdit && <button onClick={onEdit} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10">Edit</button>}
        {canEdit && <button onClick={onClear} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10">Clear BOLO</button>}
      </div>
    </div>
  )
}
