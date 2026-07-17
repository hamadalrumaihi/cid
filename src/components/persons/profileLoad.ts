'use client'

/** Per-section data loaders for the person dossier (PersonProfile) and the
 *  IntelProfile slide-over. The dossier loads its header from ONE persons
 *  fetch (plus the linked gang by id and a projected legal fetch for the
 *  header badge); every section then lazy-loads its own slice on first open.
 *  All auxiliary queries are RLS-scoped and degrade to []/0 on failure; only
 *  the primary person lookup stays unwrapped so a transient fetch failure
 *  reports its real message instead of masquerading as "not found".
 *
 *  There is deliberately NO full-table load here: no `list('reports', {})`
 *  (the old name-matching warrant scan is gone — warrants now come from the
 *  structured `legal_requests.person_id` join), no full cases/gangs loads. */
import type { Tables } from '@/lib/database.types'
import { countRows, list } from '@/lib/db'
import type { GangRow, PersonRow } from './PersonModal'

export type RelationshipRow = Tables<'person_relationships'>
export type PersonPlaceRow = Tables<'person_places'>
export type PersonVehicleRow = Tables<'person_vehicles'>
export type GangMemberRow = Tables<'gang_members'>
export type MediaRow = Tables<'media'>
export type IntelLinkRow = Tables<'case_intel_links'>
export type EvidenceRow = Tables<'evidence'>

// ── Projections ───────────────────────────────────────────────────────────────
/** Slim legal-request projection — lifecycle + deadlines only, never the
 *  narrative/decision-note columns. RLS additionally seals rows the viewer
 *  cannot access; sealed rows simply don't appear (and are never counted). */
export const LEGAL_COLS =
  'id,request_number,request_type,subtype,title,review_status,fulfilment_status,service_status,' +
  'response_deadline,expires_at,case_id,case_number_snapshot,person_id,created_at,decision,executed_at,served_at'
export type LegalLite = Pick<
  Tables<'legal_requests'>,
  'id' | 'request_number' | 'request_type' | 'subtype' | 'title' | 'review_status' | 'fulfilment_status'
  | 'service_status' | 'response_deadline' | 'expires_at' | 'case_id' | 'case_number_snapshot' | 'person_id'
  | 'created_at' | 'decision' | 'executed_at' | 'served_at'
>

export const CASE_COLS = 'id,case_number,title,status,bureau,lead_detective_id'
export type CaseLite = Pick<Tables<'cases'>, 'id' | 'case_number' | 'title' | 'status' | 'bureau' | 'lead_detective_id'>

export const PERSON_LITE_COLS = 'id,name,alias,mugshot_url,lifecycle,classification'
export type PersonLite = Pick<PersonRow, 'id' | 'name' | 'alias' | 'mugshot_url' | 'lifecycle' | 'classification'>

export const PLACE_LITE_COLS = 'id,name,type,area'
export type PlaceLite = Pick<Tables<'places'>, 'id' | 'name' | 'type' | 'area'>

export const VEHICLE_LITE_COLS = 'id,plate,model,color,owner_id'
export type VehicleLite = Pick<Tables<'vehicles'>, 'id' | 'plate' | 'model' | 'color' | 'owner_id'>

const opt = <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => [] as T[])
const uniq = <T,>(arr: T[]): T[] => [...new Set(arr)]
const byCreatedDesc = (a: { created_at: string }, b: { created_at: string }) =>
  (b.created_at || '').localeCompare(a.created_at || '')

// ── Core (header) — loads FIRST, one persons fetch + gang-by-id + legal ──────
export interface PersonCore {
  person: PersonRow
  gang: GangRow | null
  /** Structured legal instruments naming this person (legal_requests.person_id).
   *  Loaded with the core so the header's active-legal badge is immediate. */
  legal: LegalLite[]
}

export async function loadPersonCore(id: string): Promise<PersonCore> {
  const persons = await list('persons', { eq: { id } })
  const person = persons[0]
  if (!person) throw new Error('Person not found')
  const [gangs, legal] = await Promise.all([
    person.gang_id ? opt(list('gangs', { eq: { id: person.gang_id } })) : Promise.resolve([] as GangRow[]),
    list('legal_requests', { select: LEGAL_COLS, eq: { person_id: id }, order: 'created_at', ascending: false })
      .then((r) => r as unknown as LegalLite[])
      .catch(() => [] as LegalLite[]),
  ])
  return { person, gang: gangs[0] ?? null, legal }
}

// ── Overview counts — HEAD count queries only, never row fetches ─────────────
export interface ProfileCounts {
  relationships: number
  places: number
  vehicles: number
  media: number
  caseLinks: number
}

