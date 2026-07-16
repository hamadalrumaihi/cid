'use client'

/** Suggestion form — the quiet "suggest a change / improvement" modal that
 *  feeds `submit_document_suggestion`. Two entry contexts share this one form:
 *   - from the reader with a SuggestChangeContext (document/version/section/url
 *     prefilled, shown read-only), and
 *   - from the library header with no document (a general or new-document
 *     proposal — the member may attach a document, or leave it unattached when
 *     proposing a whole new document).
 *  All vocabulary, param-building and validation come from the pure model
 *  (docSuggestions) — this component only wires state → RPC. Authority stays
 *  server-side; the button gate is a courtesy mirror. */
import { useEffect, useState } from 'react'
import type { Database } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { docTitle } from './docModel'
import {
  SUGGESTION_TYPES, SUGGESTION_TYPE_HINT, SUGGESTION_TYPE_LABEL,
  submitSuggestionParams, suggestionFormError,
  type SubmitSuggestionInput, type SuggestChangeContext, type Suggestion, type SuggestionType,
} from './docSuggestions'

type SubmitArgs = Database['public']['Functions']['submit_document_suggestion']['Args']
interface DocOption { id: string; name: string }

export function SuggestionForm({ context, onClose, onSubmitted }: {
  /** Reader context (document anchored) or null for the general library entry. */
  context: SuggestChangeContext | null
  onClose: () => void
  onSubmitted?: (s: Suggestion) => void
}) {
  const general = context === null

  const [type, setType] = useState<SuggestionType | ''>('')
  const [title, setTitle] = useState('')
  const [explanation, setExplanation] = useState('')
  const [proposed, setProposed] = useState('')
  const [relatedCase, setRelatedCase] = useState('')
  const [pickedDoc, setPickedDoc] = useState('') // general entry only
  const [docs, setDocs] = useState<DocOption[]>([])
  const [ctxTitle, setCtxTitle] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A general proposal typed as new_document needs no target document.
  const isNewDoc = type === 'new_document'

  // General entry: offer the caller's visible documents to attach to (RLS
  // scopes the list). Reader entry: resolve the anchored document's title.
  useEffect(() => {
    let on = true
    void (async () => {
      if (general) {
        const rows = await list('documents', { select: 'id,name', order: 'name', ascending: true }).catch(() => [])
        if (on) setDocs(rows as unknown as DocOption[])
      } else if (context) {
        const rows = await list('documents', { select: 'id,name', eq: { id: context.documentId } }).catch(() => [])
        if (on) setCtxTitle(rows.length ? docTitle((rows[0] as unknown as DocOption).name) : null)
      }
    })()
    return () => { on = false }
  }, [general, context])

  const error = suggestionFormError({ title, explanation, type })
  // Passed straight to Modal, which routes the (changing) identity through its
  // own ref+effect — so no ref read is needed here.
  const isDirty = () =>
    !!(type || title.trim() || explanation.trim() || proposed.trim() || relatedCase.trim() || pickedDoc)

  const submit = async () => {
    if (error || !type) return
    setBusy(true)
    const documentId = general ? (isNewDoc ? null : (pickedDoc || null)) : context!.documentId
    const input: SubmitSuggestionInput = {
      documentId,
      type,
      title,
      explanation,
      sectionId: context?.sectionId ?? null,
      sectionTitle: context?.sectionTitle ?? null,
      proposedText: proposed,
      relatedCaseId: relatedCase.trim() || null,
      sourceUrl: context?.url ?? null,
    }
    const params = submitSuggestionParams(input)
    const res = await rpc('submit_document_suggestion', params as unknown as SubmitArgs)
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Suggestion submitted — your document managers will review it.', 'success')
    onSubmitted?.(res.data as unknown as Suggestion)
    onClose()
  }

  const anchorLabel = context && (ctxTitle || 'this document') + (context.sectionTitle ? ` · ${context.sectionTitle}` : '')

  return (
    <Modal open wide onClose={onClose} dirty={isDirty}>
      <div className="p-5 sm:p-6">
        <ModalHeader title={general ? 'Suggest an improvement' : 'Suggest a change'} onClose={onClose} />

        {context ? (
          <div className="mb-4 rounded-xl border border-white/10 bg-ink-900/60 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Suggesting a change to</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-white">{anchorLabel}</p>
          </div>
        ) : (
          <p className="mb-4 text-sm text-slate-400">
            Flag something that should change in the library — or propose a whole new document. A manager reviews every
            suggestion; submitting does not edit any SOP.
          </p>
        )}

        <div className="space-y-4">
          <Field label="What kind of change is this?" required hint={type ? SUGGESTION_TYPE_HINT[type] : 'Pick the closest category.'}>
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as SuggestionType | '')}>
                <option value="">Choose a category…</option>
                {SUGGESTION_TYPES.map((t) => (
                  <option key={t} value={t}>{SUGGESTION_TYPE_LABEL[t]}</option>
                ))}
              </Select>
            )}
          </Field>

          {general && !isNewDoc && (
            <Field label="Attach to a document" hint="Optional — leave empty for a general suggestion.">
              {(id) => (
                <Select id={id} value={pickedDoc} onChange={(e) => setPickedDoc(e.target.value)}>
                  <option value="">No specific document</option>
                  {docs.map((d) => <option key={d.id} value={d.id}>{docTitle(d.name)}</option>)}
                </Select>
              )}
            </Field>
          )}

          <Field label="Title" required>
            {(id) => (
              <Input
                id={id}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={160}
                placeholder="A short summary of the change"
              />
            )}
          </Field>

          <Field label="Explanation" required hint="What is wrong or missing, and why it matters.">
            {(id) => (
              <Textarea id={id} value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={4} />
            )}
          </Field>

          <Field label="Proposed text" hint="Optional — suggested wording the editor could adopt.">
            {(id) => (
              <Textarea id={id} value={proposed} onChange={(e) => setProposed(e.target.value)} rows={3} />
            )}
          </Field>

          <Field label="Related case ID" hint="Optional — a case that prompted this suggestion.">
            {(id) => (
              <Input
                id={id}
                value={relatedCase}
                onChange={(e) => setRelatedCase(e.target.value)}
                placeholder="Case UUID (optional)"
              />
            )}
          </Field>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          {error && <p className="mr-auto text-xs text-amber-300">{error}</p>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!!error} loading={busy} onAction={submit}>
            Submit suggestion
          </Button>
        </div>
      </div>
    </Modal>
  )
}
