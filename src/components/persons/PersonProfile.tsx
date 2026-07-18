'use client'

/** Person intelligence dossier (`/persons?person=<id>&section=<id>`) — the
 *  redesigned full-page profile, mirroring the Gang dossier structurally:
 *  identity header + badges, sticky deep-linkable section nav, an overview
 *  that answers the investigator's questions at a glance, and dedicated lazy
 *  sections for identity, associates, cases, legal, vehicles, locations,
 *  media and activity.
 *
 *  Perf contract: the header renders off ONE persons fetch (+ the
 *  linked gang by id and a slim legal projection for the header badge); each
 *  section lazy-loads its own slice on first open via profileLoad.ts. There
 *  is no full reports/cases/gangs table load anywhere on this screen —
 *  warrants come from the structured legal_requests.person_id join, never
 *  from report text-matching. Realtime bumps refetch the OPEN section only;
 *  other sections are marked stale and reload on next open. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { deleteWithUndo, list, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { downloadDocx } from '@/lib/docx'
import { fmtDate, slug, todayISO } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { priorityTint, statusTint } from '@/lib/tint'
import { toast } from '@/lib/toast'
import { useNow } from '@/lib/useNow'
import { useWatchlistStore } from '@/lib/watchlist'
import { ActionMenu, type ActionItem } from '@/components/ui/ActionMenu'
import { Badge } from '@/components/ui/Badge'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EntityLink } from '@/components/ui/EntityLink'
import { ConfidenceBadge, StaleIntelBadge, daysSince } from '@/components/ui/IntelBadges'
import { MetricStrip, type Metric } from '@/components/ui/MetricStrip'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice, ErrorNotice } from '@/components/ui/Notice'
import { SectionTabs, panelDomId, tabDomId, type SectionTab } from '@/components/ui/SectionTabs'
import type { TimelineEntry } from '@/components/ui/WorkflowTimeline'
import { uiConfirm } from '@/components/ui/dialog'
import { humanize } from '@/components/gangs/gangIntel'
import { GangPhotoLightbox } from '@/components/gangs/gangModals'
import {
  PERSON_REVIEW_DAYS, classificationLabel, isPersonStale, legalStatusOf, personQualityWarnings,
  placeRoleLabel, relationshipLabel, vehicleRoleLabel,
} from './personIntel'
import { PERSON_NULL_REFS, PersonModal, parseProperties, type GangRow, type PersonRow, type PersonProperty } from './PersonModal'
import { dossierParas, dossierPdfSpec, gatherPersonDossier } from './dossier'
import {
  loadActivityData, loadCasesData, loadMediaRows, loadPersonCore, loadPlacesData, loadProfileCounts, loadRelations,
  type ActivityData, type CasesData, type MediaRow, type PersonCore, type PlacesData, type ProfileCounts,
  type RelationsData, type VehiclesData, loadVehiclesData,
} from './profileLoad'
import {
  ActivitySection, ACTIVITY_CAP, IdentityEditorModal, IdentitySection, InvestigationStatusCard, MarkReviewedModal,
  PersonIntelligenceSummary, SummaryEditorModal, type QualityWarningView,
} from './ProfileSections'
import { AttachPersonModal, CasesSection, LinkAssociateModal, RelationshipsSection } from './ProfileRelations'
import {
  AddPersonMediaModal, LinkPersonPlaceModal, LinkVehicleModal, PersonMediaSection, PersonPlacesSection, PersonVehiclesSection,
} from './ProfileAssets'
import { BoloStateBadge, LegalSection, ManageBoloModal } from './ProfileLegal'
import { PersonDuplicatesModal } from './PersonMergeModal'

type SectionId = 'overview' | 'identity' | 'relationships' | 'cases' | 'legal' | 'vehicles' | 'locations' | 'media' | 'activity'
const SECTION_IDS: SectionId[] = ['overview', 'identity', 'relationships', 'cases', 'legal', 'vehicles', 'locations', 'media', 'activity']

/** Stable empty fallback so memo deps don't churn while the core loads. */
const NO_LEGAL: PersonCore['legal'] = []

