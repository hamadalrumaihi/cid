'use client'

/** Narcotics suggestion form — the quiet "suggest a correction" modal that
 *  feeds `submit_narcotic_suggestion`. Shared by the dossier's "Suggest
 *  correction" action and, exported, by the registry. Every officer may submit;
 *  a manager reviews it — submitting never edits the registry. Vocabulary,
 *  param-building and validation come from the pure model (narcoticsDossier);
 *  this component only wires state → RPC. Authority stays server-side. */
import { useState } from 'react'
import type { Database } from '@/lib/database.types'
import { rpc } from '@/lib/db'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import {
  NARCOTIC_SUGGESTION_TYPES, NARCOTIC_SUGGESTION_TYPE_HINT, NARCOTIC_SUGGESTION_TYPE_LABEL,
  narcoticSuggestionFormError, narcoticSuggestionParams,
  type NarcoticSuggestionType,
} from './narcoticsDossier'

type SubmitArgs = Database['public']['Functions']['submit_narcotic_suggestion']['Args']

export function NarcoticsSuggestionForm({ narcoticId, narcoticName, onClose, onSubmitted }: {
  narcoticId: string
  narcoticName?: string
  onClose: () => void
  onSubmitted?: () => void
}) {
  const [type, setType] = useState<NarcoticSuggestionType | ''>('')
  const [title, setTitle] = useState('')
  const [explanation, setExplanation] = useState('')
  const [proposed, setProposed] = useState('')
  const [sourceCase, setSourceCase] = useState('')
  const [busy, setBusy] = useState(false)

  const error = narcoticSuggestionFormError({ type, title, explanation })
  const isDirty = () => !!(type || title.trim() || explanation.trim() || proposed.trim() || sourceCase.trim())

  const submit = async () => {
    if (error || !type) return
    setBusy(true)
    const params = narcoticSuggestionParams({
      narcoticId, type, title, explanation,
      proposedValue: proposed,
      sourceCaseId: sourceCase.trim() || null,
    })
    const res = await rpc('submit_narcotic_suggestion', params as unknown as SubmitArgs)
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Suggestion submitted — a narcotics manager will review it.', 'success')
    onSubmitted?.()
    onClose()
  }

  return (
    <Modal open wide onClose={onClose} dirty={isDirty}>
      <div className="p-5 sm:p-6">
        <ModalHeader title="Suggest a correction" onClose={onClose} />

        {narcoticName && (
          <div className="mb-4 rounded-xl border border-white/10 bg-ink-900/60 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Suggesting a correction to</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-white">{narcoticName}</p>
          </div>
        )}
        <p className="mb-4 text-sm text-slate-400">
          Flag something that should change on this substance. A manager reviews every suggestion; submitting does not edit the registry.
        </p>

        <div className="space-y-4">
          <Field label="What kind of correction is this?" required hint={type ? NARCOTIC_SUGGESTION_TYPE_HINT[type] : 'Pick the closest category.'}>
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as NarcoticSuggestionType | '')}>
                <option value="">Choose a category…</option>
                {NARCOTIC_SUGGESTION_TYPES.map((t) => (
                  <option key={t} value={t}>{NARCOTIC_SUGGESTION_TYPE_LABEL[t]}</option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Title" required>
            {(id) => (
              <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="A short summary of the correction" />
            )}
          </Field>

          <Field label="Explanation" required hint="What is wrong or missing, and why it matters.">
            {(id) => <Textarea id={id} value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={4} />}
          </Field>

          <Field label="Proposed value" hint="Optional — the corrected name, alias, category, or wording.">
            {(id) => <Textarea id={id} value={proposed} onChange={(e) => setProposed(e.target.value)} rows={2} />}
          </Field>

          <Field label="Source case ID" hint="Optional — a case that supports this correction.">
            {(id) => <Input id={id} value={sourceCase} onChange={(e) => setSourceCase(e.target.value)} placeholder="Case UUID (optional)" />}
          </Field>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-amber-300">{error}</p>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!!error} loading={busy} onAction={submit}>Submit suggestion</Button>
        </div>
      </div>
    </Modal>
  )
}
