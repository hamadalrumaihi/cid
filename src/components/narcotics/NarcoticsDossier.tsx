'use client'

/** Narcotics substance DOSSIER (spec §8-20) — the deep-linkable intelligence
 *  detail view (`/narcotics?drug=<id>&section=<id>`). Mirrors the persons/gangs
 *  dossier template: an identity header off ONE narcotics fetch (+ aliases +
 *  the representative media row), a click-through MetricStrip, sticky
 *  deep-linkable SectionTabs, and dedicated sections that lazy-load their own
 *  slice on first open (seq-guarded, persons/profileLoad pattern). Realtime
 *  bumps reload the core row + the open section; other sections go stale and
 *  reload on their next open. The database stays the authority — this presents
 *  intelligence and routes mutations through the definer RPCs / db.update. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { fmtDate } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { statusTint } from '@/lib/tint'
import { toast } from '@/lib/toast'
import { useNow } from '@/lib/useNow'
import { ActionMenu, type ActionItem } from '@/components/ui/ActionMenu'
import { Badge } from '@/components/ui/Badge'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfidenceBadge, ProvenanceBadge, StaleIntelBadge } from '@/components/ui/IntelBadges'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { Notice, ErrorNotice } from '@/components/ui/Notice'
import { SectionTabs, panelDomId, tabDomId, type SectionTab } from '@/components/ui/SectionTabs'
import { GangPhotoLightbox } from '@/components/gangs/gangModals'
import {
  NARCOTIC_REVIEW_DAYS, buildNarcoticActivity, categoryLabel, isNarcoticStale, sectionFromParam,
  statusLabel, statusTintKey, type SectionId,
} from './narcoticsDossier'
import {
  loadActivity, loadCasesData, loadCounts, loadIntelligence, loadMedia, loadNarcoticCore,
  loadPeople, loadPlaces, loadSeizures,
  type ActivityData, type CasesData, type IntelligenceData, type MediaRow, type NarcoticCore,
  type NarcoticCounts, type PeopleData, type PlacesData, type SeizuresData,
} from './narcoticsLoad'
import { NarcoticOverview, IdentificationSection, PackagingSection, IntelligenceSection } from './NarcoticsSections'
import { ActivitySection, CasesSection, MediaSection, PeopleSection, PlacesSection, SeizuresSection } from './NarcoticsRelations'
import { NarcoticEditModal, NarcoticMergeModal, NarcoticResolveModal } from './NarcoticsModals'
import { NarcoticsSuggestionForm } from './NarcoticsSuggestionForm'

interface Slices {
  counts?: NarcoticCounts
  seizures?: SeizuresData
  places?: PlacesData
  people?: PeopleData
  cases?: CasesData
  intelligence?: IntelligenceData
  media?: MediaRow[]
  activity?: ActivityData
}

export function NarcoticsDossier({ drugId, onClose }: { drugId: string; onClose: () => void }) {
  const router = useRouter()
  const sp = useSearchParams()
  const now = useNow()
  const { canEdit, isCommand } = useAuth()

  const [core, setCore] = useState<NarcoticCore | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [slices, setSlices] = useState<Slices>({})
  const [imgBroken, setImgBroken] = useState(false)

  const [editOpen, setEditOpen] = useState<{ focusCharges?: boolean } | null>(null)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [resolveOpen, setResolveOpen] = useState(false)
  const [lightbox, setLightbox] = useState<MediaRow | null>(null)

  const fetchProfiles = useProfilesStore((s) => s.fetch)
  useProfilesStore((s) => s.loaded) // re-render once the roster lands

  const rtKey =
    useTableVersion('narcotics')
    + useTableVersion('narcotic_aliases')
    + useTableVersion('narcotic_seizures')
    + useTableVersion('narcotic_places')
    + useTableVersion('narcotic_persons')
    + useTableVersion('narcotic_gangs')
    + useTableVersion('case_intel_links')
    + useTableVersion('media')

  const section = sectionFromParam(sp.get('section'))
  const setSection = useCallback((next: SectionId) => {
    const params = new URLSearchParams(sp.toString())
    params.set('drug', drugId)
    params.set('section', next)
    router.replace(`/narcotics?${params.toString()}`)
  }, [sp, drugId, router])

  // ── Core (header) — seq-guarded so `?drug=` can switch in place ────────────
  const seqRef = useRef(0)
  const loadCore = useCallback(async () => {
    const seq = ++seqRef.current
    setErr(null)
    try {
      const c = await loadNarcoticCore(drugId)
      if (seq === seqRef.current) setCore(c)
    } catch (e) {
      if (seq === seqRef.current) setErr(e instanceof Error ? e.message : String(e))
    }
  }, [drugId])

  // ── Per-section lazy loaders (seq-guarded per section) ─────────────────────
  const sectionSeq = useRef<Partial<Record<SectionId, number>>>({})
  const loadedKey = useRef<Partial<Record<SectionId, number>>>({})
  const loadSection = useCallback(async (sec: SectionId) => {
    const seq = (sectionSeq.current[sec] ?? 0) + 1
    sectionSeq.current[sec] = seq
    const apply = (patch: Partial<Slices>) => {
      if (sectionSeq.current[sec] === seq) setSlices((s) => ({ ...s, ...patch }))
    }
    switch (sec) {
      case 'overview': apply({ counts: await loadCounts(drugId) }); break
      case 'packaging': { const [seizures, media] = await Promise.all([loadSeizures(drugId), loadMedia(drugId)]); apply({ seizures, media }); break }
      case 'intelligence': apply({ intelligence: await loadIntelligence(drugId) }); break
      case 'cases': apply({ cases: await loadCasesData(drugId) }); break
      case 'seizures': apply({ seizures: await loadSeizures(drugId) }); break
      case 'places': apply({ places: await loadPlaces(drugId) }); break
      case 'people': apply({ people: await loadPeople(drugId) }); break
      case 'media': apply({ media: await loadMedia(drugId) }); break
      case 'activity': apply({ activity: await loadActivity(drugId) }); break
      case 'identification': break // served by the core (aliases + row)
    }
  }, [drugId])

  // id switch: reset, invalidate in-flight section loads, then load the header.
  useEffect(() => {
    loadedKey.current = {}
    const keys = Object.keys(sectionSeq.current) as SectionId[]
    for (const s of keys) sectionSeq.current[s] = (sectionSeq.current[s] ?? 0) + 1
    const t = window.setTimeout(() => {
      setCore(null); setSlices({}); setImgBroken(false)
      void fetchProfiles(); void loadCore()
    }, 0)
    return () => window.clearTimeout(t)
  }, [loadCore, fetchProfiles])

  // Realtime bump (never the initial render): refresh the core row.
  const lastRt = useRef(rtKey)
  useEffect(() => {
    if (lastRt.current === rtKey) return
    lastRt.current = rtKey
    void loadCore()
  }, [rtKey, loadCore])

  // Open-section loader: on first open and again when realtime moved.
  useEffect(() => {
    if (!core) return
    if (loadedKey.current[section] === rtKey) return
    loadedKey.current[section] = rtKey
    const t = window.setTimeout(() => { void loadSection(section) }, 0)
    return () => window.clearTimeout(t)
  }, [core, section, rtKey, loadSection])

  const refresh = useCallback(() => {
    loadedKey.current = { [section]: rtKey }
    void loadCore()
    void loadSection(section)
  }, [section, rtKey, loadCore, loadSection])

  const n = core?.narcotic ?? null
  const aliases = core?.aliases ?? []
  const merged = !!n?.merged_into
  const mayEdit = canEdit && !merged
  const provisional = (n?.status ?? '').toLowerCase() === 'provisional'

  const setRepresentative = useCallback(async (m: MediaRow) => {
    if (!n) return
    const res = await update('narcotics', n.id, { representative_media_id: m.id })
    if (res.error) { toast(`Failed: ${res.error.message}`, 'danger'); return }
    toast('Representative image set', 'success')
    void loadCore()
  }, [n, loadCore])

  const counts = slices.counts
  const activity = useMemo(
    () => (n ? buildNarcoticActivity(n, slices.activity ?? {}, officerName) : []),
    [n, slices.activity],
  )

  const metrics: Metric[] = [
    { label: 'Linked cases', value: counts ? counts.caseLinks : '—', onClick: () => setSection('cases') },
    { label: 'Seizures', value: counts ? counts.seizures : '—', onClick: () => setSection('seizures') },
    { label: 'Places', value: counts ? counts.places : '—', onClick: () => setSection('places') },
    { label: 'People & gangs', value: counts ? counts.people : '—', onClick: () => setSection('people') },
  ]

  const tabs: SectionTab<SectionId>[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'identification', label: 'Identification' },
    { id: 'packaging', label: 'Packaging' },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'cases', label: 'Cases', count: counts?.caseLinks },
    { id: 'seizures', label: 'Seizures', count: counts?.seizures },
    { id: 'places', label: 'Places', count: counts?.places },
    { id: 'people', label: 'People & Gangs', count: counts?.people },
    { id: 'media', label: 'Media', count: counts?.media ?? slices.media?.length },
    { id: 'activity', label: 'Activity', marker: !!n && isNarcoticStale(n.reviewed_at, now), markerLabel: 'Intelligence overdue for review' },
  ]

  const menuItems: ActionItem[] = [
    { label: 'Suggest correction…', icon: '✎', onClick: () => setSuggestOpen(true) },
    ...(mayEdit ? [{ label: 'Set representative image…', icon: '🖼', onClick: () => setSection('media'), separatorBefore: true }] : []),
    ...(isCommand && !merged ? [
      ...(provisional ? [{ label: 'Confirm / resolve provisional…', icon: '✔', onClick: () => setResolveOpen(true), separatorBefore: true }] : []),
      { label: 'Merge duplicate…', icon: '🧬', onClick: () => setMergeOpen(true), separatorBefore: !provisional },
    ] : []),
  ]

  const repSrc = core?.representative ? safeUrl(core.representative.external_url || core.representative.storage_path || '') : ''

  return (
    <section className="view-in space-y-4">
      <Breadcrumbs items={[{ label: 'Narcotics', onClick: onClose }, { label: n?.name || 'Dossier' }]} />

      {err ? (
        <ErrorNotice message={err} onRetry={() => void loadCore()} />
      ) : !n ? (
        <Notice text="Building dossier…" />
      ) : (
        <>
          {merged && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
              <p className="text-sm text-slate-100">This record was merged into another substance and is read-only.</p>
            </div>
          )}

          {/* Intelligence header */}
          <Card pad="lg">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                {repSrc && !imgBroken ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external media CDN
                  <img src={repSrc} alt={`${n.name} representative image`} onError={() => setImgBroken(true)} className="h-20 w-20 flex-shrink-0 rounded-xl border border-white/10 object-cover" />
                ) : (
                  <div className="grid h-20 w-20 flex-shrink-0 place-items-center rounded-xl bg-ink-700 text-3xl" aria-hidden>{n.icon || '💊'}</div>
                )}
                <div className="min-w-0">
                  <h1 className="text-2xl font-black text-white">{n.name}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{categoryLabel(n.category)}</Badge>
                    <Badge tint={statusTint(statusTintKey(n.status))}>{statusLabel(n.status)}</Badge>
                    {n.confidence && <ConfidenceBadge confidence={n.confidence} />}
                    {n.provenance && <ProvenanceBadge provenance={n.provenance} />}
                    <StaleIntelBadge reviewedAt={n.reviewed_at} now={now} thresholdDays={NARCOTIC_REVIEW_DAYS} />
                    {n.restricted && <Badge tone="danger" title="Restricted intelligence">Restricted</Badge>}
                    {n.server_specific && <Badge tone="warn" title="Server-specific — may not generalise">Server-specific</Badge>}
                  </div>
                  {aliases.length > 0 && (
                    <p className="mt-1.5 text-sm text-slate-400">
                      aka {aliases.slice(0, 6).map((a) => a.alias).join(', ')}{aliases.length > 6 ? ` +${aliases.length - 6} more` : ''}
                    </p>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">
                    Updated {fmtDate(n.updated_at)}
                    {officerName(n.created_by) ? ` · Added by ${officerName(n.created_by)}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {mayEdit && <Button variant="primary" onClick={() => setEditOpen({})}>Edit</Button>}
                <Button onClick={() => setSuggestOpen(true)}>Suggest correction</Button>
                <ActionMenu items={menuItems} />
              </div>
            </div>
          </Card>

          {/* Sticky section nav */}
          <div className="sticky top-0 z-20 -mx-1 bg-ink-950/80 px-1 py-1 backdrop-blur">
            <SectionTabs<SectionId> tabs={tabs} active={section} onChange={setSection} idBase="narcotic" ariaLabel="Narcotic sections" />
          </div>

          <div id={panelDomId('narcotic', section)} role="tabpanel" aria-labelledby={tabDomId('narcotic', section)}>
            {section === 'overview' && (
              <div className="space-y-4">
                <MetricStrip metrics={metrics} />
                <NarcoticOverview narcotic={n} aliases={aliases} canEditCharges={isCommand && !merged} onEditCharges={() => setEditOpen({ focusCharges: true })} />
              </div>
            )}
            {section === 'identification' && <IdentificationSection narcotic={n} aliases={aliases} />}
            {section === 'packaging' && (
              slices.seizures && slices.media
                ? <PackagingSection narcotic={n} seizures={slices.seizures.rows} media={slices.media} />
                : <Notice text="Loading packaging…" />
            )}
            {section === 'intelligence' && (
              slices.intelligence ? <IntelligenceSection narcotic={n} data={slices.intelligence} /> : <Notice text="Loading intelligence…" />
            )}
            {section === 'cases' && (slices.cases ? <CasesSection data={slices.cases} /> : <Notice text="Loading cases…" />)}
            {section === 'seizures' && (slices.seizures ? <SeizuresSection data={slices.seizures} /> : <Notice text="Loading seizures…" />)}
            {section === 'places' && (slices.places ? <PlacesSection data={slices.places} /> : <Notice text="Loading places…" />)}
            {section === 'people' && (slices.people ? <PeopleSection data={slices.people} /> : <Notice text="Loading people &amp; gangs…" />)}
            {section === 'media' && (
              slices.media
                ? <MediaSection media={slices.media} representativeId={n.representative_media_id} canEdit={mayEdit} onOpen={setLightbox} onSetRepresentative={(m) => void setRepresentative(m)} />
                : <Notice text="Loading media…" />
            )}
            {section === 'activity' && (
              slices.activity ? <ActivitySection entries={activity} reviewedAt={n.reviewed_at} now={now} /> : <Notice text="Loading activity…" />
            )}
          </div>
        </>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {editOpen && n && (
        <NarcoticEditModal
          narcotic={n}
          canEditCharges={isCommand && !merged}
          focusCharges={editOpen.focusCharges}
          onClose={() => setEditOpen(null)}
          onSaved={() => { setEditOpen(null); refresh() }}
        />
      )}
      {suggestOpen && n && (
        <NarcoticsSuggestionForm narcoticId={n.id} narcoticName={n.name} onClose={() => setSuggestOpen(false)} />
      )}
      {mergeOpen && n && (
        <NarcoticMergeModal narcotic={n} onClose={() => setMergeOpen(false)} onMerged={() => { setMergeOpen(false); refresh() }} />
      )}
      {resolveOpen && n && (
        <NarcoticResolveModal narcotic={n} onClose={() => setResolveOpen(false)} onResolved={() => { setResolveOpen(false); void loadCore() }} />
      )}
      {lightbox && <GangPhotoLightbox media={lightbox} onClose={() => setLightbox(null)} />}
    </section>
  )
}
