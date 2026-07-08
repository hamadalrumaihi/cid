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
  return <ViewPlaceholder tab={tab} />
}
