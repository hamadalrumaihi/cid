'use client'

/** Manager/editor modals for the Narcotics dossier: the descriptive-fields
 *  Edit modal (charge_codes editing gated to managers), the Merge-duplicate
 *  picker (required reason → merge_narcotics), and the provisional resolver
 *  (resolve_provisional_narcotic). All writes route through db.update / db.rpc;
 *  the server (RLS + definer RPCs) is the authority — these only shape input. */
import { useEffect, useState } from 'react'
import type { Database, Json } from '@/lib/database.types'
import { rpc, update } from '@/lib/db'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { parseChargeCodes, type NarcoticRow } from './narcoticsDossier'
import { loadOtherNarcotics } from './narcoticsLoad'
import { NARCOTIC_CATEGORIES, NARCOTIC_STATUSES, categoryLabel, statusLabel } from './narcoticsRegistry'

type MergeArgs = Database['public']['Functions']['merge_narcotics']['Args']
type ResolveArgs = Database['public']['Functions']['resolve_provisional_narcotic']['Args']

/** 'merged' is set by the merge RPC only — never offered as a manual status. */
const EDITABLE_STATUSES = NARCOTIC_STATUSES.filter((s) => s !== 'merged')
const CONFIDENCE_OPTIONS = ['unverified', 'possible', 'probable', 'confirmed', 'disproven']
const PROVENANCE_OPTIONS = ['imported', 'reported', 'manually_confirmed', 'inferred', 'historical', 'disputed']

