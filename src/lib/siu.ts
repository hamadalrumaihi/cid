/** Special Investigation Unit — the client mirror of the server authority
 *  model in `20260820120000_siu_phase1.sql`.
 *
 *  SIU is a SEPARATE investigative authority, not a CID rank and not a badge:
 *  a member operates EITHER as CID (`profiles.role` + `profiles.division`) or
 *  as SIU (`siu_memberships.siu_role`). Nothing in this file reads a CID role
 *  to answer an SIU question — that separation is the whole point, and it is
 *  what lets SIU investigate CID command.
 *
 *  ── This file is UX only ───────────────────────────────────────────────────
 *  Every capability below exists so a component can decide whether to render a
 *  control. The database is the authority: `private.siu_standing()` resolves
 *  the same four standings server-side, and every SIU read is gated by RLS
 *  while every SIU write goes through a `SECURITY DEFINER` RPC. Hiding a
 *  button is never the security boundary — see docs/AUTHORIZATION.md §7.
 *
 *  ── Build-phase release gate ───────────────────────────────────────────────
 *  Until SIU ships, ONLY the Portal Owner may see or use any of it. That is
 *  not scattered through the components: `siuStanding()` returns 'owner' for
 *  the owner unconditionally and `null` for everyone else while
 *  `siu_settings.enabled_for_non_owner` is false. Flipping that one flag
 *  (`siu_set_release`, owner-only, audited) turns on the production model that
 *  is already written here and in the migration — nothing is rebuilt. */

import type { Profile } from './auth'
import { list, rpc } from './db'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** The two investigative departments on the platform. A member has exactly
 *  one ACTIVE department; the Owner and the Attorney General are the only
 *  accounts that legitimately hold both contexts (see `maySwitch`). */
export const DEPARTMENTS = ['cid', 'siu'] as const
export type Department = (typeof DEPARTMENTS)[number]

export const DEPARTMENT_LABEL: Record<Department, string> = {
  cid: 'Criminal Investigation Division',
  siu: 'Special Investigation Unit',
}

/** SIU's own rank ladder. It is NOT the CID hierarchy renamed: no SIU role
 *  maps to a CID role, and the CID Director role is never granted to X-1. */
export const SIU_ROLES = ['special_agent', 'senior_special_agent', 'special_agent_in_charge'] as const
export type SiuRole = (typeof SIU_ROLES)[number]

export const SIU_ROLE_LABEL: Record<string, string> = {
  special_agent: 'Special Agent',
  senior_special_agent: 'Senior Special Agent',
  special_agent_in_charge: 'Special Agent in Charge',
}

/** Short form used on dense rows. X-Ray 1 is the operational head of SIU. */
export const SIU_ROLE_SHORT: Record<string, string> = {
  special_agent: 'Agent',
  senior_special_agent: 'Sr Agent',
  special_agent_in_charge: 'X-1',
}

/** Department-aware vocabulary. The same underlying record renders with the
 *  owning department's words — an SIU investigation never says "Lead
 *  Detective", and a CID case never says "SIU Investigation" (§20). */
export const DEPARTMENT_TERMS: Record<Department, {
  caseWord: string; caseWordPlural: string; caseHeading: string
  lead: string; member: string; command: string
}> = {
  cid: {
    caseWord: 'Case', caseWordPlural: 'Cases', caseHeading: 'CID CASE',
    lead: 'Lead Detective', member: 'Detective', command: 'CID Command',
  },
  siu: {
    caseWord: 'Investigation', caseWordPlural: 'Investigations', caseHeading: 'SIU INVESTIGATION',
    lead: 'Lead Agent', member: 'Special Agent', command: 'SIU Command',
  },
}

/** Terms for a record, chosen by the record's OWNING department rather than
 *  the viewer's — an SIU agent reading a CID case still sees CID vocabulary,
 *  with the "viewing under SIU authority" banner supplying the context. */
export const termsFor = (d: Department | string | null | undefined) =>
  DEPARTMENT_TERMS[(d === 'siu' ? 'siu' : 'cid')]

/** The department that owns a case row (`cases.case_authority`). */
export const caseDepartment = (row: { case_authority?: string | null }): Department =>
  row.case_authority === 'siu' ? 'siu' : 'cid'

export const siuRoleLabel = (r?: string | null) => (r && SIU_ROLE_LABEL[r]) || r || '—'

/** Callsigns are free-form on purpose: X-1/X-2/X-3 today, anything tomorrow.
 *  Nothing in the model hard-codes a callsign — it is a display identifier,
 *  never an authority. */
export const siuCallsign = (c?: string | null) => (c && c.trim()) || '—'

/** Case classification levels, least → most restricted. */
export const SIU_CLASSIFICATIONS = ['siu', 'siu_restricted', 'siu_command', 'siu_compartmented'] as const
export type SiuClassification = (typeof SIU_CLASSIFICATIONS)[number]

export const SIU_CLASSIFICATION_LABEL: Record<string, string> = {
  siu: 'SIU',
  siu_restricted: 'SIU Restricted',
  siu_command: 'SIU Command',
  siu_compartmented: 'SIU Compartmented',
}

export const SIU_CLASSIFICATION_HINT: Record<string, string> = {
  siu: 'Any active SIU agent.',
  siu_restricted: 'Assigned agents and SIU command.',
  siu_command: 'SIU command, plus anyone explicitly allow-listed.',
  siu_compartmented: 'Allow-list only — X-1 and the owner flag are not exempt.',
}

