/** Shared notification actions — ONE implementation of mark-read, mark-all,
 *  the accurate unread count, subject hydration and the preferences, used by
 *  the bell panel, My Desk and the Action Center — so a notification marked
 *  read anywhere behaves the same everywhere. RLS scopes every query here to
 *  the signed-in user's own rows. */
import { countRows, list, rpc, updateWhere, upsert, type DbError } from './db'
import { NOTIF_CATEGORY } from './notifText'

const chunk = <T,>(xs: readonly T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** Mark specific notifications read through `notifications_mark_read`
 *  (Phase 7, P7-01): one RPC per ≤500 ids, own unread rows only (the server
 *  stamps read_at). Returns the first error, if any. */
export async function markRead(ids: readonly string[]): Promise<DbError | null> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (!unique.length) return null
  for (const part of chunk(unique, 500)) {
    const res = await rpc('notifications_mark_read', { p_ids: part })
    if (res.error) return res.error
  }
  return null
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

/* ---- subject hydration (notification_resolve, P7-07) ---------------------- */

export interface NotifSubject {
  subjectKind: string | null
  subjectId: string | null
  /** The subject row is readable under the viewer's RLS right now. False →
   *  the row reads "An item you no longer have access to" and its deep link
   *  is suppressed. */
  visible: boolean
  /** Case number / request number / report title … null when not visible. */
  label: string | null
}

/** Resolve the subjects of the given notification ids (own rows, ≤100 per
 *  call — chunked). SECURITY INVOKER server-side: it sees exactly what the
 *  caller can see. Fail-open: an error resolves nothing (the rows render as
 *  before, links intact) rather than hiding the whole page. */
export async function resolveNotifications(ids: readonly string[]): Promise<Map<string, NotifSubject>> {
  const out = new Map<string, NotifSubject>()
  const unique = [...new Set(ids)].filter(Boolean)
  for (const part of chunk(unique, 100)) {
    try {
      const res = await rpc('notification_resolve', { p_ids: part })
      if (res.error || !Array.isArray(res.data)) continue
      for (const r of res.data) {
        out.set(r.id, { subjectKind: r.subject_kind, subjectId: r.subject_id, visible: !!r.visible, label: r.label })
      }
    } catch { /* fail-open */ }
  }
  return out
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

/* ---- Discord DM opt-in (user_prefs key 'notif_discord', P7-07) ------------ */

const DISCORD_PREF_KEY = 'notif_discord'

export interface DiscordCategory {
  key: string
  label: string
  hint: string
}

/** The opt-in categories a member with a linked Discord may choose. A type's
 *  category is the JSON's `category` (lib/notifText NOTIF_CATEGORY); a type
 *  outside every category is `other` and is always DM'd when a title exists.
 *  A missing pref row = every category (today's behaviour). The edge function
 *  reads the same row with the service role and skips a muted category. */
export const DISCORD_CATEGORIES: readonly DiscordCategory[] = [
  { key: 'assignments', label: 'Assignments', hint: 'Tasks, blockers, cases and SIB cases assigned to you' },
  { key: 'decisions', label: 'Decisions', hint: 'Sign-offs, access, membership, SIB, restricted media, tracker and suggestion decisions' },
  { key: 'legal', label: 'Legal', hint: 'Legal requests, comments and instrument deadlines' },
  { key: 'mentions', label: 'Mentions', hint: 'Chat, note and announcement mentions' },
  { key: 'escalations', label: 'Escalations', hint: 'Work escalated to you and stale-case reminders' },
  { key: 'intel', label: 'Intelligence', hint: 'Field intelligence assigned, questions and replies' },
  { key: 'reports', label: 'Reports', hint: 'Report review, returns and finalizations' },
  { key: 'announcements', label: 'Announcements', hint: 'Department-wide posts' },
  { key: 'security', label: 'Security', hint: 'Portal access changes, audit and app errors' },
]

export const ALL_DISCORD_CATEGORY_KEYS: readonly string[] = DISCORD_CATEGORIES.map((c) => c.key)

/** The Discord category of a notification type (`other` when unmapped). */
export const discordCategoryOf = (type: string): string => NOTIF_CATEGORY[type] ?? 'other'

/** The viewer's enabled Discord categories. No row means EVERY category
 *  (the pre-Phase-7 behaviour for a linked Discord); a row with `[]` means
 *  none. A FAILED read returns `null` — distinct from "no row" on purpose:
 *  the profile toggle must never mistake an outage for "everything on" and
 *  write the widened list back over the member's real preference. */
export async function loadDiscordCategories(): Promise<string[] | null> {
  try {
    const rows = await list('user_prefs', { select: 'value', eq: { key: DISCORD_PREF_KEY } })
    if (!rows.length) return [...ALL_DISCORD_CATEGORY_KEYS]
    const v = (rows[0]?.value ?? null) as { categories?: unknown } | null
    const cats = Array.isArray(v?.categories) ? v.categories.filter((t): t is string => typeof t === 'string') : []
    return cats.filter((c) => ALL_DISCORD_CATEGORY_KEYS.includes(c))
  } catch {
    return null
  }
}

export async function saveDiscordCategories(categories: readonly string[]): Promise<DbError | null> {
  const clean = [...new Set(categories)].filter((c) => ALL_DISCORD_CATEGORY_KEYS.includes(c))
  const res = await upsert('user_prefs', { key: DISCORD_PREF_KEY, value: { categories: clean } }, 'user_id,key', 'key')
  return res.error
}
