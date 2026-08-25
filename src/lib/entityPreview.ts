'use client'

/** Minimal, RLS-scoped record previews for the RecordPeek slide-in. One lite
 *  projection per type (never a full-row fetch) plus a small linked-records
 *  count block (≤3 `countRows` HEADs per type). Every read is the viewer's own
 *  RLS-scoped client: a row the viewer cannot see resolves to `null` and the
 *  caller renders the access-restricted stub — never a leak, never a fake
 *  "empty" record. */
import { countRows, list } from './db'
import type { StatusDomain } from './status'

export type PreviewType = 'person' | 'vehicle' | 'gang' | 'place' | 'account' | 'narcotic'

/** A status chip backed by the central registry (ui/StatusBadge). */
export interface PreviewChip {
  domain: StatusDomain
  value: string
}

export interface EntityPreview {
  type: PreviewType
  title: string
  subtitle: string | null
  /** Registry-backed status chips (label + tint from lib/status). */
  chips: PreviewChip[]
  /** Plain descriptive tags (classification, platform, lifecycle …). */
  tags: string[]
  /** Linked-record counts (RLS-scoped HEAD counts, ≤3 per type). */
  counts: Array<{ label: string; value: number }>
  imageUrl: string | null
  /** How "Open full record" navigates — a workspace record tab where one
   *  exists, else the tool's canonical query-param href. */
  open: { tool: 'persons' | 'vehicles' | 'gangs' | 'narcotics'; recordId: string } | { href: string }
}

const humanize = (s?: string | null): string =>
  s ? s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : ''

const count = (p: Promise<number>): Promise<number> => p.catch(() => 0)

async function one<T>(p: Promise<T[]>): Promise<T | null> {
  const rows = await p.catch(() => [] as T[])
  return rows[0] ?? null
}

async function personPreview(id: string): Promise<EntityPreview | null> {
  type Row = {
    id: string; name: string | null; alias: string | null; status: string | null
    classification: string | null; lifecycle: string; mugshot_url: string | null
    bolo: boolean; bolo_risk: string | null
  }
  const p = await one(list('persons', {
    select: 'id,name,alias,status,classification,lifecycle,mugshot_url,bolo,bolo_risk', eq: { id },
  }).then((r) => r as unknown as Row[]))
  if (!p) return null
  const [cases, vehicles, places] = await Promise.all([
    count(countRows('case_intel_links', { eq: { kind: 'person', ref_id: id } })),
    count(countRows('person_vehicles', { eq: { person_id: id } })),
    count(countRows('person_places', { eq: { person_id: id } })),
  ])
  return {
    type: 'person',
    title: p.name || 'Person',
    subtitle: p.alias ? `“${p.alias}”` : null,
    chips: p.bolo ? [{ domain: 'boloRisk', value: p.bolo_risk || 'high' }] : [],
    tags: [
      ...(p.bolo ? ['BOLO'] : []),
      humanize(p.classification) || p.status || 'Person of interest',
      ...(p.lifecycle !== 'active' ? [humanize(p.lifecycle)] : []),
    ].filter(Boolean),
    counts: [
      { label: 'Linked cases', value: cases },
      { label: 'Vehicles', value: vehicles },
      { label: 'Places', value: places },
    ],
    imageUrl: p.mugshot_url,
    open: { tool: 'persons', recordId: id },
  }
}

async function vehiclePreview(id: string): Promise<EntityPreview | null> {
  type Row = { id: string; plate: string; model: string | null; color: string | null; owner_id: string | null; gang_id: string | null }
  const v = await one(list('vehicles', { select: 'id,plate,model,color,owner_id,gang_id', eq: { id } })
    .then((r) => r as unknown as Row[]))
  if (!v) return null
  const [people, media] = await Promise.all([
    count(countRows('person_vehicles', { eq: { vehicle_id: id } })),
    count(countRows('media', { eq: { vehicle_id: id }, is: { archived_at: null } })),
  ])
  return {
    type: 'vehicle',
    title: v.plate || 'Vehicle',
    subtitle: [v.model, v.color].filter(Boolean).join(' · ') || null,
    chips: [],
    tags: [
      v.owner_id ? 'Registered owner on file' : 'No registered owner',
      ...(v.gang_id ? ['Gang-linked'] : []),
    ],
    counts: [
      { label: 'Linked people', value: people },
      { label: 'Media', value: media },
    ],
    imageUrl: null,
    open: { tool: 'vehicles', recordId: id },
  }
}

