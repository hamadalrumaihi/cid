'use client'

/** The dossier's confidential panel (CI contract §3 `ci_person_status`, §6.4).
 *
 *  Two walls, in order: no request at all unless the viewer is inside the
 *  compartment (`ciInvolved`), and then the RPC's null — indistinguishable
 *  from "not a CI" — renders nothing. There is never a lock, a placeholder or
 *  a "restricted" hint: a dossier without this card looks exactly like every
 *  other dossier. Visits are not pushed to recents. */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CI_STATUS_LABEL, ciHref, ciInvolved, fetchCiPersonStatus, useCiContext, type CiPersonStatus } from '@/lib/ci'
import { useTableVersion } from '@/lib/realtime'
import { statusTint } from '@/lib/tint'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'

const statusLabel = (s: string): string => (CI_STATUS_LABEL as Record<string, string>)[s] ?? s

export function PersonCiPanel({ personId }: { personId: string }) {
  const { ctx } = useCiContext()
  const involved = ciInvolved(ctx)
  const v = useTableVersion('ci_events')
  const [status, setStatus] = useState<CiPersonStatus | null>(null)

  useEffect(() => {
    // Not involved → no request, ever. The deferred write keeps the effect
    // body free of synchronous state updates (the repo's ShiftsView idiom).
    if (!involved) return
    let live = true
    void (async () => {
      await Promise.resolve()
      const s = await fetchCiPersonStatus(personId).catch(() => null)
      if (live) setStatus(s)
    })()
    return () => { live = false }
  }, [involved, personId, v])

  if (!involved || !status) return null

  return (
    <Card pad="sm" className="border-amber-500/20">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold text-slate-100">Confidential Informant</span>
        <span aria-hidden className="text-slate-500">·</span>
        <span className="font-mono text-slate-200">{status.ci_number}</span>
        <Badge tint={statusTint(status.status)}>{statusLabel(status.status)}</Badge>
        <Link href={ciHref(status.ci_id)} className="ml-auto text-sm font-medium text-badge-300 hover:underline">
          Open source record →
        </Link>
      </div>
    </Card>
  )
}
