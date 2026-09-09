'use client'

/** Snooze / Dismiss popover for one queue row or the bulk bar (Phase 7,
 *  P7-01 / AC1). Lists the SNOOZE_PRESETS (≤ 48 h — the server refuses more)
 *  and, when the caller passes `dismiss`, a Dismiss entry that is DISABLED
 *  with an explanation for decision / work keys — the same rule
 *  `action_item_set_state` enforces, mirrored so nobody clicks into a P0403.
 *
 *  Own popover rather than ui/ActionMenu because the trigger is a labelled
 *  text button ("Snooze") — ActionMenu renders the "⋯" glyph only. Same
 *  a11y contract: aria-haspopup / role="menu", click-outside + Esc, arrow /
 *  Home / End navigation, first item focused on open. */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { SNOOZE_PRESETS, NOT_DISMISSABLE_TEXT, snoozeUntilNow, type SnoozePreset } from '@/lib/actionState'

export interface SnoozeMenuProps {
  /** Snooze chosen — `until` is ISO, already capped at 48 h. */
  onSnooze: (until: string, preset: SnoozePreset) => void | Promise<unknown>
  /** Dismiss entry: omit for none; `allowed: false` renders the disabled
   *  explanation instead of a live item. */
  dismiss?: { allowed: boolean; label?: string; onDismiss: () => void | Promise<unknown> } | null
  /** Trigger text. */
  label?: string
  /** Accessible name when the label alone is ambiguous ("Snooze <title>"). */
  ariaLabel?: string
  align?: 'left' | 'right'
  className?: string
  disabled?: boolean
}

const ITEM = 'flex w-full min-h-[40px] items-center gap-2 px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-60'

export function SnoozeMenu({ onSnooze, dismiss = null, label = 'Snooze', ariaLabel, align = 'right', className = '', disabled }: SnoozeMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const close = useCallback((focusTrigger = false) => {
    setOpen(false)
    if (focusTrigger) btnRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(true) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, close])

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')?.focus()
  }, [open])

  const moveFocus = (dir: 1 | -1 | 'first' | 'last') => {
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])
    if (!nodes.length) return
    const cur = nodes.findIndex((n) => n === document.activeElement)
    const idx = dir === 'first' ? 0 : dir === 'last' ? nodes.length - 1 : dir === 1 ? (cur + 1) % nodes.length : (cur - 1 + nodes.length) % nodes.length
    nodes[idx].focus()
  }
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1) }
    else if (e.key === 'Home') { e.preventDefault(); moveFocus('first') }
    else if (e.key === 'End') { e.preventDefault(); moveFocus('last') }
  }

  const pick = (p: SnoozePreset) => {
    close()
    // Event-time clock (never render-time): the cap is relative to the click.
    void onSnooze(snoozeUntilNow(p), p)
  }

  return (
    <div ref={rootRef} className={`relative inline-block ${className}`}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-9"
      >
        {label}
        <span aria-hidden className="text-[10px] text-slate-400">▾</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          id={menuId}
          aria-label={ariaLabel ?? label}
          onKeyDown={onMenuKey}
          className={`absolute top-full z-30 mt-1 min-w-[14rem] overflow-hidden rounded-lg border border-white/10 bg-ink-850 py-1 shadow-xl shadow-black/40 ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Snooze for</p>
          {SNOOZE_PRESETS.map((p) => (
            <button key={p.id} role="menuitem" type="button" tabIndex={-1} onClick={() => pick(p)} className={`${ITEM} text-slate-200 hover:bg-white/10`}>
              {p.label}
            </button>
          ))}
          {dismiss && (
            <>
              <div role="separator" className="my-1 h-px bg-white/10" />
              {dismiss.allowed ? (
                <button
                  role="menuitem"
                  type="button"
                  tabIndex={-1}
                  onClick={() => { close(); void dismiss.onDismiss() }}
                  className={`${ITEM} text-rose-300 hover:bg-rose-500/10`}
                >
                  {dismiss.label ?? 'Dismiss'}
                </button>
              ) : (
                <button role="menuitem" type="button" tabIndex={-1} disabled className={`${ITEM} whitespace-normal text-slate-300`}>
                  <span>
                    <span className="block font-medium">Dismiss</span>
                    <span className="block text-xs text-slate-400">{NOT_DISMISSABLE_TEXT}</span>
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
