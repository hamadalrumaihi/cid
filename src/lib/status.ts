/** Central status registry — ONE place that says, for every status vocabulary
 *  in the portal, what a value is CALLED, what it LOOKS like, what it MEANS,
 *  and (where a workflow has a next actor) WHO acts next.
 *
 *  Composes with lib/tint (the color primitives — statusTint/priorityTint/…
 *  stay the single source of chip colors) and with the domain vocabularies
 *  that already exist (lib/signoff, lib/justice, lib/forms, lib/caseCharges,
 *  lib/fieldSubmissions). This file adds no new states and merges none: two
 *  values with different legal meaning stay distinct — the registry only
 *  normalizes presentation and disambiguates colliding labels (e.g. a warrant
 *  whose return was filed is "Return filed", never "Returned", so it cannot be
 *  read as the legal-review "Returned for revision").
 *
 *  Render through <StatusBadge domain=… value=… /> (ui/StatusBadge), or read
 *  statusMeta() directly when a call site needs the raw classes. */

import { confidenceTint, priorityTint, provenanceTint, statusTint, threatTint } from './tint'
import { signoffLabel, signoffTint } from './signoff'
import { reviewStatusLabel } from './justice'
import { WARRANT_TINT } from './forms'
import { caseChargeStatusLabel, caseChargeStatusMeaning, type CaseChargeStatus, CASE_CHARGE_STATUSES } from './caseCharges'
import { fieldStatusLabel, fieldStatusMeaning } from './fieldSubmissions'

export type StatusDomain =
  | 'case'
  | 'caseStage'
  | 'signoff'
  | 'legalReview'
  | 'warrant'
  | 'fieldSubmission'
  | 'priority'
  | 'threat'
  | 'confidence'
  | 'provenance'
  | 'boloRisk'
  | 'seizedItem'
  | 'personReview'
  | 'accountOwnership'
  | 'caseCharge'

export interface StatusMeta {
  /** Human label — always rendered; color is never the only signal. */
  label: string
  /** Chip tint classes (the `bg-…/15 text-…-300` badge idiom). */
  cls: string
  /** One-line "what this means" for the title tooltip. */
  meaning?: string
  /** "Who acts next" for workflow states, appended to the tooltip. */
  actor?: string
}

const NEUTRAL = 'bg-slate-500/20 text-slate-300'
const ACCENT = 'bg-blue-500/15 text-blue-300' // remapped to the user accent
const EMERALD = 'bg-emerald-500/15 text-emerald-300'
const AMBER = 'bg-amber-500/15 text-amber-300'
const ROSE = 'bg-rose-500/15 text-rose-300'
const SLATE = 'bg-slate-500/15 text-slate-300'
const DIM = 'bg-white/5 text-slate-400'

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const humanize = (s: string): string => cap(s.replace(/[_-]+/g, ' '))

/* ── Case lifecycle (record state) ─────────────────────────────────────── */
const CASE_MEANING: Record<string, string> = {
  open: 'New — awaiting assignment or first activity.',
  active: 'Being actively worked.',
  cold: 'Leads exhausted — dormant until something new surfaces.',
  closed: 'Investigation concluded; the record is final.',
  archived: 'Removed from the working views; restorable by command.',
}

/* ── Investigative / workflow stage ────────────────────────────────────────
 * TWO vocabularies share this domain because both describe "where the case
 * is" and never collide (except 'closed', which means the same thing):
 *  - the stored, manually-moved investigative_stage
 *    (intake → active_investigation → … → closed, RPC case_set_stage), and
 *  - the derived assessCase() workflow stage (lib/caseWorkflow:
 *    investigation / awaiting_signoff / returned_signoff / doj_review /
 *    dormant / closed). */
const CASE_STAGE: Record<string, StatusMeta> = {
  // Stored investigative stage (audited, manual).
  intake: { label: 'Intake', cls: SLATE, meaning: 'Just opened — scoping and initial assignment.' },
  active_investigation: { label: 'Active Investigation', cls: EMERALD, meaning: 'Evidence gathering and casework in progress.' },
  legal_process: { label: 'Legal Process', cls: ACCENT, meaning: 'Warrants/subpoenas drafted or before the DOJ.' },
  enforcement_ready: { label: 'Enforcement Ready', cls: AMBER, meaning: 'Legal process complete — awaiting execution.', actor: 'Case lead schedules enforcement' },
  pending_closure: { label: 'Pending Closure', cls: AMBER, meaning: 'Wrapping up — closure checklist in progress.' },
  closed: { label: 'Closed', cls: NEUTRAL, meaning: 'Investigation concluded.' },
  // Derived workflow stage (assessCase). Tints match the former
  // CaseCommandHeader STAGE_TINTS block, folded here.
  investigation: { label: 'Investigation', cls: EMERALD, meaning: 'Being actively worked — no review pending.' },
  awaiting_signoff: { label: 'Awaiting sign-off', cls: AMBER, meaning: 'Submitted for review.', actor: 'The assigned reviewer decides' },
  returned_signoff: { label: 'Returned for changes', cls: ROSE, meaning: 'A reviewer sent it back.', actor: 'The submitter revises and resubmits' },
  doj_review: { label: 'DOJ / legal review', cls: ACCENT, meaning: 'With the DOJ or in legal process.' },
  dormant: { label: 'Dormant (cold)', cls: ACCENT, meaning: 'Cold — no active work.' },
}