export async function loadProfileCounts(id: string): Promise<ProfileCounts> {
  const c = (p: Promise<number>) => p.catch(() => 0)
  const [ra, rb, pp, pv, own, med, cil] = await Promise.all([
    c(countRows('person_relationships', { eq: { person_a: id } })),
    c(countRows('person_relationships', { eq: { person_b: id } })),
    c(countRows('person_places', { eq: { person_id: id } })),
    c(countRows('person_vehicles', { eq: { person_id: id } })),
    c(countRows('vehicles', { eq: { owner_id: id } })),
    c(countRows('media', { eq: { person_id: id }, is: { archived_at: null } })),
    c(countRows('case_intel_links', { eq: { kind: 'person', ref_id: id } })),
  ])
  return { relationships: ra + rb, places: pp, vehicles: pv + own, media: med, caseLinks: cil }
}

// ── Relationships (both directions) + gang memberships ──────────────────────
export interface RelationsData {
  rows: RelationshipRow[]
  /** Slim rows for the "other" person in each relationship. */
  people: Map<string, PersonLite>
  memberships: GangMemberRow[]
  gangNames: Map<string, string>
}

export async function loadRelations(id: string): Promise<RelationsData> {
  const [a, b, memberships] = await Promise.all([
    opt(list('person_relationships', { eq: { person_a: id } })),
    opt(list('person_relationships', { eq: { person_b: id } })),
    opt(list('gang_members', { eq: { person_id: id } })),
  ])
  const rows = [...a, ...b].sort(byCreatedDesc)
  const otherIds = uniq(rows.map((r) => (r.person_a === id ? r.person_b : r.person_a)))
  const gangIds = uniq(memberships.map((m) => m.gang_id).filter((x): x is string => !!x))
  const [people, gangs] = await Promise.all([
    otherIds.length
      ? list('persons', { select: PERSON_LITE_COLS, in: { id: otherIds } })
          .then((r) => r as unknown as PersonLite[]).catch(() => [] as PersonLite[])
      : Promise.resolve([] as PersonLite[]),
    gangIds.length
      ? list('gangs', { select: 'id,name', in: { id: gangIds } })
          .then((r) => r as unknown as { id: string; name: string }[]).catch(() => [] as { id: string; name: string }[])
      : Promise.resolve([] as { id: string; name: string }[]),
  ])
  return {
    rows,
    people: new Map(people.map((p) => [p.id, p])),
    memberships,
    gangNames: new Map(gangs.map((g) => [g.id, g.name])),
  }
}

// ── Cases — durable intel links + distinctly-labelled indirect associations ─
export interface IndirectCaseRef { caseId: string; via: 'gang roster' | 'media' }

export interface CasesData {
  links: IntelLinkRow[]
  /** RLS-visible subset — ids missing here render as access-restricted stubs. */
  cases: Map<string, CaseLite>
  indirect: IndirectCaseRef[]
}

export async function loadCasesData(id: string): Promise<CasesData> {
  const [links, members, media] = await Promise.all([
    opt(list('case_intel_links', { eq: { kind: 'person', ref_id: id } })),
    list('gang_members', { select: 'id,case_id', eq: { person_id: id } })
      .then((r) => r as unknown as { id: string; case_id: string | null }[]).catch(() => []),
    list('media', { select: 'id,case_id', eq: { person_id: id } })
      .then((r) => r as unknown as { id: string; case_id: string | null }[]).catch(() => []),
  ])
  links.sort(byCreatedDesc)
  const durable = new Set(links.map((l) => l.case_id))
  const indirect = new Map<string, IndirectCaseRef>()
  for (const m of members) if (m.case_id && !durable.has(m.case_id)) indirect.set(`${m.case_id}-roster`, { caseId: m.case_id, via: 'gang roster' })
  for (const m of media) if (m.case_id && !durable.has(m.case_id)) indirect.set(`${m.case_id}-media`, { caseId: m.case_id, via: 'media' })
  const caseIds = uniq([...links.map((l) => l.case_id), ...[...indirect.values()].map((i) => i.caseId)])
  const cases = caseIds.length
    ? await list('cases', { select: CASE_COLS, in: { id: caseIds } })
        .then((r) => r as unknown as CaseLite[]).catch(() => [] as CaseLite[])
    : []
  return { links, cases: new Map(cases.map((c) => [c.id, c])), indirect: [...indirect.values()] }
}

// ── Vehicles — registered owner (canonical) + person_vehicles links ─────────
export interface VehiclesData {
  owned: VehicleLite[]
  links: PersonVehicleRow[]
  vehicles: Map<string, VehicleLite>
}

