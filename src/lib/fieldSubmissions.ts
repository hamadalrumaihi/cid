/** Field Intelligence submissions — the client mirror of
 *  20260911120000_field_submissions.sql.
 *
 *  A submission is a REPORT WITH PARTS: several people, several vehicles, an
 *  organization, a location, a seizure. Each part is a separate claim, stored
 *  separately, because a reviewer decides about each one on its own and a plate
 *  that becomes searchable is worth more than the same plate buried in prose.
 *
 *  ── This file decides nothing ──────────────────────────────────────────────
 *  The database stamps the reporting officer from their appointment and throws
 *  away whatever the client sent for it; it issues the FI number; it refuses to
 *  let an officer edit a report after they send it, and refuses to let a
 *  reviewer edit what an officer said. Every rule below is a mirror so a form
 *  can be helpful, not a control. If this file and the migration disagree, the
 *  migration wins and this file is the bug.
 *
 *  ── Drafts ─────────────────────────────────────────────────────────────────
 *  A draft is a submission with status 'draft'. It has no FI number — numbers
 *  are issued at submit, so a series is not full of holes from reports nobody
 *  ever sent. The officer may edit a draft freely and cannot touch it after.
 */

import { insert, list, remove, update } from './db'
import type { Tables, TablesInsert } from './database.types'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

export type FieldSubmissionRow = Tables<'field_submissions'>
export type FieldPersonRow = Tables<'field_submission_persons'>
export type FieldVehicleRow = Tables<'field_submission_vehicles'>
export type FieldOrgRow = Tables<'field_submission_orgs'>
export type FieldLocationRow = Tables<'field_submission_locations'>
export type FieldItemRow = Tables<'field_submission_items'>

/** Mirrors the status check constraint. 'draft' and 'submitted' are the only
 *  two an officer can cause; the rest are review decisions. */
export const FIELD_STATUSES = [
  'draft', 'submitted', 'reviewing', 'needs_info', 'partially_reviewed',
  'intel_added', 'linked_existing', 'linked_case', 'archived', 'rejected',
] as const
export type FieldStatus = (typeof FIELD_STATUSES)[number]

/** What each status means TO THE SUBMITTING OFFICER. Deliberately plain, and
 *  deliberately free of internal detail — an officer learns that their report
 *  was used, not how CID is working it. */
const STATUS_LABEL: Record<FieldStatus, string> = {
  draft: 'Draft',
  submitted: 'Sent',
  reviewing: 'Being reviewed',
  needs_info: 'Question for you',
  partially_reviewed: 'Partly reviewed',
  intel_added: 'Used as intelligence',
  linked_existing: 'Added to existing intelligence',
  linked_case: 'Linked to an investigation',
  archived: 'Filed, no action',
  rejected: 'Not used',
}
export function fieldStatusLabel(s: string): string {
  return STATUS_LABEL[s as FieldStatus] ?? s
}

const STATUS_MEANING: Record<FieldStatus, string> = {
  draft: 'Not sent yet. Only you can see it, and you can keep editing it.',
  submitted: 'Sent to CID/SIU. Nobody has picked it up yet.',
  reviewing: 'An investigator is going through it.',
  needs_info: 'An investigator has asked you something. Open it to answer.',
  partially_reviewed: 'Some of what you reported has been decided; the rest is still open.',
  intel_added: 'What you reported became intelligence in the investigative database.',
  linked_existing: 'It matched something already known and was added to it.',
  linked_case: 'It was connected to an active investigation.',
  archived: 'Kept on file. Nothing to act on right now — it may still matter later.',
  rejected: 'Not usable as intelligence. It stays on record that you reported it.',
}
export function fieldStatusMeaning(s: string): string {
  return STATUS_MEANING[s as FieldStatus] ?? ''
}

/** An officer may edit only a draft. Everything past that is the record of what
 *  was reported, and the BEFORE UPDATE trigger refuses to let them change it. */
export function isEditableByOfficer(s: string): boolean {
  return s === 'draft'
}

export const FIELD_ROUTES = ['unsure', 'cid', 'siu'] as const
export type FieldRoute = (typeof FIELD_ROUTES)[number]
export const FIELD_ROUTE_LABEL: Record<FieldRoute, string> = {
  unsure: 'Not sure — let CID decide',
  cid: 'CID (general investigations)',
  siu: 'SIU (police corruption / internal)',
}

