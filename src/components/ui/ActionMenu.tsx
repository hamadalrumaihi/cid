'use client'

/** Overflow “⋯” action menu. The repo had no dropdown/menu primitive — every
 *  overflow was an inline button row — so uncommon or destructive actions had
 *  to sit beside primary ones. This is a small, self-contained popover:
 *  `aria-haspopup`/`role="menu"`, click-outside + Esc to close, arrow/Home/End
 *  keyboard navigation, and a visually separated `danger` group so a Delete is
 *  never a mis-click away from a routine action.
 *
 *  Positioned relative to its trigger; the caller places it in a flex row. */
import { useCallback, useEffect, useId, useRef, useState } from 'react'

export interface ActionItem {
  label: string
  onClick: () => void
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
  /** Draw a divider above this item (e.g. before a destructive group). */
  separatorBefore?: boolean
}

export function ActionMenu({
  items,
  label = 'More actions',
  align = 'right',
  buttonClassName = '',
}: {
  items: ActionItem[]
  label?: string
  align?: 'left' | 'right'
  buttonClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const close = useCallback((focusTrigger = false) => {
    setOpen(false)
    if (focusTrigger) btnRef.current?.focus()
  }, [])

  // Click-outside + Esc.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, close])

  // On open, focus the first enabled item.
  useEffect(() => {
    if (!open) return
    const first = menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
    first?.focus()
  }, [open])

  const moveFocus = (dir: 1 | -1 | 'first' | 'last') => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])
    if (!nodes.length) return
    const cur = nodes.findIndex((n) => n === document.activeElement)
    const idx =
      dir === 'first' ? 0
      : dir === 'last' ? nodes.length - 1
      : dir === 1 ? (cur + 1) % nodes.length
      : (cur - 1 + nodes.length) % nodes.length
    nodes[idx].focus()
  }

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1) }
    else if (e.key === 'Home') { e.preventDefault(); moveFocus('first') }
    else if (e.key === 'End') { e.preventDefault(); moveFocus('last') }
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex min-h-[36px] items-center justify-center rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-slate-200 transition hover:bg-white/10 ${buttonClassName}`}
      >
        <span aria-hidden className="text-base leading-none">⋯</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          id={menuId}
          aria-label={label}
          onKeyDown={onMenuKey}
          className={`absolute top-full z-30 mt-1 min-w-[12rem] overflow-hidden rounded-xl border border-white/10 bg-ink-850 py-1 shadow-glow ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {items.map((it, i) => (
            <div key={i}>
              {it.separatorBefore && <div role="separator" className="my-1 h-px bg-white/10" />}
              <button
                role="menuitem"
                type="button"
                disabled={it.disabled}
                tabIndex={-1}
                onClick={() => { if (it.disabled) return; close(); it.onClick() }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  it.danger ? 'text-rose-300 hover:bg-rose-500/10' : 'text-slate-200 hover:bg-white/10'
                }`}
              >
                {it.icon && <span aria-hidden className="w-4 flex-shrink-0 text-center">{it.icon}</span>}
                {it.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