/** Restrained markers — a tint per level, no glow, no stamps. */
export const SIU_CLASSIFICATION_TINT: Record<string, string> = {
  siu: 'bg-slate-500/15 text-slate-300',
  siu_restricted: 'bg-amber-500/15 text-amber-300',
  siu_command: 'bg-violet-500/15 text-violet-300',
  siu_compartmented: 'bg-rose-500/15 text-rose-300',
}

export const siuClassificationLabel = (c?: string | null) =>
  (c && SIU_CLASSIFICATION_LABEL[c]) || SIU_CLASSIFICATION_LABEL.siu

export const siuClassificationTint = (c?: string | null) =>
  (c && SIU_CLASSIFICATION_TINT[c]) || SIU_CLASSIFICATION_TINT.siu

/** Investigative designations for an SIU subject. These describe a person's
 *  standing in an investigation — they are NOT findings or convictions, and
 *  the UI should never present them as such. */
export const SIU_DESIGNATIONS = [
  'person_of_interest', 'subject', 'target', 'priority_target',
  'fugitive', 'associate', 'source', 'unknown', 'cleared',
] as const
export type SiuDesignation = (typeof SIU_DESIGNATIONS)[number]

export const SIU_DESIGNATION_LABEL: Record<string, string> = {
  person_of_interest: 'Person of Interest',
  subject: 'Subject',
  target: 'Target',
  priority_target: 'Priority Target',
  fugitive: 'Fugitive',
  associate: 'Associate',
  source: 'Source',
  unknown: 'Unknown',
  cleared: 'Cleared',
}

/** The designations that make someone a PRIORITY on the dashboard. */
export const SIU_PRIORITY_DESIGNATIONS: readonly string[] =
  ['target', 'priority_target', 'fugitive']

export const siuDesignationLabel = (d?: string | null) =>
  (d && SIU_DESIGNATION_LABEL[d]) || 'Unknown'

/** Planned-action categories for an SIU operation (§26). */
export const SIU_OPERATION_CATEGORIES = [
  'surveillance', 'undercover', 'controlled', 'search_warrant',
  'arrest', 'fugitive', 'gang', 'narcotics', 'firearms',
] as const
export type SiuOperationCategory = (typeof SIU_OPERATION_CATEGORIES)[number]

export const SIU_OPERATION_CATEGORY_LABEL: Record<string, string> = {
  surveillance: 'Surveillance',
  undercover: 'Undercover Operation',
  controlled: 'Controlled Operation',
  search_warrant: 'Search Warrant',
  arrest: 'Arrest Operation',
  fugitive: 'Fugitive Apprehension',
  gang: 'Gang Operation',
  narcotics: 'Narcotics Operation',
  firearms: 'Firearms Operation',
}

export const siuOperationCategoryLabel = (c?: string | null) =>
  (c && SIU_OPERATION_CATEGORY_LABEL[c]) || 'Operation'

/** The SIU-only intelligence layer that can sit on ANY case, CID included.
 *  CID never sees that a note exists — that is what makes investigating a
 *  compromised investigator possible without alerting them (§12). */
export const SIU_NOTE_TYPES = [
  'intelligence', 'integrity_concern', 'corruption_flag', 'compromised_officer',
  'leak_concern', 'conflict_of_interest', 'surveillance_note', 'related_investigation',
] as const
export type SiuNoteType = (typeof SIU_NOTE_TYPES)[number]

export const SIU_NOTE_TYPE_LABEL: Record<string, string> = {
  intelligence: 'Intelligence',
  integrity_concern: 'Integrity Concern',
  corruption_flag: 'Corruption Flag',
  compromised_officer: 'Compromised Officer',
  leak_concern: 'Information Leak',
  conflict_of_interest: 'Conflict of Interest',
  surveillance_note: 'Surveillance Note',
  related_investigation: 'Related SIU Investigation',
}

/** The note types that count as an integrity concern against a CID case. */
export const SIU_INTEGRITY_NOTE_TYPES: readonly string[] =
  ['integrity_concern', 'corruption_flag', 'compromised_officer', 'leak_concern']

export const siuNoteTypeLabel = (t?: string | null) =>
  (t && SIU_NOTE_TYPE_LABEL[t]) || 'Intelligence'


// ── §15 disclosure vocabulary ──────────────────────────────────────────────

/** Who a release is addressed to. The four §15 routes; 'intelligence' at
 *  'cid' is the "Release Intelligence" action. */
export const SIU_AUDIENCES = ['cid', 'case_members', 'investigator'] as const

export const SIU_AUDIENCE_LABEL: Record<string, string> = {
  cid: 'Share with CID',
  case_members: 'Share with case members',
  investigator: 'Share with a specific investigator',
}

/** What the recipient sees as the addressing line, once released. */
export const SIU_AUDIENCE_SHORT: Record<string, string> = {
  cid: 'Division-wide',
  case_members: 'Case members',
  investigator: 'Named investigator',
}

export const SIU_RELEASE_ITEM_TYPES = [
  'intelligence', 'report', 'evidence', 'media', 'target', 'summary', 'warning',
] as const

export const SIU_RELEASE_ITEM_LABEL: Record<string, string> = {
  intelligence: 'Intelligence',
  report: 'Report extract',
  evidence: 'Evidence reference',
  media: 'Media reference',
  target: 'Designated subject',
  summary: 'Investigation summary',
  warning: 'Officer safety warning',
}

