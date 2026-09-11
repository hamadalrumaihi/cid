'use client'

/** The one INTEGRITY chip. Label + icon + tone travel together so colour is
 *  never the only signal (VERIFIED / UNVERIFIED / INTEGRITY FAILURE). An
 *  external-hosted row has no integrity to report — callers render the
 *  neutral `ExternalHostLine` instead of a badge. */
import { Badge } from '@/components/ui/Badge'
import { AlertIcon, CheckIcon, ClockIcon } from '@/components/shell/icons'
import { integrityLabel, integrityStatusOf, integrityTone, type IntegrityStatus } from '@/lib/evidence'
import { fmtDateTime } from '@/lib/format'

export function IntegrityBadge({ status, lastCheck, className = '' }: {
  status: string | null | undefined
  lastCheck?: string | null
  className?: string
}) {
  const state: IntegrityStatus = integrityStatusOf(status)
  const tone = integrityTone(state)
  const Icon = tone === 'good' ? CheckIcon : tone === 'danger' ? AlertIcon : ClockIcon
  const title = lastCheck ? `Last integrity check ${fmtDateTime(lastCheck)}` : 'Not yet verified by the evidence service'
  return (
    <Badge tone={tone} className={`tracking-wide ${className}`} title={title}>
      <Icon size={11} />
      {integrityLabel(state)}
    </Badge>
  )
}

/** Neutral line for legacy FiveManage / pasted-link rows. */
export function ExternalHostLine({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs text-slate-400 ${className}`}>
      <ClockIcon size={11} />
      External host — integrity not tracked
    </span>
  )
}
