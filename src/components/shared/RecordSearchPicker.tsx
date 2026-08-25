'use client'

/** Bounded, debounced, server-backed record picker — the replacement for the
 *  load-the-whole-registry pickers flagged in the DOJ audit. The caller
 *  supplies the loader (an RLS-scoped `list()` with ilikeAny + limit ~20), so
 *  this component can never widen anyone's access; an empty query should
 *  return the most recent records so the picker is useful before typing.
 *
 *  A selected record collapses to a summary row with a Change control; the
 *  open state is a real combobox (useListboxNav: aria-activedescendant, arrow
 *  keys, Enter, Escape/outside-click close — never clearing the typed query)
 *  with an aria-live match count and ≥44px rows. `search` is read through a
 *  ref (the useRegistry loadRef idiom) so inline closures are safe.
 *
 *  Everything beyond the original contract is opt-in and default-off:
 *  thumbnails (getThumb → RecordThumb), custom row bodies (renderRow),
 *  per-row disable with a reason badge (getDisabled), a quick-preview button
 *  (peekType), a create-new action row (onCreateNew), a free-text fallback
 *  link (allowFreeText — never a default), a minimum query length (minChars),
 *  and multi-select chips (multiple + values/onChangeMany). */
import { useEffect, useMemo, useRef, useState } from 'react'
import { humanizeError } from '@/lib/toast'
import { CheckIcon, PlusIcon } from '@/components/shell/icons'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { RecordThumb } from '@/components/ui/RecordThumb'
import { Skeleton } from '@/components/ui/Skeleton'
import { RecordPeekButton } from './RecordPeekButton'
import { useListboxNav } from './useListboxNav'

export interface PickedRecord {
  id: string
  label: string
  sublabel?: string
}

/** Loosely coupled to whatever record types the peek modal supports. */
type PeekType = React.ComponentProps<typeof RecordPeekButton>['type']

interface BaseProps<T extends PickedRecord> {
  label: string
  required?: boolean
  hint?: string
  placeholder?: string
  /** RLS-scoped bounded loader. '' should return the most recent ~20 rows.
   *  Read through a ref — an inline closure will NOT re-fire the search. */
  search: (q: string) => Promise<T[]>
  disabled?: boolean
  /** Custom node shown when a non-empty query returns no matches (e.g. a
   *  "create the record first" call to action). Falls back to a plain hint. */
  emptyState?: React.ReactNode
  /** Seed the search box (e.g. a legacy address being migrated). Applied on
   *  mount only — typing still owns the field afterwards. */
  initialQuery?: string
  /** Custom row body (replaces the label/sublabel layout; the thumb, disabled
   *  badge and peek button still render around it). */
  renderRow?: (item: T) => React.ReactNode
  /** Per-row thumbnail URL — renders a RecordThumb (initials fallback). */
  getThumb?: (item: T) => string | null | undefined
  /** Return a short reason to render the row disabled (visible, badged, not
   *  selectable, skipped by the keyboard); null/undefined → selectable. */
  getDisabled?: (item: T) => string | null
  /** Renders a quick-preview (peek) button on each row — never selects. */
  peekType?: PeekType
  /** Adds a final "Create new…" action row once the query has ≥2 chars. */
  onCreateNew?: (query: string) => void
  /** Label for the create-new row (defaults to `Create new: "<query>"`). */
  createLabel?: (query: string) => string
  /** SIB-style escape hatch: a fallback link under the list that commits the
   *  typed text instead of a registry record. Never a default — picking a row
   *  or pressing Enter always prefers real records. */
  allowFreeText?: { label: string; onPick: (text: string) => void }
  /** Minimum query length before searching (default 0 — '' lists recent).
   *  Below the threshold a hint renders instead of firing the loader. */
  minChars?: number
}

interface SingleProps<T extends PickedRecord> {
  multiple?: false
  value: T | null
  onChange: (v: T | null) => void
  values?: never
  onChangeMany?: never
}

interface MultiProps<T extends PickedRecord> {
  /** Multi-select: chips + per-chip remove, list stays open after each pick,
   *  already-picked rows check-marked and disabled. */
  multiple: true
  values: T[]
  onChangeMany: (v: T[]) => void
  value?: never
  onChange?: never
}

