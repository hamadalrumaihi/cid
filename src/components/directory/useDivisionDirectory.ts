'use client'

/** The Division Directory's data. One source of truth, one subscription.
 *
 *  The rows are the shared roster cache (lib/profiles → `public.profiles`
 *  through the non-email projection); the decoration is the commendations
 *  table. Nothing is copied into a directory-shaped store and nothing is
 *  patched in place: every change — a bureau transfer, a rank change, an LOA
 *  start, an approval, a deactivation — is a change to `profiles`, and the
 *  model is rebuilt from it.
 *
 *  LIVE. The screen follows the `profiles` and `commendations` channels and
 *  RE-READS on a change; the realtime payload is never trusted as the answer,
 *  so a change to a row this viewer may not read refreshes a list that still
 *  does not contain it. `subscribeTable` registers at most one channel per
 *  table per session however many screens mount (lib/realtime), and a channel
 *  that drops and recovers bumps the counter so the missed window is re-read
 *  rather than silently lost. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { buildDirectory, type Directory } from '@/lib/directory'
import { useProfilesStore } from '@/lib/profiles'
import { useTableStatus, useTableVersion, type ChannelStatus } from '@/lib/realtime'
import type { CommendationRow } from './Commendations'

export interface DivisionDirectoryState {
  directory: Directory
  commendations: CommendationRow[]
  /** The first read has not landed — show a skeleton, never "no members". */
  loading: boolean
  /** A re-read over rows already on screen (realtime bump or manual refresh). */
  refreshing: boolean
  /** The last read's failure. Rows may still be shown beneath it. */
  error: string | null
  /** Live-update health, for the reconnecting note. */
  connection: ChannelStatus
  refresh: () => Promise<void>
}

export function useDivisionDirectory(): DivisionDirectoryState {
  const { state } = useAuth()
  const profiles = useProfilesStore((s) => s.profiles)
  const loaded = useProfilesStore((s) => s.loaded)
  const loading = useProfilesStore((s) => s.loading)
  const rosterError = useProfilesStore((s) => s.error)
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [commendations, setCommendations] = useState<CommendationRow[]>([])

  const vProfiles = useTableVersion('profiles')
  const vCommendations = useTableVersion('commendations')
  const connection = useTableStatus('profiles')

  // Nothing may land after the screen is gone: an unmounted view that still
  // sets state is the leak this guard exists to prevent.
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    // The roster is the screen; the commendations are decoration, so their
    // failure degrades to none rather than failing the directory.
    const commendationRows = list('commendations', { order: 'created_at', ascending: false })
      .catch((): CommendationRow[] => [])
    await fetchProfiles()
    const rows = await commendationRows
    if (live.current) setCommendations(rows)
  }, [state, fetchProfiles])

  useEffect(() => {
    // Deferred so the first paint isn't blocked (the useRegistry idiom).
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vProfiles, vCommendations])

  return {
    directory: buildDirectory(profiles, commendations),
    commendations,
    loading: !loaded && loading,
    refreshing: loaded && loading,
    error: rosterError,
    connection,
    refresh,
  }
}
