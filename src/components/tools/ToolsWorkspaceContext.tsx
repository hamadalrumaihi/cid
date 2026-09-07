'use client'

/** Tools-era name for the workspace contract. The state owner is now
 *  components/workspace/WorkspaceProvider (tools, records AND cases in one
 *  strip); this module re-exports the same context so every tool view and
 *  useToolNav keep importing what they always did. `useToolsWorkspace()`
 *  still returns null outside the workspace. */
export { useWorkspace as useToolsWorkspace } from '@/components/workspace/WorkspaceContext'
