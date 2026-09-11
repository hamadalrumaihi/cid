'use client'

/** Generate Case Packet — the SERVER-rendered, manifested packet
 *  (`case_packet_request`). Type presets fill the section checklist (the
 *  same presets the RPC applies when sections are omitted); watermark text
 *  and a note ride in `p_options`. Submitting never waits for the render:
 *  the packet appears in Documents → Case Packets and the requester is
 *  notified when it is ready. Restricted media without a fresh approval and
 *  sealed legal material are excluded by the server before the snapshot
 *  exists — the dialog says so, and never offers a way around it. */
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { caseLink } from '@/lib/caseLinks'
import {
  DEFAULT_PACKET_SECTIONS, PACKET_SECTIONS, PACKET_TYPES, normalizeSections, type PacketSectionId, type PacketType,
} from '@/lib/packets'
import { pdfService } from '@/lib/services/pdf/pdf-service'
import { toast } from '@/lib/toast'
import type { CaseRow } from '../shared'

const CHECK = 'h-4 w-4 flex-shrink-0 rounded border-white/20 bg-ink-950 text-badge-500 focus:ring-0'
const OPTION_ROW = 'flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-white/10 px-3 py-2 transition hover:bg-white/5 has-[:checked]:border-badge-500/50 has-[:checked]:bg-badge-500/10'

export function GeneratePacketDialog({ open, c, onClose, onRequested }: {
  open: boolean
  c: Pick<CaseRow, 'id' | 'case_number'>
  onClose: () => void
  /** After the request is accepted (the caller may refetch its list). */
  onRequested?: (packetId: string | null) => void
}) {
  const [type, setType] = useState<PacketType>('full')
  const [sections, setSections] = useState<Set<PacketSectionId>>(() => new Set(DEFAULT_PACKET_SECTIONS.full))
  const [watermark, setWatermark] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => {
      setType('full'); setSections(new Set(DEFAULT_PACKET_SECTIONS.full)); setWatermark(''); setNote(''); setBusy(false)
    })
  }, [open])

  const pickType = (t: PacketType) => {
    setType(t)
    // A preset fills the checklist; `custom` keeps whatever is ticked.
    if (t !== 'custom') setSections(new Set(DEFAULT_PACKET_SECTIONS[t]))
  }
  const toggle = (id: PacketSectionId) => {
    setSections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    // Editing the checklist of a preset makes it a custom packet.
    setType('custom')
  }
  const ordered = useMemo(() => normalizeSections([...sections]), [sections])
  const dirty = () => watermark.trim() !== '' || note.trim() !== '' || type !== 'full'

  const submit = async () => {
    if (busy || ordered.length === 0) return
    setBusy(true)
    try {
      const r = await pdfService.requestPacket(c.id, type, ordered, { watermark, note })
      if (!r.ok) { toast(r.message ?? 'The packet request was refused.', 'danger'); return }
      toast(
        'Packet generation started. You can keep working — it will appear in Documents → Case Packets and in your Action Center.',
        'success',
        { link: { label: 'Open Documents', href: caseLink(c.id, 'documents') } },
      )
      onRequested?.(typeof r.data?.id === 'string' ? r.data.id : null)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} wide dirty={dirty}>
      <form className="p-5" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <ModalHeader title="Generate Case Packet" onClose={onClose} />
        <p className="mb-4 text-sm text-slate-400">
          Rendered on the server for case <span className="font-mono text-slate-200" translate="no">{c.case_number}</span>, with a
          manifest and SHA-256 for every included file. The render runs in the background.
        </p>

        <fieldset className="mb-4">
          <legend className="mb-1 block text-xs font-semibold text-slate-400">Packet type</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {PACKET_TYPES.map((t) => (
              <label key={t.id} className={OPTION_ROW}>
                <input
                  type="radio"
                  name="packet_type"
                  value={t.id}
                  checked={type === t.id}
                  onChange={() => pickType(t.id)}
                  className={`mt-1 ${CHECK}`}
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{t.label}</span>
                  <span className="block text-xs text-slate-400">{t.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mb-4">
          <legend className="mb-1 block text-xs font-semibold text-slate-400">
            Sections <span className="font-normal tabular-nums">({ordered.length} of {PACKET_SECTIONS.length})</span>
          </legend>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {PACKET_SECTIONS.map((s) => (
              <label key={s.id} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-slate-200 hover:bg-white/5">
                <input type="checkbox" checked={sections.has(s.id)} onChange={() => toggle(s.id)} className={CHECK} />
                {s.label}
              </label>
            ))}
          </div>
          {ordered.length === 0 && <p className="mt-1 text-xs font-semibold text-rose-300">Pick at least one section.</p>}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Watermark text" hint="Printed diagonally on every page. Leave blank for none.">
            {(id) => (
              <Input id={id} name="watermark" value={watermark} onChange={(e) => setWatermark(e.target.value)} maxLength={80} autoComplete="off" spellCheck={false} placeholder="e.g. DISCLOSURE COPY — DO NOT DISTRIBUTE" />
            )}
          </Field>
          <Field label="Note" hint="Kept with the request (not printed).">
            {(id) => (
              <Textarea id={id} name="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoComplete="off" placeholder="e.g. For the ADA meeting on Friday…" />
            )}
          </Field>
        </div>

        <p className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-100">
          Restricted media without approval and sealed legal material are excluded automatically.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={ordered.length === 0}>
            {busy ? 'Requesting…' : 'Generate packet'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
