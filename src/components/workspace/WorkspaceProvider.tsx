'use client'

/** Unified workspace state owner (plan §5.5 / P3-01, P3-02, P3-07). Replaces
 *  ToolsView's inline state and adds case tabs. Responsibilities:
 *   - restore ONCE per signed-in user: sessionStorage mirror (instant) →
 *     `user_prefs.workspace` → the legacy ToolsView payload (adopted once,
 *     then deleted); the URL intent is applied on top;
 *   - RLS-safe title re-resolution: record tabs via RECORD_TITLE_SOURCE, case
 *     tabs via a projected `cases` read. A RESTORED tab whose row does not
 *     resolve closes silently (never a title, never a number); a tab the user
 *     opened deliberately (deep link, board click) stays so the case pane can
 *     show the request-access surface instead;
 *   - persistence, ids only: mirror on every change, `user_prefs` debounced;
 *   - URL mirroring of the ACTIVE tab (`/workspace?tool=…`, `…&record=…`,
 *     `?case=…&tab=…`) with a self-write guard; the intake effect adopts
 *     real navigations (notification clicks, back/forward);
 *   - per-tab window scroll memory; the 8-case cap prompt; the dirty
 *     aggregate (registerDirty sources + useTabDirty) → beforeunload only
 *     while a tab is dirty / a draft flush is pending. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import { normalizeCaseTab } from '@/lib/caseLinks'
import { list } from '@/lib/db'
import { RECORD_PARAM, RECORD_TITLE_SOURCE, hasRecordTabs, isToolTab, type ToolId } from '@/lib/toolsModel'
import { useDraftState } from '@/lib/userDrafts'
import * as M from '@/lib/workspace/model'
import { loadPref, readMirror, savePref, takeLegacy, writeMirror } from '@/lib/workspace/storage'
import { CaseCapPrompt } from './CaseCapPrompt'
import { WorkspaceContext, useTabKey, useWorkspace, type OpenCaseOptions, type Workspace } from './WorkspaceContext'

const PREF_DEBOUNCE_MS = 1500
type State = M.WorkspaceState
type Reducer = (s: State) => State

interface CapRequest { caseId: string; section?: string | null; title?: string }

export function WorkspaceProvider({ children, defaultTool }: { children: React.ReactNode; defaultTool?: ToolId }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const { state: authState, session, profile } = useAuth()
  const uid = session?.user?.id ?? profile?.id ?? null

  const [ws, setWs] = useState<State>(M.EMPTY_WORKSPACE)
  const [restored, setRestored] = useState(false)
  const [cap, setCap] = useState<CapRequest | null>(null)

  /** Latest committed-or-pending state, for synchronous decisions (the cap). */
  const wsRef = useRef<State>(M.EMPTY_WORKSPACE)
  /** Directory scroll (tabs keep theirs in state). */
  const dirScroll = useRef(0)
  /** Keys whose title has been provided or verified already. */
  const titleSettled = useRef(new Set<string>())
  /** Case keys opened by a user action this session — never pruned silently. */
  const userOpened = useRef(new Set<string>())
  /** Dirty sources per tab (a tab may host several drafts). */
  const dirtySources = useRef(new Map<string, Set<string>>())
  /** Query string we last wrote ourselves — the intake effect skips it. */
  const selfWrite = useRef<string | null>(null)
  const restoredFor = useRef<string | null>(null)

  // Reduce from the ref SYNCHRONOUSLY (not inside the setState updater, which
  // React runs lazily): back-to-back operations in one handler — close a tab
  // then open the case the cap prompt was holding — must each see the other's
  // result, and openCase answers the cap from the same ref.
  const commit = useCallback((fn: Reducer) => {
    const next = fn(wsRef.current)
    if (next === wsRef.current) return
    wsRef.current = next
    setWs(next)
  }, [])
  /** Capture the current window scroll into the active tab before switching. */
  const withCapture = useCallback((fn: Reducer) => {
    const y = typeof window === 'undefined' ? 0 : window.scrollY
    commit((s) => {
      if (s.activeKey) return fn(M.setScroll(s, s.activeKey, y))
      dirScroll.current = y
      return fn(s)
    })
  }, [commit])

  /* ── Tab operations ────────────────────────────────────────────────────── */

  const openTool = useCallback((toolId: ToolId) => {
    if (!isToolTab(toolId)) return
    withCapture((s) => M.openTool(s, toolId))
  }, [withCapture])

  const openRecord = useCallback((toolId: ToolId, recordId: string, title?: string) => {
    if (!isToolTab(toolId) || !recordId) return
    if (title && hasRecordTabs(toolId)) titleSettled.current.add(M.recordKey(toolId, recordId))
    withCapture((s) => M.openRecord(s, toolId, recordId, title))
  }, [withCapture])

  const openCase = useCallback((caseId: string, section?: string | null, opts: OpenCaseOptions = {}): boolean => {
    if (!caseId) return false
    const sec = normalizeCaseTab(section) ?? undefined
    if (M.openCase(wsRef.current, caseId, { section: sec }).capped) {
      setCap({ caseId, section: sec, title: opts.title })
      return false
    }
    const key = M.caseKey(caseId)
    userOpened.current.add(key)
    if (opts.title) titleSettled.current.add(key)
    withCapture((s) => M.openCase(s, caseId, { section: sec, title: opts.title }).state)
    return true
  }, [withCapture])

  /** Remove tabs without any confirm (RLS pruning; the close ops confirm first). */
  const removeTabs = useCallback((keys: readonly string[]) => {
    if (!keys.length) return
    for (const k of keys) { titleSettled.current.delete(k); dirtySources.current.delete(k); userOpened.current.delete(k) }
    withCapture((s) => M.closeTabs(s, keys))
  }, [withCapture])

  const confirmDirty = (tabs: readonly M.WorkspaceTab[]): boolean =>
    !tabs.length || window.confirm(`Discard unsaved changes in ${tabs.map((t) => t.title).join(', ')}?`)

  const closeTab = useCallback((key: string) => {
    const tab = wsRef.current.tabs.find((t) => t.key === key)
    if (!tab) return
    if (tab.dirty && !confirmDirty([tab])) return
    removeTabs([key])
  }, [removeTabs])

  const closeOthers = useCallback((key: string) => {
    const others = wsRef.current.tabs.filter((t) => t.key !== key)
    if (!others.length || !confirmDirty(others.filter((t) => t.dirty))) return
    removeTabs(others.map((t) => t.key))
  }, [removeTabs])

  const closeAll = useCallback(() => {
    const all = wsRef.current.tabs
    if (!all.length || !confirmDirty(all.filter((t) => t.dirty))) return
    removeTabs(all.map((t) => t.key))
  }, [removeTabs])

  const closeCase = useCallback((caseId: string) => closeTab(M.caseKey(caseId)), [closeTab])
  const activate = useCallback((key: string) => withCapture((s) => M.activate(s, key)), [withCapture])
  const backToDirectory = useCallback(() => withCapture((s) => M.activate(s, null)), [withCapture])
  const reorder = useCallback((from: number, to: number) => commit((s) => M.reorder(s, from, to)), [commit])

  const setTabTitle = useCallback((key: string, title: string) => {
    titleSettled.current.add(key)
    commit((s) => M.setTitle(s, key, title))
  }, [commit])

  const setCaseSection = useCallback((caseId: string, section: string) => {
    commit((s) => M.setSection(s, M.caseKey(caseId), section))
  }, [commit])

  const registerDirty = useCallback((key: string, dirty: boolean, source = 'default') => {
    const set = dirtySources.current.get(key) ?? new Set<string>()
    if (dirty) set.add(source); else set.delete(source)
    if (set.size) dirtySources.current.set(key, set); else dirtySources.current.delete(key)
    commit((s) => M.setDirty(s, key, set.size > 0))
  }, [commit])

  /** Land a case through the URL when record params ride along (they are
   *  mount-time seeds for the Reports / Tasks / Evidence sections), else open
   *  the tab directly — the tools-workspace seeds rule, applied to cases. */
  const openCaseHref = useCallback((caseId: string, params: URLSearchParams) => {
    const section = normalizeCaseTab(params.get('tab'))
    const opts = { report: params.get('report'), task: params.get('task'), evidence: params.get('evidence') }
    if (opts.report || opts.task || opts.evidence) router.replace(M.workspaceCaseHref(caseId, section, opts), { scroll: false })
    else openCase(caseId, section)
  }, [router, openCase])

  const openHref = useCallback((href: string) => {
    try {
      const url = new URL(href, window.location.origin)
      if (url.origin === window.location.origin) {
        const seg = url.pathname.split('/')[1] || ''
        const caseId = url.searchParams.get('case')
        if ((seg === 'cases' || seg === 'workspace' || seg === 'tools') && caseId) { openCaseHref(caseId, url.searchParams); return }
        // Normalize the accepted tool forms: `/<tool>?…`, `/tools?tool=…`, `/workspace?tool=…`.
        let tool: ToolId | null = null
        if (isToolTab(seg)) tool = seg
        else if (seg === 'tools' || seg === 'workspace') {
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
          const tabs = wsRef.current.tabs
          if (record && hasRecordTabs(toolId)) {
            if (seeds.toString() && !tabs.some((t) => t.key === M.recordKey(toolId, record))) {
              seeds.set('tool', toolId); seeds.set('record', record)
              router.replace(`/workspace?${seeds.toString()}`, { scroll: false })
            } else openRecord(toolId, record)
            return
          }
          if (param && record) seeds.set(param, record) // record param without a record tab stays a list seed
          // Leftover params (?q=…, ?place=…) are mount-time seeds: a tool that
          // is not open yet reads them at first mount, so land it through the
          // URL; an already-mounted keep-alive tab cannot consume seeds and is
          // simply focused.
          if (seeds.toString() && !tabs.some((t) => t.key === M.toolKey(toolId))) {
            seeds.set('tool', toolId)
            router.replace(`/workspace?${seeds.toString()}`, { scroll: false })
          } else openTool(toolId)
          return
        }
      }
    } catch { /* not a parseable href — let the router handle it */ }
    router.push(href)
  }, [openCaseHref, openRecord, openTool, router])

  /** Apply `?case=` / `?tool=` from a query string onto the open set. */
  const applyIntent = useCallback((params: URLSearchParams) => {
    const caseId = params.get('case')
    if (caseId) { openCase(caseId, params.get('tab')); return }
    const tool = params.get('tool')
    if (!tool || !isToolTab(tool)) return
    const record = params.get('record')
    if (record && hasRecordTabs(tool)) openRecord(tool, record)
    else openTool(tool)
  }, [openCase, openRecord, openTool])

  /* ── Restore (once per signed-in user; ids only) ──────────────────────── */

  useEffect(() => {
    if (authState === 'loading') return
    if (restored && restoredFor.current === uid) return
    let cancelled = false
    const apply = (stored: M.StoredWorkspace | null) => {
      if (cancelled) return
      titleSettled.current.clear(); userOpened.current.clear(); dirtySources.current.clear()
      commit(() => (stored ? M.restore(stored) : M.EMPTY_WORKSPACE))
      applyIntent(new URLSearchParams(window.location.search))
      restoredFor.current = uid
      setRestored(true)
    }
    // Deferred (repo idiom for effect-driven state): keeps setState out of
    // the synchronous effect body.
    const t = window.setTimeout(() => {
      if (authState !== 'in' || !uid) { apply(null); return }
      const legacy = takeLegacy(uid) // adopted once, deleted regardless
      const mirror = readMirror(uid)
      if (mirror) { apply(mirror); return }
      void loadPref().then((pref) => apply(pref ?? legacy))
    }, 0)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [restored, authState, uid, commit, applyIntent])

  /* ── Persist (mirror at once, user_prefs debounced; ids only) ─────────── */

  const lastSaved = useRef<string | null>(null)
  const pending = useRef<M.StoredWorkspace | null>(null)
  useEffect(() => {
    if (!restored || authState !== 'in' || !uid) return
    const stored = M.serialize(ws)
    writeMirror(uid, stored)
    const json = JSON.stringify(stored)
    if (json === lastSaved.current) return
    pending.current = stored
    const t = window.setTimeout(() => {
      pending.current = null
      lastSaved.current = json
      void savePref(stored)
    }, PREF_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [restored, authState, uid, ws])
  // Leaving the workspace route flushes a pending server write.
  useEffect(() => () => { if (pending.current) void savePref(pending.current) }, [])

  /* ── Title re-resolution (RLS-safe restore) ───────────────────────────── */

  useEffect(() => {
    if (!restored || authState !== 'in') return
    for (const tab of ws.tabs) {
      if (tab.kind === 'tool' || titleSettled.current.has(tab.key)) continue
      titleSettled.current.add(tab.key)
      const { key, id } = tab
      const retryLater = () => { titleSettled.current.delete(key) }
      if (tab.kind === 'case') {
        void list('cases', { select: 'id,case_number', eq: { id }, limit: 1 })
          .then((rows) => {
            const row = rows[0]
            if (!row) { if (!userOpened.current.has(key)) removeTabs([key]); return }
            if (row.case_number) setTabTitle(key, row.case_number)
          })
          .catch(retryLater)
        continue
      }
      const src = tab.toolId ? RECORD_TITLE_SOURCE[tab.toolId] : undefined
      if (!src) continue
      void list(src.table, { select: `id,${src.column}`, eq: { id }, limit: 1 })
        .then((rows) => {
          const row = rows[0] as Record<string, unknown> | undefined
          if (!row) { removeTabs([key]); return } // not visible under RLS → close silently
          const title = row[src.column]
          if (typeof title === 'string' && title) setTabTitle(key, title)
        })
        .catch(retryLater)
    }
  }, [restored, authState, ws.tabs, removeTabs, setTabTitle])

  /* ── Default tool (the /intelligence and /registries leaves) ──────────── */

  // Once restored, a leaf that names a default tool opens (or focuses) it
  // unless the URL already carries an intent. Keyed on the pathname so the
  // same mounted provider re-applies it when the user navigates from
  // /workspace back to the leaf; the mirror effect below then rewrites the
  // address to /workspace?tool=… exactly as it does for /tools.
  useEffect(() => {
    if (!restored || !defaultTool) return
    const current = new URLSearchParams(window.location.search)
    if (current.get('case') || current.get('tool')) return
    const t = window.setTimeout(() => openTool(defaultTool), 0)
    return () => window.clearTimeout(t)
  }, [restored, defaultTool, pathname, openTool])

  /* ── URL sync (query string → tabs; active tab → query string) ────────── */

  useEffect(() => {
    if (!restored) return
    const qs = sp.toString()
    if (qs === selfWrite.current) return
    if (!sp.get('case') && !sp.get('tool')) return
    const t = window.setTimeout(() => applyIntent(new URLSearchParams(qs)), 0)
    return () => window.clearTimeout(t)
  }, [sp, restored, applyIntent])

  const active = M.activeTab(ws)
  useEffect(() => {
    if (!restored) return
    const params = M.mirrorParams(new URLSearchParams(window.location.search), active)
    const qs = params.toString()
    const path = window.location.pathname
    if (path === '/workspace' && qs === window.location.search.replace(/^\?/, '')) return
    selfWrite.current = qs
    const href = qs ? `/workspace?${qs}` : '/workspace'
    // Same route: the native history API keeps useSearchParams in step and
    // avoids the query-only router navigations that revert in some serving
    // environments (CaseDetail's finding). A path change (/tools, /cases)
    // goes through the router so the shell's active tab follows.
    if (path === '/workspace') window.history.replaceState(window.history.state, '', href)
    else router.replace(href, { scroll: false })
  }, [restored, active, router])

  /* ── Scroll restore + dirty-tab unload guard ──────────────────────────── */

  useLayoutEffect(() => {
    if (!restored) return
    const target = active ? active.scroll ?? 0 : dirScroll.current
    const raf = requestAnimationFrame(() => window.scrollTo(0, target))
    return () => cancelAnimationFrame(raf)
  }, [restored, ws.activeKey]) // eslint-disable-line react-hooks/exhaustive-deps -- re-run on tab switch only

  const dirty = M.anyDirty(ws)
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  /* ── Cap prompt ───────────────────────────────────────────────────────── */

  const resolveCap = useCallback((closeKey: string) => {
    if (!cap) return
    const { caseId, section, title } = cap
    setCap(null)
    removeTabs([closeKey])
    // The removal is queued in the same batch, so the open sees the freed slot.
    openCase(caseId, section, { title })
  }, [cap, removeTabs, openCase])

  /* ── Value ────────────────────────────────────────────────────────────── */

  const value = useMemo<Workspace>(() => ({
    tabs: ws.tabs, activeKey: ws.activeKey, restored,
    openTool, openRecord, openHref, openCase,
    closeTab, closeOthers, closeAll, closeCase,
    activate, reorder, setTabTitle, setCaseSection, registerDirty, backToDirectory,
  }), [ws.tabs, ws.activeKey, restored, openTool, openRecord, openHref, openCase, closeTab, closeOthers,
       closeAll, closeCase, activate, reorder, setTabTitle, setCaseSection, registerDirty, backToDirectory])

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      {cap && (
        <CaseCapPrompt
          tabs={M.caseTabs(ws)}
          onPick={resolveCap}
          onCancel={() => setCap(null)}
        />
      )}
    </WorkspaceContext.Provider>
  )
}

/* ── Hooks for hosted views ───────────────────────────────────────────────── */

/** Mark the hosting tab dirty while a draft flush is pending (userDrafts
 *  status 'saving' = local mirror written, server upsert not landed yet).
 *  No-op outside the workspace. Call once per draft key in the section. */
export function useTabDirty(draftKey: string): void {
  const ws = useWorkspace()
  const tabKey = useTabKey()
  const { status } = useDraftState(draftKey)
  const pendingFlush = !!draftKey && status === 'saving'
  const register = ws?.registerDirty
  useEffect(() => {
    if (!register || !tabKey || !draftKey) return
    register(tabKey, pendingFlush, `draft:${draftKey}`)
    return () => { register(tabKey, false, `draft:${draftKey}`) }
  }, [register, tabKey, draftKey, pendingFlush])
}
