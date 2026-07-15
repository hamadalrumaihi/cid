'use client'

/** Ballistics & Logistics — port of vanilla ballistics.js. Weapon benches
 *  split by street/organized type (persisted tab in the shared Store blob),
 *  tier/heat tints, outputs + component tracing, linked-case chips; plus the
 *  ballistic footprint log with gang/case links. */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { insert, list, remove, update, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { Store } from '@/lib/store'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { Notice, EmptyState } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { inputCls, labelCls } from '@/components/ui/Field'

type BenchRow = Tables<'ballistics_benches'>
type FootprintRow = Tables<'ballistic_footprints'>
interface CaseOption { id: string; case_number: string }
interface GangOption { id: string; name: string }

export function BallisticsView() {
  const { state, canEdit, canDelete } = useAuth()
  const [benchType, setBenchType] = useState<string>(() => Store.get('benchType', 'street'))
  const [benches, setBenches] = useState<BenchRow[]>([])
  const [footprints, setFootprints] = useState<FootprintRow[]>([])
  const [cases, setCases] = useState<CaseOption[]>([])
  const [gangs, setGangs] = useState<GangOption[]>([])
  const [loading, setLoading] = useState(true)
  const [benchEditor, setBenchEditor] = useState<{ record: BenchRow | null } | null>(null)
  const [fpEditor, setFpEditor] = useState<{ record: FootprintRow | null } | null>(null)
  const vBench = useTableVersion('ballistics_benches')
  const vFp = useTableVersion('ballistic_footprints')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    setLoading(true)
    try {
      const [b, f, cs, gs] = await Promise.all([
        withRetry(() => list('ballistics_benches', { order: 'name' })),
        list('ballistic_footprints', { order: 'created_at', ascending: false }).catch(() => [] as FootprintRow[]),
        list('cases', { select: 'id,case_number', order: 'case_number' }).catch(() => [] as Tables<'cases'>[]),
        list('gangs', { select: 'id,name', order: 'name' }).catch(() => [] as Tables<'gangs'>[]),
      ])
      setBenches(b)
      setFootprints(f)
      setCases(cs as unknown as CaseOption[])
      setGangs(gs as unknown as GangOption[])
    } catch { /* bench list shows its own empty state */ }
    finally { setLoading(false) }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, vBench, vFp])

  const caseNum = useCallback((id: string | null) => cases.find((c) => c.id === id)?.case_number ?? null, [cases])
  const gangName = useCallback((id: string | null) => gangs.find((g) => g.id === id)?.name ?? null, [gangs])
  const pick = (t: string) => { setBenchType(t); Store.set('benchType', t) }

  if (state !== 'in') return <Notice text="Live bench records require sign-in." />
  const shown = benches.filter((b) => b.bench_type === benchType)

  return (
    <div>
      <Card pad="lg" className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <PageHeader
          className="flex-1"
          title="🛠️ Ballistics & Logistics"
          subtitle="Criminal weapon-manufacturing hubs, component tracing & ballistic footprints"
          actions={
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-white/10 bg-ink-850 p-1" role="tablist" aria-label="Bench type">
                {[['street', 'Street Gang Bench'], ['organized', 'Organized Crime Bench']].map(([t, label]) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={benchType === t}
                    onClick={() => pick(t)}
                    className={`rounded-md px-4 py-2 text-xs font-semibold transition ${benchType === t ? 'bg-gradient-to-r from-badge-500 to-blue-700 text-white shadow-glow' : 'text-slate-300 hover:text-white'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {canEdit && (
                <Button variant="primary" onClick={() => setBenchEditor({ record: null })}>
                  + Bench
                </Button>
              )}
            </div>
          }
        />
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="space-y-4">
            {loading ? (
              <p className="text-sm text-slate-400">Loading benches…</p>
            ) : !shown.length ? (
              <EmptyState
                title={`No ${benchType === 'street' ? 'street-gang' : 'organized-crime'} benches yet`}
                hint={canEdit ? 'Log a manufacturing bench to trace its outputs and components.' : 'No benches have been logged for this type yet.'}
                action={canEdit ? { label: '+ Bench', onClick: () => setBenchEditor({ record: null }) } : undefined}
              />
            ) : shown.map((b) => {
              const tierTint = /high/i.test(b.tier ?? '') ? 'border-rose-500/30 bg-rose-500/5 text-rose-300' : 'border-amber-500/30 bg-amber-500/5 text-amber-300'
              const heatTint = b.heat === 'Active' ? 'bg-rose-500/10 text-rose-300' : b.heat === 'Raid Pending' ? 'bg-amber-500/10 text-amber-300' : 'bg-blue-500/10 text-blue-300'
              const cn = caseNum(b.case_id)
              return (
                <Card key={b.id} pad="lg">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-white">{b.name}</h2>
                      <p className="mt-1 text-xs text-slate-400">
                        Linked investigation: {cn ? <span className="font-mono text-blue-300">{cn}</span> : <span className="text-slate-400">none</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {b.tier && <Badge tint={`border ${tierTint}`} className="uppercase">{b.tier}-Tier</Badge>}
                      {b.heat && <Badge tint={heatTint} className="uppercase">{b.heat}</Badge>}
                      {canEdit && <Button size="sm" onClick={() => setBenchEditor({ record: b })}>Edit</Button>}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2">
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Manufacturing Outputs</p>
                      <div className="flex flex-wrap gap-2">
                        {(b.outputs ?? []).length
                          ? (b.outputs ?? []).map((o, i) => <span key={i} className="rounded-full border border-white/10 bg-ink-850 px-3 py-1 text-xs text-slate-200">{o}</span>)
                          : <span className="text-xs text-slate-500">—</span>}
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-blue-300/70">Component Tracing</p>
                      <div className="space-y-1.5">
                        {(b.components ?? []).length
                          ? (b.components ?? []).map((c, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-slate-300"><span className="h-1.5 w-1.5 rounded-full bg-blue-400" />{c}</div>
                          ))
                          : <span className="text-xs text-slate-500">—</span>}
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>

        <Card pad="lg">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><span aria-hidden>🧬</span> Ballistic Footprint Log</h2>
            {canEdit && (
              <Button size="sm" onClick={() => setFpEditor({ record: null })}>
                + Footprint
              </Button>
            )}
          </div>
          <p className="mb-4 text-xs text-slate-400">Seized weapon signatures linked to active gang investigations.</p>
          <div className="space-y-3">
            {!footprints.length ? (
              <p className="text-sm text-slate-400">No footprints logged yet.{canEdit && ' Use “+ Footprint”.'}</p>
            ) : footprints.map((l) => (
              <div key={l.id} className="rounded-xl border border-white/10 bg-ink-900 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-mono text-xs text-violet-300">{l.signature}</p>
                  {canEdit && <button onClick={() => setFpEditor({ record: l })} className="-m-2 p-2 text-[11px] text-slate-400 hover:text-white">edit</button>}
                </div>
                <p className="mt-1 text-sm text-white">{l.weapon || '—'}</p>
                <div className="mt-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-slate-400">{gangName(l.gang_id) ?? '—'}</span>
                  <span className="font-mono text-blue-300">{caseNum(l.case_id) ?? ''}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {benchEditor && (
        <BenchModal record={benchEditor.record} cases={cases} canDelete={canDelete} onClose={() => setBenchEditor(null)} onSaved={() => { setBenchEditor(null); void refresh() }} />
      )}
      {fpEditor && (
        <FootprintModal record={fpEditor.record} cases={cases} gangs={gangs} canDelete={canDelete} onClose={() => setFpEditor(null)} onSaved={() => { setFpEditor(null); void refresh() }} />
      )}
    </div>
  )
}

function BenchModal({ record, cases, canDelete, onClose, onSaved }: {
  record: BenchRow | null
  cases: CaseOption[]
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(record?.name ?? '')
  const [type, setType] = useState<string>(record?.bench_type ?? 'street')
  const [tier, setTier] = useState(record?.tier ?? (record ? '' : 'Low'))
  const [heat, setHeat] = useState(record?.heat ?? '')
  const [caseId, setCaseId] = useState(record?.case_id ?? '')
  const [outputs, setOutputs] = useState((record?.outputs ?? []).join('\n'))
  const [components, setComponents] = useState((record?.components ?? []).join('\n'))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) { toast('Name is required.', 'warn'); return }
    setBusy(true)
    const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
    const payload = {
      name: name.trim(),
      bench_type: type as BenchRow['bench_type'],
      tier: tier.trim() || null,
      heat: heat.trim() || null,
      case_id: caseId || null,
      outputs: lines(outputs),
      components: lines(components),
    }
    const res = record ? await update('ballistics_benches', record.id, payload) : await insert('ballistics_benches', payload)
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(record ? 'Bench updated' : 'Bench created', 'success')
    onSaved()
  }

  const del = async () => {
    if (!record) return
    if (!(await uiConfirm('Delete this bench?', { confirmText: 'Delete' }))) return
    const r = await remove('ballistics_benches', record.id)
    if (r.error) { toast(`Delete failed: ${r.error.message}`, 'danger'); return }
    toast('Bench deleted', 'warn')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader title={record ? 'Edit Weapon Bench' : 'New Weapon Bench'} onClose={onClose} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label htmlFor="bench-name" className={labelCls}>Name *</label><input id="bench-name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} /></div>
        <div>
          <label htmlFor="bench-type" className={labelCls}>Bench Type</label>
          <select id="bench-type" value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            <option value="street">Street Gang</option>
            <option value="organized">Organized Crime</option>
          </select>
        </div>
        <div>
          <label htmlFor="bench-tier" className={labelCls}>Tier</label>
          <input id="bench-tier" value={tier} onChange={(e) => setTier(e.target.value)} list="tier-list" className={inputCls} />
          <datalist id="tier-list"><option value="Low" /><option value="High" /></datalist>
        </div>
        <div>
          <label htmlFor="bench-heat" className={labelCls}>Heat</label>
          <input id="bench-heat" value={heat} onChange={(e) => setHeat(e.target.value)} list="heat-list" className={inputCls} />
          <datalist id="heat-list"><option value="Active" /><option value="Surveillance" /><option value="Raid Pending" /></datalist>
        </div>
        <div>
          <label htmlFor="bench-case" className={labelCls}>Linked Case</label>
          <select id="bench-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} className={inputCls}>
            <option value="">— none —</option>
            {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="bench-outputs" className={labelCls}>Outputs <span className="text-slate-400">(one per line)</span></label>
          <textarea id="bench-outputs" value={outputs} onChange={(e) => setOutputs(e.target.value)} rows={3} className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="bench-components" className={labelCls}>Components <span className="text-slate-400">(one per line)</span></label>
          <textarea id="bench-components" value={components} onChange={(e) => setComponents(e.target.value)} rows={3} className={inputCls} />
        </div>
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" className="flex-1" disabled={busy} onClick={() => void save()}>
          {record ? 'Save changes' : 'Create bench'}
        </Button>
        {record && canDelete && (
          <button onClick={() => void del()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>
        )}
      </div>
    </Modal>
  )
}

function FootprintModal({ record, cases, gangs, canDelete, onClose, onSaved }: {
  record: FootprintRow | null
  cases: CaseOption[]
  gangs: GangOption[]
  canDelete: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [signature, setSignature] = useState(record?.signature ?? '')
  const [weapon, setWeapon] = useState(record?.weapon ?? '')
  const [gangId, setGangId] = useState(record?.gang_id ?? '')
  const [caseId, setCaseId] = useState(record?.case_id ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!signature.trim()) { toast('Signature is required.', 'warn'); return }
    setBusy(true)
    const payload = { signature: signature.trim(), weapon: weapon.trim() || null, gang_id: gangId || null, case_id: caseId || null }
    const res = record ? await update('ballistic_footprints', record.id, payload) : await insert('ballistic_footprints', payload)
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast(record ? 'Footprint updated' : 'Footprint logged', 'success')
    onSaved()
  }

  const del = async () => {
    if (!record) return
    if (!(await uiConfirm('Delete this footprint?', { confirmText: 'Delete' }))) return
    const r = await remove('ballistic_footprints', record.id)
    if (r.error) { toast(`Delete failed: ${r.error.message}`, 'danger'); return }
    toast('Footprint deleted', 'warn')
    onSaved()
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader title={record ? 'Edit Ballistic Footprint' : 'New Ballistic Footprint'} onClose={onClose} />
      <div className="space-y-3">
        <div>
          <label htmlFor="fp-signature" className={labelCls}>Signature *</label>
          <input id="fp-signature" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="BLSTC-77-A · 9mm striations" className={`${inputCls} font-mono`} />
        </div>
        <div>
          <label htmlFor="fp-weapon" className={labelCls}>Weapon</label>
          <input id="fp-weapon" value={weapon} onChange={(e) => setWeapon(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="fp-gang" className={labelCls}>Linked Gang</label>
            <select id="fp-gang" value={gangId} onChange={(e) => setGangId(e.target.value)} className={inputCls}>
              <option value="">— none —</option>
              {gangs.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="fp-case" className={labelCls}>Linked Case</label>
            <select id="fp-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} className={inputCls}>
              <option value="">— none —</option>
              {cases.map((c) => <option key={c.id} value={c.id}>{c.case_number}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="mt-5 flex gap-2">
        <Button variant="primary" className="flex-1" disabled={busy} onClick={() => void save()}>
          {record ? 'Save' : 'Log footprint'}
        </Button>
        {record && canDelete && (
          <button onClick={() => void del()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>
        )}
      </div>
    </Modal>
  )
}
