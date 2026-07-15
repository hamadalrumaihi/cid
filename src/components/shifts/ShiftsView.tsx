'use client'

/** Weekly Shift Reports — port of vanilla shifts.js. One report per detective
 *  per week (unique-key enforced server-side; a duplicate insert gets a
 *  friendly "edit it instead"). RLS rolls reports up to the author's bureau
 *  leadership + command. The auto-fill rollup computes cases the author led
 *  that moved in the chosen week + evidence they collected. */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { insert, list, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice, EmptyState } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { inputCls, labelCls } from '@/components/ui/Field'

type ShiftRow = Tables<'shift_reports'>

function mondayOf(d: Date): string {
  const c = new Date(d)
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7))
  return c.toISOString().slice(0, 10)
}

export function ShiftsView() {
  const { state, profile, canEdit } = useAuth()
  const [shifts, setShifts] = useState<ShiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<{ record: ShiftRow | null } | null>(null)
  const version = useTableVersion('shift_reports')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    try { setShifts(await withRetry(() => list('shift_reports', { order: 'week_start', ascending: false }))) }
    catch { setShifts([]); toast("Couldn't load shift reports — check your connection.", 'danger') }
    finally { setLoading(false) }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  if (state !== 'in') return <Notice text="Sign in to log and view weekly shift reports." />

  return (
    <div>
      <Card pad="lg" className="mb-5">
        <PageHeader
          title="🗓️ Weekly Shift Reports"
          subtitle="Log your weekly activity (cases worked, arrests, evidence). Rolls up to your Bureau Lead & Command."
          actions={canEdit ? (
            <Button variant="primary" onClick={() => setEditor({ record: null })}>
              + This week&rsquo;s report
            </Button>
          ) : undefined}
        />
      </Card>
      {loading ? (
        <CardGridSkeleton cols="" />
      ) : !shifts.length ? (
        <EmptyState
          icon="🗓️"
          title="No shift reports yet"
          hint="Log your weekly activity so it rolls up to your Bureau Lead and Command."
          action={canEdit ? { label: "+ This week’s report", onClick: () => setEditor({ record: null }) } : undefined}
        />
      ) : (
        <div className="space-y-3">
          {shifts.map((s) => {
            const mine = profile?.id === s.author_id
            return (
              <Card key={s.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono text-sm font-semibold text-blue-300">{s.bureau}</span>
                    {' · '}
                    <span className="text-sm text-white">{s.author_name || 'Officer'}</span>
                    <span className="ml-1 text-[11px] text-slate-400">week of {s.week_start}</span>
                    {mine && <span className="ml-1 rounded bg-blue-500/15 px-1.5 text-[10px] font-semibold uppercase text-blue-300">you</span>}
                  </div>
                  {mine && (
                    <Button size="sm" className="-my-1" onClick={() => setEditor({ record: s })}>
                      Edit
                    </Button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-300">
                  <span>📁 {s.cases_worked || '—'}</span>
                  <span>🚓 {s.arrests} arrest{s.arrests === 1 ? '' : 's'}</span>
                  <span>🔬 {s.evidence_count} evidence</span>
                </div>
                {s.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-400">{s.notes}</p>}
              </Card>
            )
          })}
        </div>
      )}
      {editor && (
        <ShiftModal record={editor.record} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void refresh() }} />
      )}
    </div>
  )
}

function ShiftModal({ record, onClose, onSaved }: { record: ShiftRow | null; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [weekStart, setWeekStart] = useState(record?.week_start ?? mondayOf(new Date()))
  const [arrests, setArrests] = useState(String(record?.arrests ?? 0))
  const [casesWorked, setCasesWorked] = useState(record?.cases_worked ?? '')
  const [evidenceCount, setEvidenceCount] = useState(String(record?.evidence_count ?? 0))
  const [notes, setNotes] = useState(record?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [rolling, setRolling] = useState(false)

  const dirty = () =>
    weekStart !== (record?.week_start ?? mondayOf(new Date())) || arrests !== String(record?.arrests ?? 0) ||
    casesWorked !== (record?.cases_worked ?? '') || evidenceCount !== String(record?.evidence_count ?? 0) ||
    notes !== (record?.notes ?? '')

  // QoL rollup — cases I lead that moved in the week + evidence I collected.
  const rollup = async () => {
    if (!profile) return
    setRolling(true)
    try {
      const ws = weekStart || mondayOf(new Date())
      const start = new Date(`${ws}T00:00:00`)
      const end = new Date(start)
      end.setDate(end.getDate() + 7)
      const inWeek = (d: string | null) => { if (!d) return false; const t = new Date(d); return t >= start && t < end }
      const [cases, evidence] = await Promise.all([
        list('cases', { select: 'id,case_number,updated_at,lead_detective_id', eq: { lead_detective_id: profile.id } }).catch(() => [] as Tables<'cases'>[]),
        list('evidence', { eq: { collected_by: profile.id } }).catch(() => [] as Tables<'evidence'>[]),
      ])
      const worked = cases.filter((c) => inWeek(c.updated_at)).map((c) => c.case_number).join(', ')
      const evCount = evidence.filter((e) => inWeek(e.collected_at ?? e.created_at)).length
      setCasesWorked(worked)
      setEvidenceCount(String(evCount))
      toast(worked || evCount ? 'Filled from your activity — review before submitting.' : 'No matching activity found for that week.', worked || evCount ? 'success' : 'info')
    } finally {
      setRolling(false)
    }
  }

  const save = async () => {
    if (!weekStart) { toast('Week is required.', 'warn'); return }
    if (!profile) return
    setBusy(true)
    const payload = {
      week_start: weekStart,
      arrests: Number(arrests) || 0,
      cases_worked: casesWorked.trim() || null,
      evidence_count: Number(evidenceCount) || 0,
      notes: notes.trim() || null,
      bureau: (profile.division ?? 'JTF') as Tables<'shift_reports'>['bureau'],
      author_name: profile.display_name,
    }
    const res = record ? await update('shift_reports', record.id, payload) : await insert('shift_reports', payload)
    setBusy(false)
    if (res.error) {
      const dup = /duplicate|unique|already exists|23505/i.test(res.error.message)
      toast(dup ? 'You already filed a report for that week — edit it instead.' : `Save failed: ${res.error.message}`, 'danger')
      return
    }
    toast('Shift report saved', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} wide dirty={dirty}>
      <ModalHeader title={record ? 'Edit Weekly Report' : 'New Weekly Report'} onClose={onClose} />
      <div className="mb-4">
        <button onClick={() => void rollup()} disabled={rolling} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-blue-200 transition hover:bg-white/10 disabled:opacity-60">
          {rolling ? 'Computing…' : '↻ Auto-fill from my activity'}
        </button>
        <span className="ml-2 text-[11px] text-slate-400">fills cases you led + evidence you collected this week</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="shift-week" className={labelCls}>Week starting (Mon)</label>
          <input id="shift-week" type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="shift-arrests" className={labelCls}>Arrests</label>
          <input id="shift-arrests" type="number" min={0} value={arrests} onChange={(e) => setArrests(e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="shift-cases" className={labelCls}>Cases worked</label>
          <input id="shift-cases" value={casesWorked} onChange={(e) => setCasesWorked(e.target.value)} placeholder="SAB-900001, SAB-900007 …" className={inputCls} />
        </div>
        <div>
          <label htmlFor="shift-evidence" className={labelCls}>Evidence collected (#)</label>
          <input id="shift-evidence" type="number" min={0} value={evidenceCount} onChange={(e) => setEvidenceCount(e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="shift-notes" className={labelCls}>Notes</label>
          <textarea id="shift-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={inputCls} />
        </div>
      </div>
      <Button variant="primary" className="mt-5 w-full" disabled={busy} onClick={() => void save()}>
        {record ? 'Save changes' : 'Submit report'}
      </Button>
    </Modal>
  )
}
