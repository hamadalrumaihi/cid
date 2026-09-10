/** Action Center presets + the saved-view config shape (Phase 7, P7-05 / #377).
 *
 *  A preset is a named, role-shaped starting point for the queue: which
 *  type chip (`f`), status chip (`s`) and lanes (`sections`) are on. It is
 *  PURE client filter state over rows RLS already let the viewer read —
 *  `available(viewer)` only decides which presets are worth OFFERING (a
 *  detective is not shown "Command"); choosing one never widens anything.
 *  `?preset=<id>` in the URL applies one; the ViewsMenu lists them next to
 *  the member's own saved views (`useSavedViews<ActionViewConfig>('action')`). */

import type { ActionSourceType } from './actionItems'

/** The queue's lanes (ActionCenterView.SECTION_ORDER + the activity fold). */
export type ActionSectionKey =
  | 'overdue' | 'returned' | 'personal' | 'command' | 'intel' | 'bolo' | 'waiting' | 'drafts' | 'activity'

export const ALL_SECTIONS: readonly ActionSectionKey[] =
  ['overdue', 'returned', 'personal', 'command', 'intel', 'bolo', 'waiting', 'drafts', 'activity']

/** Status chips (`?s=`) — the predicates live in ActionCenterView. */
export const ACTION_STATUS_KEYS = ['overdue', 'due', 'waiting', 'command', 'escalated', 'returns'] as const
export type ActionStatusKey = (typeof ACTION_STATUS_KEYS)[number]

/** Type chips (`?f=`): every queue kind grouped into a chip the way members
 *  think about the work — not one chip per sourceType (46 of them). The
 *  test pins that every key of `SOURCE_TYPE_LABEL` lands in exactly one
 *  group, so a new builder kind cannot silently fall outside "All". */
export interface ActionTypeFilter {
  key: string
  label: string
  types: readonly ActionSourceType[]
  /** Optional standing gate — a chip whose kinds a viewer can never produce
   *  is not OFFERED (the Informants chip must not advertise the compartment
   *  to an uninvolved member). Absent = always offered. Pure client filter
   *  state either way: choosing a chip never widens anything. */
  available?: (v: PresetViewer) => boolean
}

export const ACTION_TYPE_FILTERS: readonly ActionTypeFilter[] = [
  { key: 'task', label: 'Tasks', types: ['task'] },
  { key: 'signoff', label: 'Sign-offs', types: ['signoff', 'returned_case'] },
  // Transfers covers both bureau transfer_requests and DOJ member_transfers
  // (one sourceType — distinct member_transfer: keys).
  { key: 'transfer', label: 'Transfers', types: ['transfer'] },
  { key: 'access', label: 'Access', types: ['access_request', 'access_expiring', 'membership_request', 'restricted_access', 'restricted_export', 'field_access'] },
  { key: 'legal', label: 'Legal', types: ['legal_request', 'legal_comment', 'legal_hold'] },
  // DOJ pipeline work (judicial queue pickups, assigned reviews) and justice
  // applications — only justice-role / admin viewers ever produce these.
  { key: 'doj', label: 'DOJ queue', types: ['legal_queue', 'justice_application'] },
  { key: 'followup', label: 'Follow-ups', types: ['case_followup'] },
  { key: 'blocker', label: 'Blockers', types: ['blocker'] },
  { key: 'surveillance', label: 'Surveillance', types: ['unverified_observation', 'surveillance_expiring', 'surveillance_alert'] },
  { key: 'intel', label: 'Intel', types: ['unassigned_intel', 'intel_reply', 'intel_restore', 'intel_validate', 'claim_verdict'] },
  { key: 'report', label: 'Reports', types: ['report_review'] },
  { key: 'bolo', label: 'BOLOs', types: ['bolo_expiring', 'mdt_export'] },
  { key: 'draft', label: 'Drafts', types: ['draft'] },
  // Library governance is navigation-only by design: acknowledging happens in
  // the reader AFTER reading — never as a one-click inline write here.
  { key: 'library', label: 'Library', types: ['document_ack', 'document_review', 'document_approval', 'document_sync', 'document_suggestion'] },
  { key: 'registry', label: 'Registry', types: ['narcotic_suggestion', 'gang_duplicate', 'tracker_cosign'] },
  { key: 'sib', label: 'SIB', types: ['sib_access_request', 'sib_referral', 'sib_disclosure', 'sib_conflict', 'sib_watch_review'] },
  { key: 'owner', label: 'Owner signals', types: ['owner_signal'] },
  // Confidential informants (§6.4) — offered only to an involved viewer
  // (full CI access or an active handler); the builder emits these kinds
  // for nobody else, so the chip would otherwise be an empty advertisement.
  { key: 'ci', label: 'Informants', types: ['ci_contact_due', 'ci_capacity_request', 'ci_intel_followup'], available: (v) => v.ci === true },
  { key: 'mention', label: 'Mentions', types: ['mention', 'handover', 'other'] },
]

