'use client'

/** "Jump back in" strip — the pinned + recently-opened records, any type.
 *  Pins come from the DB-backed pins store (lib/pins, owner-only RLS);
 *  recents from the device-local ids-only trail (lib/recents). Both stores
 *  hold IDS ONLY: every title here is re-resolved through the viewer's
 *  RLS-scoped client at render time, so a record the viewer can no longer
 *  see leaves no trace — a pin renders NOTHING (it may come back), a recent
 *  is dropped from the trail. One compact Card, chips only. */
import { useEffect, useState } from 'react'
import { caseLink } from '@/lib/caseLinks'
import { list } from '@/lib/db'
import { usePinsStore, type PinType } from '@/lib/pins'
import { clearRecents, dropRecent, recentRecords, type RecentEntry } from '@/lib/recents'
import { KindIcon } from '@/components/shell/icons'
import { Card } from '@/components/ui/Card'
import { useToolNav } from '@/components/tools/useToolNav'
import type { CaseRow } from './commandUtils'

/** What a resolved chip shows: an optional mono identifier (case number,
 *  plate, request number) and the human label. */
interface Chip { mono?: string; label: string }

const key = (type: string, id: string) => `${type}:${id}`

/** One RLS-scoped batch per type. Returns only the rows the viewer can see —
 *  absence IS the permission answer. Types with no title source (today:
 *  field_submission) resolve nothing and stay hidden. */
async function fetchChips(type: PinType, ids: string[]): Promise<Map<string, Chip>> {
  const out = new Map<string, Chip>()
  const named = async (table: 'persons' | 'gangs' | 'places' | 'narcotics' | 'operations' | 'documents') => {
    const rows = (await list(table, { select: 'id,name', in: { id: ids } })) as unknown as { id: string; name: string | null }[]
    for (const r of rows) out.set(r.id, { label: r.name ?? '' })
  }
  switch (type) {
    case 'case': {
      const rows = (await list('cases', { select: 'id,case_number,title', in: { id: ids } })) as unknown as { id: string; case_number: string; title: string | null }[]
      for (const r of rows) out.set(r.id, { mono: r.case_number, label: r.title ?? '' })
      break
    }
    case 'legal_request': {
      const rows = (await list('legal_requests', { select: 'id,request_number,title', in: { id: ids } })) as unknown as { id: string; request_number: string; title: string | null }[]
      for (const r of rows) out.set(r.id, { mono: r.request_number, label: r.title ?? '' })
      break
    }
    case 'vehicle': {
      const rows = (await list('vehicles', { select: 'id,plate', in: { id: ids } })) as unknown as { id: string; plate: string }[]
      for (const r of rows) out.set(r.id, { mono: r.plate, label: '' })
      break
    }
    case 'account': {
      const rows = (await list('accounts', { select: 'id,handle', in: { id: ids } })) as unknown as { id: string; handle: string }[]
      for (const r of rows) out.set(r.id, { label: r.handle })
      break
    }
    case 'person': await named('persons'); break
    case 'gang': await named('gangs'); break
    case 'place': await named('places'); break
    case 'narcotic': await named('narcotics'); break
    case 'operation': await named('operations'); break
    case 'document': await named('documents'); break
    case 'field_submission': break
  }
  return out
}

/** Icon-kind + click target per pin type. */
const ICON_KIND: Record<PinType, string> = {
  case: 'case', person: 'person', vehicle: 'vehicle', gang: 'gang',
  place: 'place', account: 'account', narcotic: 'narcotic',
  legal_request: 'legal', document: 'document', operation: 'operation',
  field_submission: 'tip',
}

