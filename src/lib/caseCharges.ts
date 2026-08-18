/** Charges on a case — the client mirror of the record model in
 *  `20260905130000_case_charges.sql`.
 *
 *  A charge is no longer a `{code, count}` entry in a jsonb array. It is a row
 *  with an identity, a status, and a SNAPSHOT of what the penal code said at
 *  the moment it was attached — so amending the code later cannot retroactively
 *  change what a case charged.
 *
 *  ── This file is UX only ───────────────────────────────────────────────────
 *  Everything below exists so a component can decide whether to render a
 *  control and what to call it. The database is the authority:
 *  `private.case_charge_transition_ok()` holds the same edge list,
 *  `private.case_charge_may()` decides who may walk one, and both run in a
 *  BEFORE UPDATE trigger that no client can go around. RLS decides who may
 *  touch a row at all. Hiding a button is never the security boundary — see
 *  docs/AUTHORIZATION.md §7.
 *
 *  If this file and the migration ever disagree, the migration wins and this
 *  file is the bug.
 *
 *  ── Reading a total ────────────────────────────────────────────────────────
 *  A penalty the code leaves to a judge is NOT zero. `case_charge_totals()`
 *  returns it as a separate pending count, and the helpers here keep that
 *  distinction rather than flattening it into a number that reads as settled.
 */

import { insert, rpc, update } from './db'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Mirrors the `case_charges_status_check` constraint, in workflow order. */
export const CASE_CHARGE_STATUSES = [
  'proposed',
  'under_review',
  'approved',
  'filed',
  'convicted',
  'dismissed',
  'withdrawn',
] as const

export type CaseChargeStatus = (typeof CASE_CHARGE_STATUSES)[number]

/** Nothing moves out of these. A conviction that turns out to be wrong is
 *  corrected by the court record, not by editing the charge back to a draft. */
export const CASE_CHARGE_TERMINAL: readonly CaseChargeStatus[] = [
  'convicted',
  'dismissed',
  'withdrawn',
]

const STATUS_LABEL: Record<CaseChargeStatus, string> = {
  proposed: 'Proposed',
  under_review: 'Under review',
  approved: 'Approved',
  filed: 'Filed',
  convicted: 'Convicted',
  dismissed: 'Dismissed',
  withdrawn: 'Withdrawn',
}

export function caseChargeStatusLabel(s: CaseChargeStatus): string {
  return STATUS_LABEL[s]
}

/** What each status means in one line, for a tooltip or an empty state. */
const STATUS_MEANING: Record<CaseChargeStatus, string> = {
  proposed: 'An investigator has put this charge forward. Nobody has reviewed it.',
  under_review: 'Sent up for review. Awaiting a decision from command.',
  approved: 'Command approved it. It is ready to be filed by an attorney.',
  filed: 'Filed with the court. Only the court disposes of it now.',
  convicted: 'The court found for this charge.',
  dismissed: 'The court did not sustain this charge.',
  withdrawn: 'Taken back before any court considered it. The record that it was brought remains.',
}

export function caseChargeStatusMeaning(s: CaseChargeStatus): string {
  return STATUS_MEANING[s]
}

// ---------------------------------------------------------------------------
// The transition table — a mirror of private.case_charge_transition_ok()
// ---------------------------------------------------------------------------

const NEXT: Record<CaseChargeStatus, readonly CaseChargeStatus[]> = {
  proposed: ['under_review', 'withdrawn'],
  // 'proposed' here is a RETURN: a reviewer sending it back for rework.
  under_review: ['approved', 'proposed', 'withdrawn'],
  approved: ['filed', 'withdrawn'],
  filed: ['convicted', 'dismissed'],
  convicted: [],
  dismissed: [],
  withdrawn: [],
}

export function caseChargeNext(from: CaseChargeStatus): readonly CaseChargeStatus[] {
  return NEXT[from]
}

export function caseChargeCanMove(from: CaseChargeStatus, to: CaseChargeStatus): boolean {
  return NEXT[from].includes(to)
}

export function caseChargeIsTerminal(s: CaseChargeStatus): boolean {
  return CASE_CHARGE_TERMINAL.includes(s)
}

/** Who makes a given move — for wording a disabled control ("an attorney
 *  files this"), never for deciding whether the move is allowed. */
export type CaseChargeActor = 'case' | 'command' | 'attorney' | 'judge'

const ACTOR: Record<CaseChargeStatus, CaseChargeActor> = {
  proposed: 'case',
  under_review: 'case',
  withdrawn: 'case',
  approved: 'command',
  filed: 'attorney',
  convicted: 'judge',
  dismissed: 'judge',
}

export function caseChargeActor(to: CaseChargeStatus): CaseChargeActor {
  return ACTOR[to]
}

/** The same answer in words, and SIU-aware, because the SIU lane never uses a
 *  CID Bureau Lead or a prosecutor queue. Mirrors the branch in
 *  private.case_charge_may(). */