export function RecordSearchPicker<T extends PickedRecord>({
  label, required, hint, placeholder, value, onChange, search, disabled, emptyState, initialQuery,
  renderRow, getThumb, getDisabled, peekType, onCreateNew, createLabel, allowFreeText,
  minChars = 0, multiple, values, onChangeMany,
}: BaseProps<T> & (SingleProps<T> | MultiProps<T>)) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [results, setResults] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [retryTick, setRetryTick] = useState(0)
  const seq = useRef(0)
  const boxRef = useRef<HTMLDivElement>(null)

  // Inline-closure-safe loader (the useRegistry loadRef idiom): the effect
  // below never re-fires just because a caller re-rendered.
  const searchRef = useRef(search)
  useEffect(() => { searchRef.current = search })

  const trimmed = query.trim()
  const belowMin = trimmed.length < minChars
  const pickedIds = useMemo(() => new Set((values ?? []).map((v) => v.id)), [values])

  const visible = belowMin ? [] : results
  const showCreate = !!onCreateNew && !belowMin && trimmed.length >= 2
  const count = visible.length + (showCreate ? 1 : 0)

  const rowDisabled = (i: number): boolean => {
    if (i >= visible.length) return false // the create-new action row
    const r = visible[i]
    if (multiple && pickedIds.has(r.id)) return true
    return getDisabled ? getDisabled(r) != null : false
  }

  const pick = (r: T) => {
    if (multiple) {
      if (!pickedIds.has(r.id)) onChangeMany?.([...(values ?? []), r])
      // Multi-select keeps the list open for the next pick.
    } else {
      onChange?.(r)
      setOpen(false)
    }
  }

  const activate = (i: number) => {
    if (showCreate && i === visible.length) { setOpen(false); onCreateNew?.(trimmed); return }
    const r = visible[i]
    if (r && !rowDisabled(i)) pick(r)
  }

  const nav = useListboxNav({ count, open, onActivate: activate, onEscape: () => setOpen(false), isDisabled: rowDisabled })
  const { setSel } = nav

  // Debounced loader — sequence-guarded so a slow early response can never
  // clobber a newer one. Nothing loads until the field is focused. A failed
  // search keeps the typed query AND the stale rows; Retry re-runs it.
  useEffect(() => {
    if (!open || belowMin) return
    const mine = ++seq.current
    const t = setTimeout(() => {
      setLoading(true)
      searchRef.current(query)
        .then((rows) => { if (seq.current === mine) { setResults(rows); setError(null); setLoading(false); setSel(0) } })
        .catch((e: unknown) => { if (seq.current === mine) { setError(e); setLoading(false) } })
    }, 250)
    return () => clearTimeout(t)
  }, [query, open, belowMin, retryTick, setSel])

  // Outside click closes the list without touching the typed query. A stacked
  // overlay above the picker (the RecordPeek modal) doesn't count as outside.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof Node) || !boxRef.current || boxRef.current.contains(t)) return
      const overlay = t instanceof Element ? t.closest('.modal-backdrop') : null
      if (overlay && !overlay.contains(boxRef.current)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // Reopen a closed list from the keyboard (Escape closed it, focus stayed).
  const onKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); return }
    nav.onKeyDown(e)
  }

  const thumb = (r: T) => getThumb && <RecordThumb url={getThumb(r)} label={r.label} />
  const rowBody = (r: T) => renderRow ? renderRow(r) : (
    <>
      <span className="min-w-0 flex-1 truncate">{r.label}</span>
      {r.sublabel && <span className="flex-shrink-0 text-xs text-slate-400">{r.sublabel}</span>}
    </>
  )
  const peek = (r: T) => peekType && (
    // Peeking must never select the row (the modal's clicks bubble here too).
    <span className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
      <RecordPeekButton type={peekType} id={r.id} label={r.label} />
    </span>
  )

  return (
    <Field label={label} required={required} hint={hint}>
      {(id) => !multiple && value ? (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5">
          {getThumb && <RecordThumb url={getThumb(value)} label={value.label} />}
          <span className="min-w-0 flex-1 truncate text-sm text-white">
            {value.label}
            {value.sublabel && <span className="text-slate-400"> — {value.sublabel}</span>}
          </span>
          {peekType && <RecordPeekButton type={peekType} id={value.id} label={value.label} />}
          <Button id={id} size="sm" disabled={disabled} onClick={() => { onChange?.(null); setOpen(true) }}>
            Change
          </Button>
        </div>
      ) : (
        <div ref={boxRef} className="space-y-1.5">
          {multiple && (values?.length ?? 0) > 0 && (
            <ul aria-label={`Selected: ${label}`} className="flex flex-wrap gap-1.5">
              {values!.map((v) => (
                <li key={v.id} className="flex min-h-11 max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/5 pl-3 text-sm text-slate-200">
                  <span className="min-w-0 truncate">{v.label}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${v.label}`}
                    disabled={disabled}
                    onClick={() => onChangeMany?.(values!.filter((x) => x.id !== v.id))}
                    className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-full text-lg leading-none text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-60"
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Input
            id={id}
            value={query}
            disabled={disabled}
            autoComplete="off"
            placeholder={placeholder ?? 'Type to search…'}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            {...nav.inputProps}
            onKeyDown={onKeyDown}
          />
          {open && (
            <>
              <p className="sr-only" aria-live="polite">
                {loading ? 'Searching…' : error != null ? 'Search failed.' : `${visible.length} matches`}
              </p>
              <div className="max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-ink-900/80">
                {/* preventDefault keeps DOM focus in the input across row
                    clicks (multi-select stays typeable); clicks still fire.
                    On the <ul> only — the scroll container keeps its default
                    so the scrollbar thumb stays draggable. */}
                <ul {...nav.listProps} aria-label={`${label} suggestions`} onMouseDown={(e) => e.preventDefault()}>
                  {visible.map((r, i) => {
                    const reason = getDisabled?.(r) ?? null
                    const already = !!multiple && pickedIds.has(r.id)
                    const inert = already || reason != null
                    return (
                      <li
                        key={r.id}
                        id={nav.optId(i)}
                        data-i={i}
                        role="option"
                        aria-selected={i === nav.sel}
                        aria-disabled={inert || undefined}
                        onClick={inert ? undefined : () => pick(r)}
                        onMouseEnter={inert ? undefined : () => setSel(i)}
                        className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                          inert ? 'opacity-60' : 'cursor-pointer'
                        } ${i === nav.sel && !inert ? 'bg-white/10 text-white' : 'text-slate-200'} ${inert ? '' : 'hover:bg-white/5'}`}
                      >
                        {thumb(r)}
                        {rowBody(r)}
                        {already && (
                          <span className="flex-shrink-0 text-emerald-300">
                            <CheckIcon size={14} />
                            <span className="sr-only">Already selected</span>
                          </span>
                        )}
                        {reason && <Badge tone="warn" className="flex-shrink-0">{reason}</Badge>}
                        {peek(r)}
                      </li>
                    )
                  })}
                  {showCreate && (
                    <li
                      id={nav.optId(visible.length)}
                      data-i={visible.length}
                      role="option"
                      aria-selected={nav.sel === visible.length}
                      onClick={() => activate(visible.length)}
                      onMouseEnter={() => setSel(visible.length)}
                      className={`flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold text-blue-300 transition ${
                        visible.length > 0 ? 'border-t border-white/10' : ''
                      } ${nav.sel === visible.length ? 'bg-blue-500/15' : 'hover:bg-white/5'}`}
                    >
                      <PlusIcon size={14} />
                      <span className="min-w-0 truncate">
                        {createLabel ? createLabel(trimmed) : <>Create new: &ldquo;{trimmed}&rdquo;</>}
                      </span>
                    </li>
                  )}
                </ul>
                {belowMin && (
                  <p className="px-3 py-2 text-xs text-slate-400">
                    Type at least {minChars} character{minChars === 1 ? '' : 's'} to search.
                  </p>
                )}
                {loading && visible.length === 0 && !belowMin && (
                  <div aria-hidden className="space-y-1 px-3 py-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="flex min-h-9 items-center gap-2">
                        {getThumb && <Skeleton className="h-8 w-8" />}
                        <Skeleton className="h-3 flex-1" />
                        <Skeleton className="h-3 w-12" />
                      </div>
                    ))}
                  </div>
                )}
                {error != null && !loading && (
                  <div className="m-1.5 rounded-md border border-rose-500/20 bg-rose-500/5 p-2.5">
                    <p className="text-xs text-rose-200">{humanizeError(error)}</p>
                    <Button size="sm" className="mt-1.5" onClick={() => setRetryTick((t) => t + 1)}>
                      Try again
                    </Button>
                  </div>
                )}
                {!loading && error == null && !belowMin && visible.length === 0 && !showCreate && (
                  <p className="px-3 py-2 text-xs text-slate-400">
                    {trimmed ? (emptyState ?? 'No matches — refine the search.') : 'No records available.'}
                  </p>
                )}
                {allowFreeText && trimmed && !belowMin && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setOpen(false); allowFreeText.onPick(trimmed) }}
                    className="flex min-h-11 w-full items-center gap-1 border-t border-white/10 px-3 py-2 text-left text-xs font-semibold text-blue-300 transition hover:bg-white/5"
                  >
                    {allowFreeText.label} — &ldquo;{trimmed}&rdquo;
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Field>
  )
}
