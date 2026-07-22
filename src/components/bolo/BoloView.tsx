'use client'

/** BOLO Board — persons flagged `bolo=true`, rendered from the STRUCTURED
 *  BOLO fields (reason/risk/instructions/issued/expiry) plus wanted/warrant
 *  status from a projected `legal_requests.person_id` fetch. The old approach
 *  (full `reports` table scan + exact free-text name matching) is gone; the
 *  data spine is now the same structured legal join the person dossier uses.
 *  Board layout unchanged: rose-framed cards, live filter, profile/edit. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { list, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { fmtDate, todayISO } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { priorityTint } from '@/lib/tint'
import { useNow } from '@/lib/useNow'
import { Badge } from '@/components/ui/Badge'
import { DeadlineChip } from '@/components/ui/DeadlineChip'
import { Notice, EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { humanize } from '@/components/gangs/gangIntel'
import { IntelProfile, type IntelTarget } from '@/components/persons/IntelProfile'
import { PersonModal, type GangRow, type PersonRow } from '@/components/persons/PersonModal'
import { boloState, legalStatusOf } from '@/components/persons/personIntel'
import { ManageBoloModal } from '@/components/persons/ProfileLegal'
import { LEGAL_COLS, type LegalLite } from '@/components/persons/profileLoad'
import { MdtExportsPanel } from './MdtExports'

export function BoloView() {
  const { state, canEdit, isCommand } = useAuth()
  const now = useNow()
  const [today] = useState(todayISO)
  const [persons, setPersons] = useState<PersonRow[]>([])
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [legal, setLegal] = useState<LegalLite[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [profile, setProfile] = useState<IntelTarget | null>(null)
  const [editor, setEditor] = useState<PersonRow | null>(null)
  const [manage, setManage] = useState<PersonRow | null>(null)
  const vPersons = useTableVersion('persons')
  const vLegal = useTableVersion('legal_requests')
  const vGangs = useTableVersion('gangs')
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  // Re-render issued-by attributions once the roster cache lands.
  useProfilesStore((s) => s.loaded)

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    setErr(null)
    try {
      // Only flagged persons — never the whole registry, never `reports`.
      const [p, g] = await Promise.all([
        withRetry(() => list('persons', { eq: { bolo: true }, order: 'updated_at', ascending: false })),
        list('gangs', { order: 'name' }).catch(() => [] as GangRow[]),
      ])
      const ids = p.map((x) => x.id)
      const lr = ids.length
        ? await list('legal_requests', { select: LEGAL_COLS, in: { person_id: ids } })
            .then((r) => r as unknown as LegalLite[])
            .catch(() => [] as LegalLite[])
        : []
      setPersons(p)
      setGangs(g)
      setLegal(lr)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void fetchProfiles(); void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, fetchProfiles, vPersons, vLegal, vGangs])

  const gangName = useCallback((id: string | null) => (id && gangs.find((g) => g.id === id)?.name) || null, [gangs])
  const legalByPerson = useMemo(() => {
    const m = new Map<string, LegalLite[]>()
    for (const r of legal) {
      if (!r.person_id) continue
      m.set(r.person_id, [...(m.get(r.person_id) ?? []), r])
    }
    return m
  }, [legal])

  const q = query.trim().toLowerCase()
  const items = useMemo(
    () => persons.filter((p) =>
      !q || [p.name, p.alias, p.status, p.bolo_reason, gangName(p.gang_id)].some((s) => (s || '').toLowerCase().includes(q))),
    [persons, q, gangName],
  )

  return (
    <section className="view-in space-y-4">
      <div className="rounded-2xl border border-rose-500/20 bg-ink-900/60 p-6">
        <PageHeader
          title="BOLO Board"
          subtitle="At-large subjects flagged be-on-the-lookout, with risk, instructions and live warrant status."
          actions={
            <>
              {state === 'in' && (
                <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/20 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-medium text-rose-300">
                  <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-rose-400" />live
                </span>
              )}
              {persons.length > 0 && (
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter name, alias, gang, reason..."
                  aria-label="Filter BOLOs"
                  className="w-56 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"
                />
              )}
            </>
          }
        />
      </div>

      {state === 'in' && (
        <MdtExportsPanel persons={persons.map((p) => ({ id: p.id, name: p.name }))} canPropose={canEdit} isCommand={isCommand} />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {state !== 'in' ? (
          <Notice text="Sign in to view the BOLO board." className="sm:col-span-2 xl:col-span-3" />
        ) : err ? (
          <ErrorNotice message={err} onRetry={refresh} className="sm:col-span-2 xl:col-span-3" />
        ) : loading && !persons.length ? (
          <div className="sm:col-span-2 xl:col-span-3">
            <CardGridSkeleton cols="sm:grid-cols-2 xl:grid-cols-3" />
          </div>
        ) : !persons.length ? (
          <EmptyState
            title="No active BOLOs"
            hint="Issue one from a person's profile via ⋯ → Manage BOLO."
            className="sm:col-span-2 xl:col-span-3"
          />
        ) : !items.length ? (
          <Notice text={`No BOLOs match "${query.trim()}".`} className="sm:col-span-2 xl:col-span-3" />
        ) : (
          items.map((p) => (
            <BoloCard
              key={p.id}
              person={p}
              gang={gangName(p.gang_id)}
              legal={legalByPerson.get(p.id) ?? []}
              today={today}
              now={now}
              canEdit={canEdit}
              onProfile={() => setProfile({ type: 'person', id: p.id })}
              onEdit={() => setEditor(p)}
              onManage={() => setManage(p)}
            />
          ))
        )}
      </div>

      {profile && <IntelProfile initial={profile} gangs={gangs} onClose={() => setProfile(null)} />}
      {editor && <PersonModal record={editor} gangs={gangs} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void refresh() }} />}
      {manage && <ManageBoloModal person={manage} onClose={() => setManage(null)} onSaved={() => { setManage(null); void refresh() }} />}
    </section>
  )
}

function BoloCard({ person, gang, legal, today, now, canEdit, onProfile, onEdit, onManage }: {
  person: PersonRow
  gang: string | null
  legal: LegalLite[]
  today: string
  now: number
  canEdit: boolean
  onProfile: () => void
  onEdit: () => void
  onManage: () => void
}) {
  const [imgBroken, setImgBroken] = useState(false)
  const mug = safeUrl(person.mugshot_url ?? '')
  const buckets = legalStatusOf(legal, today)
  const bolo = boloState(person, today)
  const issuedBy = officerName(person.bolo_issued_by)

  return (
    <div className="overflow-hidden rounded-2xl border border-rose-500/20 bg-ink-900/60">
      <div className="flex items-center justify-between gap-2 bg-rose-500/10 px-4 py-2">
        <span className="text-[11px] font-bold uppercase tracking-widest text-rose-300">Be on the lookout</span>
        <span className="flex items-center gap-1.5">
          {bolo.expired && <Badge tone="warn" className="uppercase" title="The BOLO expiry date has passed — review or clear it">Expired</Badge>}
          {person.bolo_risk && (
            <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${priorityTint(person.bolo_risk)}`}>
              {humanize(person.bolo_risk)} risk
            </span>
          )}
        </span>
      </div>
      <div className="flex gap-4 p-4">
        {mug && !imgBroken ? (
          /* eslint-disable-next-line @next/next/no-img-element -- external mugshot CDN */
          <img src={mug} alt={`${person.name} photo`} onError={() => setImgBroken(true)} className="h-20 w-20 flex-shrink-0 rounded-lg object-cover" />
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
            {buckets.arrestWarrants.length > 0 && <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-semibold text-rose-300">Arrest warrant ×{buckets.arrestWarrants.length}</span>}
            {buckets.searchWarrants.length > 0 && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">Search warrant ×{buckets.searchWarrants.length}</span>}
            {buckets.activeCount > 0 && <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-300" title="Legal instruments currently in force">{buckets.activeCount} active legal</span>}
            {!!person.felony_count && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">{person.felony_count} felonies</span>}
          </div>
          {person.bolo_reason && <p className="mt-2 line-clamp-2 text-xs text-slate-300">{person.bolo_reason}</p>}
          {person.bolo_instructions && (
            <p className="mt-1 line-clamp-2 text-[11px] text-amber-200/90" title={person.bolo_instructions}>⚠ {person.bolo_instructions}</p>
          )}
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            {person.bolo_issued_at && <span>Issued {fmtDate(person.bolo_issued_at)}{issuedBy ? ` · ${issuedBy}` : ''}</span>}
            <DeadlineChip at={person.bolo_expires_at} kind="expires" now={now} />
          </p>
        </div>
      </div>
      <div className="flex gap-2 border-t border-white/5 px-4 py-2.5">
        <button onClick={onProfile} className="-my-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] font-semibold text-blue-200 transition hover:bg-white/10">Profile</button>
        {canEdit && <button onClick={onManage} className="-my-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10">Manage BOLO</button>}
        {canEdit && <button onClick={onEdit} className="-my-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10">Edit</button>}
      </div>
    </div>
  )
}
