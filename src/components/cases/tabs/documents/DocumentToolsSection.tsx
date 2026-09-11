'use client'

/** Document Tools — the nineteen `document_tool_request` tools as a card
 *  grid. Six run on the built-in runner (pdf-lib); the rest need the
 *  Stirling PDF service and stay disabled with "Requires the document
 *  service" until the `stirling_pdf` feature flag is on. A tool picks its
 *  input documents and options in a dialog and enqueues a job — the result
 *  lands as a Generated Document and a notification. */
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/Notice'
import {
  DOCUMENT_TOOLS, ROTATIONS, TOOL_UNAVAILABLE_HINT, isPageSpec, toolAvailable, type DocumentTool, type MediaRow, type Rotation,
} from '@/lib/documents'
import { useFlag } from '@/lib/flags'
import { pdfService } from '@/lib/services/pdf/pdf-service'
import { toast } from '@/lib/toast'
import { EvidenceChip } from './shared'

export function DocumentToolsSection({ caseId, inputs, canEdit, onChanged }: {
  caseId: string
  /** Candidate input documents (evidence documents + generated documents). */
  inputs: MediaRow[]
  canEdit: boolean
  onChanged: () => void
}) {
  const stirlingOn = useFlag('stirling_pdf')
  const [tool, setTool] = useState<DocumentTool | null>(null)
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        Every tool writes a NEW derivative document and records its parent — originals are never modified.
        {!stirlingOn && ' Tools marked “Document service” need the optional Stirling PDF service.'}
      </p>
      {!canEdit && <p className="text-xs text-slate-400">Read-only on this case — tools are unavailable.</p>}
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Document tools">
        {DOCUMENT_TOOLS.map((t) => {
          const available = toolAvailable(t, stirlingOn) && canEdit
          return (
            <li key={t.id}>
              <Card pad="sm" variant="flat" className={`flex h-full flex-col gap-2 ${available ? '' : 'opacity-70'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">{t.label}</h3>
                  <Badge tone={t.needs === 'basic' ? 'neutral' : 'accent'} title={t.needs === 'basic' ? 'Runs on the built-in runner' : 'Needs the Stirling PDF service'}>
                    {t.needs === 'basic' ? 'Built-in' : 'Document service'}
                  </Badge>
                </div>
                <p className="flex-1 text-xs text-slate-400">{t.description}</p>
                <div className="flex items-center justify-between gap-2">
                  {!toolAvailable(t, stirlingOn) && <span className="text-xs text-slate-400">{TOOL_UNAVAILABLE_HINT}</span>}
                  <Button size="sm" disabled={!available} onClick={() => setTool(t)} className="ml-auto" aria-label={`Use ${t.label}`}>Use…</Button>
                </div>
              </Card>
            </li>
          )
        })}
      </ul>
      <ToolDialog caseId={caseId} tool={tool} inputs={inputs} onClose={() => setTool(null)} onStarted={onChanged} />
    </div>
  )
}

const CHECK = 'h-4 w-4 flex-shrink-0 rounded border-white/20 bg-ink-950 text-badge-500 focus:ring-0'

function ToolDialog({ caseId, tool, inputs, onClose, onStarted }: {
  caseId: string
  tool: DocumentTool | null
  inputs: MediaRow[]
  onClose: () => void
  onStarted: () => void
}) {
  const open = !!tool
  const [picked, setPicked] = useState<string[]>([])
  const [pages, setPages] = useState('')
  const [rotation, setRotation] = useState<Rotation>(90)
  const [watermark, setWatermark] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) queueMicrotask(() => { setPicked([]); setPages(''); setRotation(90); setWatermark(''); setBusy(false) }) }, [open, tool?.id])

  const min = tool?.minInputs ?? 1
  const wantsPages = !!tool?.options?.includes('pages')
  const wantsRotation = !!tool?.options?.includes('rotation')
  const wantsWatermark = !!tool?.options?.includes('watermark')
  const pagesBad = wantsPages && pages.trim() !== '' && !isPageSpec(pages)
  const watermarkMissing = tool?.id === 'watermark' && watermark.trim() === ''
  const ready = picked.length >= min && !pagesBad && !watermarkMissing
  const usable = useMemo(() => inputs.filter((m) => !!m.storage_path), [inputs])

  const toggle = (id: string) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const submit = async () => {
    if (!tool || !ready || busy) return
    setBusy(true)
    try {
      const r = await pdfService.requestTool(caseId, tool.id, picked, {
        pages: wantsPages ? pages : null,
        rotation: wantsRotation ? rotation : null,
        watermark: wantsWatermark ? watermark : null,
      })
      if (!r.ok) { toast(r.message ?? 'The tool request was refused.', 'danger'); return }
      toast('Started — you’ll be notified when the document is ready.', 'success')
      onStarted()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} dirty={() => picked.length > 0 || pages !== '' || watermark !== ''}>
      {tool && (
        <form className="p-5" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <ModalHeader title={tool.label} onClose={onClose} />
          <p className="mb-3 text-sm text-slate-400">{tool.description}</p>

          <fieldset className="mb-3">
            <legend className="mb-1 block text-xs font-semibold text-slate-400">
              Input documents{min > 1 ? ` (pick at least ${min}, in order)` : ''}
            </legend>
            {usable.length === 0 ? (
              <EmptyState title="No documents to work on" hint="Upload a PDF or document as evidence first; legacy externally hosted files cannot be processed." />
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto overscroll-contain rounded-lg border border-white/10 p-1" aria-label="Documents">
                {usable.map((m) => {
                  const idx = picked.indexOf(m.id)
                  return (
                    <li key={m.id}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-slate-200 hover:bg-white/5">
                        <input type="checkbox" checked={idx >= 0} onChange={() => toggle(m.id)} className={CHECK} />
                        {min > 1 && idx >= 0 && <span className="w-5 text-center text-xs font-semibold tabular-nums text-badge-200">{idx + 1}</span>}
                        <span className="min-w-0 flex-1 truncate">{m.title}</span>
                        <EvidenceChip m={m} />
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            {wantsPages && (
              <Field label="Pages" hint="e.g. 1-3, 5, 8- (blank = all pages)" error={pagesBad ? 'Use page numbers and ranges, separated by commas.' : undefined}>
                {(id) => <Input id={id} name="pages" value={pages} onChange={(e) => setPages(e.target.value)} invalid={pagesBad} placeholder="e.g. 1-3, 5" autoComplete="off" spellCheck={false} inputMode="text" />}
              </Field>
            )}
            {wantsRotation && (
              <Field label="Rotation">
                {(id) => (
                  <Select id={id} name="rotation" value={rotation} onChange={(e) => setRotation(Number(e.target.value) as Rotation)}>
                    {ROTATIONS.map((r) => <option key={r} value={r}>{r}° clockwise</option>)}
                  </Select>
                )}
              </Field>
            )}
            {wantsWatermark && (
              <Field label="Watermark text" required error={watermarkMissing && picked.length > 0 ? 'Enter the text to stamp.' : undefined}>
                {(id) => <Input id={id} name="watermark" value={watermark} onChange={(e) => setWatermark(e.target.value)} maxLength={80} placeholder="e.g. COPY — NOT FOR DISTRIBUTION" autoComplete="off" />}
              </Field>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!ready || usable.length === 0}>
              {busy ? 'Starting…' : `Run ${tool.label.toLowerCase()}`}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
