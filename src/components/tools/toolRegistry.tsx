'use client'

/** Lazy component registry for the Investigative Tools workspace. Every list
 *  view (and the record profile components that cleanly exist) is code-split
 *  with next/dynamic (ssr off, ViewPlaceholder fallback — the lazyViews
 *  pattern) so /tools ships light and each tool's chunk loads on first open.
 *  These imports moved OUT of the [tab] page — the old routes now redirect
 *  here instead of rendering the views, so nothing is double-shipped. */
import dynamic from 'next/dynamic'
import type { ToolId } from '@/lib/toolsModel'
import { ViewPlaceholder } from '@/components/ViewPlaceholder'

const lazy = (tab: string, load: () => Promise<React.ComponentType>) =>
  dynamic(load, { ssr: false, loading: () => <ViewPlaceholder tab={tab} /> })

export const TOOL_LIST_COMPONENT: Record<ToolId, React.ComponentType> = {
  persons: lazy('persons', () => import('@/components/persons/PersonsView').then((m) => m.PersonsView)),
  bolo: lazy('bolo', () => import('@/components/bolo/BoloView').then((m) => m.BoloView)),
  gangs: lazy('gangs', () => import('@/components/gangs/GangsView').then((m) => m.GangsView)),
  places: lazy('places', () => import('@/components/places/PlacesView').then((m) => m.PlacesView)),
  vehicles: lazy('vehicles', () => import('@/components/vehicles/VehiclesView').then((m) => m.VehiclesView)),
  accounts: lazy('accounts', () => import('@/components/accounts/AccountsView').then((m) => m.AccountsView)),
  indicators: lazy('indicators', () => import('@/components/indicators/IndicatorsView').then((m) => m.IndicatorsView)),
  'field-review': lazy('field-review', () => import('@/components/field/FieldReviewView').then((m) => m.FieldReviewView)),
  network: lazy('network', () => import('@/components/network/NetworkView').then((m) => m.NetworkView)),
  narcotics: lazy('narcotics', () => import('@/components/narcotics/NarcoticsView').then((m) => m.NarcoticsView)),
  ballistics: lazy('ballistics', () => import('@/components/ballistics/BallisticsView').then((m) => m.BallisticsView)),
  modus: lazy('modus', () => import('@/components/modus/ModusView').then((m) => m.ModusView)),
  media: lazy('media', () => import('@/components/media/MediaView').then((m) => m.MediaView)),
  records: lazy('records', () => import('@/components/records/RecordsView').then((m) => m.RecordsView)),
}

export interface RecordComponentProps {
  id: string
  onBack: () => void
}

/** Standalone record profiles with a clean `{ id, onBack }` contract. Tools
 *  absent here don't get workspace record tabs (their list views keep their
 *  own inline detail handling — e.g. Places has no dossier view at all, its
 *  `?place=` only seeds the list filter). Gangs load through GangRecordTab (a
 *  thin wrapper that fetches the row + case options GangDossier needs);
 *  narcotics adapts NarcoticsDossier's `{ drugId, onClose }` props inline. */
export const TOOL_RECORD_COMPONENT: Partial<Record<ToolId, React.ComponentType<RecordComponentProps>>> = {
  persons: dynamic<RecordComponentProps>(
    () => import('@/components/persons/PersonProfile').then((m) => m.PersonProfile),
    { ssr: false, loading: () => <ViewPlaceholder tab="persons" /> },
  ),
  vehicles: dynamic<RecordComponentProps>(
    () => import('@/components/vehicles/VehicleProfile').then((m) => m.VehicleProfile),
    { ssr: false, loading: () => <ViewPlaceholder tab="vehicles" /> },
  ),
  gangs: dynamic<RecordComponentProps>(
    () => import('@/components/gangs/GangRecordTab').then((m) => m.GangRecordTab),
    { ssr: false, loading: () => <ViewPlaceholder tab="gangs" /> },
  ),
  narcotics: dynamic<RecordComponentProps>(
    () => import('@/components/narcotics/NarcoticsDossier').then((m) => {
      const Dossier = m.NarcoticsDossier
      function NarcoticsRecordTab({ id, onBack }: RecordComponentProps) {
        return <Dossier drugId={id} onClose={onBack} />
      }
      return NarcoticsRecordTab
    }),
    { ssr: false, loading: () => <ViewPlaceholder tab="narcotics" /> },
  ),
}
