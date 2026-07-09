'use client'

/** The one badge chip. Geometry was drifting (px-2.5 py-0.5 text-[11px] vs
 *  px-2.5 py-1 text-xs vs px-2 py-1) and colour logic was scattered; pair this
 *  with the tint helpers in lib/tint for status/priority/role chips. Pass a
 *  `tint` class (e.g. statusTint(x)) or a `tone` shorthand. */

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'danger'

const TONES: Record<Tone, string> = {
  neutral: 'bg-white/5 text-slate-300',
  accent: 'bg-blue-500/15 text-blue-300',
  good: 'bg-emerald-500/15 text-emerald-300',
  warn: 'bg-amber-500/15 text-amber-300',
  danger: 'bg-rose-500/15 text-rose-300',
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** A tint class string (from lib/tint). Takes precedence over `tone`. */
  tint?: string
  tone?: Tone
}

export function Badge({ tint, tone = 'neutral', className = '', children, ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
        tint ?? TONES[tone]
      } ${className}`}
      {...rest}
    >
      {children}
    </span>
  )
}
