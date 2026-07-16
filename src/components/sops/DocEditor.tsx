'use client'

/** Governed document editor modal. CREATE inserts a draft directly (folder
 *  'SOPs', status 'draft') and hands the id back so the caller can open the
 *  reader; EDIT goes through rpc document_save so the server captures the
 *  version snapshot, bumps current_version_number, and re-validates the
 *  change-type/summary rules mirrored here (MATERIAL_CHANGE from docModel).
 *  Never a direct documents.content overwrite. The form mounts only once the
 *  row is loaded so its state (and the initial-only RichEditor) seeds from
 *  the real server copy. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Json } from '@/lib/database.types'
import { insert, list, rpc, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { ErrorNotice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { RichEditor } from '@/components/ui/RichEditor'
import {
  CATEGORY_LABEL, CATEGORY_ORDER, CHANGE_TYPE_LABEL, CLASS_LABEL, MATERIAL_CHANGE, TYPE_LABEL,
  canApproveDoc, docTitle, type ChangeType, type DocRow, type DocViewer, type DocumentCategory,
  type DocumentClassification, type DocumentType,
} from './docModel'

const bodyOf = (d: DocRow): string => {
  const c = d.content
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const b = (c as Record<string, unknown>).body
    if (typeof b === 'string') return b
  }
  return ''
}

const CHANGE_TYPES = (Object.keys(CHANGE_TYPE_LABEL) as ChangeType[]).filter((t) => t !== 'restore')
const CLASS_TIERS: DocumentClassification[] = ['internal', 'restricted', 'command', 'justice', 'owner']
const TYPE_ORDER = Object.keys(TYPE_LABEL) as DocumentType[]

export function DocEditorModal(props: {
  docId?: string | null
  onClose: () => void
  onSaved: (id: string) => void
}): React.ReactElement {
  const { docId, onClose, onSaved } = props
  const { profile, isCommand, isOwner, justiceRole } = useAuth()
  const creating = !docId

  const viewer: DocViewer = useMemo(() => ({
    userId: profile?.id ?? null,
    active: !!profile?.active,
    role: profile?.role ?? null,
    isCommand,
    isOwner,
    justiceRole,
  }), [profile, isCommand, isOwner, justiceRole])

  // EDIT loads its own full row so the editor never trusts a stale prop.
  const [doc, setDoc] = useState<DocRow | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  useEffect(() => {
    if (!docId) return
    let on = true
    void (async () => {
      try {
        const rows = await withRetry(() => list('documents', { eq: { id: docId } }))
        if (!on) return
        if (rows.length) setDoc(rows[0])
        else setLoadError('This document isn’t available — it may have been removed or you don’t have access.')
      } catch (e) { if (on) setLoadError(e) }
    })()
    return () => { on = false }
  }, [docId])

  // The form (below) owns the fields; it publishes its dirty check here so
  // the Modal's discard guard covers × / Esc / backdrop.
  const dirtyRef = useRef<() => boolean>(() => false)
  const ready = creating || !!doc

  return (
    <Modal open onClose={onClose} wide dirty={() => dirtyRef.current()}>
      <ModalHeader title={creating ? 'New document' : `Edit — ${doc ? docTitle(doc.name) : 'document'}`} onClose={onClose} />
      {!creating && loadError != null ? (
        <ErrorNotice message={loadError} />
      ) : !ready ? (
        <div className="space-y-3" role="status" aria-busy="true">
          <span className="sr-only">Loading document…</span>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <EditorForm
          doc={doc}
          viewer={viewer}
          onSaved={onSaved}
          registerDirty={(fn) => { dirtyRef.current = fn }}
        />
      )}
    </Modal>
  )
}

function EditorForm({ doc, viewer, onSaved, registerDirty }: {
  /** null → create a new draft; a row → edit through document_save. */
  doc: DocRow | null
  viewer: DocViewer
  onSaved: (id: string) => void
  registerDirty: (fn: () => boolean) => void
}) {
  const creating = !doc
  const [name, setName] = useState(() => (doc ? docTitle(doc.name) : ''))
  const [body, setBody] = useState(() => (doc ? bodyOf(doc) : ''))
  const [category, setCategory] = useState<DocumentCategory>('sops')
  const [docType, setDocType] = useState<DocumentType>('sop')
  const [classification, setClassification] = useState<DocumentClassification>('internal')
  const [changeType, setChangeType] = useState<ChangeType>('editorial')
  const [summary, setSummary] = useState('')
  const [reack, setReack] = useState(false)

  // Keep the parent's dirty guard pointed at fresh state every render.
  useEffect(() => {
    registerDirty(() =>
      creating
        ? !!(name.trim() || body.trim())
        : !!doc && (name !== docTitle(doc.name) || body !== bodyOf(doc) || summary.trim() !== ''),
    )
  })

  // Only offer classification tiers the viewer could approve; everyone can
  // author internal/restricted drafts. RLS re-decides on write.
  const classOptions = CLASS_TIERS.filter(
    (t) => t === 'internal' || t === 'restricted' || canApproveDoc(viewer, { category, classification: t, folder: 'SOPs' }),
  )
  const material = MATERIAL_CHANGE.has(changeType)

  const save = async () => {
    const n = name.trim()
    if (!n) { toast('A title is required.', 'warn'); return }
    if (!body.trim()) { toast('Document text is required.', 'warn'); return }
    if (creating) {
      const res = await insert('documents', {
        folder: 'SOPs', kind: 'doc', name: n, content: { body } as Json,
        status: 'draft', category, document_type: docType, classification,
      })
      if (res.error) { toast(res.error.message, 'danger'); return }
      const id = res.data?.[0]?.id
      if (!id) { toast('Something didn’t save correctly — please retry.', 'danger'); return }
      toast('Draft created — publish it from the document page', 'success')
      onSaved(id)
      return
    }
    if (material && !summary.trim()) {
      toast(`A change summary is required for ${CHANGE_TYPE_LABEL[changeType].toLowerCase()} changes.`, 'warn')
      return
    }
    const res = await rpc('document_save', {
      p_document: doc.id,
      p_name: n,
      p_body: body,
      p_change_type: changeType,
      p_change_summary: summary.trim() || undefined,
      p_requires_reack: reack,
    })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Document saved', 'success')
    onSaved(doc.id)
  }

  return (
    <div className="space-y-3">
      {doc?.canonical_source === 'google_drive' && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Google Drive is the canonical source for this document. Portal edits diverge from Google Drive and
          will raise a sync conflict when Drive changes.
        </p>
      )}

      <Field label="Title" required>
        {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Use of Force Policy" />}
      </Field>

      {creating && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Collection" required>
            {(id) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
                {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Type" required>
            {(id) => (
              <Select id={id} value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)}>
                {TYPE_ORDER.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Classification" hint="Who can read it — the server enforces the real rule.">
            {(id) => (
              <Select id={id} value={classification} onChange={(e) => setClassification(e.target.value as DocumentClassification)}>
                {classOptions.map((t) => <option key={t} value={t}>{CLASS_LABEL[t]}</option>)}
              </Select>
            )}
          </Field>
        </div>
      )}

      <Field label="Document text" required hint="Markdown: ## headings drive the reader’s table of contents.">
        {() => <RichEditor value={body} onChange={setBody} minHeight="20rem" />}
      </Field>

      {!creating && (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Change type" required>
              {(id) => (
                <Select
                  id={id}
                  value={changeType}
                  onChange={(e) => {
                    const t = e.target.value as ChangeType
                    setChangeType(t)
                    setReack(MATERIAL_CHANGE.has(t)) // material default: re-ack on
                  }}
                >
                  {CHANGE_TYPES.map((t) => <option key={t} value={t}>{CHANGE_TYPE_LABEL[t]}</option>)}
                </Select>
              )}
            </Field>
            <div className="flex items-end pb-1">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={reack}
                  onChange={(e) => setReack(e.target.checked)}
                  className="h-4 w-4 accent-amber-500"
                />
                Requires re-acknowledgement
              </label>
            </div>
          </div>
          <Field
            label="Change summary"
            required={material}
            hint={material ? 'Required for material changes — readers see this in History.' : 'Optional — shown in History.'}
          >
            {(id) => (
              <Textarea id={id} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What changed, and why" />
            )}
          </Field>
        </>
      )}

      <Button variant="primary" className="w-full" onAction={save}>
        {creating ? 'Create draft' : 'Save changes'}
      </Button>
    </div>
  )
}
