'use client'

/** Workspace contract between the shell (WorkspaceProvider / WorkspaceView)
 *  and the views rendered inside it. Views call `useWorkspace()` — it returns
 *  null outside the workspace, so a view hosted on its own route no-ops and
 *  keeps its router behaviour. The provider owns the state; this module only
 *  carries the context + types so views never import the provider.
 *
 *  `ToolsWorkspace` is the exact surface ToolsView exposed before the
 *  workspace unified tools and cases (tools/ToolsWorkspaceContext re-exports
 *  it) — the 28 useToolNav callers and every tool view keep working
 *  unchanged. `Workspace` adds the case operations on top. */
import { createContext, useContext } from 'react'
import type { ToolId } from '@/lib/toolsModel'
import type { WorkspaceTab } from '@/lib/workspace/model'

export type { WorkspaceTab }

export interface ToolsWorkspace {
  tabs: readonly WorkspaceTab[]
  /** null = the directory is showing (tabs stay open behind it). */
  activeKey: string | null
  /** Open/focus a tool's LIST tab (dedupe: focuses if already open). */
  openTool: (toolId: ToolId) => void
  /** Open/focus a record tab (dedupe by toolId+recordId). Title optional —
   *  the tool label shows until setTabTitle or the restore fetch resolves. */
  openRecord: (toolId: ToolId, recordId: string, title?: string) => void
  /** Parse an internal href (`/<tool>?…`, `/tools?tool=…`, `/workspace?…` or
   *  `/cases?case=…`) and open it as a tab. Extra query params (`?q=…`) seed
   *  a NOT-yet-open tab through the URL; an already-open tab is just focused
   *  (keep-alive views read seeds once at mount). Any other href falls back
   *  to router.push. */
  openHref: (href: string) => void
  closeTab: (key: string) => void
  closeOthers: (key: string) => void
  closeAll: () => void
  activate: (key: string) => void
  reorder: (fromIdx: number, toIdx: number) => void
  setTabTitle: (key: string, title: string) => void
  /** Dirty tabs ask confirm() before closing; beforeunload guards the page.
   *  `source` lets several drafts in one tab register independently (the
   *  tab is dirty while ANY source is). */
  registerDirty: (key: string, dirty: boolean, source?: string) => void
  /** Show the directory WITHOUT closing any tab. */
  backToDirectory: () => void
}

export interface OpenCaseOptions {
  /** Case number when the caller already has it (board click) — shown at
   *  once; the provider still re-verifies it through RLS. */
  title?: string
  /** Record param carried in the URL (`?report=`, `?task=`, `?evidence=`). */
  params?: Record<string, string | null | undefined>
}

export interface Workspace extends ToolsWorkspace {
  /** Open/focus a case tab. Returns false when the 8-case cap blocked it —
   *  the provider then shows the "close one first" prompt itself. */
  openCase: (caseId: string, section?: string | null, opts?: OpenCaseOptions) => boolean
  setCaseSection: (caseId: string, section: string) => void
  closeCase: (caseId: string) => void
  /** True once the persisted set has been applied (panes render after). */
  restored: boolean
}

export const WorkspaceContext = createContext<Workspace | null>(null)

export function useWorkspace(): Workspace | null {
  return useContext(WorkspaceContext)
}

/** The key of the tab a pane is rendered in — set per pane by WorkspaceView
 *  so hooks inside a view (useTabDirty) can address their own tab without
 *  knowing the workspace's key scheme. Null outside the workspace. */
export const TabKeyContext = createContext<string | null>(null)

export function useTabKey(): string | null {
  return useContext(TabKeyContext)
}
