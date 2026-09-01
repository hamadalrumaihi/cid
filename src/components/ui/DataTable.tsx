'use client'

/** Generic data-table engine: column sort, cross-column text filter,
 *  pagination, and CSV export. Views describe columns declaratively —
 *  `value()` feeds sort/filter/CSV, `render()` (optional) the cell display —
 *  so behavior stays identical everywhere the table is used.
 *
 *  CSV cells are formula-injection-guarded: values starting with = + - @
 *  are prefixed with a quote so exported logs can't execute when opened in
 *  a spreadsheet.
 *
 *  Opt-ins (all additive — the defaults render exactly the old table):
 *   - `selection` — a leading checkbox column with select-all-on-page and
 *     shift-click range select; selection state lives in the caller.
 *   - `pageSizeOptions` — a rows-per-page select next to the filter.
 *   - `mobileCard` — below `sm` the current page renders as a card list
 *     (filter/sort/pagination still apply) instead of a table that would
 *     only x-scroll. Uses lib/useNarrow (matchMedia, not CSS hiding).
 *     Without a mobileCard a generic label/value card is derived from the
 *     first few columns, so no table ever x-scrolls on a phone.
 *   - rows with `onRowClick` are keyboard-activatable (tabIndex 0 +
 *     Enter/Space); the global [tabindex]:focus-visible ring applies. */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { downloadTextFile } from '@/lib/format'
import { toast } from '@/lib/toast'
import { useNarrow } from '@/lib/useNarrow'

export interface DataColumn<T> {
  key: string
  label: string
  /** Plain-text value — used for sorting, filtering and CSV export. */
  value: (row: T) => string
  /** Optional richer cell; defaults to the plain value. */
  render?: (row: T) => ReactNode
  /** Optional dedicated sort key (e.g. an ISO date behind a pretty label). */
  sortValue?: (row: T) => string | number
  className?: string
}

/** Caller-owned multi-select state for the leading checkbox column. */
export interface DataTableSelection<T> {
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
  /** Header checkbox: toggle every (selectable) id on the current page. */
  onToggleAll: (ids: string[]) => void
  idOf: (row: T) => string
  /** Rows the viewer may not select (checkbox renders disabled). */
  disabled?: (row: T) => boolean
}

