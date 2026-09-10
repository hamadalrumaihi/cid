/** Action Center per-viewer state (Phase 7, P7-01 / AC1 / AC5) — the client
 *  side of `action_item_state`: which queue items the viewer has seen,
 *  snoozed (≤ 48 h) or dismissed for good.
 *
 *  `classifyActionKey` MIRRORS `private.action_key_class` (contract §2.3) so
 *  the UI can hide a Dismiss that the server would refuse. It is cosmetic:
 *  the RPC re-derives the class from the key and raises P0403 on a dismiss
 *  of a decision / work key. Keep the two lists identical — the parity test
 *  in `actionState.test.ts` pins the representative keys. */
import { rpc, type DbError } from './db'

export type ActionKeyClass = 'dismissable' | 'decision' | 'work'

/** Informational — nobody is waiting on the viewer. */
const DISMISSABLE_PREFIXES = [
  'notif:', 'draft:', 'legal_hold:', 'sib_disclosure:', 'bolo:', 'document_ack:',
  'document_review:', 'document_sync:', 'surv_obs:', 'grant:', 'owner:', 'legal_comment:', 'siu_watch:',
] as const

/** A command / authority decision the viewer owns. */
const DECISION_PREFIXES = [
  'transfer:', 'member_transfer:', 'access:', 'membership:', 'restricted:', 'sib_access:',
  'mdt_export:', 'field_access:', 'tracker:', 'justice:', 'siu_conflict:', 'surv_tgt:', 'surv_alert:',
  'document_approval:', 'document_suggestion:', 'narcotic:', 'claim:', 'legal:', 'legal_queue:',
  'report:', 'gang_dup:',
] as const

const startsWithAny = (key: string, prefixes: readonly string[]): boolean =>
  prefixes.some((p) => key.startsWith(p))

/** Mirror of private.action_key_class — evaluated in the server's order:
 *  the dismissable shapes first (so `surv_tgt:<id>:expiry` and
 *  `restricted:<id>:expiry` are dismissable even though their prefix is a
 *  decision prefix), then the decision shapes, then everything else is
 *  assigned work (`task:`, `blocker:`, `case:%:signoff-returned`, `intel:`,
 *  `sib_referral:`, …) — never dismissable. */
export function classifyActionKey(key: string): ActionKeyClass {
  if (key.endsWith(':expiry')) return 'dismissable'
  if (startsWithAny(key, DISMISSABLE_PREFIXES)) return 'dismissable'
  if (key.startsWith('case:') && key.endsWith(':followup')) return 'dismissable'
  if (startsWithAny(key, DECISION_PREFIXES)) return 'decision'
  if (key.startsWith('case:') && key.endsWith(':signoff-decide')) return 'decision'
  return 'work'
}

export const isDismissable = (key: string): boolean => classifyActionKey(key) === 'dismissable'

/** What the queue says when a Dismiss is refused (the server's own wording,
 *  softened for a menu item). */
export const NOT_DISMISSABLE_TEXT = 'Decisions and assigned work can’t be dismissed — snooze instead'

export const MAX_SNOOZE_HOURS = 48

export interface SnoozePreset {
  id: 'h1' | 'h4' | 'tomorrow' | 'h48'
  label: string
  /** Nominal duration; `tomorrow` resolves to the next 09:00 (see snoozeUntil). */
  hours: number
}

export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  { id: 'h1', label: '1 hour', hours: 1 },
  { id: 'h4', label: '4 hours', hours: 4 },
  { id: 'tomorrow', label: 'Tomorrow 9:00', hours: 24 },
  { id: 'h48', label: '48 hours', hours: MAX_SNOOZE_HOURS },
]

/** Resolve a preset to an ISO timestamp, capped at MAX_SNOOZE_HOURS from
 *  `nowMs` — the server refuses anything later ('snooze for up to 48 hours').
 *  `tomorrow` is the next local 09:00 that is at least an hour away. */
export function snoozeUntil(preset: SnoozePreset, nowMs: number): string {
  const cap = nowMs + MAX_SNOOZE_HOURS * 3_600_000
  let target: number
  if (preset.id === 'tomorrow') {
    const d = new Date(nowMs)
    d.setHours(9, 0, 0, 0)
    d.setDate(d.getDate() + 1) // the label says tomorrow — always the next day
    target = d.getTime()
  } else {
    target = nowMs + preset.hours * 3_600_000
  }
  return new Date(Math.min(target, cap)).toISOString()
}

/** Event-handler form: the clock is read here (lib, not render) so a
 *  component's click handler stays free of impure calls under the
 *  react-hooks/purity rule. */
export const snoozeUntilNow = (preset: SnoozePreset): string => snoozeUntil(preset, Date.now())

export type ActionStateOp = 'seen' | 'snooze' | 'unsnooze' | 'dismiss' | 'undismiss'

export interface ActionItemState {
  seenAt: string | null
  snoozedUntil: string | null
  dismissedAt: string | null
}

/** Why an item is out of the visible queue right now, if it is. A lapsed
 *  snooze reads as visible again without a server round trip. */
export function isHidden(state: ActionItemState | null, nowMs: number): 'snoozed' | 'dismissed' | null {
  if (!state) return null
  if (state.dismissedAt) return 'dismissed'
  if (state.snoozedUntil && new Date(state.snoozedUntil).getTime() > nowMs) return 'snoozed'
  return null
}

export interface SetStateResult { applied: number; skipped: string[] }

/** The server's batch cap (`_many` raises above it) — larger selections are
 *  chunked here so the caller sees one aggregate answer. */
const MANY_CAP = 100

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Seen / snooze / unsnooze / dismiss / undismiss for one or many keys.
 *  One key → `action_item_set_state` (a refused dismiss is a P0403 error);
 *  many → `action_item_set_state_many` (a non-dismissable key is skipped and
 *  reported, never raised). Resolves the aggregate or the first DbError. */
export async function setActionState(keys: readonly string[], op: ActionStateOp, until?: string): Promise<SetStateResult | DbError> {
  const unique = [...new Set(keys)].filter((k) => k.length > 0)
  if (!unique.length) return { applied: 0, skipped: [] }
  if (unique.length === 1) {
    const res = await rpc('action_item_set_state', { p_key: unique[0], p_op: op, p_until: until ?? null })
    if (res.error) return res.error
    return { applied: 1, skipped: [] }
  }
  const out: SetStateResult = { applied: 0, skipped: [] }
  for (let i = 0; i < unique.length; i += MANY_CAP) {
    const chunk = unique.slice(i, i + MANY_CAP)
    const res = await rpc('action_item_set_state_many', { p_keys: chunk, p_op: op, p_until: until ?? null })
    if (res.error) return res.error
    const d = (res.data ?? {}) as { applied?: unknown; skipped?: unknown }
    out.applied += typeof d.applied === 'number' ? d.applied : 0
    out.skipped.push(...asStrings(d.skipped))
  }
  return out
}

export const isDbError = (r: SetStateResult | DbError): r is DbError => 'message' in r
