'use client'

/** Registry card + detail re-export. The detail screen is the intelligence
 *  dossier in GangDossier.tsx (exported here as GangDetail so GangsView's import
 *  is unchanged). The card is a semantic <article> — the gang name is the
 *  navigation control and actions are separate buttons, replacing the old
 *  clickable-<div>-with-nested-controls (an interaction-ambiguity a11y issue). */
import { Badge } from '@/components/ui/Badge'
import { StaleIntelBadge } from '@/components/ui/IntelBadges'
import { threatTint, statusTint } from '@/lib/tint'
import { humanize, parseColors } from './gangIntel'
import { cap, type GangRow } from './gangShared'

export { GangDossier as GangDetail } from './GangDossier'

/** Aggregate rollup for a gang, computed once in the registry (not per-card
 *  queries). All optional — a card degrades gracefully to just identity. */
export interface GangCardStats {
  members: number
  leaders: string[]
  turf: number
  places: number
  openCases: number
}

function Swatches({ colors }: { colors: string | null }) {
  const sw = parseColors(colors).slice(0, 4)
  if (!sw.length) return null
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {sw.map((s, i) => (
        <span key={i} className="h-3 w-3 rounded-full border border-white/20" style={s.css ? { backgroundColor: s.css } : undefined} title={s.name} />
      ))}
    </span>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="font-semibold tabular-nums text-slate-200">{n}</span>
      <span className="text-[11px] text-slate-500">{label}</span>
    </span>
  )
}

export function GangCard({ gang, stats, canDelete, selected, onSelect, onOpen, onProfile, now }: {
  gang: GangRow
  stats?: GangCardStats
  canDelete: boolean
  selected: boolean
  onSelect: (on: boolean) => void
  onOpen: () => void
  onProfile: () => void
  now: number
}) {
  return (
    <article className="rounded-2xl border border-white/5 bg-ink-900/60 p-5 transition hover:border-blue-500/30">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 truncate text-lg font-bold">
              <button onClick={onOpen} className="text-left text-white hover:text-blue-200" title="Open dossier">{gang.name}</button>
            </h3>
            <Swatches colors={gang.colors} />
          </div>
          {gang.aliases && <p className="mt-0.5 truncate text-xs text-slate-500">aka {gang.aliases}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Badge tint={threatTint(gang.threat_level)}>{cap(gang.threat_level)}</Badge>
          {canDelete && (
            <label onClick={(e) => e.stopPropagation()} className="flex items-center" title="Select for bulk delete">
              <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${gang.name} for bulk delete`} className="h-4 w-4 accent-rose-500" />
            </label>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {gang.status && <Badge tint={statusTint(gang.status)}>{humanize(gang.status)}</Badge>}
        {gang.classification && <Badge tone="neutral">{humanize(gang.classification)}</Badge>}
        <StaleIntelBadge reviewedAt={gang.reviewed_at} now={now} />
      </div>

      {stats && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Stat n={stats.members} label="members" />
          <Stat n={stats.turf} label="turf" />
          <Stat n={stats.places} label="places" />
          <Stat n={stats.openCases} label="open cases" />
        </div>
      )}
      {stats && stats.leaders.length > 0 && (
        <p className="mt-1.5 truncate text-xs text-slate-400"><span className="text-slate-500">Leadership:</span> {stats.leaders.slice(0, 3).join(', ')}{stats.leaders.length > 3 ? '…' : ''}</p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2">
        <button onClick={onOpen} className="text-sm font-semibold text-blue-300 hover:text-blue-200">Open dossier →</button>
        <button onClick={onProfile} title="Unified intel profile" className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-blue-200 transition hover:bg-white/10">Profile</button>
      </div>
    </article>
  )
}
