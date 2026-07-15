'use client'

/** Gang intelligence dossier — the redesigned detail screen. A structured
 *  header + identity block, sticky deep-linkable section nav, an overview that
 *  answers the investigator's questions at a glance (who leads, who's a member,
 *  where they operate, what's connected, how reliable/recent the intel is,
 *  what changed), and dedicated sections for roster, territory, places,
 *  vehicles, cases, media, and activity. Legacy `notes` is preserved verbatim
 *  and never rewritten. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { list, remove } from '@/lib/db'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { copyText } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { parseIntelSummary } from '@/lib/jsonShapes'
import { statusTint, threatTint } from '@/lib/tint'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { ErrorNotice, EmptyState } from '@/components/ui/Notice'
import { ActionMenu } from '@/components/ui/ActionMenu'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { SectionTabs, panelDomId, tabDomId, type SectionTab } from '@/components/ui/SectionTabs'
import { WorkflowTimeline, type TimelineEntry } from '@/components/ui/WorkflowTimeline'
import { ConfidenceBadge, ProvenanceBadge, StaleIntelBadge } from '@/components/ui/IntelBadges'
import { EntityLink } from '@/components/ui/EntityLink'
import { uiConfirm } from '@/components/ui/dialog'
import { useNow } from '@/lib/useNow'
import { RosterSection } from './gangRoster'
import { MemberModal, TurfModal, LinkPlaceModal, AddGangPhotoModal, GangPhotoLightbox, AttachGangModal } from './gangModals'
import {
  DEFAULT_REVIEW_DAYS, SUMMARY_SECTIONS, humanize, isGangStale, parseColors, rankTier, turfLastKnown,
} from './gangIntel'
import { densityTint, cap, type CaseOption, type CaseRow, type GangPlaceRow, type GangRow, type IntelLinkRow, type LinkedPlace, type MediaRow, type MemberRow, type PersonRow, type PlaceRow, type TurfRow, type VehicleRow } from './gangShared'

type SectionId = 'overview' | 'members' | 'territory' | 'places' | 'vehicles' | 'cases' | 'media' | 'activity'
const SECTION_IDS: SectionId[] = ['overview', 'members', 'territory', 'places', 'vehicles', 'cases', 'media', 'activity']

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const t = Date.parse(iso)
  return Number.isNaN(t) ? '—' : new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// ── Small building blocks (module scope for the static-components lint) ───────
function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-right text-sm text-slate-200">{children}</span>
    </div>
  )
}

function ColorSwatches({ colors }: { colors: string | null }) {
  const sw = parseColors(colors)
  if (!sw.length) return <span className="text-slate-500">—</span>
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      {sw.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-white/5 py-0.5 pl-1 pr-2 text-xs text-slate-200">
          {s.css ? <span className="h-3 w-3 rounded-full border border-white/20" style={{ backgroundColor: s.css }} aria-hidden /> : <span className="h-3 w-3 rounded-full border border-white/10 bg-transparent" aria-hidden />}
          {s.name}
        </span>
      ))}
    </span>
  )
}

// ── Intelligence summary (structured + legacy notes) ─────────────────────────
function IntelligenceSummary({ gang, canEdit, onEdit }: { gang: GangRow; canEdit: boolean; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const summary = useMemo(() => parseIntelSummary(gang.intelligence_summary), [gang.intelligence_summary])
  const sections = SUMMARY_SECTIONS.filter((s) => summary[s.key])
  const hasStructured = sections.length > 0
  const notes = (gang.notes ?? '').trim()
  const shownSections = expanded ? sections : sections.slice(0, 3)

  const copyAll = () => {
    const parts = sections.map((s) => `${s.label}\n${summary[s.key]}`)
    if (notes) parts.push(`Original imported notes\n${notes}`)
    copyText(parts.join('\n\n'), 'Intelligence summary copied')
  }

  return (
    <Card pad="lg" className="max-w-prose-none">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">Intelligence summary</h3>
        <div className="flex items-center gap-1.5">
          {(hasStructured || notes) && <button onClick={copyAll} title="Copy summary" className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10">Copy</button>}
          {canEdit && <button onClick={onEdit} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-blue-200 hover:bg-white/10">Edit</button>}
        </div>
      </div>

      {hasStructured ? (
        <div className="space-y-3">
          {shownSections.map((s) => (
            <div key={s.key}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-300/70">{s.label}</p>
              <p className="mt-0.5 max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{summary[s.key]}</p>
            </div>
          ))}
          {sections.length > 3 && (
            <button onClick={() => setExpanded((v) => !v)} className="text-xs font-semibold text-blue-300 hover:text-blue-200">
              {expanded ? 'Show less' : `Show ${sections.length - 3} more section${sections.length - 3 === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      ) : notes ? (
        <p className="max-w-[68ch] whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{notes}</p>
      ) : (
        <p className="text-sm text-slate-500">No intelligence summary recorded yet.{canEdit ? ' Use Edit to add structured sections.' : ''}</p>
      )}

      {/* Original imported notes are always preserved and available, even once
          structured sections exist — never rewritten or discarded. */}
      {hasStructured && notes && (
        <div className="mt-3 border-t border-white/5 pt-2">
          <button onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw} className="text-[11px] font-semibold text-slate-400 hover:text-slate-200">
            {showRaw ? '▾' : '▸'} Original imported notes
          </button>
          {showRaw && <p className="mt-1.5 max-w-[68ch] whitespace-pre-wrap text-xs leading-relaxed text-slate-400">{notes}</p>}
        </div>
      )}
    </Card>
  )
}

