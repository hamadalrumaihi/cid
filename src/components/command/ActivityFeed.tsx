'use client'

/** Division activity feed — last 12 audit_log rows (command.js:213-222).
 *  audit_log is INSERT-only via the private.audit() trigger; RLS scopes what
 *  each viewer gets back. */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { timeAgo } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'

type AuditRow = Tables<'audit_log'>

const DOT: Record<string, string> = { INSERT: 'bg-emerald-400', UPDATE: 'bg-blue-400', DELETE: 'bg-rose-400' }
const VERB: Record<string, string> = { INSERT: 'created', UPDATE: 'updated', DELETE: 'removed' }

export function ActivityFeed() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const v = useTableVersion('audit_log')
  // Re-render when the roster cache lands so actor names resolve.
  useProfilesStore((s) => s.loaded)

  const refresh = useCallback(async () => {
    try { setRows(await list('audit_log', { order: 'created_at', ascending: false, limit: 12 })) }
    catch { /* transient — keep the previous feed */ }
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, v])

  if (!rows.length) return <p className="text-sm text-slate-500">No recent activity.</p>
  return (
    <ul className="space-y-4">
      {rows.map((a) => (
        <li key={a.id} className="flex gap-3">
          <span className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${DOT[a.action] || 'bg-slate-400'}`} />
          <div className="flex-1">
            <p className="text-sm text-slate-200">
              <span className="font-semibold text-white">{officerName(a.actor_id) || 'System'}</span>{' '}
              {VERB[a.action] || a.action.toLowerCase()} {(a.entity || '').replace(/_/g, ' ')}
            </p>
            <p className="text-[11px] text-slate-500">{timeAgo(a.created_at)}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