/** Handling caveat travelling with the released text. */
export const SIU_HANDLING = ['official_use', 'law_enforcement_sensitive', 'court_disclosable'] as const

export const SIU_HANDLING_LABEL: Record<string, string> = {
  official_use: 'Official use only',
  law_enforcement_sensitive: 'Law-enforcement sensitive',
  court_disclosable: 'Disclosable in court',
}

export const siuAudienceLabel = (a?: string | null) =>
  (a && SIU_AUDIENCE_LABEL[a]) || a || '—'
export const siuReleaseItemLabel = (t?: string | null) =>
  (t && SIU_RELEASE_ITEM_LABEL[t]) || t || '—'
export const siuHandlingLabel = (h?: string | null) =>
  (h && SIU_HANDLING_LABEL[h]) || h || '—'

// ── Phase 3 vocabulary ─────────────────────────────────────────────────────

export const SIU_SOURCE_STATUSES = [
  'proposed', 'active', 'inactive', 'closed', 'burned', 'unsuitable',
] as const

export const SIU_SOURCE_STATUS_LABEL: Record<string, string> = {
  proposed: 'Proposed', active: 'Active', inactive: 'Inactive',
  closed: 'Closed', burned: 'Burned', unsuitable: 'Unsuitable',
}

/** Admiralty-style reliability grading. A source's product is only ever as
 *  good as this says it is. */
export const SIU_RELIABILITY = [
  'reliable', 'usually_reliable', 'fairly_reliable',
  'not_usually_reliable', 'unreliable', 'untested',
] as const

export const SIU_RELIABILITY_LABEL: Record<string, string> = {
  reliable: 'Reliable',
  usually_reliable: 'Usually reliable',
  fairly_reliable: 'Fairly reliable',
  not_usually_reliable: 'Not usually reliable',
  unreliable: 'Unreliable',
  untested: 'Untested',
}

export const SIU_UNDERCOVER_STATUSES = [
  'proposed', 'authorized', 'active', 'suspended', 'concluded', 'compromised',
] as const

export const SIU_UNDERCOVER_STATUS_LABEL: Record<string, string> = {
  proposed: 'Proposed', authorized: 'Authorized', active: 'Deployed',
  suspended: 'Suspended', concluded: 'Concluded', compromised: 'Compromised',
}

export const SIU_ALLEGATIONS = [
  'evidence_tampering', 'case_fixing', 'unauthorized_disclosure', 'bribery',
  'excessive_force', 'false_reporting', 'criminal_association',
  'abuse_of_access', 'obstruction', 'other',
] as const

export const SIU_ALLEGATION_LABEL: Record<string, string> = {
  evidence_tampering: 'Evidence tampering',
  case_fixing: 'Case fixing',
  unauthorized_disclosure: 'Unauthorized disclosure',
  bribery: 'Bribery',
  excessive_force: 'Excessive force',
  false_reporting: 'False reporting',
  criminal_association: 'Criminal association',
  abuse_of_access: 'Abuse of access',
  obstruction: 'Obstruction',
  other: 'Other',
}

export const SIU_REVIEW_STATUSES = [
  'open', 'substantiated', 'unsubstantiated', 'inconclusive', 'referred', 'withdrawn',
] as const

export const SIU_REVIEW_STATUS_LABEL: Record<string, string> = {
  open: 'Open', substantiated: 'Substantiated',
  unsubstantiated: 'Unsubstantiated', inconclusive: 'Inconclusive',
  referred: 'Referred', withdrawn: 'Withdrawn',
}

export const SIU_EXPORT_SCOPES = [
  'case_summary', 'investigation_file', 'intelligence_only', 'disclosure_packet',
] as const

export const SIU_EXPORT_SCOPE_LABEL: Record<string, string> = {
  case_summary: 'Case summary',
  investigation_file: 'Full investigation file',
  intelligence_only: 'Intelligence only',
  disclosure_packet: 'Disclosure packet (court)',
}

/** Categories siu_export_case() withholds from EVERY export, for every
 *  caller. Mirrored here only so the UI can say so before the user asks. */
export const SIU_EXPORT_ALWAYS_WITHHELD = [
  'confidential_source_identities', 'undercover_legends', 'intercept_content',
] as const

export const SIU_WITHHELD_LABEL: Record<string, string> = {
  confidential_source_identities: 'Confidential source identities',
  undercover_legends: 'Undercover legends',
  intercept_content: 'Intercept content',
}

export const siuSourceStatusLabel = (s?: string | null) =>
  (s && SIU_SOURCE_STATUS_LABEL[s]) || s || '—'
export const siuReliabilityLabel = (r?: string | null) =>
  (r && SIU_RELIABILITY_LABEL[r]) || r || '—'
export const siuUndercoverStatusLabel = (s?: string | null) =>
  (s && SIU_UNDERCOVER_STATUS_LABEL[s]) || s || '—'
export const siuAllegationLabel = (a?: string | null) =>
  (a && SIU_ALLEGATION_LABEL[a]) || a || '—'
export const siuReviewStatusLabel = (s?: string | null) =>
  (s && SIU_REVIEW_STATUS_LABEL[s]) || s || '—'
