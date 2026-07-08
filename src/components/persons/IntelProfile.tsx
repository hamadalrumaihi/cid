'use client'

/** Unified intel profile slide-over (Wave 2, vanilla intel.js) — rolls up
 *  everything linked to a person or gang: cases, memberships, properties,
 *  turf, ballistic footprints, media, evidence. All queries are RLS-scoped, so
 *  a linked case in another bureau surfaces as "access restricted" rather than
 *  404. Cross-links switch the profile in place; case chips deep-link out.
 *  The Network button waits on the `network` view slice. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { downloadDocx } from '@/lib/docx'
import { slug } from '@/lib/format'
import { useWatchlistStore } from '@/lib/watchlist'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { WatchButton } from '@/components/cases/WatchButton'
import { dossierParas, gatherPersonDossier } from './dossier'
import type { GangRow, PersonRow } from './PersonModal'
import { parseProperties } from './PersonModal'

type CaseRow = Tables<'cases'>
type GangMemberRow = Tables<'gang_members'>
type MediaRow = Tables<'media'>
type EvidenceRow = Tables<'evidence'>

const MEDIA_ICON: Record<string, string> = { photo: '🖼️', video: '🎞️', document: '📄', audio: '🎧' }
const uniq = <T,>(arr: T[]): T[] => [...new Set(arr)]

interface ProfileData {
  person?: PersonRow
  gang?: GangRow
  members: GangMemberRow[]
  turf: Tables<'gang_turf'>[]
  places: Tables<'places'>[]
  footprints: Tables<'ballistic_footprints'>[]
  media: MediaRow[]
  evidence: EvidenceRow[]
  caseIds: string[]
  /** RLS-visible subset of caseIds; missing ids render as restricted stubs. */
  cases: CaseRow[]
}

async function loadProfile(type: 'person' | 'gang', id: string, gangs: GangRow[]): Promise<ProfileData> {
  // Auxiliary rollup queries degrade to [] (vanilla intel.js:73); the PRIMARY
  // record lookup stays unwrapped so a transient fetch failure reports its
  // real message instead of masquerading as "not found".
  const opt = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[])
  if (type === 'person') {
    const [persons, members, media, direct] = await Promise.all([
      list('persons', { eq: { id } }),
      opt(list('gang_members', { eq: { person_id: id } })),
      opt(list('media', { eq: { person_id: id } })),
      list('case_intel_links', { select: 'case_id', eq: { kind: 'person', ref_id: id } })
        .then((r) => r as unknown as { case_id: string }[]).catch(() => []),
    ])
    const person = persons[0]
    if (!person) throw new Error('Person not found')
    const caseIds = uniq([...members.map((m) => m.case_id), ...media.map((m) => m.case_id), ...direct.map((d) => d.case_id)].filter((x): x is string => !!x))
    const [evidence, cases] = await Promise.all([
      caseIds.length ? opt(list('evidence', { in: { case_id: caseIds } })) : Promise.resolve([]),
      caseIds.length ? opt(list('cases', { in: { id: caseIds } })) : Promise.resolve([]),
    ])
    return { person, members, media, evidence, caseIds, cases, turf: [], places: [], footprints: [] }
  }
  const [gangRows, members, turf, places, footprints, media, direct] = await Promise.all([
    gangs.some((g) => g.id === id) ? Promise.resolve([gangs.find((g) => g.id === id) as GangRow]) : list('gangs', { eq: { id } }),
    opt(list('gang_members', { eq: { gang_id: id } })),
    opt(list('gang_turf', { eq: { gang_id: id } })),
    opt(list('places', { eq: { controlling_gang_id: id } })),
    opt(list('ballistic_footprints', { eq: { gang_id: id } })),
    opt(list('media', { eq: { gang_id: id } })),
    list('case_intel_links', { select: 'case_id', eq: { kind: 'gang', ref_id: id } })
      .then((r) => r as unknown as { case_id: string }[]).catch(() => []),
  ])
  const gang = gangRows[0]
  if (!gang) throw new Error('Gang not found')
  const caseIds = uniq(
    [...members.map((m) => m.case_id), ...places.map((p) => p.case_id), ...footprints.map((f) => f.case_id), ...media.map((m) => m.case_id), ...direct.map((d) => d.case_id)]
      .filter((x): x is string => !!x),
  )
  const [evidence, cases] = await Promise.all([
    caseIds.length ? opt(list('evidence', { in: { case_id: caseIds } })) : Promise.resolve([]),
    caseIds.length ? opt(list('cases', { in: { id: caseIds } })) : Promise.resolve([]),
  ])
  return { gang, members, turf, places, footprints, media, evidence, caseIds, cases }
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-ink-900 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-white">{children}</p>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">{title}</p>
        <span className="text-[11px] text-slate-500">{count}</span>
      </div>
      {count ? <div className="space-y-1.5">{children}</div> : <p className="text-xs text-slate-500">None on file.</p>}
    </div>
  )
}

export interface IntelTarget { type: 'person' | 'gang'; id: string }