interface Slices {
  counts?: ProfileCounts
  relations?: RelationsData
  cases?: CasesData
  vehicles?: VehiclesData
  places?: PlacesData
  media?: MediaRow[]
  activity?: ActivityData
}

/** Timeline assembly — derived from domain rows only (owner-only audit_log is
 *  never fetched here). Deduped, newest first, capped at ACTIVITY_CAP. */
function buildActivity(person: PersonRow, a: ActivityData | undefined): TimelineEntry[] {
  const e: TimelineEntry[] = []
  if (person.created_at) e.push({ id: 'created', title: 'Record created', at: person.created_at, actor: officerName(person.created_by) ?? undefined })
  if (person.updated_at && person.updated_at !== person.created_at) e.push({ id: 'updated', title: 'Record updated', at: person.updated_at })
  if (person.reviewed_at) e.push({ id: 'reviewed', title: 'Intelligence reviewed', at: person.reviewed_at, actor: officerName(person.reviewed_by) ?? undefined, note: person.review_note ?? undefined })
  if (person.bolo_issued_at) e.push({ id: 'bolo', title: person.bolo ? 'BOLO issued' : 'BOLO issued (since cleared)', at: person.bolo_issued_at, actor: officerName(person.bolo_issued_by) ?? undefined, note: person.bolo_reason ?? undefined })
  if (a) {
    for (const r of a.relationships) e.push({ id: `rel-${r.id}`, title: 'Associate linked', at: r.created_at, note: relationshipLabel(r.relationship) })
    for (const p of a.places) e.push({ id: `pp-${p.id}`, title: 'Place linked', at: p.created_at, note: p.role ? placeRoleLabel(p.role) : undefined })
    for (const v of a.vehicles) e.push({ id: `pv-${v.id}`, title: 'Vehicle linked', at: v.created_at, note: vehicleRoleLabel(v.role) })
    for (const l of a.links) e.push({ id: `cil-${l.id}`, title: 'Case link added', at: l.created_at, note: l.role ?? undefined })
    for (const m of a.media) e.push({ id: `md-${m.id}`, title: `Media added: ${m.title || 'item'}`, at: m.created_at })
  }
  const seen = new Set<string>()
  return e
    .filter((x) => x.at && !seen.has(x.id) && seen.add(x.id))
    .sort((x, y) => (y.at || '').localeCompare(x.at || ''))
}

