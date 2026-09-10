/** Confidential Informant compartment — the PURE half of the client module.
 *
 *  Vocabularies, labels and the small derivations the `/informants` surfaces
 *  and the case integration share. Nothing here touches the network or React,
 *  so it runs under the node vitest project (`ciModel.test.ts`). Every rule
 *  is a client MIRROR of the migration's checks and helpers — the server
 *  (`private.can_access_ci`, `private.ci_capacity`, `private.ci_sanitized`)
 *  is the authority; these exist so the UI can show the right copy before the
 *  round-trip, never so it can decide anything. */

/* ── Vocabularies (mirror of the CHECK constraints, §2) ─────────────────── */

export const CI_STATUSES = ['candidate', 'active', 'dormant', 'suspended', 'compromised', 'retired', 'terminated'] as const
export type CiStatus = (typeof CI_STATUSES)[number]
export const CI_STATUS_LABEL: Record<CiStatus, string> = {
  candidate: 'Candidate', active: 'Active', dormant: 'Dormant', suspended: 'Suspended',
  compromised: 'Compromised', retired: 'Retired', terminated: 'Terminated',
}

export const CI_MOTIVES = [
  'money', 'political', 'religious', 'patriotism', 'revenge', 'personal_benefit',
  'protection', 'leniency', 'rivalry', 'ideological', 'safety', 'other',
] as const
export type CiMotive = (typeof CI_MOTIVES)[number]
export const CI_MOTIVE_LABEL: Record<CiMotive, string> = {
  money: 'Money', political: 'Political', religious: 'Religious', patriotism: 'Patriotism', revenge: 'Revenge',
  personal_benefit: 'Personal benefit', protection: 'Protection', leniency: 'Leniency', rivalry: 'Rivalry',
  ideological: 'Ideological', safety: 'Safety', other: 'Other',
}

export const CI_RELIABILITY = ['unknown', 'low', 'moderate', 'high', 'proven'] as const
export type CiReliability = (typeof CI_RELIABILITY)[number]
export const CI_RELIABILITY_LABEL: Record<CiReliability, string> = {
  unknown: 'Unknown', low: 'Low', moderate: 'Moderate', high: 'High', proven: 'Proven',
}

export const CI_RISK = ['low', 'medium', 'high', 'critical'] as const
export type CiRisk = (typeof CI_RISK)[number]
export const CI_RISK_LABEL: Record<CiRisk, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' }

export const CI_CORROBORATION = ['unverified', 'partially_corroborated', 'corroborated', 'contradicted', 'unable_to_verify'] as const
export type CiCorroboration = (typeof CI_CORROBORATION)[number]
export const CI_CORROBORATION_LABEL: Record<CiCorroboration, string> = {
  unverified: 'Unverified', partially_corroborated: 'Partially corroborated', corroborated: 'Corroborated',
  contradicted: 'Contradicted', unable_to_verify: 'Unable to verify',
}
/** The one-line distinction every corroboration control carries: reliability
 *  grades the SOURCE; corroboration grades what the INVESTIGATION confirmed. */
export const CI_CORROBORATION_EXPLAINER =
  'Reliability is what the source said and how they have held up; corroboration is what the investigation independently confirmed.'

export const CI_SENSITIVITY = ['routine', 'sensitive', 'highly_sensitive'] as const
export type CiSensitivity = (typeof CI_SENSITIVITY)[number]
export const CI_SENSITIVITY_LABEL: Record<CiSensitivity, string> = {
  routine: 'Routine', sensitive: 'Sensitive', highly_sensitive: 'Highly sensitive',
}

export const CI_CONTACT_METHODS = ['in_person', 'phone', 'message', 'other'] as const
export type CiContactMethod = (typeof CI_CONTACT_METHODS)[number]
export const CI_CONTACT_METHOD_LABEL: Record<CiContactMethod, string> = {
  in_person: 'In person', phone: 'Phone', message: 'Message', other: 'Other',
}

export const CI_ASSESSMENT_SCALE = ['unknown', 'low', 'moderate', 'high'] as const
export type CiAssessmentGrade = (typeof CI_ASSESSMENT_SCALE)[number]
export const CI_ASSESSMENT_LABEL: Record<CiAssessmentGrade, string> = {
  unknown: 'Unknown', low: 'Low', moderate: 'Moderate', high: 'High',
}

