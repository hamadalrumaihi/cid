import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { PAGE_META } from '@/lib/nav'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'
import { CasesView } from '@/components/cases/CasesView'
import { CommandView } from '@/components/command/CommandView'
import { OperationsView } from '@/components/operations/OperationsView'
import { InboxView } from '@/components/inbox/InboxView'
import { PersonnelView } from '@/components/personnel/PersonnelView'
import { AnnounceView } from '@/components/announce/AnnounceView'
import { PersonsView } from '@/components/persons/PersonsView'
import { GangsView } from '@/components/gangs/GangsView'
import { BoloView } from '@/components/bolo/BoloView'
import { PlacesView } from '@/components/places/PlacesView'
import { VehiclesView } from '@/components/vehicles/VehiclesView'
import { PenalView } from '@/components/penal/PenalView'
import { RecordsView } from '@/components/records/RecordsView'

/** One route per leaf tab. Placeholder views are replaced slice-by-slice as
 *  each vanilla view is ported (see docs/REACT-PARITY.md for the order). */

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
  return <ViewPlaceholder tab={tab} />
}