export async function loadVehiclesData(id: string): Promise<VehiclesData> {
  const [owned, links] = await Promise.all([
    list('vehicles', { select: VEHICLE_LITE_COLS, eq: { owner_id: id }, order: 'plate' })
      .then((r) => r as unknown as VehicleLite[]).catch(() => [] as VehicleLite[]),
    opt(list('person_vehicles', { eq: { person_id: id } })),
  ])
  links.sort(byCreatedDesc)
  const ids = uniq(links.map((l) => l.vehicle_id))
  const linked = ids.length
    ? await list('vehicles', { select: VEHICLE_LITE_COLS, in: { id: ids } })
        .then((r) => r as unknown as VehicleLite[]).catch(() => [] as VehicleLite[])
    : []
  return { owned, links, vehicles: new Map([...owned, ...linked].map((v) => [v.id, v])) }
}

// ── Locations — person_places links (legacy properties come off the person) ─
export interface PlacesData {
  links: PersonPlaceRow[]
  places: Map<string, PlaceLite>
}

export async function loadPlacesData(id: string): Promise<PlacesData> {
  const links = await opt(list('person_places', { eq: { person_id: id } }))
  links.sort(byCreatedDesc)
  const ids = uniq(links.map((l) => l.place_id))
  const places = ids.length
    ? await list('places', { select: PLACE_LITE_COLS, in: { id: ids } })
        .then((r) => r as unknown as PlaceLite[]).catch(() => [] as PlaceLite[])
    : []
  return { links, places: new Map(places.map((p) => [p.id, p])) }
}

// ── Media ────────────────────────────────────────────────────────────────────
export async function loadMediaRows(id: string): Promise<MediaRow[]> {
  const rows = await opt(list('media', { eq: { person_id: id }, is: { archived_at: null }, order: 'created_at', ascending: false }))
  return rows
}

// ── Activity — derived from domain rows only (audit_log is owner-only) ──────
export interface ActivityData {
  relationships: Pick<RelationshipRow, 'id' | 'created_at' | 'relationship'>[]
  places: Pick<PersonPlaceRow, 'id' | 'created_at' | 'role'>[]
  vehicles: Pick<PersonVehicleRow, 'id' | 'created_at' | 'role'>[]
  links: Pick<IntelLinkRow, 'id' | 'created_at' | 'role'>[]
  media: Pick<MediaRow, 'id' | 'created_at' | 'title'>[]
}

export async function loadActivityData(id: string): Promise<ActivityData> {
  const [ra, rb, places, vehicles, links, media] = await Promise.all([
    list('person_relationships', { select: 'id,created_at,relationship', eq: { person_a: id } })
      .then((r) => r as unknown as ActivityData['relationships']).catch(() => []),
    list('person_relationships', { select: 'id,created_at,relationship', eq: { person_b: id } })
      .then((r) => r as unknown as ActivityData['relationships']).catch(() => []),
    list('person_places', { select: 'id,created_at,role', eq: { person_id: id } })
      .then((r) => r as unknown as ActivityData['places']).catch(() => []),
    list('person_vehicles', { select: 'id,created_at,role', eq: { person_id: id } })
      .then((r) => r as unknown as ActivityData['vehicles']).catch(() => []),
    list('case_intel_links', { select: 'id,created_at,role', eq: { kind: 'person', ref_id: id } })
      .then((r) => r as unknown as ActivityData['links']).catch(() => []),
    list('media', { select: 'id,created_at,title', eq: { person_id: id } })
      .then((r) => r as unknown as ActivityData['media']).catch(() => []),
  ])
  return { relationships: [...ra, ...rb], places, vehicles, links, media }
}

// ── IntelProfile rollup (person branch) — shared with the slide-over ────────
export interface PersonRollup {
  person: PersonRow
  members: GangMemberRow[]
  media: MediaRow[]
  evidence: EvidenceRow[]
  caseIds: string[]
  /** RLS-visible subset of caseIds; missing ids render as restricted stubs. */
  cases: Tables<'cases'>[]
}

export async function loadPersonRollup(id: string): Promise<PersonRollup> {
  const [persons, members, media, direct] = await Promise.all([
    list('persons', { eq: { id } }),
    opt(list('gang_members', { eq: { person_id: id } })),
    opt(list('media', { eq: { person_id: id }, is: { archived_at: null } })),
    list('case_intel_links', { select: 'case_id', eq: { kind: 'person', ref_id: id } })
      .then((r) => r as unknown as { case_id: string }[]).catch(() => [] as { case_id: string }[]),
  ])
  const person = persons[0]
  if (!person) throw new Error('Person not found')
  const caseIds = uniq(
    [...members.map((m) => m.case_id), ...media.map((m) => m.case_id), ...direct.map((d) => d.case_id)]
      .filter((x): x is string => !!x),
  )
  const [evidence, cases] = await Promise.all([
    caseIds.length ? opt(list('evidence', { in: { case_id: caseIds } })) : Promise.resolve([] as EvidenceRow[]),
    caseIds.length ? opt(list('cases', { in: { id: caseIds } })) : Promise.resolve([] as Tables<'cases'>[]),
  ])
  return { person, members, media, evidence, caseIds, cases }
}
