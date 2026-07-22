import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { PAGE_META } from '@/lib/nav'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'
import { CasesView } from '@/components/cases/CasesView'
import { CommandView } from '@/components/command/CommandView'
import { OperationsView } from '@/components/operations/OperationsView'
import { InboxView } from '@/components/inbox/InboxView'
import { ActionCenterView } from '@/components/actioncenter/ActionCenterView'
import { PersonnelView } from '@/components/personnel/PersonnelView'
import { AnnounceView } from '@/components/announce/AnnounceView'
import { PersonsView } from '@/components/persons/PersonsView'
import { GangsView } from '@/components/gangs/GangsView'
import { BoloView } from '@/components/bolo/BoloView'
import { PlacesView } from '@/components/places/PlacesView'
import { VehiclesView } from '@/components/vehicles/VehiclesView'
import { AccountsView } from '@/components/accounts/AccountsView'
import { PenalView } from '@/components/penal/PenalView'
import { RecordsView } from '@/components/records/RecordsView'
import { ShiftsView } from '@/components/shifts/ShiftsView'
import { MediaView } from '@/components/media/MediaView'
import { CaseFilesView } from '@/components/casefiles/CaseFilesView'
import { SopsView } from '@/components/sops/SopsView'
import { GuideView } from '@/components/guide/GuideView'
import { CalendarView } from '@/components/calendar/CalendarView'
import { AnalyticsView } from '@/components/analytics/AnalyticsView'
import { IndicatorsView } from '@/components/indicators/IndicatorsView'
import { ProfileView } from '@/components/profile/ProfileView'
import { CommandCenterView } from '@/components/command-center/CommandCenterView'
import { LegalView } from '@/components/legal/LegalView'
// Long-tail screens are code-split (client dynamic wrappers, ssr off) so the
// heavy/rare views — owner tooling, the handbook, chart-heavy analysis tabs —
// stay out of the page chunk every route shares. Hot paths stay static above.
import {
  AuditView, BallisticsView, DevDocsView, FeedbackView, HeatmapView,
  ModusView, NarcoticsView, NetworkView, OwnerView, RicoView,
} from './lazyViews'

/** One route per leaf tab, statically prerendered via generateStaticParams. */

export function generateStaticParams() {
  return Object.keys(PAGE_META).map((tab) => ({ tab }))
}

export default async function TabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params
  // Vanilla navigate() fallbacks: the legacy reports leaf folded into cases;
  // anything unknown falls back to command.
  if (tab === 'reports') redirect('/cases')
  if (!(tab in PAGE_META)) redirect('/command')
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
  if (tab === 'persons') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="persons" />}>
        <PersonsView />
      </Suspense>
    )
  }
  if (tab === 'gangs') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="gangs" />}>
        <GangsView />
      </Suspense>
    )
  }
  if (tab === 'bolo') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="bolo" />}>
        <BoloView />
      </Suspense>
    )
  }
  if (tab === 'places') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="places" />}>
        <PlacesView />
      </Suspense>
    )
  }
  if (tab === 'vehicles') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="vehicles" />}>
        <VehiclesView />
      </Suspense>
    )
  }
  if (tab === 'accounts') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="accounts" />}>
        <AccountsView />
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
  if (tab === 'records') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="records" />}>
        <RecordsView />
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
  if (tab === 'narcotics') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="narcotics" />}>
        <NarcoticsView />
      </Suspense>
    )
  }
  if (tab === 'ballistics') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="ballistics" />}>
        <BallisticsView />
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
  if (tab === 'network') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="network" />}>
        <NetworkView />
      </Suspense>
    )
  }
  if (tab === 'modus') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="modus" />}>
        <ModusView />
      </Suspense>
    )
  }
  if (tab === 'media') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="media" />}>
        <MediaView />
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
  if (tab === 'indicators') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="indicators" />}>
        <IndicatorsView />
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
  if (tab === 'legal') {
    return (
      <Suspense fallback={<ViewPlaceholder tab="legal" />}>
        <LegalView />
      </Suspense>
    )
  }
  return <ViewPlaceholder tab={tab} />
}