export const siuExportScopeLabel = (s?: string | null) =>
  (s && SIU_EXPORT_SCOPE_LABEL[s]) || s || '—'
export const siuWithheldLabel = (c?: string | null) =>
  (c && SIU_WITHHELD_LABEL[c]) || c || '—'

// ---------------------------------------------------------------------------
// Standing — the single authority resolver
// ---------------------------------------------------------------------------

/** What authority does this account hold inside SIU right now?
 *
 *  'owner'                   Portal Owner. Holds SIU standing unconditionally
 *                            (this is the build-phase tester and the platform
 *                            authority) — but NOT a compartment key.
 *  'special_agent_in_charge' X-Ray 1, the operational head of SIU.
 *  'special_agent'           Field agent.
 *  'oversight'               Director of CID, Attorney General, or an
 *                            oversight-only appointee. Departmental oversight
 *                            (roster, appointments, audit) plus STANDARD
 *                            investigations — never restricted, command or
 *                            compartmented ones, and never field authority.
 *  null                      SIU does not exist for this account.
 */
export type SiuStanding = 'owner' | SiuRole | 'oversight'

export interface SiuMembership {
  user_id: string
  siu_role: SiuRole | string
  callsign: string | null
  oversight_only: boolean
  active: boolean
}

/** The account context an SIU capability question is asked about. `release`
 *  is `siu_settings.enabled_for_non_owner`; while it is false SIU resolves to
 *  the Owner and nobody else. `justiceRole` carries the AG's ex-officio
 *  oversight standing (see docs/AUTHORIZATION.md §2). */
export interface SiuContext {
  profile: Profile | null | undefined
  membership?: SiuMembership | null
  justiceRole?: string | null
  release?: boolean
}

/** Mirrors `private.siu_standing()` exactly. Keep the two in lockstep. */
export function siuStanding(ctx: SiuContext): SiuStanding | null {
  const p = ctx.profile
  if (!p || !p.active) return null
  // Gate-independent: SIU is owner-only until the release flag flips.
  if (p.is_owner) return 'owner'
  if (!ctx.release) return null
  const m = ctx.membership
  if (m && m.active) {
    if (m.oversight_only) return 'oversight'
    if ((SIU_ROLES as readonly string[]).includes(m.siu_role)) return m.siu_role as SiuRole
  }
  // NOTE: the server additionally excludes test fixtures (profiles.is_test)
  // from both EX-OFFICIO branches — see migration 20260829120000. The client
  // Profile type does not carry is_test and deliberately does not model it:
  // fixtures never render the UI, and useSiu() prefers the server-resolved
  // standing from siu_department_context() anyway.
  if (ctx.justiceRole === 'attorney_general') return 'oversight'
  // Director of CID — SIU's command authority per the unit's SOP. Oversight
  // standing only: departmental administration and standard investigations,
  // never restricted/command/compartmented ones, so an investigation INTO the
  // Director stays possible by classifying it above 'siu' — or, before the unit
  // is even sure, by keeping it a preliminary inquiry (§15), which oversight
  // cannot see at ANY classification. See siuCaseAccess().
  if (p.role === 'director') return 'oversight'
  return null
}

/** The member's ACTIVE department — the client mirror of
 *  `private.user_department()`. Gate-aware: while the release gate is closed
 *  everybody is 'cid', so CID is untouched during the build phase. Oversight
 *  appointees (the AG) are NOT department members — oversight authority is not
 *  departmental membership (§18). */
export function userDepartment(ctx: SiuContext): Department {
  if (!ctx.release) return 'cid'
  const m = ctx.membership
  return m && m.active && !m.oversight_only ? 'siu' : 'cid'
}

/** May this account touch SIU at all — workspace, roster, any SIU record? */
export const siuOperates = (ctx: SiuContext) => siuStanding(ctx) !== null

/** May this account deliberately switch departmental context? True only for
 *  accounts that legitimately hold BOTH (Owner, AG oversight). A normal CID
 *  member is never offered a switch, and the flag grants no data access on its
 *  own — RLS and the SIU RPCs stay the authority (§23). */
export const maySwitchDepartment = (ctx: SiuContext) => {
  const s = siuStanding(ctx)
  return s === 'owner' || s === 'oversight'
}

/** Field standing: may run investigations. Oversight-only is excluded — legal
 *  oversight is not a licence to work cases or to read all of CID. */
export const siuIsAgent = (ctx: SiuContext) => {
  const s = siuStanding(ctx)
  return s === 'owner' || s === 'special_agent_in_charge'
    || s === 'senior_special_agent' || s === 'special_agent'
}

/** SIU command — X-Ray 1 (or the owner during build phase). */
export const siuIsCommand = (ctx: SiuContext) => {
  const s = siuStanding(ctx)
  return s === 'owner' || s === 'special_agent_in_charge'
}

/** Who may appoint or remove SIU personnel: the Portal Owner, X-Ray 1, and the
 *  Attorney General. Nobody else — not the Director, not a Deputy Director,
 *  not a Bureau Lead, not a Prosecutor or Judge. There is no application
 *  queue and no self-service path anywhere in the product. */
export const siuCanAppoint = (ctx: SiuContext) => {
  const s = siuStanding(ctx)
  return s === 'owner' || s === 'special_agent_in_charge' || s === 'oversight'
}

/** Broad, READ-ONLY visibility of CID investigations across every bureau.
 *  Read only: SIU never gains a write path into CID records from this. */
