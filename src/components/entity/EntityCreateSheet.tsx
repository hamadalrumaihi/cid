'use client'

/** EntityCreateSheet — the one create form for registry records (P2-07).
 *  Renders the kind's CREATE_FIELDS, prefilled from `initial` (callers hand
 *  over buildAutofill output), and runs `entity_duplicates` ~400 ms after the
 *  last keystroke. A strong match flips the primary action to **Use existing
 *  record**; **Create anyway** stays available but asks for a one-line reason
 *  that is appended to the record's notes (EA1: never hard-block, EA10:
 *  reuse is the default). Saving is a plain RLS-audited insert — the server's
 *  partial unique index means a plate CID cannot see never errors, while a
 *  live duplicate plate still answers 23505 and is offered as Use existing.
 *  A caller with its own save path (the claim conversion RPC, P6-04) hands it
 *  in as `submit`; a `duplicates` answer from it lands in the same panel. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { TablesInsert } from '@/lib/database.types'
import { insert, type DbError } from '@/lib/db'
import {
  CREATE_FIELDS, KIND_LABEL, findDuplicates,
  type CreateField, type DuplicatePayload, type DuplicateRow, type MergeKind,
} from '@/lib/entity'
import type { EntityHit } from '@/lib/entitySearch'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { ComparePanel } from './ComparePanel'
import { DuplicatePanel } from './DuplicatePanel'
import { MergeDialog } from './MergeDialog'
import { hitFor } from './labels'

export const DUPLICATE_DEBOUNCE_MS = 400

/** Columns the table needs that CREATE_FIELDS does not collect yet — places
 *  carry a NOT NULL `type` enum. Rendered after the kind's own fields. */
/** The payload keys entity_duplicates reads; anything else is noise. */
const DUP_KEYS: ReadonlySet<keyof DuplicatePayload> = new Set<keyof DuplicatePayload>([
  'name', 'alias', 'dob', 'phone', 'plate', 'area', 'platform', 'handle', 'kind', 'value', 'case_number', 'title',
])

const NOTES_COLUMN: Record<MergeKind, 'notes' | 'summary'> = {
  person: 'notes', vehicle: 'notes', gang: 'notes', place: 'notes', account: 'summary', narcotic: 'summary',
}

async function insertRecord(kind: MergeKind, values: Record<string, string>): Promise<{ id: string | null; error: DbError | null }> {
  const v = values as unknown
  const pick = (r: { data: { id: string }[] | null; error: DbError | null }) => ({ id: r.data?.[0]?.id ?? null, error: r.error })
  switch (kind) {
    case 'person': return pick(await insert('persons', v as TablesInsert<'persons'>, 'id'))
    case 'vehicle': return pick(await insert('vehicles', v as TablesInsert<'vehicles'>, 'id'))
    case 'gang': return pick(await insert('gangs', v as TablesInsert<'gangs'>, 'id'))
    case 'place': return pick(await insert('places', v as TablesInsert<'places'>, 'id'))
    case 'account': return pick(await insert('accounts', v as TablesInsert<'accounts'>, 'id'))
    case 'narcotic': return pick(await insert('narcotics', v as TablesInsert<'narcotics'>, 'id'))
  }
}

/** What a `submit` override answers: the insert's shape, plus the server's
 *  own duplicate verdict when it refused for that reason. */
export interface SheetSubmitResult { id: string | null; error: DbError | null; duplicates?: DuplicateRow[] }

const toHit = (kind: MergeKind, r: DuplicateRow): EntityHit =>
  ({ id: r.id, label: r.label, sublabel: r.sublabel ?? undefined, meta: { kind } })

export interface EntityCreateSheetProps {
  kind: MergeKind
  open: boolean
  onClose: () => void
  /** Prefill by column key — pass `buildAutofill(...).values`. */
  initial?: Partial<Record<string, string>>
  /** Accepted for the case-tab flow (P3); the sheet records nothing against it yet. */
  caseId?: string
  /** Offers Merge on the strong matches when two or more already exist. */
  allowMerge?: boolean
  /** Replaces the direct insert. Receives the trimmed CREATE_FIELDS values
   *  and, once the user has answered a strong match, their "create anyway"
   *  reason — the override is the callee's to record, so nothing is appended
   *  to the notes here. `duplicates` in the answer renders the panel. */
  submit?: (values: Record<string, string>, reason?: string) => Promise<SheetSubmitResult>
  onCreated: (hit: EntityHit) => void
  onUseExisting: (hit: EntityHit) => void
}

