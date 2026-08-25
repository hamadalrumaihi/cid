'use client'

/** "Linked to a registry profile" panel for the case link form. Two jobs:
 *
 *  1. Linked-state clarity — the selection is a REAL persons row: accent
 *     badge, the person's name, and an Open profile jump (useToolNav).
 *  2. Missing-info completion — one bounded, projected fetch of the person
 *     row (PERSON_LIST_COLS, viewer's RLS: an SIB-compartmented person simply
 *     comes back empty). Fields with values render read-only ("on the
 *     profile"); blank optional fields become small inputs, and anything the
 *     investigator types can be saved two ways, per the spec:
 *       · Case only → provenance-labelled lines appended into the link note
 *         (the only case-scoped field — handled by the caller via onCaseOnly);
 *       · Update person profile → diffForMasterUpdate payload (only fills the
 *         master's gaps — a non-empty profile value is NEVER overwritten and
 *         blanks are never written), preceded by an explicit uiConfirm naming
 *         the person and the exact fields, then the audited update() path.
 *     Linking never waits on any of this — the panel is purely additive. */
import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { diffForMasterUpdate } from '@/lib/autofill'
import type { TablesUpdate } from '@/lib/database.types'
import { list, update } from '@/lib/db'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { uiConfirm } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/Field'
import { Skeleton } from '@/components/ui/Skeleton'
import { PERSON_CLASSIFICATIONS, classificationLabel } from '@/components/persons/personIntel'
import { PERSON_LIST_COLS, type RegistryPerson } from '@/components/persons/registryFilters'
import { useToolNav } from '@/components/tools/useToolNav'
import {
  PERSON_COMPLETION_FIELDS, caseOnlyNoteLines, splitCompletionFields,
  type CompletionKey, type CompletionSplit, type PersonCompletionRow,
} from './personCompletion'

/** Classification is stored as the vocabulary value but always shown (and
 *  written into note lines) as its human label. */
const display = (key: CompletionKey, v: string): string =>
  key === 'classification' ? classificationLabel(v) : v

