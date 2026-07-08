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
import { Modal, ModalHeader } from '@/components/ui/Modal'

type ShiftRow = Tables<'shift_reports'>

const inputCls = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'
const labelCls = 'mb-1 block text-xs font-semibold text-slate-400'

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
    catch { setShifts([]) }
    finally { setLoading(false) }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version])

  if (state !== 'in') return <Notice text="Sign in to log and view weekly shift reports." />

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <div>
          <h3 className="text-xl font-bold text-white">🗓️ Weekly Shift Reports</h3>
          <p className="text-sm text-slate-400">Log your weekly activity (cases worked, arrests, evidence). Rolls up to your Bureau Lead &amp; Command.</p>
        </div>
        {canEdit && (
          <button onClick={() => setEditor({ record: null })} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
            + This week&rsquo;s report
          </button>
        )}
      </div>
      {loading ? (
        <Notice text="Loading shift reports…" />
      ) : !shifts.length ? (
        <Notice text="No shift reports yet. Use “+ This week’s report”." />
      ) : (
        <div className="space-y-3">
          {shifts.map((s) => {
            const mine = profile?.id === s.author_id
            return (
              <div key={s.id} className="rounded-2xl border border-white/5 bg-ink-900/60 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono text-sm font-semibold text-blue-300">{s.bureau}</span>
                    {' · '}
                    <span className="text-sm text-white">{s.author_name || 'Officer'}</span>
                    <span className="ml-1 text-[11px] text-slate-500">week of {s.week_start}</span>
                    {mine && <span className="ml-1 rounded bg-blue-500/15 px-1.5 text-[9px] font-semibold uppercase text-blue-300">you</span>}
                  </div>
                  {mine && (
                    <button onClick={() => setEditor({ record: s })} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10">
                      Edit
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-300">
                  <span>📁 {s.cases_worked || '—'}</span>
                  <span>🚓 {s.arrests} arrest{s.arrests === 1 ? '' : 's'}</span>
                  <span>🔬 {s.evidence_count} evidence</span>
                </div>
                {s.notes && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-400">{s.notes}</p>}
              </div>
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

function Notice({ text }: { text: string }) {
  return <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">{text}</div>
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
        <span className="ml-2 text-[11px] text-slate-500">fills cases you led + evidence you collected this week</span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Week starting (Mon)</label>
          <input type="date" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Arrests</label>
          <input type="number" min={0} value={arrests} onChange={(e) => setArrests(e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Cases worked</label>
          <input value={casesWorked} onChange={(e) => setCasesWorked(e.target.value)} placeholder="SAB-900001, SAB-900007 …" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Evidence collected (#)</label>
          <input type="number" min={0} value={evidenceCount} onChange={(e) => setEvidenceCount(e.target.value)} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className={inputCls} />
        </div>
      </div>
      <button onClick={() => void save()} disabled={busy} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-60">
        {record ? 'Save changes' : 'Submit report'}
      </button>
    </Modal>
  )
}
