/** Pure model for the Narcotics substance DOSSIER.
 *
 *  Intentionally PURE — no React, no db, no I/O. It owns the section
 *  whitelist + URL guard, the display vocabulary (categories, roles, link
 *  statuses, seizure states), staleness, the charge-code resolver (against
 *  PENAL_CODE — charge_codes holds code strings, there is no FK), the
 *  client-side activity-timeline assembler, and the suggestion-form
 *  vocabulary + param builder. The dossier shell, the section components and
 *  the suggestion form all import from here so labels, guards and payloads
 *  stay in one testable place. Authority is always server-side (RLS + the
 *  definer RPCs); nothing here decides access — it only shapes what is shown. */
import type { Json, Tables } from '@/lib/database.types'
import { PENAL_CODE, type PenalCharge } from '@/lib/penal'
import type { TimelineEntry } from '@/components/ui/WorkflowTimeline'

export type NarcoticRow = Tables<'narcotics'>

/* ── Sections + URL guard ─────────────────────────────────────────────────── */
export const SECTION_IDS = [
  'overview', 'identification', 'packaging', 'intelligence',
  'sales', 'cases', 'seizures', 'places', 'people', 'media', 'activity',
] as const
export type SectionId = (typeof SECTION_IDS)[number]

/** Whitelist-guard a raw `?section=` value, defaulting to the overview. */
export function sectionFromParam(raw: string | null | undefined): SectionId {
  return (SECTION_IDS as readonly string[]).includes(raw ?? '') ? (raw as SectionId) : 'overview'
}

/* ── Review / staleness ───────────────────────────────────────────────────── */
/** Narcotics intelligence is reviewed on a longer cadence than persons/gangs —
 *  substance descriptions change slowly. Overdue past this many days → stale. */
export const NARCOTIC_REVIEW_DAYS = 180

export function isNarcoticStale(reviewedAt: string | null | undefined, now: number, thresholdDays = NARCOTIC_REVIEW_DAYS): boolean {
  if (!reviewedAt) return true
  const t = Date.parse(reviewedAt)
  if (Number.isNaN(t)) return true
  return (now - t) / 86_400_000 > thresholdDays
}