/** Exported for unit tests — the CSV formula-injection guard. */
export const csvCell = (raw: string): string => {
  let v = raw
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`
  return v
}

export function DataTable<T>({ columns, rows, rowKey, pageSize = 50, pageSizeOptions, initialSort, filterPlaceholder = 'Filter…', csvName, emptyText = 'No entries.', countLabel, searchText, dense = false, onRowClick, selection, mobileCard }: {
  columns: DataColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  pageSize?: number
  /** Offer a rows-per-page select (e.g. [25, 50, 100]). `pageSize` stays the
   *  initial value; omitting this keeps the fixed page size. */
  pageSizeOptions?: number[]
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  filterPlaceholder?: string
  /** Filename (without extension) enabling the ⬇ CSV button. */
  csvName?: string
  emptyText?: string
  /** Noun for the count line, e.g. "entries". */
  countLabel?: string
  /** Extra per-row text the filter matches beyond the visible columns. */
  searchText?: (row: T) => string
  /** Tighter rows (py-1.5) for registry-density tables. Additive — default
   *  geometry is unchanged. */
  dense?: boolean
  /** Whole-row activation (master-detail navigation). Rows become keyboard-
   *  focusable (Enter/Space activate) — keep a real link or button in one
   *  column too, as the semantic path. */
  onRowClick?: (row: T) => void
  /** Leading checkbox column — see DataTableSelection. */
  selection?: DataTableSelection<T>
  /** Below `sm`, render the current page as these cards instead of a table. */
  mobileCard?: (row: T) => ReactNode
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(initialSort ?? { key: columns[0]?.key ?? '', dir: 'asc' as 'asc' | 'desc' })
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(pageSize)
  const narrow = useNarrow()
  // Shift-click range anchor: the last checkbox the user clicked, remembered
  // with its page so a stale anchor never ranges across a page flip.
  const lastPicked = useRef<{ page: number; idx: number } | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = !q
      ? rows
      : rows.filter((r) =>
          columns.some((c) => c.value(r).toLowerCase().includes(q)) ||
          (searchText ? searchText(r).toLowerCase().includes(q) : false))
    const col = columns.find((c) => c.key === sort.key)
    if (!col) return base
    const sv = col.sortValue ?? col.value
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...base].sort((a, b) => {
      const va = sv(a)
      const vb = sv(b)
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir
    })
  }, [rows, columns, query, sort, searchText])

  const pages = Math.max(1, Math.ceil(filtered.length / size))
  const p = Math.min(page, pages - 1)
  const slice = filtered.slice(p * size, (p + 1) * size)

  // Current-page selectable ids (for select-all + the header checkbox state).
  const pageIds = selection
    ? slice.filter((r) => !selection.disabled?.(r)).map((r) => selection.idOf(r))
    : []
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selection!.selected.has(id))
  const somePageSelected = pageIds.some((id) => selection!.selected.has(id))

  const pickRow = (row: T, idx: number, shift: boolean) => {
    const sel = selection!
    const id = sel.idOf(row)
    const target = !sel.selected.has(id)
    const anchor = lastPicked.current
    if (shift && anchor && anchor.page === p && anchor.idx !== idx) {
      const [a, b] = anchor.idx < idx ? [anchor.idx, idx] : [idx, anchor.idx]
      for (const r of slice.slice(a, b + 1)) {
        if (sel.disabled?.(r)) continue
        const rid = sel.idOf(r)
        if (sel.selected.has(rid) !== target) sel.onToggle(rid)
      }
    } else {
      sel.onToggle(id)
    }
    lastPicked.current = { page: p, idx }
  }

  const exportCsv = () => {
    if (!csvName) return
    const head = columns.map((c) => csvCell(c.label)).join(',')
    const body = filtered.map((r) => columns.map((c) => csvCell(c.value(r))).join(','))
    downloadTextFile(`${csvName}.csv`, [head, ...body].join('\n'), 'text/csv')
    toast(`Exported ${filtered.length} row${filtered.length === 1 ? '' : 's'}`, 'success')
  }

  const cellPad = dense ? 'py-1.5' : 'py-2'
  // Below `sm` every table renders as cards: the caller's mobileCard when
  // provided, else a generic label/value card built from the first columns —
  // never a table that only x-scrolls on a phone.
  const asCards = narrow

  /** Generic narrow card — first column as the title (its render() kept),
   *  the next up-to-3 columns as label: value pairs. Selection and row
   *  activation carry over so the phone view loses no behavior. */
  const genericCard = (r: T, idx: number) => {
    const [head, ...rest] = columns
    const meta = rest.slice(0, 3)
    const clickable = !!onRowClick
    return (
      <div
        onClick={clickable ? () => onRowClick!(r) : undefined}
        tabIndex={clickable ? 0 : undefined}
        role={clickable ? 'button' : undefined}
        onKeyDown={clickable ? (e) => {
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick!(r) }
        } : undefined}
        className={`flex items-start gap-3 rounded-lg border border-white/5 bg-ink-900/60 p-3 ${clickable ? 'cursor-pointer transition hover:border-white/10' : ''}`}
      >
        {selection && (
          <input
            type="checkbox"
            aria-label={`Select row ${head ? head.value(r) : selection.idOf(r)}`}
            checked={selection.selected.has(selection.idOf(r))}
            disabled={selection.disabled?.(r) ?? false}
            onClick={(e) => { e.stopPropagation(); pickRow(r, idx, e.shiftKey) }}
            onChange={() => { /* handled in onClick for shift-range support */ }}
            className="mt-1"
          />
        )}
        <div className="min-w-0 flex-1">
          {head && <div className="text-sm font-semibold text-white">{head.render ? head.render(r) : head.value(r)}</div>}
          {meta.length > 0 && (
            <dl className="mt-1.5 space-y-1">
              {meta.map((c) => (
                <div key={c.key} className="flex items-baseline gap-2 text-xs">
                  <dt className="flex-shrink-0 font-semibold uppercase tracking-wider text-slate-400">{c.label}</dt>
                  <dd className="min-w-0 text-slate-200">{c.render ? c.render(r) : c.value(r)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-400">
          {rows.length} {countLabel ?? 'rows'}{query.trim() && ` · ${filtered.length} match${filtered.length === 1 ? '' : 'es'}`}
        </span>
        <div className="flex items-center gap-2">
          {pageSizeOptions && pageSizeOptions.length > 0 && (
            <select
              value={size}
              onChange={(e) => { setSize(Number(e.target.value)); setPage(0) }}
              aria-label="Rows per page"
              className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-white outline-none focus:border-badge-500"
            >
              {pageSizeOptions.map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
          )}
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0) }}
            placeholder={filterPlaceholder}
            aria-label={filterPlaceholder}
            className="w-60 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 text-xs text-white outline-none focus:border-badge-500"
          />
          {csvName && filtered.length > 0 && (
            <button onClick={exportCsv} title="Export the filtered rows as CSV" className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10">
              ⬇ CSV
            </button>
          )}
        </div>
      </div>

      {!slice.length ? (
        <div className="rounded-lg border border-white/5 bg-ink-900 p-6 text-center text-sm text-slate-400">
          {rows.length ? 'No rows match your filter — try a broader search.' : emptyText}
        </div>
      ) : asCards ? (
        /* Narrow fallback: the SAME page slice as cards — an honest stack
         * instead of a table that only x-scrolls (see lib/useNarrow). */
        <ul className="space-y-2">
          {slice.map((r, idx) => <li key={rowKey(r)}>{mobileCard ? mobileCard(r) : genericCard(r, idx)}</li>)}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {/* Sticky header — opaque ink so rows never show through. */}
            <thead className="sticky top-0 z-[1] bg-ink-900">
              <tr className="border-b border-white/10">
                {selection && (
                  <th className={`w-8 px-3 ${cellPad}`}>
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      checked={allPageSelected}
                      ref={(el) => { if (el) el.indeterminate = !allPageSelected && somePageSelected }}
                      disabled={pageIds.length === 0}
                      onChange={() => { selection.onToggleAll(pageIds); lastPicked.current = null }}
                    />
                  </th>
                )}
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={`cursor-pointer select-none px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-white ${cellPad}`}
                    onClick={() => { setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' })); setPage(0) }}
                    aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {c.label}{sort.key === c.key && (sort.dir === 'asc' ? ' ▲' : ' ▼')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {slice.map((r, idx) => (
                <tr
                  key={rowKey(r)}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? (e) => {
                    if (e.target !== e.currentTarget) return // let cell controls keep their keys
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(r) }
                  } : undefined}
                  className={onRowClick ? 'cursor-pointer transition hover:bg-white/5 focus-visible:bg-white/5' : undefined}
                >
                  {selection && (
                    <td className={`w-8 px-3 ${cellPad}`}>
                      <input
                        type="checkbox"
                        aria-label={`Select row ${columns[0] ? columns[0].value(r) : selection.idOf(r)}`}
                        checked={selection.selected.has(selection.idOf(r))}
                        disabled={selection.disabled?.(r) ?? false}
                        onClick={(e) => { e.stopPropagation(); pickRow(r, idx, e.shiftKey) }}
                        onChange={() => { /* handled in onClick for shift-range support */ }}
                      />
                    </td>
                  )}
                  {columns.map((c) => (
                    <td key={c.key} className={c.className ?? `px-3 text-sm text-slate-200 ${cellPad}`}>
                      {c.render ? c.render(r) : c.value(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && slice.length > 0 && (
        <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
          <button onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 disabled:opacity-40">← Prev</button>
          <span>Page {p + 1} / {pages}</span>
          <button onClick={() => setPage(Math.min(pages - 1, p + 1))} disabled={p >= pages - 1} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 disabled:opacity-40">Next →</button>
        </div>
      )}
    </div>
  )
}
