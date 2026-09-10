import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { LEGACY_REDIRECT_TABS, PAGE_META } from '@/lib/nav'
import { TOOL_TABS } from '@/lib/toolsModel'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'
import { ToolTabRedirect } from '@/components/tools/ToolTabRedirect'
import { LegacyRedirect } from './LegacyRedirect'
import { CasesView } from '@/components/cases/CasesView'
import { OperationsView } from '@/components/operations/OperationsView'
import { MyDashboardView } from '@/components/dashboard/MyDashboardView'
import { ActionCenterView } from '@/components/actioncenter/ActionCenterView'
import { PersonnelView } from '@/components/personnel/PersonnelView'
import { AnnounceView } from '@/components/announce/AnnounceView'
import { PenalView } from '@/components/penal/PenalView'
import { ShiftsView } from '@/components/shifts/ShiftsView'
import { CaseFilesView } from '@/components/casefiles/CaseFilesView'
import { SopsView } from '@/components/sops/SopsView'
import { GuideView } from '@/components/guide/GuideView'
import { CalendarView } from '@/components/calendar/CalendarView'
import { AnalyticsView } from '@/components/analytics/AnalyticsView'
import { ProfileView } from '@/components/profile/ProfileView'
import { CommandCenterView } from '@/components/command-center/CommandCenterView'
import { LegalView } from '@/components/legal/LegalView'
// Long-tail screens are code-split (client dynamic wrappers, ssr off) so the
// heavy/rare views — owner tooling, the handbook, chart-heavy analysis tabs —
// stay out of the page chunk every route shares. Hot paths stay static above.
// The 14 Intelligence tool views live inside the unified workspace
// (components/tools/toolRegistry); their routes below redirect into /workspace.
import {
  AuditView, InformantsView, ConcernView, DevDocsView, FeedbackView, HeatmapView,
  OwnerView, ReportTemplatesView, RicoView, SiuView, TrashView, WorkspaceView,
} from './lazyViews'

/** One route per leaf tab, statically prerendered via generateStaticParams.
 *  The legacy ids are prerendered too (bookmarks stay warm) but carry no
 *  PAGE_META — each renders a redirect below. */

export function generateStaticParams() {
  return [...Object.keys(PAGE_META), ...LEGACY_REDIRECT_TABS].map((tab) => ({ tab }))
}

