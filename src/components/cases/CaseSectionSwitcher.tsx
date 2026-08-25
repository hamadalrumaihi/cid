'use client'

/** Phone-width replacement for the SectionTabs strip on the case screen: a
 *  single full-width button showing the CURRENT section (name + count +
 *  attention dot) that opens a modal sheet listing every section, grouped
 *  exactly like the desktop strip. Presentational, like SectionTabs — the
 *  parent owns the active id and the URL. Desktop (`sm`+) keeps the grouped
 *  strip; CaseDetail swaps the two on lib/useNarrow. */
import { useMemo, useState } from 'react'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import type { SectionTab, SectionTabGroup } from '@/components/ui/SectionTabs'

/** Count pill + amber attention dot — the SectionTabs vocabulary, reused so
 *  the phone switcher and the desktop strip can never disagree on markers. */
function TabSignals<Id extends string>({ t, on }: { t: SectionTab<Id>; on: boolean }) {
  return (
    <>
      {t.count !== undefined && (
        <span className={`rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${on ? 'bg-white/20 text-ink-950' : 'bg-white/10 text-slate-400'}`}>
          {t.count}
        </span>
      )}
      {t.marker && (
        <>
          <span aria-hidden className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />
          <span className="sr-only">{t.markerLabel ?? 'Needs attention'}</span>
        </>
      )}
    </>
  )
}

export function CaseSectionSwitcher<Id extends string>({
  tabs,
  groups,
  active,
  onChange,
  ariaLabel = 'Sections',
  className = '',
}: {
  tabs: ReadonlyArray<SectionTab<Id>>
  /** Same visual grouping as the desktop strip (group order wins; ungrouped
   *  tabs trail). */
  groups?: ReadonlyArray<SectionTabGroup<Id>>
  active: Id
  onChange: (id: Id) => void
  ariaLabel?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)

  // Grouped plan — the SectionTabs `sections` derivation, verbatim semantics.
  const sections = useMemo((): Array<{ label: string | null; items: Array<SectionTab<Id>> }> => {
    if (!groups?.length) return [{ label: null, items: [...tabs] }]
    const byId = new Map(tabs.map((t) => [t.id, t]))
    const seen = new Set<Id>()
    const out: Array<{ label: string | null; items: Array<SectionTab<Id>> }> = []
    for (const g of groups) {
      const items: Array<SectionTab<Id>> = []
      for (const id of g.tabs) {
        const t = byId.get(id)
        if (t && !seen.has(id)) { seen.add(id); items.push(t) }
      }
      if (items.length) out.push({ label: g.label, items })
    }
    const rest = tabs.filter((t) => !seen.has(t.id))
    if (rest.length) out.push({ label: null, items: [...rest] })
    return out
  }, [tabs, groups])

  const current = tabs.find((t) => t.id === active)

  return (
    <div className={className}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm font-bold text-white transition hover:bg-white/10"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="sr-only">{ariaLabel} — current: </span>
          <span className="truncate">{current?.label ?? active}</span>
          {current && <TabSignals t={current} on={false} />}
        </span>
        <span aria-hidden className="flex-shrink-0 text-xs text-slate-400">▾ Sections</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)}>
        <div className="p-5">
          <ModalHeader title={ariaLabel} onClose={() => setOpen(false)} />
          <nav aria-label={ariaLabel} className="space-y-4">
            {sections.map((s, i) => (
              <div key={s.label ?? `section-${i}`}>
                {s.label !== null && (
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{s.label}</p>
                )}
                <ul className="space-y-1">
                  {s.items.map((t) => {
                    const on = t.id === active
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          aria-current={on ? 'true' : undefined}
                          onClick={() => { onChange(t.id); setOpen(false) }}
                          className={`flex min-h-[44px] w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-sm font-bold ${
                            on ? 'bg-badge-500 text-ink-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{t.label}</span>
                          <TabSignals t={t} on={on} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </Modal>
    </div>
  )
}
