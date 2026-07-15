'use client'

import type { Database, Tables } from '@/lib/database.types'

export type GangRow = Tables<'gangs'>
export type MemberRow = Tables<'gang_members'>
export type TurfRow = Tables<'gang_turf'>
export type GangPlaceRow = Tables<'gang_places'>
export type PersonRow = Tables<'persons'>
export type PlaceRow = Tables<'places'>
export type VehicleRow = Tables<'vehicles'>
export type MediaRow = Tables<'media'>
export type CaseOption = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title'>
export type CaseRow = Tables<'cases'>
export type IntelLinkRow = Tables<'case_intel_links'>
export type ThreatLevel = Database['public']['Enums']['threat_level']
export type Density = Database['public']['Enums']['density']

/** A place linked to a gang, whether via the legacy scalar
 *  places.controlling_gang_id or the new gang_places link table. `link` carries
 *  the role/confidence/provenance when it came through gang_places. */
export interface LinkedPlace {
  place: PlaceRow
  link: GangPlaceRow | null
  /** 'controlling' = places.controlling_gang_id; 'linked' = gang_places row. */
  via: 'controlling' | 'linked'
}

export const PAGE = 24
export const RANK_SUGGEST = ['Shot Caller', 'OG', 'Lieutenant', 'Enforcer', 'Soldier', 'Associate', 'Prospect']

export const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Medium')

export const densityTint = (d: string | null | undefined) => {
  if (d === 'high') return 'bg-rose-500/15 text-rose-300'
  if (d === 'medium') return 'bg-amber-500/15 text-amber-300'
  return 'bg-emerald-500/15 text-emerald-300'
}

export const GANG_DELETE_CHILDREN = [
  { table: 'gang_members' as const, column: 'gang_id' },
  { table: 'gang_ranks' as const, column: 'gang_id' },
  { table: 'gang_turf' as const, column: 'gang_id' },
]

export const GANG_NULL_REFS = [{ table: 'persons' as const, column: 'gang_id' }]
