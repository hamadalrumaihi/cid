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
}

export function Card({ pad = 'md', interactive = false, className = '', ...rest }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-white/5 bg-ink-900/60 ${PAD[pad]} ${
        interactive ? 'transition hover:border-white/10' : ''
      } ${className}`}
      {...rest}
    />
  )
}