async function gangPreview(id: string): Promise<EntityPreview | null> {
  type Row = { id: string; name: string; aliases: string | null; status: string | null; threat_level: string; classification: string | null }
  const g = await one(list('gangs', { select: 'id,name,aliases,status,threat_level,classification', eq: { id } })
    .then((r) => r as unknown as Row[]))
  if (!g) return null
  const [members, turf, cases] = await Promise.all([
    count(countRows('gang_members', { eq: { gang_id: id } })),
    count(countRows('gang_turf', { eq: { gang_id: id } })),
    count(countRows('case_intel_links', { eq: { kind: 'gang', ref_id: id } })),
  ])
  return {
    type: 'gang',
    title: g.name,
    subtitle: g.aliases ? `aka ${g.aliases}` : null,
    chips: [{ domain: 'threat', value: g.threat_level }],
    tags: [humanize(g.status), humanize(g.classification)].filter(Boolean),
    counts: [
      { label: 'Members', value: members },
      { label: 'Turf zones', value: turf },
      { label: 'Linked cases', value: cases },
    ],
    imageUrl: null,
    open: { tool: 'gangs', recordId: id },
  }
}

async function placePreview(id: string): Promise<EntityPreview | null> {
  type Row = { id: string; name: string; type: string; area: string | null; controlling_gang_id: string | null }
  const p = await one(list('places', { select: 'id,name,type,area,controlling_gang_id', eq: { id } })
    .then((r) => r as unknown as Row[]))
  if (!p) return null
  const [people, gangs, cases] = await Promise.all([
    count(countRows('person_places', { eq: { place_id: id } })),
    count(countRows('gang_places', { eq: { place_id: id } })),
    count(countRows('case_intel_links', { eq: { kind: 'place', ref_id: id } })),
  ])
  return {
    type: 'place',
    title: p.name,
    subtitle: [humanize(p.type), p.area].filter(Boolean).join(' · ') || null,
    chips: [],
    tags: p.controlling_gang_id ? ['Controlling gang on file'] : [],
    counts: [
      { label: 'Linked people', value: people },
      { label: 'Linked gangs', value: gangs },
      { label: 'Linked cases', value: cases },
    ],
    imageUrl: null,
    // Places have no dossier route — the list is `?q=`-addressed (EntityLink).
    open: { href: `/places?q=${encodeURIComponent(p.name)}` },
  }
}

async function accountPreview(id: string): Promise<EntityPreview | null> {
  type Row = { id: string; platform: string; handle: string; display_name: string | null; state: string | null; restricted: boolean }
  const a = await one(list('accounts', { select: 'id,platform,handle,display_name,state,restricted', eq: { id } })
    .then((r) => r as unknown as Row[]))
  if (!a) return null
  const [links, handles] = await Promise.all([
    count(countRows('account_links', { eq: { account_id: id } })),
    count(countRows('account_handles', { eq: { account_id: id } })),
  ])
  return {
    type: 'account',
    title: `@${a.handle}`,
    subtitle: a.display_name,
    chips: [],
    tags: [
      a.platform,
      ...(a.state && a.state !== 'active' ? [humanize(a.state)] : []),
      ...(a.restricted ? ['Restricted'] : []),
    ],
    counts: [
      { label: 'Ownership links', value: links },
      { label: 'Handle history', value: handles },
    ],
    imageUrl: null,
    open: { href: '/accounts' },
  }
}

async function narcoticPreview(id: string): Promise<EntityPreview | null> {
  type Row = { id: string; name: string; classification: string | null; status: string }
  const n = await one(list('narcotics', { select: 'id,name,classification,status', eq: { id } })
    .then((r) => r as unknown as Row[]))
  if (!n) return null
  const [gangs, persons, cases] = await Promise.all([
    count(countRows('narcotic_gangs', { eq: { narcotic_id: id } })),
    count(countRows('narcotic_persons', { eq: { narcotic_id: id } })),
    count(countRows('case_intel_links', { eq: { kind: 'narcotic', ref_id: id } })),
  ])
  return {
    type: 'narcotic',
    title: n.name,
    subtitle: humanize(n.classification) || null,
    chips: [],
    tags: [humanize(n.status)].filter(Boolean),
    counts: [
      { label: 'Linked gangs', value: gangs },
      { label: 'Linked people', value: persons },
      { label: 'Linked cases', value: cases },
    ],
    imageUrl: null,
    open: { tool: 'narcotics', recordId: id },
  }
}

/** Fetch the preview for one record. `null` = the row is not visible to this
 *  viewer (RLS/deleted) — callers render the access-restricted stub. */
export async function fetchEntityPreview(type: PreviewType, id: string): Promise<EntityPreview | null> {
  switch (type) {
    case 'person': return personPreview(id)
    case 'vehicle': return vehiclePreview(id)
    case 'gang': return gangPreview(id)
    case 'place': return placePreview(id)
    case 'account': return accountPreview(id)
    case 'narcotic': return narcoticPreview(id)
  }
}