/** The chips to render for this viewer (ACTION_TYPE_FILTERS minus the gated
 *  ones the viewer cannot use). The `?f=` lookup still resolves every key so
 *  a stale URL simply filters to nothing rather than erroring. */
export const availableTypeFilters = (v: PresetViewer): ActionTypeFilter[] =>
  ACTION_TYPE_FILTERS.filter((g) => !g.available || g.available(v))

/** Opaque to lib/savedViews; interpreted only by the Action Center. Every
 *  field optional so an older saved row still applies. */
export interface ActionViewConfig {
  /** Type chip key (ACTION_TYPE_FILTERS), null = All. */
  f?: string | null
  /** Status chip key (ACTION_STATUS_KEYS), null = none. */
  s?: ActionStatusKey | null
  /** Bureau filter (PERMANENT_BUREAUS), null = all bureaus. */
  b?: string | null
  /** Lanes to render; null / absent = every lane. */
  sections?: ActionSectionKey[] | null
  /** Open the Snoozed fold on apply. */
  showSnoozed?: boolean
  /** The preset this config was derived from, if any (chip highlight). */
  preset?: string | null
}

const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const isSectionKey = (v: unknown): v is ActionSectionKey => typeof v === 'string' && (ALL_SECTIONS as readonly string[]).includes(v)
const isStatusKey = (v: unknown): v is ActionStatusKey => typeof v === 'string' && (ACTION_STATUS_KEYS as readonly string[]).includes(v)

/** Coerce a STORED or URL-borne config (a saved view's opaque JSON, a hand-
 *  edited user_prefs row, an older shape) into a well-formed ActionViewConfig
 *  before the view interprets it — `new Set(config.sections)` must never be
 *  handed a non-array. `f` / `b` / `preset` → non-empty string or null; `s` →
 *  a real status key or null; `sections` → the array filtered by the lane
 *  allow-list (anything else → null = every lane); `showSnoozed` → boolean.
 *  A non-object input yields the empty config (= the full queue). */
export function normalizeActionConfig(raw: unknown): ActionViewConfig {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  return {
    f: strOrNull(src.f),
    s: isStatusKey(src.s) ? src.s : null,
    b: strOrNull(src.b),
    sections: Array.isArray(src.sections) ? src.sections.filter(isSectionKey) : null,
    showSnoozed: src.showSnoozed === true,
    preset: strOrNull(src.preset),
  }
}

export type ActionPresetId = 'detective' | 'bureau_lead' | 'command' | 'judge' | 'sib' | 'owner'

/** The flags a preset reads — assembled by the view from useAuth() + useSiu().
 *  Shape kept flat so the unit test needs no hooks. */