export const TIME_PRECISION = ['exact', 'approximate', 'range', 'unknown'] as const
export type TimePrecision = (typeof TIME_PRECISION)[number]
export const TIME_PRECISION_LABEL: Record<TimePrecision, string> = {
  exact: 'Exact time',
  approximate: 'Roughly',
  range: 'Between two times',
  unknown: 'Time unknown',
}

/** Direct observation vs. hearsay. The design is explicit that these are
 *  different, and that NEITHER of them means verified. */
export const BASIS = ['observed', 'reported', 'unknown'] as const
export type Basis = (typeof BASIS)[number]
export const BASIS_LABEL: Record<Basis, string> = {
  observed: 'I saw this myself',
  reported: 'Someone told me',
  unknown: 'Not stated',
}

export const ORG_TYPES = ['street_gang', 'mc', 'organized_crime', 'crew', 'syndicate', 'unknown'] as const
export const ORG_TYPE_LABEL: Record<string, string> = {
  street_gang: 'Street gang', mc: 'Motorcycle club', organized_crime: 'Organized crime',
  crew: 'Crew', syndicate: 'Syndicate', unknown: 'Unknown',
}

export const ORG_ROLES = ['member', 'associate', 'prospect', 'leadership', 'unknown'] as const
export const ORG_ROLE_LABEL: Record<string, string> = {
  member: 'Member', associate: 'Associate', prospect: 'Prospect',
  leadership: 'Leadership', unknown: 'Unknown',
}

export const LOCATION_KINDS = [
  'general_area', 'residence', 'business', 'street',
  'gang_territory', 'gang_clubhouse', 'mc_clubhouse', 'stash_house',
  'drug_location', 'drug_production', 'meeting_location', 'chop_shop',
  'weapons_location', 'gun_bench', 'gang_gun_bench', 'crafting_bench',
  'warehouse', 'storage', 'laundering', 'unknown_criminal', 'other',
] as const
export const LOCATION_KIND_LABEL: Record<string, string> = {
  general_area: 'General area', residence: 'Residence', business: 'Business',
  street: 'Street', gang_territory: 'Gang territory', gang_clubhouse: 'Gang clubhouse',
  mc_clubhouse: 'MC clubhouse', stash_house: 'Stash house', drug_location: 'Drug location',
  drug_production: 'Drug production', meeting_location: 'Meeting location',
  chop_shop: 'Chop shop', weapons_location: 'Weapons location', gun_bench: 'Gun bench',
  gang_gun_bench: 'Gang gun bench', crafting_bench: 'Crafting bench',
  warehouse: 'Warehouse', storage: 'Storage', laundering: 'Laundering location',
  unknown_criminal: 'Criminal location (unclear)', other: 'Other',
}

export const ITEM_CATEGORIES = [
  'narcotics', 'firearm', 'ammunition', 'money', 'dirty_money', 'weapon',
  'tools', 'crafting_material', 'electronics', 'documents', 'stolen_property', 'other',
] as const
export const ITEM_CATEGORY_LABEL: Record<string, string> = {
  narcotics: 'Narcotics', firearm: 'Firearm', ammunition: 'Ammunition',
  money: 'Money', dirty_money: 'Dirty money', weapon: 'Weapon', tools: 'Tools',
  crafting_material: 'Crafting material', electronics: 'Electronics',
  documents: 'Documents', stolen_property: 'Stolen property', other: 'Other',
}

export const WEIGHT_UNITS = ['g', 'kg', 'oz', 'lb'] as const
export type WeightUnit = (typeof WEIGHT_UNITS)[number]

/** Grams per unit. Mirrors the generated column exactly — if these ever
 *  disagree, the column is right and this is wrong. */
const GRAMS: Record<WeightUnit, number> = {
  g: 1, kg: 1000, oz: 28.349523125, lb: 453.59237,
}

/** What a weight normalizes to, for showing the officer what CID will see.
 *  The value they typed is what gets STORED; this is display only. */
export function normalizedGrams(value: number | null, unit: string | null): number | null {
  if (value == null || !unit || !(unit in GRAMS)) return null
  return value * GRAMS[unit as WeightUnit]
}

/** A weight is a number AND a unit, or it is neither — a bare "2.4" is not a
 *  measurement. Mirrors field_submission_items_weight_pair. */
