'use client'

/** The canonical surface. `rounded-2xl border border-white/5 bg-ink-900/60`
 *  recurs ~87 times across 35 files; padding drifted p-4/5/6 with no rule and
 *  a few dirs (command-center, profile, operations) used border-white/10,
 *  reading heavier than the rest. This fixes the border and gives padding a
 *  named scale so surfaces stay visually even. */

type Pad = 'none' | 'sm' | 'md' | 'lg'

const PAD: Record<Pad, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  pad?: Pad
  /** Slightly brighter border for a hoverable/interactive card. */
  interactive?: boolean
  /** `flat` — the dense "digital case jacket" panel (rounded-lg, clear
   *  border, quieter fill). `default` stays byte-identical for the ~60
   *  existing call sites. */
  variant?: 'default' | 'flat'
}

const VARIANT: Record<NonNullable<CardProps['variant']>, string> = {
  default: 'rounded-2xl border border-white/5 bg-ink-900/60',
  flat: 'rounded-lg border border-white/10 bg-ink-900/40',
}

export function Card({ pad = 'md', interactive = false, variant = 'default', className = '', ...rest }: CardProps) {
  return (
    <div
      className={`${VARIANT[variant]} ${PAD[pad]} ${
        interactive ? 'transition hover:border-white/10' : ''
      } ${className}`}
      {...rest}
    />
  )
}
