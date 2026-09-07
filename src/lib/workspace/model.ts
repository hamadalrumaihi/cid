/** Unified workspace model — PURE state + reducer functions for the tab strip
 *  that hosts tools, tool records and cases side by side (plan §5.5, P3-01 /
 *  P3-02). No React, no I/O: WorkspaceProvider owns the effects (restore,
 *  RLS title re-resolution, persistence, URL mirroring) and calls these.
 *
 *  Keys:   `tool:<toolId>` · `record:<toolId>:<recordId>` · `case:<caseId>`
 *  Cap:    at most CASE_TAB_CAP distinct case tabs — openCase on a 9th case
 *          returns `capped: true` and leaves the state untouched so the UI
 *          can ask which one to close.
 *  Stored: `{ tabs: [{ kind, id, toolId?, section? }], active }` — IDS ONLY.
 *          Titles (record names, case numbers) are never persisted; they are
 *          re-fetched through the viewer's RLS-scoped client on restore, and a
 *          row that no longer resolves closes silently. */
import { TAB_LABEL } from '@/lib/nav'
import { RECORD_PARAM, hasRecordTabs, isToolTab, type ToolId } from '@/lib/toolsModel'

export type TabKind = 'tool' | 'record' | 'case'

export interface WorkspaceTab {
  key: string
  kind: TabKind
  /** toolId for a tool tab, recordId for a record tab, caseId for a case tab. */
  id: string
  /** Tool + record tabs only. */
  toolId?: ToolId
  title: string
  /** Case section (or record section) remembered while the tab is suspended. */
  section?: string
  /** Window scroll captured when the tab was last active. */
  scroll?: number
  dirty?: boolean
}

export interface WorkspaceState {
  tabs: WorkspaceTab[]
  /** null = the directory is showing (tabs stay open behind it). */
  activeKey: string | null
}

export interface StoredTab { kind: TabKind; id: string; toolId?: ToolId; section?: string }
export interface StoredWorkspace { tabs: StoredTab[]; active: string | null }

export const CASE_TAB_CAP = 8

/** Placeholder title for a case tab whose row has not been verified yet —
 *  deliberately NOT a number, so an unreadable case never shows one. */
export const CASE_TITLE_PLACEHOLDER = 'Case'

export const EMPTY_WORKSPACE: WorkspaceState = { tabs: [], activeKey: null }

/* ── Keys ─────────────────────────────────────────────────────────────────── */

export const toolKey = (toolId: ToolId): string => `tool:${toolId}`
export const recordKey = (toolId: ToolId, recordId: string): string => `record:${toolId}:${recordId}`
export const caseKey = (caseId: string): string => `case:${caseId}`

export const toolLabel = (toolId: ToolId): string => TAB_LABEL[toolId] ?? toolId

export const isCaseTab = (t: WorkspaceTab): boolean => t.kind === 'case'
export const caseTabs = (s: WorkspaceState): WorkspaceTab[] => s.tabs.filter(isCaseTab)
export const activeTab = (s: WorkspaceState): WorkspaceTab | null =>
  s.tabs.find((t) => t.key === s.activeKey) ?? null

/* ── Open ─────────────────────────────────────────────────────────────────── */

function focus(s: WorkspaceState, key: string): WorkspaceState {
  return s.activeKey === key ? s : { ...s, activeKey: key }
}

export function openTool(s: WorkspaceState, toolId: ToolId): WorkspaceState {
  if (!isToolTab(toolId)) return s
  const key = toolKey(toolId)
  if (s.tabs.some((t) => t.key === key)) return focus(s, key)
  return { tabs: [...s.tabs, { key, kind: 'tool', id: toolId, toolId, title: toolLabel(toolId) }], activeKey: key }
}

