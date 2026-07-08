'use client'

/** Penal Code catalog — port of vanilla penal.js renderPenalView. Read-only,
 *  searchable list of all 162 statutes with level tint, sentence, fine and
 *  RICO predicate badge. Same dataset as the case-detail charge picker. */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { fmtUSD } from '@/lib/format'
import { PENAL_CODE, PENAL_LEVEL_TINT, penalSearch, penalSentence } from '@/lib/penal'
import { SearchIcon } from '@/components/shell/icons'

export function PenalView() {
  const sp = useSearchParams()
  // `?q=` seeds the filter — how global-search charge results land here.
  const [query, setQuery] = useState(() => sp.get('q') ?? '')
  const rows = useMemo(() => penalSearch(query.trim()), [query])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[12rem] flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code, title, level…"
            aria-label="Search statutes"
            className="w-full rounded-lg border border-white/10 bg-ink-850 py-2 pl-9 pr-3 text-sm text-slate-200 outline-none transition focus:border-badge-500"
          />
        </div>
        <span className="t-readout text-[11px] text-slate-500">{rows.length} / {PENAL_CODE.length} STATUTES</span>
      </div>
      <div className="space-y-1.5">
        {rows.length ? rows.map((c) => (
          <div key={c.code} className="rounded-xl border border-white/10 bg-ink-900 px-4 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-200">
                <span className="font-mono font-semibold text-blue-300">{c.code}</span> {c.title}
                {c.rico && <span className="ml-1 rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-fuchsia-300">RICO</span>}
              </p>
              <p className="t-readout text-[11px] text-slate-400">
                <span className={`rounded border px-1.5 py-0.5 ${PENAL_LEVEL_TINT[c.level] ?? ''}`}>{c.level}</span>{' '}
                {penalSentence(c.jail)}{c.fine != null && ` · ${fmtUSD(c.fine)}`}
              </p>
            </div>
            {c.desc && <p className="mt-1 text-xs text-slate-500">{c.desc}</p>}
          </div>
        )) : <p className="t-readout p-6 text-center text-sm text-slate-500">NO STATUTE MATCH // REFINE SEARCH.</p>}
      </div>
    </div>
  )
}