export const siuCanReadCid = (ctx: SiuContext) => siuIsAgent(ctx)

/** Only the Owner may name an X-Ray 1 — the head of SIU is never appointed by
 *  the incumbent head, nor by oversight alone. */
export const siuCanAppointRole = (ctx: SiuContext, role: string) =>
  siuCanAppoint(ctx) && (role !== 'special_agent_in_charge' || siuStanding(ctx) === 'owner')

/** Only the Owner or the Attorney General may end an X-Ray 1's membership, and
 *  nobody ends their own — X-1 must not be able to manage their own oversight
 *  status away. */
export const siuCanRemove = (ctx: SiuContext, target: SiuMembership) => {
  if (!siuCanAppoint(ctx) || !target.active) return false
  if (target.user_id === ctx.profile?.id) return false
  if (target.siu_role === 'special_agent_in_charge') {
    const s = siuStanding(ctx)
    return s === 'owner' || s === 'oversight'
  }
  return true
}

/** Which classifications may this account open an investigation at? Compartmented
 *  is available to any field agent — the point of a compartment is that the
 *  agent who opens it decides who else is ever on the list. */
export const siuAssignableClassifications = (ctx: SiuContext): readonly SiuClassification[] =>
  siuIsAgent(ctx) ? SIU_CLASSIFICATIONS : []

/** Can this account SEE this SIU investigation, given the classification and
 *  the caller's assignment/compartment facts? Mirrors the server's READ
 *  predicate, `private.siu_case_read()` — the write/command wall
 *  `siu_case_access()` is the same thing minus the `oversight` branch below,
 *  which is why the Director and the AG can read a standard investigation and
 *  still not touch a row of it. Note the compartmented branch: no standing —
 *  owner included — substitutes for an allow-list row. */
export function siuCaseAccess(
  ctx: SiuContext,
  caseRow: { siu_classification?: string | null; siu_stage?: string | null },
  facts: { assigned?: boolean; inCompartment?: boolean; recused?: boolean } = {},
): boolean {
  const s = siuStanding(ctx)
  if (!s) return false
  // §17. A live conflict beats every grant below, rank and owner included —
  // mirrors the recusal branch at the top of `private.siu_case_access()`.
  if (facts.recused) return false
  const command = s === 'owner' || s === 'special_agent_in_charge'
  switch (caseRow.siu_classification ?? 'siu') {
    case 'siu_compartmented':
      return !!facts.inCompartment
    case 'siu_command':
      return command || !!facts.inCompartment
    case 'siu_restricted':
      return command
        || ((s === 'special_agent' || s === 'senior_special_agent') && !!facts.assigned)
        || !!facts.inCompartment
    default:
      // Standard investigations are visible to field agents AND to oversight
      // authority (Director of CID, Attorney General) per the SOP — except
      // while the case is a PRELIMINARY INQUIRY (§15), which oversight cannot
      // see at any classification. Field access is unaffected.
      if (command || s === 'special_agent' || s === 'senior_special_agent') return true
      if (facts.inCompartment) return true
      return s === 'oversight' && caseRow.siu_stage !== 'preliminary_inquiry'
  }
}

/** §14. Who may work the intake queue. Field standing only, NOT oversight: a
 *  referral may name the Director of CID, and reading the queue would hand its
 *  subject the allegations against them. Oversight sees referral VOLUME through
 *  `siu_oversight_report()` and never contents. */
export const siuCanReviewReferrals = (ctx: SiuContext) => siuIsAgent(ctx)

/** §17. Resolving a conflict is a command act, and never one's own — the
 *  not-self rule lives in `public.siu_resolve_conflict()`. */
export const siuCanResolveConflict = (ctx: SiuContext, conflict: { agent_id: string }) =>
  siuIsCommand(ctx) && conflict.agent_id !== ctx.profile?.id

// ---------------------------------------------------------------------------
// Data access — every SIU read/write goes through a gated RPC
// ---------------------------------------------------------------------------

/** Dashboard payload from `siu_overview()`. An unauthorized caller gets
 *  `{ access: false }` rather than an error, so the workspace can render the
 *  standard not-found behavior without the response itself confirming that
 *  anything exists. */
export interface SiuOverview {
  access: boolean
  standing?: SiuStanding
  release_open?: boolean
  investigations?: number
  open_investigations?: number
  assigned?: number
  compartmented?: number
  agents?: number
  legal_pending?: number
  priority_targets?: number
  active_targets?: number
  active_operations?: number
  open_intel?: number
  /** Unresolved SIU integrity concerns raised against CID investigations. */
  cid_integrity_flags?: number
  surveillance_active?: number
  /** null for oversight-only standing — no broad CID read. */
  cid_recent_cases?: number | null
  cid_open_cases?: number | null
}

export async function fetchSiuOverview(): Promise<SiuOverview> {
  const res = await rpc('siu_overview', {})
  if (res.error) throw new Error(res.error.message)
  return (res.data as unknown as SiuOverview | null) ?? { access: false }
}

export interface SiuRosterRow {
  user_id: string
  display_name: string | null
  badge_number: string | null
  siu_role: string
  callsign: string | null
  oversight_only: boolean
  active: boolean
  appointed_by: string | null
  appointed_by_name: string | null
  appointed_at: string
  ended_at: string | null
  end_reason: string | null
  /** Historical CID rank/bureau. Shown as provenance, never as authority —
   *  no SIU rule anywhere reads it. */
  former_cid_role: string | null
  former_cid_bureau: string | null
  last_activity: string | null
}

