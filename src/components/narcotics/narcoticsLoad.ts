'use client'

/** Per-section data loaders for the Narcotics dossier (NarcoticsDossier).
 *  Mirrors the persons/profileLoad template: the header renders off ONE
 *  narcotics fetch (+ aliases + the representative media row); every section
 *  then lazy-loads its own slice on first open. All auxiliary queries are
 *  RLS-scoped and degrade to []/0 on failure — only the primary narcotic
 *  lookup stays unwrapped so a transient failure reports its real message
 *  instead of masquerading as "not found". Cases the caller can't see under
 *  RLS simply don't resolve (rendered as restricted stubs), never leaked. */
import type { Tables } from '@/lib/database.types'
import { countRows, list } from '@/lib/db'
import type { NarcoticRow } from './narcoticsDossier'

export type AliasRow = Tables<'narcotic_aliases'>
export type SeizureRow = Tables<'narcotic_seizures'>
export type NarcoticPlaceRow = Tables<'narcotic_places'>
export type NarcoticPersonRow = Tables<'narcotic_persons'>
export type NarcoticGangRow = Tables<'narcotic_gangs'>
export type IntelLinkRow = Tables<'case_intel_links'>
export type MediaRow = Tables<'media'>
export type SaleSeriesRow = Tables<'narcotic_sale_series'>
export type SaleObservationRow = Tables<'narcotic_sale_observations'>
export type SaleStackRow = Tables<'narcotic_sale_stacks'>

export const CASE_COLS = 'id,case_number,title,status,bureau,updated_at,lead_detective_id'
export type CaseLite = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title' | 'status' | 'bureau' | 'updated_at' | 'lead_detective_id'>

export const PLACE_COLS = 'id,name,type,area'
export type PlaceLite = Pick<Tables<'places'>, 'id' | 'name' | 'type' | 'area'>

export const PERSON_COLS = 'id,name,alias,lifecycle'
export type PersonLite = Pick<Tables<'persons'>, 'id' | 'name' | 'alias' | 'lifecycle'>

export const GANG_COLS = 'id,name'
export type GangLite = Pick<Tables<'gangs'>, 'id' | 'name'>

export const EVIDENCE_COLS = 'id,item_code,type,case_id'
export type EvidenceLite = Pick<Tables<'evidence'>, 'id' | 'item_code' | 'type' | 'case_id'>

const opt = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[])
const uniq = <T,>(arr: T[]): T[] => [...new Set(arr)]
const notNull = <T,>(x: T | null | undefined): x is T => x != null
const byCreatedDesc = (a: { created_at: string }, b: { created_at: string }) =>
  (b.created_at || '').localeCompare(a.created_at || '')

// ── Core (header) — one narcotics fetch + aliases + representative media ─────
export interface NarcoticCore {
  narcotic: NarcoticRow
  aliases: AliasRow[]
  representative: MediaRow | null
}

export async function loadNarcoticCore(id: string): Promise<NarcoticCore> {
  const rows = await list('narcotics', { eq: { id } })
  const narcotic = rows[0]
  if (!narcotic) throw new Error('Narcotic not found')
  const [aliases, media] = await Promise.all([
    opt(list('narcotic_aliases', { eq: { narcotic_id: id }, order: 'alias' })),
    narcotic.representative_media_id
      ? opt(list('media', { eq: { id: narcotic.representative_media_id } }))
      : Promise.resolve([] as MediaRow[]),
  ])
  return { narcotic, aliases, representative: media[0] ?? null }
}

// ── Overview counts — HEAD counts only, never row fetches ────────────────────
export interface NarcoticCounts {
  caseLinks: number
  seizures: number
  places: number
  people: number
  media: number
  /** Restricted sale observations — 0 (and the tab hidden) for members who
   *  can't see restricted intelligence, since RLS returns no rows. */
  sales: number
}

export async function loadCounts(id: string): Promise<NarcoticCounts> {
  const c = (p: Promise<number>) => p.catch(() => 0)
  const [links, seizures, places, persons, gangs, media, sales] = await Promise.all([
    c(countRows('case_intel_links', { eq: { kind: 'narcotic', ref_id: id } })),
    c(countRows('narcotic_seizures', { eq: { narcotic_id: id } })),
    c(countRows('narcotic_places', { eq: { narcotic_id: id } })),
    c(countRows('narcotic_persons', { eq: { narcotic_id: id } })),
    c(countRows('narcotic_gangs', { eq: { narcotic_id: id } })),
    c(countRows('media', { eq: { narcotic_id: id }, is: { archived_at: null } })),
    c(countRows('narcotic_sale_observations', { eq: { narcotic_id: id } })),
  ])
  return { caseLinks: links, seizures, places, people: persons + gangs, media, sales }
}

// ── Seizures — rows + resolved case/evidence (verbatim amounts stay on rows) ─
export interface SeizuresData {
  rows: SeizureRow[]
  cases: Map<string, CaseLite>
  evidence: Map<string, EvidenceLite>
}