export const CI_HANDLING = ['official_use', 'law_enforcement_sensitive', 'court_disclosable'] as const
export type CiHandling = (typeof CI_HANDLING)[number]
export const CI_HANDLING_LABEL: Record<CiHandling, string> = {
  official_use: 'Official use', law_enforcement_sensitive: 'Law-enforcement sensitive', court_disclosable: 'Court disclosable',
}

export const CI_REQUEST_STATUSES = ['pending', 'approved', 'denied', 'returned', 'withdrawn'] as const
export type CiRequestStatus = (typeof CI_REQUEST_STATUSES)[number]
export const CI_REQUEST_STATUS_LABEL: Record<CiRequestStatus, string> = {
  pending: 'Pending', approved: 'Approved', denied: 'Denied', returned: 'Returned', withdrawn: 'Withdrawn',
}

/* ── Capacity ─────────────────────────────────────────────────────────────── */

/** `private.ci_capacity()` without an override. */
export const CI_DEFAULT_CAPACITY = 6
export const CI_MAX_CAPACITY = 30

/** The ONE capacity spelling: "2 / 6 Informants" — every surface, every size. */
export const capacityLabel = (active: number, capacity: number): string =>
  `${active} / ${capacity} Informants`

export const isAtCapacity = (active: number, capacity: number): boolean => active >= capacity

/* ── Contact cadence ──────────────────────────────────────────────────────── */

export type ContactState = 'overdue' | 'due_soon' | 'ok' | 'none'

const DAY_MS = 86_400_000
/** The sweep's "silent" threshold (`private.ci_sweep`, detail 'silent_30d'). */
export const CI_SILENT_DAYS = 30
export const CI_DUE_SOON_DAYS = 7

export interface ContactRow {
  status?: string | null
  last_contact_at?: string | null
  next_contact_at?: string | null
}

/** Where a CI sits on its contact cadence. Mirrors the hourly sweep:
 *   - `overdue`  — next_contact_at is in the past, OR an ACTIVE source has
 *                  been silent ≥ 30 days with no future contact scheduled;
 *   - `due_soon` — next contact falls inside the next 7 days;
 *   - `ok`       — a future contact is scheduled (or a recent contact exists);
 *   - `none`     — nothing scheduled and nothing recorded. */
export function contactState(row: ContactRow, now: Date | number = Date.now()): ContactState {
  const t = typeof now === 'number' ? now : now.getTime()
  const next = row.next_contact_at ? Date.parse(row.next_contact_at) : NaN
  if (!Number.isNaN(next)) {
    if (next < t) return 'overdue'
    if (next - t <= CI_DUE_SOON_DAYS * DAY_MS) return 'due_soon'
    return 'ok'
  }
  const last = row.last_contact_at ? Date.parse(row.last_contact_at) : NaN
  if (Number.isNaN(last)) return 'none'
  if (row.status === 'active' && t - last >= CI_SILENT_DAYS * DAY_MS) return 'overdue'
  return 'ok'
}

export const CONTACT_STATE_LABEL: Record<ContactState, string> = {
  overdue: 'Overdue', due_soon: 'Due soon', ok: 'On schedule', none: 'No contact recorded',
}

/* ── Handlers ─────────────────────────────────────────────────────────────── */

export interface HandlerLike {
  user_id: string
  role: string
  ended_at?: string | null
  name?: string | null
}

export interface GroupedHandlers<H extends HandlerLike> {
  primary: H | null
  secondary: H | null
  /** Active rows the two named slots do not account for (defensive — the
   *  partial unique index makes this empty in practice). */
  others: H[]
  /** Ended rows, newest ending first (the full-access history list). */
  history: H[]
}

/** Split a handler list into the two live slots + the history. Ended rows
 *  never occupy a slot, whatever their role says. */
export function groupHandlers<H extends HandlerLike>(handlers: readonly H[] | null | undefined): GroupedHandlers<H> {
  const out: GroupedHandlers<H> = { primary: null, secondary: null, others: [], history: [] }
  for (const h of handlers ?? []) {
    if (h.ended_at) { out.history.push(h); continue }
    if (h.role === 'primary' && !out.primary) out.primary = h
    else if (h.role === 'secondary' && !out.secondary) out.secondary = h
    else out.others.push(h)
  }
  out.history.sort((a, b) => (Date.parse(b.ended_at ?? '') || 0) - (Date.parse(a.ended_at ?? '') || 0))
  return out
}