export async function fetchSiuRoster(): Promise<SiuRosterRow[]> {
  const res = await rpc('siu_roster', {})
  if (res.error) throw new Error(res.error.message)
  return (res.data as unknown as SiuRosterRow[] | null) ?? []
}

export interface SiuCandidate {
  id: string
  display_name: string | null
  badge_number: string | null
  cid_role: string | null
  cid_bureau: string | null
}

export async function searchSiuCandidates(q: string): Promise<SiuCandidate[]> {
  const res = await rpc('siu_member_search', { p_q: q })
  if (res.error) throw new Error(res.error.message)
  return (res.data as unknown as SiuCandidate[] | null) ?? []
}

export interface SiuAuditRow {
  id: number
  created_at: string
  action: string
  entity_id: string | null
  actor_id: string | null
  actor_name: string | null
  detail: Record<string, unknown> | null
}

export async function fetchSiuAudit(limit = 100): Promise<SiuAuditRow[]> {
  const res = await rpc('siu_audit_feed', { p_limit: limit })
  if (res.error) throw new Error(res.error.message)
  return (res.data as unknown as SiuAuditRow[] | null) ?? []
}

/** §15 — one released item, as SIU sees it. The CID side never reads this
 *  table at all; it calls `siu_released_intelligence()`, which projects no
 *  origin. */
export interface SiuDisclosure {
  id: string
  siu_case_id: string
  item_type: string
  audience: string
  target_case_id: string | null
  target_user_id: string | null
  title: string
  body: string
  handling: string
  reason: string
  released_by: string | null
  released_at: string
  revoked_at: string | null
  revoke_reason: string | null
  acknowledged_at: string | null
  acknowledged_by: string | null
}

/** The CID-facing shape. Note what is NOT here: no `siu_case_id`, no source
 *  item, no case number — the origin investigation is never disclosed. */
export interface SiuReleasedItem {
  id: string
  item_type: string
  title: string
  body: string
  handling: string
  audience: string
  target_case_id: string | null
  released_at: string
  acknowledged_at: string | null
  acknowledged_by: string | null
}

/** What SIU released, for the SIU workspace. RLS-scoped to investigations the
 *  caller can read. */
export async function fetchSiuDisclosures(caseId?: string): Promise<SiuDisclosure[]> {
  const rows = await list('siu_disclosures', {
    order: 'released_at', ascending: false, limit: 200,
    ...(caseId ? { eq: { siu_case_id: caseId } } : {}),
  })
  return rows as unknown as SiuDisclosure[]
}

/** What CID has been told — called from the CID side, including by accounts
 *  with no SIU standing at all. An empty array is the honest answer for
 *  "nothing was released to you". */
export async function fetchReleasedIntelligence(caseId?: string): Promise<SiuReleasedItem[]> {
  const res = await rpc('siu_released_intelligence', caseId ? { p_case: caseId } : {})
  // A miss and "nothing released" are the same answer: never surface an error
  // state that would tell a CID user something exists that they cannot see.
  if (res.error) return []
  return (res.data as unknown as SiuReleasedItem[] | null) ?? []
}

/** Aggregate-only supervision surface for the SOP chain (Director of CID,
 *  Attorney General). Deliberately carries no identity of any kind. */
export interface SiuOversightReport {
  access: boolean
  standing?: SiuStanding
  generated_at?: string
  investigations?: Record<string, number>
  control?: Record<string, number>
  disclosure?: Record<string, number>
  integrity?: Record<string, number>
  tradecraft?: Record<string, number>
  exports?: Record<string, number>
  personnel?: Record<string, number>
}

export async function fetchSiuOversightReport(): Promise<SiuOversightReport> {
  const res = await rpc('siu_oversight_report', {})
  if (res.error) throw new Error(res.error.message)
  return (res.data as unknown as SiuOversightReport | null) ?? { access: false }
}

/** One withheld category on an export payload. */
export interface SiuWithheld { category: string; count: number }

export interface SiuExportRow {
  id: string
  case_id: string
  scope: string
  reason: string
  item_count: number
  withheld: SiuWithheld[]
  exported_by: string | null
  exported_at: string
}

export async function fetchSiuExports(caseId?: string): Promise<SiuExportRow[]> {
  const rows = await list('siu_exports', {
    order: 'exported_at', ascending: false, limit: 100,
    ...(caseId ? { eq: { case_id: caseId } } : {}),
  })
  return rows as unknown as SiuExportRow[]
}

// ---------------------------------------------------------------------------
// §14 Intake — the referral queue
// ---------------------------------------------------------------------------

/** What a referral is ABOUT. Distinct from SIU_CASE_CATEGORIES: a referral is
 *  an untested allegation and is categorised by the reporter, who is usually
 *  not an investigator. The case category is assigned later, by SIU, once the
 *  unit knows what it actually has. */
export const SIU_REFERRAL_CATEGORIES = [
  'corruption', 'misconduct', 'organized_crime', 'narcotics_trafficking',
  'firearms_trafficking', 'criminal_conspiracy', 'fugitive', 'internal_leak',
  'compromised_investigation', 'other',
] as const