/** Tools without a standalone record component fall back to their list tab. */
export function openRecord(s: WorkspaceState, toolId: ToolId, recordId: string, title?: string): WorkspaceState {
  if (!isToolTab(toolId) || !recordId) return s
  if (!hasRecordTabs(toolId)) return openTool(s, toolId)
  const key = recordKey(toolId, recordId)
  const existing = s.tabs.find((t) => t.key === key)
  if (existing) {
    const tabs = title && existing.title !== title
      ? s.tabs.map((t) => (t.key === key ? { ...t, title } : t))
      : s.tabs
    return { tabs, activeKey: key }
  }
  return {
    tabs: [...s.tabs, { key, kind: 'record', id: recordId, toolId, title: title || toolLabel(toolId) }],
    activeKey: key,
  }
}

export interface OpenCaseResult { state: WorkspaceState; capped: boolean }

/** Open/focus a case tab. Re-opening an existing tab keeps its remembered
 *  section unless the caller names one (a deep link wins over memory). */
export function openCase(
  s: WorkspaceState,
  caseId: string,
  opts: { section?: string; title?: string } = {},
): OpenCaseResult {
  if (!caseId) return { state: s, capped: false }
  const key = caseKey(caseId)
  const existing = s.tabs.find((t) => t.key === key)
  if (existing) {
    const next: WorkspaceTab = {
      ...existing,
      ...(opts.section ? { section: opts.section } : {}),
      ...(opts.title ? { title: opts.title } : {}),
    }
    const changed = next.section !== existing.section || next.title !== existing.title
    return { state: { tabs: changed ? s.tabs.map((t) => (t.key === key ? next : t)) : s.tabs, activeKey: key }, capped: false }
  }
  if (caseTabs(s).length >= CASE_TAB_CAP) return { state: s, capped: true }
  const tab: WorkspaceTab = { key, kind: 'case', id: caseId, title: opts.title || CASE_TITLE_PLACEHOLDER }
  if (opts.section) tab.section = opts.section
  return { state: { tabs: [...s.tabs, tab], activeKey: key }, capped: false }
}

/* ── Close / focus / order ────────────────────────────────────────────────── */

/** Remove tabs. When the active tab goes: a record tab returns to its tool's
 *  list tab when that is open, otherwise the nearest surviving neighbour
 *  (after, then before), otherwise the directory. */
export function closeTabs(s: WorkspaceState, keys: readonly string[]): WorkspaceState {
  if (!keys.length) return s
  const drop = new Set(keys)
  if (!s.tabs.some((t) => drop.has(t.key))) return s
  const tabs = s.tabs.filter((t) => !drop.has(t.key))
  let activeKey = s.activeKey
  if (activeKey && drop.has(activeKey)) {
    const closed = s.tabs.find((t) => t.key === s.activeKey)
    const listKey = closed?.kind === 'record' && closed.toolId ? toolKey(closed.toolId) : null
    if (listKey && tabs.some((t) => t.key === listKey)) activeKey = listKey
    else {
      const idx = s.tabs.findIndex((t) => t.key === s.activeKey)
      const after = s.tabs.slice(idx + 1).find((t) => !drop.has(t.key))
      const before = [...s.tabs.slice(0, idx)].reverse().find((t) => !drop.has(t.key))
      activeKey = after?.key ?? before?.key ?? null
    }
  }
  return { tabs, activeKey }
}

export const closeOthers = (s: WorkspaceState, key: string): WorkspaceState =>
  closeTabs(s, s.tabs.filter((t) => t.key !== key).map((t) => t.key))

export const closeAll = (s: WorkspaceState): WorkspaceState =>
  s.tabs.length ? { tabs: [], activeKey: null } : s

export function activate(s: WorkspaceState, key: string | null): WorkspaceState {
  if (key === null) return s.activeKey === null ? s : { ...s, activeKey: null }
  return s.tabs.some((t) => t.key === key) ? focus(s, key) : s
}

export function reorder(s: WorkspaceState, fromIdx: number, toIdx: number): WorkspaceState {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= s.tabs.length || toIdx >= s.tabs.length) return s
  const tabs = [...s.tabs]
  const [moved] = tabs.splice(fromIdx, 1)
  tabs.splice(toIdx, 0, moved)
  return { ...s, tabs }
}