export async function loadSeizures(id: string): Promise<SeizuresData> {
  const rows = (await opt(list('narcotic_seizures', { eq: { narcotic_id: id } }))).sort(byCreatedDesc)
  const caseIds = uniq(rows.map((r) => r.case_id).filter(notNull))
  const evIds = uniq(rows.map((r) => r.evidence_id).filter(notNull))
  const [cases, evidence] = await Promise.all([
    caseIds.length
      ? list('cases', { select: CASE_COLS, in: { id: caseIds } }).then((r) => r as unknown as CaseLite[]).catch(() => [])
      : Promise.resolve([] as CaseLite[]),
    evIds.length
      ? list('evidence', { select: EVIDENCE_COLS, in: { id: evIds } }).then((r) => r as unknown as EvidenceLite[]).catch(() => [])
      : Promise.resolve([] as EvidenceLite[]),
  ])
  return { rows, cases: new Map(cases.map((c) => [c.id, c])), evidence: new Map(evidence.map((e) => [e.id, e])) }
}

// ── Places — narcotic_places rows + resolved place / source case ────────────
export interface PlacesData {
  rows: NarcoticPlaceRow[]
  places: Map<string, PlaceLite>
  cases: Map<string, CaseLite>
}

export async function loadPlaces(id: string): Promise<PlacesData> {
  const rows = (await opt(list('narcotic_places', { eq: { narcotic_id: id } }))).sort(byCreatedDesc)
  const placeIds = uniq(rows.map((r) => r.place_id).filter(notNull))
  const caseIds = uniq(rows.map((r) => r.source_case_id).filter(notNull))
  const [places, cases] = await Promise.all([
    placeIds.length
      ? list('places', { select: PLACE_COLS, in: { id: placeIds } }).then((r) => r as unknown as PlaceLite[]).catch(() => [])
      : Promise.resolve([] as PlaceLite[]),
    caseIds.length
      ? list('cases', { select: CASE_COLS, in: { id: caseIds } }).then((r) => r as unknown as CaseLite[]).catch(() => [])
      : Promise.resolve([] as CaseLite[]),
  ])
  return { rows, places: new Map(places.map((p) => [p.id, p])), cases: new Map(cases.map((c) => [c.id, c])) }
}

// ── People & Gangs — narcotic_persons + narcotic_gangs + resolved records ────
export interface PeopleData {
  persons: NarcoticPersonRow[]
  gangs: NarcoticGangRow[]
  personMap: Map<string, PersonLite>
  gangMap: Map<string, GangLite>
}

export async function loadPeople(id: string): Promise<PeopleData> {
  const [persons, gangs] = await Promise.all([
    opt(list('narcotic_persons', { eq: { narcotic_id: id } })),
    opt(list('narcotic_gangs', { eq: { narcotic_id: id } })),
  ])
  persons.sort(byCreatedDesc)
  gangs.sort(byCreatedDesc)
  const personIds = uniq(persons.map((p) => p.person_id).filter(notNull))
  const gangIds = uniq(gangs.map((g) => g.gang_id).filter(notNull))
  const [prows, grows] = await Promise.all([
    personIds.length
      ? list('persons', { select: PERSON_COLS, in: { id: personIds } }).then((r) => r as unknown as PersonLite[]).catch(() => [])
      : Promise.resolve([] as PersonLite[]),
    gangIds.length
      ? list('gangs', { select: GANG_COLS, in: { id: gangIds } }).then((r) => r as unknown as GangLite[]).catch(() => [])
      : Promise.resolve([] as GangLite[]),
  ])
  return {
    persons, gangs,
    personMap: new Map(prows.map((p) => [p.id, p])),
    gangMap: new Map(grows.map((g) => [g.id, g])),
  }
}

// ── Cases — durable intel links + seizure cases + place source cases ─────────
export interface CasesData {
  links: IntelLinkRow[]
  seizureCaseIds: string[]
  placeCaseIds: string[]
  cases: Map<string, CaseLite>
}

export async function loadCasesData(id: string): Promise<CasesData> {
  const [links, seizures, places] = await Promise.all([
    opt(list('case_intel_links', { eq: { kind: 'narcotic', ref_id: id } })),
    list('narcotic_seizures', { select: 'id,case_id', eq: { narcotic_id: id } })
      .then((r) => r as unknown as { id: string; case_id: string | null }[]).catch(() => []),
    list('narcotic_places', { select: 'id,source_case_id', eq: { narcotic_id: id } })
      .then((r) => r as unknown as { id: string; source_case_id: string | null }[]).catch(() => []),
  ])
  links.sort(byCreatedDesc)
  const seizureCaseIds = uniq(seizures.map((s) => s.case_id).filter(notNull))
  const placeCaseIds = uniq(places.map((p) => p.source_case_id).filter(notNull))
  const caseIds = uniq([...links.map((l) => l.ref_id), ...seizureCaseIds, ...placeCaseIds])
  const cases = caseIds.length
    ? await list('cases', { select: CASE_COLS, in: { id: caseIds } }).then((r) => r as unknown as CaseLite[]).catch(() => [])
    : []
  return { links, seizureCaseIds, placeCaseIds, cases: new Map(cases.map((c) => [c.id, c])) }
}

