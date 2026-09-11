'use client'

/** The phone-first case screen (plan §5.5 / §8.2, P8-01): `/m/cases/<id>?s=<section>`.
 *
 *  One projected read of the case row under RLS; the P3-07 states when it
 *  does not resolve (MissingCaseState — missing / deleted / restricted /
 *  access ended, verbatim from the workspace); a compact header (case
 *  number, title, status, bureau, lead); a FIXED bottom section switcher
 *  (CaseSectionSwitcher over the CASE_TABS registry, phone sections only)
 *  and one card stack per section. The quick actions (task add / done, note
 *  add, entity link) make exactly the writes the desktop sections make;
 *  everything else is an "Open on desktop" link into the workspace.
 *
 *  Section switching is local state mirrored to `?s=` through the native
 *  history API (CaseDetail's idiom — a query-only router navigation reverts
 *  in some serving environments); a real navigation (deep link) still wins. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { list, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useSiu } from '@/lib/permissions'
import { normalizeCaseTab } from '@/lib/caseLinks'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { bureauShort } from '@/lib/roles'
import { priorityTint } from '@/lib/tint'
import { toast } from '@/lib/toast'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
import { Badge } from '@/components/ui/Badge'
import { Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { DetailSkeleton } from '@/components/ui/Skeleton'
import { StatusBadge } from '@/components/ui/StatusBadge'
import type { SectionTab } from '@/components/ui/SectionTabs'
import { ChevronIcon } from '@/components/shell/icons'
import { CaseSectionSwitcher } from '@/components/cases/CaseSectionSwitcher'
import { CASE_TAB_GROUPS, CASE_TAB_LABELS, type CaseTabId } from '@/components/cases/caseTabs'
import { MissingCaseState } from '@/components/cases/states/MissingCaseState'
import { MOBILE_CASE_SECTIONS, isCaseTab, isMobileCaseSection, mobileCaseHref, type MobileCaseSection } from './mobileCaseRoute'
import { DesktopOnlyCard, MOBILE_CASE_SELECT, OpenOnDesktop, type MobileCase } from './mobileShared'
import { MobileActivity } from './MobileActivity'
import { MobileEntities } from './MobileEntities'
import { MobileDocuments } from './MobileDocuments'
import { MobileEvidence } from './MobileEvidence'
import { MobileNotes } from './MobileNotes'
import { MobileOverview } from './MobileOverview'
import { MobileReports } from './MobileReports'
import { MobileTasks } from './MobileTasks'

const SECTION_TABS: ReadonlyArray<SectionTab<MobileCaseSection>> =
  MOBILE_CASE_SECTIONS.map((id) => ({ id, label: CASE_TAB_LABELS[id] }))

export function MobileCaseView() {
  const params = useParams<{ id: string }>()
  const id = params?.id ?? ''
  const sp = useSearchParams()
  const { profile, canEdit: authCanEdit } = useAuth()
  const siu = useSiu()
  const rosterLoaded = useProfilesStore((s) => s.loaded)
  const fetchRoster = useProfilesStore((s) => s.fetch)
  useEffect(() => { if (!rosterLoaded) void fetchRoster() }, [rosterLoaded, fetchRoster])

  // `?s=` — legacy ids normalise (tab=evidence → media); anything outside the
  // registry lands on the brief.
  const requested = normalizeCaseTab(sp.get('s'))
  const urlSection: CaseTabId = isCaseTab(requested) ? requested : 'overview'
  const [override, setOverride] = useState<CaseTabId | null>(null)
  const [adoptedKey, setAdoptedKey] = useState(`${id}:${urlSection}`)
  if (adoptedKey !== `${id}:${urlSection}`) {
    // Render-phase adjustment: a URL-driven change is a real navigation and
    // supersedes the local override (CaseDetail's adoptedKey idiom).
    setAdoptedKey(`${id}:${urlSection}`)
    setOverride(null)
  }
  const section = override ?? urlSection
  const setSection = (next: CaseTabId) => {
    setOverride(next)
    window.history.replaceState(window.history.state, '', mobileCaseHref(id, next))
    window.scrollTo({ top: 0 })
  }

  // ── The case row ───────────────────────────────────────────────────────
  const [c, setCase] = useState<MobileCase | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [everLoadedId, setEverLoadedId] = useState<string | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const loadedIdRef = useRef<string | null>(null)
  const casesV = useTableVersion('cases')
  const fetchCase = useCallback(async () => {
    if (!id) return
    // A malformed segment never reaches the database (a non-uuid would surface
    // Postgres' own 22P02 text); it renders as a missing case instead.
    if (!UUID_RE.test(id)) { setCase(null); setError(null); setLoading(false); loadedIdRef.current = id; return }
    if (loadedIdRef.current !== id) setLoading(true) // stale-while-revalidate after the first load
    try {
      const rows = await withRetry(() => list('cases', { select: MOBILE_CASE_SELECT, eq: { id }, limit: 1 }))
      setCase(rows[0] ?? null)
      setError(null)
      loadedIdRef.current = id
      if (rows[0]) setEverLoadedId(id)
    } catch (e) {
      setError(e)
      toast(e instanceof Error ? e.message : e, 'danger')
    } finally {
      setLoading(false)
    }
  }, [id])
  useEffect(() => { queueMicrotask(() => { void fetchCase() }) }, [fetchCase, casesV, retryTick])

  // Write gate — the same narrowing CaseDetail applies: an archived case and
  // a cross-department read are refused by RLS (zero rows, not an error), so
  // the editors must not appear to save. Cosmetic; the server decides.
  const canEdit = !!c && authCanEdit && !siu.caseReadOnly(c) && !c.archived_at
  const sectionLabel = CASE_TAB_LABELS[section]
  const tabs = useMemo(
    () => (isMobileCaseSection(section) ? SECTION_TABS : [...SECTION_TABS, { id: section, label: sectionLabel }]),
    [section, sectionLabel],
  )

  let body: React.ReactNode
  if (!id) body = <Notice text="Case not found." />
  else if (loading) body = <DetailSkeleton />
  else if (!c) body = <MissingCaseState caseId={id} everLoaded={everLoadedId === id} error={error} retry={() => setRetryTick((n) => n + 1)} />
  else body = (
    <>
      <PageHeader
        title={c.title || c.case_number}
        subtitle={[bureauShort(c.bureau), `Lead: ${officerName(c.lead_detective_id) || 'Unassigned'}`].join(' · ')}
        actions={(
          <>
            <StatusBadge domain="case" value={c.status} className="uppercase" />
            {c.priority && <Badge tint={priorityTint(c.priority)} className="uppercase">{c.priority}</Badge>}
          </>
        )}
      />
      {c.archived_at && <Notice text="This case is archived — read-only. Command can restore it from the desktop." />}
      {!c.archived_at && !canEdit && authCanEdit && <Notice text="Read-only for your department — nothing here can be changed." />}
      <section aria-label={sectionLabel} className="space-y-3">
        <h2 className="sr-only">{sectionLabel}</h2>
        {section === 'overview' && <MobileOverview c={c} />}
        {section === 'tasks' && <MobileTasks c={c} canEdit={canEdit} />}
        {section === 'notes' && <MobileNotes c={c} canEdit={canEdit} viewerId={profile?.id ?? null} />}
        {section === 'people' && <MobileEntities c={c} kind="person" canEdit={canEdit} />}
        {section === 'vehicles' && <MobileEntities c={c} kind="vehicle" canEdit={canEdit} />}
        {section === 'gangs' && <MobileEntities c={c} kind="gang" canEdit={canEdit} />}
        {section === 'locations' && <MobileEntities c={c} kind="place" canEdit={canEdit} />}
        {section === 'media' && <MobileEvidence c={c} />}
        {section === 'documents' && <MobileDocuments c={c} canEdit={canEdit} />}
        {section === 'reports' && <MobileReports c={c} canEdit={canEdit} viewerId={profile?.id ?? null} />}
        {section === 'activity' && <MobileActivity c={c} />}
        {!isMobileCaseSection(section) && (
          <DesktopOnlyCard caseId={c.id} section={section} title={`${sectionLabel} is a desktop section`} hint="Open the case in the workspace to work on it." />
        )}
      </section>
    </>
  )

  return (
    <div className="min-h-screen">
      {/* Top bar — back, the case number, the desktop link. 44 px targets. */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-950/90 backdrop-blur-xl">
        <div className="safe-x flex min-h-14 items-center gap-1 px-1">
          <Link href="/cases" aria-label="Back to cases" className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-lg text-slate-300 transition hover:bg-white/5 hover:text-white">
            <ChevronIcon dir="left" />
          </Link>
          <span className="min-w-0 flex-1 truncate font-mono text-sm font-semibold text-white" data-testid="mobile-case-number">
            {c?.case_number ?? (loading ? '…' : 'Case')}
          </span>
          {id && <OpenOnDesktop caseId={id} section={section} look="ghost" className="flex-shrink-0" />}
        </div>
      </header>

      <div className="safe-x space-y-4 px-4 pb-[calc(var(--bottom-nav-h,0rem)+5.5rem)] pt-4">
        {body}
      </div>

      {/* Bottom switcher — above the mobile BottomNav (+ home indicator). */}
      {c && (
        <div
          className="safe-x fixed inset-x-0 z-30 border-t border-white/10 bg-ink-950/90 px-3 py-2 backdrop-blur-xl"
          style={{ bottom: 'calc(var(--bottom-nav-h, 0rem) + env(safe-area-inset-bottom, 0px))' }}
        >
          <CaseSectionSwitcher<CaseTabId> tabs={tabs} groups={CASE_TAB_GROUPS} active={section} onChange={setSection} ariaLabel="Case sections" />
        </div>
      )}
    </div>
  )
}