/* ── Sign-off chain (server-authoritative) ─────────────────────────────── */
const SIGNOFF_ACTOR: Record<string, string> = {
  awaiting_bureau_lead: 'Bureau Lead reviews next',
  awaiting_deputy: 'Deputy Director reviews next',
  awaiting_director: 'Director reviews next',
  approved_deputy: 'Submitter completes or escalates',
  changes_requested: 'Submitter revises and resubmits',
  denied: 'Submitter revises and resubmits',
}
const SIGNOFF_MEANING: Record<string, string> = {
  none: 'Not in the sign-off pipeline.',
  awaiting_bureau_lead: 'Submitted — awaiting the Bureau Lead’s decision.',
  awaiting_deputy: 'Awaiting the Deputy Director’s decision.',
  awaiting_director: 'Awaiting the Director’s decision.',
  approved_deputy: 'Approved by the Deputy — complete it or escalate to the Director.',
  approved_complete: 'Approved and complete.',
  ready_doj: 'Approved and handed to the DOJ.',
  changes_requested: 'A reviewer requested changes.',
  denied: 'A reviewer denied it.',
}

/* ── Legal review (shared CID/Justice workflow) ────────────────────────────
 * Tone semantics owned here (legalShared re-exports reviewTone from this):
 * approved → emerald; denied + returned_by_* → rose; *_review / submitted* →
 * amber; withdrawn → slate; everything else (queues, drafts) → accent. */
export type LegalTone = 'slate' | 'amber' | 'emerald' | 'rose' | 'blue'
export function legalReviewTone(status: string): LegalTone {
  if (status === 'approved') return 'emerald'
  if (status === 'denied' || status.startsWith('returned')) return 'rose'
  if (status.endsWith('_review') || status.startsWith('submitted')) return 'amber'
  if (status === 'withdrawn') return 'slate'
  return 'blue'
}
/** The bordered legal-chip idiom, keyed by tone — the single map behind
 *  legalShared's StatusChip (which used to declare its own copy). */
export const LEGAL_TONE_CLS: Record<LegalTone, string> = {
  slate: 'border-white/10 bg-white/5 text-slate-300',
  amber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
  emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  rose: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
  blue: 'border-badge-500/25 bg-badge-500/10 text-blue-300',
}
const LEGAL_TONE_TINT: Record<LegalTone, string> = {
  slate: SLATE, amber: AMBER, emerald: EMERALD, rose: ROSE, blue: ACCENT,
}

/* ── Warrant lifecycle (rides inside report fields) ──────────────────────
 * Colors stay WARRANT_TINT (lib/forms) verbatim — including returned →
 * emerald, which is CORRECT: 'returned' here means "the return was filed
 * with the court" (the warrant is complete), not "sent back for revision".
 * The label says so, ending the collision with legal "Returned by …". */
const WARRANT_LABEL: Record<string, string> = {
  draft: 'Draft',
  signed: 'Signed',
  executed: 'Executed',
  returned: 'Return filed',
}
const WARRANT_MEANING: Record<string, string> = {
  draft: 'Being drafted — not yet before a judge.',
  signed: 'Signed by a judge — ready to execute.',
  executed: 'Executed in the field — the return must be filed.',
  returned: 'The return was filed with the court. The warrant is complete — this is not "sent back".',
}

/* ── Field-intelligence submissions ──────────────────────────────────────
 * Labels + meanings from lib/fieldSubmissions (author-facing wording);
 * colors added here — the vocabulary had none. */
const FIELD_CLS: Record<string, string> = {
  draft: SLATE,
  new: ACCENT,
  reviewing: AMBER,
  needs_info: AMBER,
  reviewed: EMERALD,
  actionable: EMERALD,
  archived: 'bg-white/5 text-slate-500',
}
const FIELD_ACTOR: Record<string, string> = {
  new: 'A reviewer picks it up',
  reviewing: 'The reviewer works through it',
  needs_info: 'The author answers',
}

/* ── BOLO / MDT-export risk ──────────────────────────────────────────────
 * Aligned with priorityTint's temperature (the former orange 'high' in
 * bolo/MdtExports drifted off-palette): critical → rose, medium/high →
 * amber, low → slate. The label always shows, so medium vs high never
 * relies on color alone. */
const BOLO_RISK: Record<string, string> = {
  low: SLATE,
  medium: AMBER,
  high: AMBER,
  critical: ROSE,
}

/* ── Seized-property disposition ─────────────────────────────────────── */
const SEIZED: Record<string, StatusMeta> = {
  held: { label: 'Held', cls: SLATE, meaning: 'In evidence custody.' },
  returned: { label: 'Returned to owner', cls: ACCENT, meaning: 'Released back to its owner — no longer in custody.' },
  destroyed: { label: 'Destroyed', cls: ROSE, meaning: 'Destroyed under order.' },
  forfeited: { label: 'Forfeited', cls: AMBER, meaning: 'Forfeited to the state.' },
  other: { label: 'Other', cls: SLATE },
}