export function JumpBack({ cases }: { cases?: CaseRow[] }) {
  const pins = usePinsStore((s) => s.rows)
  const pinsLoaded = usePinsStore((s) => s.loaded)
  const fetchPins = usePinsStore((s) => s.fetch)
  const { openHref, openRecord } = useToolNav()
  const [chips, setChips] = useState<Map<string, Chip> | null>(null)
  const [recents, setRecents] = useState<RecentEntry[]>([])

  useEffect(() => { if (!pinsLoaded) void fetchPins() }, [pinsLoaded, fetchPins])

  // Resolve titles for pins + recents in one pass (batched per type, through
  // RLS). Re-runs when pins change or the host view refreshes its data.
  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => {
      void (async () => {
        const rec = recentRecords()
        const wanted = new Map<PinType, Set<string>>()
        const want = (type: PinType, id: string) => {
          const set = wanted.get(type) ?? new Set<string>()
          set.add(id)
          wanted.set(type, set)
        }
        for (const p of pins) want(p.target_type as PinType, p.target_id)
        for (const r of rec) want(r.type, r.id)
        const map = new Map<string, Chip>()
        const okTypes = new Set<PinType>()
        await Promise.all([...wanted].map(async ([type, ids]) => {
          try {
            const rows = await fetchChips(type, [...ids])
            okTypes.add(type)
            for (const [id, chip] of rows) map.set(key(type, id), chip)
          } catch { /* transient read failure — hide, never drop */ }
        }))
        if (!live) return
        // A recent whose fetch SUCCEEDED but returned no row is gone (deleted
        // or no longer visible) — drop it from the trail. Failed fetches keep
        // their entries: a network blip must not erase history.
        for (const r of rec) {
          if (okTypes.has(r.type) && r.type !== 'field_submission' && !map.has(key(r.type, r.id))) dropRecent(r.type, r.id)
        }
        setChips(map)
        setRecents(recentRecords())
      })()
    }, 0)
    return () => { live = false; window.clearTimeout(t) }
  }, [pins, cases])

  if (!chips) return null
  const openChip = (type: PinType, id: string, chip: Chip) => {
    switch (type) {
      case 'case': openHref(caseLink(id)); break
      case 'person': openRecord('persons', id, chip.label); break
      case 'vehicle': openRecord('vehicles', id, chip.mono); break
      case 'gang': openRecord('gangs', id, chip.label); break
      case 'narcotic': openRecord('narcotics', id, chip.label); break
      case 'place': openHref(`/places?place=${encodeURIComponent(id)}`); break
      case 'account': openHref('/accounts'); break
      case 'legal_request': openHref(`/legal?request=${encodeURIComponent(id)}`); break
      case 'document': openHref(`/sops?doc=${encodeURIComponent(id)}`); break
      case 'operation': openHref(`/operations?op=${encodeURIComponent(id)}`); break
      case 'field_submission': openHref('/field-review'); break
    }
  }

  // A pinned target the viewer cannot see resolves no chip and renders
  // NOTHING — silently, so the strip never confirms the record exists.
  const pinned = pins
    .map((p) => ({ type: p.target_type as PinType, id: p.target_id, chip: chips.get(key(p.target_type, p.target_id)) }))
    .filter((x): x is { type: PinType; id: string; chip: Chip } => !!x.chip)
  const recent = recents
    .filter((r) => !pins.some((p) => p.target_type === r.type && p.target_id === r.id))
    .map((r) => ({ type: r.type, id: r.id, chip: chips.get(key(r.type, r.id)) }))
    .filter((x): x is { type: PinType; id: string; chip: Chip } => !!x.chip)
  if (!pinned.length && !recent.length) return null

  const chipButton = (x: { type: PinType; id: string; chip: Chip }) => (
    <button
      key={key(x.type, x.id)}
      type="button"
      onClick={() => openChip(x.type, x.id, x.chip)}
      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 text-xs text-slate-200 transition hover:border-blue-500/40 hover:bg-white/5"
    >
      <span aria-hidden className="text-slate-400"><KindIcon kind={ICON_KIND[x.type]} size={13} /></span>
      {x.chip.mono && <span className="font-mono text-blue-300">{x.chip.mono}</span>}
      {x.chip.label && <span className="max-w-[10rem] truncate text-slate-300">{x.chip.label}</span>}
    </button>
  )

  return (
    <Card pad="sm">
      <div className="space-y-2.5">
        {pinned.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">Pinned</p>
            <div className="flex flex-wrap gap-2">{pinned.map(chipButton)}</div>
          </div>
        )}
        {recent.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-500">Recent</p>
              <button
                type="button"
                onClick={() => { clearRecents(); setRecents([]) }}
                className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 transition hover:text-white"
              >
                Clear
              </button>
            </div>
            <div className="flex flex-wrap gap-2">{recent.map(chipButton)}</div>
          </div>
        )}
      </div>
    </Card>
  )
}
