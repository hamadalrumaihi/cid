'use client'

/** GPS tracker deployment logs (command.js:430-572) — dual digital signatures
 *  (Director + Deputy co-sign; self-co-sign blocked per "no single-person
 *  approval") with a live countdown once authorized. Sign/deploy/remove are
 *  command-gated (canDelete); RLS is the real enforcement. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Database } from '@/lib/database.types'
import { insert, list, remove, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { SignatureViewer } from '@/components/shared/SignatureViewer'
import { caseNumById, fmtCountdown, type CaseRow, type TrackerRow } from './commandUtils'
import { Card } from '@/components/ui/Card'

type Bureau = Database['public']['Enums']['bureau']

const remainingMs = (expMs: number): number => expMs - Date.now()
const isoInHours = (h: number): string => new Date(Date.now() + h * 3.6e6).toISOString()

export function Trackers({ cases }: { cases: CaseRow[] }) {
  const { profile, state, canDelete } = useAuth()
  const [trackers, setTrackers] = useState<TrackerRow[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [, setTick] = useState(0)
  const expiring = useRef(new Set<string>())
  const v = useTableVersion('trackers')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    try { setTrackers(await list('trackers', { order: 'created_at', ascending: false })) }
    catch (e) { toast(`Couldn't load trackers — ${e instanceof Error ? e.message : e}`, 'danger') }
  }, [state])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, v])

  // 1s countdown tick (vanilla app.js setInterval(tickTrackers, 1000)); the
  // first command viewer to see an authorized tracker hit zero expires it,
  // guarded so one client only tries once per tracker.
  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((t) => t + 1)
      if (!canDelete) return
      for (const t of trackers) {
        const authorized = t.status === 'authorized' && t.director_sig && t.deputy_sig
        const expMs = t.expires_at ? new Date(t.expires_at).getTime() : 0
        if (authorized && expMs && expMs - Date.now() <= 0 && !expiring.current.has(t.id)) {
          expiring.current.add(t.id)
          void update('trackers', t.id, { status: 'expired' }).then(() => refresh())
        }
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [trackers, canDelete, refresh])

  const cosign = async (t: TrackerRow) => {
    if (!profile) return
    if (t.director_sig === profile.id) { toast('A second command officer must co-sign (no single-person approval).', 'warn'); return }
    const expires = isoInHours(t.duration_hours || 24)
    const res = await update('trackers', t.id, { deputy_sig: profile.id, status: 'authorized', authorized_at: new Date().toISOString(), expires_at: expires })
    if (res.error) { toast(`Co-sign failed: ${res.error.message}`, 'danger'); return }
    void notify(t.director_sig, 'tracker_authorized', { tracker_code: t.tracker_code, target: t.target })
    void notify(profile.id, 'tracker_authorized', { tracker_code: t.tracker_code, target: t.target })
    toast(`${t.tracker_code} fully authorized — tracking live`, 'success')
    void refresh()
  }

  const removeTracker = async (t: TrackerRow) => {
    if (!(await uiConfirm(`Remove tracker ${t.tracker_code}?`, { confirmText: 'Remove' }))) return
    const r = await remove('trackers', t.id)
    if (r.error) { toast(`Delete failed: ${r.error.message}`, 'danger'); return }
    toast('Tracker removed', 'warn')
    void refresh()
  }

  return (
    <Card pad="lg">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white"><span aria-hidden="true">🛰️</span> Tracker Deployment Logs</h3>
        {canDelete && (
          <Button size="sm" variant="primary" onClick={() => setModalOpen(true)}>
            + Authorize
          </Button>
        )}
      </div>
      <p className="mb-4 text-xs text-slate-400">GPS tracker deployment requires dual digital signatures (Director &amp; Deputy Director). Live countdown shows remaining authorized duration.</p>

      <div className="space-y-3">
        {state !== 'in' ? <p className="text-sm text-slate-500">Sign in to view tracker authorizations.</p>
          : !trackers.length ? <p className="text-sm text-slate-500">No tracker authorizations.{canDelete ? ' Use "+ Authorize".' : ''}</p>
          : trackers.map((t) => {
            const expMs = t.expires_at ? new Date(t.expires_at).getTime() : 0
            const remaining = expMs ? remainingMs(expMs) : 0
            const authorized = t.status === 'authorized' && !!t.director_sig && !!t.deputy_sig
            const expired = t.status === 'expired' || (authorized && remaining <= 0)
            return (
              <div key={t.id} className="rounded-xl border border-white/10 bg-ink-900 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs text-blue-300">{t.tracker_code}</p>
                    <p className="mt-0.5 text-sm font-semibold text-white">{t.target}</p>
                    <p className="text-[11px] text-slate-400">{caseNumById(cases, t.case_id) || '—'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-slate-400">{authorized ? 'Remaining' : 'Status'}</p>
                    {authorized
                      ? <p className={`font-mono text-sm font-bold ${remaining > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>{fmtCountdown(remaining)}</p>
                      : <p className="text-sm font-bold text-amber-300">{expired ? 'EXPIRED' : 'Pending'}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded-md px-2 py-1 ${t.director_sig ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-slate-400'}`}>
                    {t.director_sig ? `✓ ${officerName(t.director_sig)}` : 'Director ✗'}
                  </span>
                  <span className={`rounded-md px-2 py-1 ${t.deputy_sig ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-slate-400'}`}>
                    {t.deputy_sig ? `✓ ${officerName(t.deputy_sig)}` : 'Deputy ✗'}
                  </span>
                  <span className={`ml-auto rounded-md px-2 py-1 text-[10px] font-semibold uppercase ${expired ? 'bg-rose-500/10 text-rose-300' : authorized ? 'bg-blue-500/10 text-blue-300' : 'bg-amber-500/10 text-amber-300'}`}>
                    {expired ? 'Expired' : authorized ? 'Authorized' : 'Pending dual-sign'}
                  </span>
                </div>
                {(t.director_sig || t.deputy_sig) && (
                  <div className="mt-2">
                    <SignatureViewer signatures={[
                      ...(t.director_sig ? [{ id: `${t.id}-director`, name: officerName(t.director_sig) ?? 'Officer', role: 'command co-sign', action: 'tracker authorization', at: t.created_at }] : []),
                      ...(t.deputy_sig ? [{ id: `${t.id}-deputy`, name: officerName(t.deputy_sig) ?? 'Officer', role: 'command co-sign', action: 'tracker authorization', at: t.authorized_at }] : []),
                    ]} />
                  </div>
                )}
                {canDelete && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!authorized && !expired && (
                      <button onClick={() => void cosign(t)} className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-semibold text-white transition hover:bg-white/10">
                        Co-sign as Deputy
                      </button>
                    )}
                    <button onClick={() => void removeTracker(t)} aria-label="Remove" className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">
                      ✕
                    </button>
                  </div>
                )}
              </div>
            )
          })}
      </div>

      {modalOpen && <TrackerModal cases={cases} onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); void refresh() }} />}
    </Card>
  )
}

/** Mounted fresh per open — the director signature prefills with the signer's
 *  name via the initializer; no reset effect needed. */
