'use client'

/** Realtime subscription registry — React adaptation of vanilla
 *  CIDApp.realtime.subscribeOnce (core.js:1074-1084) + CIDDB.subscribe.
 *
 *  One channel per table (`rt_<table>`), registered at most once per authed
 *  session so remounting views never double-subscribes (the vanilla
 *  rt_cases double-subscribe bug). Instead of callbacks, every change bumps a
 *  per-table version counter in a zustand store; components subscribe with
 *  useTableVersion(table) and refetch when it moves. Teardown happens on
 *  sign-out via supabase.removeAllChannels() (auth.tsx) + resetRealtime().
 *
 *  Case-scoped channels (P3-08): a case view that subscribed to fourteen
 *  whole tables refetched its snapshot whenever ANY case changed. The
 *  `rt_<table>_<caseId>` channels below carry a `case_id=eq.<id>` filter so
 *  only the open case's own rows move its counters; if the server refuses
 *  the filtered subscription (CHANNEL_ERROR / TIMED_OUT — an unpublished
 *  table, a filter the realtime tier does not accept) the table falls back
 *  to the whole-table channel and its scoped counter follows that one. */
import { useEffect } from 'react'
import { create } from 'zustand'
import { isConfigured, supabase } from './supabase'

/** A table channel's connection, as far as the client can tell. A screen
 *  reading live data needs to be able to SAY when it stopped being live —
 *  events do not arrive with an apology. */
export type ChannelStatus = 'connecting' | 'live' | 'down'

interface RtState {
  versions: Record<string, number>
  /** Per-table channel health; absent = never subscribed (connecting). */
  channels: Record<string, ChannelStatus>
  bump: (key: string) => void
  setChannel: (table: string, status: ChannelStatus) => void
}

export const useRealtimeStore = create<RtState>((set) => ({
  versions: {},
  channels: {},
  bump: (key) => set((s) => ({ versions: { ...s.versions, [key]: (s.versions[key] ?? 0) + 1 } })),
  setChannel: (table, status) => set((s) =>
    s.channels[table] === status ? s : { channels: { ...s.channels, [table]: status } }),
}))

/** Read a table channel's health outside React (tests, helpers). */
export const tableStatus = (table: string): ChannelStatus =>
  useRealtimeStore.getState().channels[table] ?? 'connecting'

const registered = new Set<string>()
/** One live row-scoped channel per store key, with the number of mounted
 *  views holding it. A whole-table channel is shared by every view and stays
 *  for the session; a row-scoped one belongs to an open record, so a session
 *  that walks through twenty dossiers would otherwise keep twenty channels it
 *  will never hear from again. The last holder to let go closes it. */
const scoped = new Map<string, { count: number; table: string; channel: ScopedChannel | null }>()
type ScopedChannel = ReturnType<ReturnType<typeof supabase>['channel']>
/** Row-scoped channels that fell back to the whole-table channel, per
 *  table: their scoped counters (store keys) are bumped from the table-wide
 *  events. */
const fallbackKeys = new Map<string, Set<string>>()
const warnedTables = new Set<string>()

/** Store key for a (table, column, id) counter. The case helpers below keep
 *  their historical `<table>:<caseId>` key so nothing that reads the store
 *  directly moves; every other column is namespaced as
 *  `<table>:<column>=<id>` so two scopes on one table never collide. */
export const rowVersionKey = (table: string, column: string, id: string): string =>
  column === 'case_id' ? `${table}:${id}` : `${table}:${column}=${id}`

/** Store key for a (table, caseId) counter — exported for the unit test. */
export const caseVersionKey = (table: string, caseId: string): string => rowVersionKey(table, 'case_id', caseId)

/** Per-table leading+trailing debounce for the version bumps. Contract: the
 *  FIRST event of a burst bumps immediately (a lone change stays prompt); any
 *  further events within `waitMs` collapse into ONE trailing bump after the
 *  burst goes quiet — so a bulk insert of N rows costs every subscribed view
 *  O(1) refetch cycles, not N. Exported for the unit test. */
export function createDebouncedBump(bump: (table: string) => void, waitMs = 300): (table: string) => void {
  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; again: boolean }>()
  return (table) => {
    const prev = pending.get(table)
    if (prev) clearTimeout(prev.timer) // mid-burst: fold into the trailing bump
    else bump(table) // leading edge — the first event of a burst is prompt
    const entry = {
      again: !!prev,
      timer: setTimeout(() => {
        pending.delete(table)
        if (entry.again) bump(table)
      }, waitMs),
    }
    pending.set(table, entry)
  }
}

/** A whole-table event bumps the table counter AND every scoped counter
 *  whose filtered channel fell back to this table. */
const bumpTable = (table: string): void => {
  const { bump } = useRealtimeStore.getState()
  bump(table)
  for (const key of fallbackKeys.get(table) ?? []) bump(key)
}

const debouncedBump = createDebouncedBump((key) => {
  if (key.includes(':')) useRealtimeStore.getState().bump(key)
  else bumpTable(key)
})

/** Subscribe (once per session) to postgres_changes for a table. Safe to call
 *  from every mount — repeat calls are no-ops. */
