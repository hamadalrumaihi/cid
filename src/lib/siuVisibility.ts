/** Compartmentation — what SIU has taken out of CID's view, and what it has
 *  given back.
 *
 *  ── Where the enforcement actually is ─────────────────────────────────────
 *  Not here. `private.siu_hidden(entity_type, id)` is a conjunct on the SELECT,
 *  UPDATE and DELETE policies of persons, vehicles, gangs and places, so a
 *  compartmented record is absent from a CID reader's query results, absent
 *  from their counts, and unaffected by an UPDATE aimed straight at its id. The
 *  four RPCs below are SECURITY DEFINER and re-check SIU standing at the top of
 *  each body. Nothing in this file is a permission check — the buttons it
 *  hides are a courtesy, and removing them would change nothing.
 *
 *  ── Absence means visible ─────────────────────────────────────────────────
 *  There is no visibility column on any registry table. A record is hidden only
 *  when a `siu_visibility` row says so, which is why shipping this changed
 *  nothing about what CID could see on the day it landed. It also fixes the
 *  failure mode: a bug in this code leaves SIU material visible to SIU, rather
 *  than deleting CID's registry.
 *
 *  ── Two restrictions, named for what they do ──────────────────────────────
 *  `record`   the record and everything under it leaves CID.
 *  `sections` the record stays; the named sections leave CID.
 *
 *  The second exists because the common case is a person CID has known for
 *  months who becomes the subject of an SIU file. Hiding them removes CID's own
 *  work; leaving everything exposes the investigation. Neither is right, so
 *  neither is the only option — and `sections` is recommended (by the server,
 *  which computes it) whenever CID already has a stake in the record.
 *
 *  ── The state nobody chose ────────────────────────────────────────────────
 *  `unclassified` is the flag for a record whose origin could not be
 *  established. It does NOT hide. That distinction is load-bearing: both active
 *  SIU members are also senior CID staff, so 95 registry records were created
 *  by someone with SIU standing while doing CID work. Treating "created by an
 *  SIU member" as "SIU material" would have removed all ten vehicles and 49 of
 *  54 gangs from CID overnight. They are queued for a decision instead.
 */

import { list, rpc } from './db'
import type { Tables } from './database.types'

// The four states are `siu_only`, `revealed`, `partial` and `unclassified`.
// They are not a TS union here on purpose: the column is plain `text`, so a
// row always arrives as a string, and a union would only add casts at every
// call site while pretending to a narrowing the wire never gives us.
export type CompartmentType = 'person' | 'vehicle' | 'gang' | 'place'

/** Whether a restriction takes the whole record or only named sections. */
export type RestrictMode = 'record' | 'sections'

/** The sections a Mode 2 restriction can name. Each maps to one link table, so
 *  the vocabulary cannot drift from what the policies actually check — a
 *  section nobody enforces would be a checkbox that protects nothing. */
export const SECTIONS = [
  { id: 'relationships',   label: 'Known associates' },
  { id: 'gang_membership', label: 'Organisation membership' },
  { id: 'addresses',       label: 'Addresses and places' },
  { id: 'vehicles',        label: 'Vehicles' },
  { id: 'accounts',        label: 'Accounts and handles' },
  { id: 'media',           label: 'Photographs and media' },
  { id: 'narcotics',       label: 'Narcotics intelligence' },
  { id: 'ballistics',      label: 'Ballistics' },
  { id: 'gang_places',     label: 'Organisation locations' },
  { id: 'gang_ranks',      label: 'Organisation structure' },
  { id: 'gang_turf',       label: 'Territory' },
  { id: 'process',         label: 'Site processing' },
] as const

// Deliberately no exported SectionId union: the column is text[], so a row
// always arrives as strings, and a union here would add casts at every call
// site while promising a narrowing the wire never delivers.

export const sectionLabel = (id: string): string =>
  SECTIONS.find((s) => s.id === id)?.label ?? id

/** Which sections are worth offering for a given registry type. Offering
 *  "Territory" on a vehicle is a control that can only ever do nothing. */
export function sectionsFor(type: string): readonly { id: string; label: string }[] {
  const ids: Record<string, string[]> = {
    person:  ['relationships', 'gang_membership', 'addresses', 'vehicles', 'accounts', 'media', 'narcotics'],
    gang:    ['gang_membership', 'gang_places', 'gang_ranks', 'gang_turf', 'media', 'narcotics', 'ballistics'],
    vehicle: ['vehicles', 'media', 'narcotics'],
    place:   ['addresses', 'gang_places', 'process', 'media', 'narcotics'],
    account: ['accounts'],
    indicator: [],
  }
  const allowed = ids[type] ?? []
  return SECTIONS.filter((s) => allowed.includes(s.id))
}

