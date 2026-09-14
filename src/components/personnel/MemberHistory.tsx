'use client'

/** One member's personnel history — the recorded `role_events` for this
 *  account, newest first.
 *
 *  Command was deciding on people with no record of what had already been
 *  decided: whether this is their third bureau this month, whether they were
 *  deactivated before, who promoted them and why. The rows exist (role_events
 *  is command-readable and every audited RPC writes one); they simply were not
 *  shown where the decision is made.
 *
 *  Read-only, and deliberately shallow: the full division-wide audit log stays
 *  owner-only. A read failure says so rather than rendering as "no history",
 *  which would read as "this account has never been touched". */
import { useCallback, useEffect, useState } from 'react'
import { list } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { timeAgo } from '@/lib/format'
import { roleEventLine } from '@/lib/personnel'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { ErrorNotice } from '@/components/ui/Notice'

type RoleEvent = Tables<'role_events'>

const LIMIT = 12

export function MemberHistory({ memberId }: { memberId: string }) {
  const [rows, setRows] = useState<RoleEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const v = useTableVersion('role_events')

  const load = useCallback(async () => {
    setError(null)
    try {
      setRows(await list('role_events', {
        eq: { target_id: memberId }, order: 'created_at', ascending: false, limit: LIMIT,
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [memberId])

  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => { if (live) void load() }, 0)
    return () => { live = false; window.clearTimeout(t) }
  }, [load, v])

  if (error) return <ErrorNotice message={error} onRetry={() => { void load() }} className="p-4 text-left" />
  if (rows === null) return <p className="text-[11px] text-slate-500">Loading history…</p>
  if (!rows.length) return <p className="text-[11px] text-slate-500">No recorded role, transfer or activation events for this account.</p>

  return (
    <ol className="space-y-1.5">
      {rows.map((e) => (
        <li key={e.id} className="rounded-lg border border-white/5 bg-ink-950/50 px-3 py-2">
          <p className="text-xs text-slate-200">{roleEventLine(e)}</p>
          <p className="text-[11px] text-slate-500">
            {timeAgo(e.created_at)}
            {e.actor_id && <> · by {officerName(e.actor_id) || 'Command'}</>}
          </p>
          {e.reason && <p className="mt-0.5 text-[11px] text-slate-400">“{e.reason}”</p>}
        </li>
      ))}
    </ol>
  )
}
