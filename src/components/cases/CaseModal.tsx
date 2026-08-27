'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { RecordSearchPicker } from '@/components/shared/RecordSearchPicker'
import { insert, list, rpc, update, deleteWithUndo } from '@/lib/db'
import { createCase } from '@/lib/services/cases'
import type { Tables, TablesUpdate } from '@/lib/database.types'
import { searchMemberHits, searchOperationHits, type EntityHit } from '@/lib/entitySearch'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { CASE_STATUSES } from '@/lib/signoff'
import { toast } from '@/lib/toast'
import { parseStringArray } from '@/lib/jsonShapes'
import { CASE_PREFIX, PERMANENT_BUREAUS, bureauLabel } from '@/lib/roles'

type CaseRow = Tables<'cases'>
type CaseTemplateRow = Tables<'case_templates'>
/** Creation targets: the permanent bureaus plus the temporary JTF designation.
 *  special_investigations is never creatable here — SIB cases are minted
 *  through the compartmented SIB workflow. */
const BUREAUS = [...PERMANENT_BUREAUS, 'JTF'] as const
/** Case-number prefix for a bureau id (MCB-/SCB-/JTF-). */
const prefixOf = (b: string) => CASE_PREFIX[b] ?? b

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
  const templatesVersion = useTableVersion('case_templates')
  const [templates, setTemplates] = useState<CaseTemplateRow[]>([])
  const [managerOpen, setManagerOpen] = useState(false)
  const initial = useMemo(() => ({
    bureau: record?.bureau
      ?? ((PERMANENT_BUREAUS as readonly string[]).includes(profile?.division ?? '')
        ? profile!.division!
        : PERMANENT_BUREAUS[0]),
    digits: record?.case_number?.replace(/^[A-Z]+-/, '') ?? '',
    title: record?.title ?? '',
    status: record?.status ?? 'open',
    area: record?.area ?? '',
    lead_detective_id: record?.lead_detective_id ?? profile?.id ?? '',
    operation_id: record?.operation_id ?? '',
    summary: record?.summary ?? '',
  }), [record, profile])
  const [form, setForm] = useState(initial)
  // Checklist carried by the selected template — expanded into case_tasks
  // SERVER-SIDE by the case_create RPC (flowintel-style template task lists);
  // the local copy only powers the preview strip. New cases only.
  const [checklist, setChecklist] = useState<string[]>([])
  // The selected template's id rides to case_create so the server expands its
  // checklist inside the same transaction as the case row.
  const [templateId, setTemplateId] = useState<string | null>(null)
  // Default review cadence carried by the selected template → cases.follow_up_at
  // on creation (new cases only).
  const [followupDays, setFollowupDays] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const fetchTemplates = async () => {
    try {
      setTemplates((await list('case_templates', { order: 'sort_order' })).filter((t) => t.active !== false))
    } catch { setTemplates([]) }
  }
  useEffect(() => { if (open) queueMicrotask(() => { setForm(initial); setChecklist([]); setTemplateId(null); setFollowupDays(null); void fetchTemplates() }) }, [open, initial, templatesVersion])

  // ── Bounded picker plumbing ───────────────────────────────────────────────
  // Lead labels come from the shared roster cache (warm it once); the current
  // operation's name resolves via ONE in:{id} lookup instead of the old
  // whole-shelf preload. FK guard: a slow/failed lookup keeps the id under a
  // placeholder label — saving never nulls an assignment the editor didn't
  // touch.
  const rosterProfiles = useProfilesStore((s) => s.profiles)
  const rosterLoaded = useProfilesStore((s) => s.loaded)
  useEffect(() => { if (open && !rosterLoaded) void useProfilesStore.getState().fetch() }, [open, rosterLoaded])
  const leadValue = useMemo<EntityHit | null>(() => {
    if (!form.lead_detective_id) return null
    const p = rosterProfiles.find((x) => x.id === form.lead_detective_id)
    return { id: form.lead_detective_id, label: p?.display_name || '(assigned officer)', thumbUrl: p?.avatar_url ?? null }
  }, [form.lead_detective_id, rosterProfiles])
  // Operation names seen so far (the record's own + any picked in-session).
  const [opNames, setOpNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const oid = record?.operation_id
    if (!open || !oid) return
    let live = true
    void list('operations', { select: 'id,name', in: { id: [oid] } })
      .then((r) => {
        const row = (r as unknown as { id: string; name: string }[])[0]
        if (live && row) setOpNames((m) => ({ ...m, [row.id]: row.name }))
      })
      .catch(() => { /* keep the id under its placeholder */ })
    return () => { live = false }
  }, [open, record])
  const opValue = useMemo<EntityHit | null>(
    () => form.operation_id
      ? { id: form.operation_id, label: opNames[form.operation_id] ?? '(current operation)' }
      : null,
    [form.operation_id, opNames],
  )
  // Auto-continue the bureau's established case-number series (e.g. MCB-4000034)
  // instead of leaving the field blank. New cases only; server-side generator so
  // it always reflects live data. We fill only when the field is empty or still
  // holds our previous suggestion, so a manually-typed number is never clobbered.
  const suggestedRef = useRef('')
  useEffect(() => {
    if (!open || record) return
    let alive = true
    queueMicrotask(async () => {
      try {
        const res = await rpc('next_case_number', { p_bureau: form.bureau })
        const digits = typeof res.data === 'string' ? res.data.replace(/^[A-Z]+-/, '') : ''
        if (!alive || !digits) return
        setForm((f) => (f.digits === '' || f.digits === suggestedRef.current ? { ...f, digits } : f))
        suggestedRef.current = digits
      } catch { /* save-time fallback still covers a blank field */ }
    })
    return () => { alive = false }
  }, [open, record, form.bureau])
  // Editing keeps the number's own prefix — legacy identifiers (LSB-/BCB-/
  // SAB-/SIU-) are preserved verbatim even though the bureau enum moved on;
  // new cases mint the bureau's current prefix.
  const numberPrefix = record?.case_number?.match(/^[A-Z]+(?=-)/)?.[0] ?? prefixOf(form.bureau)
  const dirty = () => JSON.stringify(form) !== JSON.stringify(initial)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const applyTemplate = (tpl: CaseTemplateRow | null) => {
    setChecklist(tplTasks(tpl))
    setTemplateId(tpl?.id ?? null)
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
    // A template's default review cadence lands on new cases only, and never
    // overwrites a follow-up an editor already set.
    const followUpAt = !record && followupDays && followupDays > 0
      ? new Date(Date.now() + followupDays * 86_400_000).toISOString().slice(0, 10)
      : undefined
    let caseId: string | undefined
    if (record) {
      // Edits stay a plain RLS-scoped update — creation is the shared RPC.
      // A cleared number field falls back to the server's next-in-series,
      // exactly as before.
      const typed = form.digits.replace(/\D/g, '')
      let caseNumber = `${numberPrefix}-${typed}`
      if (!typed) {
        const gen = await rpc('next_case_number', { p_bureau: form.bureau })
        if (typeof gen.data === 'string' && gen.data) caseNumber = gen.data
        else { setSaving(false); toast('Could not allocate a case number — try again.', 'danger'); return }
      }
      const patch = {
        bureau: form.bureau as CaseRow['bureau'],
        case_number: caseNumber,
        title: form.title.trim(),
        status: form.status as CaseRow['status'],
        area: form.area.trim() || null,
        lead_detective_id: form.lead_detective_id || null,
        operation_id: form.operation_id || null,
        summary: form.summary.trim() || null,
      }
      const res = await update('cases', record.id, patch)
      if (res.error) { setSaving(false); toast(res.error.message, 'danger'); return }
      caseId = res.data?.[0]?.id ?? record.id
    } else {
      // Creation goes through the shared case_create RPC (the same operation
      // the FiveM lane calls): the server gates the bureau, mints the number
      // collision-safely when the field is blank (an explicitly typed number
      // that collides comes back as a clear error — never a timestamp
      // fallback; that was the SAB-69179 bug), applies the lead rule (only
      // command's pick is honored; everyone else becomes the lead) and
      // expands the template checklist in the SAME transaction.
      const typed = form.digits.replace(/\D/g, '')
      const res = await createCase({
        bureau: form.bureau,
        title: form.title.trim(),
        summary: form.summary.trim() || null,
        area: form.area.trim() || null,
        lead: form.lead_detective_id || null,
        template: templateId,
        caseNumber: typed ? `${numberPrefix}-${typed}` : null,
      })
      if (res.error || !res.data) { setSaving(false); toast(res.error?.message || 'Could not create the case.', 'danger'); return }
      caseId = res.data.id
      // Fields the RPC deliberately doesn't take stay a follow-up update on
      // the fresh row (the creator always passes cases_upd): a non-default
      // starting status, the operation link, and the template's follow-up.
      const extras: TablesUpdate<'cases'> = {
        ...(form.status !== 'open' ? { status: form.status as CaseRow['status'] } : {}),
        ...(form.operation_id ? { operation_id: form.operation_id } : {}),
        ...(followUpAt ? { follow_up_at: followUpAt } : {}),
      }
      if (Object.keys(extras).length) {
        const up = await update('cases', caseId, extras)
        if (up.error) toast(`Case created, but some settings failed to apply: ${up.error.message}`, 'warn')
      }
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
            {/* Bureau is frozen after creation (block_direct_case_bureau) — the
                authorized path is the Reassign-bureau action on the case (DD+). */}
            <select value={form.bureau} onChange={(e) => set('bureau', e.target.value)} disabled={!!record} title={record ? 'Bureau changes go through Reassign bureau on the case (Deputy Director+)' : undefined} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60">
              {BUREAUS.map((b) => <option key={b} value={b}>{bureauLabel(b)}</option>)}
            </select>
            {record && <span className="mt-1 block text-[11px] text-slate-500">Changed via “Reassign bureau” on the case (Deputy Director+).</span>}
          </label>
          <label className="text-sm text-slate-300">Case number
            <div className="mt-1 flex">
              <span className="rounded-l-lg border border-r-0 border-white/10 bg-white/5 px-3 py-2 font-mono text-slate-300">{numberPrefix}-</span>
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
          {/* Assignment authority unchanged: only command may change the lead
              (RLS re-decides server-side) — the picker renders disabled with
              the current assignee shown. */}
          <RecordSearchPicker<EntityHit>
            label="Lead detective"
            placeholder={isCommand ? 'Search name, badge or bureau…' : 'Unassigned'}
            disabled={!isCommand}
            value={leadValue}
            onChange={(v) => set('lead_detective_id', v?.id ?? '')}
            search={async (q) => searchMemberHits(q)}
            getThumb={(h) => h.thumbUrl}
          />
          <RecordSearchPicker<EntityHit>
            label="Operation"
            placeholder="Search operations…"
            value={opValue}
            onChange={(v) => {
              if (v) setOpNames((m) => ({ ...m, [v.id]: v.label }))
              set('operation_id', v?.id ?? '')
            }}
            search={async (q) => searchOperationHits(q)}
            peekType="operation"
          />
          <label className="md:col-span-2 text-sm text-slate-300">Summary
            <textarea value={form.summary} onChange={(e) => set('summary', e.target.value)} rows={5} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
        </div>
      </div>
      <TemplateManager open={managerOpen} templates={templates} onClose={() => setManagerOpen(false)} onChanged={fetchTemplates} />
    </Modal>
  )
}

