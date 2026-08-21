'use client'

/** The Penal Code, browsable.
 *
 *  It was a flat searchable list of 359 statutes: fine if you already knew the
 *  code you wanted, close to useless for "what covers this". The offenses are
 *  grouped by the title of the code they sit under — which is how the statute
 *  book is actually organised — filterable by the things an investigator
 *  actually narrows on, and comparable side by side.
 *
 *  Everything comes from fields the RPC already returned and the catalog was
 *  throwing away. No new tables, no new columns, nothing authored.
 */

import { useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { PenalCharge } from '@/lib/penal'
import { PENAL_CLASS_ORDER } from '@/lib/penal'
import { usePenalCode } from '@/lib/usePenalCode'
import {
  MAX_COMPARE, NO_FILTERS, activeFilterCount, byPenalTitle, compareCharges,
  filterAvailability, matchesCharge, type ChargeFilters,
} from '@/lib/penalWorkspace'
import { ChargeCard } from './ChargeCard'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Select } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/Notice'
import { SearchIcon } from '@/components/shell/icons'

export function PenalWorkspace() {
  const sp = useSearchParams()
  const { charges, ready, error, version } = usePenalCode()
  const [filters, setFilters] = useState<ChargeFilters>(
    () => ({ ...NO_FILTERS, q: sp.get('q') ?? '' }))
  const [compare, setCompare] = useState<string[]>([])

  const rows = useMemo(
    () => (ready ? charges.filter((c) => matchesCharge(c, filters)) : []),
    [charges, ready, filters])
  const groups = useMemo(() => byPenalTitle(rows), [rows])
  // Only offer a filter the code in force can actually satisfy.
  const available = useMemo(() => filterAvailability(charges), [charges])

  const selected = useMemo(
    () => compare.map((id) => charges.find((c) => c.id === id)).filter(Boolean) as PenalCharge[],
    [compare, charges])
  const comparison = useMemo(() => compareCharges(selected), [selected])

  const toggle = (c: PenalCharge) => setCompare((prev) =>
    prev.includes(c.id) ? prev.filter((x) => x !== c.id)
      : prev.length >= MAX_COMPARE ? prev
      : [...prev, c.id])

  const set = <K extends keyof ChargeFilters>(k: K, v: ChargeFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }))
  const activeCount = activeFilterCount(filters)

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[12rem] flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={filters.q}
              onChange={(e) => set('q', e.target.value)}
              placeholder="Code, offense, title of code, definition…"
              aria-label="Search the penal code"
              className="w-full rounded-lg border border-white/10 bg-ink-850 py-2 pl-9 pr-3 text-sm text-slate-200 outline-none transition focus:border-badge-500"
            />
          </div>
          <span className="t-readout text-[11px] text-slate-500">
            {ready ? `${rows.length} / ${charges.length} OFFENSES` : 'LOADING PENAL CODE…'}
          </span>
          {activeCount > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setFilters({ ...NO_FILTERS, q: filters.q })}>
              Clear {activeCount} filter{activeCount === 1 ? '' : 's'}
            </Button>
          )}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Class">
            {(id) => (
              <Select id={id} value={filters.level ?? ''}
                onChange={(e) => set('level', e.target.value || null)}>
                <option value="">Any class</option>
                {PENAL_CLASS_ORDER.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            )}
          </Field>
          {available.schedules.length > 0 && (
            <Field label="Substance schedule">
              {(id) => (
                <Select id={id} value={filters.schedule?.toString() ?? ''}
                  onChange={(e) => set('schedule', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Any</option>
                  {available.schedules.map((n) => (
                    <option key={n} value={n}>Schedule {n}</option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
            {([
              ['arrestOnly', 'Arrest required', available.arrest],
              ['ricoOnly', 'RICO-related', available.rico],
              ['stackableOnly', 'Stacks', available.stackable],
              ['hidePdExempt', 'Chargeable by PD', available.pdExempt],
            ] as const).filter(([, , can]) => can).map(([key, label]) => (
              <label key={key} className="flex min-h-[44px] items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={filters[key]}
                  onChange={(e) => set(key, e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-ink-950"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        {/* Said once, plainly, rather than implied by absence. */}
        <p className="mt-3 border-t border-white/5 pt-3 text-xs text-slate-500">
          Shows what the published code states. Required legal elements, supporting
          evidence and lesser or conflicting offenses are not recorded in the portal,
          so they are not shown — rather than guessed at.
          {!available.arrest && ready && (
            <> This version of the code does not state an arrest requirement for any
            offense, so there is nothing to filter on.</>
          )}
        </p>
      </Card>

      {comparison.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Side by side
            </h3>
            <Button size="sm" variant="ghost" onClick={() => setCompare([])}>Clear</Button>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-xs">
              <thead>
                <tr>
                  <th className="py-1.5 pr-3 font-semibold text-slate-500"> </th>
                  {selected.map((c) => (
                    <th key={c.id} className="py-1.5 pr-3 font-semibold text-white">
                      {c.code || c.title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.label} className="border-t border-white/5">
                    <th scope="row" className="py-1.5 pr-3 text-left font-semibold text-slate-500">
                      {row.label}
                    </th>
                    {row.values.map((v, i) => (
                      // Only the rows where they differ are worth a reader's
                      // attention -- that is the entire reason for the table.
                      <td key={i} className={`py-1.5 pr-3 ${
                        row.differs ? 'font-semibold text-amber-200' : 'text-slate-400'}`}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!ready ? (
        <p className="t-readout p-6 text-center text-sm text-slate-500">
          {error ? `PENAL CODE UNAVAILABLE // ${error}` : 'LOADING PENAL CODE…'}
        </p>
      ) : !rows.length ? (
        <EmptyState title="No offense matches"
          hint="Nothing in the published code matches those filters. Try widening the class or clearing a filter." />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section key={g.title}>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {g.title}
                <Badge tone="neutral">{g.charges.length}</Badge>
              </h3>
              <div className="grid gap-2 lg:grid-cols-2">
                {g.charges.map((c) => (
                  <ChargeCard key={c.id} c={c}
                    selected={compare.includes(c.id)}
                    onToggle={() => toggle(c)} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {version && (
        <p className="t-readout text-[11px] text-slate-600">IN FORCE: {version.toUpperCase()}</p>
      )}
    </div>
  )
}