// ── Intelligence — production places + linked persons/gangs (non-actionable) ─
export interface IntelligenceData {
  places: PlacesData
  people: PeopleData
}

export async function loadIntelligence(id: string): Promise<IntelligenceData> {
  const [places, people] = await Promise.all([loadPlaces(id), loadPeople(id)])
  return { places, people }
}

// ── Media ────────────────────────────────────────────────────────────────────
export async function loadMedia(id: string): Promise<MediaRow[]> {
  return opt(list('media', { eq: { narcotic_id: id }, is: { archived_at: null }, order: 'created_at', ascending: false }))
}

// ── Activity — slim created_at projections across every child table ─────────
export interface ActivityData {
  aliases: Array<Pick<AliasRow, 'id' | 'created_at' | 'alias'>>
  seizures: Array<Pick<SeizureRow, 'id' | 'created_at' | 'state' | 'location'>>
  places: Array<Pick<NarcoticPlaceRow, 'id' | 'created_at' | 'role'>>
  persons: Array<Pick<NarcoticPersonRow, 'id' | 'created_at' | 'role'>>
  gangs: Array<Pick<NarcoticGangRow, 'id' | 'created_at' | 'role'>>
  caseLinks: Array<Pick<IntelLinkRow, 'id' | 'created_at'>>
  media: Array<Pick<MediaRow, 'id' | 'created_at' | 'title'>>
}

export async function loadActivity(id: string): Promise<ActivityData> {
  const sel = <T,>(p: Promise<unknown[]>) => p.then((r) => r as T).catch(() => [] as unknown as T)
  const [aliases, seizures, places, persons, gangs, caseLinks, media] = await Promise.all([
    sel<ActivityData['aliases']>(list('narcotic_aliases', { select: 'id,created_at,alias', eq: { narcotic_id: id } })),
    sel<ActivityData['seizures']>(list('narcotic_seizures', { select: 'id,created_at,state,location', eq: { narcotic_id: id } })),
    sel<ActivityData['places']>(list('narcotic_places', { select: 'id,created_at,role', eq: { narcotic_id: id } })),
    sel<ActivityData['persons']>(list('narcotic_persons', { select: 'id,created_at,role', eq: { narcotic_id: id } })),
    sel<ActivityData['gangs']>(list('narcotic_gangs', { select: 'id,created_at,role', eq: { narcotic_id: id } })),
    sel<ActivityData['caseLinks']>(list('case_intel_links', { select: 'id,created_at', eq: { kind: 'narcotic', ref_id: id } })),
    sel<ActivityData['media']>(list('media', { select: 'id,created_at,title', eq: { narcotic_id: id } })),
  ])
  return { aliases, seizures, places, persons, gangs, caseLinks, media }
}

// ── Street-value sales (restricted) — series + observations + stacks + media ─
// RLS gates every table below to restricted-intel members, so an unauthorized
// caller resolves an empty series and the dossier tab stays hidden.
export interface SalesData {
  series: SaleSeriesRow | null
  observations: SaleObservationRow[]
  stacksByObs: Map<string, SaleStackRow[]>
  /** Screenshots keyed by sale_observation_id; series-level/context images are
   *  under the '' key. */
  mediaByObs: Map<string, MediaRow[]>
}

export async function loadSales(id: string): Promise<SalesData> {
  const [seriesRows, observations] = await Promise.all([
    opt(list('narcotic_sale_series', { eq: { narcotic_id: id }, order: 'created_at' })),
    opt(list('narcotic_sale_observations', { eq: { narcotic_id: id }, order: 'observation_number' })),
  ])
  const obsIds = observations.map((o) => o.id)
  const [stacks, media] = await Promise.all([
    obsIds.length ? opt(list('narcotic_sale_stacks', { in: { observation_id: obsIds }, order: 'stack_number' })) : Promise.resolve([] as SaleStackRow[]),
    opt(list('media', { eq: { narcotic_id: id }, order: 'created_at', ascending: false })),
  ])
  const stacksByObs = new Map<string, SaleStackRow[]>()
  for (const s of stacks) {
    const arr = stacksByObs.get(s.observation_id) ?? []
    arr.push(s); stacksByObs.set(s.observation_id, arr)
  }
  const seriesId = seriesRows[0]?.id ?? null
  const mediaByObs = new Map<string, MediaRow[]>()
  for (const m of media) {
    const tags = (m.tags ?? {}) as Record<string, unknown>
    // Only sale-tagged, restricted screenshots belong in this section.
    if (!m.restricted || (seriesId && tags.series_id !== seriesId)) continue
    const key = typeof tags.sale_observation_id === 'string' ? tags.sale_observation_id : ''
    const arr = mediaByObs.get(key) ?? []
    arr.push(m); mediaByObs.set(key, arr)
  }
  return { series: seriesRows[0] ?? null, observations, stacksByObs, mediaByObs }
}

// ── Picker for Merge — slim other narcotics (id + name only) ─────────────────
export async function loadOtherNarcotics(excludeId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await list('narcotics', { select: 'id,name', order: 'name' })
    .then((r) => r as unknown as Array<{ id: string; name: string }>).catch(() => [])
  return rows.filter((r) => r.id !== excludeId)
}
