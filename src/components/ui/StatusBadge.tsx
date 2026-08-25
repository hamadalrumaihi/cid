'use client'

/** The one STATUS chip. A Badge whose label, tint and tooltip all come from
 *  the central status registry (lib/status), so a sign-off state, a warrant
 *  state and a field-submission state can never drift apart in wording or
 *  temperature again. The label text always renders — color is reinforcement,
 *  never the only signal — and the native title tooltip explains what the
 *  state means and who acts next. */
import { Badge } from './Badge'
import { statusMeta, statusTitle, type StatusDomain } from '@/lib/status'

export interface StatusBadgeProps {
  domain: StatusDomain
  value: string | null | undefined
  /** Override the registry tooltip (e.g. to add record-specific context). */
  title?: string
  className?: string
}

export function StatusBadge({ domain, value, title, className = '' }: StatusBadgeProps) {
  const meta = statusMeta(domain, value)
  return (
    <Badge tint={meta.cls} title={title ?? statusTitle(meta)} className={className}>
      {meta.label}
    </Badge>
  )
}
