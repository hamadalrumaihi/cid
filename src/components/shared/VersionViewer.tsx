'use client'

/** Shared immutable-version viewer (v1.14) — the legal version display
 *  promoted portal-wide (adoption register: "immutable-version display").
 *  A version list with an inline read-only content pane; content rendering
 *  and any actions (e.g. SOP restore) stay domain-specific via render props.
 *  Old versions are always readable, never editable. */
import { useState } from 'react'
import { fmtDateTime } from '@/lib/format'

export interface VersionItem {
  id: string
  number: number | string
  label?: string | null
  at?: string | null
  byName?: string | null
}

export function VersionViewer({ versions, renderContent, actions, empty = 'No versions recorded yet.' }: {
  /** Newest first. */
  versions: VersionItem[]
  renderContent: (v: VersionItem) => React.ReactNode
  actions?: (v: VersionItem) => React.ReactNode
  empty?: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  if (versions.length === 0) return <p className="text-sm text-slate-500">{empty}</p>
  return (
    <ul className="space-y-1.5">
      {versions.map((v, i) => {
        const open = openId === v.id
        return (
          <li key={v.id} className="rounded-lg border border-white/10 bg-ink-950/50">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2">
              <button
                onClick={() => setOpenId(open ? null : v.id)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-left"
              >
                <span className="font-mono text-xs font-bold text-blue-300">v{v.number}</span>
                {i === 0 && <span className="rounded bg-badge-500/15 px-1.5 text-[10px] font-bold text-blue-200">latest</span>}
                {v.label && <span className="truncate text-sm text-slate-200">{v.label}</span>}
                <span className="text-xs text-slate-500">
                  {v.at ? fmtDateTime(v.at) : ''}{v.byName ? ` · ${v.byName}` : ''}
                </span>
                <span className="text-xs text-slate-500">{open ? '▾' : '▸'}</span>
              </button>
              {actions?.(v)}
            </div>
            {open && (
              <div className="border-t border-white/10 p-3 text-sm text-slate-200">
                {renderContent(v)}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