function TemplateManager({ open, templates, onClose, onChanged }: { open: boolean; templates: CaseTemplateRow[]; onClose: () => void; onChanged: () => void }) {
  const [drafts, setDrafts] = useState<CaseTemplateRow[]>(templates)
  const [newRow, setNewRow] = useState({ name: '', icon: '', bureau: BUREAUS[0] as string, status: 'open', title: '', summary: '', tasks: '', followup: '' })
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
    else { setNewRow({ name: '', icon: '', bureau: BUREAUS[0] as string, status: 'open', title: '', summary: '', tasks: '', followup: '' }); toast('Template added.', 'success'); onChanged() }
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
            <select value={row.bureau || BUREAUS[0]} onChange={(e) => patchDraft(row.id, { bureau: e.target.value as CaseTemplateRow['bureau'] })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white">{BUREAUS.map((b) => <option key={b} value={b}>{bureauLabel(b)}</option>)}</select>
            <select value={row.status} onChange={(e) => patchDraft(row.id, { status: e.target.value as CaseTemplateRow['status'] })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white">{CASE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <input value={row.title || ''} onChange={(e) => patchDraft(row.id, { title: e.target.value })} placeholder="Prefill title" className="md:col-span-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
            <input value={row.summary || ''} onChange={(e) => patchDraft(row.id, { summary: e.target.value })} placeholder="Prefill summary" className="md:col-span-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
            <input type="number" min={0} value={row.followup_days ?? ''} onChange={(e) => patchDraft(row.id, { followup_days: e.target.value === '' ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })} placeholder="Follow-up days" title="Default review cadence in days" className="md:col-span-4 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
            <textarea value={taskDrafts[row.id] ?? tplTasks(row).join('\n')} onChange={(e) => setTaskDrafts((m) => ({ ...m, [row.id]: e.target.value }))} rows={3} placeholder={'Checklist tasks — one per line, auto-created with each new case\nCanvass witnesses\nPull CCTV'} className="md:col-span-4 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />
            <div className="md:col-span-4 flex justify-end gap-2"><Button size="sm" variant="primary" onClick={() => void saveRow(row)}>Save</Button><button onClick={() => void deleteWithUndo('case_templates', row, { confirmTitle: 'Delete template', confirmMessage: `Delete the “${row.name}” case template? Existing cases are unaffected — only the template is removed. You can undo this for a few seconds.`, confirmText: 'Delete template', label: 'template', after: onChanged })} className="rounded-lg border border-rose-400/30 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/10">Delete</button></div>
          </div>)}
        </div>
        <div className="mt-4 grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 md:grid-cols-[4rem_1fr_6rem_7rem]">
          <input value={newRow.icon} onChange={(e) => setNewRow({ ...newRow, icon: e.target.value })} placeholder="Icon" className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
          <input value={newRow.name} onChange={(e) => setNewRow({ ...newRow, name: e.target.value })} placeholder="New template name" className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
          <select value={newRow.bureau} onChange={(e) => setNewRow({ ...newRow, bureau: e.target.value })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white">{BUREAUS.map((b) => <option key={b} value={b}>{bureauLabel(b)}</option>)}</select>
          <select value={newRow.status} onChange={(e) => setNewRow({ ...newRow, status: e.target.value })} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white">{CASE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <input value={newRow.title} onChange={(e) => setNewRow({ ...newRow, title: e.target.value })} placeholder="Prefill title" className="md:col-span-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
          <input value={newRow.summary} onChange={(e) => setNewRow({ ...newRow, summary: e.target.value })} placeholder="Prefill summary" className="md:col-span-2 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
          <input type="number" min={0} value={newRow.followup} onChange={(e) => setNewRow({ ...newRow, followup: e.target.value })} placeholder="Follow-up days (optional)" title="Default review cadence in days" className="md:col-span-4 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
          <textarea value={newRow.tasks} onChange={(e) => setNewRow({ ...newRow, tasks: e.target.value })} rows={3} placeholder={'Checklist tasks — one per line, auto-created with each new case'} className="md:col-span-4 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white" />
          <Button variant="success" className="md:col-span-4" onClick={add}>Add template</Button>
        </div>
      </div>
    </Modal>
  )
}
