'use client'

/** Workspace-aware navigation for tool records, tool lists and cases. Views
 *  call `useToolNav()` / `useWorkspaceNav()` INSTEAD of touching the
 *  workspace context directly:
 *   - inside the unified workspace they delegate to it (openRecord /
 *     openHref / openCase open TABS — no route round-trip, no remount);
 *   - standalone they fall back to router.push of the `/workspace?…` form
 *     (the ToolTabRedirect translation done inline, saving the shim hop), so
 *     a view hosted anywhere still lands its links in the workspace.
 *  Non-tool hrefs passed to openHref simply router.push — callers can route
 *  every deep link through it without special-casing. */
import { useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { pushRecent, type RecentType } from '@/lib/recents'
import { RECORD_PARAM, hasRecordTabs, isToolTab, type ToolId } from '@/lib/toolsModel'
import { workspaceCaseHref } from '@/lib/workspace/model'
import { useWorkspace, type OpenCaseOptions } from '@/components/workspace/WorkspaceContext'
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
    router.push(`/workspace?${next.toString()}`)
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
        router.push(`/workspace?${next.toString()}`)
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

/* ── Cases ────────────────────────────────────────────────────────────────── */

export type CaseHrefOptions = { report?: string | null; task?: string | null; evidence?: string | null }

export interface WorkspaceNav {
  /** Open/focus a case tab (standalone: navigate to `/workspace?case=…`).
   *  Recents are stamped by the case shell on its first successful load, so
   *  an unreadable id leaves no trail. */
  openCase: (caseId: string, section?: string | null, opts?: OpenCaseOptions & CaseHrefOptions) => void
  /** The workspace address of a case (`/workspace?case=…&tab=…`). For links
   *  that must stay stable across releases keep using lib/caseLinks
   *  caseLink() — `/cases?case=` redirects here. */
  caseHref: (caseId: string, section?: string | null, opts?: CaseHrefOptions) => string
  inWorkspace: boolean
}

export function useWorkspaceNav(): WorkspaceNav {
  const ws = useWorkspace()
  const router = useRouter()

  const caseHref = useCallback(
    (caseId: string, section?: string | null, opts: CaseHrefOptions = {}) => workspaceCaseHref(caseId, section, opts),
    [],
  )

  const openCase = useCallback((caseId: string, section?: string | null, opts: OpenCaseOptions & CaseHrefOptions = {}) => {
    const { report, task, evidence, ...open } = opts
    // Record params are mount-time seeds for the sections — land through the
    // URL so the provider's intake opens the tab with them in place.
    if (ws && !report && !task && !evidence) { ws.openCase(caseId, section, open); return }
    router.push(caseHref(caseId, section, { report, task, evidence }))
  }, [ws, router, caseHref])

  return useMemo(() => ({ openCase, caseHref, inWorkspace: ws !== null }), [openCase, caseHref, ws])
}