/* ── Person-record review freshness (personIntel.reviewDueState) ───────── */
const PERSON_REVIEW: Record<string, StatusMeta> = {
  fresh: { label: 'Fresh', cls: EMERALD, meaning: 'Reviewed recently — the intelligence is current.' },
  due: { label: 'Due', cls: AMBER, meaning: 'The scheduled review date has passed.', actor: 'Any investigator can review' },
  stale: { label: 'Stale', cls: ROSE, meaning: 'Not reviewed for 90+ days — treat with care.', actor: 'Any investigator can review' },
  unreviewed: { label: 'Unreviewed', cls: NEUTRAL, meaning: 'No intelligence review on record.' },
}

/* ── Account↔person ownership confidence ──────────────────────────────────
 * Follows confidenceTint's scale (probable → accent, NOT amber — a probable
 * link is mid-confidence information, not a warning). */
const ACCOUNT_OWNERSHIP: Record<string, StatusMeta> = {
  suspected: { label: 'Suspected', cls: SLATE, meaning: 'A possible tie — not yet corroborated.' },
  probable: { label: 'Probable', cls: ACCENT, meaning: 'Corroborated by at least one source.' },
  confirmed: { label: 'Confirmed', cls: EMERALD, meaning: 'Ownership confirmed.' },
}

/* ── Case charges (lib/caseCharges vocabulary) ───────────────────────────── */
const CASE_CHARGE_CLS: Record<CaseChargeStatus, string> = {
  approved: ACCENT,
  filed: 'bg-badge-500/15 text-badge-200',
  convicted: EMERALD,
  dismissed: DIM,
  withdrawn: DIM,
}
const isCaseChargeStatus = (v: string): v is CaseChargeStatus =>
  (CASE_CHARGE_STATUSES as readonly string[]).includes(v)

/** Look up label / chip classes / tooltip copy for a status value in one of
 *  the registered domains. Unknown values fall back to a neutral chip with
 *  the humanized raw value as label — never a crash, never a blank chip. */
export function statusMeta(domain: StatusDomain, value: string | null | undefined): StatusMeta {
  const v = (value ?? '').toLowerCase()
  switch (domain) {
    case 'case':
      return { label: cap(v || 'open'), cls: statusTint(v || 'open'), meaning: CASE_MEANING[v || 'open'] }
    case 'caseStage':
      return CASE_STAGE[v] ?? { label: humanize(v || 'intake'), cls: NEUTRAL }
    case 'signoff': {
      const key = v || 'none'
      return { label: signoffLabel(key), cls: signoffTint(key), meaning: SIGNOFF_MEANING[key], actor: SIGNOFF_ACTOR[key] }
    }
    case 'legalReview':
      return { label: reviewStatusLabel(v), cls: LEGAL_TONE_TINT[legalReviewTone(v)] }
    case 'warrant': {
      const key = v || 'draft'
      return {
        label: WARRANT_LABEL[key] ?? humanize(key),
        cls: WARRANT_TINT[key] ?? WARRANT_TINT.draft,
        meaning: WARRANT_MEANING[key],
      }
    }
    case 'fieldSubmission':
      return { label: fieldStatusLabel(v), cls: FIELD_CLS[v] ?? NEUTRAL, meaning: fieldStatusMeaning(v) || undefined, actor: FIELD_ACTOR[v] }
    case 'priority':
      return { label: cap(v || 'low'), cls: priorityTint(v) }
    case 'threat':
      return { label: cap(v), cls: threatTint(v) }
    case 'confidence':
      return { label: cap(v || 'unverified'), cls: confidenceTint(v) }
    case 'provenance':
      return { label: humanize(v || 'imported'), cls: provenanceTint(v) }
    case 'boloRisk':
      return { label: cap(v), cls: BOLO_RISK[v] ?? NEUTRAL }
    case 'seizedItem':
      return SEIZED[v || 'held'] ?? { label: humanize(v), cls: SLATE }
    case 'personReview':
      return PERSON_REVIEW[v] ?? PERSON_REVIEW.unreviewed
    case 'accountOwnership':
      return ACCOUNT_OWNERSHIP[v] ?? { label: humanize(v || 'suspected'), cls: SLATE }
    case 'caseCharge':
      return isCaseChargeStatus(v)
        ? { label: caseChargeStatusLabel(v), cls: CASE_CHARGE_CLS[v], meaning: caseChargeStatusMeaning(v) }
        : { label: humanize(v), cls: NEUTRAL }
  }
}

/** The tooltip line StatusBadge renders: "meaning — Next: actor". */
export function statusTitle(meta: StatusMeta): string | undefined {
  const parts = [meta.meaning, meta.actor ? `Next: ${meta.actor}` : null].filter(Boolean)
  return parts.length ? parts.join(' — ') : undefined
}