export function weightProblem(value: number | null, unit: string | null): string | null {
  if (value == null && !unit) return null
  if (value == null) return 'Enter a weight, or clear the unit.'
  if (!unit) return 'Choose a unit — a number on its own is not a weight.'
  if (value < 0) return 'A weight cannot be negative.'
  return null
}

// ---------------------------------------------------------------------------
// What a report needs before it can be sent
// ---------------------------------------------------------------------------

/** Why this report cannot be submitted yet, or null. The database enforces the
 *  summary rule with a check constraint; this exists so the officer is told
 *  before they lose the click, not after. */
export function submitProblem(s: Pick<FieldSubmissionRow,
  'summary' | 'observed_precision' | 'observed_at' | 'observed_to'>): string | null {
  if (!s.summary?.trim()) return 'Say what happened before sending — even one line.'
  if (s.observed_precision === 'range') {
    if (!s.observed_at || !s.observed_to) return 'A time range needs both a start and an end.'
    if (new Date(s.observed_to) < new Date(s.observed_at)) return 'The range ends before it starts.'
  }
  return null
}

/** How to show a submission's reference. A draft genuinely has no number yet —
 *  saying "Draft" is honest where an invented placeholder would not be. */
export function submissionRef(s: FieldSubmissionRow): string {
  return s.submission_no ?? 'Draft'
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------
//
// Every read is RLS-scoped: an officer's policy returns their own rows and
// nothing else, so there is no "mine" filter here to forget. Writes are
// ordinary table writes -- the INSERT policy decides who may create, and the
// BEFORE triggers decide what the row may say.

export async function loadMySubmissions(): Promise<FieldSubmissionRow[]> {
  return list('field_submissions', { order: 'created_at', ascending: false })
    .catch(() => [])
}

export interface SubmissionParts {
  persons: FieldPersonRow[]
  vehicles: FieldVehicleRow[]
  orgs: FieldOrgRow[]
  locations: FieldLocationRow[]
  items: FieldItemRow[]
}

export async function loadSubmissionParts(id: string): Promise<SubmissionParts> {
  const [persons, vehicles, orgs, locations, items] = await Promise.all([
    list('field_submission_persons', { eq: { submission_id: id }, order: 'created_at' }).catch(() => []),
    list('field_submission_vehicles', { eq: { submission_id: id }, order: 'created_at' }).catch(() => []),
    list('field_submission_orgs', { eq: { submission_id: id }, order: 'created_at' }).catch(() => []),
    list('field_submission_locations', { eq: { submission_id: id }, order: 'created_at' }).catch(() => []),
    list('field_submission_items', { eq: { submission_id: id }, order: 'created_at' }).catch(() => []),
  ])
  return { persons, vehicles, orgs, locations, items }
}

/** Start a draft. `snap_agency` is NOT NULL and is omitted anyway: the BEFORE
 *  INSERT trigger fills it from the appointment, and Postgres evaluates NOT
 *  NULL after that trigger. Sending a placeholder would work and would be
 *  worse — it would look as though the client had a say in which agency a
 *  report came from. It does not. */
export async function createDraft(): Promise<{ id: string | null; error: string | null }> {
  const res = await insert('field_submissions', { status: 'draft' } as never)
  return { id: res.data?.[0]?.id ?? null, error: res.error?.message ?? null }
}

export async function saveDraft(
  id: string, patch: Partial<FieldSubmissionRow>,
): Promise<string | null> {
  const res = await update('field_submissions', id, patch)
  return res.error?.message ?? null
}

/** Send it. The FI number is issued by the database at this moment, so the
 *  caller must re-read the row to learn it rather than predicting one. */
export async function submitDraft(id: string): Promise<string | null> {
  const res = await update('field_submissions', id, { status: 'submitted' })
  return res.error?.message ?? null
}

export async function discardDraft(id: string): Promise<string | null> {
  const res = await remove('field_submissions', id)
  return res.error?.message ?? null
}

type PartTable =
  | 'field_submission_persons' | 'field_submission_vehicles' | 'field_submission_orgs'
  | 'field_submission_locations' | 'field_submission_items'

export async function addPart<T extends PartTable>(
  table: T, row: TablesInsert<T>,
): Promise<string | null> {
  const res = await insert(table, row)
  return res.error?.message ?? null
}

export async function removePart(table: PartTable, id: string): Promise<string | null> {
  const res = await remove(table, id)
  return res.error?.message ?? null
}