export function IntelProfile({ initial, gangs, onClose }: { initial: IntelTarget; gangs: GangRow[]; onClose: () => void }) {
  const router = useRouter()
  const [target, setTarget] = useState<IntelTarget>(initial)
  const [data, setData] = useState<ProfileData | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [dossierOpen, setDossierOpen] = useState(false)
  const fetchWatch = useWatchlistStore((s) => s.fetch)

  // The parent refetches gangs on every realtime bump, giving the prop a fresh
  // identity each time. Route it through a ref (Modal.tsx's own pattern) so an
  // unrelated persons/gangs change doesn't blank the open profile to
  // "Building rollup…" and refire the whole query fan-out.
  const gangsRef = useRef(gangs)
  useEffect(() => { gangsRef.current = gangs })

  const load = useCallback(async () => {
    setData(null)
    setErr(null)
    try { setData(await loadProfile(target.type, target.id, gangsRef.current)) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }, [target])

  useEffect(() => {
    const t = window.setTimeout(() => { void fetchWatch(); void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load, fetchWatch])

  const openCase = (id: string) => { onClose(); router.push(`/cases?case=${encodeURIComponent(id)}`) }
  const gangName = (id: string | null) => (id && gangs.find((g) => g.id === id)?.name) || null

  const caseChip = (cid: string) => {
    const c = data?.cases.find((x) => x.id === cid)
    return c ? (
      <button key={cid} onClick={() => openCase(c.id)} className="block w-full rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-left text-sm text-slate-200 hover:bg-white/5">
        <span className="font-mono text-blue-300">{c.case_number}</span> · {c.title || ''} <span className="text-slate-500">· {c.status || ''}</span>
      </button>
    ) : (
      <div key={cid} className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-500">Linked case — access restricted (other bureau).</div>
    )
  }
  const caseTag = (cid: string | null) => {
    const c = cid ? data?.cases.find((x) => x.id === cid) : null
    return c ? (
      <button onClick={() => openCase(c.id)} className="flex-shrink-0 font-mono text-[11px] text-blue-300 hover:text-blue-200">{c.case_number}</button>
    ) : null
  }

  const exportDocx = async () => {
    if (!data?.person) return
    const d = await gatherPersonDossier(data.person, gangName(data.person.gang_id))
    downloadDocx(`Person Dossier — ${d.person.name || ''}`, dossierParas(d), `dossier-${slug(d.person.name || 'person')}.docx`)
    toast('Dossier exported (.docx)', 'success')
    setDossierOpen(false)
  }

  const p = data?.person
  const g = data?.gang
  const props = p ? parseProperties(p.properties) : []

  return (
    <Modal open slide onClose={onClose}>
      <div className="flex h-full flex-col">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/10 bg-ink-850 px-6 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Intel profile</p>
            <h3 className="truncate text-xl font-bold text-white">
              {p ? `👤 ${p.name || 'Person'}` : g ? `🚩 ${g.name || 'Gang'}` : 'Loading…'}
            </h3>
            <p className="text-xs text-slate-400">
              {p ? [p.alias ? `"${p.alias}"` : '', p.status || ''].filter(Boolean).join(' · ')
                : g ? [g.colors ? `Colors: ${g.colors}` : '', `${g.threat_level || ''} threat`].filter(Boolean).join(' · ')
                : ''}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {target.type === 'person' && <WatchButton type="person" id={target.id} label={p?.name} />}
            {target.type === 'person' && (
              <button onClick={() => setDossierOpen(true)} title="Export the full dossier as .docx" className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-200 transition hover:bg-white/10">
                📇 Dossier
              </button>
            )}
            <button aria-label="Close" onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-white">&times;</button>
          </div>
        </div>

        <div className="flex-1 space-y-6 px-6 py-5">
          {err && <p className="text-sm text-rose-300">Could not build profile: {err}</p>}
          {!err && !data && <p className="text-sm text-slate-500">Building rollup…</p>}

          {p && data && (
            <>
              <div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Fact label="Gang">
                    {p.gang_id && gangName(p.gang_id)
                      ? <button onClick={() => setTarget({ type: 'gang', id: p.gang_id as string })} className="text-blue-300 hover:text-blue-200">{gangName(p.gang_id)}</button>
                      : '—'}
                  </Fact>
                  <Fact label="CCW">{p.ccw ? 'Yes' : 'No'}</Fact>
                  <Fact label="VCH">{String(p.vch || 0)}</Fact>
                  <Fact label="Felonies">{String(p.felony_count || 0)}</Fact>
                </div>
                {p.notes && <p className="mt-3 rounded-lg bg-ink-900 px-3 py-2 text-sm text-slate-300">{p.notes}</p>}
              </div>
              <Section title="Linked cases" count={data.caseIds.length}>{data.caseIds.map(caseChip)}</Section>
              <Section title="Known properties" count={props.length}>
                {props.map((pr, i) => (
                  <div key={i} className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-200">
                    🏠 {pr.address || '—'}{pr.type ? <span className="text-slate-500"> · {pr.type}</span> : null}
                    {pr.notes && <><br /><span className="text-[11px] text-slate-400">{pr.notes}</span></>}
                  </div>
                ))}
              </Section>
              <Section title="Gang memberships" count={data.members.length}>
                {data.members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-slate-200">
                      🚩 {m.gang_id
                        ? <button onClick={() => setTarget({ type: 'gang', id: m.gang_id })} className="text-blue-300 hover:text-blue-200">{gangName(m.gang_id) || 'Gang'}</button>
                        : 'Gang'}{' '}
                      <span className="text-slate-500">· {m.rank || m.status || 'member'}</span>
                    </span>
                    {caseTag(m.case_id)}
                  </div>
                ))}
              </Section>
              <MediaSection media={data.media} caseTag={caseTag} />
              <EvidenceSection evidence={data.evidence} caseTag={caseTag} />
            </>
          )}

          {g && data && (
            <>
              <div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Fact label="Members">{String(data.members.length)}</Fact>
                  <Fact label="Turf blocks">{String(data.turf.length)}</Fact>
                  <Fact label="Properties">{String(data.places.length)}</Fact>
                  <Fact label="Linked cases">{String(data.caseIds.length)}</Fact>
                </div>
                {g.notes && <p className="mt-3 rounded-lg bg-ink-900 px-3 py-2 text-sm text-slate-300">{g.notes}</p>}
              </div>
              <Section title="Linked cases" count={data.caseIds.length}>{data.caseIds.map(caseChip)}</Section>
              <Section title="Roster" count={data.members.length}>
                {data.members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-slate-200">{m.name} <span className="text-slate-500">· {m.rank || m.status || 'member'}</span></span>
                    <span className="flex flex-shrink-0 items-center gap-2">
                      {caseTag(m.case_id)}
                      {m.person_id && (
                        <button onClick={() => setTarget({ type: 'person', id: m.person_id as string })} className="text-[11px] text-blue-300 hover:text-blue-200">profile →</button>
                      )}
                    </span>
                  </div>
                ))}
              </Section>
              <Section title="Turf" count={data.turf.length}>
                {data.turf.map((t) => (
                  <div key={t.id} className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-200">
                    {t.block || '—'}{t.hotspot_area ? <span className="text-slate-500"> · {t.hotspot_area}</span> : null}{t.density ? <span className="text-slate-500"> · {t.density}</span> : null}
                  </div>
                ))}
              </Section>
              <Section title="Properties" count={data.places.length}>
                {data.places.map((pl) => (
                  <div key={pl.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-slate-200">📍 {pl.name} <span className="text-slate-500">· {pl.type || ''}</span></span>
                    {caseTag(pl.case_id)}
                  </div>
                ))}
              </Section>
              <Section title="Ballistic footprints" count={data.footprints.length}>
                {data.footprints.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate text-slate-200">🧬 {f.signature || '—'}{f.weapon ? <span className="text-slate-500"> · {f.weapon}</span> : null}</span>
                    {caseTag(f.case_id)}
                  </div>
                ))}
              </Section>
              <MediaSection media={data.media} caseTag={caseTag} />
              <EvidenceSection evidence={data.evidence} caseTag={caseTag} />
            </>
          )}
        </div>
      </div>

      {dossierOpen && p && (
        <Modal open onClose={() => setDossierOpen(false)}>
          <div className="p-6">
            <ModalHeader title="Export Person Dossier" onClose={() => setDossierOpen(false)} />
            <p className="mb-4 text-sm text-slate-400">
              Compiles the full profile — bio, gang ties, properties, vehicles, linked cases, warrants, evidence &amp; media (only what you can access).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => void exportDocx()} className="rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-sm font-semibold text-white transition hover:bg-white/10">📄<br />.docx</button>
              <button disabled title="Lazy jsPDF lands with the Exports slice" className="cursor-not-allowed rounded-lg border border-white/5 bg-white/[0.02] px-3 py-4 text-sm font-semibold text-slate-600">📕<br />.pdf — Exports slice</button>
            </div>
          </div>
        </Modal>
      )}
    </Modal>
  )
}

function MediaSection({ media, caseTag }: { media: MediaRow[]; caseTag: (id: string | null) => React.ReactNode }) {
  return (
    <Section title="Media" count={media.length}>
      {media.map((m) => (
        <div key={m.id} className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-slate-200">{MEDIA_ICON[m.type] || '📎'} {m.title || m.kind || 'Media'}</span>
            {m.external_url && safeUrl(m.external_url) && (
              <a href={safeUrl(m.external_url)} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 text-[11px] text-blue-300 hover:text-blue-200">open ↗</a>
            )}
          </div>
          {caseTag(m.case_id) && <div className="mt-1">{caseTag(m.case_id)}</div>}
        </div>
      ))}
    </Section>
  )
}

function EvidenceSection({ evidence, caseTag }: { evidence: EvidenceRow[]; caseTag: (id: string | null) => React.ReactNode }) {
  return (
    <Section title="Evidence (in linked cases)" count={evidence.length}>
      {evidence.map((e) => (
        <div key={e.id} className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-slate-200">
              {e.item_code || e.type || 'Item'}{e.description ? <span className="text-slate-500"> {e.description}</span> : null}
            </span>
            {caseTag(e.case_id)}
          </div>
        </div>
      ))}
    </Section>
  )
}
