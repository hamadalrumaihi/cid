'use client'

/** useLibrary — the shelf's data loader. Narrow projections ONLY (SHELF_COLS;
 *  the generated `excerpt` column carries the preview — full bodies load in
 *  the reader, never here). Alongside the shelf rows it loads the caller's OWN
 *  acknowledgements (RLS admits only own rows → MyAckVersions), bookmarks
 *  (document_user_state, strictly private per-user), and active reading
 *  campaigns (deadline display in the Required view; best-effort — a denial
 *  degrades to the document's own acknowledgement_deadline).
 *
 *  Realtime: only `documents` is in the publication — acknowledgements/
 *  bookmarks refresh alongside on the same bump and after local actions.
 *  Loading contract: rows are null until the FIRST successful load (skeleton
 *  signal); later failures keep stale rows visible and surface `error` so the
 *  shelf can show ErrorNotice + retry — never a false all-clear. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { list, withRetry } from '@/lib/db'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { SHELF_COLS, type MyAckVersions, type ShelfDoc } from './docModel'

/** Embedded version row from the acknowledgements join — PostgREST may hand
 *  back an object or an array depending on relationship detection; guard both. */
interface AckJoinRow {
  document_id: string
  documents_versions: { version_number: number } | { version_number: number }[] | null
}
interface MarkRow { document_id: string; bookmarked: boolean }
interface CampaignRow { document_id: string; deadline: string | null; status: string }

export interface Library {
  /** null until the first successful load — the skeleton signal. */
  rows: ShelfDoc[] | null
  myAcks: MyAckVersions
  bookmarks: ReadonlySet<string>
  /** document_id → earliest active campaign deadline (Required view chip). */
  campaignDeadlines: ReadonlyMap<string, string>
  error: string | null
  /** Re-fetching after a successful load — stale rows stay visible. */
  refreshing: boolean
  /** ms timestamp of the last successful load (refreshed-at hint). */
  loadedAt: number | null
  refresh: () => Promise<void>
  /** Optimistic bookmark toggle (private document_user_state upsert). */
  toggleBookmark: (docId: string) => Promise<void>
}

export function useLibrary(): Library {
  const { state, profile } = useAuth()
  const userId = profile?.id ?? null
  const version = useTableVersion('documents')

  const [rows, setRows] = useState<ShelfDoc[] | null>(null)
  const [myAcks, setMyAcks] = useState<MyAckVersions>({})
  const [bookmarks, setBookmarks] = useState<ReadonlySet<string>>(new Set())
  const [campaignDeadlines, setCampaignDeadlines] = useState<ReadonlyMap<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)
  const hasLoaded = useRef(false)
  const bookmarksRef = useRef(bookmarks)
  useEffect(() => { bookmarksRef.current = bookmarks })

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    if (hasLoaded.current) setRefreshing(true)
    setError(null)
    try {
      const [docs, acks, marks, camps] = await Promise.all([
        // ShelfDoc is a Pick of the row type, so the projected result narrows
        // structurally — absent columns (content, …) are simply never read.
        withRetry(() => list('documents', { select: SHELF_COLS, order: 'updated_at', ascending: false })),
        // Own rows only (RLS) — the whole result IS "my acknowledgements".
        list('document_acknowledgements', { select: 'document_id, documents_versions(version_number)' })
          .then((r) => r as unknown as AckJoinRow[]),
        list('document_user_state', { select: 'document_id, bookmarked', eq: { bookmarked: true } })
          .then((r) => r as unknown as MarkRow[]),
        // Best-effort: a campaign-read denial must not sink the whole shelf.
        list('document_reading_campaigns', { select: 'document_id, deadline, status', eq: { status: 'active' } })
          .then((r) => r as unknown as CampaignRow[])
          .catch(() => [] as CampaignRow[]),
      ])

      const ackMap: MyAckVersions = {}
      for (const a of acks) {
        const v = a.documents_versions
        const nums = Array.isArray(v) ? v.map((x) => x.version_number) : v ? [v.version_number] : []
        if (nums.length) ackMap[a.document_id] = [...(ackMap[a.document_id] ?? []), ...nums]
      }
      const deadlines = new Map<string, string>()
      for (const c of camps) {
        if (!c.deadline) continue
        const prev = deadlines.get(c.document_id)
        if (!prev || c.deadline < prev) deadlines.set(c.document_id, c.deadline)
      }

      setRows(docs)
      setMyAcks(ackMap)
      setBookmarks(new Set(marks.map((m) => m.document_id)))
      setCampaignDeadlines(deadlines)
      setLoadedAt(Date.now())
      hasLoaded.current = true
    } catch (e) {
      // Keep stale rows visible; the shelf decides how loudly to surface this.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }, [state])

  useEffect(() => {
    // Deferred so the first paint isn't blocked (established view pattern).
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  const toggleBookmark = useCallback(async (docId: string) => {
    if (!userId) return
    const on = !bookmarksRef.current.has(docId)
    const apply = (want: boolean) => setBookmarks((prev) => {
      const next = new Set(prev)
      if (want) next.add(docId); else next.delete(docId)
      return next
    })
    apply(on) // optimistic — revert on failure
    // No shared upsert helper exists in lib/db; the typed client's upsert on
    // the (user_id, document_id) primary key is the one-round-trip write.
    const { error: err } = await supabase()
      .from('document_user_state')
      .upsert({ user_id: userId, document_id: docId, bookmarked: on }, { onConflict: 'user_id,document_id' })
    if (err) {
      apply(!on)
      toast(`Bookmark failed: ${err.message}`, 'danger')
    }
  }, [userId])

  return { rows, myAcks, bookmarks, campaignDeadlines, error, refreshing, loadedAt, refresh, toggleBookmark }
}
