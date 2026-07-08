'use client'

/** "Jump back in" strip — pinned + recently-opened cases (casefiles.js:126-136).
 *  Reads the SAME Store keys the Cases slice writes (pinnedCases/recentCases),
 *  in an effect so the prerender (no localStorage) matches first paint. */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { pinnedCaseIds, recentCaseIds } from '@/components/cases/caseUtils'
import type { CaseRow } from './commandUtils'

export function JumpBack({ cases }: { cases: CaseRow[] }) {
  const [ids, setIds] = useState<{ pinned: string[]; recent: string[] } | null>(null)

  useEffect(() => {
    const id = window.setTimeout(() => {
      const pinned = pinnedCaseIds()
      setIds({ pinned, recent: recentCaseIds().filter((x) => !pinned.includes(x)) })
    }, 0)
    return () => window.clearTimeout(id)
  }, [cases])

  if (!ids) return null
  const resolve = (list: string[]) => list.map((id) => cases.find((c) => c.id === id)).filter((c): c is CaseRow => !!c)
  const pinned = resolve(ids.pinned)
  const recent = resolve(ids.recent)
  if (!pinned.length && !recent.length) return null

  const chip = (c: CaseRow, icon: string) => (
    <Link
      key={c.id}
      href={`/cases?case=${encodeURIComponent(c.id)}`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 text-xs text-slate-200 transition hover:border-blue-500/40 hover:bg-white/5"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="font-mono text-blue-300">{c.case_number}</span>
      <span className="max-w-[10rem] truncate text-slate-400">{c.title || ''}</span>
    </Link>
  )

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Jump back in</p>
      <div className="flex flex-wrap gap-2">
        {pinned.map((c) => chip(c, '📌'))}
        {recent.map((c) => chip(c, '🕘'))}
      </div>
    </div>
  )
}
