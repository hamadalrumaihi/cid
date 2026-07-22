'use client'

/** Returned-record extraction (Phase 4b) — the case-scoped log of ingested
 *  records-returns (a subpoena reply, a city import, a manual transcription)
 *  and the individual FACTS pulled out of each one.
 *
 *  Two tables back this tab, both RLS-gated on case access:
 *   - `record_extractions`  — one row per ingested return. Plain insert/select/
 *     update for anyone who can work the case; DELETE is command-only (surfaced
 *     to `isCommand` here, but the server is the real gate).
 *   - `record_extraction_facts` — SELECT-only for clients. Facts are NEVER
 *     inserted directly; every one is created through the `extraction_add_fact`
 *     RPC, which routes account/phone/email/address identifiers into the
 *     Indicators registry, find-or-creates the account (for account/ownership
 *     with a platform), and auto-links ownership at **suspected** — confirming
 *     ownership stays a separate command action.
 *
 *  `source_location` is the provenance guardrail: the RPC rejects a blank one,
 *  so every fact carries where in the return it came from. The add-fact form
 *  makes that requirement loud, and the fact list always shows it. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { insert, list, ilikeAny, remove, rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { officerName } from '@/lib/profiles'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'
import { type CaseRow, type ExtractionRow, type ExtractionFactRow } from './shared'

// record_extractions.source_kind CHECK vocabulary (nullable — unspecified is
// allowed). Labels are cosmetic; the stored values match the column.
const SOURCE_KINDS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'manual', label: 'Manual' },
  { id: 'city_import', label: 'City import' },
]
const sourceKindLabel = (k: string | null): string =>
  SOURCE_KINDS.find((s) => s.id === k)?.label ?? 'Unspecified'

// record_extraction_facts.fact_type CHECK vocabulary. The identifier kinds
// (account/phone/email/address) are the ones the RPC routes into Indicators;
// `ownership` additionally auto-links the account to a person at suspected.
const FACT_TYPES: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'account', label: 'Account' },
  { id: 'phone', label: 'Phone' },
  { id: 'email', label: 'Email' },
  { id: 'address', label: 'Address' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'property', label: 'Property' },
  { id: 'other', label: 'Other' },
]
const factTypeLabel = (t: string): string => FACT_TYPES.find((f) => f.id === t)?.label ?? t

// Fact-type chip tint — identifiers read as accent (they route to the
// registry), ownership as warn (it asserts a link), the rest neutral/good.
const FACT_TINT: Record<string, string> = {
  account: 'bg-blue-500/15 text-blue-300',
  phone: 'bg-blue-500/15 text-blue-300',
  email: 'bg-blue-500/15 text-blue-300',
  address: 'bg-blue-500/15 text-blue-300',
  ownership: 'bg-amber-500/15 text-amber-300',
  property: 'bg-emerald-500/15 text-emerald-300',
  other: 'bg-white/5 text-slate-300',
}

// Types that reveal the platform + owner-person fields. account uses them to
// find-or-create the account; ownership REQUIRES both (server-enforced).
const needsAccountFields = (t: string) => t === 'account' || t === 'ownership'

export function ExtractionsTab({ c, canEdit }: { c: CaseRow; canEdit: boolean }) {
  const { isCommand } = useAuth()
  const [rows, setRows] = useState<ExtractionRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const v = useTableVersion('record_extractions')

  const refresh = useCallback(async () => {
    try {
      const data = await list('record_extractions', { eq: { case_id: c.id }, order: 'created_at', ascending: false })
      setRows(data)
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  const selected = useMemo(() => rows?.find((r) => r.id === selectedId) ?? null, [rows, selectedId])

  // Drill-in view: one extraction and its facts.
  if (selected) {
    return (
      <ExtractionDetail
        extraction={selected}
        canEdit={canEdit}
        onBack={() => setSelectedId(null)}
      />
    )
  }

  if (error) return <ErrorNotice message={error} onRetry={() => void refresh()} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold text-white">Record extractions</h3>
          <p className="text-sm text-slate-400">
            Ingested records-returns and the facts pulled from them. Identifiers are routed into the Indicators registry as you add them.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" onClick={() => setCreating(true)}>New extraction</Button>
        )}
      </div>

      {rows === null ? (
        <Notice text="Loading extractions…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="🗂"
          title="No extractions yet"
          hint={canEdit
            ? 'Log a records-return (a subpoena reply, a city data import, a manual transcription) to start pulling structured facts from it.'
            : 'Nothing has been ingested for this case yet.'}
          action={canEdit ? { label: 'New extraction', onClick: () => setCreating(true) } : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id}>
              <Card pad="sm" interactive className="flex flex-wrap items-center justify-between gap-3">
                <button
                  onClick={() => setSelectedId(r.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold text-white">{r.source_label}</span>
                    <Badge tint={r.source_kind ? 'bg-blue-500/15 text-blue-300' : 'bg-white/5 text-slate-400'}>
                      {sourceKindLabel(r.source_kind)}
                    </Badge>
                    {r.source_ref && <span className="truncate text-xs text-slate-400">Ref: {r.source_ref}</span>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {officerName(r.created_by) || 'Unknown'} · {fmtDate(r.created_at)}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => setSelectedId(r.id)}>View facts</Button>
                  {/* Delete is command-only (RLS enforces it); the affordance
                      appears only for command and the server is the real gate. */}
                  {isCommand && (
                    <Button size="sm" variant="danger" onClick={() => void deleteExtraction(r, refresh)}>Delete</Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <NewExtractionModal
          caseId={c.id}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void refresh(); setSelectedId(id) }}
        />
      )}
    </div>
  )
}

