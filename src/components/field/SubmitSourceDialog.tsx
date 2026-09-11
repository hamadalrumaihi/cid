'use client'

/** Submit a URL for crawling. The server validates the address
 *  (`private.url_static_check` + the crawler policy) and queues a
 *  `source.fetch` job — the dialog never blocks on the fetch. A new source
 *  is UNVERIFIED INTELLIGENCE from the first byte; the toast says so. */
import { useRef, useState } from 'react'
import type { EntityHit } from '@/lib/entitySearch'
import { submitSource, urlProblem } from '@/lib/externalSources'
import { toast } from '@/lib/toast'
import { EntityPicker } from '@/components/entity'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea, fieldErrorId } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'

export function SubmitSourceDialog({ open, onClose, caseId = null, onSubmitted }: {
  open: boolean
  onClose: () => void
  /** Pre-bound case (the case tab); omitted → an optional case picker. */
  caseId?: string | null
  onSubmitted: (sourceId: string) => void
}) {
  const [url, setUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [kase, setKase] = useState<EntityHit | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The Field-generated id of the URL control, so a validation error can focus it.
  const urlId = useRef<string>('')
  const focusUrl = () => { const el = urlId.current ? document.getElementById(urlId.current) : null; el?.focus() }

  const dirty = () => !!url.trim() || !!notes.trim()

  const submit = async () => {
    const problem = urlProblem(url)
    if (problem) { setError(problem); focusUrl(); return }
    setError(null)
    setBusy(true)
    const res = await submitSource(url, caseId ?? kase?.id ?? null, notes)
    setBusy(false)
    if (!res.ok) { setError(res.message); focusUrl(); return }
    toast(`${res.sourceNumber || 'Source'} submitted — fetching in the background. It is UNVERIFIED INTELLIGENCE until an analyst verifies it.`, 'success')
    setUrl(''); setNotes(''); setKase(null)
    onSubmitted(res.id)
  }

  return (
    <Modal open={open} onClose={onClose} dirty={dirty}>
      <form className="p-6" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <ModalHeader title="Submit a web source" onClose={onClose} />
        <div className="space-y-3">
          <Field label="Page URL" required error={error ?? undefined} hint="http or https only. The page is fetched by the crawler service, never by your browser.">
            {(id) => {
              urlId.current = id
              return (
              <Input
                id={id}
                type="url"
                name="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                required
                invalid={!!error}
                aria-describedby={error ? fieldErrorId(id) : undefined}
                value={url}
                onChange={(e) => { setUrl(e.target.value); if (error) setError(null) }}
                placeholder="https://example.com/article…"
              />
              )
            }}
          </Field>
          {!caseId && (
            <EntityPicker kind="case" label="Case (optional)" value={kase} onChange={setKase} placeholder="Search cases by number or title…" />
          )}
          <Field label="Why this source matters (optional)">
            {(id) => (
              <Textarea id={id} name="notes" rows={3} autoComplete="off" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="What you expect to find here, or who mentioned it…" />
            )}
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Submit for crawling</Button>
        </div>
      </form>
    </Modal>
  )
}
