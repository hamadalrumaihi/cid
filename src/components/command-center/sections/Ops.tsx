'use client'

/** Command Center → Trackers & Raid Comp. The two operational tools that
 *  lived on the retired Division Overview (/command): GPS tracker deployment
 *  logs with dual command co-signs, and the raid compensation calculator
 *  (local preview only). Trackers need the live case list for its case
 *  picker and case-number lookups — one bounded projection here, RLS-scoped. */
import { useCallback, useEffect, useState } from 'react'
import { list, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import type { CaseRow } from '../lib/commandUtils'
import { RaidComp } from './RaidComp'
import { Trackers } from './Trackers'

/** Everything Trackers reads off a case: the picker label, the id join and
 *  the bureau a new tracker inherits from its linked case. */
const CASE_COLS = 'id,case_number,title,status,bureau,updated_at'

export function CommandOps() {
  const { state } = useAuth()
  const [cases, setCases] = useState<CaseRow[]>([])
  const vCases = useTableVersion('cases')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    try {
      const rows = await withRetry(() => list('cases', {
        select: CASE_COLS, is: { archived_at: null }, order: 'updated_at', ascending: false, limit: 400,
      }))
      setCases(rows as unknown as CaseRow[])
    } catch { /* transient — keep the previous list; Trackers degrades to '—' */ }
  }, [state])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, vCases])

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <Trackers cases={cases} />
      <RaidComp />
    </div>
  )
}
