'use client'

/** The library's filter control.
 *
 *  The browse page used to print every category, every audience and every
 *  status as a permanent row of chips — three rows of buttons above the
 *  results, most of which nobody wanted, all of which had to be read before
 *  the first document. Categories alone are twenty.
 *
 *  So the advanced choices live behind ONE control, and the page shows only
 *  what is actually applied. Nothing is removed: a category a reader wants is
 *  still there, one click further in, and the chips above the results mean
 *  they can always see what is narrowing their view.
 *
 *  ── Only what exists ─────────────────────────────────────────────────────
 *  Every group is built from the rows the library returned, not from a
 *  hard-coded list. A category with no documents in it, or an audience this
 *  reader never sees, is not offered — an empty filter is a dead end that
 *  looks like a bug. This also means the control cannot advertise a bureau
 *  dimension the data does not carry.
 *
 *  ── Desktop and phone want different objects ─────────────────────────────
 *  A popover anchored to a button is right on a wide screen and wrong on a
 *  phone, where it would open a 300px panel inside a 390px viewport. Below
 *  `sm` the same content renders as a bottom sheet with a large close target.
 *  One component, one state, two presentations. */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Collapsible } from '@/components/ui/Collapsible'

export interface FilterOption {
  value: string
  label: string
  /** How many documents currently carry it — a reader deserves to know a
   *  choice returns nothing before they spend a click on it. */
  count: number
}

export interface FilterGroup {
  id: string
  label: string
  options: FilterOption[]
  selected: ReadonlySet<string>
  onToggle: (value: string) => void
}

export interface LibraryFiltersProps {
  groups: FilterGroup[]
  /** Total selections across every group — drives the button's badge. */
  activeCount: number
  onClearAll: () => void
}

export function LibraryFilters({ groups, activeCount, onClearAll }: LibraryFiltersProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  /** Close, and put the keyboard back where it came from. A reader who
   *  pressed Escape has not asked to be dropped at the top of the page. */
  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
  }, [])

  // Close on Escape and on a click outside — the two things every reader
  // already expects from a popover, and the two things a hand-rolled one
  // usually forgets.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, close])

  const usable = groups.filter((g) => g.options.length > 0)
  if (!usable.length) return null

  const body = (
    <div className="flex flex-col gap-1">
      {usable.map((g) => (
        <Collapsible
          key={g.id}
          title={g.label}
          hint={g.selected.size ? `${g.selected.size} selected` : undefined}
          // The group a reader has already used opens itself: coming back to
          // change one thing should not start with finding it again.
          defaultOpen={g.selected.size > 0}
        >
          <ul className="flex flex-col gap-0.5">
            {g.options.map((o) => {
              const on = g.selected.has(o.value)
              return (
                <li key={o.value}>
                  <label className="flex min-h-11 cursor-pointer touch-manipulation items-center gap-2.5 rounded px-1.5 text-sm text-slate-200 transition hover:bg-white/5 lg:min-h-8">
                    <input
                      type="checkbox"
                      className="h-4 w-4 flex-shrink-0 accent-badge-500"
                      checked={on}
                      onChange={() => g.onToggle(o.value)}
                    />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    <span className="flex-shrink-0 text-xs tabular-nums text-slate-500">{o.count}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </Collapsible>
      ))}

      {activeCount > 0 && (
        <div className="mt-1 border-t border-white/5 pt-2">
          <Button variant="ghost" size="sm" onClick={onClearAll}>Clear all filters</Button>
        </div>
      )}
    </div>
  )

  return (
    <div ref={wrapRef} className="relative">
      <Button
        ref={triggerRef}
        variant={activeCount > 0 ? 'primary' : undefined}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        Filters
        {activeCount > 0 && (
          <span className="ml-1.5 rounded bg-white/20 px-1.5 text-[11px] font-bold tabular-nums">
            {activeCount}
          </span>
        )}
      </Button>

      {open && (
        <>
          {/* Phone: a bottom sheet. The backdrop is part of the sheet, not the
              popover — on a wide screen a full-screen scrim to change a filter
              would be heavier than the task. */}
          <div
            className="fixed inset-0 z-40 bg-black/50 sm:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            id={panelId}
            role="group"
            aria-label="Filters"
            className={
              'fixed inset-x-0 bottom-0 z-50 max-h-[75vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-white/10 bg-ink-850 p-4 ' +
              // Above the bottom nav (z-30) and clear of the home indicator.
              'pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4 ' +
              'sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:z-30 sm:mt-2 sm:max-h-[70vh] sm:w-80 ' +
              'sm:rounded-lg sm:border sm:shadow-xl'
            }
          >
            <div className="mb-2 flex items-center justify-between sm:hidden">
              <p className="text-sm font-semibold text-white">Filters</p>
              <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={close}>Done</Button>
            </div>
            {body}
          </div>
        </>
      )}
    </div>
  )
}

/** The applied filters, as removable chips above the results.
 *
 *  This is the other half of hiding the options: a reader must never wonder
 *  why the library looks empty. Every active narrowing is visible and every
 *  one of them can be undone where it is shown, without reopening the panel. */
export function ActiveFilterChips({ chips, onClear }: {
  chips: ReadonlyArray<{ key: string; label: string; onRemove: () => void }>
  onClear: () => void
}) {
  if (!chips.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={c.onRemove}
          className="inline-flex min-h-11 touch-manipulation items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 text-xs font-semibold text-slate-200 transition hover:border-white/20 hover:text-white lg:min-h-8"
        >
          {c.label}
          <span aria-hidden className="text-slate-400">×</span>
          <span className="sr-only">Remove filter</span>
        </button>
      ))}
      <Button variant="ghost" size="sm" onClick={onClear}>Clear filters</Button>
    </div>
  )
}
