/** Shared notification actions — ONE implementation of mark-read, mark-all,
 *  the accurate unread count and the mute preferences, used by the bell
 *  panel, My Desk and the Action Center's absorb — so a notification marked
 *  read anywhere behaves the same everywhere. RLS scopes every query here to
 *  the signed-in user's own rows. */
import { countRows, list, update, updateWhere, upsert, type DbError } from './db'

/** Mark specific notifications read. db's updateWhere matches on eq/is only
 *  (no `in`), so this is per-id updates — bounded by the group size the
 *  caller hands in, never by the table. Returns the first error, if any. */
export async function markRead(ids: readonly string[]): Promise<DbError | null> {
  const unique = [...new Set(ids)]
  if (!unique.length) return null
  const results = await Promise.all(unique.map((id) => update('notifications', id, { read: true })))
  return results.find((r) => r.error)?.error ?? null
}

/** Mark EVERYTHING read in ONE conditional update — RLS scopes the write to
 *  the caller's own rows, so no id list (and no 50-row cap) is involved. */
export async function markAllRead(): Promise<DbError | null> {
  const res = await updateWhere('notifications', { eq: { read: false } }, { read: true })
  return res.error
}

/** Accurate unread count (HEAD + count=exact — never capped by a list limit).
 *  Muted types are excluded client-side: countRows cannot express
 *  `type NOT IN`, so a non-empty mute list falls back to a slim id+type
 *  fetch and counts locally. Throws like list()/countRows on a real error. */
export async function unreadCount(mutedTypes: readonly string[] = []): Promise<number> {
  if (!mutedTypes.length) return countRows('notifications', { eq: { read: false } })
  const rows = await list('notifications', { select: 'id,type', eq: { read: false } }) as unknown as { id: string; type: string }[]
  const muted = new Set(mutedTypes)
  return rows.reduce((n, r) => (muted.has(r.type) ? n : n + 1), 0)
}

/* ---- mute preferences (user_prefs key 'notif_muted') ---------------------- */

const PREF_KEY = 'notif_muted'

export interface NotifCategory {
  key: string
  label: string
  hint: string
  types: readonly string[]
}

/** The ONLY mutable categories — clearly-optional FYI streams. Assignments,
 *  mentions, sign-off decisions, legal, access and security types are
 *  mandatory and deliberately absent: muting those would hide work. */
export const OPTIONAL_NOTIF_CATEGORIES: readonly NotifCategory[] = [
  { key: 'announcements', label: 'Announcements', hint: 'Department-wide posts', types: ['announcement'] },
  { key: 'tracker', label: 'Tracker authorizations', hint: 'A tracker request was authorized', types: ['tracker_authorized'] },
  { key: 'doc_suggestions', label: 'Document suggestions', hint: 'Library suggestion status updates', types: ['document_suggestion'] },
  { key: 'stale', label: 'Stale-case reminders', hint: 'Cases of yours going quiet', types: ['stale_case', 'case_stale'] },
  { key: 'signoff_fyi', label: 'Sign-off heads-ups', hint: 'A deputy approved a case (FYI only)', types: ['signoff_heads_up'] },
]

/** Every type a member may mute — the allow-list both load and save enforce,
 *  so a stale or hand-edited pref can never silence a mandatory type. */
export const MUTABLE_NOTIF_TYPES: ReadonlySet<string> =
  new Set(OPTIONAL_NOTIF_CATEGORIES.flatMap((c) => c.types))

/** The viewer's muted types (own user_prefs row; fail-open to none muted). */
export async function loadMutedTypes(): Promise<string[]> {
  try {
    const rows = await list('user_prefs', { select: 'value', eq: { key: PREF_KEY } })
    const v = (rows[0]?.value ?? null) as { types?: unknown } | null
    const types = Array.isArray(v?.types) ? v.types.filter((t): t is string => typeof t === 'string') : []
    return types.filter((t) => MUTABLE_NOTIF_TYPES.has(t))
  } catch {
    return []
  }
}

export async function saveMutedTypes(types: readonly string[]): Promise<DbError | null> {
  const clean = [...new Set(types)].filter((t) => MUTABLE_NOTIF_TYPES.has(t))
  // user_id defaults to auth.uid() server-side; select only the key back so
  // the returning clause can never trip a column grant.
  const res = await upsert('user_prefs', { key: PREF_KEY, value: { types: clean } }, 'user_id,key', 'key')
  return res.error
}
