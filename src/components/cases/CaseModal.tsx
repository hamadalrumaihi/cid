'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { insert, list, update, deleteWithUndo } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { useAuth } from '@/lib/auth'
import { useOperationsStore } from '@/lib/operations'
import { activeProfiles, officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { CASE_STATUSES } from '@/lib/signoff'
import { toast } from '@/lib/toast'
import { parseStringArray } from '@/lib/jsonShapes'

type CaseRow = Tables<'cases'>
type CaseTemplateRow = Tables<'case_templates'>
const BUREAUS = ['LSB', 'BCB', 'SAB', 'JTF'] as const

/** Task checklist stored on a template (jsonb array of title strings). */
const tplTasks = (t: CaseTemplateRow | null): string[] =>
  parseStringArray(t?.tasks).filter((x) => x.trim())

interface Props {
  open: boolean
  record: CaseRow | null
  onClose: () => void
  onSaved: (id?: string) => void
}

export function CaseModal({ open, record, onClose, onSaved }: Props) {
  const { profile, isCommand } = useAuth()
  const operations = useOperationsStore((s) => s.operations)
  const fetchOps = useOperationsStore((s) => s.fetch)
  const templatesVersion = useTableVersion('case_templates')
  const [templates, setTemplates] = useState<CaseTemplateRow[]>([])
  const [managerOpen, setManagerOpen] = useState(false)
  const initial = useMemo(() => ({
    bureau: record?.bureau ?? (profile?.division === 'LSB' || profile?.division === 'BCB' || profile?.division === 'SAB' || profile?.division === 'JTF' ? profile.division : 'LSB'),
    digits: record?.case_number?.replace(/^[A-Z]+-/, '') ?? '',
    title: record?.title ?? '',
    status: record?.status ?? 'open',
    area: record?.area ?? '',
    lead_detective_id: record?.lead_detective_id ?? profile?.id ?? '',
    operation_id: record?.operation_id ?? '',
    summary: record?.summary ?? '',
  }), [record, profile])
  const [form, setForm] = useState(initial)
  // Checklist carried by the selected template — auto-created as case_tasks
  // on save (flowintel-style template task lists). New cases only.
  const [checklist, setChecklist] = useState<string[]>([])
  // Default review cadence carried by the selected template → cases.follow_up_at
  // on creation (new cases only).
  const [followupDays, setFollowupDays] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const fetchTemplates = async () => {
    try {
      setTemplates((await list('case_templates', { order: 'sort_order' })).filter((t) => t.active !== false))
    } catch { setTemplates([]) }
  }
  useEffect(() => { if (open) queueMicrotask(() => { setForm(initial); setChecklist([]); setFollowupDays(null); void fetchOps(); void fetchTemplates() }) }, [open, initial, fetchOps, templatesVersion])
  const dirty = () => JSON.stringify(form) !== JSON.stringify(initial)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const applyTemplate = (tpl: CaseTemplateRow | null) => {
    setChecklist(tplTasks(tpl))
    setFollowupDays(tpl?.followup_days ?? null)
    if (!tpl) { setForm(initial); return }
    setForm((f) => ({
      ...f,
      bureau: tpl.bureau || f.bureau,
      status: tpl.status || f.status,
      title: tpl.title || f.title,
      area: tpl.area || f.area,
      summary: tpl.summary || f.summary,
    }))
  }

  const save = async () => {
    if (!form.title.trim()) { toast('Case title is required.', 'warn'); return }
    setSaving(true)
    const caseNumber = `${form.bureau}-${form.digits.replace(/\D/g, '') || Date.now().toString().slice(-5)}`
    // A template's default review cadence lands on new cases only, and never
    // overwrites a follow-up an editor already set.
    const followUpAt = !record && followupDays && followupDays > 0
      ? new Date(Date.now() + followupDays * 86_400_000).toISOString().slice(0, 10)
      : undefined
    const patch = {
      bureau: form.bureau as CaseRow['bureau'],
      case_number: caseNumber,
      title: form.title.trim(),
      status: form.status as CaseRow['status'],
      area: form.area.trim() || null,
      lead_detective_id: form.lead_detective_id || null,
      operation_id: form.operation_id || null,
      summary: form.summary.trim() || null,
      ...(followUpAt ? { follow_up_at: followUpAt } : {}),
    }
    const res = record ? await update('cases', record.id, patch) : await insert('cases', patch)
    if (res.error) { setSaving(false); toast(res.error.message, 'danger'); return }
    const caseId = res.data?.[0]?.id ?? record?.id
    if (!record && caseId && checklist.length) {
      const t = await insert('case_tasks', checklist.map((title) => ({ case_id: caseId, title })))
      if (t.error) toast(`Case created, but checklist tasks failed: ${t.error.message}`, 'warn')
    }
    setSaving(false)
    toast(record ? 'Case updated.' : `Case created.${checklist.length ? ` ${checklist.length} checklist task${checklist.length === 1 ? '' : 's'} added.` : ''}`, 'success')
    onSaved(caseId)
  }

  return (
    <Modal open={open} onClose={onClose} wide dirty={dirty}>
      <div className="p-5">
        <ModalHeader title={record ? 'Edit case' : 'New case'} onClose={onClose} />
        {!record && (
          <div className="mb-4 rounded-xl border border-white/10 bg-ink-950/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Templates</p>
              {isCommand && <button onClick={() => setManagerOpen(true)} className="text-xs font-bold text-badge-200 hover:text-white">Manage</button>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => applyTemplate(null)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-slate-200">Blank</button>
              {templates.map((tpl) => <button key={tpl.id} onClick={() => applyTemplate(tpl)} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-bold text-slate-200 hover:bg-white/10">{tpl.icon || ''} {tpl.name}{tplTasks(tpl).length > 0 && <span className="ml-1 text-emerald-300">☑{tplTasks(tpl).length}</span>}</button>)}
            </div>
            {checklist.length > 0 && (
              <p className="mt-2 text-xs text-emerald-200">☑ Saving will add {checklist.length} standard task{checklist.length === 1 ? '' : 's'}: {checklist.join(' · ')}</p>
            )}
            {followupDays && followupDays > 0 && (
              <p className="mt-1 text-xs text-amber-200">⏰ Sets a follow-up review in {followupDays} day{followupDays === 1 ? '' : 's'}.</p>
            )}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-300">Bureau
            <select value={form.bureau} onChange={(e) => set('bureau', e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white">
              {BUREAUS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-300">Case number
            <div className="mt-1 flex">
              <span className="rounded-l-lg border border-r-0 border-white/10 bg-white/5 px-3 py-2 font-mono text-slate-300">{form.bureau}-</span>
              <input value={form.digits} onChange={(e) => set('digits', e.target.value.replace(/\D/g, ''))} className="w-full rounded-r-lg border border-white/10 bg-ink-950 px-3 py-2 font-mono text-white" placeholder="1001" />
            </div>
          </label>
          <label className="md:col-span-2 text-sm text-slate-300">Title
            <input value={form.title} onChange={(e) => set('title', e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          </label>
          <label className="text-sm text-slate-300">Status
            <select value={form.status} onChange={(e) => set('status', e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white">
              {CASE_STATUSES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-300">Area
            <input value={form.area} onChange={(e) => set('area', e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          </label>
          <label className="text-sm text-slate-300">Lead detective
            <select value={form.lead_detective_id} disabled={!isCommand} onChange={(e) => set('lead_detective_id', e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white disabled:opacity-70">
              <option value="">Unassigned</option>
              {activeProfiles().map((p) => <option key={p.id} value={p.id}>{officerName(p.id) || p.display_name}</option>)}
            </select>
          </label>
          <label className="text-sm text-slate-300">Operation
            <select value={form.operation_id} onChange={(e) => set('operation_id', e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white">
              <option value="">None</option>
              {operations.map((op) => <option key={op.id} value={op.id}>{op.name}</option>)}
            </select>
          </label>
          <label className="md:col-span-2 text-sm text-slate-300">Summary
            <textarea value={form.summary} onChange={(e) => set('summary', e.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
      <TemplateManager open={managerOpen} templates={templates} onClose={() => setManagerOpen(false)} onChanged={fetchTemplates} />
    </Modal>
  )
}

function TemplateManager({ open, templates, onClose, onChanged }: { open: boolean; templates: CaseTemplateRow[]; onClose: () => void; onChanged: () => void }) {
  const [drafts, setDrafts] = useState<CaseTemplateRow[]>(templates)
  const [newRow, setNewRow] = useState({ name: '', icon: '', bureau: 'LSB', status: 'open', title: '', summary: '', tasks: '', followup: '' })
  // Raw textarea text per row — parsed only on save so Enter/blank lines type naturally.
  const [taskDrafts, setTaskDrafts] = useState<Record<string, string>>({})
  const parseTasks = (v: string): string[] => v.split('\n').map((x) => x.trim()).filter(Boolean)
  useEffect(() => { if (open) queueMicrotask(() => { setDrafts(templates); setTaskDrafts({}) }) }, [open, templates])
  const saveRow = async (row: CaseTemplateRow) => {
    const res = await update('case_templates', row.id, {
      name: row.name,
      icon: row.icon || null,
      bureau: row.bureau,
      status: row.status,
      title: row.title || null,
      summary: row.summary || null,
      tasks: taskDrafts[row.id] !== undefined ? parseTasks(taskDrafts[row.id]) : (Array.isArray(row.tasks) ? row.tasks : []),
      followup_days: row.followup_days ?? null,
      active: row.active,
      sort_order: row.sort_order,
    })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Template saved.', 'success'); onChanged() }
  }
  const add = async () => {
    if (!newRow.name.trim()) { toast('Template name is required.', 'warn'); return }
    const res = await insert('case_templates', {
      name: newRow.name.trim(),
      icon: newRow.icon || null,
      bureau: newRow.bureau as CaseTemplateRow['bureau'],
      status: newRow.status as CaseTemplateRow['status'],
      title: newRow.title || null,
      summary: newRow.summary || null,
      tasks: parseTasks(newRow.tasks),
      followup_days: newRow.followup.trim() ? Math.max(0, parseInt(newRow.followup, 10) || 0) || null : null,
      sort_order: templates.length + 1,
    })
    if (res.error) toast(res.error.message, 'danger')
    else { setNewRow({ name: '', icon: '', bureau: 'LSB', status: 'open', title: '', summary: '', tasks: '', followup: '' }); toast('Template added.', 'success'); onChanged() }
  }
  const patchDraft = (id: string, patch: Partial<CaseTemplateRow>) => setDrafts((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))
  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="p-5">
        <ModalHeader title="Case templates" onClose={onClose} />
        <div className="space-y-3">
          {drafts.map((row) => <div key={row.id} className="grid gap-2 rounded-xl border border-white/10 bg-ink-950/50 p-3 md:grid-cols-[4rem_1fr_6rem_7rem]">
            <input value={row.icon || ''} onChange={(e) => patchDraft(row.id, { icon: e.target.value })} placeholder="Icon" className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
            <input value={row.name} onChange={(e) => patchDraft(row.id, { name: e.target.value })} placeholder="Name" className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
            <select value={row.bureau || 'LSB'} onChange={(e) => patchDraft(row.id, { bureau: e.target.value as CaseTemplateRow['bureau'] })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white">{BUREAUS.map((b) => <option key={b} value={b}>{b}</option>)}</select>
            <select value={row.status} onChange={(e) => patchDraft(row.id, { status: e.target.value as CaseTemplateRow['status'] })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white">{CASE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <input value={row.title || ''} onChange={(e) => patchDraft(row.id, { title: e.target.value })} placeholder="Prefill title" className="md:col-span-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
            <input value={row.summary || ''} onChange={(e) => patchDraft(row.id, { summary: e.target.value })} placeholder="Prefill summary" className="md:col-span-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
            <input type="number" min={0} value={row.followup_days ?? ''} onChange={(e) => patchDraft(row.id, { followup_days: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })} placeholder="Follow-up days" title="Default review cadence in days" className="md:col-span-4 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
            <textarea value={taskDrafts[row.id] ?? tplTasks(row).join('\n')} onChange={(e) => setTaskDrafts((m) => ({ ...m, [row.id]: e.target.value }))} rows={3} placeholder={'Checklist tasks — one per line, auto-created with each new case\nCanvass witnesses\nPull CCTV'} className="md:col-span-4 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />
            <div className="md:col-span-4 flex justify-end gap-2"><button onClick={() => void saveRow(row)} className="rounded-lg bg-badge-600 px-3 py-2 text-xs font-bold text-white">Save</button><button onClick={() => void deleteWithUndo('case_templates', row, { confirmTitle: 'Delete template', confirmMessage: `Delete the “${row.name}” case template? Existing cases are unaffected — only the template is removed. You can undo this for a few seconds.`, confirmText: 'Delete template', label: 'template', after: onChanged })} className="rounded-lg border border-rose-400/30 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/10">Delete</button></div>
          </div>)}
        </div>
        <div className="mt-4 grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 md:grid-cols-[4rem_1fr_6rem_7rem]">
          <input value={newRow.icon} onChange={(e) => setNewRow({ ...newRow, icon: e.target.value })} placeholder="Icon" className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
          <input value={newRow.name} onChange={(e) => setNewRow({ ...newRow, name: e.target.value })} placeholder="New template name" className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
          <select value={newRow.bureau} onChange={(e) => setNewRow({ ...newRow, bureau: e.target.value })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white">{BUREAUS.map((b) => <option key={b} value={b}>{b}</option>)}</select>
          <select value={newRow.status} onChange={(e) => setNewRow({ ...newRow, status: e.target.value })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white">{CASE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <input value={newRow.title} onChange={(e) => setNewRow({ ...newRow, title: e.target.value })} placeholder="Prefill title" className="md:col-span-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
          <input value={newRow.summary} onChange={(e) => setNewRow({ ...newRow, summary: e.target.value })} placeholder="Prefill summary" className="md:col-span-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
          <input type="number" min={0} value={newRow.followup} onChange={(e) => setNewRow({ ...newRow, followup: e.target.value })} placeholder="Follow-up days (optional)" title="Default review cadence in days" className="md:col-span-4 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
          <textarea value={newRow.tasks} onChange={(e) => setNewRow({ ...newRow, tasks: e.target.value })} rows={3} placeholder={'Checklist tasks — one per line, auto-created with each new case'} className="md:col-span-4 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />
          <button onClick={add} className="md:col-span-4 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-bold text-white">Add template</button>
        </div>
      </div>
    </Modal>
  )
}
