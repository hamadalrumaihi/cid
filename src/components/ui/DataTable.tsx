'use client'

/** Generic data-table engine: column sort, cross-column text filter,
 *  pagination, and CSV export. Views describe columns declaratively —
 *  `value()` feeds sort/filter/CSV, `render()` (optional) the cell display —
 *  so behavior stays identical everywhere the table is used.
 *
 *  CSV cells are formula-injection-guarded: values starting with = + - @
 *  are prefixed with a quote so exported logs can't execute when opened in
 *  a spreadsheet. */
import { useMemo, useState, type ReactNode } from 'react'
import { downloadTextFile } from '@/lib/format'
import { toast } from '@/lib/toast'

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

/** Exported for unit tests — the CSV formula-injection guard. */
export const csvCell = (raw: string): string => {
  let v = raw
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`
  return v
}

export function DataTable<T>({ columns, rows, rowKey, pageSize = 50, initialSort, filterPlaceholder = 'Filter…', csvName, emptyText = 'No entries.', countLabel, searchText }: {
  columns: DataColumn<T>[]
  rows: T[]
  rowKey: (row: T) => string
  pageSize?: number
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  filterPlaceholder?: string
  /** Filename (without extension) enabling the ⬇ CSV button. */
  csvName?: string
  emptyText?: string
  /** Noun for the count line, e.g. "entries". */
  countLabel?: string
  /** Extra per-row text the filter matches beyond the visible columns. */
  searchText?: (row: T) => string
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState(initialSort ?? { key: columns[0]?.key ?? '', dir: 'asc' as 'asc' | 'desc' })
  const [page, setPage] = useState(0)

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

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const p = Math.min(page, pages - 1)
  const slice = filtered.slice(p * pageSize, (p + 1) * pageSize)

  const exportCsv = () => {
    if (!csvName) return
    const head = columns.map((c) => csvCell(c.label)).join(',')
    const body = filtered.map((r) => columns.map((c) => csvCell(c.value(r))).join(','))
    downloadTextFile(`${csvName}.csv`, [head, ...body].join('\n'), 'text/csv')
    toast(`Exported ${filtered.length} row${filtered.length === 1 ? '' : 's'}`, 'success')
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-400">
          {rows.length} {countLabel ?? 'rows'}{query.trim() && ` · ${filtered.length} match${filtered.length === 1 ? '' : 'es'}`}
        </span>
        <div className="flex items-center gap-2">
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
        <div className="rounded-xl border border-white/5 bg-ink-900 p-6 text-center text-sm text-slate-400">
          {rows.length ? 'No rows match your filter — try a broader search.' : emptyText}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  {columns.map((c) => (
                    <th
                      key={c.key}
                      className="cursor-pointer select-none px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 hover:text-white"
                      onClick={() => { setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 'desc' ? 'asc' : 'desc' })); setPage(0) }}
                      aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    >
                      {c.label}{sort.key === c.key && (sort.dir === 'asc' ? ' ▲' : ' ▼')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {slice.map((r) => (
                  <tr key={rowKey(r)}>
                    {columns.map((c) => (
                      <td key={c.key} className={c.className ?? 'px-3 py-2 text-slate-200'}>
                        {c.render ? c.render(r) : c.value(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <button onClick={() => setPage(Math.max(0, p - 1))} disabled={p === 0} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 disabled:opacity-40">← Prev</button>
              <span>Page {p + 1} / {pages}</span>
              <button onClick={() => setPage(Math.min(pages - 1, p + 1))} disabled={p >= pages - 1} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 disabled:opacity-40">Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
