'use client'

/** Post/edit announcement modal — vanilla collab.js openAnnouncementModal().
 *  Posting is gated to LEAD_ROLES (client UX; RLS enforces). On FIRST post
 *  only, fans out 'announcement' notifications to the audience via the
 *  forgery-guarded create_notification RPC (+ best-effort Discord DM);
 *  mentioned officers get a "You were mentioned" reason and are added even
 *  outside the audience. Mounted fresh per open. */
import { useState } from 'react'
import type { Json } from '@/lib/database.types'
import { insert, remove, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/notify'
import { activeProfiles } from '@/lib/profiles'
import { ROLE_LABEL, ROLE_ORDER } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import {
  AUDIENCE_OPTIONS, mentionLabel, parseLinks, parseMentions,
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

/** Everyone the post reaches: audience-scoped active roster (minus the
 *  author) plus every mention expansion — mentioned ids tracked separately
 *  so their notification reason reads "You were mentioned". */
function announceRecipients(audience: string, mentions: Mention[], meId: string) {
  const all = activeProfiles().filter((p) => p.id !== meId)
  const ids = new Set((audience === 'all' ? all : all.filter((p) => p.division === audience)).map((p) => p.id))
  const mentioned = new Set<string>()
  for (const m of mentions) {
    const t = m.target
    if (t === 'all') all.forEach((p) => { ids.add(p.id); mentioned.add(p.id) })
    else if (t.startsWith('role:')) all.filter((p) => p.role === t.slice(5)).forEach((p) => { ids.add(p.id); mentioned.add(p.id) })
    else if (t && t !== meId) { ids.add(t); mentioned.add(t) }
  }
  return { ids: [...ids], mentioned }
}

export function AnnouncementModal({ record, caseOptions, onClose, onSaved }: AnnouncementModalProps) {
  const { profile: me } = useAuth()
  const [title, setTitle] = useState(record?.title || '')
  const [body, setBody] = useState(record?.body || '')
  const [audience, setAudience] = useState(record?.audience || 'all')
  const [pinned, setPinned] = useState(!!record?.pinned)
  const [mentions, setMentions] = useState<Mention[]>(() =>
    parseMentions(record?.mentions ?? null).map((m) => ({ target: m.target, label: m.label || mentionLabel(m.target) })))
  const [links, setLinks] = useState<AnnLink[]>(() => parseLinks(record?.links ?? null))

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

  const save = async () => {
    if (!me) return
    const t = title.trim(), b = body.trim()
    if (!t || !b) { toast('Title and message are required.', 'warn'); return }
    const payload = {
      title: t, body: b, audience, pinned,
      author_name: me.display_name,
      mentions: mentions as unknown as Json,
      links: links as unknown as Json,
    }
    const res = record ? await update('announcements', record.id, payload) : await insert('announcements', payload)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    if (!record) { // notify on first post only (edits never re-fan-out)
      const rec = announceRecipients(audience, mentions, me.id)
      const annId = res.data?.[0]?.id ?? null
      for (const uid of rec.ids) {
        await notify(uid, 'announcement', {
          announce_id: annId,
          title: t,
          reason: `${rec.mentioned.has(uid) ? 'You were mentioned: ' : 'New announcement: '}${t}`,
        })
      }
    }
    toast(record ? 'Announcement updated' : 'Announcement posted', 'success')
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

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title={`${record ? 'Edit' : 'New'} Announcement`} onClose={onClose} />
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-400">Message *</label>
            <textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Audience</label>
              <select value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">
                {AUDIENCE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm text-slate-200">
              <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="accent-amber-500" /> Pin to top
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-400">Mention</label>
              <select value="" onChange={(e) => addMention(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">
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
              <label className="mb-1 block text-xs font-semibold text-slate-400">Link case</label>
              <select value="" onChange={(e) => addLink(e.target.value)} className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">
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
        </div>
        <div className="mt-5 flex gap-2">
          <button onClick={() => void save()} className="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
            {record ? 'Save' : 'Post'}
          </button>
          {record && (
            <button onClick={() => void del()} className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">
              Delete
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