export function LinkedPersonPanel({ personId, personLabel, onCaseOnly }: {
  personId: string
  personLabel: string
  /** Receives the formatted provenance lines for the "Case only" choice —
   *  the caller appends them into the link's note field. */
  onCaseOnly: (lines: string[]) => void
}) {
  // Mirrors the persons UPDATE RLS (is_active) — any active member may fill
  // profile gaps; RLS re-decides server-side.
  const { canEdit } = useAuth()
  const { openRecord } = useToolNav()
  const [master, setMaster] = useState<PersonCompletionRow | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'hidden'>('loading')
  const [retryTick, setRetryTick] = useState(0)
  const [proposed, setProposed] = useState<Partial<Record<CompletionKey, string>>>({})
  /** Fields already appended into the link note ("Case only") — badge only. */
  const [inNote, setInNote] = useState<ReadonlySet<CompletionKey>>(new Set())

  useEffect(() => {
    let live = true
    // Microtask hop (the IntelTab refresh idiom) — no sync setState in effects.
    queueMicrotask(() => { if (live) setState('loading') })
    list('persons', { select: PERSON_LIST_COLS, in: { id: [personId] } })
      .then((rows) => {
        if (!live) return
        const r = (rows as unknown as RegistryPerson[])[0]
        if (!r) { setState('hidden'); return }
        setMaster({ dob: r.dob, phone: r.phone, alias: r.alias, classification: r.classification, status: r.status })
        setState('ready')
      })
      .catch(() => { if (live) setState('error') })
    return () => { live = false }
  }, [personId, retryTick])

  /** Non-blank, trimmed proposals — what both save choices operate on. */
  const proposal = (): Partial<Record<CompletionKey, string>> => {
    const out: Partial<Record<CompletionKey, string>> = {}
    for (const def of PERSON_COMPLETION_FIELDS) {
      const v = (proposed[def.key] ?? '').trim()
      if (v) out[def.key] = v
    }
    return out
  }

  const addToNote = () => {
    const p = proposal()
    const keys = Object.keys(p) as CompletionKey[]
    const lines = caseOnlyNoteLines(
      Object.fromEntries(keys.map((k) => [k, display(k, p[k]!)])),
    )
    if (!lines.length) return
    onCaseOnly(lines)
    setInNote((s) => new Set([...s, ...keys]))
    toast('Added to the link note — it saves with the link.', 'info')
  }

  const updateProfile = async () => {
    if (!master) return
    // diffForMasterUpdate guarantees the two invariants: a non-empty profile
    // value is never overwritten, and a blank can never be written.
    const patch = diffForMasterUpdate<Record<CompletionKey, string | null>>(master, proposal())
    const added = PERSON_COMPLETION_FIELDS.filter((d) => typeof patch[d.key] === 'string')
    if (!added.length) return
    const summary = added.map((d) => `${d.label} “${display(d.key, String(patch[d.key]))}”`).join(', ')
    // Never a silent update: the confirm names the person and the exact
    // fields; the persons audit trigger records who/what.
    const ok = await uiConfirm(
      `Add to ${personLabel}'s registry profile: ${summary}. Only fields empty on the profile are filled — existing values are never changed.`,
      { title: 'Update person profile', confirmText: 'Update profile', danger: false },
    )
    if (!ok) return
    const res = await update('persons', personId, patch as TablesUpdate<'persons'>)
    if (res.error) { toast(res.error.message, 'danger'); return }
    setMaster((m) => ({ ...m, ...patch }))
    setProposed((prev) => {
      const next = { ...prev }
      for (const d of added) delete next[d.key]
      return next
    })
    toast('Person profile updated.', 'success')
  }

  const hasProposal = Object.keys(proposal()).length > 0
  const split: CompletionSplit | null = state === 'ready' && master ? splitCompletionFields(master) : null

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Registry profile</Badge>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{personLabel}</span>
        <Button size="sm" onClick={() => openRecord('persons', personId)}>Open profile</Button>
      </div>

      {state === 'loading' && (
        <div aria-hidden className="mt-3 space-y-1.5">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      )}
      {state === 'hidden' && (
        <p className="mt-2 text-xs text-slate-400">Profile details are not visible to you. Linking still works.</p>
      )}
      {state === 'error' && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="text-xs text-slate-400">Could not load profile details.</p>
          <Button size="sm" onClick={() => setRetryTick((t) => t + 1)}>Try again</Button>
        </div>
      )}

      {split && (
        <div className="mt-3 space-y-3">
          {split.present.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">On the profile</p>
              <dl className="mt-1 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
                {split.present.map(({ def, value }) => (
                  <div key={def.key} className="flex items-baseline gap-2 text-sm">
                    <dt className="flex-shrink-0 text-xs text-slate-400">{def.label}</dt>
                    <dd className="min-w-0 truncate text-slate-200">{display(def.key, value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {split.missing.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Not on the profile yet</p>
              <div className="mt-1.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {split.missing.map((def) => (
                  <Field key={def.key} label={def.label}>
                    {(id) => (
                      <>
                        {def.key === 'classification' ? (
                          <Select
                            id={id}
                            value={proposed.classification ?? ''}
                            onChange={(e) => setProposed((p) => ({ ...p, classification: e.target.value }))}
                          >
                            <option value="">— select —</option>
                            {PERSON_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{classificationLabel(c)}</option>)}
                          </Select>
                        ) : (
                          <Input
                            id={id}
                            type={def.key === 'dob' ? 'date' : 'text'}
                            value={proposed[def.key] ?? ''}
                            onChange={(e) => setProposed((p) => ({ ...p, [def.key]: e.target.value }))}
                          />
                        )}
                        {inNote.has(def.key) && <Badge tone="warn" className="mt-1">In case note</Badge>}
                      </>
                    )}
                  </Field>
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={!hasProposal} onClick={addToNote}>Add to link note (case only)</Button>
                {canEdit && (
                  <Button size="sm" disabled={!hasProposal} onAction={updateProfile}>Update person profile</Button>
                )}
                <p className="text-xs text-slate-400">Optional — linking never waits on missing details.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