/** Command-only hard delete (no undo — the extraction's facts are RPC-write
 *  only, so a re-insert could not restore them). Routed indicators/accounts
 *  live in their own registries and are NOT touched. The server re-checks the
 *  command gate; a denied delete surfaces its reason. */
async function deleteExtraction(r: ExtractionRow, after: () => void): Promise<void> {
  const ok = await uiConfirm(
    `Delete “${r.source_label}” and all its extracted facts? The facts and their source citations are removed and this cannot be undone. Indicators and accounts already routed into the registries are kept.`,
    { title: 'Delete extraction', confirmText: 'Delete extraction' },
  )
  if (!ok) return
  const res = await remove('record_extractions', r.id)
  if (res.error) { toast(res.error.message, 'danger'); return }
  toast('Extraction deleted.', 'success')
  after()
}

/* ── New extraction — a plain, RLS-guarded insert (case_id + source_label +
 *  optional kind/ref/notes). source_label must be non-blank (DB CHECK). ─────── */
function NewExtractionModal({ caseId, onClose, onCreated }: { caseId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState('manual')
  const [ref, setRef] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const dirty = () => !!(label.trim() || ref.trim() || notes.trim())

  const save = async () => {
    if (!label.trim() || busy) return
    setBusy(true)
    const res = await insert('record_extractions', {
      case_id: caseId,
      source_label: label.trim(),
      source_kind: kind || null,
      source_ref: ref.trim() || null,
      notes: notes.trim() || null,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Extraction created.', 'success')
    onCreated(res.data?.[0]?.id ?? '')
  }

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-5">
        <ModalHeader title="New extraction" onClose={onClose} />
        <p className="mb-4 text-sm text-slate-400">
          Log a records-return so its facts can be pulled out and cited. You add the individual facts on the next screen.
        </p>
        <div className="space-y-3">
          <Field label="Source label" required hint="What was returned — e.g. “Bank subpoena reply”, “City vehicle export”.">
            {(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Records-return description" />}
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Source kind">
              {(id) => (
                <Select id={id} value={kind} onChange={(e) => setKind(e.target.value)}>
                  {SOURCE_KINDS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Source reference (optional)" hint="A case/warrant/export id you can trace back to.">
              {(id) => <Input id={id} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. SW-2231" />}
            </Field>
          </div>
          <Field label="Notes (optional)">
            {(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Context on this return" />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy || !label.trim()}>
            {busy ? 'Creating…' : 'Create extraction'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Extraction detail — meta, add-fact form and the fact list ──────────────── */
function ExtractionDetail({ extraction, canEdit, onBack }: { extraction: ExtractionRow; canEdit: boolean; onBack: () => void }) {
  const [facts, setFacts] = useState<ExtractionFactRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const v = useTableVersion('record_extraction_facts')

  const refresh = useCallback(async () => {
    try {
      const data = await list('record_extraction_facts', { eq: { extraction_id: extraction.id }, order: 'created_at', ascending: false })
      setFacts(data)
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [extraction.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-slate-400 transition hover:text-white">← Back to extractions</button>

      <Card pad="sm" className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-white">{extraction.source_label}</h3>
          <Badge tint={extraction.source_kind ? 'bg-blue-500/15 text-blue-300' : 'bg-white/5 text-slate-400'}>
            {sourceKindLabel(extraction.source_kind)}
          </Badge>
        </div>
        <p className="text-xs text-slate-500">
          {extraction.source_ref && <>Ref: {extraction.source_ref} · </>}
          Logged by {officerName(extraction.created_by) || 'Unknown'} · {fmtDateTime(extraction.created_at)}
        </p>
        {extraction.notes && <p className="pt-1 text-sm text-slate-300">{extraction.notes}</p>}
      </Card>

      {canEdit && <AddFactForm extractionId={extraction.id} onAdded={refresh} />}

      {error ? (
        <ErrorNotice message={error} onRetry={() => void refresh()} />
      ) : facts === null ? (
        <Notice text="Loading facts…" />
      ) : facts.length === 0 ? (
        <EmptyState
          icon="🔎"
          title="No facts extracted yet"
          hint={canEdit
            ? 'Add a fact above. Every fact must cite where in the return it came from.'
            : 'Nothing has been pulled from this return yet.'}
        />
      ) : (
        <ul className="space-y-2">
          {facts.map((f) => <FactRow key={f.id} f={f} />)}
        </ul>
      )}
    </div>
  )
}

/* ── One extracted fact — type, value, and ALWAYS its source_location (the
 *  provenance guardrail), plus any routed-registry chips and a note. ────────── */
function FactRow({ f }: { f: ExtractionFactRow }) {
  return (
    <li>
      <Card pad="sm" className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tint={FACT_TINT[f.fact_type] ?? FACT_TINT.other}>{factTypeLabel(f.fact_type)}</Badge>
          <span className="min-w-0 break-words font-semibold text-white">{f.value}</span>
        </div>
        {/* Provenance is never optional — where in the return this came from. */}
        <p className="text-xs text-slate-400">
          <span className="font-semibold uppercase tracking-[0.12em] text-slate-500">Source</span> · {f.source_location}
        </p>
        {(f.linked_indicator_id || f.linked_account_id || f.linked_link_id) && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {f.linked_indicator_id && <Badge tone="accent">→ Indicator</Badge>}
            {f.linked_account_id && (
              <Link href="/accounts">
                <Badge tone="accent" className="hover:brightness-125">→ Account</Badge>
              </Link>
            )}
            {f.linked_link_id && <Badge tone="warn">→ Ownership (suspected)</Badge>}
          </div>
        )}
        {f.note && <p className="text-sm text-slate-300">{f.note}</p>}
      </Card>
    </li>
  )
}

/* ── Add-fact form — the ONLY write path into record_extraction_facts (the
 *  extraction_add_fact RPC). Client-validates value + source_location non-blank
 *  and (for ownership) platform + owner; the server re-validates all of it. ─── */
function AddFactForm({ extractionId, onAdded }: { extractionId: string; onAdded: () => void }) {
  const [factType, setFactType] = useState('phone')
  const [value, setValue] = useState('')
  const [sourceLocation, setSourceLocation] = useState('')
  const [platform, setPlatform] = useState('')
  const [owner, setOwner] = useState<PickedRecord | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const showAccountFields = needsAccountFields(factType)
  const isOwnership = factType === 'ownership'

  // Person owner search — RLS-scoped, bounded (ilikeAny + limit 20), same idiom
  // as the Intel tab's person picker.
  const searchPersons = useCallback(async (q: string): Promise<PickedRecord[]> => {
    const or = ilikeAny(['name', 'alias'], q)
    const r = (await list('persons', { select: 'id,name,alias', order: 'name', limit: 20, ...(or ? { or } : {}) })) as unknown as { id: string; name: string; alias: string | null }[]
    return r.map((p) => ({ id: p.id, label: p.name || 'Person', ...(p.alias ? { sublabel: `“${p.alias}”` } : {}) }))
  }, [])

  const valid =
    value.trim() !== '' &&
    sourceLocation.trim() !== '' &&
    (!isOwnership || (platform.trim() !== '' && !!owner))

  const reset = () => { setValue(''); setSourceLocation(''); setPlatform(''); setOwner(null); setNote('') }

  const add = async () => {
    if (!valid || busy) return
    setBusy(true)
    // Only send the account fields when the type uses them; ownership requires
    // both (guarded above), account may find-or-create with just a platform.
    const res = await rpc('extraction_add_fact', {
      p_extraction: extractionId,
      p_fact_type: factType,
      p_value: value.trim(),
      p_source_location: sourceLocation.trim(),
      ...(showAccountFields && platform.trim() ? { p_platform: platform.trim() } : {}),
      ...(showAccountFields && owner ? { p_owner_person: owner.id } : {}),
      ...(note.trim() ? { p_note: note.trim() } : {}),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    reset()
    toast('Fact added.', 'success')
    onAdded()
  }

  return (
    <Card pad="sm" className="space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Add fact</h3>
      <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Fact type">
          {(id) => (
            <Select id={id} value={factType} onChange={(e) => { setFactType(e.target.value); setOwner(null) }}>
              {FACT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Value" required hint="The identifier or fact as it appears in the return.">
          {(id) => <Input id={id} value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 555-0142, jdoe@mail.rp, 12 Vine St" />}
        </Field>
      </div>

      {/* Source location is the provenance guardrail — the RPC rejects a blank
          one. It gets its own full-width row and an explicit requirement note. */}
      <Field label="Source location" required hint="Required — where in the return this came from (page, line, section, timestamp). Every fact must cite its source.">
        {(id) => <Input id={id} value={sourceLocation} onChange={(e) => setSourceLocation(e.target.value)} placeholder="e.g. Page 4, line 12" />}
      </Field>

      {showAccountFields && (
        <div className="space-y-3 rounded-lg border border-white/10 bg-ink-950/40 p-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Platform"
              required={isOwnership}
              hint={isOwnership ? 'Required for ownership.' : 'Used to find or create the account.'}
            >
              {(id) => <Input id={id} value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="e.g. Birdy, InstaPic" />}
            </Field>
            <RecordSearchPicker
              label="Owner (person)"
              required={isOwnership}
              hint={isOwnership ? 'Required for ownership.' : 'Optional — asserts who operates the account.'}
              value={owner}
              onChange={setOwner}
              search={searchPersons}
              placeholder="Search persons…"
            />
          </div>
          {isOwnership && (
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              An owner assertion auto-links at <span className="font-semibold">suspected</span> — it never auto-confirms. Confirming ownership is a separate command action in the Account Registry.
            </p>
          )}
        </div>
      )}

      <Field label="Note (optional)">
        {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything worth flagging about this fact" />}
      </Field>

      <Button variant="primary" onClick={() => void add()} disabled={busy || !valid}>
        {busy ? 'Adding…' : 'Add fact'}
      </Button>
    </Card>
  )
}