function TrackerModal({ cases, onClose, onSaved }: { cases: CaseRow[]; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [target, setTarget] = useState('')
  const [caseId, setCaseId] = useState('')
  const [director, setDirector] = useState(profile?.display_name || '')
  const [duration, setDuration] = useState('24')
  const [busy, setBusy] = useState(false)

  const deploy = async () => {
    if (!profile) return
    if (!target.trim() || !director.trim()) { toast('Target + Director signature are required.', 'warn'); return }
    setBusy(true)
    const dur = Math.max(1, Number(duration) || 24)
    const linked = cases.find((c) => c.id === caseId)
    const payload = {
      tracker_code: `TRK-${Math.floor(1000 + Math.random() * 9000)}`,
      target: target.trim(),
      case_id: caseId || null,
      bureau: (linked ? linked.bureau : 'JTF') as Bureau,
      director_sig: profile.id,
      duration_hours: dur,
      status: 'pending' as const,
    }
    const res = await insert('trackers', payload)
    if (res.error) { setBusy(false); toast(`Deploy failed: ${res.error.message}`, 'danger'); return }
    void notify(profile.id, 'tracker_pending', { tracker_code: payload.tracker_code, target: payload.target })
    toast('Tracker logged — awaiting deputy co-sign', 'success')
    onSaved()
  }

  const dirty = () => !!(target.trim() || caseId)
  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Surveillance Authorization</p>
        <ModalHeader title="Deploy GPS Tracker" onClose={onClose} />
        <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
          Per SOP Title 7, deployment requires dual command authorization. You sign as Director now; a second command officer co-signs to activate.
        </p>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Target Vehicle / Subject *</label>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="e.g. Black Sandking — plate 4XYZ" className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Associated Case</label>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">
              <option value="">— none —</option>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Director Signature *</label>
              <input value={director} onChange={(e) => setDirector(e.target.value)} placeholder="Your name" className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 font-[cursive] text-blue-200 outline-none focus:border-badge-500" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Duration (hours)</label>
              <input type="number" min={1} max={168} value={duration} onChange={(e) => setDuration(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" />
            </div>
          </div>
        </div>
        <Button variant="primary" className="mt-5 w-full" disabled={busy} onClick={() => void deploy()}>
          {busy ? 'Deploying…' : 'Deploy (awaiting deputy co-sign)'}
        </Button>
      </div>
    </Modal>
  )
}