/* ── Sanitization (client mirror of private.ci_sanitized) ─────────────────── */

export interface SanitizeSubject {
  ciNumber?: string | null
  name?: string | null
  alias?: string | null
  handlerNames?: ReadonlyArray<string | null | undefined>
}

export interface SanitizeCheck {
  clean: boolean
  /** The identifying strings found in the text, in the order they were checked. */
  hits: string[]
}

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** Does the text name the source? Case- and whitespace-insensitive containment
 *  of the CI number, the person's name, the alias and each handler's display
 *  name — the same four strings the server refuses on. Cosmetic: the release
 *  RPC re-runs `private.ci_sanitized` and its `unsanitized` answer is final. */
export function sanitizeCheck(text: string | null | undefined, subject: SanitizeSubject): SanitizeCheck {
  const hay = norm(text ?? '')
  const hits: string[] = []
  if (!hay) return { clean: true, hits }
  const candidates: Array<string | null | undefined> = [subject.ciNumber, subject.name, subject.alias, ...(subject.handlerNames ?? [])]
  for (const c of candidates) {
    const needle = norm(c ?? '')
    if (needle.length < 2) continue
    if (hay.includes(needle) && !hits.includes(c as string)) hits.push(c as string)
  }
  return { clean: hits.length === 0, hits }
}

/* ── Motive ───────────────────────────────────────────────────────────────── */

const motiveLabel = (m: string): string => (CI_MOTIVE_LABEL as Record<string, string>)[m] ?? m

/** "Money (+ Leniency, Protection)" — the roster / profile one-liner. Unknown
 *  values render verbatim so a future vocabulary value is never hidden. */
export function motiveSummary(primary: string | null | undefined, secondary: ReadonlyArray<string> | null | undefined): string {
  const extra = (secondary ?? []).filter((m) => m && m !== primary).map(motiveLabel)
  if (!primary) return extra.length ? extra.join(', ') : '—'
  return extra.length ? `${motiveLabel(primary)} (+ ${extra.join(', ')})` : motiveLabel(primary)
}

/* ── RPC answers ──────────────────────────────────────────────────────────── */

export interface CiFailure { ok: false; code: string; message: string }
export type CiResult<T extends object = Record<string, never>> = ({ ok: true } & T) | CiFailure

/** Shape a definer RPC's jsonb answer (or the transport error) into ONE
 *  discriminated result. A `{ok:false}` body keeps the server's own code and
 *  message verbatim — the UI toasts exactly what the server said. */
export function parseCiResult<T extends object>(
  data: unknown,
  error: { message: string; code?: string } | null,
  fallback = 'The request was refused.',
): CiResult<T> {
  if (error) return { ok: false, code: error.code ?? 'error', message: error.message || fallback }
  if (!data || typeof data !== 'object') return { ok: false, code: 'empty', message: fallback }
  const body = data as { ok?: unknown; code?: unknown; message?: unknown }
  if (body.ok === false) {
    return {
      ok: false,
      code: typeof body.code === 'string' ? body.code : 'refused',
      message: typeof body.message === 'string' && body.message ? body.message : fallback,
    }
  }
  return { ...(data as T), ok: true }
}

/* ── Roster stats (handler view: derived from the caller's OWN rows only) ── */

export interface RosterStatRow {
  status: string
  open_followups: number
  linked_cases: number
  last_contact_at: string | null
  next_contact_at: string | null
}

export interface HandlerRosterStats {
  active: number
  contactsDue: number
  followUps: number
  relatedCases: number
}

/** The handler view's cards, from `ci_list` rows alone — the rows RLS returned
 *  for this caller. No department total can leak because none is computed. */
export function handlerRosterStats(rows: readonly RosterStatRow[], now: Date | number = Date.now()): HandlerRosterStats {
  let active = 0, contactsDue = 0, followUps = 0, relatedCases = 0
  for (const r of rows) {
    if (r.status === 'active') active++
    const st = contactState(r, now)
    if (st === 'overdue' || st === 'due_soon') contactsDue++
    followUps += r.open_followups ?? 0
    relatedCases += r.linked_cases ?? 0
  }
  return { active, contactsDue, followUps, relatedCases }
}
