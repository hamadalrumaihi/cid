'use client'

/** Dashboard panel — the compact, data-dense section surface the dashboard
 *  views compose. One dense header row (title + count chip + optional hint +
 *  an "all →" action), then whatever rows the caller renders. Per spec an
 *  EMPTY panel renders nothing at all: pass `empty` and the whole surface
 *  disappears instead of showing a hollow card. */

import { useId, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'

export interface DashPanelProps {
  title: string
  /** Row count for the header chip. */
  count?: number
  /** Quiet explanatory line under the title. */
  hint?: string
  /** Header-right link to the owning surface ("All cases →"). */
  action?: { label: string; onClick?: () => void; href?: string }
  collapsible?: boolean
  /** True → render nothing (spec: remove empty panels, don't show husks). */
  empty?: boolean
  children: React.ReactNode
}

const ACTION_CLS =
  'flex-shrink-0 rounded px-1.5 py-1 text-xs font-semibold text-blue-300 transition hover:text-white'

export function DashPanel({ title, count, hint, action, collapsible = false, empty = false, children }: DashPanelProps) {
  const [open, setOpen] = useState(true)
  const bodyId = useId()
  if (empty) return null

  const heading = (
    <>
      <span className="truncate text-sm font-bold text-white">{title}</span>
      {count !== undefined && <Badge aria-label={`${count} item${count === 1 ? '' : 's'}`}>{count}</Badge>}
    </>
  )

  return (
    <Card variant="flat" pad="none">
      <div className="flex min-h-10 items-center gap-2 px-4 py-2">
        {collapsible ? (
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="flex min-w-0 flex-1 items-center gap-2 rounded text-left"
          >
            {heading}
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className={`ml-auto h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform ${open ? '' : '-rotate-90'}`}
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">{heading}</div>
        )}
        {action && (action.href ? (
          <Link href={action.href} className={ACTION_CLS}>{action.label}</Link>
        ) : (
          <button onClick={action.onClick} className={ACTION_CLS}>{action.label}</button>
        ))}
      </div>
      {hint && (!collapsible || open) && (
        <p className="px-4 pb-2 text-[11px] leading-snug text-slate-400">{hint}</p>
      )}
      {(!collapsible || open) && (
        <div id={bodyId} className="border-t border-white/5 px-1.5 py-1.5">{children}</div>
      )}
    </Card>
  )
}
