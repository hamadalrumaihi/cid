'use client'

/** Full-page person profile (`/persons?person=<id>`) — the panelled dossier
 *  view behind each registry card's 🔎 Profile button. LEFT: identity card
 *  (mugshot, key-value sheet) + notes; RIGHT: stacked related-record panels
 *  (warrants, vehicles, properties, linked cases, media). Every rollup query
 *  is RLS-scoped via lib/db list() and degrades to [] on failure (same
 *  contract as IntelProfile.loadProfile), so a linked case in another bureau
 *  surfaces as an access-restricted stub rather than an error. Warrants are
 *  derived from RLS-visible case reports via the dossier helper — there is no
 *  warrants table. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { fmtDate } from '@/lib/format'
import { WARRANT_TINT, reportTitle, warrantStatusOf } from '@/lib/forms'
import { safeUrl } from '@/lib/safeUrl'
import { useWatchlistStore } from '@/lib/watchlist'
import { Badge } from '@/components/ui/Badge'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice, ErrorNotice } from '@/components/ui/Notice'
import { SectionHeader } from '@/components/ui/PageHeader'
import { WatchButton } from '@/components/cases/WatchButton'
import { warrantsNaming } from './dossier'
import { parseProperties, PersonModal, type GangRow, type PersonRow } from './PersonModal'

type CaseRow = Tables<'cases'>
type MediaRow = Tables<'media'>
type ReportRow = Tables<'reports'>
type VehicleRow = Tables<'vehicles'>

const MEDIA_ICON: Record<string, string> = { photo: '🖼️', video: '🎞️', document: '📄', audio: '🎧' }
const uniq = <T,>(arr: T[]): T[] => [...new Set(arr)]

interface ProfileData {
  person: PersonRow
  gangs: GangRow[]
  vehicles: VehicleRow[]
  warrants: ReportRow[]
  media: MediaRow[]
  caseIds: string[]
  /** RLS-visible subset of caseIds; missing ids render as restricted stubs. */
  cases: CaseRow[]
}

/** Same fan-out as IntelProfile.loadProfile (person branch) + the dossier's
 *  vehicles/warrants queries. Auxiliary rollups degrade to []; the primary
 *  person lookup stays unwrapped so a transient fetch failure reports its
 *  real message instead of masquerading as "not found". */
async function loadPersonProfile(id: string): Promise<ProfileData> {
  const opt = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])
  const [persons, gangs, members, media, direct, vehicles, reports] = await Promise.all([
    list('persons', { eq: { id } }),
    opt(list('gangs', { order: 'name' })),
    opt(list('gang_members', { eq: { person_id: id } })),
    opt(list('media', { eq: { person_id: id } })),
    list('case_intel_links', { select: 'case_id', eq: { kind: 'person', ref_id: id } })
      .then((r) => r as unknown as { case_id: string }[]).catch(() => []),
    opt(list('vehicles', { eq: { owner_id: id } })),
    opt(list('reports', {})),
  ])
  const person = persons[0]
  if (!person) throw new Error('Person not found')
  const caseIds = uniq(
    [...members.map((m) => m.case_id), ...media.map((m) => m.case_id), ...direct.map((d) => d.case_id)]
      .filter((x): x is string => !!x),
  )
  const cases = caseIds.length ? await opt(list('cases', { in: { id: caseIds } })) : []
  return { person, gangs, vehicles, warrants: warrantsNaming(reports, person.name || ''), media, caseIds, cases }
}

/** Labeled key-value row in the identity sheet; rows are separated by the
 *  parent's divide-y hairlines. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium text-slate-200">{children}</dd>
    </div>
  )
}

/** Titled related-record panel; renders the centred uppercase empty text
 *  (reference layout's "NO VEHICLES") when there is nothing to list. */
function Panel({ title, count, empty, children }: { title: string; count: number; empty: string; children?: React.ReactNode }) {
  return (
    <Card pad="md">
      <SectionHeader
        title={title}
        actions={<span className="text-[11px] font-semibold text-slate-400">{count}</span>}
        className="mb-3"
      />
      {count ? (
        <div className="space-y-1.5">{children}</div>
      ) : (
        <p className="py-6 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{empty}</p>
      )}
    </Card>
  )
}

