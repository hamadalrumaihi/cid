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

interface RtState {
  versions: Record<string, number>
  bump: (key: string) => void
}

export const useRealtimeStore = create<RtState>((set) => ({
  versions: {},
  bump: (key) => set((s) => ({ versions: { ...s.versions, [key]: (s.versions[key] ?? 0) + 1 } })),
}))

const registered = new Set<string>()
/** Case-scoped channels that fell back to the whole-table channel, per
 *  table: their scoped counters are bumped from the table-wide events. */
const fallbackCases = new Map<string, Set<string>>()
const warnedTables = new Set<string>()

/** Store key for a (table, caseId) counter — exported for the unit test. */
export const caseVersionKey = (table: string, caseId: string): string => `${table}:${caseId}`

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
  for (const caseId of fallbackCases.get(table) ?? []) bump(caseVersionKey(table, caseId))
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
      .subscribe()
  } catch {
    registered.delete(table) // allow a later retry if channel setup failed
  }
}

/** Subscribe (once per session) to one case's rows of a table. The channel
 *  is `rt_<table>_<caseId>` with a `case_id=eq.<caseId>` filter; only that
 *  case's changes bump `caseVersionKey(table, caseId)`. A refused filtered
 *  subscription falls back to the whole-table channel (logged once per
 *  table) so the view still refreshes — just less selectively. */
export function subscribeCaseTable(table: string, caseId: string): void {
  const key = caseVersionKey(table, caseId)
  if (!isConfigured || typeof window === 'undefined' || !caseId || registered.has(key)) return
  registered.add(key)
  const fallBack = (status: string) => {
    if (!fallbackCases.has(table)) fallbackCases.set(table, new Set())
    fallbackCases.get(table)!.add(caseId)
    if (!warnedTables.has(table)) {
      warnedTables.add(table)
      console.warn(`[realtime] filtered channel for ${table} refused (${status}); falling back to the whole-table channel`)
    }
    subscribeTable(table)
  }
  try {
    const client = supabase()
    const channel = client
      .channel(`rt_${table}_${caseId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, filter: `case_id=eq.${caseId}` }, () => {
        debouncedBump(key)
      })
    let fellBack = false
    channel.subscribe((status) => {
      if (fellBack || (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT')) return
      fellBack = true
      void client.removeChannel(channel)
      fallBack(status)
    })
  } catch {
    registered.delete(key) // allow a later retry if channel setup failed
  }
}

/** Forget local registrations after sign-out — the channels themselves are
 *  torn down by removeAllChannels() in the auth layer. */
export function resetRealtime(): void {
  registered.clear()
  fallbackCases.clear()
  warnedTables.clear()
}

/** Version counter for a table — changes whenever any row changes. Also
 *  registers the subscription on first mount (idempotent). */
export function useTableVersion(table: string): number {
  useEffect(() => { subscribeTable(table) }, [table])
  return useRealtimeStore((s) => s.versions[table] ?? 0)
}

/** Version counter for one case's rows of a table (P3-08). Registers the
 *  filtered subscription on first mount; moves only for that case (or, after
 *  a fallback, with the whole table). */
export function useCaseTableVersion(table: string, caseId: string): number {
  useEffect(() => { subscribeCaseTable(table, caseId) }, [table, caseId])
  const key = caseVersionKey(table, caseId)
  return useRealtimeStore((s) => s.versions[key] ?? 0)
}
