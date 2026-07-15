'use client'

import { useCallback, useEffect, useState } from 'react'
import { insert, list, deleteWithUndo } from '@/lib/db'
import { Button } from '@/components/ui/Button'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { type CaseRow, type GangRow, type IntelRow, type PersonRow, type PlaceRow } from './shared'

export function IntelTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const [links, setLinks] = useState<IntelRow[]>([])
  const [people, setPeople] = useState<PersonRow[]>([])
  const [gangs, setGangs] = useState<GangRow[]>([])
  const [places, setPlaces] = useState<PlaceRow[]>([])
  const [kind, setKind] = useState('person')
  const [ref, setRef] = useState('')
  const [role, setRole] = useState('Subject')
  const v = useTableVersion('case_intel_links')
  const refresh = useCallback(async () => {
    try {
      const [l, p, g, pl] = await Promise.all([list('case_intel_links', { eq: { case_id: c.id } }), list('persons', { order: 'name' }), list('gangs', { order: 'name' }), list('places', { order: 'name' })])
      setLinks(l); setPeople(p); setGangs(g); setPlaces(pl)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === '42P01' || code === 'PGRST205') toast('Intel links table is not available in this environment.', 'warn')
    }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  const pool = kind === 'person' ? people : kind === 'gang' ? gangs : places
  const label = (l: IntelRow) => {
    const src = l.kind === 'person' ? people : l.kind === 'gang' ? gangs : places
    return src.find((x) => x.id === l.ref_id)?.name || l.ref_id
  }
  const add = async () => {
    if (!ref) return
    const res = await insert('case_intel_links', { case_id: c.id, kind, ref_id: ref, role })
    if (res.error) toast(res.error.message, 'danger')
    else { setRef(''); toast('Intel linked.', 'success'); void refresh() }
  }
  return (
    <div className="space-y-4">
      {canEdit && <div className="grid gap-2 rounded-xl border border-white/10 bg-ink-950/50 p-4 md:grid-cols-[10rem_1fr_10rem_auto]">
        <select value={kind} onChange={(e) => { setKind(e.target.value); setRef('') }} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white"><option value="person">Person</option><option value="gang">Gang</option><option value="place">Place</option></select>
        <select value={ref} onChange={(e) => setRef(e.target.value)} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white"><option value="">Choose...</option>{pool.filter((x) => !links.some((l) => l.kind === kind && l.ref_id === x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <input value={role} onChange={(e) => setRole(e.target.value)} className="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-white" />
        <Button variant="primary" onClick={add}>Link</Button>
      </div>}
      {(['person', 'gang', 'place'] as const).map((section) => <div key={section} className="rounded-xl border border-white/10 bg-ink-950/50 p-4"><h3 className="mb-2 font-bold capitalize text-white">{section}s</h3><div className="flex flex-wrap gap-2">{links.filter((l) => l.kind === section).map((l) => <span key={l.id} className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm text-slate-200">{label(l)} <span className="text-xs text-slate-500">{l.role}</span>{canDelete && <button aria-label={`Unlink ${label(l)}`} onClick={() => void deleteWithUndo('case_intel_links', l, { confirmTitle: 'Remove link', confirmMessage: `Unlink ${label(l)} from this case? The ${l.kind} record itself is kept — only the link is removed. You can undo this for a few seconds.`, confirmText: 'Unlink', label: 'link', after: refresh })} className="text-rose-300 hover:text-rose-200">×</button>}</span>)}{!links.some((l) => l.kind === section) && <p className="text-sm text-slate-500">None linked.</p>}</div></div>)}
    </div>
  )
}
