'use client'

/** Determinate progress meter. The design system had no progress primitive,
 *  so every "x of y" bar was on course to be hand-rolled per view with its
 *  own geometry and (usually) no accessible name at all. One bar, one
 *  geometry, one a11y contract:
 *   - role="progressbar" with aria-valuemin / aria-valuenow / aria-valuemax;
 *   - a REQUIRED name — visible (`showValue`, wired via aria-labelledby) or
 *     an aria-label, never nameless;
 *   - aria-valuetext whenever the raw number needs units ("$1,522 of $1,522").
 *  Purely presentational: the only motion is the width transition, which
 *  globals.css already disables under prefers-reduced-motion. */
import { useId } from 'react'

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'danger'

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-400',
  accent: 'bg-badge-500',
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  danger: 'bg-rose-500',
}

const SIZES = { sm: 'h-1.5', md: 'h-2.5' } as const

/** Completed percentage, clamped to 0–100. A non-positive or non-finite
 *  `max` reads as "no target yet" (0%) rather than dividing by zero, and a
 *  value past the target saturates instead of overflowing the track. */
export function progressPct(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.min(100, Math.max(0, (value / max) * 100))
}

export interface ProgressProps {
  /** Completed amount. Clamped into [0, max] for display. */
  value: number
  /** Target amount. ≤ 0 renders an empty track. */
  max: number
  /** Accessible name — e.g. "Converters cut". Always required. */
  label: string
  /** Human-readable value ("3 / 14", "$1,522 of $1,522"). Defaults to
   *  `value / max`; also what `showValue` prints. */
  valueText?: string
  /** Print the label and value above the track (and name the bar from them
   *  instead of an aria-label). */
  showValue?: boolean
  tone?: Tone
  size?: keyof typeof SIZES
  className?: string
}

export function Progress({
  value,
  max,
  label,
  valueText,
  showValue = false,
  tone = 'accent',
  size = 'md',
  className = '',
}: ProgressProps) {
  const labelId = useId()
  const pct = progressPct(value, max)
  const text = valueText ?? `${value} / ${max}`
  return (
    <div className={className}>
      {showValue && (
        <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px]">
          <span id={labelId} className="font-semibold text-slate-300">{label}</span>
          <span className="font-mono tabular-nums text-slate-400">{text}</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-label={showValue ? undefined : label}
        aria-labelledby={showValue ? labelId : undefined}
        aria-valuemin={0}
        aria-valuemax={max > 0 ? max : 0}
        aria-valuenow={Math.min(Math.max(value, 0), Math.max(max, 0))}
        aria-valuetext={text}
        className={`w-full overflow-hidden rounded-full bg-white/10 ${SIZES[size]}`}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${TONES[tone]}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