function InvestigationStatus({ gang, now }: { gang: GangRow; now: number }) {
  const summary = parseIntelSummary(gang.intelligence_summary)
  const lead = officerName(gang.lead_detective_id)
  const reviewer = officerName(gang.reviewed_by)
  return (
    <Card pad="lg">
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-300">Investigation status</h3>
      <div className="divide-y divide-white/5">
        <KV label="Lead detective">{lead ?? '—'}</KV>
        <KV label="Lifecycle">{gang.status ? <Badge tint={statusTint(gang.status)}>{humanize(gang.status)}</Badge> : '—'}</KV>
        <KV label="Threat"><Badge tint={threatTint(gang.threat_level)}>{cap(gang.threat_level)}</Badge></KV>
        <KV label="Confidence">{gang.confidence ? <ConfidenceBadge confidence={gang.confidence} /> : '—'}</KV>
        <KV label="Last reviewed">{gang.reviewed_at ? `${fmtDate(gang.reviewed_at)}${reviewer ? ` · ${reviewer}` : ''}` : <StaleIntelBadge reviewedAt={gang.reviewed_at} now={now} />}</KV>
        <KV label="Next review">{fmtDate(gang.next_review_at)}</KV>
      </div>
      {summary.gaps && (
        <div className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-300/80">Outstanding intelligence gaps</p>
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-300">{summary.gaps}</p>
        </div>
      )}
    </Card>
  )
}

