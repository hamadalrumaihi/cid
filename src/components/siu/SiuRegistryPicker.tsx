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
 *  it is behind a link, worded as a fallback, and never the default.
 *
 *  Internally the search runs through the shared RecordSearchPicker (debounced,
 *  sequence-guarded, keyboard-navigable) over the SAME RPC — the picker only
 *  renders what `siu_registry_search()` answers, so nothing here widens what a
 *  caller can see. */

import { useCallback } from 'react'
import { siuRegistrySearch, siuWatchEntityLabel, SIU_WATCH_REGISTRY_TYPES } from '@/lib/siu'
import { Field, Input, Select } from '@/components/ui/Field'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'

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

/** PickedRecord plus the RPC's already-watched flag (the watchlist's own
 *  duplicate rule — surfaced as a disabled row, not a save-time failure). */
type RegistryHit = PickedRecord & { alreadyWatched: boolean }

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
  const offered = types ?? SIU_WATCH_REGISTRY_TYPES
  const stub = value.entityType === 'unknown'
  const entityType = value.entityType

  const reset = (entityType: string) =>
    onChange({ entityType, entityId: null, label: null, displayName: '' })

  // Bounded loader over the SECURITY INVOKER RPC. Debounce, race-guarding and
  // the inline error/Retry rendering all come from RecordSearchPicker.
  const search = useCallback(async (q: string): Promise<RegistryHit[]> => {
    const rows = await siuRegistrySearch(entityType, q)
    return rows.map((m) => ({
      id: m.id,
      label: m.display_name,
      sublabel: m.secondary ?? undefined,
      alreadyWatched: m.already_watched,
    }))
  }, [entityType])

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

      {/* Remount per type — switching the registry starts a fresh search, the
          same reset the old Search-button flow performed. */}
      <RecordSearchPicker<RegistryHit>
        key={entityType}
        label="Find the record"
        required
        hint="Pointing at the registry record keeps the subject's name, affiliations and vehicles current without anyone retyping them."
        placeholder="Search by name, plate or handle"
        minChars={1}
        value={value.entityId
          ? { id: value.entityId, label: value.displayName, alreadyWatched: false }
          : null}
        onChange={(v) => onChange(v
          ? { entityType, entityId: v.id, label: null, displayName: v.label }
          : { entityType, entityId: null, label: null, displayName: '' })}
        search={search}
        getDisabled={excludeWatched ? (h) => (h.alreadyWatched ? 'Already watched' : null) : undefined}
        emptyState={
          <>
            Nothing in the registry matches that. Create the record in CID first so everyone works
            from the same one{allowUnknown ? ', or record an unidentified subject below' : ''}.
          </>
        }
        allowFreeText={allowUnknown ? {
          label: 'The subject is not in the registry',
          onPick: (text) => onChange({
            entityType: 'unknown', entityId: null, label: text, displayName: text,
          }),
        } : undefined}
      />

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