export function PersonProfile({ id, onBack }: { id: string; onBack: () => void }) {
  const router = useRouter()
  const { canEdit } = useAuth()
  const [data, setData] = useState<ProfileData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [imgBroken, setImgBroken] = useState(false)
  const fetchWatch = useWatchlistStore((s) => s.fetch)

  // `?person=` can switch in place (search palette); only the newest load may
  // land (same seq guard as IntelProfile / SearchPalette).
  const seqRef = useRef(0)
  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setData(null)
    setErr(null)
    setImgBroken(false)
    try {
      const d = await loadPersonProfile(id)
      if (seq === seqRef.current) setData(d)
    } catch (e) {
      if (seq === seqRef.current) setErr(e instanceof Error ? e.message : String(e))
    }
  }, [id])

  useEffect(() => {
    const t = window.setTimeout(() => { void fetchWatch(); void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load, fetchWatch])

  const p = data?.person
  const gang = p?.gang_id ? data?.gangs.find((g) => g.id === p.gang_id) || null : null
  const props = p ? parseProperties(p.properties) : []
  const mug = p ? safeUrl(p.mugshot_url ?? '') : ''
  const flag = (p?.felony_count || 0) >= 8

  const caseChip = (cid: string) => {
    const c = data?.cases.find((x) => x.id === cid)
    return c ? (
      <button
        key={cid}
        onClick={() => router.push(`/cases?case=${encodeURIComponent(c.id)}`)}
        className="block w-full rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/5"
      >
        <span className="font-mono text-blue-300">{c.case_number}</span> · {c.title || ''} <span className="text-slate-500">· {c.status || ''}</span>
      </button>
    ) : (
      <div key={cid} className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5 text-sm text-slate-500">
        Linked case — access restricted (other bureau).
      </div>
    )
  }

  return (
    <section className="view-in space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs items={[{ label: 'Persons', onClick: onBack }, { label: p?.name || 'Profile' }]} />
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <WatchButton type="person" id={id} label={p?.name} />
          {canEdit && p && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
        </div>
      </div>

      {err ? (
        <ErrorNotice message={err} onRetry={() => void load()} />
      ) : !data || !p ? (
        <Notice text="Building profile…" />
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* LEFT — identity + notes */}
          <div className="space-y-4 lg:w-80 lg:flex-shrink-0">
            <Card pad="lg">
              <div className="flex flex-col items-center text-center">
                {mug && !imgBroken ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- external mugshot CDN */
                  <img src={mug} alt="" onError={() => setImgBroken(true)} className="h-24 w-24 rounded-full border border-white/10 object-cover" />
                ) : (
                  <div className="grid h-24 w-24 place-items-center rounded-full bg-ink-700 text-4xl" aria-hidden="true">👤</div>
                )}
                <h1 className="mt-3 text-xl font-black text-white">
                  {p.name}
                  {flag && <span title="≥8 violent felonies"> 🚨</span>}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                  {p.bolo && <Badge tone="danger" className="uppercase">BOLO</Badge>}
                  <span className="text-sm text-slate-400">{p.status || 'Person of interest'}</span>
                  {p.alias && <Badge tone="neutral">&ldquo;{p.alias}&rdquo;</Badge>}
                </div>
              </div>
              <dl className="mt-5 divide-y divide-white/5 border-t border-white/5">
                <Row label="Gang">
                  {gang?.name ? (
                    <button
                      onClick={() => router.push(`/gangs?q=${encodeURIComponent(gang.name)}`)}
                      className="text-blue-300 transition hover:text-blue-200"
                    >
                      {gang.name}
                    </button>
                  ) : '—'}
                </Row>
                <Row label="CCW">{p.ccw ? 'Yes' : 'No'}</Row>
                <Row label="VCH">{String(p.vch || 0)}</Row>
                <Row label="Felonies">{String(p.felony_count || 0)}</Row>
                <Row label="Active BOLO">
                  <Badge tone={p.bolo ? 'danger' : 'neutral'}>{p.bolo ? 'Active' : 'No'}</Badge>
                </Row>
                {p.dob && <Row label="DOB">{p.dob}</Row>}
                <Row label="Added">{fmtDate(p.created_at)}</Row>
                <Row label="Updated">{fmtDate(p.updated_at)}</Row>
              </dl>
            </Card>

            <Card pad="md">
              <SectionHeader title="Notes" className="mb-3" />
              {p.notes ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{p.notes}</p>
              ) : (
                <p className="py-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">No notes</p>
              )}
            </Card>
          </div>

          {/* RIGHT — related-record panels */}
          <div className="min-w-0 flex-1 space-y-4">
            <Panel title="Warrants" count={data.warrants.length} empty="No warrants">
              {data.warrants.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate text-slate-200">{reportTitle(r)}</span>
                  <span className="flex flex-shrink-0 items-center gap-2">
                    <Badge tint={WARRANT_TINT[warrantStatusOf(r)]} className="uppercase">{warrantStatusOf(r)}</Badge>
                    <span className="text-[11px] text-slate-400">{fmtDate(r.created_at)}</span>
                  </span>
                </div>
              ))}
            </Panel>

            <Panel title="Vehicles" count={data.vehicles.length} empty="No vehicles">
              {data.vehicles.map((v) => (
                <button
                  key={v.id}
                  onClick={() => router.push(`/vehicles?vehicle=${encodeURIComponent(v.id)}`)}
                  className="flex w-full items-center gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-white/5"
                >
                  <span className="flex-shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-[11px] font-bold text-badge-200">{v.plate}</span>
                  <span className="min-w-0 truncate">{[v.model, v.color].filter(Boolean).join(' · ') || 'Vehicle'}</span>
                </button>
              ))}
            </Panel>

            <Panel title="Properties" count={props.length} empty="No properties">
              {props.map((pr, i) => (
                <div key={i} className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5 text-sm text-slate-200">
                  🏠 {pr.address || '—'}{pr.type ? <span className="text-slate-500"> · {pr.type}</span> : null}
                  {pr.notes && <><br /><span className="text-[11px] text-slate-400">{pr.notes}</span></>}
                </div>
              ))}
            </Panel>

            <Panel title="Linked cases" count={data.caseIds.length} empty="No linked cases">
              {data.caseIds.map(caseChip)}
            </Panel>

            <Panel title="Media" count={data.media.length} empty="No media">
              {data.media.map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2.5 text-sm">
                  <span className="min-w-0 truncate text-slate-200">{MEDIA_ICON[m.type] || '📎'} {m.title || m.kind || 'Media'}</span>
                  {m.external_url && safeUrl(m.external_url) && (
                    <a href={safeUrl(m.external_url)} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-[11px] text-blue-300 transition hover:text-blue-200">open ↗</a>
                  )}
                </div>
              ))}
            </Panel>
          </div>
        </div>
      )}

      {editing && p && (
        <PersonModal
          record={p}
          gangs={data?.gangs ?? []}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load() }}
        />
      )}
    </section>
  )
}