// ── Territory ────────────────────────────────────────────────────────────────
function TerritorySection({ gangId, turf, canEdit, canDelete, onAdd, onDelete, now }: {
  gangId: string; turf: TurfRow[]; canEdit: boolean; canDelete: boolean; onAdd: () => void; onDelete: (t: TurfRow) => void; now: number
}) {
  const router = useRouter()
  const [density, setDensity] = useState('any')
  const [status, setStatus] = useState('any')
  const rows = turf.filter((t) => (density === 'any' || t.density === density) && (status === 'any' || (t.status ?? 'unknown') === status))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Territory</h3><Badge>{turf.length}</Badge></div>
        <div className="flex items-center gap-2">
          <button onClick={() => router.push(`/heatmap?gang=${encodeURIComponent(gangId)}`)} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-blue-200 hover:bg-white/10">View on map</button>
          {canEdit && <button onClick={onAdd} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">+ Turf</button>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Density" value={density} onChange={(e) => setDensity(e.target.value)} className="rounded-lg border border-white/10 bg-ink-850 px-2.5 py-1.5 text-xs text-slate-200">
          <option value="any">Any density</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </select>
        <select aria-label="Control status" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-white/10 bg-ink-850 px-2.5 py-1.5 text-xs text-slate-200">
          <option value="any">Any control</option><option value="claimed">Claimed</option><option value="confirmed">Confirmed</option><option value="contested">Contested</option><option value="historical">Historical</option><option value="unknown">Unknown</option>
        </select>
      </div>
      {!turf.length ? (
        <EmptyState title="No territory logged" hint={canEdit ? 'Add a block with “+ Turf”.' : undefined} />
      ) : !rows.length ? (
        <p className="rounded-xl border border-white/5 bg-ink-900/60 p-4 text-sm text-slate-400">No turf matches these filters.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((t) => {
            const last = turfLastKnown(t)
            const stale = last ? (now - Date.parse(last)) / 86_400_000 > 180 : false
            return (
              <Card key={t.id} pad="sm" className="flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 truncate font-semibold text-white">{t.block}</p>
                  <span className={`flex-shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${densityTint(t.density)}`}>{cap(t.density)}</span>
                </div>
                {t.hotspot_area && <p className="text-xs text-slate-400">{t.hotspot_area}</p>}
                <div className="flex flex-wrap items-center gap-1.5">
                  {t.status && <Badge tint={statusTint(t.status)}>{humanize(t.status)}</Badge>}
                  {t.confidence && <ConfidenceBadge confidence={t.confidence} />}
                  {stale && <span className="t-readout rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300" title="No confirmation in over 180 days"><span className="t-dot t-dot-amber" /> STALE</span>}
                </div>
                {(t.first_observed || t.last_confirmed) && (
                  <p className="text-[11px] text-slate-500">{t.first_observed ? `First seen ${fmtDate(t.first_observed)}` : ''}{t.first_observed && t.last_confirmed ? ' · ' : ''}{t.last_confirmed ? `Confirmed ${fmtDate(t.last_confirmed)}` : ''}</p>
                )}
                {t.notes && <p className="line-clamp-2 text-xs text-slate-400">{t.notes}</p>}
                {canDelete && <div className="mt-1"><button onClick={() => onDelete(t)} className="text-[11px] text-rose-300 hover:text-rose-200">Remove</button></div>}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Places ───────────────────────────────────────────────────────────────────
const PLACE_ICON: Record<string, string> = { drug_lab: '⚗️', stash_house: '📦', dead_drop: '📮', front_business: '🏪', chop_shop: '🔧' }

function PlacesSection({ linked, media, canEdit, canDelete, onLink, onUnlink }: {
  linked: LinkedPlace[]; media: MediaRow[]; canEdit: boolean; canDelete: boolean; onLink: () => void; onUnlink: (l: GangPlaceRow) => void
}) {
  const router = useRouter()
  const photoFor = (placeId: string) => media.find((m) => m.place_id === placeId)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Controlled properties</h3><Badge>{linked.length}</Badge></div>
        {canEdit && <button onClick={onLink} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">Link place</button>}
      </div>
      {!linked.length ? (
        <EmptyState title="No linked properties" hint={canEdit ? 'Use “Link place” to attach an existing place with a role.' : 'Set a controlling gang on a Place, or link one here.'} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {linked.map(({ place, link, via }) => {
            const photo = photoFor(place.id)
            const src = photo ? safeUrl(photo.external_url || photo.storage_path || '') : ''
            return (
              <Card key={`${place.id}-${via}`} pad="sm" className="flex gap-3">
                {src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external media CDN
                  <img src={src} alt="" className="h-16 w-20 flex-shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="grid h-16 w-20 flex-shrink-0 place-items-center rounded-md bg-ink-700 text-xl" aria-hidden>{PLACE_ICON[place.type] ?? '📍'}</div>
                )}
                <div className="min-w-0 flex-1">
                  <button onClick={() => router.push(`/places?q=${encodeURIComponent(place.name)}`)} className="truncate text-left text-sm font-semibold text-white hover:text-blue-200" title="Open place">{place.name}</button>
                  <p className="text-[11px] text-slate-400">{humanize(place.type)}{place.area ? ` · ${place.area}` : ''}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {link?.role && <Badge tone="accent">{link.role}</Badge>}
                    {link?.confidence && <ConfidenceBadge confidence={link.confidence} />}
                    {link?.provenance && <ProvenanceBadge provenance={link.provenance} />}
                    {via === 'controlling' && <span className="text-[10px] uppercase tracking-wide text-slate-500" title="Linked via the place's controlling gang">controlling</span>}
                  </div>
                  {canDelete && link && <button onClick={() => onUnlink(link)} className="mt-1 text-[11px] text-rose-300 hover:text-rose-200">Unlink</button>}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Vehicles ─────────────────────────────────────────────────────────────────
function VehiclesSection({ vehicles }: { vehicles: VehicleRow[] }) {
  const router = useRouter()
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Vehicles</h3><Badge>{vehicles.length}</Badge></div>
      {!vehicles.length ? (
        <EmptyState title="No linked vehicles" hint="Vehicles set to this gang appear here. A text mention alone is not a confirmed link." />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {vehicles.map((v) => (
            <Card key={v.id} pad="sm" className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <button onClick={() => router.push(`/vehicles?vehicle=${encodeURIComponent(v.id)}`)} className="truncate text-left text-sm font-semibold text-white hover:text-blue-200">{v.plate || 'Unknown plate'}</button>
                <p className="text-[11px] text-slate-400">{[v.color, v.model].filter(Boolean).join(' ') || '—'}</p>
              </div>
              <Badge tone="accent" title="Related through a direct gang link">Gang-linked</Badge>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Cases ────────────────────────────────────────────────────────────────────
function CasesSection({ links, cases, indirect, canEdit, onAttach, onUnlink }: {
  links: IntelLinkRow[]; cases: Map<string, CaseRow>; indirect: Array<{ id: string; label: string; via: string }>; canEdit: boolean; onAttach: () => void; onUnlink: (l: IntelLinkRow) => void
}) {
  const router = useRouter()
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Linked cases</h3><Badge>{links.length}</Badge></div>
        {canEdit && <button onClick={onAttach} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-blue-200 hover:bg-white/10">Attach to case</button>}
      </div>
      {!links.length ? (
        <EmptyState title="No durable case links" hint={canEdit ? 'Attach this gang to a case — it creates a structured intel link, not just a chat note.' : undefined} />
      ) : (
        <div className="space-y-2">
          {links.map((l) => {
            const c = cases.get(l.ref_id)
            return (
              <Card key={l.id} pad="sm" className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <button onClick={() => router.push(`/cases?case=${encodeURIComponent(l.ref_id)}`)} className="text-left text-sm font-semibold text-white hover:text-blue-200">
                    {c?.case_number ?? 'Case'} {c?.title ? <span className="font-normal text-slate-400">· {c.title}</span> : null}
                  </button>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                    {c?.status && <Badge tint={statusTint(c.status)}>{humanize(c.status)}</Badge>}
                    {c?.bureau && <span>{c.bureau}</span>}
                    {l.role && <span>· Role: {l.role}</span>}
                    {!c && <span className="text-slate-500">(no access or removed)</span>}
                  </p>
                  {l.note && <p className="mt-0.5 text-xs text-slate-400">{l.note}</p>}
                </div>
                {canEdit && <button onClick={() => onUnlink(l)} className="text-[11px] text-rose-300 hover:text-rose-200">Unlink</button>}
              </Card>
            )
          })}
        </div>
      )}
      {indirect.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Indirect references ({indirect.length})</p>
          <div className="flex flex-wrap gap-1.5">
            {indirect.map((i) => <EntityLink key={`${i.id}-${i.via}`} kind="case" id={i.id} label={`${i.label} · ${i.via}`} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Media ────────────────────────────────────────────────────────────────────
function MediaSection({ media, canEdit, onAdd, onOpen }: { media: MediaRow[]; canEdit: boolean; onAdd: () => void; onOpen: (m: MediaRow) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2"><h3 className="text-sm font-bold text-white">Media</h3><Badge>{media.length}</Badge></div>
        {canEdit && <button onClick={onAdd} className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">+ Photo</button>}
      </div>
      {!media.length ? (
        <EmptyState title="No media" hint={canEdit ? 'Add a photo or link imagery to this gang.' : undefined} />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((m) => {
            const src = safeUrl(m.external_url || m.storage_path || '')
            return (
              <button key={m.id} onClick={() => onOpen(m)} className="group relative overflow-hidden rounded-lg border border-white/5 bg-ink-850" title={m.title}>
                {src && m.type !== 'document' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external media CDN
                  <img src={src} alt={m.title} className="h-28 w-full object-cover transition group-hover:opacity-90" />
                ) : (
                  <div className="grid h-28 w-full place-items-center text-2xl" aria-hidden>{m.type === 'video' ? '🎬' : '📄'}</div>
                )}
                <span className="block truncate px-1.5 py-1 text-left text-[11px] text-slate-400">{m.title}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Dossier shell ────────────────────────────────────────────────────────────
export function GangDossier({ gang, people, caseOptions, canEdit, canDelete, onBack, onRefresh, onEdit, onDelete, onProfile, children }: {
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
  children?: React.ReactNode
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const now = useNow()

  const [members, setMembers] = useState<MemberRow[]>([])
  const [turf, setTurf] = useState<TurfRow[]>([])
  const [places, setPlaces] = useState<PlaceRow[]>([])
  const [gangPlaces, setGangPlaces] = useState<GangPlaceRow[]>([])
  const [vehicles, setVehicles] = useState<VehicleRow[]>([])
  const [media, setMedia] = useState<MediaRow[]>([])
  const [intelLinks, setIntelLinks] = useState<IntelLinkRow[]>([])
  const [linkedCases, setLinkedCases] = useState<Map<string, CaseRow>>(new Map())
  const [err, setErr] = useState<string | null>(null)

  const [memberEditor, setMemberEditor] = useState<MemberRow | 'new' | null>(null)
  const [turfOpen, setTurfOpen] = useState(false)
  const [linkPlaceOpen, setLinkPlaceOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [lightbox, setLightbox] = useState<MediaRow | null>(null)

  const section = (SECTION_IDS.includes(sp.get('section') as SectionId) ? sp.get('section') : 'overview') as SectionId
  const setSection = useCallback((next: SectionId) => {
    const params = new URLSearchParams(sp.toString())
    params.set('gang', gang.id)
    params.set('section', next)
    router.replace(`/gangs?${params.toString()}`)
  }, [sp, gang.id, router])

  const load = useCallback(async () => {
    setErr(null)
    try {
      const [m, t, allPlaces, gp, veh, med, links] = await Promise.all([
        list('gang_members', { eq: { gang_id: gang.id } }),
        list('gang_turf', { eq: { gang_id: gang.id } }),
        list('places').catch(() => [] as PlaceRow[]),
        list('gang_places', { eq: { gang_id: gang.id } }).catch(() => [] as GangPlaceRow[]),
        list('vehicles', { eq: { gang_id: gang.id } }).catch(() => [] as VehicleRow[]),
        list('media', { eq: { gang_id: gang.id } }).catch(() => [] as MediaRow[]),
        list('case_intel_links', { eq: { kind: 'gang', ref_id: gang.id } }).catch(() => [] as IntelLinkRow[]),
      ])
      setMembers(m); setTurf(t); setPlaces(allPlaces); setGangPlaces(gp); setVehicles(veh); setMedia(med); setIntelLinks(links)
      const caseIds = [...new Set(links.map((l) => l.ref_id))]
      if (caseIds.length) {
        const rows = (await list('cases', { in: { id: caseIds } }).catch(() => [] as CaseRow[]))
        setLinkedCases(new Map(rows.map((c) => [c.id, c])))
      } else setLinkedCases(new Map())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [gang.id])

  useEffect(() => { const h = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(h) }, [load])

  // Merge controlling + linked places into one navigable list (dedupe by place).
  const linkedPlaces: LinkedPlace[] = useMemo(() => {
    const byId = new Map<string, LinkedPlace>()
    for (const p of places) if (p.controlling_gang_id === gang.id) byId.set(p.id, { place: p, link: null, via: 'controlling' })
    for (const gp of gangPlaces) {
      const place = places.find((p) => p.id === gp.place_id)
      if (place) byId.set(place.id, { place, link: gp, via: 'linked' })
    }
    return [...byId.values()]
  }, [places, gangPlaces, gang.id])

  // Indirect case references (member.case_id / place.case_id) not already durable.
  const indirectCases = useMemo(() => {
    const durable = new Set(intelLinks.map((l) => l.ref_id))
    const out = new Map<string, { id: string; label: string; via: string }>()
    for (const m of members) if (m.case_id && !durable.has(m.case_id)) out.set(m.case_id, { id: m.case_id, label: caseOptions.find((c) => c.id === m.case_id)?.case_number ?? 'Case', via: 'member' })
    for (const lp of linkedPlaces) if (lp.place.case_id && !durable.has(lp.place.case_id)) out.set(lp.place.case_id, { id: lp.place.case_id, label: caseOptions.find((c) => c.id === lp.place.case_id)?.case_number ?? 'Case', via: 'place' })
    return [...out.values()]
  }, [members, linkedPlaces, intelLinks, caseOptions])

  const leaders = members.filter((m) => ['leader', 'command'].includes(rankTier(m.rank))).length

  // Completeness — fraction of key intel fields present (never fabricated).
  const completeness = useMemo(() => {
    const summary = parseIntelSummary(gang.intelligence_summary)
    const checks = [!!gang.status, !!gang.confidence, !!gang.lead_detective_id, !!gang.reviewed_at, Object.keys(summary).length > 0, members.length > 0, turf.length > 0]
    return Math.round((checks.filter(Boolean).length / checks.length) * 100)
  }, [gang, members.length, turf.length])

  const activity: TimelineEntry[] = useMemo(() => {
    const e: TimelineEntry[] = []
    for (const m of members) e.push({ id: `m-${m.id}`, title: `Member: ${m.name}`, at: m.created_at, note: m.rank || undefined })
    for (const t of turf) e.push({ id: `t-${t.id}`, title: `Turf: ${t.block}`, at: t.created_at })
    for (const gp of gangPlaces) e.push({ id: `gp-${gp.id}`, title: 'Place linked', at: gp.created_at, note: gp.role || undefined })
    for (const md of media) e.push({ id: `md-${md.id}`, title: `Media: ${md.title}`, at: md.created_at })
    if (gang.reviewed_at) e.push({ id: 'rev', title: 'Intelligence reviewed', at: gang.reviewed_at, actor: officerName(gang.reviewed_by) ?? undefined })
    return e.filter((x) => x.at).sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 25)
  }, [members, turf, gangPlaces, media, gang.reviewed_at, gang.reviewed_by])

  const metrics: Metric[] = [
    { label: 'Members', value: members.length, onClick: () => setSection('members') },
    { label: 'Leaders', value: leaders || '—', onClick: () => setSection('members'), hint: 'Leadership + command' },
    { label: 'Turf zones', value: turf.length, onClick: () => setSection('territory') },
    { label: 'Properties', value: linkedPlaces.length, onClick: () => setSection('places') },
    { label: 'Vehicles', value: vehicles.length, onClick: () => setSection('vehicles') },
    { label: 'Cases', value: intelLinks.length, onClick: () => setSection('cases') },
    { label: 'Intel events', value: activity.length, onClick: () => setSection('activity') },
    { label: 'Completeness', value: `${completeness}%`, hint: 'Key intel fields filled' },
  ]

  const tabs: SectionTab<SectionId>[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'members', label: 'Members', count: members.length },
    { id: 'territory', label: 'Territory', count: turf.length },
    { id: 'places', label: 'Places', count: linkedPlaces.length },
    { id: 'vehicles', label: 'Vehicles', count: vehicles.length },
    { id: 'cases', label: 'Cases', count: intelLinks.length },
    { id: 'media', label: 'Media', count: media.length },
    { id: 'activity', label: 'Activity', count: activity.length, marker: isGangStale(gang, now), markerLabel: 'Intelligence overdue for review' },
  ]

  const deleteTurf = async (t: TurfRow) => {
    if (!(await uiConfirm('Remove this turf entry? Prefer marking it Historical if it is past territory.', { confirmText: 'Remove' }))) return
    const res = await remove('gang_turf', t.id)
    if (res.error) { toast(`Remove failed: ${res.error.message}`, 'danger'); return }
    toast('Turf removed', 'success'); void load()
  }
  const unlinkPlace = async (l: GangPlaceRow) => {
    if (!(await uiConfirm('Unlink this place from the gang? The place record itself is kept.', { confirmText: 'Unlink' }))) return
    const res = await remove('gang_places', l.id)
    if (res.error) { toast(`Unlink failed: ${res.error.message}`, 'danger'); return }
    toast('Place unlinked', 'success'); void load()
  }
  const unlinkCase = async (l: IntelLinkRow) => {
    if (!(await uiConfirm('Remove this durable case link?', { confirmText: 'Unlink' }))) return
    const res = await remove('case_intel_links', l.id)
    if (res.error) { toast(`Unlink failed: ${res.error.message}`, 'danger'); return }
    toast('Case link removed', 'success'); void load()
  }
  const setLifecycle = async (status: string) => {
    const { update } = await import('@/lib/db')
    const res = await update('gangs', gang.id, { status })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(`Marked ${humanize(status)}`, 'success'); void onRefresh()
  }

  const menuItems = [
    { label: 'Open intel profile', onClick: onProfile, icon: '🗂' },
    { label: 'Open in Network', onClick: () => router.push(`/network?focus=g:${gang.id}`), icon: '🕸' },
    { label: 'View on map', onClick: () => router.push(`/heatmap?gang=${encodeURIComponent(gang.id)}`), icon: '🗺' },
    ...(canEdit ? [gang.status === 'disbanded'
      ? { label: 'Mark active', onClick: () => void setLifecycle('active'), icon: '↺', separatorBefore: true }
      : { label: 'Mark disbanded', onClick: () => void setLifecycle('disbanded'), icon: '⚑', separatorBefore: true }] : []),
    ...(canDelete ? [{ label: 'Delete gang', onClick: onDelete, danger: true, icon: '🗑', separatorBefore: !canEdit }] : []),
  ]

  return (
    <section className="view-in space-y-4">
      <Breadcrumbs items={[{ label: 'Gangs', onClick: onBack }, { label: gang.name }]} />

      {/* Intelligence header */}
      <Card pad="lg">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black text-white">{gang.name}</h1>
              {gang.aliases && <span className="text-sm text-slate-400">aka {gang.aliases}</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tint={threatTint(gang.threat_level)}>{cap(gang.threat_level)} threat</Badge>
              {gang.status && <Badge tint={statusTint(gang.status)}>{humanize(gang.status)}</Badge>}
              {gang.classification && <Badge tone="neutral">{humanize(gang.classification)}</Badge>}
              {gang.confidence && <ConfidenceBadge confidence={gang.confidence} />}
              <StaleIntelBadge reviewedAt={gang.reviewed_at} now={now} thresholdDays={DEFAULT_REVIEW_DAYS} />
              <span className="text-[11px] text-slate-500">Updated {fmtDate(gang.updated_at)}{officerName(gang.lead_detective_id) ? ` · Lead ${officerName(gang.lead_detective_id)}` : ''}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canEdit && <button onClick={onEdit} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Edit gang</button>}
            {canEdit && <button onClick={() => setMemberEditor('new')} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10">Add member</button>}
            {canEdit && <button onClick={onEdit} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-blue-200 hover:bg-white/10">Add intelligence</button>}
            {canEdit && <button onClick={() => setAttachOpen(true)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-blue-200 hover:bg-white/10">Attach to case</button>}
            <ActionMenu items={menuItems} />
          </div>
        </div>

        {/* Identity block */}
        <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 border-t border-white/5 pt-3 sm:grid-cols-2">
          <KV label="Colors"><ColorSwatches colors={gang.colors} /></KV>
          <KV label="Classification">{gang.classification ? humanize(gang.classification) : '—'}</KV>
        </div>
      </Card>

      {err && <ErrorNotice message={err} onRetry={load} />}

      {/* Sticky section nav */}
      <div className="sticky top-0 z-20 -mx-1 bg-ink-950/80 px-1 py-1 backdrop-blur">
        <SectionTabs<SectionId> tabs={tabs} active={section} onChange={setSection} idBase="gang" ariaLabel="Gang sections" />
      </div>

      <div id={panelDomId('gang', section)} role="tabpanel" aria-labelledby={tabDomId('gang', section)}>
        {section === 'overview' && (
          <div className="space-y-4">
            <MetricStrip metrics={metrics} />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2"><IntelligenceSummary gang={gang} canEdit={canEdit} onEdit={onEdit} /></div>
              <div className="space-y-4">
                <InvestigationStatus gang={gang} now={now} />
                <Card pad="lg">
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">Recent activity</h3>
                  {activity.length ? <WorkflowTimeline entries={activity.slice(0, 8)} dense /> : <p className="text-sm text-slate-500">No recorded activity yet.</p>}
                </Card>
              </div>
            </div>
          </div>
        )}
        {section === 'members' && <RosterSection members={members} canEdit={canEdit} canDelete={canDelete} onAddMember={() => setMemberEditor('new')} onEditMember={(m) => setMemberEditor(m)} onRefresh={() => void load()} />}
        {section === 'territory' && <TerritorySection gangId={gang.id} turf={turf} canEdit={canEdit} canDelete={canDelete} onAdd={() => setTurfOpen(true)} onDelete={(t) => void deleteTurf(t)} now={now} />}
        {section === 'places' && <PlacesSection linked={linkedPlaces} media={media} canEdit={canEdit} canDelete={canDelete} onLink={() => setLinkPlaceOpen(true)} onUnlink={(l) => void unlinkPlace(l)} />}
        {section === 'vehicles' && <VehiclesSection vehicles={vehicles} />}
        {section === 'cases' && <CasesSection links={intelLinks} cases={linkedCases} indirect={indirectCases} canEdit={canEdit} onAttach={() => setAttachOpen(true)} onUnlink={(l) => void unlinkCase(l)} />}
        {section === 'media' && <MediaSection media={media} canEdit={canEdit} onAdd={() => setPhotoOpen(true)} onOpen={(m) => setLightbox(m)} />}
        {section === 'activity' && (
          <Card pad="lg">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold uppercase tracking-wide text-slate-300">Activity</h3><StaleIntelBadge reviewedAt={gang.reviewed_at} now={now} /></div>
            {activity.length ? <WorkflowTimeline entries={activity} /> : <p className="text-sm text-slate-500">No recorded activity yet.</p>}
            <p className="mt-2 text-[11px] text-slate-500">Derived from records visible to you. The authoritative audit trail (audit_log) is available to command/owner.</p>
          </Card>
        )}
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
          onDelete={async (m) => { setMemberEditor(null); const { deleteWithUndo } = await import('@/lib/db'); await deleteWithUndo('gang_members', m, { label: `Member${m.name ? ` "${m.name}"` : ''}`, after: () => void load() }) }}
        />
      )}
      {turfOpen && <TurfModal gangId={gang.id} onClose={() => setTurfOpen(false)} onSaved={() => { setTurfOpen(false); void load() }} />}
      {linkPlaceOpen && <LinkPlaceModal gang={gang} places={places} existing={gangPlaces} onClose={() => setLinkPlaceOpen(false)} onSaved={() => { setLinkPlaceOpen(false); void load() }} />}
      {photoOpen && <AddGangPhotoModal gang={gang} onClose={() => setPhotoOpen(false)} onSaved={() => { setPhotoOpen(false); void load() }} />}
      {attachOpen && <AttachGangModal gang={gang} caseOptions={caseOptions} onClose={() => setAttachOpen(false)} onSaved={() => { setAttachOpen(false); void load() }} />}
      {lightbox && <GangPhotoLightbox media={lightbox} onClose={() => setLightbox(null)} />}
      {children}
    </section>
  )
}