export const SIU_REFERRAL_CATEGORY_LABEL: Record<string, string> = {
  corruption: 'Corruption',
  misconduct: 'Misconduct',
  organized_crime: 'Organized crime',
  narcotics_trafficking: 'Narcotics trafficking',
  firearms_trafficking: 'Firearms trafficking',
  criminal_conspiracy: 'Criminal conspiracy',
  fugitive: 'Fugitive',
  internal_leak: 'Internal leak',
  compromised_investigation: 'Compromised investigation',
  other: 'Other',
}

export const SIU_REFERRAL_STATUSES = [
  'submitted', 'under_review', 'accepted', 'declined',
  'referred_to_cid', 'info_requested', 'withdrawn',
] as const
export type SiuReferralStatus = (typeof SIU_REFERRAL_STATUSES)[number]

export const SIU_REFERRAL_STATUS_LABEL: Record<string, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  accepted: 'Accepted',
  declined: 'Declined',
  referred_to_cid: 'Referred to CID',
  info_requested: 'More information requested',
  withdrawn: 'Withdrawn',
}

/** Dispositions a reviewer may choose. `submitted` is absent deliberately — it
 *  is the arrival state, not something a review can set. */
export const SIU_REFERRAL_DISPOSITIONS: readonly SiuReferralStatus[] =
  SIU_REFERRAL_STATUSES.filter((s) => s !== 'submitted')

export const siuReferralCategoryLabel = (c?: string | null) =>
  (c && SIU_REFERRAL_CATEGORY_LABEL[c]) || c || '—'
export const siuReferralStatusLabel = (s?: string | null) =>
  (s && SIU_REFERRAL_STATUS_LABEL[s]) || s || '—'

export const siuReferralStatusTint = (s?: string | null): string =>
  s === 'accepted' ? 'bg-emerald-500/15 text-emerald-300'
  : s === 'declined' || s === 'withdrawn' ? 'bg-slate-500/15 text-slate-300'
  : s === 'submitted' ? 'bg-amber-500/15 text-amber-300'
  : 'bg-blue-500/15 text-blue-300'

/** A referral, as a FIELD AGENT sees it. Oversight standing never reads this
 *  shape at all — a referral can name the Director of CID, so the intake queue
 *  is gated on `private.siu_is_agent()` and not on standing generally. */
export interface SiuReferral {
  id: string
  category: string
  summary: string
  detail: string | null
  subject_user_id: string | null
  subject_description: string | null
  related_case_id: string | null
  submitted_by: string | null
  submitted_at: string
  status: string
  review_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  opened_case_id: string | null
}

/** The SUBMITTER's view: a receipt, and deliberately nothing else. Whether SIU
 *  acted, declined, or opened an investigation is not disclosed — otherwise a
 *  referral becomes a way to probe what SIU is doing. */
export interface SiuMyReferral {
  id: string
  category: string
  summary: string
  submitted_at: string
  acknowledged: boolean
}

export async function fetchSiuReferrals(): Promise<SiuReferral[]> {
  const rows = await list('siu_referrals', {
    order: 'submitted_at', ascending: false, limit: 200,
  })
  return rows as unknown as SiuReferral[]
}

export async function fetchMySiuReferrals(): Promise<SiuMyReferral[]> {
  const res = await rpc('siu_my_referrals', {})
  if (res.error) throw new Error(res.error.message)
  return (res.data as unknown as SiuMyReferral[] | null) ?? []
}

// ---------------------------------------------------------------------------
// §15/§32/§33 Case lifecycle
// ---------------------------------------------------------------------------

/** §15. A preliminary inquiry is SIU deciding whether an allegation is real.
 *  It carries TIGHTER visibility than a full investigation: oversight cannot
 *  see one at all, at any classification. Promotion is the moment it becomes
 *  visible to the Director and the Attorney General. */
export const SIU_STAGES = ['preliminary_inquiry', 'investigation'] as const

export const SIU_STAGE_LABEL: Record<string, string> = {
  preliminary_inquiry: 'Preliminary inquiry',
  investigation: 'Full investigation',
}

export const SIU_STAGE_HINT: Record<string, string> = {
  preliminary_inquiry:
    'Assessing whether the allegation is real. Not visible to oversight — the Director and the Attorney General see it only once it is promoted.',
  investigation: 'A committed investigation. Visible to oversight at standard classification.',
}

export const siuStageLabel = (s?: string | null) =>
  (s && SIU_STAGE_LABEL[s]) || 'Full investigation'
export const siuStageTint = (s?: string | null): string =>
  s === 'preliminary_inquiry' ? 'bg-amber-500/15 text-amber-300' : 'bg-white/5 text-slate-300'
export const isPreliminaryInquiry = (row: { siu_stage?: string | null }) =>
  row.siu_stage === 'preliminary_inquiry'

/** §32. SUBJECT MATTER, deliberately orthogonal to classification, which is
 *  SENSITIVITY. An organized-crime case can be routine; a narcotics case can be
 *  compartmented. Conflating the two is how a unit ends up classifying
 *  everything at the top level because the subject sounds serious. */
export const SIU_CASE_CATEGORIES = [
  'public_corruption', 'law_enforcement_integrity', 'organized_crime', 'gang',
  'narcotics', 'firearms', 'fugitive', 'major_crime', 'internal_leak', 'other',
] as const