export interface PresetViewer {
  /** CID profile role, null for a justice-only / SIB-only identity. */
  role: string | null
  /** useAuth().isCommand — active AND Bureau Lead+. */
  isCommand: boolean
  /** useAuth().isOwner. */
  isOwner: boolean
  /** useAuth().justiceRole — the active DOJ / judiciary role, or null. */
  justiceRole: string | null
  /** useSiu() standing. */
  sib: { canAccess: boolean; isAgent: boolean; isCommand: boolean }
  /** `ciInvolved(useCiContext().ctx)` — full CI access or an active handler.
   *  Optional (defaults to not involved) so existing callers compile; gates
   *  only the Informants chip. */
  ci?: boolean
}

export interface ActionPreset {
  id: ActionPresetId
  label: string
  /** One line under the label in the menu. */
  hint: string
  config: ActionViewConfig
  available: (v: PresetViewer) => boolean
}

const isDeputyOrDirector = (role: string | null): boolean => role === 'deputy_director' || role === 'director'

export const ACTION_PRESETS: readonly ActionPreset[] = [
  {
    id: 'detective',
    label: 'Detective',
    hint: 'Your own tasks, returns, blockers and drafts.',
    config: { f: null, s: null, sections: ['overdue', 'returned', 'personal', 'waiting', 'drafts'], preset: 'detective' },
    available: (v) => !!v.role,
  },
  {
    id: 'bureau_lead',
    label: 'Bureau Lead',
    hint: 'Your bureau’s decisions and your own work, intel and BOLOs.',
    config: { f: null, s: null, sections: ['overdue', 'command', 'returned', 'personal', 'intel', 'bolo', 'waiting'], preset: 'bureau_lead' },
    available: (v) => v.isCommand,
  },
  {
    id: 'command',
    label: 'Command',
    hint: 'Command decisions only — sign-offs, transfers, access, escalations.',
    config: { f: null, s: 'command', sections: null, preset: 'command' },
    available: (v) => v.isCommand || v.isOwner,
  },
  {
    id: 'judge',
    label: 'Judge',
    hint: 'The judicial queue — legal requests awaiting your review.',
    config: { f: 'doj', s: null, sections: null, preset: 'judge' },
    available: (v) => !!v.justiceRole,
  },
  {
    id: 'sib',
    label: 'SIB',
    hint: 'Special Investigations Bureau access, referrals and watch reviews.',
    config: { f: 'sib', s: null, sections: null, preset: 'sib' },
    available: (v) => v.sib.canAccess,
  },
  {
    id: 'owner',
    label: 'Owner',
    hint: 'Escalations and Owner signals across the portal.',
    config: { f: null, s: 'escalated', sections: null, preset: 'owner' },
    available: (v) => v.isOwner,
  },
]

export const presetById = (id: string | null | undefined): ActionPreset | null =>
  (id && ACTION_PRESETS.find((p) => p.id === id)) || null

export const availablePresets = (v: PresetViewer): ActionPreset[] => ACTION_PRESETS.filter((p) => p.available(v))

/** The preset that fits the viewer's standing best — the menu lists it first
 *  ("Suggested"). Rank order: Deputy Director / Director → Command; Bureau
 *  Lead → Bureau Lead; an SIB agent → SIB; a justice-only identity → Judge;
 *  an Owner without a CID role → Owner; every other CID member → Detective.
 *  Null when nothing is available (an inactive or unknown viewer). */
export function defaultPresetFor(v: PresetViewer): ActionPresetId | null {
  const pick = (id: ActionPresetId): ActionPresetId | null => (presetById(id)!.available(v) ? id : null)
  if (isDeputyOrDirector(v.role) && v.isCommand) return pick('command')
  if (v.role === 'bureau_lead' && v.isCommand) return pick('bureau_lead')
  if (v.sib.isAgent && v.sib.canAccess) return pick('sib')
  if (!v.role && v.justiceRole) return pick('judge')
  if (!v.role && v.isOwner) return pick('owner')
  if (v.role) return pick('detective')
  return availablePresets(v)[0]?.id ?? null
}