export function EntityCreateSheet({ kind, open, onClose, initial, allowMerge, submit, onCreated, onUseExisting }: EntityCreateSheetProps) {
  const fields = CREATE_FIELDS[kind]
  const [values, setValues] = useState<Record<string, string>>({})
  /** The last duplicate answer, keyed by the payload it answered — a stale
   *  answer never renders, and "checking" is simply "no answer for this key". */
  const [dupAnswer, setDupAnswer] = useState<{ key: string; rows: DuplicateRow[] } | null>(null)
  const [compare, setCompare] = useState<DuplicateRow | null>(null)
  const [mergeRow, setMergeRow] = useState<DuplicateRow | null>(null)
  const [anyway, setAnyway] = useState(false)
  const [override, setOverride] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  // Reset on every open; `initial` is read through a ref so a caller passing
  // a fresh object each render cannot wipe what the user has typed.
  const initialRef = useRef(initial)
  useEffect(() => { initialRef.current = initial })
  useEffect(() => {
    if (!open) return
    let live = true
    // State writes after an await only (the ShiftsView idiom) — no
    // synchronous cascading render from the effect body.
    void (async () => {
      await Promise.resolve()
      if (!live) return
      const seed: Record<string, string> = {}
      for (const [k, v] of Object.entries(initialRef.current ?? {})) if (v != null && v !== '') seed[k] = v
      setValues(seed); setDupAnswer(null); setCompare(null); setMergeRow(null); setAnyway(false); setOverride(''); setError(null)
    })()
    return () => { live = false }
  }, [open])

  // Debounced duplicate check keyed on the payload the RPC actually reads.
  const payload = useMemo(() => {
    const p: DuplicatePayload = {}
    for (const f of fields) {
      const key = (f.dupKey ?? f.key) as keyof DuplicatePayload
      const v = values[f.key]?.trim()
      if (DUP_KEYS.has(key) && v) p[key] = v
    }
    return p
  }, [fields, values])
  const payloadKey = JSON.stringify(payload)

  useEffect(() => {
    if (!open || payloadKey === '{}') return
    const mine = ++seq.current
    const t = setTimeout(async () => {
      const rows = await findDuplicates(kind, JSON.parse(payloadKey) as DuplicatePayload)
      if (mine === seq.current) setDupAnswer({ key: payloadKey, rows })
    }, DUPLICATE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [open, kind, payloadKey])

  const dupes = payloadKey !== '{}' && dupAnswer?.key === payloadKey ? dupAnswer.rows : []
  const checking = payloadKey !== '{}' && dupAnswer?.key !== payloadKey
  const setDupes = (rows: DuplicateRow[]) => setDupAnswer({ key: payloadKey, rows })

  const strong = dupes.filter((d) => d.strength === 'strong')
  const missing = fields.filter((f) => f.required && !values[f.key]?.trim())
  const dirty = Object.values(values).some((v) => v.trim() !== '')
  const label = KIND_LABEL[kind].one

  const pickExisting = (r: DuplicateRow) => { onUseExisting(toHit(kind, r)); onClose() }

  const save = async () => {
    if (missing.length) { toast(`${missing[0].label} is required.`, 'warn'); return }
    if (strong.length && !override.trim()) { toast('Say why this is not the same record.', 'warn'); return }
    setBusy(true)
    setError(null)
    const row: Record<string, string> = {}
    for (const f of fields) { const v = values[f.key]?.trim(); if (v) row[f.key] = v }
    if (strong.length && !submit) {
      const col = NOTES_COLUMN[kind]
      const line = `Created despite duplicate warning: ${override.trim()}`
      row[col] = row[col] ? `${row[col]}\n\n${line}` : line
    }
    const res: SheetSubmitResult = submit
      ? await submit(row, strong.length ? override.trim() : undefined)
      : await insertRecord(kind, row)
    setBusy(false)
    if (res.duplicates?.length) {
      // The server's verdict outranks the debounced preview: show its rows so
      // the buttons flip to Use existing / Create anyway.
      setDupes(res.duplicates)
      setError(`This ${label} may already exist.`)
      return
    }
    if (res.error || !res.id) {
      if (res.error?.code === '23505') {
        setError(kind === 'vehicle' ? 'That plate already exists.' : `That ${label} already exists.`)
        // The index said so — make sure the panel shows who to use instead.
        void findDuplicates(kind, payload).then(setDupes)
      } else {
        setError(res.error?.message ?? 'The record was not saved.')
      }
      return
    }
    toast(`${label.charAt(0).toUpperCase()}${label.slice(1)} created.`, 'success')
    onCreated(hitFor(kind, res.id, row))
    onClose()
  }

  const control = (f: CreateField, id: string) => {
    const v = values[f.key] ?? ''
    const set = (next: string) => setValues((s) => ({ ...s, [f.key]: next }))
    if (f.type === 'textarea') return <Textarea id={id} rows={3} value={v} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
    if (f.type === 'select') {
      return (
        <Select id={id} value={v} onChange={(e) => set(e.target.value)}>
          <option value="">Select…</option>
          {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )
    }
    return <Input id={id} type={f.type === 'date' ? 'date' : 'text'} value={v} placeholder={f.placeholder} onChange={(e) => set(e.target.value)} />
  }

  return (
    <Modal open={open} wide onClose={onClose} dirty={() => dirty}>
      <div className="p-6">
        <ModalHeader title={compare ? `Compare with ${compare.label}` : `New ${label}`} onClose={onClose} />

        {compare ? (
          <ComparePanel
            kind={kind} recordId={compare.id} recordLabel={compare.label} draft={values} fields={fields}
            onUseExisting={() => pickExisting(compare)} onBack={() => setCompare(null)}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((f) => (
                <Field key={f.key} label={f.label} required={f.required} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  {(id) => control(f, id)}
                </Field>
              ))}
            </div>

            <p className="sr-only" aria-live="polite">
              {checking ? 'Checking for existing records…' : strong.length ? `${strong.length} existing record${strong.length === 1 ? '' : 's'} may match.` : ''}
            </p>

            <DuplicatePanel
              rows={dupes} kind={kind} busy={busy}
              onUseExisting={pickExisting}
              onCompare={setCompare}
              onMerge={allowMerge && strong.length >= 2 ? setMergeRow : undefined}
            />

            {error && (
              <div role="alert" className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-sm text-rose-200">
                {error}
                {strong[0] && <> Use <span className="font-semibold">{strong[0].label}</span> instead?</>}
              </div>
            )}

            {strong.length > 0 && anyway && (
              <Field label="Why this is not the same record (required)" required hint="Appended to the new record's notes so the decision is visible later.">
                {(id) => <Input id={id} value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Different DOB confirmed by ID; the other profile is his brother." />}
              </Field>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
              {strong.length > 0 ? (
                <>
                  {anyway ? (
                    <Button variant="warn" loading={busy} disabled={!override.trim() || missing.length > 0} onClick={() => void save()}>
                      Create anyway
                    </Button>
                  ) : (
                    <Button variant="secondary" disabled={busy} onClick={() => setAnyway(true)}>Create anyway…</Button>
                  )}
                  <Button variant="primary" disabled={busy} onClick={() => pickExisting(strong[0])}>Use existing record</Button>
                </>
              ) : (
                <Button variant="primary" loading={busy} disabled={missing.length > 0 || checking} onClick={() => void save()}>
                  Create {label}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {mergeRow && (
        <MergeDialog
          kind={kind} open
          survivor={toHit(kind, mergeRow)}
          victims={strong.filter((d) => d.id !== mergeRow.id).map((d) => toHit(kind, d))}
          onClose={() => setMergeRow(null)}
          onMerged={() => { setMergeRow(null); void findDuplicates(kind, payload).then(setDupes) }}
        />
      )}
    </Modal>
  )
}