/* ── Per-tab fields ───────────────────────────────────────────────────────── */

function patchTab(s: WorkspaceState, key: string, patch: Partial<WorkspaceTab>): WorkspaceState {
  const tab = s.tabs.find((t) => t.key === key)
  if (!tab) return s
  const same = (Object.keys(patch) as (keyof WorkspaceTab)[]).every((k) => tab[k] === patch[k])
  if (same) return s
  return { ...s, tabs: s.tabs.map((t) => (t.key === key ? { ...t, ...patch } : t)) }
}

export const setTitle = (s: WorkspaceState, key: string, title: string): WorkspaceState => patchTab(s, key, { title })
export const setSection = (s: WorkspaceState, key: string, section: string): WorkspaceState => patchTab(s, key, { section })
export const setScroll = (s: WorkspaceState, key: string, scroll: number): WorkspaceState => patchTab(s, key, { scroll })
export function setDirty(s: WorkspaceState, key: string, dirty: boolean): WorkspaceState {
  const tab = s.tabs.find((t) => t.key === key)
  if (!tab || Boolean(tab.dirty) === dirty) return s
  return patchTab(s, key, { dirty })
}

/** Any tab with unsaved work (the beforeunload / confirm-close aggregate). */
export const anyDirty = (s: WorkspaceState): boolean => s.tabs.some((t) => t.dirty)

/* ── Serialize / parse (ids only) ─────────────────────────────────────────── */

export function serialize(s: WorkspaceState): StoredWorkspace {
  return {
    tabs: s.tabs.map((t) => {
      const out: StoredTab = { kind: t.kind, id: t.id }
      if (t.toolId) out.toolId = t.toolId
      if (t.section) out.section = t.section
      return out
    }),
    active: s.activeKey,
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Validate an untrusted stored payload: unknown kinds / tools dropped,
 *  duplicates keep the first, case tabs beyond the cap dropped, an active key
 *  that names no surviving tab becomes null. Garbage in → null. */
export function parseStored(value: unknown): StoredWorkspace | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null
  const tabs: StoredTab[] = []
  const seen = new Set<string>()
  let cases = 0
  for (const raw of value.tabs) {
    if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) continue
    const section = typeof raw.section === 'string' && raw.section ? raw.section : undefined
    let tab: StoredTab | null = null
    if (raw.kind === 'tool' && isToolTab(raw.id)) tab = { kind: 'tool', id: raw.id, toolId: raw.id }
    else if (raw.kind === 'record' && typeof raw.toolId === 'string' && isToolTab(raw.toolId) && hasRecordTabs(raw.toolId)) {
      tab = { kind: 'record', id: raw.id, toolId: raw.toolId }
    } else if (raw.kind === 'case') {
      if (cases >= CASE_TAB_CAP) continue
      cases += 1
      tab = { kind: 'case', id: raw.id }
    }
    if (!tab) continue
    const key = storedKey(tab)
    if (seen.has(key)) continue
    seen.add(key)
    if (section) tab.section = section
    tabs.push(tab)
  }
  const active = typeof value.active === 'string' && seen.has(value.active) ? value.active : null
  return { tabs, active }
}

/** The pre-workspace ToolsView payload (`cid-tools-workspace:<uid>`):
 *  `{ tabs: [{ toolId, recordId? }], activeKey: 'persons' | 'persons:<id>' }`. */
export function parseLegacyTools(value: unknown): StoredWorkspace | null {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return null
  const tabs: StoredTab[] = []
  for (const raw of value.tabs) {
    if (!isRecord(raw) || typeof raw.toolId !== 'string' || !isToolTab(raw.toolId)) continue
    const recordId = typeof raw.recordId === 'string' && raw.recordId ? raw.recordId : undefined
    if (recordId && !hasRecordTabs(raw.toolId)) continue
    tabs.push(recordId ? { kind: 'record', id: recordId, toolId: raw.toolId } : { kind: 'tool', id: raw.toolId, toolId: raw.toolId })
  }
  let active: string | null = null
  if (typeof value.activeKey === 'string') {
    const [tool, ...rest] = value.activeKey.split(':')
    const rec = rest.join(':')
    if (isToolTab(tool)) active = rec ? recordKey(tool, rec) : toolKey(tool)
  }
  return parseStored({ tabs, active })
}

