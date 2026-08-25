'use client'

/** Investigative Tools workspace (`/tools`) — the Intelligence category's 14
 *  tabs behind one nav item: a tool directory plus a multi-tab, keep-alive
 *  strip. Every open tab stays MOUNTED (inactive ones display:none) so
 *  switching tools never reloads their data; per-tab window scroll is captured
 *  and restored. This is navigation only — each tool renders the same
 *  RLS-scoped view it always did, and the old routes redirect here
 *  (ToolTabRedirect) so no deep link is lost.
 *
 *  Persistence: sessionStorage per signed-in user, IDS ONLY (never titles,
 *  counts or data). Restored record tabs re-verify their title through the
 *  RLS-scoped client (RECORD_TITLE_SOURCE); a row the viewer can't see closes
 *  the tab silently. The ACTIVE tab is mirrored into the query string
 *  (`?tool=…&record=…`, router.replace) so refresh, bookmarks and
 *  back/forward stay predictable. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { list } from '@/lib/db'
import { TAB_LABEL } from '@/lib/nav'
import {
  RECORD_PARAM, RECORD_TITLE_SOURCE, hasRecordTabs, isToolTab, type ToolId,
} from '@/lib/toolsModel'
import { ToolsWorkspaceProvider, type ToolTab, type ToolsWorkspace } from './ToolsWorkspaceContext'
import { ToolTabBar } from './ToolTabBar'
import { ToolDirectory } from './ToolDirectory'
import { TOOL_LIST_COMPONENT, TOOL_RECORD_COMPONENT } from './toolRegistry'

interface WsState {
  tabs: ToolTab[]
  activeKey: string | null
}

interface StoredTab { toolId: string; recordId?: string }
interface StoredState { tabs: StoredTab[]; activeKey: string | null }

const STORAGE_PREFIX = 'cid-tools-workspace:'
const DIRECTORY_SCROLL_KEY = '~directory'

const toolLabel = (toolId: ToolId): string => TAB_LABEL[toolId] ?? toolId
const keyOf = (toolId: ToolId, recordId?: string): string => (recordId ? `${toolId}:${recordId}` : toolId)

function readStored(uid: string): StoredState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + uid)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredState
    if (!parsed || !Array.isArray(parsed.tabs)) return null
    return parsed
  } catch {
    return null
  }
}

export function ToolsView() {
  const router = useRouter()
  const sp = useSearchParams()
  const { state, session, profile } = useAuth()
  const uid = session?.user?.id ?? profile?.id ?? null

  const [ws, setWs] = useState<WsState>({ tabs: [], activeKey: null })
  const [restored, setRestored] = useState(false)

  const activeKeyRef = useRef<string | null>(null)
  useEffect(() => { activeKeyRef.current = ws.activeKey }, [ws.activeKey])
  /** Per-tab window scroll (the app scrolls the window, not a container). */
  const scrollPos = useRef(new Map<string, number>())
  /** Record-tab keys whose title has been provided or verified already. */
  const titleSettled = useRef(new Set<string>())
  /** Query string we last wrote ourselves — the intake effect skips it. */
  const selfWrite = useRef<string | null>(null)

  const captureScroll = useCallback(() => {
    scrollPos.current.set(activeKeyRef.current ?? DIRECTORY_SCROLL_KEY, window.scrollY)
  }, [])

  /* ── Tab operations ────────────────────────────────────────────────────── */

  const openTool = useCallback((toolId: ToolId) => {
    if (!isToolTab(toolId)) return
    captureScroll()
    setWs((s) => {
      if (s.tabs.some((t) => t.key === toolId)) return { ...s, activeKey: toolId }
      return { tabs: [...s.tabs, { key: toolId, toolId, title: toolLabel(toolId) }], activeKey: toolId }
    })
  }, [captureScroll])

  const openRecord = useCallback((toolId: ToolId, recordId: string, title?: string) => {
    if (!isToolTab(toolId) || !recordId) return
    // Tools without a standalone record component fall back to their list tab
    // (the list view's own deep-link handling covers the record for now).
    if (!hasRecordTabs(toolId)) { openTool(toolId); return }
    const key = keyOf(toolId, recordId)
    if (title) titleSettled.current.add(key)
    captureScroll()
    setWs((s) => {
      const existing = s.tabs.find((t) => t.key === key)
      if (existing) {
        const tabs = title && existing.title !== title
          ? s.tabs.map((t) => (t.key === key ? { ...t, title } : t))
          : s.tabs
        return { tabs, activeKey: key }
      }
      return {
        tabs: [...s.tabs, { key, toolId, recordId, title: title || toolLabel(toolId) }],
        activeKey: key,
      }
    })
  }, [captureScroll, openTool])

  /** Remove tabs without any confirm (internal — RLS restore pruning, and the
   *  close operations after their own confirm step). */
  const removeTabs = useCallback((keys: readonly string[]) => {
    if (!keys.length) return
    captureScroll()
    setWs((s) => {
      const drop = new Set(keys)
      const tabs = s.tabs.filter((t) => !drop.has(t.key))
      let activeKey = s.activeKey
      if (activeKey && drop.has(activeKey)) {
        const closed = s.tabs.find((t) => t.key === s.activeKey)
        // A closed record tab returns to its tool's list tab when open …
        const listKey = closed?.recordId ? closed.toolId : null
        if (listKey && tabs.some((t) => t.key === listKey)) activeKey = listKey
        else {
          // … otherwise the nearest neighbour, else the directory.
          const idx = s.tabs.findIndex((t) => t.key === s.activeKey)
          const after = s.tabs.slice(idx + 1).find((t) => !drop.has(t.key))
          const before = [...s.tabs.slice(0, idx)].reverse().find((t) => !drop.has(t.key))
          activeKey = after?.key ?? before?.key ?? null
        }
      }
      for (const k of keys) scrollPos.current.delete(k)
      return { tabs, activeKey }
    })
  }, [captureScroll])

  const confirmDirty = useCallback((dirtyTabs: readonly ToolTab[]): boolean => {
    if (!dirtyTabs.length) return true
    const names = dirtyTabs.map((t) => t.title).join(', ')
    return window.confirm(`Discard unsaved changes in ${names}?`)
  }, [])

  const closeTab = useCallback((key: string) => {
    const tab = ws.tabs.find((t) => t.key === key)
    if (!tab) return
    if (tab.dirty && !confirmDirty([tab])) return
    removeTabs([key])
  }, [ws.tabs, confirmDirty, removeTabs])

  const closeOthers = useCallback((key: string) => {
    const others = ws.tabs.filter((t) => t.key !== key)
    if (!others.length) return
    if (!confirmDirty(others.filter((t) => t.dirty))) return
    removeTabs(others.map((t) => t.key))
  }, [ws.tabs, confirmDirty, removeTabs])

  const closeAll = useCallback(() => {
    if (!ws.tabs.length) return
    if (!confirmDirty(ws.tabs.filter((t) => t.dirty))) return
    removeTabs(ws.tabs.map((t) => t.key))
  }, [ws.tabs, confirmDirty, removeTabs])

  const activate = useCallback((key: string) => {
    captureScroll()
    setWs((s) => (s.tabs.some((t) => t.key === key) ? { ...s, activeKey: key } : s))
  }, [captureScroll])

  const reorder = useCallback((fromIdx: number, toIdx: number) => {
    setWs((s) => {
      if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0 || fromIdx >= s.tabs.length || toIdx >= s.tabs.length) return s
      const tabs = [...s.tabs]
      const [moved] = tabs.splice(fromIdx, 1)
      tabs.splice(toIdx, 0, moved)
      return { ...s, tabs }
    })
  }, [])

  const setTabTitle = useCallback((key: string, title: string) => {
    titleSettled.current.add(key)
    setWs((s) => (s.tabs.some((t) => t.key === key && t.title !== title)
      ? { ...s, tabs: s.tabs.map((t) => (t.key === key ? { ...t, title } : t)) }
      : s))
  }, [])

  const registerDirty = useCallback((key: string, dirty: boolean) => {
    setWs((s) => (s.tabs.some((t) => t.key === key && Boolean(t.dirty) !== dirty)
      ? { ...s, tabs: s.tabs.map((t) => (t.key === key ? { ...t, dirty } : t)) }
      : s))
  }, [])

  const backToDirectory = useCallback(() => {
    captureScroll()
    setWs((s) => ({ ...s, activeKey: null }))
  }, [captureScroll])

  const openHref = useCallback((href: string) => {
    try {
      const url = new URL(href, window.location.origin)
      if (url.origin === window.location.origin) {
        const seg = url.pathname.split('/')[1] || ''
        // Normalize both accepted forms: `/<tool>?…` and `/tools?tool=…`.
        let tool: ToolId | null = null
        if (isToolTab(seg)) tool = seg
        else if (seg === 'tools') {
          const t = url.searchParams.get('tool')
          if (t && isToolTab(t)) tool = t
        }
        if (tool) {
          const toolId = tool
          const param = RECORD_PARAM[toolId]
          const record = url.searchParams.get('record') ?? (param ? url.searchParams.get(param) : null)
          const seeds = new URLSearchParams(url.searchParams)
          seeds.delete('tool'); seeds.delete('record')
          if (param) seeds.delete(param)
          if (record && hasRecordTabs(toolId)) {
            if (seeds.toString() && !ws.tabs.some((t) => t.key === keyOf(toolId, record))) {
              seeds.set('tool', toolId)
              seeds.set('record', record)
              router.replace(`/tools?${seeds.toString()}`, { scroll: false })
            } else openRecord(toolId, record)
            return
          }
          if (param && record) seeds.set(param, record) // record param without a record tab stays a list seed
          // Leftover params (?q=…, ?place=…) are mount-time seeds: a tool that
          // is not open yet reads them at first mount, so land it through the
          // URL and let the intake effect open the tab while the seeds are
          // still in the query string — exactly how ToolTabRedirect lands old
          // deep links. An already-mounted keep-alive tab cannot consume
          // seeds, so it is simply focused.
          if (seeds.toString() && !ws.tabs.some((t) => t.key === toolId)) {
            seeds.set('tool', toolId)
            router.replace(`/tools?${seeds.toString()}`, { scroll: false })
          } else openTool(toolId)
          return
        }
      }
    } catch { /* not a parseable href — let the router handle it */ }
    router.push(href)
  }, [ws.tabs, openRecord, openTool, router])

  /* ── Restore (once, per signed-in user; ids only) ─────────────────────── */

  useEffect(() => {
    if (restored || state === 'loading') return
    // Deferred (repo idiom for effect-driven state): the timer callback keeps
    // setState out of the synchronous effect body.
    const t = window.setTimeout(() => {
      if (state === 'in' && uid) {
        const stored = readStored(uid)
        if (stored) {
          const tabs: ToolTab[] = []
          for (const s of stored.tabs) {
            if (!isToolTab(s.toolId)) continue
            const recordId = typeof s.recordId === 'string' && s.recordId ? s.recordId : undefined
            if (recordId && !hasRecordTabs(s.toolId)) continue
            const key = keyOf(s.toolId, recordId)
            if (tabs.some((x) => x.key === key)) continue
            tabs.push({ key, toolId: s.toolId, recordId, title: toolLabel(s.toolId) })
          }
          const activeKey = stored.activeKey && tabs.some((x) => x.key === stored.activeKey) ? stored.activeKey : null
          setWs({ tabs, activeKey })
        }
      }
      // Apply the URL intent on top of the restored set (this is also how
      // ToolTabRedirect lands old deep links here).
      const params = new URLSearchParams(window.location.search)
      const tool = params.get('tool')
      if (tool && isToolTab(tool)) {
        const record = params.get('record')
        if (record && hasRecordTabs(tool)) openRecord(tool, record)
        else openTool(tool)
      }
      setRestored(true)
    }, 0)
    return () => window.clearTimeout(t)
  }, [restored, state, uid, openRecord, openTool])

  /* ── Persist (ids only — never titles, counts or data) ────────────────── */

  useEffect(() => {
    if (!restored || state !== 'in' || !uid) return
    try {
      const payload: StoredState = {
        tabs: ws.tabs.map((t) => (t.recordId ? { toolId: t.toolId, recordId: t.recordId } : { toolId: t.toolId })),
        activeKey: ws.activeKey,
      }
      sessionStorage.setItem(STORAGE_PREFIX + uid, JSON.stringify(payload))
    } catch { /* storage unavailable — the workspace still works, unpersisted */ }
  }, [restored, state, uid, ws])

  /* ── Record-tab title verification (RLS-safe restore) ─────────────────── */

  useEffect(() => {
    if (!restored || state !== 'in') return
    for (const tab of ws.tabs) {
      if (!tab.recordId || titleSettled.current.has(tab.key)) continue
      titleSettled.current.add(tab.key)
      const src = RECORD_TITLE_SOURCE[tab.toolId]
      if (!src) continue
      const { table, column } = src
      const { key, recordId } = tab
      void list(table, { select: `id,${column}`, eq: { id: recordId }, limit: 1 })
        .then((rows) => {
          const row = rows[0] as Record<string, unknown> | undefined
          if (!row) { removeTabs([key]); return } // not visible under RLS → close silently
          const title = row[column]
          if (typeof title === 'string' && title) setTabTitle(key, title)
        })
        .catch(() => {
          // Transient failure: keep the tab under the tool label and allow a
          // retry on the next tabs change.
          titleSettled.current.delete(key)
        })
    }
  }, [restored, state, ws.tabs, removeTabs, setTabTitle])

  /* ── URL sync (active tab → query string; query string → tabs) ────────── */

  useEffect(() => {
    if (!restored) return
    const qs = sp.toString()
    if (qs === selfWrite.current) return
    const tool = sp.get('tool')
    if (!tool || !isToolTab(tool)) return
    const record = sp.get('record')
    const t = window.setTimeout(() => {
      const wantKey = record && hasRecordTabs(tool) ? keyOf(tool, record) : tool
      if (wantKey === activeKeyRef.current) return
      if (record && hasRecordTabs(tool)) openRecord(tool, record)
      else openTool(tool)
    }, 0)
    return () => window.clearTimeout(t)
  }, [sp, restored, openRecord, openTool])

  useEffect(() => {
    if (!restored) return
    const params = new URLSearchParams(window.location.search)
    const active = ws.tabs.find((t) => t.key === ws.activeKey) ?? null
    if (active) {
      params.set('tool', active.toolId)
      if (active.recordId) params.set('record', active.recordId)
      else params.delete('record')
    } else {
      params.delete('tool')
      params.delete('record')
    }
    const qs = params.toString()
    if (qs === window.location.search.replace(/^\?/, '')) return
    selfWrite.current = qs
    router.replace(qs ? `/tools?${qs}` : '/tools', { scroll: false })
  }, [restored, ws.activeKey, ws.tabs, router])

  /* ── Scroll restore + dirty-tab unload guard ──────────────────────────── */

  useLayoutEffect(() => {
    if (!restored) return
    const target = scrollPos.current.get(ws.activeKey ?? DIRECTORY_SCROLL_KEY) ?? 0
    const raf = requestAnimationFrame(() => window.scrollTo(0, target))
    return () => cancelAnimationFrame(raf)
  }, [restored, ws.activeKey])

  useEffect(() => {
    if (!ws.tabs.some((t) => t.dirty)) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [ws.tabs])

  /* ── Render ───────────────────────────────────────────────────────────── */

  const workspace = useMemo<ToolsWorkspace>(() => ({
    tabs: ws.tabs,
    activeKey: ws.activeKey,
    openTool, openRecord, openHref,
    closeTab, closeOthers, closeAll,
    activate, reorder, setTabTitle, registerDirty, backToDirectory,
  }), [ws.tabs, ws.activeKey, openTool, openRecord, openHref, closeTab,
       closeOthers, closeAll, activate, reorder, setTabTitle, registerDirty, backToDirectory])

  const openToolIds = useMemo(
    () => new Set<ToolId>(ws.tabs.filter((t) => !t.recordId).map((t) => t.toolId)),
    [ws.tabs],
  )

  return (
    <ToolsWorkspaceProvider value={workspace}>
      <ToolTabBar
        tabs={ws.tabs}
        activeKey={ws.activeKey}
        onActivate={activate}
        onClose={closeTab}
        onCloseOthers={closeOthers}
        onCloseAll={closeAll}
        onReorder={reorder}
        onDirectory={backToDirectory}
      />
      {ws.activeKey === null && <ToolDirectory openKeys={openToolIds} onOpen={openTool} />}
      {ws.tabs.map((tab) => {
        const active = tab.key === ws.activeKey
        let content: React.ReactNode = null
        if (tab.recordId) {
          const Record = TOOL_RECORD_COMPONENT[tab.toolId]
          if (Record) content = <Record id={tab.recordId} onBack={() => closeTab(tab.key)} />
        } else {
          const ListView = TOOL_LIST_COMPONENT[tab.toolId]
          content = <ListView />
        }
        return (
          <div
            key={tab.key}
            className="tools-pane"
            data-state={active ? 'active' : 'inactive'}
            style={active ? undefined : { display: 'none' }}
            aria-hidden={active ? undefined : true}
          >
            {content}
          </div>
        )
      })}
    </ToolsWorkspaceProvider>
  )
}
