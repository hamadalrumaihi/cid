'use client'

/** Workspace tab strip — sticky under the app header (CaseDetail's tuck-under
 *  pattern). Desktop: Directory home chip + horizontally scrolling tabs
 *  (hidden scrollbar, fade edges, HTML5 drag to reorder, right-click menu).
 *  Small screens: the strip collapses to the active tab + the "Open tabs"
 *  dropdown, which is the primary touch affordance (activate / close / close
 *  all with full-height rows). */
import { useEffect, useRef, useState } from 'react'
import { TAB_LABEL } from '@/lib/nav'
import { CategoryIcon, XMarkIcon } from '@/components/shell/icons'
import { ToolIcon } from './toolIcons'
import type { ToolTab } from './ToolsWorkspaceContext'

export interface ToolTabBarProps {
  tabs: readonly ToolTab[]
  activeKey: string | null
  onActivate: (key: string) => void
  onClose: (key: string) => void
  onCloseOthers: (key: string) => void
  onCloseAll: () => void
  onReorder: (fromIdx: number, toIdx: number) => void
  onDirectory: () => void
}

interface MenuState { key: string; x: number; y: number }

export function ToolTabBar({ tabs, activeKey, onActivate, onClose, onCloseOthers, onCloseAll, onReorder, onDirectory }: ToolTabBarProps) {
  const [listOpen, setListOpen] = useState(false)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const dragFrom = useRef<number | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Any outside click / Escape dismisses the dropdown and the context menu.
  useEffect(() => {
    if (!listOpen && !menu) return
    const onDown = (e: MouseEvent) => {
      if (listRef.current?.contains(e.target as Node)) return
      setListOpen(false)
      setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setListOpen(false); setMenu(null) }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [listOpen, menu])

  const active = tabs.find((t) => t.key === activeKey) ?? null

  // Arrow-key navigation across the strip's tab buttons.
  const onStripKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const buttons = Array.from(stripRef.current?.querySelectorAll<HTMLButtonElement>('[data-tab-activate]') ?? [])
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (idx === -1) return
    e.preventDefault()
    const next = e.key === 'ArrowLeft' ? Math.max(0, idx - 1) : Math.min(buttons.length - 1, idx + 1)
    buttons[next]?.focus()
  }

  const tabChip = (t: ToolTab, i: number) => {
    const on = t.key === activeKey
    return (
      <div
        key={t.key}
        role="presentation"
        draggable
        onDragStart={(e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move' }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={(e) => {
          e.preventDefault()
          if (dragFrom.current !== null && dragFrom.current !== i) onReorder(dragFrom.current, i)
          dragFrom.current = null
        }}
        onDragEnd={() => { dragFrom.current = null }}
        onContextMenu={(e) => { e.preventDefault(); setListOpen(false); setMenu({ key: t.key, x: e.clientX, y: e.clientY }) }}
        className={`group flex h-10 flex-shrink-0 items-center rounded-lg pl-2.5 pr-1 transition ${
          on
            ? 'bg-blue-500/15 text-white shadow-[inset_0_-2px_0_0_rgb(var(--acc-500))]'
            : 'text-slate-400 hover:bg-white/5 hover:text-white'
        }`}
      >
        <button
          data-tab-activate
          role="tab"
          aria-selected={on}
          onClick={() => onActivate(t.key)}
          className="flex h-full min-w-0 items-center gap-2 text-xs font-medium"
        >
          <ToolIcon tool={t.toolId} size={15} className="flex-shrink-0" />
          <span className="max-w-[11rem] truncate">{t.title}</span>
          {t.dirty && <span aria-label="Unsaved changes" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />}
        </button>
        <button
          onClick={() => onClose(t.key)}
          aria-label={`Close ${t.title}`}
          className="ml-1 grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-white"
        >
          <XMarkIcon size={13} />
        </button>
      </div>
    )
  }

  const menuTab = menu ? tabs.find((t) => t.key === menu.key) : null

  return (
    <div className="sticky top-[var(--app-header-h)] z-10 -mx-4 mb-4 border-b border-white/10 bg-ink-950/90 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex items-center gap-1 py-1.5">
        {/* Directory home chip — first, fixed; returns without closing tabs. */}
        <button
          onClick={onDirectory}
          aria-current={activeKey === null ? 'page' : undefined}
          className={`flex h-10 flex-shrink-0 items-center gap-2 rounded-lg px-2.5 text-xs font-semibold transition ${
            activeKey === null
              ? 'bg-blue-500/15 text-white shadow-[inset_0_-2px_0_0_rgb(var(--acc-500))]'
              : 'text-slate-400 hover:bg-white/5 hover:text-white'
          }`}
        >
          <CategoryIcon cat="intel" size={15} />
          Directory
        </button>
        <span aria-hidden className="mx-0.5 h-5 w-px flex-shrink-0 bg-white/10" />

        {/* Desktop strip */}
        <div
          ref={stripRef}
          role="tablist"
          aria-label="Open tools"
          onKeyDown={onStripKeyDown}
          className="scroll-strip hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto sm:flex"
        >
          {tabs.map(tabChip)}
        </div>

        {/* Small screens: just the active tab's identity */}
        <div className="flex min-w-0 flex-1 items-center sm:hidden">
          {active && (
            <span className="flex min-w-0 items-center gap-2 rounded-lg bg-blue-500/15 px-2.5 py-2 text-xs font-medium text-white">
              <ToolIcon tool={active.toolId} size={15} className="flex-shrink-0" />
              <span className="truncate">{active.title}</span>
              {active.dirty && <span aria-label="Unsaved changes" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />}
            </span>
          )}
        </div>

        {/* Open-tabs dropdown — overflow list on desktop, primary selector on mobile. */}
        {tabs.length > 0 && (
          <div ref={listRef} className="relative flex-shrink-0">
            <button
              onClick={() => { setMenu(null); setListOpen((o) => !o) }}
              aria-expanded={listOpen}
              aria-haspopup="menu"
              className="flex h-10 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              Open tabs
              <span className="rounded-full bg-white/10 px-1.5 text-[10px] font-bold text-slate-200">{tabs.length}</span>
            </button>
            {listOpen && (
              <div
                role="menu"
                aria-label="Open tabs"
                className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-2xl border border-white/10 bg-ink-850 p-1.5 shadow-glow"
              >
                <div className="max-h-72 overflow-y-auto">
                  {tabs.map((t) => {
                    const on = t.key === activeKey
                    return (
                      <div key={t.key} className={`flex items-center rounded-lg ${on ? 'bg-blue-500/15' : 'hover:bg-white/5'}`}>
                        <button
                          role="menuitem"
                          onClick={() => { onActivate(t.key); setListOpen(false) }}
                          className={`flex h-11 min-w-0 flex-1 items-center gap-2.5 px-2.5 text-left text-xs font-medium ${on ? 'text-white' : 'text-slate-300'}`}
                        >
                          <ToolIcon tool={t.toolId} size={15} className="flex-shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{t.title}</span>
                          {t.recordId && <span className="flex-shrink-0 text-[10px] uppercase tracking-wider text-slate-500">{TAB_LABEL[t.toolId] ?? t.toolId}</span>}
                          {t.dirty && <span aria-label="Unsaved changes" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />}
                        </button>
                        <button
                          onClick={() => onClose(t.key)}
                          aria-label={`Close ${t.title}`}
                          className="mr-1 grid h-9 w-9 flex-shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-white/10 hover:text-white"
                        >
                          <XMarkIcon size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-1 flex gap-1 border-t border-white/5 pt-1.5">
                  {activeKey && (
                    <button
                      role="menuitem"
                      onClick={() => { onCloseOthers(activeKey); setListOpen(false) }}
                      className="h-10 flex-1 rounded-lg text-xs font-semibold text-slate-300 transition hover:bg-white/5 hover:text-white"
                    >
                      Close others
                    </button>
                  )}
                  <button
                    role="menuitem"
                    onClick={() => { onCloseAll(); setListOpen(false) }}
                    className="h-10 flex-1 rounded-lg text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10"
                  >
                    Close all
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Per-tab context menu (right-click on a tab). */}
      {menu && menuTab && (
        <div
          role="menu"
          aria-label={`${menuTab.title} tab actions`}
          className="fixed z-40 w-44 rounded-xl border border-white/10 bg-ink-850 p-1 shadow-glow"
          style={{ left: Math.min(menu.x, typeof window !== 'undefined' ? window.innerWidth - 192 : menu.x), top: menu.y + 4 }}
        >
          <button role="menuitem" onClick={() => { onClose(menu.key); setMenu(null) }} className="block h-10 w-full rounded-lg px-3 text-left text-xs font-medium text-slate-200 transition hover:bg-white/5">
            Close
          </button>
          <button role="menuitem" onClick={() => { onCloseOthers(menu.key); setMenu(null) }} className="block h-10 w-full rounded-lg px-3 text-left text-xs font-medium text-slate-200 transition hover:bg-white/5">
            Close others
          </button>
          <button role="menuitem" onClick={() => { onCloseAll(); setMenu(null) }} className="block h-10 w-full rounded-lg px-3 text-left text-xs font-medium text-rose-300 transition hover:bg-rose-500/10">
            Close all
          </button>
        </div>
      )}
    </div>
  )
}
