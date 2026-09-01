'use client'

/** §15 — what SIB has told CID.
 *
 *  A release carries a SNAPSHOT of one item, never a pointer into the
 *  investigation, so releasing something can never widen into access. This
 *  screen is the SIB side of that: what was released, to whom, whether it was
 *  acknowledged, and the ability to pull it back.
 *
 *  Everything rendered here is RLS-scoped to investigations the viewer can
 *  read, and every write goes through `siu_share` / `siu_revoke_disclosure`,
 *  which re-check field standing server-side. Oversight standing can read this
 *  list and gets no release controls — deciding what SIB tells CID is not an
 *  oversight power. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list, rpc, withRetry } from '@/lib/db'
import { useSiu } from '@/lib/useSiu'
import {
  SIU_AUDIENCES, SIU_AUDIENCE_LABEL, SIU_AUDIENCE_SHORT, SIU_HANDLING,
  SIU_RELEASE_ITEM_TYPES, fetchSiuDisclosures, siuAudienceLabel,
  siuHandlingLabel, siuReleaseItemLabel, type SiuDisclosure,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { SectionHeader } from '@/components/ui/PageHeader'
import { ListSkeleton } from '@/components/ui/Skeleton'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { uiPrompt } from '@/components/ui/dialog'

const fmtWhen = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

const audienceTint = (a: string) =>
  a === 'cid' ? 'bg-blue-500/15 text-blue-300'
  : a === 'case_members' ? 'bg-emerald-500/15 text-emerald-300'
  : 'bg-amber-500/15 text-amber-300'

export function SiuDisclosuresSection() {
  const siu = useSiu()
  const [rows, setRows] = useState<SiuDisclosure[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  const [showRevoked, setShowRevoked] = useState(false)

  const load = useCallback(async () => {
    try { setRows(await withRetry(() => fetchSiuDisclosures())) }
    catch (e) { toast(e instanceof Error ? e.message : String(e), 'danger') }
    finally { setLoading(false) }
  }, [])

  // State writes happen after an await — see ReleasedIntelligence.
  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  const shown = useMemo(
    () => rows.filter((r) => showRevoked || !r.revoked_at),
    [rows, showRevoked],
  )

  const revoke = async (row: SiuDisclosure) => {
    const reason = await uiPrompt(
      'CID loses sight of it immediately. The row is kept — a revoked release stays part of the record of what CID was told, and when it stopped being told.',
      { title: 'Revoke this release', placeholder: 'Reason', confirmText: 'Revoke' },
    )
    if (!reason?.trim()) return
    const res = await rpc('siu_revoke_disclosure', { p_id: row.id, p_reason: reason.trim() })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Release revoked.', 'success')
    void load()
  }

  if (loading) return <ListSkeleton />

  return (
    <Card>
      <SectionHeader
        title="Released to CID"
        subtitle="Single items handed to the Division without surrendering the investigation. Each release is a snapshot of what was shared — it grants no access to anything."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setShowRevoked((v) => !v)}>
              {showRevoked ? 'Hide revoked' : 'Show revoked'}
            </Button>
            {siu.isAgent && (
              <Button size="sm" variant="primary" onClick={() => setComposing(true)}>Release an item</Button>
            )}
          </div>
        }
      />

      {!shown.length ? (
        <p className="mt-3 text-xs text-slate-400">
          {rows.length ? 'Every release here has been revoked.' : 'Nothing has been released to CID.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((r) => (
            <li key={r.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tint={audienceTint(r.audience)}>{SIU_AUDIENCE_SHORT[r.audience] ?? r.audience}</Badge>
                <Badge tone="neutral">{siuReleaseItemLabel(r.item_type)}</Badge>
                <span className="text-sm font-semibold text-slate-100">{r.title}</span>
                {r.revoked_at && <Badge tint="bg-rose-500/15 text-rose-300">Revoked</Badge>}
                {r.acknowledged_at && !r.revoked_at && (
                  <Badge tint="bg-emerald-500/15 text-emerald-300">Acknowledged</Badge>
                )}
                <span className="ml-auto text-[11px] text-slate-500">{fmtWhen(r.released_at)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-xs text-slate-300">{r.body}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                <span>{siuHandlingLabel(r.handling)}</span>
                <span>Reason: {r.reason}</span>
                {r.revoke_reason && <span>Revoked: {r.revoke_reason}</span>}
                {!r.revoked_at && siu.isAgent && (
                  <button
                    type="button"
                    className="ml-auto text-rose-300 underline-offset-2 hover:underline"
                    onClick={() => void revoke(r)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {composing && (
        <ReleaseModal onClose={() => setComposing(false)} onDone={() => { setComposing(false); void load() }} />
      )}
    </Card>
  )
}

/* ------------------------------------------------------------ release form */

function ReleaseModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [cases, setCases] = useState<Tables<'cases'>[]>([])
  const [siuCase, setSiuCase] = useState('')
  const [audience, setAudience] = useState<string>('case_members')
  const [itemType, setItemType] = useState<string>('intelligence')
  const [handling, setHandling] = useState<string>('law_enforcement_sensitive')
  const [targetCase, setTargetCase] = useState('')
  const [targetUser, setTargetUser] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void withRetry(() => list('cases', { order: 'created_at', ascending: false, limit: 300 }))
      .then((r) => { if (live) setCases(r) })
      .catch(() => { /* an empty picker is the honest fallback */ })
    return () => { live = false }
  }, [])

  const siuCases = useMemo(() => cases.filter((c) => c.case_authority === 'siu'), [cases])
  const cidCases = useMemo(() => cases.filter((c) => c.case_authority !== 'siu'), [cases])

  const save = async () => {
    if (!siuCase) { toast('Choose the investigation this comes from.', 'warn'); return }
    if (!title.trim() || !body.trim()) { toast('A release needs a title and content.', 'warn'); return }
    if (!reason.trim()) { toast('Record why this is being released.', 'warn'); return }
    if (audience === 'case_members' && !targetCase) { toast('Choose the CID case to file it against.', 'warn'); return }
    if (audience === 'investigator' && !targetUser.trim()) { toast('Name the investigator.', 'warn'); return }

    setBusy(true)
    const res = await rpc('siu_share', {
      p_case: siuCase,
      p_item_type: itemType,
      p_title: title.trim(),
      p_body: body.trim(),
      p_audience: audience,
      p_reason: reason.trim(),
      ...(targetCase ? { p_target_case: targetCase } : {}),
      ...(audience === 'investigator' ? { p_target_user: targetUser.trim() } : {}),
      p_handling: handling,
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Released to CID.', 'success')
    onDone()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!title || !!body || !!reason}>
      <ModalHeader title="Release an item to CID" onClose={onClose} />
      <div className="space-y-3">
        <Field label="From investigation" required>
          {(id) => (
            <Select id={id} value={siuCase} onChange={(e) => setSiuCase(e.target.value)}>
              <option value="">Select…</option>
              {siuCases.map((c) => (
                <option key={c.id} value={c.id}>{c.case_number} — {c.title ?? 'Untitled'}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Release to" required>
          {(id) => (
            <Select id={id} value={audience} onChange={(e) => setAudience(e.target.value)}>
              {SIU_AUDIENCES.map((a) => (
                <option key={a} value={a}>{SIU_AUDIENCE_LABEL[a]}</option>
              ))}
            </Select>
          )}
        </Field>
        {audience !== 'investigator' ? (
          <Field label={audience === 'case_members' ? 'CID case' : 'File against a CID case (optional)'} required={audience === 'case_members'}>
            {(id) => (
              <Select id={id} value={targetCase} onChange={(e) => setTargetCase(e.target.value)}>
                <option value="">{audience === 'case_members' ? 'Select…' : 'Not filed against a case'}</option>
                {cidCases.map((c) => (
                  <option key={c.id} value={c.id}>{c.case_number} — {c.title ?? 'Untitled'}</option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <Field label="Investigator" required hint="The member's account id. Only they will see this release.">
            {(id) => <Input id={id} value={targetUser} onChange={(e) => setTargetUser(e.target.value)} placeholder="Account id" />}
          </Field>
        )}
        <Field label="Item type">
          {(id) => (
            <Select id={id} value={itemType} onChange={(e) => setItemType(e.target.value)}>
              {SIU_RELEASE_ITEM_TYPES.map((t) => (
                <option key={t} value={t}>{siuReleaseItemLabel(t)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Handling">
          {(id) => (
            <Select id={id} value={handling} onChange={(e) => setHandling(e.target.value)}>
              {SIU_HANDLING.map((h) => (
                <option key={h} value={h}>{siuHandlingLabel(h)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Title" required>
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Vehicle linked to your suspect" />}
        </Field>
        <Field label="What is being released" required hint="This exact text is what CID sees. It is a copy, not a link — write it to stand on its own.">
          {(id) => <Textarea id={id} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />}
        </Field>
        <Field label="Reason" required>
          {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why CID needs this" />}
        </Field>
        <p className="text-[11px] text-slate-400">
          {siuAudienceLabel(audience)}. The investigation itself is never disclosed — CID sees the text
          above and that SIB released it, with no case number, no link and no way to reach the file.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Releasing…' : 'Release'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