/** What restricting a record would cost, computed by the server so the screen
 *  and the guard cannot disagree. */
export interface RestrictionImpact {
  entity_type: string
  entity_id: string
  name: string | null
  created_by_name: string | null
  created_at: string
  current_state: string
  current_scope: string
  current_hidden_sections: string[]
  /** True when CID authored or currently uses material attached to this record. */
  cid_authored: boolean
  /** 'sections' whenever CID has a stake. A recommendation, not a rule. */
  recommended_mode: RestrictMode
  cases: number
  reports: number
  evidence: number
  legal_requests: number
  tasks: number
  media: number
  watchlists: number
  relationships: number
  linked_persons: number
  linked_gangs: number
  linked_vehicles: number
  linked_places: number
}

export type VisibilityRow = Tables<'siu_visibility'>
export type VisibilityEvent = Tables<'siu_visibility_events'>

export const COMPARTMENT_TYPES: readonly CompartmentType[] =
  ['person', 'vehicle', 'gang', 'place']

const TYPE_LABEL: Record<CompartmentType, string> = {
  person: 'Person', vehicle: 'Vehicle', gang: 'Organisation', place: 'Place',
}
export const compartmentTypeLabel = (t: string): string =>
  TYPE_LABEL[t as CompartmentType] ?? t

/** What the state means, in the words somebody would use out loud. Deliberately
 *  not "Classified"/"Declassified": this is about who can see a record, not
 *  about a classification level, and conflating the two invites the wrong
 *  mental model. */
export function visibilityLabel(row: Pick<VisibilityRow,
  'state' | 'revealed_to_case_id' | 'revealed_to_user_id'> &
  { scope?: string | null; hidden_sections?: string[] | null }): string {
  switch (row.state) {
    case 'siu_only':
      // A section restriction is NOT "SIU only" -- CID can still see the
      // profile. Saying otherwise would misdescribe what is protected, in the
      // one place somebody checks.
      if (row.scope === 'sections') {
        const n = row.hidden_sections?.length ?? 0
        return n === 1 ? '1 section restricted' : `${n} sections restricted`
      }
      return 'SIU only'
    case 'unclassified': return 'Origin not established'
    case 'partial':
    case 'revealed':
      if (row.revealed_to_user_id) return 'Revealed to one officer'
      if (row.revealed_to_case_id) return 'Revealed to one case'
      return row.state === 'partial' ? 'Partially revealed to CID' : 'Revealed to CID'
    default: return row.state
  }
}

export const visibilityTint = (state: string): string =>
  state === 'siu_only' ? 'bg-violet-500/15 text-violet-300'
  : state === 'partial' ? 'bg-amber-500/15 text-amber-300'
  : state === 'revealed' ? 'bg-emerald-500/15 text-emerald-300'
  : 'bg-white/5 text-slate-300'

const ACTION_LABEL: Record<string, string> = {
  marked: 'Taken into the compartment',
  revealed: 'Revealed to CID',
  expanded: 'Widened',
  reduced: 'Narrowed',
  // A move that is neither wider nor narrower — one case to another, one
  // officer to another. The server refuses to guess between wider and
  // narrower, and neither does this.
  redirected: 'Redirected',
  restricted: 'Pulled back to SIU',
  flagged: 'Flagged for review',
}
export const visibilityActionLabel = (a: string): string => ACTION_LABEL[a] ?? a

/** The sentence shown before somebody confirms. The brief asks for a preview of
 *  the consequence, and the consequence is about who can see the record — so
 *  that is what this says, in full, with no euphemism. */
export function revealPreview(opts: {
  sections?: string[] | null
  toCaseName?: string | null
  toOfficerName?: string | null
}): string {
  const who = opts.toOfficerName
    ? `${opts.toOfficerName} alone`
    : opts.toCaseName
      ? `everyone with access to ${opts.toCaseName}`
      : 'every active CID investigator'
  const what = opts.sections?.length
    ? `the ${opts.sections.join(', ')} ${opts.sections.length === 1 ? 'section' : 'sections'} of this record`
    : 'this record'
  return `After this, ${who} will be able to see ${what}. `
    + 'The release is recorded permanently, with your name and your reason.'
}

export function restrictPreview(): string {
  return 'After this, only SIU will be able to see this record. CID will not be '
    + 'told it was withdrawn, and anyone who already read it will still remember it — '
    + 'restricting removes access, not knowledge.'
}

/** Long enough that a reason has to be a sentence rather than a keystroke. The
 *  server enforces the same floor; this only spares a round trip. */
export const MIN_REASON = 10
export const reasonIsUsable = (s: string): boolean => s.trim().length >= MIN_REASON

/** The compartment ledger. Returns nothing at all for a CID reader — the RLS
 *  policy on siu_visibility is `private.siu_operates()`, because the existence
 *  of a compartment is itself compartmented. */