export function caseChargeActorLabel(to: CaseChargeStatus, siu: boolean): string {
  switch (ACTOR[to]) {
    case 'case':
      return 'anyone working the case'
    case 'command':
      return siu ? 'SIU command (X-1)' : 'a Bureau Lead or above'
    case 'attorney':
      return siu ? 'the Attorney General' : 'a prosecuting attorney'
    case 'judge':
      return 'a judge'
  }
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** One row of public.case_charges_for(). Every penalty field is the SNAPSHOT
 *  taken when the charge was attached, not today's penal code. */
export interface CaseChargeRow {
  id: string
  charge_id: string
  code: string | null
  offense: string
  penal_title: string | null
  charge_class: string
  counts: number
  status: CaseChargeStatus
  fine: number | null
  jail_months: number | null
  judge_set_fine: boolean
  judge_set_jail: boolean
  imposed_fine: number | null
  imposed_jail_months: number | null
  is_modifier: boolean
  is_rico: boolean
  stackable: boolean
  substance_schedule: number | null
  substance_quantity: number | null
  substance_unit: string | null
  substance_note: string | null
  note: string | null
  decision_note: string | null
  version_name: string
  version_status: string
  added_by: string | null
  added_at: string
  decided_by: string | null
  decided_at: string | null
}

/** public.case_charge_totals(). `cap_months` and `over_cap` are null when the
 *  version in question states no limit — which is different from being under
 *  one, and must not be rendered as "within limits". */
export interface CaseChargeTotals {
  charges: number
  counts: number
  months: number
  fine: number
  judge_jail_pending: number
  judge_fine_pending: number
  rico: number
  modifiers: number
  convicted: number
  cap_months: number | null
  over_cap: boolean | null
  by_status: Partial<Record<CaseChargeStatus, number>>
}

// ---------------------------------------------------------------------------
// Rendering penalties without lying about them
// ---------------------------------------------------------------------------

/** A charge's jail term as text. A judge-set term is never "0 months" and
 *  never blank — both read as "no time", which is the opposite of the truth. */
export function caseChargeJailLabel(c: Pick<CaseChargeRow,
  'jail_months' | 'judge_set_jail' | 'imposed_jail_months'>): string {
  if (c.imposed_jail_months != null) return `${c.imposed_jail_months} mo (set by judge)`
  if (c.judge_set_jail) return 'Judge decides'
  if (c.jail_months == null) return 'Not stated'
  return `${c.jail_months} mo`
}

export function caseChargeFineLabel(c: Pick<CaseChargeRow,
  'fine' | 'judge_set_fine' | 'imposed_fine'>): string {
  if (c.imposed_fine != null) return `$${c.imposed_fine.toLocaleString()} (set by judge)`
  if (c.judge_set_fine) return 'Judge decides'
  if (c.fine == null) return 'Not stated'
  return `$${c.fine.toLocaleString()}`
}

/** True when any part of a total is still waiting on a judge, so the caller
 *  can say "plus N awaiting a judge" instead of presenting a settled figure. */
export function caseChargeTotalIsProvisional(t: CaseChargeTotals): boolean {
  return t.judge_jail_pending > 0 || t.judge_fine_pending > 0
}

/** How to caption the sentence cap. Null cap is NOT "within the limit". */
export function caseChargeCapLabel(t: CaseChargeTotals): string | null {
  if (t.cap_months == null) return null
  return t.over_cap
    ? `Over the ${t.cap_months}-month maximum`
    : `Within the ${t.cap_months}-month maximum`
}

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------
//
// Both reads are SECURITY INVOKER, so each caller sees exactly what the
// policies allow. Every write below is an ordinary table write: the INSERT and
// UPDATE policies decide who may touch the row, and the BEFORE triggers decide
// what the row may say and which status move it may make. Nothing here is
// trusted -- in particular the snapshot is written by the database from
// penal_charges and whatever this client sends is discarded.

export async function loadCaseCharges(caseId: string): Promise<CaseChargeRow[]> {
  const res = await rpc('case_charges_for', { p_case: caseId })
  // The generated row type carries `status: string`; the check constraint
  // narrows it to CaseChargeStatus and this records that, rather than widening
  // every consumer to accept a status the database cannot produce.
  return (res.data ?? []) as unknown as CaseChargeRow[]
}

export async function loadCaseChargeTotals(caseId: string): Promise<CaseChargeTotals | null> {
  const res = await rpc('case_charge_totals', { p_case: caseId })
  return (res.data ?? null) as unknown as CaseChargeTotals | null
}

/** Propose a charge. The client sends only what it legitimately chooses --
 *  which charge, how many counts, an optional note. It does NOT send
 *  version_id, snap_offense or snap_charge_class, even though all three are
 *  NOT NULL: Postgres evaluates NOT NULL after the BEFORE INSERT trigger, and
 *  that trigger fills them from the canonical charge row. Verified against the
 *  live database rather than assumed.
 *
 *  Sending placeholders would work too, and would be worse — it would look
 *  like the client had a say in what the charge says. It does not. */
export async function proposeCaseCharge(
  caseId: string, chargeId: string, counts = 1, note?: string,
): Promise<string | null> {
  // The generated Insert type requires the three columns above, because it
  // describes the table and cannot know a trigger supplies them. The cast is
  // narrow and deliberate; the database is the thing being satisfied here.
  const res = await insert('case_charges', {
    case_id: caseId, charge_id: chargeId, counts, note: note || null,
  } as never)
  return res.error?.message ?? null
}

export async function setCaseChargeCounts(id: string, counts: number): Promise<string | null> {
  const res = await update('case_charges', id, { counts })
  return res.error?.message ?? null
}

/** Move a charge along the lane. The database refuses an illegal edge and an
 *  unentitled mover; an RLS refusal matches zero rows rather than erroring, so
 *  the caller must check that something actually changed. */
export async function moveCaseCharge(
  id: string, to: CaseChargeStatus, note?: string,
): Promise<string | null> {
  const res = await update('case_charges', id, {
    status: to, ...(note ? { decision_note: note } : {}),
  })
  return res.error?.message ?? null
}

/** Controlled-substance detail. Refused by constraint on a charge the code
 *  does not schedule, which is the point: a quantity against Littering is a
 *  data-entry error worth failing. */
export async function setCaseChargeSubstance(
  id: string, quantity: number | null, unit: string | null, note: string | null,
): Promise<string | null> {
  const res = await update('case_charges', id, {
    substance_quantity: quantity, substance_unit: unit, substance_note: note,
  })
  return res.error?.message ?? null
}
