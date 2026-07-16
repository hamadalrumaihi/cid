'use client'

/** Registry grid card + the shared BOLO/lifecycle chips (the table view reuses
 *  them so BOLO state never reads differently between layouts). Colour is
 *  never the only signal — every chip carries a text label. */
import { useState } from 'react'
import { initials, timeAgo } from '@/lib/format'
import { safeUrl } from '@/lib/safeUrl'
import { priorityTint } from '@/lib/tint'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { ConfidenceBadge, StaleIntelBadge } from '@/components/ui/IntelBadges'
import { boloState, classificationLabel, lifecycleLabel, priorityLabel, PERSON_REVIEW_DAYS } from './personIntel'
import type { RegistryPerson } from './registryFilters'

/** Risk-tinted BOLO chip via boloState — text label always ("BOLO · HIGH").
 *  An expired-but-uncleared BOLO stays visible, flagged for review. */
export function BoloBadge({ p, today }: { p: RegistryPerson; today: string }) {
  const b = boloState(p, today)
  if (b.expired) {
    return <Badge tone="warn" className="uppercase" title={`BOLO expired ${b.expiresAt ?? ''} — review and clear`}>BOLO expired</Badge>
  }
  if (b.active) {
    return (
      <Badge tint={priorityTint(b.risk ?? 'high')} className="uppercase" title={b.reason || 'Be on the lookout'}>
        BOLO{b.risk ? ` · ${b.risk}` : ''}
      </Badge>
    )
  }
  return null
}

/** Non-default lifecycle marker (inactive / historical / cleared / archived /
 *  merged). Merged tombstones read deliberately dim. */
export function LifecycleBadge({ lifecycle }: { lifecycle: string }) {
  if (!lifecycle || lifecycle === 'active') return null
  const dim = lifecycle === 'merged' || lifecycle === 'archived'
  return (
    <Badge
      tint={dim ? 'bg-white/5 text-slate-400' : 'bg-slate-500/20 text-slate-300'}
      className="uppercase"
      title={lifecycle === 'merged' ? 'Merged into another record (tombstone)' : `Lifecycle: ${lifecycleLabel(lifecycle)}`}
    >
      {lifecycleLabel(lifecycle)}
    </Badge>
  )
}

export interface RegistryCardProps {
  p: RegistryPerson
  gang: string | null
  caseCount: number
  vehicleCount: number
  warrantCount: number
  duplicate: boolean
  now: number
  today: string
  canEdit: boolean
  canDelete: boolean
  selected: boolean
  onSelect: (on: boolean) => void
  onProfile: () => void
  onEdit: () => void
  onDelete: () => void
  onAttach: () => void
}

const ACTION_BTN =
  'min-h-[40px] rounded-md border border-white/10 bg-white/5 px-2.5 py-2 text-xs font-semibold transition hover:bg-white/10'

export function RegistryCard({
  p, gang, caseCount, vehicleCount, warrantCount, duplicate, now, today,
  canEdit, canDelete, selected, onSelect, onProfile, onEdit, onDelete, onAttach,
}: RegistryCardProps) {
  const [imgBroken, setImgBroken] = useState(false)
  const mug = safeUrl(p.mugshot_url ?? '')
  return (
    <Card interactive>
      <div className="flex items-start gap-3">
        {mug && !imgBroken ? (
          /* eslint-disable-next-line @next/next/no-img-element -- external mugshot CDN */
          <img src={mug} alt="" onError={() => setImgBroken(true)} className="h-14 w-14 flex-shrink-0 rounded-lg object-cover" />
        ) : (
          <div className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-sm font-bold text-slate-400" aria-hidden="true">
            {initials(p.name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{p.name}</p>
          <p className="truncate text-xs text-slate-400">
            {p.alias ? `“${p.alias}”` : ''}{p.alias && p.status ? ' · ' : ''}{p.status || ''}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            {gang ? `${gang} · ` : ''}{caseCount} case{caseCount === 1 ? '' : 's'} · {vehicleCount} vehicle{vehicleCount === 1 ? '' : 's'} · upd {timeAgo(p.updated_at)}
          </p>
        </div>
        {canDelete && (
          <label className="flex flex-shrink-0 items-center p-1" title="Select for bulk delete">
            <input
              type="checkbox"
              checked={selected}
              onChange={(e) => onSelect(e.target.checked)}
              aria-label={`Select ${p.name} for bulk delete`}
              className="h-4 w-4 accent-rose-500"
            />
          </label>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <BoloBadge p={p} today={today} />
        {warrantCount > 0 && (
          <Badge tone="danger" className="uppercase" title={`${warrantCount} active warrant-type legal request${warrantCount === 1 ? '' : 's'}`}>
            {warrantCount} warrant{warrantCount === 1 ? '' : 's'}
          </Badge>
        )}
        {p.classification && <Badge title={`Classification: ${classificationLabel(p.classification)}`}>{classificationLabel(p.classification)}</Badge>}
        {p.priority && <Badge tint={priorityTint(p.priority)} className="uppercase" title={`Priority: ${priorityLabel(p.priority)}`}>{p.priority}</Badge>}
        <LifecycleBadge lifecycle={p.lifecycle} />
        <ConfidenceBadge confidence={p.confidence} />
        <StaleIntelBadge reviewedAt={p.reviewed_at} thresholdDays={PERSON_REVIEW_DAYS} now={now} />
        {(p.felony_count ?? 0) >= 8 && (
          <Badge tone="danger" title="8 or more violent felonies on record">8+ felonies</Badge>
        )}
        {duplicate && (
          <Badge tone="warn" title="This record looks like a duplicate of another person">Possible duplicate</Badge>
        )}
      </div>

      {p.notes && <p className="mt-3 line-clamp-2 text-xs text-slate-400">{p.notes}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={onProfile} className={`${ACTION_BTN} flex-1 text-blue-200`} title="Open the full intelligence profile">
          Profile
        </button>
        {canEdit && <button onClick={onEdit} className={`${ACTION_BTN} text-slate-200`}>Edit</button>}
        {canEdit && <button onClick={onAttach} className={`${ACTION_BTN} text-blue-200`}>Attach to case</button>}
        {canDelete && (
          <button onClick={onDelete} className={`${ACTION_BTN} text-rose-300 hover:bg-rose-500/10`} title="Delete person (command only)">
            Delete
          </button>
        )}
      </div>
    </Card>
  )
}
