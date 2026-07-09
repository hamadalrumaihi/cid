'use client'

import type { Database, Tables } from '@/lib/database.types'

export type GangRow = Tables<'gangs'>
export type MemberRow = Tables<'gang_members'>
export type TurfRow = Tables<'gang_turf'>
export type PersonRow = Tables<'persons'>
export type PlaceRow = Tables<'places'>
export type CaseOption = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title'>
export type ThreatLevel = Database['public']['Enums']['threat_level']
export type Density = Database['public']['Enums']['density']

export const PAGE = 24
export const RANK_SUGGEST = ['Shot Caller', 'OG', 'Lieutenant', 'Enforcer', 'Soldier', 'Associate', 'Prospect']

export const cap = (s: string | null | undefined) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Medium')

export const threatTint = (t: string | null | undefined) => {
  if (t === 'high') return 'border-rose-500/30 bg-rose-500/10 text-rose-300'
  if (t === 'medium') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
}

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