export const SIU_CASE_CATEGORY_LABEL: Record<string, string> = {
  public_corruption: 'Public corruption',
  law_enforcement_integrity: 'Law enforcement integrity',
  organized_crime: 'Organized crime',
  gang: 'Gang',
  narcotics: 'Narcotics',
  firearms: 'Firearms',
  fugitive: 'Fugitive',
  major_crime: 'Major crime',
  internal_leak: 'Internal leak',
  other: 'Other',
}

export const siuCaseCategoryLabel = (c?: string | null) =>
  (c && SIU_CASE_CATEGORY_LABEL[c]) || c || '—'

/** §33. Closing always carries WHY, from a fixed list, plus a free note. */
export const SIU_CLOSURE_REASONS = [
  'arrest_prosecution', 'referred_to_cid', 'referred_to_doj', 'administrative_action',
  'unfounded', 'insufficient_evidence', 'intelligence_only', 'merged', 'inactive', 'other',
] as const

export const SIU_CLOSURE_REASON_LABEL: Record<string, string> = {
  arrest_prosecution: 'Arrest / prosecution',
  referred_to_cid: 'Referred to CID',
  referred_to_doj: 'Referred to the Department of Justice',
  administrative_action: 'Administrative action',
  unfounded: 'Unfounded',
  insufficient_evidence: 'Insufficient evidence',
  intelligence_only: 'Intelligence only',
  merged: 'Merged into another investigation',
  inactive: 'Inactive',
  other: 'Other',
}

export const siuClosureReasonLabel = (r?: string | null) =>
  (r && SIU_CLOSURE_REASON_LABEL[r]) || r || '—'

// ---------------------------------------------------------------------------
// §17 Conflict of interest
// ---------------------------------------------------------------------------

export const SIU_CONFLICT_STATUSES = ['declared', 'acknowledged', 'reassigned', 'cleared'] as const
export type SiuConflictStatus = (typeof SIU_CONFLICT_STATUSES)[number]

export const SIU_CONFLICT_STATUS_LABEL: Record<string, string> = {
  declared: 'Declared',
  acknowledged: 'Acknowledged',
  reassigned: 'Reassigned',
  cleared: 'Cleared',
}

/** Resolutions a reviewer may set. `declared` is absent — it is the arrival
 *  state, set by the agent stepping back, not something command assigns. */
export const SIU_CONFLICT_RESOLUTIONS: readonly SiuConflictStatus[] =
  SIU_CONFLICT_STATUSES.filter((s) => s !== 'declared')

export const siuConflictStatusLabel = (s?: string | null) =>
  (s && SIU_CONFLICT_STATUS_LABEL[s]) || s || '—'

/** Mirrors `private.siu_recused()`. ONLY `cleared` lifts the veto:
 *  `reassigned` means the conflict was real and the case moved on, which is not
 *  a reason to hand the file back. */
export const siuRecusesAccess = (status?: string | null) => status !== 'cleared'

export interface SiuConflict {
  id: string
  case_id: string
  agent_id: string
  reason: string
  status: string
  declared_at: string
  acknowledged_by: string | null
  acknowledged_at: string | null
  resolution_note: string | null
}

export async function fetchSiuConflicts(caseId?: string): Promise<SiuConflict[]> {
  const rows = await list('siu_conflicts', {
    order: 'declared_at', ascending: false, limit: 100,
    ...(caseId ? { eq: { case_id: caseId } } : {}),
  })
  return rows as unknown as SiuConflict[]
}

/** Human wording for the SIU audit actions. Unknown actions fall back to the
 *  raw token rather than being hidden — an audit surface never silently drops
 *  a row it doesn't recognise. */
export const SIU_AUDIT_LABEL: Record<string, string> = {
  SIU_OPERATION_CREATED: 'Operation created',
  SIU_APPOINTED: 'Agent appointed',
  SIU_REMOVED: 'Agent removed',
  SIU_CALLSIGN_CHANGED: 'Callsign changed',
  SIU_RELEASE_SET: 'Release gate changed',
  SIU_CASE_CREATED: 'Investigation opened',
  SIU_CLASSIFICATION_CHANGED: 'Classification changed',
  SIU_AGENT_ASSIGNED: 'Agent assigned',
  SIU_AGENT_UNASSIGNED: 'Agent unassigned',
  SIU_COMPARTMENT_GRANTED: 'Compartment access granted',
  SIU_COMPARTMENT_REVOKED: 'Compartment access revoked',
  SIU_CASE_ASSUMED: 'SIU control assumed of a CID case',
  SIU_CASE_RETURNED: 'Control returned to CID',
  SIU_INTEL_RELEASED: 'Intelligence released to CID',
  SIU_INTEL_REVOKED: 'Release revoked',
  SIU_INTEL_ACKNOWLEDGED: 'Release acknowledged',
  SIU_EXPORTED: 'Investigation exported',
  SIU_REFERRAL_SUBMITTED: 'Referral submitted',
  SIU_REFERRAL_REVIEWED: 'Referral reviewed',
  SIU_INQUIRY_PROMOTED: 'Inquiry promoted to investigation',
  SIU_CATEGORY_SET: 'Case category set',
  SIU_CASE_CLOSED: 'Investigation closed',
  SIU_CONFLICT_DECLARED: 'Conflict of interest declared',
  SIU_CONFLICT_RESOLVED: 'Conflict of interest resolved',
}

export const siuAuditLabel = (a: string) => SIU_AUDIT_LABEL[a] ?? a
