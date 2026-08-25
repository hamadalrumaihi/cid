'use client'

/** DB-backed never-lose-work drafts — the per-user successor to lib/drafts.
 *
 *  Layers, not a replacement: every save mirrors to localStorage FIRST (so a
 *  crash mid-flight or a dead network loses nothing), then a debounced upsert
 *  lands the draft in `public.user_drafts` (owner-only RLS, user_id defaults
 *  to auth.uid(), 64 KiB data ceiling, touch-trigger updated_at). Drafts
 *  therefore follow the member across devices, and the local mirror is
 *  namespaced per user (`u:<uid>:<key>`) — which closes the shared-terminal
 *  leak the plain Drafts keys have (see lib/drafts.ts).
 *
 *  Failure posture: silent degradation. A failed or offline server write
 *  keeps the local mirror and reports through the status store (rendered by
 *  ui/SaveState) — never a toast storm. Payloads too large for the server
 *  stay local-only ('local' status). Drafts are drafts: nothing here writes
 *  records or audit entries. */
import { create } from 'zustand'
import type { Json } from './database.types'
import { list, removeWhere, upsert } from './db'
import { Drafts } from './drafts'
import { supabase } from './supabase'

export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline' | 'local'
export interface DraftSaveState { status: DraftSaveStatus; lastSavedAt: number | null }
export interface LoadedDraft<T> { data: T; at: number; source: 'server' | 'local' }

/** The per-user localStorage mirror key. Namespacing by uid means two members
 *  sharing a terminal can no longer read each other's half-typed drafts on
 *  the surfaces that migrated to this layer. */
export const draftKeyFor = (uid: string, key: string): string => `u:${uid}:${key}`

/** Client-side ceiling for the SERVER copy — under the table's 64 KiB check
 *  constraint so an oversized draft degrades to local-only instead of a
 *  constraint error. The local mirror has no such cap. */
export const DRAFT_MAX_DB_BYTES = 60_000

/** True when the JSON payload is too large for user_drafts (UTF-8 bytes, not
 *  characters) — or cannot be serialised at all, which the server could never
 *  store either. Pure; unit-tested. */
export function oversizedForServer(data: unknown): boolean {
  try { return new TextEncoder().encode(JSON.stringify(data)).length > DRAFT_MAX_DB_BYTES } catch { return true }
}

/* ── Status store (feeds ui/SaveState via useDraftState) ──────────────────── */

const IDLE: DraftSaveState = { status: 'idle', lastSavedAt: null }

const useStatusStore = create<{ byKey: Record<string, DraftSaveState> }>(() => ({ byKey: {} }))

function setStatus(key: string, status: DraftSaveStatus, lastSavedAt?: number | null): void {
  useStatusStore.setState((s) => {
    const prev = s.byKey[key] ?? IDLE
    return { byKey: { ...s.byKey, [key]: { status, lastSavedAt: lastSavedAt === undefined ? prev.lastSavedAt : lastSavedAt } } }
  })
}

/** Live save-pipeline state for one draft key — pass it to <SaveState>. */
export function useDraftState(key: string): DraftSaveState {
  return useStatusStore((s) => s.byKey[key]) ?? IDLE
}

/* ── The pipeline ─────────────────────────────────────────────────────────── */

const DEBOUNCE_MS = 1500
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pendingData = new Map<string, unknown>()

/** Deliberately uncached: on a shared terminal the signed-in user can change
 *  between saves, and getSession() is an in-memory read after boot. */
async function currentUid(): Promise<string> {
  try { return (await supabase().auth.getSession()).data.session?.user.id ?? 'anon' } catch { return 'anon' }
}

const offlineNow = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false

/** Save a draft: local mirror immediately, server upsert 1500 ms (trailing)
 *  after the last call for this key. Callers fire-and-forget per keystroke. */
export async function saveDraft(key: string, data: unknown): Promise<void> {
  const uid = await currentUid()
  Drafts.save(draftKeyFor(uid, key), data)
  const t = timers.get(key)
  if (t) { clearTimeout(t); timers.delete(key) }
  if (oversizedForServer(data)) {
    pendingData.delete(key)
    setStatus(key, 'local', Date.now())
    return
  }
  pendingData.set(key, data)
  setStatus(key, 'saving')
  timers.set(key, setTimeout(() => { void flush(key) }, DEBOUNCE_MS))
}

async function flush(key: string): Promise<void> {
  timers.delete(key)
  if (!pendingData.has(key)) return // cleared while the timer was pending
  const data = pendingData.get(key)
  pendingData.delete(key)
  // A newer keystroke re-queued while this write is in flight — its own flush
  // reports the outcome, so this one must not stomp the 'saving' status.
  const superseded = () => timers.has(key) || pendingData.has(key)
  try {
    const res = await upsert('user_drafts', { key, data: data as Json }, 'user_id,key', 'key')
    if (superseded()) return
    if (res.error) setStatus(key, offlineNow() ? 'offline' : 'error')
    else setStatus(key, 'saved', Date.now())
  } catch {
    if (!superseded()) setStatus(key, offlineNow() ? 'offline' : 'error')
  }
}

/** Load a draft: server row and local mirror are both consulted and the newer
 *  one wins (an offline edit can be ahead of the last synced copy). Returns
 *  null when neither exists. */
export async function loadDraft<T = unknown>(key: string): Promise<LoadedDraft<T> | null> {
  const uid = await currentUid()
  const local = Drafts.load<T>(draftKeyFor(uid, key))
  let server: LoadedDraft<T> | null = null
  try {
    const rows = await list('user_drafts', { eq: { key }, limit: 1 })
    if (rows[0]) server = { data: rows[0].data as T, at: new Date(rows[0].updated_at).getTime(), source: 'server' }
  } catch { /* offline / RLS blip — the local mirror still answers */ }
  if (server && (!local || server.at >= local.at)) return server
  return local ? { data: local.data, at: local.at, source: 'local' } : null
}

/** Clear a draft everywhere: cancels any pending debounced write (so a save
 *  landing after "record saved" cannot resurrect it), drops the local mirror,
 *  and best-effort deletes the server row. */
export async function clearDraft(key: string): Promise<void> {
  const t = timers.get(key)
  if (t) { clearTimeout(t); timers.delete(key) }
  pendingData.delete(key)
  const uid = await currentUid()
  Drafts.clear(draftKeyFor(uid, key))
  setStatus(key, 'idle', null)
  try { await removeWhere('user_drafts', { eq: { key } }) } catch { /* best-effort — the mirror is already gone */ }
}
