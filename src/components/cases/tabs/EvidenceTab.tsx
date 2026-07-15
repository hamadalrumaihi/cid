'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { WorkflowTimeline } from '@/components/ui/WorkflowTimeline'
import { uiPrompt } from '@/components/ui/dialog'
import { deleteWithUndo, insert, list, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { mutateThen, type CaseRow, type CustodyRow, type EvidenceRow, type MediaRow } from './shared'

export function EvidenceTab({ c, canEdit, canDelete }: { c: CaseRow; canEdit: boolean; canDelete: boolean }) {
  const { profile } = useAuth()
  const [rows, setRows] = useState<EvidenceRow[]>([])
  const [custody, setCustody] = useState<CustodyRow[]>([])
  const [media, setMedia] = useState<MediaRow[]>([])
  const [modal, setModal] = useState<'evidence' | 'media' | null>(null)
  const [chainOpen, setChainOpen] = useState<Record<string, boolean>>({})
  const [item, setItem] = useState({ item_code: '', type: '', description: '', location: '' })
  const [link, setLink] = useState({ title: '', type: 'document', external_url: '' })
  const vE = useTableVersion('evidence')
  const vC = useTableVersion('custody_chain')
  const vM = useTableVersion('media')
  const refresh = useCallback(async () => {
    try {
      const [e, cc, m] = await Promise.all([
        list('evidence', { eq: { case_id: c.id }, order: 'created_at', ascending: false }),
        list('custody_chain', { order: 'at', ascending: false }),
        list('media', { eq: { case_id: c.id }, order: 'created_at', ascending: false }),
      ])
      setRows(e)
      setCustody(cc.filter((x) => e.some((ev) => ev.id === x.evidence_id)))
      setMedia(m)
    } catch { /* stale */ }
  }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, vE, vC, vM])

  const nextCode = () => `EV-${String(rows.length + 1).padStart(3, '0')}`
  const addEvidence = async () => {
    if (!item.description.trim()) { toast('Description is required.', 'warn'); return }
    const res = await insert('evidence', {
      case_id: c.id,
      item_code: item.item_code.trim() || nextCode(),
      type: item.type.trim() || null,
      description: item.description.trim(),
      location: item.location.trim() || null,
      collected_by: profile?.id ?? null,
      tamper: 'intact',
    })
    if (res.error) toast(res.error.message, 'danger')
    else { setItem({ item_code: '', type: '', description: '', location: '' }); setModal(null); toast('Evidence logged.', 'success'); void refresh() }
  }
  const addMedia = async () => {
    const url = safeUrl(link.external_url)
    if (!link.title.trim() || !url) { toast('Title and safe URL are required.', 'warn'); return }
    const res = await insert('media', { case_id: c.id, title: link.title.trim(), type: link.type as MediaRow['type'], external_url: url })
    if (res.error) toast(res.error.message, 'danger')
    else { setLink({ title: '', type: 'document', external_url: '' }); setModal(null); toast('Media linked.', 'success'); void refresh() }
  }
  const transfer = async (ev: EvidenceRow) => {
    const to = await uiPrompt('Transfer custody to officer / locker / lab:', { title: ev.item_code || 'Custody transfer', placeholder: 'Forensics locker', confirmText: 'Record' })
    if (!to) return
    const last = custody.find((x) => x.evidence_id === ev.id)
    const res = await insert('custody_chain', { evidence_id: ev.id, from_officer: last?.to_officer ?? officerName(ev.collected_by) ?? null, to_officer: to, transferred_by: profile?.id ?? null })
    if (res.error) toast(res.error.message, 'danger')
    else { toast('Custody transfer recorded.', 'success'); void refresh() }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-end gap-2">
        {canEdit && <Button variant="primary" onClick={() => { setItem((x) => ({ ...x, item_code: x.item_code || nextCode() })); setModal('evidence') }}>Add Evidence</Button>}
        {canEdit && <Button onClick={() => setModal('media')}>Add Link</Button>}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {rows.map((ev) => {
          const chain = custody.filter((x) => x.evidence_id === ev.id)
          return (
            <article key={ev.id} className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-mono text-sm font-bold text-badge-200">{ev.item_code || 'Evidence'}</p><h3 className="font-bold text-white">{ev.description || ev.type || 'Untitled item'}</h3></div>
                <Badge tint={ev.tamper === 'intact' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'} className="uppercase">{ev.tamper}</Badge>
              </div>
              <p className="mt-2 text-sm text-slate-400">{[ev.type, ev.location].filter(Boolean).join(' - ') || 'No location/type recorded.'}</p>
              <button onClick={() => setChainOpen((o) => ({ ...o, [ev.id]: !o[ev.id] }))} aria-expanded={!!chainOpen[ev.id]} className="mt-2 text-xs text-slate-400 hover:text-slate-200">Custody entries: {chain.length} <span aria-hidden>{chainOpen[ev.id] ? '▴' : '▾'}</span></button>
              {chainOpen[ev.id] && (
                <div className="mt-2">
                  {/* chain is fetched newest-first for transfer(); the expansion reads oldest → newest */}
                  <WorkflowTimeline dense empty="No custody entries yet." entries={[...chain].reverse().map((x) => ({ id: x.id, title: x.to_officer ? `Transferred to ${x.to_officer}` : 'Logged', actor: officerName(x.transferred_by), at: x.at, note: x.from_officer ? `from ${x.from_officer}` : null }))} />
                </div>
              )}
              <div className="mt-3 flex gap-2">
                {canEdit && <Button size="sm" onClick={() => void transfer(ev)}>Transfer</Button>}
                {canDelete && <button onClick={() => { void deleteWithUndo('evidence', ev, { label: ev.item_code || 'evidence', children: [{ table: 'custody_chain', column: 'evidence_id' }], after: refresh }) }} className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs font-bold text-rose-300">Delete</button>}
              </div>
            </article>
          )
        })}
        {!rows.length && <p className="rounded-xl border border-white/10 bg-ink-950/50 p-8 text-center text-sm text-slate-500 lg:col-span-2">No evidence logged.</p>}
      </div>
      <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4">
        <h3 className="font-bold text-white">Linked Media</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {media.map((m) => {
            const url = safeUrl(m.external_url || m.storage_path)
            return <div key={m.id} className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm"><p className="font-bold text-white">{m.title}</p><p className="text-xs uppercase text-slate-500">{m.type}</p>{url && <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-badge-200 hover:text-white">Open</a>}{canEdit && <button onClick={() => mutateThen(update('media', m.id, { case_id: null }), refresh)} className="ml-3 text-xs font-bold text-rose-300">Detach</button>}</div>
          })}
          {!media.length && <p className="text-sm text-slate-500">No linked media.</p>}
        </div>
      </div>
      <Modal open={modal === 'evidence'} onClose={() => setModal(null)}>
        <div className="p-5"><ModalHeader title="Add evidence" onClose={() => setModal(null)} /><div className="space-y-3">
          <input value={item.item_code} onChange={(e) => setItem({ ...item, item_code: e.target.value })} placeholder="Item code" className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <input value={item.type} onChange={(e) => setItem({ ...item, type: e.target.value })} placeholder="Type" className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <input value={item.location} onChange={(e) => setItem({ ...item, location: e.target.value })} placeholder="Location" className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <textarea value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} placeholder="Description" rows={4} className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <Button variant="primary" className="w-full" onClick={addEvidence}>Save evidence</Button>
        </div></div>
      </Modal>
      <Modal open={modal === 'media'} onClose={() => setModal(null)}>
        <div className="p-5"><ModalHeader title="Add media link" onClose={() => setModal(null)} /><div className="space-y-3">
          <input value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} placeholder="Title" className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <select value={link.type} onChange={(e) => setLink({ ...link, type: e.target.value })} className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white"><option value="document">Document</option><option value="image">Image</option><option value="video">Video</option><option value="fivemanage">FiveManage</option></select>
          <input value={link.external_url} onChange={(e) => setLink({ ...link, external_url: e.target.value })} placeholder="https://..." className="w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-white" />
          <Button variant="primary" className="w-full" onClick={addMedia}>Save link</Button>
        </div></div>
      </Modal>
    </div>
  )
}
