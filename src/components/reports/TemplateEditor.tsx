'use client'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { SectionHeader } from '@/components/ui/PageHeader'
import { uiConfirm } from '@/components/ui/dialog'
import { ReportView } from '@/components/cases/tabs/reports/ReportView'
import { fmtDateTime } from '@/lib/format'
import type { FormSchema } from '@/lib/forms'
import {
  discardTemplateDraft, missingSchemaKeys, publishTemplateVersion, saveTemplateDraft, starterSchema, updateTemplate, validateFormSchema,
  type TemplateAdminRow,
} from '@/lib/reportTemplates'
import { toast } from '@/lib/toast'
import { useAction } from '@/lib/useAction'
import { TemplateSectionEditor } from './TemplateSectionEditor'

interface EditorDraft {
  name: string
  description: string
  reviewRequired: boolean
  changeSummary: string
  schema: FormSchema
  required: string[]
  advisory: string[]
}

/** One template's draft editor with a live preview rendered by the SAME
 *  read-only renderer the Reports tab uses. The parent remounts this (key)
 *  whenever the row's draft changes, so state always starts from the row:
 *  the existing draft, else the published version, else the starter. */
export function TemplateEditor({ row, canPublish, viewerId, onChanged, onBack }: {
  row: TemplateAdminRow
  canPublish: boolean
  viewerId: string | null
  onChanged: () => Promise<void>
  onBack: () => void
}) {
  const base = row.draft ?? row.published
  const initial = useMemo<EditorDraft>(() => ({
    name: row.template.name,
    description: row.template.description ?? '',
    reviewRequired: base ? base.reviewRequired : true,
    changeSummary: row.draft?.changeSummary ?? '',
    schema: base ? structuredClone(base.schema) : starterSchema(row.template.name),
    required: base ? [...base.required] : [],
    advisory: base ? [...base.advisory] : [],
  }), [row, base])
  const [d, setD] = useState<EditorDraft>(initial)
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  const validation = useMemo(() => validateFormSchema(d.schema), [d.schema])
  const previewSchema = validation.ok ? validation.schema : null
  const [publishNote, setPublishNote] = useState('')
  const [confirmPublish, setConfirmPublish] = useState(false)
  const patch = (p: Partial<EditorDraft>) => setD((cur) => ({ ...cur, ...p }))

  const { run: save, busy: saving } = useAction(async () => {
    if (!validation.ok) { toast(validation.error, 'danger'); return }
    // Keys that left the schema drop out of the lists (the server refuses a
    // required key it cannot find).
    const known = (keys: string[]) => keys.filter((k) => !missingSchemaKeys(validation.schema, [k]).length)
    const res = await saveTemplateDraft({
      key: row.template.key, name: d.name.trim() || row.template.name, schema: validation.schema,
      required: known(d.required), advisory: known(d.advisory), reviewRequired: d.reviewRequired,
      changeSummary: d.changeSummary.trim() || null, description: d.description.trim() || null,
    })
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast(`Draft v${res.data.version_number} saved.`, 'success')
    await onChanged()
  })
  const { run: publish, busy: publishing } = useAction(async () => {
    if (!row.draft) return
    const res = await publishTemplateVersion(row.draft.id ?? '', publishNote.trim())
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast(`v${row.draft.versionNumber} of "${row.template.name}" is now the published version.`, 'success')
    setConfirmPublish(false); setPublishNote('')
    await onChanged()
  })
  const { run: discard, busy: discarding } = useAction(async () => {
    if (!row.draft?.id) return
    if (!(await uiConfirm(`Discard draft v${row.draft.versionNumber}? Unpublished changes are lost.`, { title: 'Discard draft', danger: true, confirmText: 'Discard' }))) return
    const res = await discardTemplateDraft(row.draft.id)
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast('Draft discarded.', 'info')
    await onChanged()
  })
  const { run: toggleActive, busy: toggling } = useAction(async () => {
    const next = !row.template.active
    if (!next && !(await uiConfirm(`Retire "${row.template.name}"? New reports can no longer use it; existing reports keep rendering from their pinned version.`, { title: 'Retire template', danger: true, confirmText: 'Retire' }))) return
    const res = await updateTemplate(row.template.id, { active: next })
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast(next ? 'Template restored.' : 'Template retired.', 'success')
    await onChanged()
  })
  const { run: setDefault, busy: defaulting } = useAction(async () => {
    const res = await updateTemplate(row.template.id, { is_default: true })
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast(`"${row.template.name}" is now the default template.`, 'success')
    await onChanged()
  })

  const mine = !!row.draft?.createdBy && row.draft.createdBy === viewerId
  const canDiscard = !!row.draft && (canPublish || mine)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button onClick={onBack} className="rounded-lg py-2 pr-2 text-sm font-semibold text-badge-200 hover:text-white">← Back to templates</button>
          <h2 className="min-w-0 truncate text-base font-semibold text-white">{row.template.name}</h2>
          <span className="font-mono text-xs text-slate-400">{row.template.key}</span>
          <Badge tone={row.template.active ? 'good' : 'neutral'}>{row.template.active ? 'Active' : 'Retired'}</Badge>
          {row.template.isDefault && <Badge tone="accent">Default</Badge>}
          {row.published && <Badge tone="neutral" title={row.published.publishedAt ? `Published ${fmtDateTime(row.published.publishedAt)}` : undefined}>Published v{row.published.versionNumber}</Badge>}
          {row.draft && <Badge tone="warn">Draft v{row.draft.versionNumber}</Badge>}
        </div>
        {canPublish && (
          <div className="flex flex-wrap gap-2">
            {!row.template.isDefault && row.template.active && <Button size="sm" loading={defaulting} onClick={() => void setDefault()}>Set as default</Button>}
            <Button size="sm" variant={row.template.active ? 'danger' : 'success'} loading={toggling} onClick={() => void toggleActive()}>{row.template.active ? 'Retire' : 'Restore'}</Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card variant="flat" pad="sm" className="space-y-3">
            <SectionHeader title="Template" subtitle={row.draft ? `Editing draft v${row.draft.versionNumber}` : row.published ? `New draft from published v${row.published.versionNumber}` : 'First draft'} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" required>{(id) => <Input id={id} value={d.name} onChange={(e) => patch({ name: e.target.value })} />}</Field>
              <Field label="Form title" required hint="Printed heading of the report.">{(id) => <Input id={id} value={d.schema.title} onChange={(e) => patch({ schema: { ...d.schema, title: e.target.value } })} />}</Field>
            </div>
            <Field label="Letterhead / subtitle">{(id) => <Input id={id} value={d.schema.subtitle} onChange={(e) => patch({ schema: { ...d.schema, subtitle: e.target.value } })} />}</Field>
            <Field label="Description" hint="Shown in the template picker.">{(id) => <Textarea id={id} rows={2} value={d.description} onChange={(e) => patch({ description: e.target.value })} />}</Field>
            <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-200">
              <input type="checkbox" checked={d.reviewRequired} onChange={(e) => patch({ reviewRequired: e.target.checked })} className="mt-1 accent-amber-500" />
              <span><span className="font-semibold text-white">Review required</span><br /><span className="text-xs text-slate-400">Submit routes to a Senior Detective / Bureau Lead who approves (seals) or returns. Off = the author&apos;s submission seals immediately (legal drafting forms).</span></span>
            </label>
            <Field label="Change summary" hint="What this version changes — recorded with the draft and shown in history.">{(id) => <Textarea id={id} rows={2} value={d.changeSummary} onChange={(e) => patch({ changeSummary: e.target.value })} />}</Field>
          </Card>
          <Card variant="flat" pad="sm">
            <SectionHeader title="Sections" subtitle="Order, fields and which keys are required (hard-block) or advisory (warn)." className="mb-3" />
            <TemplateSectionEditor schema={d.schema} required={d.required} advisory={d.advisory} onChange={(next) => patch(next)} />
          </Card>
        </div>
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Card variant="flat" pad="sm">
            <SectionHeader title="Preview" subtitle="Rendered by the same read-only view the Reports tab uses." className="mb-3" />
            {previewSchema
              ? <ReportView schema={previewSchema} values={{}} requiredKeys={d.required} advisoryKeys={d.advisory} />
              : <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-200">{validation.ok ? '' : validation.error}</p>}
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-ink-950/95 p-3 backdrop-blur">
        <p className="text-xs text-slate-400">
          {!validation.ok ? <span className="text-rose-300">{validation.error}</span>
            : dirty ? 'Unsaved changes — save the draft before publishing.'
              : row.draft ? 'Draft saved. Publishing makes it the version new reports pin to; existing reports are unaffected.'
                : 'No draft yet — edit and save to propose a new version.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {canDiscard && <Button variant="ghost" className="text-rose-300 hover:text-rose-200" loading={discarding} onClick={() => void discard()}>Discard draft</Button>}
          <Button variant="primary" loading={saving} disabled={!validation.ok || !dirty} onClick={() => void save()}>Save draft</Button>
          {canPublish && <Button variant="success" disabled={!row.draft || dirty} onClick={() => setConfirmPublish(true)}>Publish…</Button>}
        </div>
      </div>

      {confirmPublish && row.draft && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-semibold text-white">Publish draft v{row.draft.versionNumber} of &ldquo;{row.template.name}&rdquo;?</p>
          <ul className="mt-2 space-y-1 text-xs text-amber-200/90">
            <li>New reports on this template pin to v{row.draft.versionNumber} from the moment it is published.</li>
            {row.published && <li>Published v{row.published.versionNumber} becomes superseded. Reports filed under it keep rendering from it and are not changed.</li>}
            <li>Required keys hard-block submission server-side: {row.draft.required.length ? row.draft.required.join(', ') : 'none'}.</li>
            <li>{row.draft.reviewRequired ? 'Submissions route to review before sealing.' : 'Submissions seal immediately (no review).'}</li>
          </ul>
          <Field label="Reason" required className="mt-3" hint="Recorded in the audit log with the publish.">
            {(id) => <Input id={id} value={publishNote} onChange={(e) => setPublishNote(e.target.value)} placeholder="Why this version is being published" />}
          </Field>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="success" loading={publishing} disabled={!publishNote.trim()} onClick={() => void publish()}>Publish this version</Button>
            <Button size="sm" variant="ghost" onClick={() => { setConfirmPublish(false); setPublishNote('') }}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  )
}