export async function fetchCompartments(): Promise<VisibilityRow[]> {
  const rows = await list('siu_visibility', {
    order: 'updated_at', ascending: false, limit: 500,
  })
  return rows as VisibilityRow[]
}

/** Records whose origin could not be told from the data, awaiting a decision.
 *  Sorted so the genuinely ambiguous ones come first: a queue of 95 that opens
 *  on 69 records nobody needs to think about is a queue nobody walks. */
export async function fetchReviewQueue(): Promise<VisibilityRow[]> {
  const rows = await list('siu_visibility', {
    eq: { needs_review: true }, order: 'entity_type', limit: 500,
  })
  return (rows as VisibilityRow[]).slice().sort(
    (a, b) => reviewRank(a) - reviewRank(b))
}

/** 0 = SIU material points at it and CID's does not; 1 = nothing points at it
 *  either way; 2 = CID already holds it, so it stays shared whatever is
 *  decided. Read off the note the migration wrote, which records evidence
 *  rather than a conclusion. */
export function reviewRank(row: Pick<VisibilityRow, 'review_note'>): number {
  const n = row.review_note ?? ''
  if (n.includes('SIU material references it')) return 0
  if (n.includes('nothing attached on either side')) return 1
  return 2
}

export async function fetchVisibilityHistory(
  type: string, id: string): Promise<VisibilityEvent[]> {
  const rows = await list('siu_visibility_events', {
    eq: { entity_type: type, entity_id: id },
    order: 'created_at', ascending: false, limit: 100,
  })
  return rows as VisibilityEvent[]
}

/** Every mutation goes through a definer RPC and surfaces the server's own
 *  refusal text. The messages are written to be read by the person who hit
 *  them -- "CID already holds this record, so it stays shared" explains the
 *  rule, where a generic failure would just look broken. */
async function call(fn: 'siu_reveal_to_cid' | 'siu_restrict_to_siu'
  | 'siu_resolve_review' | 'siu_reserve_visibility',
  args: Record<string, unknown>): Promise<void> {
  const res = await rpc(fn, args as never)
  if (res.error) throw new Error(res.error.message)
}

/** What CID would lose. Read before the confirmation screen renders, and read
 *  again by the server when the restriction is applied — the same function
 *  both times, so the number on the page is the number in the guard. */
export async function restrictionImpact(
  type: string, id: string): Promise<RestrictionImpact> {
  const res = await rpc('siu_restriction_impact', { p_type: type, p_id: id })
  if (res.error) throw new Error(res.error.message)
  return res.data as unknown as RestrictionImpact
}

/** Apply a restriction. `acknowledge` is the second confirmation, and it is a
 *  parameter rather than a dialog because a dialog enforces nothing: without it
 *  the server refuses any whole-record restriction on a record CID uses. */
export async function restrict(opts: {
  type: string; id: string; mode: RestrictMode; reason: string
  sections?: string[]; acknowledge?: boolean; caseId?: string
}): Promise<RestrictionImpact> {
  const res = await rpc('siu_restrict', {
    p_type: opts.type, p_id: opts.id, p_mode: opts.mode, p_reason: opts.reason,
    ...(opts.sections?.length ? { p_sections: opts.sections } : {}),
    ...(opts.acknowledge ? { p_acknowledge_cid_impact: true } : {}),
    ...(opts.caseId ? { p_case_id: opts.caseId } : {}),
  })
  if (res.error) throw new Error(res.error.message)
  return res.data as unknown as RestrictionImpact
}

/** Compartment an id BEFORE the record behind it exists, so a new SIU record is
 *  never briefly visible to CID between insert and restriction. */
export const reserveVisibility = (
  type: CompartmentType, id: string, visibility: 'siu_only' | 'cid', reason: string) =>
  call('siu_reserve_visibility',
    { p_type: type, p_id: id, p_visibility: visibility, p_reason: reason })

export const revealToCid = (type: string, id: string, reason: string, opts: {
  sections?: string[]; toCaseId?: string; toUserId?: string } = {}) =>
  call('siu_reveal_to_cid', { p_type: type, p_id: id, p_reason: reason,
    ...(opts.sections?.length ? { p_sections: opts.sections } : {}),
    ...(opts.toCaseId ? { p_to_case_id: opts.toCaseId } : {}),
    ...(opts.toUserId ? { p_to_user_id: opts.toUserId } : {}) })

export const restrictToSiu = (type: string, id: string, reason: string) =>
  call('siu_restrict_to_siu', { p_type: type, p_id: id, p_reason: reason })

export const resolveReview = (type: string, id: string, siuOrigin: boolean, reason: string) =>
  call('siu_resolve_review', { p_type: type, p_id: id, p_siu_origin: siuOrigin, p_reason: reason })
