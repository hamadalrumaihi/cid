'use client'

/** Choosing a subject means choosing a RECORD, not typing a name.
 *
 *  Shared by the watchlist and by target designation, which is the point: both
 *  screens attach SIB material to a row in a CID registry, and both would grow
 *  their own second address book if either offered a free-text box instead.
 *  One implementation, so a fix to one is a fix to both.
 *
 *  ── Everything it offers, the caller could already read ───────────────────
 *  `siu_registry_search()` is SECURITY INVOKER, so the search runs under the
 *  caller's own policies. An agent is never shown a record they could not open
 *  directly, and `already_watched` is answered from their own view of the
 *  watchlist — a caller who cannot see a watch is told `false`, so this never
 *  becomes a side channel disclosing which subjects the unit is interested in.
 *
 *  ── The escape hatch is real, and is marked as one ────────────────────────
 *  Sometimes the subject genuinely is not in any registry yet, and forcing an
 *  agent to invent a `persons` row to record a watch would be worse than the
 *  problem this replaces. So `allowUnknown` offers an unidentified stub — but
 *  it is behind a link, worded as a fallback, and never the default. */

import { useState } from 'react'
import { siuRegistrySearch, siuWatchEntityLabel, SIU_WATCH_REGISTRY_TYPES,
         type SiuRegistryMatch } from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'

export interface SiuRegistryChoice {
  /** `unknown` when the caller used the escape hatch. */
  entityType: string
  /** null only for `unknown`. */
  entityId: string | null
  /** The typed description, for `unknown` only. */
  label: string | null
  /** For confirmation copy. Empty when nothing is chosen yet. */
  displayName: string
}

export const emptyChoice: SiuRegistryChoice = {
  entityType: 'person', entityId: null, label: null, displayName: '',
}

export const choiceIsComplete = (c: SiuRegistryChoice) =>
  c.entityType === 'unknown' ? !!c.label?.trim() : !!c.entityId

export function SiuRegistryPicker({
  value, onChange, allowUnknown = true, excludeWatched = false, types,
}: {
  value: SiuRegistryChoice
  onChange: (c: SiuRegistryChoice) => void
  /** Offer the unidentified-subject fallback. */
  allowUnknown?: boolean
  /** Disable records already carrying a live watch (the watchlist's own rule —
   *  a second live watch is refused by a unique index, so offering it would be
   *  a form that fails on save). */
  excludeWatched?: boolean
  types?: readonly string[]
}) {
  const [q, setQ] = useState('')
  const [matches, setMatches] = useState<SiuRegistryMatch[]>([])
  const [searched, setSearched] = useState(false)
  const [busy, setBusy] = useState(false)

  const offered = types ?? SIU_WATCH_REGISTRY_TYPES
  const stub = value.entityType === 'unknown'

  const search = async () => {
    if (!q.trim()) return
    setBusy(true)
    try {
      const rows = await siuRegistrySearch(value.entityType, q)
      setMatches(rows)
      setSearched(true)
    } catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger') }
    finally { setBusy(false) }
  }

  const reset = (entityType: string) => {
    setMatches([]); setSearched(false); setQ('')
    onChange({ entityType, entityId: null, label: null, displayName: '' })
  }

  if (stub) {
    return (
      <div className="space-y-2">
        <Field
          label="What is being recorded"
          required
          hint="An unidentified subject. Attach it to a registry record as soon as one exists — until then this entry cannot show affiliations, vehicles or case history."
        >
          {(id) => (
            <Input
              id={id}
              value={value.label ?? ''}
              onChange={(e) => onChange({
                entityType: 'unknown', entityId: null,
                label: e.target.value, displayName: e.target.value,
              })}
            />
          )}
        </Field>
        <button
          type="button"
          className="text-[11px] text-slate-400 underline-offset-2 hover:underline"
          onClick={() => reset('person')}
        >
          Search the registry instead
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Field label="Type" required>
        {(id) => (
          <Select id={id} value={value.entityType} onChange={(e) => reset(e.target.value)}>
            {offered.map((t) => (
              <option key={t} value={t}>{siuWatchEntityLabel(t)}</option>
            ))}
          </Select>
        )}
      </Field>

      <Field
        label="Find the record"
        required
        hint="Pointing at the registry record keeps the subject's name, affiliations and vehicles current without anyone retyping them."
      >
        {(id) => (
          <div className="flex gap-2">
            <Input
              id={id}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search() } }}
              placeholder="Search by name, plate or handle"
            />
            <Button disabled={busy} onClick={() => void search()}>
              {busy ? 'Searching…' : 'Search'}
            </Button>
          </div>
        )}
      </Field>

      {value.entityId ? (
        <div className="flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3">
          <p className="min-w-0 truncate text-sm font-semibold text-slate-100">
            {value.displayName}
          </p>
          <button
            type="button"
            className="ml-auto shrink-0 text-[11px] text-slate-400 underline-offset-2 hover:underline"
            onClick={() => reset(value.entityType)}
          >
            Change
          </button>
        </div>
      ) : matches.length ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {matches.map((m) => {
            const blocked = excludeWatched && m.already_watched
            return (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={blocked}
                  className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-left hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => onChange({
                    entityType: value.entityType, entityId: m.id,
                    label: null, displayName: m.display_name,
                  })}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-100">{m.display_name}</span>
                    {m.secondary && (
                      <span className="block truncate text-[11px] text-slate-400">{m.secondary}</span>
                    )}
                  </span>
                  {blocked && <Badge tone="neutral" className="ml-auto">Already watched</Badge>}
                </button>
              </li>
            )
          })}
        </ul>
      ) : searched ? (
        <p className="text-xs text-slate-400">
          Nothing in the registry matches that. Create the record in CID first so everyone works
          from the same one{allowUnknown ? ', or record an unidentified subject below' : ''}.
        </p>
      ) : null}

      {allowUnknown && (
        <button
          type="button"
          className="text-[11px] text-slate-400 underline-offset-2 hover:underline"
          onClick={() => reset('unknown')}
        >
          The subject is not in the registry
        </button>
      )}
    </div>
  )
}
