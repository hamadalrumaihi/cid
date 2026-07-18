'use client'

/** Bounded, debounced, server-backed record picker — the replacement for the
 *  load-the-whole-registry pickers flagged in the DOJ audit. The caller
 *  supplies the loader (an RLS-scoped `list()` with ilikeAny + limit ~20), so
 *  this component can never widen anyone's access; an empty query should
 *  return the most recent records so the picker is useful before typing.
 *
 *  A selected record collapses to a summary row with a Change control; the
 *  open state renders results as real ≥40px buttons (keyboard-reachable) with
 *  an aria-live match count for screen readers. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'

export interface PickedRecord {
  id: string
  label: string
  sublabel?: string
}

export function RecordSearchPicker<T extends PickedRecord>({
  label, required, hint, placeholder, value, onChange, search, disabled,
}: {
  label: string
  required?: boolean
  hint?: string
  placeholder?: string
  value: T | null
  onChange: (v: T | null) => void
  /** RLS-scoped bounded loader. '' should return the most recent ~20 rows. */
  search: (q: string) => Promise<T[]>
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  // Debounced loader — sequence-guarded so a slow early response can never
  // clobber a newer one. Nothing loads until the field is focused.
  useEffect(() => {
    if (!open) return
    const mine = ++seq.current
    const t = setTimeout(() => {
      setLoading(true)
      search(query)
        .then((rows) => { if (seq.current === mine) { setResults(rows); setLoading(false) } })
        .catch(() => { if (seq.current === mine) { setResults([]); setLoading(false) } })
    }, 250)
    return () => clearTimeout(t)
  }, [query, open, search])

  return (
    <Field label={label} required={required} hint={hint}>
      {(id) => value ? (
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-sm text-white">
            {value.label}
            {value.sublabel && <span className="text-slate-400"> — {value.sublabel}</span>}
          </span>
          <Button id={id} size="sm" disabled={disabled} onClick={() => { onChange(null); setOpen(true) }}>
            Change
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Input
            id={id}
            value={query}
            disabled={disabled}
            autoComplete="off"
            placeholder={placeholder ?? 'Type to search…'}
            onFocus={() => setOpen(true)}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          />
          {open && (
            <>
              <p className="sr-only" aria-live="polite">
                {loading ? 'Searching…' : `${results.length} matches`}
              </p>
              <ul className="max-h-56 overflow-y-auto rounded-lg border border-white/10 bg-ink-900/80">
                {results.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => { onChange(r); setOpen(false) }}
                      className="flex min-h-[40px] w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-200 transition hover:bg-white/5 focus-visible:bg-white/5"
                    >
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                      {r.sublabel && <span className="flex-shrink-0 text-xs text-slate-400">{r.sublabel}</span>}
                    </button>
                  </li>
                ))}
                {!loading && results.length === 0 && (
                  <li className="px-3 py-2 text-xs text-slate-400">
                    {query.trim() ? 'No matches — refine the search.' : 'No records available.'}
                  </li>
                )}
                {loading && results.length === 0 && (
                  <li className="px-3 py-2 text-xs text-slate-400">Searching…</li>
                )}
              </ul>
            </>
          )}
        </div>
      )}
    </Field>
  )
}