export function subscribeTable(table: string): void {
  if (!isConfigured || typeof window === 'undefined' || registered.has(table)) return
  registered.add(table)
  try {
    supabase()
      .channel(`rt_${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        debouncedBump(table)
      })
      // Channel health, and the reconnect rule. Postgres changes that happen
      // while the socket is down are NOT replayed, so a channel that comes
      // back is a channel with a hole behind it: the recovery bumps the
      // counter and every subscriber re-reads. The first SUBSCRIBED is not a
      // recovery — the screen is already doing its initial load.
      .subscribe((status) => {
        const { setChannel } = useRealtimeStore.getState()
        if (status === 'SUBSCRIBED') {
          const recovered = tableStatus(table) === 'down'
          setChannel(table, 'live')
          if (recovered) debouncedBump(table)
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setChannel(table, 'down')
        }
      })
  } catch {
    registered.delete(table) // allow a later retry if channel setup failed
  }
}

/** Subscribe (once per session) to the rows of a table whose `column`
 *  equals `id`. The channel is `rt_<table>_<column>_<id>` (the historical
 *  `rt_<table>_<caseId>` name for case scopes) with a `<column>=eq.<id>`
 *  filter; only those rows bump `rowVersionKey(table, column, id)`. A refused
 *  filtered subscription falls back to the whole-table channel (logged once
 *  per table) so the view still refreshes — just less selectively. P4-05
 *  generalised the case-only version so the legal dossier can follow one
 *  request's comments (`legal_request_id=eq.<id>`) with the same mechanics. */
export function subscribeRowScoped(table: string, column: string, id: string): void {
  const key = rowVersionKey(table, column, id)
  if (!isConfigured || typeof window === 'undefined' || !id) return
  const held = scoped.get(key)
  if (held) { held.count += 1; return } // another view already has this one
  if (registered.has(key)) return
  registered.add(key)
  const entry: { count: number; table: string; channel: ScopedChannel | null } = { count: 1, table, channel: null }
  scoped.set(key, entry)
  const fallBack = (status: string) => {
    if (!fallbackKeys.has(table)) fallbackKeys.set(table, new Set())
    fallbackKeys.get(table)!.add(key)
    if (!warnedTables.has(table)) {
      warnedTables.add(table)
      console.warn(`[realtime] filtered channel for ${table} refused (${status}); falling back to the whole-table channel`)
    }
    subscribeTable(table)
  }
  try {
    const client = supabase()
    const channelName = column === 'case_id' ? `rt_${table}_${id}` : `rt_${table}_${column}_${id}`
    const channel = client
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `${column}=eq.${id}` }, () => {
        debouncedBump(key)
      })
    entry.channel = channel
    let fellBack = false
    channel.subscribe((status) => {
      if (fellBack || (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT')) return
      fellBack = true
      entry.channel = null
      void client.removeChannel(channel)
      fallBack(status)
    })
  } catch {
    registered.delete(key) // allow a later retry if channel setup failed
    scoped.delete(key)
  }
}

/** Give up one hold on a row-scoped subscription — the mirror of
 *  subscribeRowScoped, called when a view unmounts or points at another
 *  record. The channel closes only when the last holder lets go, so two
 *  sections on the same record do not tear each other's subscription down.
 *  A scope that fell back to the whole-table channel simply stops following
 *  it; the table channel itself is shared and stays. Safe to call for a scope
 *  that was never subscribed. */
export function releaseRowScoped(table: string, column: string, id: string): void {
  const key = rowVersionKey(table, column, id)
  const held = scoped.get(key)
  if (!held) return
  held.count -= 1
  if (held.count > 0) return
  scoped.delete(key)
  registered.delete(key)
  fallbackKeys.get(table)?.delete(key)
  if (!held.channel) return
  try {
    void supabase().removeChannel(held.channel)
  } catch { /* the client is gone; the channel went with it */ }
}

/** Subscribe (once per session) to one case's rows of a table — the
 *  `case_id` specialisation of subscribeRowScoped (P3-08). */
export function subscribeCaseTable(table: string, caseId: string): void {
  subscribeRowScoped(table, 'case_id', caseId)
}

/** Forget local registrations after sign-out — the channels themselves are
 *  torn down by removeAllChannels() in the auth layer. */
export function resetRealtime(): void {
  registered.clear()
  scoped.clear()
  useRealtimeStore.setState({ channels: {} })
  fallbackKeys.clear()
  warnedTables.clear()
}

/** Version counter for a table — changes whenever any row changes. Also
 *  registers the subscription on first mount (idempotent). */
export function useTableVersion(table: string): number {
  useEffect(() => { subscribeTable(table) }, [table])
  return useRealtimeStore((s) => s.versions[table] ?? 0)
}

/** A table channel's health, for a screen that must tell the reader when its
 *  live data stopped being live. Registers the subscription like
 *  useTableVersion, so a screen may use either or both. */
export function useTableStatus(table: string): ChannelStatus {
  useEffect(() => { subscribeTable(table) }, [table])
  return useRealtimeStore((s) => s.channels[table] ?? 'connecting')
}

/** Version counter for the rows of a table where `column = id`. Registers
 *  the filtered subscription on first mount; moves only for those rows (or,
 *  after a fallback, with the whole table). */
export function useRowScopedVersion(table: string, column: string, id: string): number {
  useEffect(() => {
    subscribeRowScoped(table, column, id)
    return () => releaseRowScoped(table, column, id)
  }, [table, column, id])
  const key = rowVersionKey(table, column, id)
  return useRealtimeStore((s) => s.versions[key] ?? 0)
}

/** Version counter for one case's rows of a table (P3-08) — the `case_id`
 *  specialisation of useRowScopedVersion. */
export function useCaseTableVersion(table: string, caseId: string): number {
  return useRowScopedVersion(table, 'case_id', caseId)
}
