'use client'

/** Verified-observation history for a registry record (person / vehicle /
 *  place / gang) — read-only and lean. Rows come from BOTH reference paths:
 *  the polymorphic surveillance_observation_entities links AND the direct
 *  person_id/vehicle_id/place_id columns on surveillance_observations. RLS
 *  trims everything (case access + the restricted wall) — this panel only
 *  ever narrates what the viewer may already read, and a load failure stays
 *  quiet rather than claiming "no history". */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Tables } from '@/lib/database.types'
import { list } from '@/lib/db'
import { caseLink } from '@/lib/caseLinks'
import { fmtDateTime } from '@/lib/format'
import { useTableVersion } from '@/lib/realtime'
import { SOURCE_TYPE_LABEL } from '@/lib/surveillanceModel'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/Notice'

type ObservationRow = Tables<'surveillance_observations'>

export type ObservationHistoryKind = 'person' | 'gang' | 'place' | 'vehicle' | 'account'

/** Direct FK column per kind (gang/account have entity links only). */
const DIRECT_COL: Partial<Record<ObservationHistoryKind, 'person_id' | 'vehicle_id' | 'place_id'>> = {
  person: 'person_id',
  vehicle: 'vehicle_id',
  place: 'place_id',
}

export function ObservationHistory({ kind, refId }: { kind: ObservationHistoryKind; refId: string }) {
  const [rows, setRows] = useState<ObservationRow[] | null>(null)
  const [caseNums, setCaseNums] = useState<Record<string, string>>({})
  const v = useTableVersion('surveillance_observations')

  useEffect(() => {
    let cancelled = false
    const t = window.setTimeout(async () => {
      // 1 · both reference paths, each fail-open to empty.
      const [links, direct] = await Promise.all([
        list('surveillance_observation_entities', {
          select: 'observation_id', eq: { kind, ref_id: refId }, limit: 200,
        }).then((r) => r as unknown as { observation_id: string }[]).catch(() => []),
        DIRECT_COL[kind]
          ? list('surveillance_observations', {
              eq: { [DIRECT_COL[kind]!]: refId } as never,
              order: 'observed_at', ascending: false, limit: 100,
            }).catch(() => [] as ObservationRow[])
          : Promise.resolve([] as ObservationRow[]),
      ])
      // 2 · load the linked parents the direct fetch didn't already bring
      //     (RLS trims — hidden rows simply never arrive), join client-side.
      const have = new Set(direct.map((o) => o.id))
      const missing = [...new Set(links.map((l) => l.observation_id))].filter((id) => !have.has(id))
      const linked = missing.length
        ? await list('surveillance_observations', { in: { id: missing }, limit: 100 }).catch(() => [] as ObservationRow[])
        : []
      const all = [...direct, ...linked]
        .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))
      if (cancelled) return
      setRows(all)
      // 3 · bounded case-number resolution for the chips.
      const caseIds = [...new Set(all.map((o) => o.case_id))]
      const cs = caseIds.length
        ? (await list('cases', { select: 'id,case_number', in: { id: caseIds } }).catch(() => [])) as unknown as { id: string; case_number: string }[]
        : []
      if (!cancelled) setCaseNums(Object.fromEntries(cs.map((c) => [c.id, c.case_number])))
    }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [kind, refId, v])

  if (rows === null) return <p className="text-sm text-slate-400">Loading surveillance history…</p>
  const verified = rows.filter((o) => o.verification_status === 'verified')
  const unverifiedCount = rows.length - verified.length
  if (!rows.length) return <EmptyState title="No surveillance history." />
  return (
    <div className="space-y-2">
      {!verified.length && (
        <p className="text-sm text-slate-400">No verified observations yet.</p>
      )}
      {verified.map((o) => (
        <div key={o.id} className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="good">Verified</Badge>
            <Badge>{SOURCE_TYPE_LABEL[o.source_type] ?? o.source_type}</Badge>
            {caseNums[o.case_id] && (
              <Link
                href={caseLink(o.case_id, 'surveillance')}
                className="rounded-full bg-blue-500/10 px-2 py-0.5 font-mono text-[11px] text-blue-300 hover:underline"
              >
                {caseNums[o.case_id]}
              </Link>
            )}
            <span className="ml-auto text-xs text-slate-400">{fmtDateTime(o.observed_at)}</span>
          </div>
          <p className="mt-1.5 text-sm text-slate-200">{o.activity}</p>
          {o.location_text && <p className="mt-0.5 text-xs text-slate-400">📍 {o.location_text}</p>}
        </div>
      ))}
      {unverifiedCount > 0 && (
        <p className="text-xs text-slate-400">
          + {unverifiedCount} unverified observation{unverifiedCount === 1 ? '' : 's'} awaiting review (not shown as fact).
        </p>
      )}
    </div>
  )
}
