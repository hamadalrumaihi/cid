'use client'

/** Post/edit announcement modal — vanilla collab.js openAnnouncementModal().
 *  Posting is gated to command roles (client UX; RLS + RPCs enforce). NEW
 *  posts go through publish_announcement, which creates the row AND fans out
 *  at most one notification per active recipient server-side — after an
 *  in-modal "Publish and notify N?" confirmation. EDITS keep the direct
 *  update() path and never rebroadcast unless the author explicitly ticks
 *  "Notify recipients about this update" (announcement_notify_update).
 *  Audience choices mirror the server author rules: 'all' is Deputy
 *  Director+/owner only, a specific bureau is the author's own division
 *  unless Deputy Director+/owner, and 'specific_members' notifies exactly the
 *  mentioned users. Mounted fresh per open. */
import { useEffect, useMemo, useState } from 'react'
import type { Json } from '@/lib/database.types'
import { invokeFunction, remove, rpc, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { activeProfiles } from '@/lib/profiles'
import { ROLE_LABEL, ROLE_ORDER } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import {
  AUDIENCE_LABEL, mentionLabel, parseLinks, parseMentions,
  type AnnLink, type AnnouncementRow, type Mention,
} from './announceUtils'

interface CaseOption { id: string; case_number: string }

interface AnnouncementModalProps {
  record: AnnouncementRow | null
  /** Recent cases for the "Link case" picker (vanilla uses the first 30). */
  caseOptions: CaseOption[]
  onClose: () => void
  onSaved: () => void
}

/** How the audience is picked in the UI; 'mine'/'dept' both resolve to a
 *  bureau value, the rest map 1:1 onto announcements.audience. */
type AudMode = 'all' | 'command' | 'mine' | 'dept' | 'specific_members'
const BUREAU_VALUES = ['LSB', 'BCB', 'SAB', 'JTF'] as const

const SELECT_CLS = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500'

export function AnnouncementModal({ record, caseOptions, onClose, onSaved }: AnnouncementModalProps) {
  const { profile: me, isCommand, isOwner } = useAuth()
  const myDivision = me?.division ?? null
  // Author-rule mirror (UX only — RLS + the publish RPC enforce for real):
  // 'all' needs Deputy Director+ or owner; any bureau needs the same, except
  // a bureau lead may target their OWN division; command/members need any
  // announcement author (command tier).
  const canAll = isOwner || me?.role === 'deputy_director' || me?.role === 'director'
  const canAnyDept = canAll
  const canCommandTier = isCommand || isOwner

  const modeFor = (a: string): AudMode =>
    a === 'all' || a === 'command' || a === 'specific_members' ? a : a === myDivision ? 'mine' : 'dept'

  const [title, setTitle] = useState(record?.title || '')
  const [body, setBody] = useState(record?.body || '')
  const [mode, setMode] = useState<AudMode>(() =>
    record ? modeFor(record.audience) : canAll ? 'all' : myDivision ? 'mine' : 'command')
  const [dept, setDept] = useState<string>(() =>
    record && modeFor(record.audience) === 'dept' ? record.audience : 'LSB')
  const [pinned, setPinned] = useState(!!record?.pinned)
  const [mentions, setMentions] = useState<Mention[]>(() =>
    parseMentions(record?.mentions ?? null).map((m) => ({ target: m.target, label: m.label || mentionLabel(m.target) })))
  const [links, setLinks] = useState<AnnLink[]>(() => parseLinks(record?.links ?? null))
  const [notifyUpdate, setNotifyUpdate] = useState(false) // edits never rebroadcast by default
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const audience = mode === 'mine' ? (myDivision ?? 'command') : mode === 'dept' ? dept : mode

  const modeLabel = (m: AudMode): string =>
    m === 'all' ? 'Everyone'
      : m === 'command' ? 'Command'
        : m === 'mine' ? `My Department${myDivision ? ` (${AUDIENCE_LABEL[myDivision] ?? myDivision})` : ''}`
          : m === 'dept' ? 'Specific Department…'
            : 'Specific Members'

  const modes: AudMode[] = []
  if (canAll) modes.push('all')
  if (canCommandTier) modes.push('command')
  if (canCommandTier && myDivision) modes.push('mine')
  if (canAnyDept) modes.push('dept')
  if (canCommandTier) modes.push('specific_members')
  // Editing a post whose audience this editor couldn't author: keep it
  // selectable so opening the editor doesn't silently retarget the post.
  if (record && !modes.includes(modeFor(record.audience))) modes.unshift(modeFor(record.audience))

  // Body "@everyone" ⇒ auto-select the Everyone audience for authorized
  // broadcasters (on the transition only, so they can still pick another
  // audience afterwards); others get an inline warning instead.
  const hasEveryone = body.includes('@everyone')
  const onBodyChange = (next: string) => {
    if (next.includes('@everyone') && !hasEveryone && canAll) setMode('all')
    setBody(next)
  }

  // Recipient preview — debounced announcement_recipient_count. The result is
  // keyed by its inputs, so a stale (or failed) response simply never shows.
  const countKey = useMemo(() => JSON.stringify([audience, mentions]), [audience, mentions])
  const [countRes, setCountRes] = useState<{ key: string; n: number } | null>(null)
  useEffect(() => {
    const t = window.setTimeout(() => {
      void rpc('announcement_recipient_count', { p_audience: audience, p_mentions: mentions as unknown as Json })
        .then((r) => {
          if (!r.error && typeof r.data === 'number') setCountRes({ key: countKey, n: r.data })
        })
    }, 400)
    return () => window.clearTimeout(t)
  }, [countKey, audience, mentions])
  const count = countRes && countRes.key === countKey ? countRes.n : null

  const officers = activeProfiles()

  const addMention = (value: string) => {
    if (!value) return
    const [target, label] = value.split('|')
    setMentions((m) => (m.some((x) => x.target === target) ? m : [...m, { target, label }]))
  }
  const addLink = (value: string) => {
    if (!value) return
    const [id, label] = value.split('|')
    setLinks((l) => (l.some((x) => x.id === id) ? l : [...l, { type: 'case', id, label }]))
  }

  const validate = (): boolean => {
    if (!title.trim() || !body.trim()) { toast('Title and message are required.', 'warn'); return false }
    if (audience === 'specific_members' && !mentions.length) {
      toast('Mention at least one member — Specific Members notifies exactly who you mention.', 'warn')
      return false
    }
    return true
  }

  const save = async () => {
    if (!me || busy || !validate()) return
    if (record) { await saveEdit(); return }
    // NEW post: confirm-then-publish. Refresh the count if the debounce
    // hasn't landed yet so the prompt can show N.
    if (count === null) {
      const r = await rpc('announcement_recipient_count', { p_audience: audience, p_mentions: mentions as unknown as Json })
      if (!r.error && typeof r.data === 'number') setCountRes({ key: countKey, n: r.data })
    }
    setConfirming(true)
  }

  /** EDIT path — direct update(); notifies only on explicit opt-in. */
  const saveEdit = async () => {
    if (!me || !record) return
    setBusy(true)
    const res = await update('announcements', record.id, {
      title: title.trim(), body: body.trim(), audience, pinned,
      author_name: me.display_name,
      mentions: mentions as unknown as Json,
      links: links as unknown as Json,
    })
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    if (notifyUpdate) {
      const n = await rpc('announcement_notify_update', { p_announce: record.id })
      if (n.error) toast('Updated, but notifying recipients failed.', 'warn')
      else toast(`Announcement updated — ${n.data ?? 0} member(s) notified.`, 'success')
    } else {
      toast('Announcement updated', 'success')
    }
    onSaved()
  }

  /** NEW path — publish_announcement creates the row AND fans out one
   *  notification per active recipient server-side (no client notify loop). */
  const publish = async () => {
    if (busy) return
    setBusy(true)
    const res = await rpc('publish_announcement', {
      p_title: title.trim(), p_body: body.trim(), p_audience: audience,
      p_mentions: mentions as unknown as Json,
      p_links: links as unknown as Json,
      p_pinned: pinned,
    })
    setBusy(false)
    if (res.error) { toast(`Publish failed: ${res.error.message}`, 'danger'); return }
    const out = res.data as { announce_id?: string; recipients?: number } | null
    // Best-effort Discord broadcast — fire-and-forget, never blocks or fails
    // the publish (the edge function may not be deployed).
    if (out?.announce_id) void invokeFunction('discord-announce', { announce_id: out.announce_id })
    toast(`Published — ${out?.recipients ?? 0} member(s) notified.`, 'success')
    onSaved()
  }

  const del = async () => {
    if (!record) return
    if (!(await uiConfirm('Delete this announcement?', { confirmText: 'Delete' }))) return
    const r = await remove('announcements', record.id)
    if (r.error) { toast(`Delete failed: ${r.error.message}`, 'danger'); return }
    toast('Deleted', 'warn')
    onSaved()
  }

  const dirty = () => title.trim() !== (record?.title || '') || body.trim() !== (record?.body || '')

  const confirmMsg = audience === 'all'
    ? (count === null ? 'Publish and notify everyone?' : `Publish and notify everyone (${count} member${count === 1 ? '' : 's'})?`)
    : (count === null ? 'Publish and notify recipients?' : `Publish and notify ${count} member${count === 1 ? '' : 's'}?`)

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title={`${record ? 'Edit' : 'New'} Announcement`} onClose={onClose} />
        {confirming ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-200">{confirmMsg}</p>
            <p className="text-xs text-slate-400">Each active recipient gets one notification. Later edits won’t re-notify unless you choose to.</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(false)} disabled={busy} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50">
                Cancel
              </button>
              <button onClick={() => void publish()} disabled={busy} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-50">
                Publish
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <label htmlFor="ann-title" className="mb-1 block text-xs font-semibold text-slate-400">Title *</label>
                <input id="ann-title" value={title} onChange={(e) => setTitle(e.target.value)} className={SELECT_CLS} />
              </div>
              <div>
                <label htmlFor="ann-body" className="mb-1 block text-xs font-semibold text-slate-400">Message *</label>
                <textarea id="ann-body" rows={5} value={body} onChange={(e) => onBodyChange(e.target.value)} className={SELECT_CLS} />
                {hasEveryone && !canAll && (
                  <p className="mt-1 text-[11px] text-amber-300">Only Deputy Director+ can notify everyone</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor="ann-audience" className="block text-xs font-semibold text-slate-400">Audience</label>
                    {audience === 'all' && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300">@everyone</span>
                    )}
                  </div>
                  <select id="ann-audience" value={mode} onChange={(e) => setMode(e.target.value as AudMode)} className={SELECT_CLS}>
                    {modes.map((m) => <option key={m} value={m}>{modeLabel(m)}</option>)}
                  </select>
                  {mode === 'dept' && (
                    <>
                      <label htmlFor="ann-dept" className="sr-only">Department</label>
                      <select id="ann-dept" value={dept} onChange={(e) => setDept(e.target.value)} className={`${SELECT_CLS} mt-2`}>
                        {BUREAU_VALUES.map((b) => <option key={b} value={b}>{AUDIENCE_LABEL[b] ?? b}</option>)}
                      </select>
                    </>
                  )}
                </div>
                <label className="mt-6 flex items-center gap-2 self-start text-sm text-slate-200">
                  <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-amber-500" /> Pin to top
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ann-mention" className="mb-1 block text-xs font-semibold text-slate-400">Mention</label>
                  <select id="ann-mention" value="" onChange={(e) => addMention(e.target.value)} className={SELECT_CLS}>
                    <option value="">＠ add…</option>
                    <option value="all|All Officers">@All Officers</option>
                    {ROLE_ORDER.map((r) => (
                      <option key={r} value={`role:${r}|All ${ROLE_LABEL[r] || r}s`}>@All {ROLE_LABEL[r] || r}s</option>
                    ))}
                    {officers.map((p) => (
                      <option key={p.id} value={`${p.id}|${p.display_name}`}>@{p.display_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ann-link" className="mb-1 block text-xs font-semibold text-slate-400">Link case</label>
                  <select id="ann-link" value="" onChange={(e) => addLink(e.target.value)} className={SELECT_CLS}>
                    <option value="">🔗 add…</option>
                    {caseOptions.map((c) => <option key={c.id} value={`${c.id}|${c.case_number}`}>{c.case_number}</option>)}
                  </select>
                </div>
              </div>
              {(mentions.length > 0 || links.length > 0) && (
                <div className="flex flex-wrap gap-1">
                  {mentions.map((m) => (
                    <span key={m.target} className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-300">@{m.label || mentionLabel(m.target)}</span>
                  ))}
                  {links.map((l) => (
                    <span key={l.id} className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] text-violet-300">🔗 {l.label || l.id}</span>
                  ))}
                </div>
              )}
              {record && (
                <label className="flex items-center gap-2 text-sm text-slate-200">
                  <input type="checkbox" checked={notifyUpdate} onChange={(e) => setNotifyUpdate(e.target.checked)} className="accent-amber-500" />
                  Notify recipients about this update
                </label>
              )}
              {count !== null && (!record || notifyUpdate) && (
                <p className="text-xs text-slate-400">This announcement will notify {count} active member{count === 1 ? '' : 's'}.</p>
              )}
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={() => void save()} disabled={busy} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110 disabled:opacity-50">
                {record ? 'Save' : 'Post'}
              </button>
              {record && (
                <button onClick={() => void del()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">
                  Delete
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
