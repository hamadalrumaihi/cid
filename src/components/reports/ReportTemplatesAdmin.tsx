'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { DataTable, type DataColumn } from '@/components/ui/DataTable'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { ErrorNotice } from '@/components/ui/Notice'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { PlusIcon } from '@/components/shell/icons'
import {
  STARTER_REQUIRED, isTemplateKey, loadTemplateAdmin, resetTemplateVersionCache, saveTemplateDraft, starterSchema,
  type TemplateAdminRow,
} from '@/lib/reportTemplates'
import { toast } from '@/lib/toast'
import { useAction } from '@/lib/useAction'
import { TemplateEditor } from './TemplateEditor'

/** Template list + the selected template's draft editor. Reads come straight
 *  from the two tables (SELECT for active members); every write is one of
 *  the report_template_* definer RPCs whose `{ok:false, message}` is toasted. */
export function ReportTemplatesAdmin({ canPublish, viewerId }: { canPublish: boolean; viewerId: string | null }) {
  const [rows, setRows] = useState<TemplateAdminRow[] | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const refresh = useCallback(async () => {
    try {
      resetTemplateVersionCache()
      const next = await loadTemplateAdmin()
      setRows(next); setError(null)
    } catch (e) { setError(e) }
  }, [])
  useEffect(() => { const t = window.setTimeout(() => { void refresh() }, 0); return () => window.clearTimeout(t) }, [refresh])
  const selected = useMemo(() => rows?.find((r) => r.template.id === selectedId) ?? null, [rows, selectedId])

  const columns: DataColumn<TemplateAdminRow>[] = [
    { key: 'name', label: 'Name', value: (r) => r.template.name, render: (r) => <span className="flex flex-wrap items-center gap-1.5 font-semibold text-white">{r.template.name}{r.template.isDefault && <Badge tone="accent">Default</Badge>}</span> },
    { key: 'key', label: 'Key', value: (r) => r.template.key, render: (r) => <span className="font-mono text-xs text-slate-300">{r.template.key}</span> },
    { key: 'active', label: 'Status', value: (r) => (r.template.active ? 'Active' : 'Retired'), render: (r) => <Badge tone={r.template.active ? 'good' : 'neutral'}>{r.template.active ? 'Active' : 'Retired'}</Badge> },
    { key: 'published', label: 'Published', value: (r) => (r.published ? `v${r.published.versionNumber}` : '—'), sortValue: (r) => r.published?.versionNumber ?? -1, render: (r) => r.published ? <span className="font-mono text-xs">v{r.published.versionNumber}</span> : <span className="text-slate-500">—</span> },
    { key: 'review', label: 'Review', value: (r) => (r.published ? (r.published.reviewRequired ? 'Required' : 'Self-seal') : '—'), render: (r) => r.published ? <Badge tone={r.published.reviewRequired ? 'warn' : 'neutral'}>{r.published.reviewRequired ? 'Review required' : 'Self-seal'}</Badge> : <span className="text-slate-500">—</span> },
    { key: 'draft', label: 'Draft', value: (r) => (r.draft ? `v${r.draft.versionNumber}` : '—'), sortValue: (r) => r.draft?.versionNumber ?? -1, render: (r) => r.draft ? <Badge tone="warn">Draft v{r.draft.versionNumber}</Badge> : <span className="text-slate-500">—</span> },
  ]

  if (error) return <ErrorNotice message={error} onRetry={() => void refresh()} />
  if (!rows) return <ListSkeleton count={6} />
  if (selected) {
    return (
      <TemplateEditor
        key={`${selected.template.id}:${selected.draft?.id ?? 'none'}:${selected.template.active}:${selected.template.isDefault}`}
        row={selected}
        canPublish={canPublish}
        viewerId={viewerId}
        onChanged={refresh}
        onBack={() => setSelectedId(null)}
      />
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">{rows.length} template{rows.length === 1 ? '' : 's'} · select one to edit its draft. Retired templates are hidden from the new-report picker; existing reports keep rendering.</p>
        {canPublish && <Button variant="primary" onClick={() => setCreating(true)}><PlusIcon size={14} /> New template</Button>}
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.template.id}
        onRowClick={(r) => setSelectedId(r.template.id)}
        emptyText="No templates yet — the seed publishes the built-in forms; until then the Reports tab offers them from memory."
        countLabel="templates"
        dense
      />
      {/* Mounted only while open so its fields start fresh each time. */}
      {creating && <NewTemplateModal existingKeys={rows.map((r) => r.template.key)} onClose={() => setCreating(false)} onCreated={async (id) => { await refresh(); setSelectedId(id) }} />}
    </div>
  )
}

/** New template (Director / DD / Owner): key + name + description → a first
 *  DRAFT built from the starter schema; publishing is a separate, confirmed
 *  step in the editor. */
function NewTemplateModal({ existingKeys, onClose, onCreated }: { existingKeys: string[]; onClose: () => void; onCreated: (templateId: string) => Promise<void> }) {
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const keyErr = !key ? undefined : !isTemplateKey(key) ? 'snake_case letters, digits and underscores only' : existingKeys.includes(key) ? 'That key is already used' : undefined
  const { run, busy } = useAction(async () => {
    const res = await saveTemplateDraft({
      key, name: name.trim(), schema: starterSchema(name), required: STARTER_REQUIRED, advisory: [],
      reviewRequired: true, changeSummary: 'Initial draft', description: description.trim() || null,
    })
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast('Template created as a draft — edit it, then publish.', 'success')
    onClose()
    await onCreated(res.data.template_id)
  })
  return (
    <Modal open onClose={onClose}>
      <div className="p-5">
        <ModalHeader title="New report template" onClose={onClose} />
        <div className="space-y-3">
          <Field label="Key" required error={keyErr} hint="Stable identifier, e.g. use_of_force. Cannot be changed later.">
            {(id) => <Input id={id} value={key} invalid={!!keyErr} onChange={(e) => setKey(e.target.value.trim().toLowerCase())} autoComplete="off" placeholder="use_of_force" />}
          </Field>
          <Field label="Name" required>
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Use of Force Report" />}
          </Field>
          <Field label="Description" hint="Shown to detectives in the template picker.">
            {(id) => <Textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!key || !!keyErr || !name.trim()} onClick={() => void run()}>Create draft</Button>
        </div>
      </div>
    </Modal>
  )
}