export default async function TabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params
  // Legacy addresses (LEGACY_REDIRECT_TABS). The reports leaf folded into
  // cases long ago; anything unknown falls back to the Action Center (the
  // default landing).
  if (tab === 'reports') redirect('/cases')
  if (!(tab in PAGE_META) && !LEGACY_REDIRECT_TABS.includes(tab)) redirect('/inbox')
  // /action was the Action Center's old address — it IS /inbox now; /command
  // (the Division Overview) folded into the Command Center. Client shims so
  // the query string (`?preset=`, `?f=`, `?s=`) rides along.
  if (tab === 'action') return <LegacyRedirect to="/inbox" />
  if (tab === 'command') return <LegacyRedirect to="/command-center" />
  // Legacy Intelligence tool routes → the unified workspace. The routes stay
  // prerendered and valid (deep links, bookmarks, notifications, case
  // cross-links); a tiny client shim maps their query params onto
  // /workspace?tool=…&record=… and router.replaces.
  if ((TOOL_TABS as readonly string[]).includes(tab)) {
    return <ToolTabRedirect tab={tab} />
  }
  // /workspace is the unified workspace; /tools (the tools-era address) renders
  // the same view and the provider rewrites its URL, so `/tools?tool=persons`
  // still lands on the persons tab.
  if (tab === 'workspace' || tab === 'tools') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="workspace" />}>
        <WorkspaceView />
      </Suspense>
    )
  }
  // The Investigations leaves that open the workspace on a default tool:
  // everything that comes into CID as information, and the shared registries.
  // The provider mirrors the active tab back onto /workspace?tool=… exactly
  // as it does for /tools, so the workspace itself is untouched.
  if (tab === 'intelligence') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="intelligence" />}>
        <WorkspaceView defaultTool="field-review" />
      </Suspense>
    )
  }
  if (tab === 'registries') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="registries" />}>
        <WorkspaceView defaultTool="persons" />
      </Suspense>
    )
  }
  if (tab === 'cases') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="cases" />}>
        <CasesView />
      </Suspense>
    )
  }
  if (tab === 'operations') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="operations" />}>
        <OperationsView />
      </Suspense>
    )
  }
  // The Action Center is the personal home (/inbox). ActionCenterView applies
  // the viewer's role preset when the URL names none, and opens the Activity
  // lane on `?lane=activity` (the bell's View All).
  if (tab === 'inbox') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="inbox" />}>
        <ActionCenterView />
      </Suspense>
    )
  }
  if (tab === 'dashboard') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="dashboard" />}>
        <MyDashboardView />
      </Suspense>
    )
  }
  if (tab === 'personnel') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="personnel" />}>
        <PersonnelView />
      </Suspense>
    )
  }
  if (tab === 'announce') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="announce" />}>
        <AnnounceView />
      </Suspense>
    )
  }
  if (tab === 'penal') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="penal" />}>
        <PenalView />
      </Suspense>
    )
  }
  if (tab === 'shifts') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="shifts" />}>
        <ShiftsView />
      </Suspense>
    )
  }
  if (tab === 'audit') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="audit" />}>
        <AuditView />
      </Suspense>
    )
  }
  if (tab === 'trash') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="trash" />}>
        <TrashView />
      </Suspense>
    )
  }
  if (tab === 'feedback') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="feedback" />}>
        <FeedbackView />
      </Suspense>
    )
  }
  if (tab === 'informants') {
    // The compartment's only route. It resolves for everyone; InformantsView
    // renders the ordinary nothing-here surface unless ci_context() says the
    // account has full CI access or handles a source, and every read behind
    // it is RLS-gated (private.can_access_ci). A 404 or a placeholder carrying
    // the page title would itself confirm that a restricted area exists.
    return (
      <Suspense fallback={<div className="view-in" aria-hidden />}>
        <InformantsView />
      </Suspense>
    )
  }
  if (tab === 'concern') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="concern" />}>
        <ConcernView />
      </Suspense>
    )
  }
  if (tab === 'rico') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="rico" />}>
        <RicoView />
      </Suspense>
    )
  }
  if (tab === 'heatmap') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="heatmap" />}>
        <HeatmapView />
      </Suspense>
    )
  }
  if (tab === 'case-files') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="case-files" />}>
        <CaseFilesView />
      </Suspense>
    )
  }
  if (tab === 'sops') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="sops" />}>
        <SopsView />
      </Suspense>
    )
  }
  if (tab === 'guide') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="guide" />}>
        <GuideView />
      </Suspense>
    )
  }
  if (tab === 'calendar') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="calendar" />}>
        <CalendarView />
      </Suspense>
    )
  }
  if (tab === 'analytics') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="analytics" />}>
        <AnalyticsView />
      </Suspense>
    )
  }
  if (tab === 'devdocs') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="devdocs" />}>
        <DevDocsView />
      </Suspense>
    )
  }
  if (tab === 'owner') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="owner" />}>
        <OwnerView />
      </Suspense>
    )
  }
  if (tab === 'profile') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="profile" />}>
        <ProfileView />
      </Suspense>
    )
  }
  if (tab === 'command-center') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="command-center" />}>
        <CommandCenterView />
      </Suspense>
    )
  }
  if (tab === 'siu') {
    // The route resolves for everyone; SiuView renders the ordinary
    // nothing-here surface unless the account holds SIU standing, and every
    // read behind it is RLS-gated. A dedicated 404 would itself confirm that a
    // restricted area exists.
    return (
      <Suspense fallback={<ViewPlaceholder tab="siu" />}>
        <SiuView />
      </Suspense>
    )
  }
  if (tab === 'report-templates') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="report-templates" />}>
        <ReportTemplatesView />
      </Suspense>
    )
  }
  if (tab === 'legal') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="legal" />}>
        <LegalView />
      </Suspense>
    )
  }
  return <ViewPlaceholder tab={tab} />
}
