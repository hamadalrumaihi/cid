'use client'

/** A single substance card in the narcotics registry grid. The whole card is
 *  one button opening the dossier (?drug=<id>), so it is a single focusable,
 *  keyboard-accessible, ≥44px target. Colour is never the only signal — every
 *  chip carries a text label, and the head falls back from representative image
 *  → emoji icon → neutral category glyph. Deliberately shows only a summary of
 *  the record; the dossier owns the full field set. */
import { useState } from 'react'
import { fmtDate } from '@/lib/format'
import { safeUrl } from '@/lib/safeUrl'
import { Badge } from '@/components/ui/Badge'
import { ConfidenceBadge, StaleIntelBadge } from '@/components/ui/IntelBadges'
import {
  categoryGlyph, categoryLabel, narcoticStatusTint, statusLabel,
  NARCOTIC_REVIEW_DAYS, type RegistryNarcotic,
} from './narcoticsRegistry'

export interface NarcoticsRegistryCardProps {
  n: RegistryNarcotic
  aliases: string[]
  imageUrl: string | null
  personCount: number
  placeCount: number
  gangCount: number
  seizureCount: number
  now: number
  onOpen: () => void
}

/** Small count with a label — no colour dependence. */
function CountChip({ n, label }: { n: number; label: string }) {
  if (!n) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-slate-300">
      <span className="tabular-nums text-white">{n}</span>
      {label}{n === 1 ? '' : 's'}
    </span>
  )
}

export function NarcoticsRegistryCard({
  n, aliases, imageUrl, personCount, placeCount, gangCount, seizureCount, now, onOpen,
}: NarcoticsRegistryCardProps) {
  const [imgBroken, setImgBroken] = useState(false)
  const img = imageUrl ? safeUrl(imageUrl) : ''
  const showImg = !!img && !imgBroken
  const glyph = n.icon || categoryGlyph(n.category)
  const shownAliases = aliases.slice(0, 3)
  const extraAliases = aliases.length - shownAliases.length

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-h-[44px] w-full flex-col rounded-2xl border border-white/5 bg-ink-900/60 p-4 text-left transition hover:border-white/15 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
    >
      <div className="flex items-start gap-3">
        {showImg ? (
          /* eslint-disable-next-line @next/next/no-img-element -- external media CDN */
          <img
            src={img}
            alt={`${n.name} reference image`}
            onError={() => setImgBroken(true)}
            className="h-14 w-14 flex-shrink-0 rounded-lg object-cover"
          />
        ) : (
          <div
            className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-lg bg-ink-800 text-2xl"
            aria-hidden="true"
            title={categoryLabel(n.category)}
          >
            {glyph}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{n.name}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">
            {categoryLabel(n.category)}
            {n.classification ? ` · ${n.classification}` : ''}
          </p>
          {shownAliases.length > 0 && (
            <p className="mt-1 truncate text-[11px] text-slate-400">
              aka {shownAliases.join(', ')}{extraAliases > 0 ? ` +${extraAliases}` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tint={narcoticStatusTint(n.status)} title={`Status: ${statusLabel(n.status)}`}>
          {statusLabel(n.status)}
        </Badge>
        <ConfidenceBadge confidence={n.confidence} />
        {n.restricted && (
          <Badge tone="danger" title="Restricted — limited-distribution intelligence">Restricted</Badge>
        )}
        {n.server_specific && (
          <Badge tone="accent" title="Server-specific substance (not a real-world drug)">Server-specific</Badge>
        )}
        <StaleIntelBadge reviewedAt={n.reviewed_at} thresholdDays={NARCOTIC_REVIEW_DAYS} now={now} />
      </div>

      {n.summary && <p className="mt-3 line-clamp-2 text-xs text-slate-400">{n.summary}</p>}

      {(personCount || placeCount || gangCount || seizureCount) > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <CountChip n={seizureCount} label="seizure" />
          <CountChip n={personCount} label="person" />
          <CountChip n={placeCount} label="place" />
          <CountChip n={gangCount} label="gang" />
        </div>
      )}

      <p className="mt-3 text-[11px] text-slate-400">
        Last reviewed {n.reviewed_at ? fmtDate(n.reviewed_at) : 'never'}
      </p>
    </button>
  )
}
