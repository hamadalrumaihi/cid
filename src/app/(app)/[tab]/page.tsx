import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { PAGE_META } from '@/lib/nav'
import { TOOL_TABS } from '@/lib/toolsModel'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'
import { ToolTabRedirect } from '@/components/tools/ToolTabRedirect'
import { CasesView } from '@/components/cases/CasesView'
import { CommandView } from '@/components/command/CommandView'
import { OperationsView } from '@/components/operations/OperationsView'
import { InboxView } from '@/components/inbox/InboxView'
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
// The 14 Intelligence tool views moved into the Investigative Tools workspace
// (components/tools/toolRegistry); their routes below redirect into /tools.
import {
  AuditView, ConcernView, DevDocsView, FeedbackView, HeatmapView,
  OwnerView, RicoView, SiuView, ToolsView,
} from './lazyViews'

/** One route per leaf tab, statically prerendered via generateStaticParams. */

export function generateStaticParams() {
  return Object.keys(PAGE_META).map((tab) => ({ tab }))
}

export default async function TabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params
  // Vanilla navigate() fallbacks: the legacy reports leaf folded into cases;
  // anything unknown falls back to My Dashboard (the default landing).
  if (tab === 'reports') redirect('/cases')
  if (!(tab in PAGE_META)) redirect('/inbox')
  // Legacy Intelligence tool routes → the Investigative Tools workspace. The
  // routes stay prerendered and valid (deep links, bookmarks, notifications,
  // case cross-links); a tiny client shim maps their query params onto
  // /tools?tool=…&record=… and router.replaces.
  if ((TOOL_TABS as readonly string[]).includes(tab)) {
    return <ToolTabRedirect tab={tab} />
  }
  if (tab === 'tools') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="tools" />}>
        <ToolsView />
      </Suspense>
    )
  }
  if (tab === 'command') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="command" />}>
        <CommandView />
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
  if (tab === 'inbox') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="inbox" />}>
        <InboxView />
      </Suspense>
    )
  }
  if (tab === 'action') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="action" />}>
        <ActionCenterView />
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
  if (tab === 'feedback') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="feedback" />}>
        <FeedbackView />
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
  if (tab === 'legal') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="legal" />}>
        <LegalView />
      </Suspense>
    )
  }
  return <ViewPlaceholder tab={tab} />
}
