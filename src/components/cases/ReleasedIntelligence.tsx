'use client'

/** §15, the CID side — intelligence SIB has released to this case.
 *
 *  This panel is rendered for ORDINARY CID members with no SIB standing at
 *  all. What they see is the released text and nothing else: no case number,
 *  no link, no identifier, no count of anything withheld. The originating
 *  investigation is not merely hidden from the UI — `siu_released_intelligence()`
 *  never projects it, and the underlying table returns zero rows to CID at
 *  every rank, so there is no query that would reveal it.
 *
 *  An empty result renders nothing at all. A CID case with no releases must
 *  look exactly like a CID case that has never been near SIB. */

import { useCallback, useEffect, useState } from 'react'
import { rpc } from '@/lib/db'
import {
  fetchReleasedIntelligence, siuHandlingLabel, siuReleaseItemLabel,
  type SiuReleasedItem,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { SectionHeader } from '@/components/ui/PageHeader'

const fmtWhen = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export function ReleasedIntelligence({ caseId }: { caseId: string }) {
  const [rows, setRows] = useState<SiuReleasedItem[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    setRows(await fetchReleasedIntelligence(caseId))
    setLoaded(true)
  }, [caseId])

  // Every state write lands after an await, so the effect body itself never
  // triggers a synchronous cascading render (the repo's ShiftsView pattern).
  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  const acknowledge = async (id: string) => {
    const res = await rpc('siu_acknowledge_disclosure', { p_id: id })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Receipt recorded.', 'success')
    void load()
  }

  // Nothing released — render nothing. No placeholder, no "0 items", no hint
  // that a channel exists at all.
  if (!loaded || !rows.length) return null

  return (
    <Card className="border-violet-500/20">
      <SectionHeader
        title="Released by the Special Investigations Bureau"
        subtitle="Provided for this case. This is the released material in full — SIB retains the investigation it came from."
      />
      <ul className="mt-3 space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tint="bg-violet-500/15 text-violet-300">{siuReleaseItemLabel(r.item_type)}</Badge>
              <span className="text-sm font-semibold text-slate-100">{r.title}</span>
              <Badge tone="neutral">{siuHandlingLabel(r.handling)}</Badge>
              <span className="ml-auto text-[11px] text-slate-500">{fmtWhen(r.released_at)}</span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-xs text-slate-300">{r.body}</p>
            <div className="mt-2 flex items-center gap-3">
              {r.acknowledged_at ? (
                <span className="text-[11px] text-emerald-300/80">Receipt recorded {fmtWhen(r.acknowledged_at)}</span>
              ) : (
                <Button size="sm" onClick={() => void acknowledge(r.id)}>Acknowledge receipt</Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}