export function PersonProfile({ id, onBack }: { id: string; onBack: () => void }) {
  const router = useRouter()
  const sp = useSearchParams()
  const now = useNow()
  const [today] = useState(todayISO)
  const { canEdit, canDelete, isCommand } = useAuth()

  const [core, setCore] = useState<PersonCore | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [slices, setSlices] = useState<Slices>({})
  const [gangsForEdit, setGangsForEdit] = useState<GangRow[] | null>(null)

  // Modal state
  const [editing, setEditing] = useState(false)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [boloOpen, setBoloOpen] = useState(false)
  const [linkAssociate, setLinkAssociate] = useState(false)
  const [linkVehicle, setLinkVehicle] = useState(false)
  const [linkPlace, setLinkPlace] = useState<{ legacy?: PersonProperty } | null>(null)
  const [addMedia, setAddMedia] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [dupOpen, setDupOpen] = useState(false)
  const [lightbox, setLightbox] = useState<MediaRow | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [imgBroken, setImgBroken] = useState(false)

  const fetchWatch = useWatchlistStore((s) => s.fetch)
  const watching = useWatchlistStore((s) => s.rows.some((w) => w.target_type === 'person' && w.target_id === id))
  const toggleWatch = useWatchlistStore((s) => s.toggle)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  // Subscribe so officerName() resolutions re-render once the roster lands.
  useProfilesStore((s) => s.loaded)

  // Realtime — persons + every link table this screen renders. A bump reloads
  // the core row and the OPEN section only; other slices go stale and reload
  // on their next open.
  const rtKey =
    useTableVersion('persons')
    + useTableVersion('person_relationships')
    + useTableVersion('person_places')
    + useTableVersion('person_vehicles')
    + useTableVersion('vehicles')
    + useTableVersion('case_intel_links')
    + useTableVersion('media')
    + useTableVersion('legal_requests')

  const section = (SECTION_IDS.includes(sp.get('section') as SectionId) ? sp.get('section') : 'overview') as SectionId
  const setSection = useCallback((next: SectionId) => {
    const params = new URLSearchParams(sp.toString())
    params.set('person', id)
    params.set('section', next)
    router.replace(`/persons?${params.toString()}`)
  }, [sp, id, router])

  // ── Core (header) load — seq-guarded; `?person=` can switch in place ───────
  const seqRef = useRef(0)
  const loadCore = useCallback(async () => {
    const seq = ++seqRef.current
    setErr(null)
    try {
      const c = await loadPersonCore(id)
      if (seq === seqRef.current) setCore(c)
    } catch (e) {
      if (seq === seqRef.current) setErr(e instanceof Error ? e.message : String(e))
    }
  }, [id])

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
      case 'overview': apply({ counts: await loadProfileCounts(id) }); break
      case 'relationships': apply({ relations: await loadRelations(id) }); break
      case 'cases': apply({ cases: await loadCasesData(id) }); break
      case 'vehicles': apply({ vehicles: await loadVehiclesData(id) }); break
      case 'locations': apply({ places: await loadPlacesData(id) }); break
      case 'media': apply({ media: await loadMediaRows(id) }); break
      case 'activity': apply({ activity: await loadActivityData(id) }); break
      case 'identity': // person row only — nothing extra to fetch
      case 'legal': // served by the core's slim legal projection
        break
    }
  }, [id])

  // id switch: reset everything, then load the header first. Bumping every
  // section seq invalidates in-flight loads for the previous person so a slow
  // response can never land in the new profile.
  useEffect(() => {
    loadedKey.current = {}
    for (const s of SECTION_IDS) sectionSeq.current[s] = (sectionSeq.current[s] ?? 0) + 1
    const t = window.setTimeout(() => {
      setCore(null)
      setSlices({})
      setImgBroken(false)
      void fetchWatch(); void fetchProfiles(); void loadCore()
    }, 0)
    return () => window.clearTimeout(t)
  }, [loadCore, fetchWatch, fetchProfiles])

  // Realtime bump (never the initial render): refresh the core row.
  const lastRt = useRef(rtKey)
  useEffect(() => {
    if (lastRt.current === rtKey) return
    lastRt.current = rtKey
    void loadCore()
  }, [rtKey, loadCore])

  // Open-section loader: runs on first open and again when realtime moved.
  useEffect(() => {
    if (!core) return
    if (loadedKey.current[section] === rtKey) return
    loadedKey.current[section] = rtKey
    const t = window.setTimeout(() => { void loadSection(section) }, 0)
    return () => window.clearTimeout(t)
  }, [core, section, rtKey, loadSection])

  /** Post-mutation refresh — core + the open section; everything else stale. */
  const refresh = useCallback(() => {
    loadedKey.current = { [section]: rtKey }
    void loadCore()
    void loadSection(section)
  }, [section, rtKey, loadCore, loadSection])

  const p = core?.person ?? null
  const gang = core?.gang ?? null
  const legal = core?.legal ?? NO_LEGAL
  const readOnly = p?.lifecycle === 'merged'
  const mayEdit = canEdit && !readOnly
  const mayDelete = canDelete && !readOnly

  const legalBuckets = useMemo(() => legalStatusOf(legal, today), [legal, today])

  // The full gang list is only needed by the edit modal's picker — fetched on
  // first Edit click, never as part of the profile load.
  const openEdit = useCallback(() => {
    setEditing(true)
    if (!gangsForEdit) {
      void list('gangs', { order: 'name' }).then(setGangsForEdit).catch(() => setGangsForEdit([]))
    }
  }, [gangsForEdit])

  const setLifecycle = async (lifecycle: string, confirmText?: string) => {
    if (!p) return
    if (confirmText && !(await uiConfirm(confirmText, { confirmText: humanize(lifecycle) }))) return
    const res = await update('persons', p.id, { lifecycle })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(`Marked ${humanize(lifecycle)}`, 'success')
    void loadCore()
  }

  const del = async () => {
    if (!p) return
    if (!(await uiConfirm(`Delete person "${p.name}"? This removes the registry record (not any linked officer account).`, { confirmText: 'Delete' }))) return
    const ok = await deleteWithUndo('persons', p, {
      label: `Person "${p.name}"`, noConfirm: true, setNullRefs: PERSON_NULL_REFS,
    })
    if (ok) onBack()
  }

  const exportDocx = async () => {
    if (!p) return
    const d = await gatherPersonDossier(p, gang?.name ?? null)
    downloadDocx(`Person Dossier — ${d.person.name || ''}`, dossierParas(d), `dossier-${slug(d.person.name || 'person')}.docx`)
    toast('Dossier exported (.docx)', 'success')
    setExportOpen(false)
  }
  const exportPdf = async () => {
    if (!p || pdfBusy) return
    setPdfBusy(true)
    try {
      const d = await gatherPersonDossier(p, gang?.name ?? null)
      const { downloadPdf } = await import('@/lib/pdf')
      await downloadPdf(dossierPdfSpec(d), `dossier-${slug(d.person.name || 'person')}.pdf`)
      setExportOpen(false)
    } finally { setPdfBusy(false) }
  }

  const counts = slices.counts

  // Quality warnings → actionable rows: each warning routes to the section or
  // action that fixes it (identity edit, review stamp, BOLO modal, …).
  const warnings: QualityWarningView[] = useMemo(() => {
    if (!p || !counts) return []
    const target: Record<string, () => void> = {
      missing_name: () => setSection('identity'),
      missing_dob: () => setSection('identity'),
      dob_in_future: () => setSection('identity'),
      alias_equals_name: () => setSection('identity'),
      missing_mugshot: () => setSection('media'),
      legacy_properties_unlinked: () => setSection('locations'),
      never_reviewed: () => setReviewOpen(true),
      review_due: () => setReviewOpen(true),
      stale_review: () => setReviewOpen(true),
      bolo_without_reason: () => setBoloOpen(true),
      possible_duplicate: () => setDupOpen(true),
    }
    return personQualityWarnings(p, {
      todayISO: today,
      nowMs: now,
      legacyPropertyCount: parseProperties(p.properties).length,
      linkedPlaceCount: counts.places,
    }).map((w) => ({
      key: w.key,
      message: w.label,
      onFix: mayEdit ? target[w.key] : undefined,
      fixLabel: 'Fix',
    }))
  }, [p, counts, today, now, setSection, mayEdit])

  const activity = useMemo(() => (p ? buildActivity(p, slices.activity) : []), [p, slices.activity])

  const reviewDays = p ? daysSince(p.reviewed_at, now) : null
  const metrics: Metric[] = [
    { label: 'Linked cases', value: counts ? counts.caseLinks : '—', onClick: () => setSection('cases') },
    { label: 'Active legal', value: legalBuckets.activeCount, hint: 'Warrants & requests in force', onClick: () => setSection('legal') },
    { label: 'Vehicles', value: counts ? counts.vehicles : '—', onClick: () => setSection('vehicles') },
    { label: 'Locations', value: counts ? counts.places : '—', onClick: () => setSection('locations') },
    { label: 'Media', value: counts ? counts.media : '—', onClick: () => setSection('media') },
    { label: 'Known associates', value: counts ? counts.relationships : '—', onClick: () => setSection('relationships') },
    { label: 'Days since review', value: reviewDays ?? '—', hint: p?.reviewed_at ? undefined : 'Never reviewed', onClick: () => setSection('activity') },
    {
      label: 'BOLO',
      value: p?.bolo ? humanize(p.bolo_risk || 'active') : 'None',
      tint: p?.bolo ? priorityTint(p.bolo_risk || 'high') : undefined,
      hint: p?.bolo_expires_at ? `Expires ${fmtDate(p.bolo_expires_at)}` : undefined,
      onClick: mayEdit ? () => setBoloOpen(true) : undefined,
    },
  ]

  const tabs: SectionTab<SectionId>[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'identity', label: 'Identity' },
    { id: 'relationships', label: 'Associates', count: counts?.relationships ?? slices.relations?.rows.length },
    { id: 'cases', label: 'Cases', count: counts?.caseLinks ?? slices.cases?.links.length },
    { id: 'legal', label: 'Legal', count: core ? legal.length : undefined, marker: legalBuckets.activeCount > 0, markerLabel: 'Active legal instruments' },
    { id: 'vehicles', label: 'Vehicles', count: counts?.vehicles },
    { id: 'locations', label: 'Locations', count: counts?.places },
    { id: 'media', label: 'Media', count: counts?.media ?? slices.media?.length },
    { id: 'activity', label: 'Activity', marker: !!p && isPersonStale(p.reviewed_at, now), markerLabel: 'Intelligence overdue for review' },
  ]

  const menuItems: ActionItem[] = [
    { label: watching ? 'Unfollow' : 'Follow for updates', icon: watching ? '★' : '☆', onClick: () => { void toggleWatch('person', id, p?.name) } },
    { label: 'Open in network graph', icon: '🕸', onClick: () => router.push(`/network?focus=p:${encodeURIComponent(id)}`) },
    ...(mayEdit ? [
      { label: 'Manage BOLO…', icon: '🚨', onClick: () => setBoloOpen(true), separatorBefore: true },
      { label: 'Link associate…', icon: '👥', onClick: () => { setSection('relationships'); setLinkAssociate(true) } },
      { label: 'Link vehicle…', icon: '🚗', onClick: () => { setSection('vehicles'); setLinkVehicle(true) } },
      { label: 'Link place…', icon: '📍', onClick: () => { setSection('locations'); setLinkPlace({}) } },
    ] : []),
    { label: 'Export dossier…', icon: '📇', onClick: () => setExportOpen(true), separatorBefore: true },
    { label: 'Review duplicates…', icon: '🧬', onClick: () => setDupOpen(true) },
    ...(mayEdit ? [p?.lifecycle === 'archived'
      ? { label: 'Restore to active', icon: '↺', onClick: () => { void setLifecycle('active') }, separatorBefore: true }
      : { label: 'Archive person', icon: '🗄', onClick: () => { void setLifecycle('archived', 'Archive this person? The record stays on file and searchable, marked inactive.') }, separatorBefore: true }] : []),
    ...(mayDelete ? [{ label: 'Delete person', icon: '🗑', danger: true, onClick: () => { void del() }, separatorBefore: !mayEdit }] : []),
  ]

  const mug = p ? safeUrl(p.mugshot_url ?? '') : ''
  const flag = (p?.felony_count || 0) >= 8

  return (
    <section className="view-in space-y-4">
      <Breadcrumbs items={[{ label: 'Persons', onClick: onBack }, { label: p?.name || 'Profile' }]} />

      {err ? (
        <ErrorNotice message={err} onRetry={() => void loadCore()} />
      ) : !p ? (
        <Notice text="Building dossier…" />
      ) : (
        <>
          {/* Merged tombstone — everything below renders read-only. */}
          {readOnly && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4">
              <p className="text-sm text-slate-200">This record was merged and is read-only.</p>
              {p.merged_into && <EntityLink kind="person" id={p.merged_into} label="Open the surviving record" />}
            </div>
          )}

          {/* Intelligence header */}
          <Card pad="lg">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-4">
                {mug && !imgBroken ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- external mugshot CDN */
                  <img src={mug} alt={`${p.name} photo`} onError={() => setImgBroken(true)} className="h-20 w-20 flex-shrink-0 rounded-xl border border-white/10 object-cover" />
                ) : (
                  <div className="grid h-20 w-20 flex-shrink-0 place-items-center rounded-xl bg-ink-700 text-3xl" aria-hidden>👤</div>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-black text-white">
                      {p.name}
                      {flag && <span title="≥8 violent felonies"> 🚨</span>}
                    </h1>
                    {p.alias && <span className="text-sm text-slate-400">&ldquo;{p.alias}&rdquo;</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{p.classification ? classificationLabel(p.classification) : p.status || 'Person of interest'}</Badge>
                    <BoloStateBadge person={p} today={today} />
                    {legalBuckets.activeCount > 0 && (
                      <Badge tone="danger" title="Active legal instruments naming this person">⚖ {legalBuckets.activeCount} active legal</Badge>
                    )}
                    {gang && <EntityLink kind="gang" id={gang.id} label={gang.name} />}
                    {p.confidence && <ConfidenceBadge confidence={p.confidence} />}
                    <StaleIntelBadge reviewedAt={p.reviewed_at} now={now} thresholdDays={PERSON_REVIEW_DAYS} />
                    {p.lifecycle !== 'active' && <Badge tint={statusTint(p.lifecycle)} className="uppercase">{humanize(p.lifecycle)}</Badge>}
                    {p.priority && <Badge tint={priorityTint(p.priority)}>{humanize(p.priority)} priority</Badge>}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    Updated {fmtDate(p.updated_at)}
                    {officerName(p.lead_detective_id) ? ` · Lead ${officerName(p.lead_detective_id)}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {mayEdit && <Button variant="primary" onClick={openEdit}>Edit</Button>}
                {mayEdit && <Button onClick={() => setAttachOpen(true)}>Attach to case</Button>}
                {mayEdit && <Button onClick={() => setSummaryOpen(true)}>Add intelligence</Button>}
                {mayEdit && <Button onClick={() => setAddMedia(true)}>Add media</Button>}
                <ActionMenu items={menuItems} />
              </div>
            </div>
          </Card>

          {/* Sticky section nav */}
          <div className="sticky top-0 z-20 -mx-1 bg-ink-950/80 px-1 py-1 backdrop-blur">
            <SectionTabs<SectionId> tabs={tabs} active={section} onChange={setSection} idBase="person" ariaLabel="Person sections" />
          </div>

          <div id={panelDomId('person', section)} role="tabpanel" aria-labelledby={tabDomId('person', section)}>
            {section === 'overview' && (
              <div className="space-y-4">
                <MetricStrip metrics={metrics} />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <PersonIntelligenceSummary person={p} canEdit={mayEdit} onEdit={() => setSummaryOpen(true)} />
                  </div>
                  <InvestigationStatusCard person={p} now={now} warnings={warnings} canEdit={mayEdit} onMarkReviewed={() => setReviewOpen(true)} />
                </div>
              </div>
            )}
            {section === 'identity' && (
              <IdentitySection person={p} canEdit={mayEdit} onEdit={() => setIdentityOpen(true)} onEditPerson={openEdit} />
            )}
            {section === 'relationships' && (
              slices.relations
                ? <RelationshipsSection personId={p.id} gang={gang} data={slices.relations} canEdit={mayEdit} onLink={() => setLinkAssociate(true)} onRefresh={refresh} />
                : <Notice text="Loading associates…" />
            )}
            {section === 'cases' && (
              slices.cases
                ? <CasesSection data={slices.cases} canEdit={mayEdit} onAttach={() => setAttachOpen(true)} onRefresh={refresh} />
                : <Notice text="Loading cases…" />
            )}
            {section === 'legal' && <LegalSection legal={legal} today={today} now={now} />}
            {section === 'vehicles' && (
              slices.vehicles
                ? <PersonVehiclesSection data={slices.vehicles} canEdit={mayEdit} onLink={() => setLinkVehicle(true)} onRefresh={refresh} />
                : <Notice text="Loading vehicles…" />
            )}
            {section === 'locations' && (
              slices.places
                ? <PersonPlacesSection person={p} data={slices.places} canEdit={mayEdit} onLink={(legacy) => setLinkPlace({ legacy })} onRefresh={refresh} />
                : <Notice text="Loading locations…" />
            )}
            {section === 'media' && (
              slices.media
                ? <PersonMediaSection person={p} media={slices.media} canEdit={mayEdit} onAdd={() => setAddMedia(true)} onOpen={setLightbox} onRefresh={refresh} />
                : <Notice text="Loading media…" />
            )}
            {section === 'activity' && (
              slices.activity
                ? <ActivitySection entries={activity.slice(0, ACTIVITY_CAP)} total={activity.length} reviewedAt={p.reviewed_at} now={now} />
                : <Notice text="Loading activity…" />
            )}
          </div>
        </>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {editing && p && (
        <PersonModal
          record={p}
          gangs={gangsForEdit ?? (gang ? [gang] : [])}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); refresh() }}
        />
      )}
      {identityOpen && p && <IdentityEditorModal person={p} onClose={() => setIdentityOpen(false)} onSaved={() => { setIdentityOpen(false); void loadCore() }} />}
      {summaryOpen && p && <SummaryEditorModal person={p} onClose={() => setSummaryOpen(false)} onSaved={() => { setSummaryOpen(false); void loadCore() }} />}
      {reviewOpen && p && <MarkReviewedModal person={p} onClose={() => setReviewOpen(false)} onSaved={() => { setReviewOpen(false); void loadCore() }} />}
      {attachOpen && p && <AttachPersonModal person={p} onClose={() => setAttachOpen(false)} onSaved={() => { setAttachOpen(false); refresh() }} />}
      {boloOpen && p && <ManageBoloModal person={p} onClose={() => setBoloOpen(false)} onSaved={() => { setBoloOpen(false); void loadCore() }} />}
      {linkAssociate && p && <LinkAssociateModal person={p} onClose={() => setLinkAssociate(false)} onSaved={() => { setLinkAssociate(false); refresh() }} />}
      {linkVehicle && p && (
        <LinkVehicleModal person={p} existing={slices.vehicles?.links ?? []} onClose={() => setLinkVehicle(false)} onSaved={() => { setLinkVehicle(false); refresh() }} />
      )}
      {linkPlace && p && (
        <LinkPersonPlaceModal person={p} existing={slices.places?.links ?? []} legacy={linkPlace.legacy} onClose={() => setLinkPlace(null)} onSaved={() => { setLinkPlace(null); refresh() }} />
      )}
      {addMedia && p && <AddPersonMediaModal person={p} onClose={() => setAddMedia(false)} onSaved={() => { setAddMedia(false); refresh() }} />}
      {dupOpen && p && (
        <PersonDuplicatesModal
          person={p}
          isCommand={isCommand}
          onClose={() => setDupOpen(false)}
          onMerged={(survivorId) => {
            setDupOpen(false)
            router.replace(`/persons?person=${encodeURIComponent(survivorId)}&section=overview`)
          }}
        />
      )}
      {lightbox && <GangPhotoLightbox media={lightbox} onClose={() => setLightbox(null)} />}

      {exportOpen && p && (
        <Modal open onClose={() => setExportOpen(false)}>
          <div className="p-6">
            <ModalHeader title="Export Person Dossier" onClose={() => setExportOpen(false)} />
            <p className="mb-4 text-sm text-slate-400">
              Compiles the full profile — identity, gang ties, legal instruments, properties, vehicles, linked cases, evidence &amp; media (only what you can access).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => void exportDocx()} className="rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-sm font-semibold text-white transition hover:bg-white/10">📄<br />.docx</button>
              <button onClick={() => void exportPdf()} disabled={pdfBusy} className="rounded-lg border border-white/10 bg-white/5 px-3 py-4 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60">📕<br />{pdfBusy ? 'Rendering…' : '.pdf'}</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
