'use client'

/** Workspace contract between the Investigative Tools shell (ToolsView) and
 *  the views rendered inside it. Views call `useToolsWorkspace()` — it returns
 *  null outside the workspace, so a view hosted on its own route no-ops and
 *  keeps its existing router behavior. ToolsView owns the state; this module
 *  only carries the context + types so views never import the workspace. */
import { createContext, useContext } from 'react'
import type { ToolId } from '@/lib/toolsModel'

export interface ToolTab {
  /** `toolId` for a list tab, `${toolId}:${recordId}` for a record tab. */
  key: string
  toolId: ToolId
  recordId?: string
  title: string
  dirty?: boolean
}

export interface ToolsWorkspace {
  tabs: readonly ToolTab[]
  /** null = the tool directory is showing (tabs stay open behind it). */
  activeKey: string | null
  /** Open/focus a tool's LIST tab (dedupe: focuses if already open). */
  openTool: (toolId: ToolId) => void
  /** Open/focus a record tab (dedupe by toolId+recordId). Title optional —
   *  the tool label shows until setTabTitle or the restore fetch resolves. */
  openRecord: (toolId: ToolId, recordId: string, title?: string) => void
  /** Parse an internal href (`/<tool>?…` or `/tools?tool=…`) and open it as
   *  a tab. Extra query params (`?q=…`) seed a NOT-yet-open tab through the
   *  URL; an already-open tab is just focused (keep-alive views read seeds
   *  once at mount). Any other href falls back to router.push. */
  openHref: (href: string) => void
  closeTab: (key: string) => void
  closeOthers: (key: string) => void
  closeAll: () => void
  activate: (key: string) => void
  reorder: (fromIdx: number, toIdx: number) => void
  setTabTitle: (key: string, title: string) => void
  /** Dirty tabs ask confirm() before closing; beforeunload guards the page. */
  registerDirty: (key: string, dirty: boolean) => void
  /** Show the directory WITHOUT closing any tab. */
  backToDirectory: () => void
}

const ToolsWorkspaceContext = createContext<ToolsWorkspace | null>(null)

export const ToolsWorkspaceProvider = ToolsWorkspaceContext.Provider

export function useToolsWorkspace(): ToolsWorkspace | null {
  return useContext(ToolsWorkspaceContext)
}
