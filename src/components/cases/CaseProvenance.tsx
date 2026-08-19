'use client'

/** Where this case came from.
 *
 *  A case opened from an intelligence record carries a link that nobody can
 *  remove. This is the panel that makes it worth having: in a year, when the
 *  detective who opened the case has moved on and somebody asks why this
 *  investigation exists, the answer is on the case rather than in the memory of
 *  whoever was on shift.
 *
 *  It shows the record's NUMBER, which is frozen into the link at link time —
 *  so it still reads correctly for somebody with no jurisdiction over that
 *  record, and for a record that has since been deleted.
 */

import { useEffect, useState } from 'react'
import { fmtDateTime } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { isProvenance, liveLinks, loadCaseProvenance, type FieldCaseLinkRow } from '@/lib/fieldActions'

export function CaseProvenance({ caseId }: { caseId: string }) {
  const [links, setLinks] = useState<FieldCaseLinkRow[]>([])

  useEffect(() => {
    let alive = true
    const t = window.setTimeout(() => {
      void loadCaseProvenance(caseId)
        .then((r) => { if (alive) setLinks(r) })
        .catch(() => { if (alive) setLinks([]) })
    }, 0)
    return () => { alive = false; window.clearTimeout(t) }
  }, [caseId])

  const live = liveLinks(links)
  if (!live.length) return null

  const opened = live.find(isProvenance)
  const fed = live.filter((l) => !isProvenance(l))

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
      <h3 className="mb-2 font-bold text-white">Where this came from</h3>
      {opened && (
        <p className="text-sm text-slate-200">
          Opened from intelligence record{' '}
          <span className="font-mono">{opened.submission_no || 'unnumbered'}</span>
          <span className="block text-xs text-slate-500">
            {officerName(opened.linked_by) ?? 'Somebody'} · {fmtDateTime(opened.linked_at)}
            {' · this cannot be unlinked'}
          </span>
        </p>
      )}
      {fed.length > 0 && (
        <div className={opened ? 'mt-3' : ''}>
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
            Also fed by
          </p>
          <ul className="mt-1 space-y-1">
            {fed.map((l) => (
              <li key={l.id} className="text-sm text-slate-300">
                <span className="font-mono">{l.submission_no || 'unnumbered'}</span>
                {l.note && <span className="text-xs text-slate-500"> — {l.note}</span>}
                <span className="block text-xs text-slate-500">
                  {officerName(l.linked_by) ?? 'Somebody'} · {fmtDateTime(l.linked_at)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