/* ── Edit descriptive fields ───────────────────────────────────────────────── */
export function NarcoticEditModal({ narcotic, canEditCharges, focusCharges, onClose, onSaved }: {
  narcotic: NarcoticRow
  /** Managers may edit the guard-frozen authority columns (status, category,
   *  classification, restricted, charge_codes); regular editors only edit the
   *  descriptive fields — the server guard silently reverts anything else. */
  canEditCharges: boolean
  /** Open scrolled/anchored to charge editing (from the Charges card). */
  focusCharges?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const n = narcotic
  const [name, setName] = useState(n.name ?? '')
  const [category, setCategory] = useState(n.category ?? 'unknown')
  const [status, setStatus] = useState(n.status ?? 'unidentified')
  const [classification, setClassification] = useState(n.classification ?? '')
  const [confidence, setConfidence] = useState(n.confidence ?? '')
  const [provenance, setProvenance] = useState(n.provenance ?? '')
  const [restricted, setRestricted] = useState(!!n.restricted)
  const [serverSpecific, setServerSpecific] = useState(!!n.server_specific)
  const [summary, setSummary] = useState(n.summary ?? '')
  const [significance, setSignificance] = useState(n.in_city_significance ?? '')
  const [appearance, setAppearance] = useState(n.appearance ?? '')
  const [packaging, setPackaging] = useState(n.packaging ?? '')
  const [sceneIndicators, setSceneIndicators] = useState(n.scene_indicators ?? '')
  const [officerSafety, setOfficerSafety] = useState(n.officer_safety ?? '')
  const [intelGaps, setIntelGaps] = useState(n.intelligence_gaps ?? '')
  const [charges, setCharges] = useState(parseChargeCodes(n.charge_codes).join(', '))
  const [busy, setBusy] = useState(false)

  // Discard-guard only when something actually changed from the opened values.
  const isDirty = () =>
    name !== (n.name ?? '') || category !== (n.category ?? 'unknown') || status !== (n.status ?? 'unidentified')
    || classification !== (n.classification ?? '') || confidence !== (n.confidence ?? '') || provenance !== (n.provenance ?? '')
    || restricted !== !!n.restricted || serverSpecific !== !!n.server_specific
    || summary !== (n.summary ?? '') || significance !== (n.in_city_significance ?? '') || appearance !== (n.appearance ?? '')
    || packaging !== (n.packaging ?? '') || sceneIndicators !== (n.scene_indicators ?? '') || officerSafety !== (n.officer_safety ?? '')
    || intelGaps !== (n.intelligence_gaps ?? '') || charges !== parseChargeCodes(n.charge_codes).join(', ')

  const save = async () => {
    if (!name.trim()) { toast('Name is required.', 'warn'); return }
    setBusy(true)
    const patch: Database['public']['Tables']['narcotics']['Update'] = {
      name: name.trim(),
      confidence: confidence.trim() || null,
      provenance: provenance.trim() || null,
      server_specific: serverSpecific,
      summary: summary.trim() || null,
      in_city_significance: significance.trim() || null,
      appearance: appearance.trim() || null,
      packaging: packaging.trim() || null,
      scene_indicators: sceneIndicators.trim() || null,
      officer_safety: officerSafety.trim() || null,
      intelligence_gaps: intelGaps.trim() || null,
    }
    // Authority columns are guard-frozen server-side for non-managers — only
    // send them when the caller can actually change them.
    if (canEditCharges) {
      patch.category = category
      patch.status = status
      patch.classification = classification.trim() || null
      patch.restricted = restricted
      const codes = charges.split(/[,\n]/).map((c) => c.trim()).filter(Boolean)
      patch.charge_codes = codes as unknown as Json
    }
    const res = await update('narcotics', n.id, patch)
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Narcotic updated', 'success')
    onSaved()
  }

  return (
    <Modal open wide onClose={onClose} dirty={isDirty}>
      <div className="p-5 sm:p-6">
        <ModalHeader title="Edit narcotic" onClose={onClose} />
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
            {canEditCharges && <Field label="Category">{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>{NARCOTIC_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}</Select>}</Field>}
            {canEditCharges && <Field label="Status">{(id) => <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>{EDITABLE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</Select>}</Field>}
            {canEditCharges && <Field label="Classification">{(id) => <Input id={id} value={classification} onChange={(e) => setClassification(e.target.value)} placeholder="e.g. Schedule II" />}</Field>}
            <Field label="Confidence">{(id) => <Select id={id} value={confidence} onChange={(e) => setConfidence(e.target.value)}><option value="">—</option>{CONFIDENCE_OPTIONS.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</Select>}</Field>
            <Field label="Provenance">{(id) => <Select id={id} value={provenance} onChange={(e) => setProvenance(e.target.value)}><option value="">—</option>{PROVENANCE_OPTIONS.map((p) => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}</Select>}</Field>
          </div>

          <div className="flex flex-wrap gap-4">
            {canEditCharges && <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} /> Restricted</label>}
            <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={serverSpecific} onChange={(e) => setServerSpecific(e.target.checked)} /> Server-specific</label>
          </div>

          <Field label="Summary">{(id) => <Textarea id={id} value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />}</Field>
          <Field label="Significance in the city">{(id) => <Textarea id={id} value={significance} onChange={(e) => setSignificance(e.target.value)} rows={2} />}</Field>
          <Field label="Typical form / appearance">{(id) => <Textarea id={id} value={appearance} onChange={(e) => setAppearance(e.target.value)} rows={2} />}</Field>
          <Field label="Packaging indicators">{(id) => <Textarea id={id} value={packaging} onChange={(e) => setPackaging(e.target.value)} rows={2} />}</Field>
          <Field label="Scene indicators">{(id) => <Textarea id={id} value={sceneIndicators} onChange={(e) => setSceneIndicators(e.target.value)} rows={2} />}</Field>
          <Field label="Officer-safety notes">{(id) => <Textarea id={id} value={officerSafety} onChange={(e) => setOfficerSafety(e.target.value)} rows={2} />}</Field>
          <Field label="Intelligence gaps">{(id) => <Textarea id={id} value={intelGaps} onChange={(e) => setIntelGaps(e.target.value)} rows={2} />}</Field>

          {canEditCharges && (
            <Field label="Related charge codes" hint="Comma- or newline-separated penal codes (e.g. (6)01, (6)02). Titles resolve automatically.">
              {(id) => <Textarea id={id} value={charges} onChange={(e) => setCharges(e.target.value)} rows={2} autoFocus={focusCharges} />}
            </Field>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onAction={save}>Save changes</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Merge duplicate ───────────────────────────────────────────────────────── */
export function NarcoticMergeModal({ narcotic, onClose, onMerged }: {
  narcotic: NarcoticRow
  onClose: () => void
  onMerged: (survivorId: string) => void
}) {
  const [options, setOptions] = useState<Array<{ id: string; name: string }>>([])
  const [duplicateId, setDuplicateId] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let on = true
    void loadOtherNarcotics(narcotic.id).then((rows) => { if (on) setOptions(rows) })
    return () => { on = false }
  }, [narcotic.id])

  const error = !duplicateId ? 'Choose the duplicate to merge in.' : reason.trim() === '' ? 'A merge reason is required.' : null

  const merge = async () => {
    if (error) return
    setBusy(true)
    // This record survives; the picked duplicate is merged into it.
    const args: MergeArgs = { p_survivor: narcotic.id, p_merged: duplicateId, p_reason: reason.trim() }
    const res = await rpc('merge_narcotics', args)
    setBusy(false)
    if (res.error) { toast(`Merge failed: ${res.error.message}`, 'danger'); return }
    toast('Narcotics merged', 'success')
    onMerged(narcotic.id)
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!(duplicateId || reason.trim())}>
      <div className="p-5 sm:p-6">
        <ModalHeader title="Merge duplicate" onClose={onClose} />
        <p className="mb-4 text-sm text-slate-400">
          <span className="font-semibold text-white">{narcotic.name}</span> will be kept. The selected duplicate is merged into it and its links are re-pointed. This cannot be undone.
        </p>
        <div className="space-y-4">
          <Field label="Duplicate to merge in" required>
            {(id) => (
              <Select id={id} value={duplicateId} onChange={(e) => setDuplicateId(e.target.value)}>
                <option value="">Choose a substance…</option>
                {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Reason" required hint="Recorded on the merge for the audit trail.">
            {(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />}
          </Field>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-amber-300">{error}</p>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={!!error} loading={busy} onAction={merge}>Merge</Button>
        </div>
      </div>
    </Modal>
  )
}

/* ── Resolve provisional ───────────────────────────────────────────────────── */
export function NarcoticResolveModal({ narcotic, onClose, onResolved }: {
  narcotic: NarcoticRow
  onClose: () => void
  onResolved: () => void
}) {
  const [action, setAction] = useState<'confirm' | 'reject' | 'archive'>('confirm')
  const [canonicalId, setCanonicalId] = useState('')
  const [note, setNote] = useState('')
  const [options, setOptions] = useState<Array<{ id: string; name: string }>>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let on = true
    void loadOtherNarcotics(narcotic.id).then((rows) => { if (on) setOptions(rows) })
    return () => { on = false }
  }, [narcotic.id])

  // The RPC vocabulary is confirm | merge_into | disprove | archive — a reject
  // that points at an established record is a merge; without one it's disproven.
  const rpcAction = action === 'reject' ? (canonicalId ? 'merge_into' : 'disprove') : action

  const resolve = async () => {
    setBusy(true)
    const args: ResolveArgs = {
      p_provisional: narcotic.id,
      p_action: rpcAction,
      ...(rpcAction === 'merge_into' ? { p_canonical: canonicalId } : {}),
      ...(note.trim() ? { p_note: note.trim() } : {}),
    }
    const res = await rpc('resolve_provisional_narcotic', args)
    setBusy(false)
    if (res.error) { toast(`Resolve failed: ${res.error.message}`, 'danger'); return }
    toast(action === 'confirm' ? 'Provisional confirmed' : 'Provisional resolved', 'success')
    onResolved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!(note.trim() || canonicalId)}>
      <div className="p-5 sm:p-6">
        <ModalHeader title="Resolve provisional record" onClose={onClose} />
        <p className="mb-4 text-sm text-slate-400">
          Confirm <span className="font-semibold text-white">{narcotic.name}</span> as an established substance, reject it — optionally merging it into the established record it duplicates — or archive it.
        </p>
        <div className="space-y-4">
          <Field label="Action">
            {(id) => (
              <Select id={id} value={action} onChange={(e) => setAction(e.target.value as 'confirm' | 'reject' | 'archive')}>
                <option value="confirm">Confirm as established</option>
                <option value="reject">Reject provisional</option>
                <option value="archive">Archive</option>
              </Select>
            )}
          </Field>
          {action === 'reject' && (
            <Field label="Established record" hint="Optional — pick the record this one duplicates to merge into it; leave empty to mark it disproven.">
              {(id) => (
                <Select id={id} value={canonicalId} onChange={(e) => setCanonicalId(e.target.value)}>
                  <option value="">None</option>
                  {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Note" hint="Optional — recorded with the decision.">
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />}
          </Field>
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onAction={resolve}>{action === 'confirm' ? 'Confirm' : 'Resolve'}</Button>
        </div>
      </div>
    </Modal>
  )
}