/* ── Display vocabulary ───────────────────────────────────────────────────── */
/** snake_case / lowercase → "Title Case" for human display. */
export function humanize(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export const categoryLabel = (c: string | null | undefined): string => humanize(c) || 'Uncategorised'
export const statusLabel = (s: string | null | undefined): string => humanize(s) || 'Unknown'

/** Map a narcotic status to a canonical lifecycle keyword so the shared
 *  `statusTint` (lib/tint) colours it — colours stay centralised, never
 *  hand-rolled here. */
export function statusTintKey(status: string | null | undefined): string {
  switch ((status ?? '').toLowerCase()) {
    case 'provisional': return 'open'          // amber — needs confirmation
    case 'confirmed': return 'active'          // emerald — established
    case 'merged':
    case 'retired': return 'archived'          // muted
    case 'disproven': return 'closed'
    default: return status ?? ''
  }
}

/** narcotic_places.role — the production/handling roles the Intelligence
 *  section reads (generalized stage names only, never a recipe). */
export const PRODUCTION_ROLES = ['cultivated_at', 'produced_at', 'processed_at', 'packaged_at'] as const
export function isProductionRole(role: string | null | undefined): boolean {
  return (PRODUCTION_ROLES as readonly string[]).includes(role ?? '')
}

/** Generalized, non-actionable production stages — plain labels, no
 *  ingredients/ratios/temps/steps. */
export const PRODUCTION_STAGES = ['Cultivation', 'Processing', 'Packaging', 'Distribution'] as const

export const placeRoleLabel = (role: string | null | undefined): string => humanize(role) || 'Associated'
export const linkRoleLabel = (role: string | null | undefined): string => humanize(role) || 'Associated'

/** narcotic_seizures.state — shown with the amount VERBATIM, never normalized. */
export function seizureStateLabel(state: string | null | undefined): string {
  switch ((state ?? '').toLowerCase()) {
    case 'lab_confirmed': return 'Lab confirmed'
    case 'confirmed': return 'Confirmed'
    case 'suspected': return 'Suspected'
    default: return humanize(state) || 'Recorded'
  }
}
export function seizureStateTintKey(state: string | null | undefined): string {
  switch ((state ?? '').toLowerCase()) {
    case 'lab_confirmed':
    case 'confirmed': return 'active'
    case 'suspected': return 'open'
    default: return ''
  }
}

/** People/gangs links flagged `possible_mention` must read distinctly from a
 *  confirmed association. */
export function isPossibleMention(linkStatus: string | null | undefined): boolean {
  return (linkStatus ?? '').toLowerCase() === 'possible_mention'
}
export function linkStatusLabel(linkStatus: string | null | undefined): string {
  if (isPossibleMention(linkStatus)) return 'Possible mention'
  return humanize(linkStatus) || 'Linked'
}

/** How a case is related to the substance (confirmed vs suspected vs
 *  mention). Durable intel links are confirmed; seizures inherit their own
 *  state; a place's source case is a mention. */
export type CaseRelation = 'linked' | 'seizure' | 'mention'
export const CASE_RELATION_LABEL: Record<CaseRelation, string> = {
  linked: 'Confirmed link',
  seizure: 'Seizure record',
  mention: 'Mentioned via place',
}

/* ── Charges — resolve code strings against PENAL_CODE (no FK) ────────────── */
const PENAL_BY_CODE: Map<string, PenalCharge> = new Map(PENAL_CODE.map((c) => [c.code, c]))

/** charge_codes is a JSON array of penal-code strings. Returns the trimmed,
 *  de-duplicated, non-empty codes in stored order. */
export function parseChargeCodes(codes: Json | null | undefined): string[] {
  if (!Array.isArray(codes)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const c of codes) {
    if (typeof c !== 'string') continue
    const t = c.trim()
    if (t && !seen.has(t)) { seen.add(t); out.push(t) }
  }
  return out
}

export interface ResolvedCharge {
  code: string
  /** The matching PENAL_CODE entry, or null when the code isn't recognised. */
  charge: PenalCharge | null
}

/** Resolve stored charge codes to PENAL_CODE entries (unknown codes surface
 *  with `charge: null` so nothing is silently dropped). Never duplicates the
 *  charge text — callers render code + title only. */
export function resolveCharges(codes: Json | null | undefined): ResolvedCharge[] {
  return parseChargeCodes(codes).map((code) => ({ code, charge: PENAL_BY_CODE.get(code) ?? null }))
}

/* ── Activity timeline (client-side, from the row's own dates + child
 *    created_at — NOT audit_log) ─────────────────────────────────────────── */
export interface ActivityChildren {
  aliases?: Array<{ id: string; created_at: string; alias: string }>
  seizures?: Array<{ id: string; created_at: string; state: string; location: string | null }>
  places?: Array<{ id: string; created_at: string; role: string }>
  persons?: Array<{ id: string; created_at: string; role: string }>
  gangs?: Array<{ id: string; created_at: string; role: string }>
  caseLinks?: Array<{ id: string; created_at: string }>
  media?: Array<{ id: string; created_at: string; title: string }>
}

type NarcoticDates = Pick<
  NarcoticRow,
  'created_at' | 'created_by' | 'updated_at' | 'reviewed_at' | 'reviewed_by' | 'first_recorded_at' | 'last_confirmed_at'
>

/** Build a newest-first timeline. `nameOf` resolves actor ids → display names
 *  (injected so the model stays pure/testable). */
export function buildNarcoticActivity(
  row: NarcoticDates,
  children: ActivityChildren,
  nameOf: (id: string | null | undefined) => string | null = () => null,
): TimelineEntry[] {
  const e: TimelineEntry[] = []
  if (row.created_at) e.push({ id: 'created', title: 'Record created', at: row.created_at, actor: nameOf(row.created_by) })
  if (row.first_recorded_at) e.push({ id: 'first-recorded', title: 'First recorded in the city', at: row.first_recorded_at })
  if (row.last_confirmed_at) e.push({ id: 'last-confirmed', title: 'Last confirmed present', at: row.last_confirmed_at })
  if (row.updated_at && row.updated_at !== row.created_at) e.push({ id: 'updated', title: 'Record updated', at: row.updated_at })
  if (row.reviewed_at) e.push({ id: 'reviewed', title: 'Intelligence reviewed', at: row.reviewed_at, actor: nameOf(row.reviewed_by) })
  for (const a of children.aliases ?? []) e.push({ id: `al-${a.id}`, title: `Alias recorded: ${a.alias}`, at: a.created_at })
  for (const s of children.seizures ?? []) e.push({ id: `sz-${s.id}`, title: 'Seizure logged', at: s.created_at, note: [seizureStateLabel(s.state), s.location].filter(Boolean).join(' · ') || undefined })
  for (const p of children.places ?? []) e.push({ id: `pl-${p.id}`, title: 'Place linked', at: p.created_at, note: placeRoleLabel(p.role) })
  for (const p of children.persons ?? []) e.push({ id: `pe-${p.id}`, title: 'Person linked', at: p.created_at, note: linkRoleLabel(p.role) })
  for (const g of children.gangs ?? []) e.push({ id: `ga-${g.id}`, title: 'Gang linked', at: g.created_at, note: linkRoleLabel(g.role) })
  for (const l of children.caseLinks ?? []) e.push({ id: `cl-${l.id}`, title: 'Case link added', at: l.created_at })
  for (const m of children.media ?? []) e.push({ id: `md-${m.id}`, title: `Media added: ${m.title || 'item'}`, at: m.created_at })
  const seen = new Set<string>()
  return e
    .filter((x) => x.at && !seen.has(x.id) && seen.add(x.id))
    .sort((x, y) => (y.at || '').localeCompare(x.at || ''))
}

/* ── Suggestion-form vocabulary (submit_narcotic_suggestion) ──────────────── */
export type NarcoticSuggestionType =
  | 'incorrect_name' | 'missing_alias' | 'wrong_category' | 'incorrect_description'
  | 'missing_packaging' | 'missing_charge_link' | 'missing_case_link' | 'missing_place_link'
  | 'new_substance' | 'duplicate' | 'other'

export const NARCOTIC_SUGGESTION_TYPES: readonly NarcoticSuggestionType[] = [
  'incorrect_name', 'missing_alias', 'wrong_category', 'incorrect_description',
  'missing_packaging', 'missing_charge_link', 'missing_case_link', 'missing_place_link',
  'new_substance', 'duplicate', 'other',
]

export const NARCOTIC_SUGGESTION_TYPE_LABEL: Record<NarcoticSuggestionType, string> = {
  incorrect_name: 'Incorrect name',
  missing_alias: 'Missing an alias / street name',
  wrong_category: 'Wrong category',
  incorrect_description: 'Incorrect description',
  missing_packaging: 'Missing packaging detail',
  missing_charge_link: 'Missing a related charge',
  missing_case_link: 'Missing a related case',
  missing_place_link: 'Missing a related place',
  new_substance: 'Propose a new substance',
  duplicate: 'This is a duplicate',
  other: 'Something else',
}

export const NARCOTIC_SUGGESTION_TYPE_HINT: Record<NarcoticSuggestionType, string> = {
  incorrect_name: 'The recorded name is wrong or misspelled.',
  missing_alias: 'A street name or alias should be added.',
  wrong_category: 'This substance is filed under the wrong category.',
  incorrect_description: 'The appearance, form, or summary is inaccurate.',
  missing_packaging: 'A packaging type seen in the field isn’t listed.',
  missing_charge_link: 'A related penal-code charge should be associated.',
  missing_case_link: 'A case involving this substance isn’t linked.',
  missing_place_link: 'A place tied to this substance isn’t linked.',
  new_substance: 'This should exist as its own registry entry.',
  duplicate: 'Another registry entry already covers this substance.',
  other: 'Anything that doesn’t fit the categories above.',
}

export interface NarcoticSuggestionInput {
  narcoticId: string
  type: NarcoticSuggestionType
  title: string
  explanation: string
  proposedValue?: string | null
  sourceCaseId?: string | null
  sourceEvidenceId?: string | null
  sourceReportId?: string | null
}

export interface NarcoticSuggestionParams {
  p_narcotic: string
  p_type: string
  p_title: string
  p_explanation: string
  p_proposed_value: string | null
  p_source_case: string | null
  p_source_evidence: string | null
  p_source_report: string | null
}

/** Map form state → the RPC's positional `p_*` params (single source of truth,
 *  so the form never hand-assembles the payload). */
export function narcoticSuggestionParams(input: NarcoticSuggestionInput): NarcoticSuggestionParams {
  const clean = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim()
    return t === '' ? null : t
  }
  return {
    p_narcotic: input.narcoticId,
    p_type: input.type,
    p_title: input.title.trim(),
    p_explanation: input.explanation.trim(),
    p_proposed_value: clean(input.proposedValue),
    p_source_case: clean(input.sourceCaseId),
    p_source_evidence: clean(input.sourceEvidenceId),
    p_source_report: clean(input.sourceReportId),
  }
}

/** Client-side mirror of the RPC's required fields (the server stays the
 *  authority; this only gates the submit button). */
export function narcoticSuggestionFormError(input: {
  type: NarcoticSuggestionType | ''
  title: string
  explanation: string
}): string | null {
  if (!input.type) return 'Choose what kind of correction this is.'
  if (input.title.trim() === '') return 'Add a short title.'
  if (input.explanation.trim() === '') return 'Explain the correction you’re suggesting.'
  return null
}
