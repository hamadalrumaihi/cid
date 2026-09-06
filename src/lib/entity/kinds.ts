/** Entity-layer vocabulary (Portal Improvements plan, Phase 2 — P2-01…P2-09).
 *
 *  The nine SUGGEST kinds are what `entity_suggest` / `entity_duplicates`
 *  answer for (EA9); 'phone' is a search across persons and phone indicators
 *  — there is no phone entity (EA7). The six MERGE kinds are the registry
 *  records `entity_merge` / `entity_unmerge` / the observation and update
 *  RPCs accept. Everything here mirrors a server CHECK or CASE arm; the
 *  server stays the authority. */

export const SUGGEST_KINDS = ['person', 'vehicle', 'phone', 'gang', 'place', 'narcotic', 'case', 'indicator', 'account'] as const
export type SuggestKind = (typeof SUGGEST_KINDS)[number]

export const MERGE_KINDS = ['person', 'vehicle', 'gang', 'place', 'account', 'narcotic'] as const
export type MergeKind = (typeof MERGE_KINDS)[number]


export const CROSSREF_KINDS = ['person', 'vehicle', 'gang', 'place', 'account', 'narcotic', 'indicator', 'phone'] as const
export type CrossrefKind = (typeof CROSSREF_KINDS)[number]

export function isMergeKind(k: string): k is MergeKind {
  return (MERGE_KINDS as readonly string[]).includes(k)
}

/** Table behind a merge kind (private.entity_merge_table mirror). */
export const MERGE_TABLE: Record<MergeKind, 'persons' | 'vehicles' | 'gangs' | 'places' | 'accounts' | 'narcotics'> = {
  person: 'persons', vehicle: 'vehicles', gang: 'gangs', place: 'places', account: 'accounts', narcotic: 'narcotics',
}

/** Human labels, singular and plural. */
export const KIND_LABEL: Record<SuggestKind, { one: string; many: string }> = {
  person: { one: 'person', many: 'persons' },
  vehicle: { one: 'vehicle', many: 'vehicles' },
  phone: { one: 'phone number', many: 'phone numbers' },
  gang: { one: 'organisation', many: 'organisations' },
  place: { one: 'place', many: 'places' },
  narcotic: { one: 'narcotic', many: 'narcotics' },
  case: { one: 'case', many: 'cases' },
  indicator: { one: 'indicator', many: 'indicators' },
  account: { one: 'account', many: 'accounts' },
}

/** Fields a master-record update may touch (private.entity_editable_fields
 *  mirror — the server refuses anything else with code bad_request). */
export const EDITABLE_FIELDS: Record<MergeKind, readonly string[]> = {
  person: ['name', 'alias', 'dob', 'phone', 'status', 'classification', 'confidence', 'priority', 'mugshot_url', 'notes'],
  vehicle: ['plate', 'model', 'color', 'notes'],
  gang: ['name', 'aliases', 'colors', 'classification', 'status', 'confidence', 'notes'],
  place: ['name', 'area', 'notes'],
  account: ['handle', 'display_name', 'summary', 'category', 'profile_url'],
  narcotic: ['name', 'classification', 'summary', 'appearance', 'packaging', 'scene_indicators', 'officer_safety'],
}

/** The fields the create sheet collects per kind, in display order. Payload
 *  keys match `entity_duplicates(p_kind, p_payload)`: name, alias, dob,
 *  phone, plate, area, platform, handle, kind, value, case_number, title. */
export interface CreateField {
  key: string
  label: string
  /** Sent to entity_duplicates under this payload key (default: key). */
  dupKey?: string
  type?: 'text' | 'date' | 'textarea' | 'select'
  required?: boolean
  placeholder?: string
  options?: readonly { value: string; label: string }[]
}
export const CREATE_FIELDS: Record<MergeKind, readonly CreateField[]> = {
  person: [
    { key: 'name', label: 'Name', required: true },
    { key: 'alias', label: 'Alias' },
    { key: 'dob', label: 'Date of birth', type: 'date' },
    { key: 'phone', label: 'Phone' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  vehicle: [
    { key: 'plate', label: 'Plate', required: true },
    { key: 'model', label: 'Model' },
    { key: 'color', label: 'Colour' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  gang: [
    { key: 'name', label: 'Name', required: true },
    { key: 'aliases', label: 'Aliases', dupKey: 'alias' },
    { key: 'colors', label: 'Colours' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  place: [
    { key: 'name', label: 'Name', required: true },
    { key: 'type', label: 'Type', type: 'select', required: true, options: [
      { value: 'stash_house', label: 'Stash house' }, { value: 'drug_lab', label: 'Drug lab' },
      { value: 'dead_drop', label: 'Dead drop' }, { value: 'front_business', label: 'Front business' },
      { value: 'chop_shop', label: 'Chop shop' }] },
    { key: 'area', label: 'Area' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  account: [
    { key: 'platform', label: 'Platform', required: true },
    { key: 'handle', label: 'Handle', required: true },
    { key: 'display_name', label: 'Display name' },
    { key: 'summary', label: 'Summary', type: 'textarea' },
  ],
  narcotic: [
    { key: 'name', label: 'Name', required: true },
    { key: 'category', label: 'Category', required: true, type: 'select', options: [
      { value: 'cannabis', label: 'Cannabis' }, { value: 'stimulant', label: 'Stimulant' }, { value: 'opioid', label: 'Opioid' },
      { value: 'sedative', label: 'Sedative' }, { value: 'hallucinogen', label: 'Hallucinogen' }, { value: 'synthetic', label: 'Synthetic' },
      { value: 'unknown', label: 'Unknown' }] },
    { key: 'summary', label: 'Summary', type: 'textarea' },
  ],
}
