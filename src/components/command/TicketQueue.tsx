'use client'

/** Odyssey ticket intake queue + 3-step processing wizard (command.js:163-428).
 *  Wizard: confirm jurisdiction (misroutes auto-rename the ticket code) →
 *  type the bureau-prefixed case number (validated, uniqueness enforced by
 *  the DB) → provisioning summary. Sort/paging waits on the shared data-table
 *  engine slice. */
import { useCallback, useEffect, useState } from 'react'
import type { Database } from '@/lib/database.types'
import { insert, list, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { CASE_NUM_LEAD, DEPT_ROUTING, TICKET_BUREAUS, caseNumById, type CaseRow, type TicketRow } from './commandUtils'

type Bureau = Database['public']['Enums']['bureau']

export function TicketQueue({ cases, onCaseCreated }: { cases: CaseRow[]; onCaseCreated: () => void }) {
  const { state, canEdit } = useAuth()
  const [tickets, setTickets] = useState<TicketRow[]>([])
  /** Suggested ticket code, generated in the click handler (modal mounts fresh per open). */
  const [newTicketCode, setNewTicketCode] = useState<string | null>(null)
  const [wizardTicket, setWizardTicket] = useState<TicketRow | null>(null)
  const v = useTableVersion('tickets')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    try { setTickets(await list('tickets', { order: 'created_at', ascending: false })) }
    catch { toast('Could not load the ticket queue — check your connection.', 'danger') }
  }, [state])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, v])

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-6 py-4">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-white"><span className="text-lg" aria-hidden="true">🎫</span> Odyssey Ticket Intake Queue</h3>
          <p className="text-xs text-slate-400">Incoming tickets from Odyssey Roleplay Services — awaiting jurisdiction review</p>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              onClick={() => setNewTicketCode(`ticket-${Math.floor(10000 + Math.random() * 89999)}`)}
              className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110"
            >
              + New Ticket
            </button>
          )}
          <span className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live sync
          </span>
        </div>
      </div>

      {state !== 'in' ? (
        <p className="px-2 py-6 text-center text-sm text-slate-500">Sign in to view the intake queue.</p>
      ) : !tickets.length ? (
        <p className="px-2 py-6 text-center text-sm text-slate-500">No tickets in the queue.{canEdit ? ' Use "+ New Ticket".' : ''}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3 font-semibold">Ticket ID</th>
                <th className="px-4 py-3 font-semibold">Source</th>
                <th className="px-4 py-3 font-semibold">Description</th>
                <th className="px-4 py-3 font-semibold">Reported Dept</th>
                <th className="px-4 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3"><span className="rounded-md bg-ink-800 px-2 py-1 font-mono text-xs text-blue-300">{t.ticket_code}</span></td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-slate-300"><span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />{t.source || 'Discord'}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{t.description || ''}</td>
                  <td className="px-4 py-3"><span className="rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs font-semibold text-slate-200">{t.reported_dept || '—'}</span></td>
                  <td className="px-4 py-3 text-right">
                    {t.status === 'processed' ? (
                      <span className="rounded-md bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-300">{caseNumById(cases, t.case_id) || 'processed'}</span>
                    ) : canEdit ? (
                      <button onClick={() => setWizardTicket(t)} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110">
                        Process
                      </button>
                    ) : (
                      <span className="text-[11px] text-amber-300">pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {newTicketCode !== null && (
        <NewTicketModal defaultCode={newTicketCode} onClose={() => setNewTicketCode(null)} onSaved={() => { setNewTicketCode(null); void refresh() }} />
      )}
      {wizardTicket && (
        <TicketWizard key={wizardTicket.id} ticket={wizardTicket} onClose={() => setWizardTicket(null)} onDone={() => { setWizardTicket(null); void refresh(); onCaseCreated() }} />
      )}
    </div>
  )
}

/** Mounted fresh per open, so field state initializes here — no reset effect. */
function NewTicketModal({ defaultCode, onClose, onSaved }: { defaultCode: string; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(defaultCode)
  const [source, setSource] = useState('Discord Ticket')
  const [dept, setDept] = useState('LSPD')
  const [desc, setDesc] = useState('')

  const save = async () => {
    if (!code.trim() || !desc.trim()) { toast('Ticket code + description required.', 'warn'); return }
    const res = await insert('tickets', { status: 'new', ticket_code: code.trim(), source: source.trim(), reported_dept: dept, description: desc.trim() })
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Ticket queued', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!desc.trim()}>
      <div className="p-6">
        <ModalHeader title="New Intake Ticket" onClose={onClose} />
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Ticket Code *</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-badge-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Source</label>
              <input value={source} onChange={(e) => setSource(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Reported Dept</label>
              <select value={dept} onChange={(e) => setDept(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">
                <option>LSPD</option><option>BCSO</option><option>SAHP</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Description *</label>
            <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
          </div>
        </div>
        <button onClick={() => void save()} className="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
          Add to Queue
        </button>
      </div>
    </Modal>
  )
}

/* ---- 3-step processing wizard --------------------------------------------- */
/** Keyed by ticket id in the parent, so a new ticket remounts the wizard and
 *  the initializers below reset every step. */
function TicketWizard({ ticket, onClose, onDone }: { ticket: TicketRow; onClose: () => void; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [routedDept, setRoutedDept] = useState(ticket.reported_dept || 'LSPD')
  const [bureau, setBureau] = useState(DEPT_ROUTING[ticket.reported_dept || 'LSPD']?.bureau || 'LSB')
  const [num, setNum] = useState('')
  const [created, setCreated] = useState<{ caseNumber: string; bureau: string } | null>(null)

  // Misrouted tickets are auto-renamed to the destination's channel prefix.
  const misrouted = routedDept !== ticket.reported_dept
  const workingId = misrouted ? ticket.ticket_code.replace(/^ticket/i, DEPT_ROUTING[routedDept].rename) : ticket.ticket_code
  const lead = CASE_NUM_LEAD[bureau] || '9'

  const createCase = async () => {
    if (!/^\d+$/.test(num)) { toast('Enter the numeric case number (digits only) — the bureau prefix is added automatically.', 'warn'); return }
    if (num[0] !== lead) toast(`Note: ${bureau} case numbers usually start with ${lead} — saving anyway.`, 'warn')
    const full = `${bureau}-${num}`
    const res = await insert('cases', { case_number: full, title: ticket.description || workingId, bureau: bureau as Bureau, status: 'open' })
    if (res.error) {
      const dup = /duplicate|unique|already exists|23505/i.test(res.error.message || '')
      toast(dup ? `Case number ${full} already exists — choose a unique number.` : `Case create failed: ${res.error.message}`, 'danger')
      return
    }
    const newCaseId = res.data?.[0]?.id ?? null
    const tu = await update('tickets', ticket.id, { status: 'processed', case_id: newCaseId, routed_bureau: bureau as Bureau })
    if (tu.error) toast(`Case created, but the ticket wasn't marked processed: ${tu.error.message} — re-check the queue.`, 'warn')
    setCreated({ caseNumber: full, bureau })
    setStep(3)
  }

  const finish = () => {
    if (created) toast(`${created.caseNumber} created · saved to Supabase`, 'success')
    onDone()
  }

  const channelSlug = (created?.caseNumber ?? '').replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const driveUrl = created ? `https://drive.cid.sa.gov/${(TICKET_BUREAUS[created.bureau]?.prefix || created.bureau).toLowerCase()}/${channelSlug}` : ''

  return (
    <Modal open onClose={onClose} dirty={() => step === 2 && !!num}>
      <div className="p-6">
        {step === 1 && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Step 1 of 3</p>
            <ModalHeader title="Jurisdictional Routing" onClose={onClose} />
            <div className="mb-5 rounded-xl border border-white/10 bg-ink-900 p-4 text-sm">
              <p className="font-mono text-xs text-blue-300">{workingId}</p>
              <p className="mt-1 text-slate-200">{ticket.description || ''}</p>
              <p className="mt-2 text-xs text-slate-400">Originally reported: <span className="font-semibold text-slate-200">{ticket.reported_dept || '—'}</span></p>
            </div>
            <p className="mb-1 block text-xs font-semibold text-slate-400">Confirm correct jurisdiction</p>
            <div className="mb-4 grid grid-cols-3 gap-2">
              {['LSPD', 'BCSO', 'SAHP'].map((d) => (
                <button
                  key={d}
                  onClick={() => { setRoutedDept(d); setBureau(DEPT_ROUTING[d].bureau) }}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${d === routedDept ? 'border-badge-500 bg-blue-500/10 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
                >
                  {d}
                </button>
              ))}
            </div>
            {misrouted && (
              <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                ⚠️ Misrouted ticket detected. Auto-renaming <span className="font-mono">{ticket.ticket_code}</span> → <span className="font-mono font-bold">{workingId}</span> and tagging <b>{routedDept}</b>.
              </p>
            )}
            <button onClick={() => setStep(2)} className="w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
              Confirm Routing →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Step 2 of 3</p>
            <ModalHeader title="Case Number Entry" onClose={onClose} />
            <div className="mb-4 rounded-lg border border-white/10 bg-ink-900 p-3 text-xs text-slate-400">
              Source ticket: <span className="font-mono text-blue-300">{workingId}</span> · Jurisdiction: <span className="font-semibold text-slate-200">{routedDept}</span>
            </div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Bureau (auto-selected from jurisdiction)</label>
            <select value={bureau} onChange={(e) => setBureau(e.target.value)} className="mb-4 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">
              {Object.entries(TICKET_BUREAUS).map(([k, b]) => (
                <option key={k} value={k}>{b.name} — [{b.prefix}] ({b.dept})</option>
              ))}
            </select>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Case Number — type it (format BUREAU-NUMBER)</label>
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-lg bg-ink-800 px-3 py-2.5 font-mono text-sm font-semibold text-blue-300">{bureau}-</span>
              <input value={num} onChange={(e) => setNum(e.target.value.trim())} inputMode="numeric" placeholder={`${lead}xxxxx`} className="flex-1 rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-badge-500" />
            </div>
            <p className="mb-5 text-[11px] text-slate-500">LSB→1xxxxx · BCB→2xxxxx · SAB/JTF→9xxxxx. Must be unique.</p>
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">← Back</button>
              <button onClick={() => void createCase()} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white transition hover:brightness-110">Create Case File →</button>
            </div>
          </>
        )}

        {step === 3 && created && (
          <div className="p-2 text-center">
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15">
              <svg className="h-8 w-8 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <h3 className="text-xl font-bold text-white">Case File Generated</h3>
            <p className="mt-1 font-mono text-sm text-blue-300">{created.caseNumber}</p>
            <div className="mt-5 space-y-3 text-left">
              <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-900 p-3">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
                <span className="text-sm text-slate-200">Discord channel <b className="text-white">#{channelSlug}</b> provisioned</span>
              </div>
              <div className="rounded-lg border border-white/5 bg-ink-900 p-3">
                <p className="text-xs text-slate-400">Simulated Google Drive folder</p>
                <span className="break-all font-mono text-xs text-blue-300">{driveUrl}</span>
              </div>
            </div>
            <button onClick={finish} className="mt-6 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
              Done
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
