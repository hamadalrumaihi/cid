'use client'

/** Workspace persistence — IDS ONLY, three layers:
 *   1. `user_prefs` key `workspace` (owner-only RLS): the source of truth,
 *      so open tabs follow the member across refresh, logout/login and
 *      devices. Written debounced by the provider.
 *   2. sessionStorage mirror `cid-workspace:<uid>` for an instant reload in
 *      the same browser tab (no round-trip before the strip appears).
 *   3. The pre-workspace ToolsView payload `cid-tools-workspace:<uid>` —
 *      adopted ONCE the first time the new workspace runs, then deleted.
 *  Nothing here stores titles, counts or data; every restore re-resolves
 *  titles through the viewer's RLS-scoped client (WorkspaceProvider). */
import type { Json } from '@/lib/database.types'
import { list, upsert } from '@/lib/db'
import { parseLegacyTools, parseStored, type StoredWorkspace } from './model'

export const WORKSPACE_PREF_KEY = 'workspace'
const MIRROR_PREFIX = 'cid-workspace:'
const LEGACY_PREFIX = 'cid-tools-workspace:'

export const mirrorKey = (uid: string): string => MIRROR_PREFIX + uid

export function readMirror(uid: string): StoredWorkspace | null {
  try {
    const raw = sessionStorage.getItem(mirrorKey(uid))
    return raw ? parseStored(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function writeMirror(uid: string, stored: StoredWorkspace): void {
  try { sessionStorage.setItem(mirrorKey(uid), JSON.stringify(stored)) } catch { /* storage unavailable */ }
}

/** Read the legacy tools payload AND remove it (one-time adoption). */
export function takeLegacy(uid: string): StoredWorkspace | null {
  try {
    const raw = sessionStorage.getItem(LEGACY_PREFIX + uid)
    if (raw === null) return null
    sessionStorage.removeItem(LEGACY_PREFIX + uid)
    return parseLegacyTools(JSON.parse(raw))
  } catch {
    return null
  }
}

/** Server copy — null when there is no row, on garbage, or when the read
 *  fails (offline): the provider then falls back to the mirror / legacy. */
export async function loadPref(): Promise<StoredWorkspace | null> {
  try {
    const rows = await list('user_prefs', { eq: { key: WORKSPACE_PREF_KEY }, limit: 1 })
    return rows[0] ? parseStored(rows[0].value) : null
  } catch {
    return null
  }
}

export async function savePref(stored: StoredWorkspace): Promise<void> {
  try {
    await upsert('user_prefs', { key: WORKSPACE_PREF_KEY, value: stored as unknown as Json }, 'user_id,key', 'key')
  } catch { /* best-effort — the mirror still restores this tab; retried on the next change */ }
}
