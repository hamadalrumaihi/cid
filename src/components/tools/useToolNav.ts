'use client'

/** Workspace-aware navigation for tool records and tool lists. Views call
 *  `useToolNav()` INSTEAD of touching the workspace context directly:
 *   - inside the Investigative Tools workspace it delegates to the workspace
 *     (openRecord/openHref open TABS — no route round-trip, no remount);
 *   - standalone it falls back to router.push of the `/tools?tool=…` form
 *     (the ToolTabRedirect translation done inline, saving the shim hop), so
 *     a view hosted anywhere still lands its links in the workspace.
 *  Non-tool hrefs passed to openHref simply router.push — callers can route
 *  every deep link through it without special-casing. */
import { useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { pushRecent, type RecentType } from '@/lib/recents'
import { RECORD_PARAM, hasRecordTabs, isToolTab, type ToolId } from '@/lib/toolsModel'
import { useToolsWorkspace } from './ToolsWorkspaceContext'

/** Tool id → recents vocabulary, for the tools whose openRecord lands on a
 *  real record tab. Only these — a tool absent here leaves no trail. */
const RECENT_TYPE: Partial<Record<ToolId, RecentType>> = {
  persons: 'person',
  vehicles: 'vehicle',
  gangs: 'gang',
  narcotics: 'narcotic',
}

export interface ToolNav {
  /** Open/focus a record tab (or the tool's list when it has no record tab). */
  openRecord: (toolId: ToolId, recordId: string, title?: string) => void
  /** Open a tool href (`/<tool>` or `/<tool>?<param>=…`) as a tab; any other
   *  href falls through to router.push. */
  openHref: (href: string) => void
  /** True when rendered inside the workspace — list views use this to open
   *  records as NEW tabs instead of swapping themselves out. */
  inWorkspace: boolean
}

export function useToolNav(): ToolNav {
  const ws = useToolsWorkspace()
  const router = useRouter()

  const openRecord = useCallback((toolId: ToolId, recordId: string, title?: string) => {
    // Deliberate open — every openRecord call is a click landing on the
    // record, so this is exactly the recents contract (ids only, never data).
    const rt = RECENT_TYPE[toolId]
    if (rt) pushRecent(rt, recordId)
    if (ws) { ws.openRecord(toolId, recordId, title); return }
    const next = new URLSearchParams({ tool: toolId })
    if (hasRecordTabs(toolId)) next.set('record', recordId)
    else {
      // No record tab — keep the tool's own param so its list view's
      // deep-link handling still resolves the record inside /tools.
      const param = RECORD_PARAM[toolId]
      if (param) next.set(param, recordId)
    }
    router.push(`/tools?${next.toString()}`)
  }, [ws, router])

  const openHref = useCallback((href: string) => {
    if (ws) { ws.openHref(href); return }
    try {
      const url = new URL(href, window.location.origin)
      const seg = url.pathname.split('/')[1] || ''
      if (url.origin === window.location.origin && isToolTab(seg)) {
        // ToolTabRedirect's translation, one hop earlier: record param becomes
        // `record`, every other query param is carried over untouched.
        const next = new URLSearchParams()
        next.set('tool', seg)
        const param = RECORD_PARAM[seg]
        if (param && hasRecordTabs(seg)) {
          const id = url.searchParams.get(param)
          if (id) { next.set('record', id); url.searchParams.delete(param) }
        }
        for (const [k, v] of url.searchParams) if (k !== 'tool' && k !== 'record') next.append(k, v)
        router.push(`/tools?${next.toString()}`)
        return
      }
    } catch { /* not a parseable href — let the router handle it */ }
    router.push(href)
  }, [ws, router])

  return useMemo(
    () => ({ openRecord, openHref, inWorkspace: ws !== null }),
    [openRecord, openHref, ws],
  )
}
