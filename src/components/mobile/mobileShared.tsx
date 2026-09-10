'use client'

/** Pieces every mobile case card shares (P8-01): the projected case row the
 *  screen loads, the "Open on desktop" link (sets the session flag BEFORE
 *  navigating so the workspace's narrow redirect does not bounce straight
 *  back), and the desktop-only card for sections the phone does not edit. */
import Link from 'next/link'
import type { Tables } from '@/lib/database.types'
import { workspaceCaseHref } from '@/lib/workspace/model'
import { Card } from '@/components/ui/Card'
import { rememberDesktopOnMobile } from './mobileCaseRoute'

/** The columns the phone screen reads — header facts, the write gates
 *  (archived / case authority) and the Overview card. Everything else stays
 *  on the desktop, so nothing else is fetched. */
export const MOBILE_CASE_SELECT =
  'id,case_number,title,status,bureau,lead_detective_id,priority,summary,archived_at,case_authority,created_at,updated_at,follow_up_at,investigative_stage,area,is_joint_case'
export type MobileCase = Pick<
  Tables<'cases'>,
  'id' | 'case_number' | 'title' | 'status' | 'bureau' | 'lead_detective_id' | 'priority' | 'summary' | 'archived_at'
  | 'case_authority' | 'created_at' | 'updated_at' | 'follow_up_at' | 'investigative_stage' | 'area' | 'is_joint_case'
>

const LINK_BASE = 'inline-flex min-h-11 touch-manipulation items-center justify-center gap-2 rounded-lg font-medium transition'
const LINK_STYLE = {
  ghost: `${LINK_BASE} px-3 text-sm text-slate-300 hover:bg-white/5 hover:text-white`,
  secondary: `${LINK_BASE} border border-white/10 bg-white/5 px-4 text-sm text-slate-200 hover:bg-white/10`,
}

/** A real link to the workspace (bookmarkable, middle-clickable) whose
 *  click remembers that this tab chose the desktop on a phone. */
export function OpenOnDesktop({ caseId, section, report, look = 'secondary', className = '', children = 'Open on desktop' }: {
  caseId: string
  section?: string | null
  report?: string | null
  look?: keyof typeof LINK_STYLE
  className?: string
  children?: React.ReactNode
}) {
  return (
    <Link
      href={workspaceCaseHref(caseId, section, report ? { report } : {})}
      onClick={rememberDesktopOnMobile}
      className={`${LINK_STYLE[look]} ${className}`}
    >
      {children}
    </Link>
  )
}

/** What a phone shows for something it does not edit. */
export function DesktopOnlyCard({ caseId, section, title, hint }: {
  caseId: string
  section?: string | null
  title: string
  hint?: string
}) {
  return (
    <Card pad="sm" className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-200">{title}</p>
        {hint && <p className="mt-0.5 text-sm text-slate-400">{hint}</p>}
      </div>
      <OpenOnDesktop caseId={caseId} section={section} />
    </Card>
  )
}
