'use client'

/** Registry filter surface: four quick toggle chips (the metric-linked
 *  filters), a compact popover for the long tail, a sort select, and a
 *  dismissible-chip row so every active filter stays visible with one-tap
 *  removal + Clear all. All controls are labelled; toggles carry aria-pressed. */
import { useEffect, useRef, useState } from 'react'
import { Field, Select } from '@/components/ui/Field'
import {
  CONFIDENCE_LEVELS, PERSON_CLASSIFICATIONS, PERSON_LIFECYCLES,
  classificationLabel, confidenceLabel, lifecycleLabel,
} from './personIntel'
import {
  activeRegistryFilterCount, registryFilterChips,
  EMPTY_REGISTRY_FILTERS, REGISTRY_SORTS,
  type RegistryFilters, type RegistrySort,
} from './registryFilters'

const CHIP =
  'inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition'
const CHIP_OFF = 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
const CHIP_ON = 'border-badge-500/60 bg-badge-500/15 text-white'

const QUICK: { key: 'bolo' | 'warrant' | 'stale' | 'duplicate'; label: string; title: string }[] = [
  { key: 'bolo', label: 'BOLO', title: 'Only persons with an active, unexpired BOLO' },
  { key: 'warrant', label: 'Warrant', title: 'Only persons with an active warrant-type legal request' },
  { key: 'stale', label: 'Stale', title: 'Only records overdue for review (or never reviewed)' },
  { key: 'duplicate', label: 'Duplicates', title: 'Only records in a possible-duplicate cluster' },
]

interface Props {
  filters: RegistryFilters
  onFilters: (f: RegistryFilters) => void
  gangs: { id: string; name: string }[]
  sort: RegistrySort
  onSort: (s: RegistrySort) => void
  /** True while a search query drives the list — results stay rank-ordered. */
  searchActive: boolean
}

export function RegistryFilterBar({ filters, onFilters, gangs, sort, onSort, searchActive }: Props) {
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const patch = (p: Partial<RegistryFilters>) => onFilters({ ...filters, ...p })

  // Close the popover on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const count = activeRegistryFilterCount(filters)
  const chips = registryFilterChips(filters, (id) => gangs.find((g) => g.id === id)?.name ?? null)
  const gangNameOf = (id: string) => gangs.find((g) => g.id === id)?.name

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {QUICK.map((q) => (
          <button
            key={q.key}
            type="button"
            aria-pressed={filters[q.key]}
            title={q.title}
            onClick={() => patch({ [q.key]: !filters[q.key] } as Partial<RegistryFilters>)}
            className={`${CHIP} ${filters[q.key] ? CHIP_ON : CHIP_OFF}`}
          >
            {q.label}
          </button>
        ))}

        <div ref={popRef} className="relative">
          <button
            type="button"
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((o) => !o)}
            className={`${CHIP} ${open || count > QUICK.filter((q) => filters[q.key]).length ? CHIP_ON : CHIP_OFF}`}
          >
            More filters{count ? ` (${count})` : ''}
          </button>
          {open && (
            <div
              role="dialog"
              aria-label="More filters"
              className="absolute left-0 z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] space-y-3 rounded-xl border border-white/10 bg-ink-850 p-3 shadow-glow"
            >
              <Field label="Gang">
                {(id) => (
                  <Select id={id} value={filters.gang} onChange={(e) => patch({ gang: e.target.value })}>
                    <option value="">Any gang</option>
                    <option value="none">No gang</option>
                    {/* Preserve a filter for a gang the cache no longer lists. */}
                    {filters.gang && filters.gang !== 'none' && !gangNameOf(filters.gang) && (
                      <option value={filters.gang}>(current filter)</option>
                    )}
                    {gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Classification">
                {(id) => (
                  <Select id={id} value={filters.classification} onChange={(e) => patch({ classification: e.target.value })}>
                    <option value="">Any classification</option>
                    {PERSON_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{classificationLabel(c)}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Lifecycle">
                {(id) => (
                  <Select id={id} value={filters.lifecycle} onChange={(e) => patch({ lifecycle: e.target.value })}>
                    <option value="">Default (merged hidden)</option>
                    {PERSON_LIFECYCLES.map((l) => <option key={l} value={l}>{lifecycleLabel(l)}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Confidence">
                {(id) => (
                  <Select id={id} value={filters.confidence} onChange={(e) => patch({ confidence: e.target.value })}>
                    <option value="">Any confidence</option>
                    {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{confidenceLabel(c)}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Linked cases">
                {(id) => (
                  <Select id={id} value={filters.cases} onChange={(e) => patch({ cases: e.target.value })}>
                    <option value="">Any</option>
                    <option value="linked">Linked to a case</option>
                    <option value="unlinked">No linked cases</option>
                  </Select>
                )}
              </Field>
              <Field label="Vehicles">
                {(id) => (
                  <Select id={id} value={filters.vehicles} onChange={(e) => patch({ vehicles: e.target.value })}>
                    <option value="">Any</option>
                    <option value="linked">Has vehicles</option>
                    <option value="unlinked">No vehicles</option>
                  </Select>
                )}
              </Field>
              <div className="space-y-1.5 border-t border-white/5 pt-2">
                <PopCheck label="Missing mugshot" checked={filters.missingMugshot} onChange={(v) => patch({ missingMugshot: v })} />
                <PopCheck label="Missing DOB" checked={filters.missingDob} onChange={(v) => patch({ missingDob: v })} />
                <PopCheck label="No review scheduled" checked={filters.noReview} onChange={(v) => patch({ noReview: v })} />
                <PopCheck label="Updated in the last 7 days" checked={filters.recent} onChange={(v) => patch({ recent: v })} />
                <PopCheck label="High felony count (8+)" checked={filters.highFelony} onChange={(v) => patch({ highFelony: v })} />
                <PopCheck label="Include merged / archived" checked={filters.includeMerged} onChange={(v) => patch({ includeMerged: v })} />
              </div>
            </div>
          )}
        </div>

        <label className="ml-auto flex items-center gap-1.5 text-xs font-semibold text-slate-400">
          Sort
          <select
            value={sort}
            onChange={(e) => onSort(e.target.value as RegistrySort)}
            disabled={searchActive}
            title={searchActive ? 'Search results are ranked by relevance' : undefined}
            className="min-h-[40px] rounded-lg border border-white/10 bg-ink-850 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-badge-500 disabled:opacity-50"
          >
            {REGISTRY_SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Active:</span>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => patch(c.patch)}
              aria-label={`Remove filter: ${c.label}`}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-badge-500/40 bg-badge-500/10 px-2.5 py-1 text-[11px] font-semibold text-badge-200 transition hover:bg-badge-500/20"
            >
              {c.label}
              <span aria-hidden>×</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onFilters(EMPTY_REGISTRY_FILTERS)}
            className="inline-flex min-h-[32px] items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}

function PopCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-[32px] cursor-pointer items-center gap-2 text-xs text-slate-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-badge-500"
      />
      {label}
    </label>
  )
}