export function storedKey(t: StoredTab): string {
  if (t.kind === 'case') return caseKey(t.id)
  if (t.kind === 'record' && t.toolId) return recordKey(t.toolId, t.id)
  return toolKey(t.id as ToolId)
}

/** Rebuild live state from a stored payload. Record and case titles are
 *  placeholders until the provider's RLS re-resolution replaces them (or
 *  closes the tab). */
export function restore(stored: StoredWorkspace): WorkspaceState {
  const tabs: WorkspaceTab[] = stored.tabs.map((t) => {
    const base: WorkspaceTab = t.kind === 'case'
      ? { key: caseKey(t.id), kind: 'case', id: t.id, title: CASE_TITLE_PLACEHOLDER }
      : t.kind === 'record' && t.toolId
        ? { key: recordKey(t.toolId, t.id), kind: 'record', id: t.id, toolId: t.toolId, title: toolLabel(t.toolId) }
        : { key: toolKey(t.id as ToolId), kind: 'tool', id: t.id, toolId: t.id as ToolId, title: toolLabel(t.id as ToolId) }
    if (t.section) base.section = t.section
    return base
  })
  return { tabs, activeKey: stored.active && tabs.some((t) => t.key === stored.active) ? stored.active : null }
}

/* ── URL contract ─────────────────────────────────────────────────────────── */

/** `/workspace?case=…&tab=…[&report|task|evidence]` — the workspace form of
 *  caseLink(). caseLink() itself is unchanged (`/cases?case=` redirects here)
 *  so every notification, search hit and cross-link keeps its address. */
export function workspaceCaseHref(
  caseId: string,
  section?: string | null,
  opts: { report?: string | null; task?: string | null; evidence?: string | null } = {},
): string {
  const p = new URLSearchParams({ case: caseId })
  if (section) p.set('tab', section)
  if (opts.report) p.set('report', opts.report)
  if (opts.task) p.set('task', opts.task)
  if (opts.evidence) p.set('evidence', opts.evidence)
  return `/workspace?${p.toString()}`
}

/** Query string that describes the ACTIVE tab, layered over the current
 *  params. Tab-family params that belong to another tab are dropped
 *  (`report=` from case A must not follow the user to case B); everything
 *  else (mount-time seeds like `?q=`, `?section=`) is carried over exactly as
 *  the tools workspace did. */
export function mirrorParams(current: URLSearchParams, active: WorkspaceTab | null): URLSearchParams {
  const p = new URLSearchParams(current)
  const prevCase = p.get('case')
  const clearCase = () => { for (const k of ['case', 'tab', 'report', 'task', 'evidence']) p.delete(k) }
  const clearTool = () => { p.delete('tool'); p.delete('record') }
  if (!active) { clearCase(); clearTool(); return p }
  if (active.kind === 'case') {
    clearTool()
    if (prevCase !== active.id) clearCase()
    p.set('case', active.id)
    if (active.section) p.set('tab', active.section)
    else p.delete('tab')
    return p
  }
  clearCase()
  if (active.toolId) p.set('tool', active.toolId)
  if (active.kind === 'record') p.set('record', active.id)
  else {
    // A `?record=` on a tool WITHOUT record tabs is a list seed in the
    // generic spelling (`/tools?tool=field-review&record=X` from a
    // notification): carry it under the tool's own param so the view can
    // read it after this rewrite, instead of dropping it on the floor.
    const seedParam = active.toolId && !hasRecordTabs(active.toolId) ? RECORD_PARAM[active.toolId] : undefined
    const seed = p.get('record')
    if (seedParam && seed && !p.has(seedParam)) p.set(seedParam, seed)
    p.delete('record')
  }
  return p
}
