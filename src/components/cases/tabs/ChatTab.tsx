'use client'

import { useCallback, useEffect, useState } from 'react'
import { insert, list, deleteWithUndo } from '@/lib/db'
import { Button } from '@/components/ui/Button'
import { timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { Drafts } from '@/lib/drafts'
import { notify } from '@/lib/notify'
import { officerName, activeProfiles } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { parseStringArray } from '@/lib/jsonShapes'
import { toast } from '@/lib/toast'
import { type CaseRow, type MessageRow } from './shared'

/** Highlight @Name tokens inside an (auto-escaped) message body — the React
 *  version of vanilla collab.js:111's regex-to-span pass. */
function chatBody(text: string): React.ReactNode {
  return text.split(/(@[\w.\-]+(?:\s[\w.\-]+)?)/g).map((part, i) =>
    part.startsWith('@') ? <span key={i} className="text-blue-300">{part}</span> : part)
}

export function ChatTab({ c }: { c: CaseRow }) {
  const { profile, isCommand } = useAuth()
  const [msgs, setMsgs] = useState<MessageRow[]>([])
  const [body, setBody] = useState('')
  // ＠ Mention flow — port of vanilla collab.js:216-225: picking an officer
  // queues them, appends @Name to the text, and on send stores the id list
  // on the row + fires a chat_mention notification per mentioned officer.
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([])
  const v = useTableVersion('case_messages')
  const refresh = useCallback(async () => { try { setMsgs(await list('case_messages', { eq: { case_id: c.id }, order: 'created_at' })) } catch { /* stale */ } }, [c.id])
  useEffect(() => { queueMicrotask(() => { void refresh() }) }, [refresh, v])
  // Never-lose-work: restore a half-typed message for THIS case on mount;
  // keep the stash current while typing; clear it on successful send.
  useEffect(() => {
    const t = window.setTimeout(() => {
      const d = Drafts.load<string>(`chat:${c.id}`)
      if (d?.data) setBody((prev) => prev || d.data)
    }, 0)
    return () => window.clearTimeout(t)
  }, [c.id])
  const [sending, setSending] = useState(false)
  const addMention = (val: string) => {
    if (!val) return
    const p = activeProfiles().find((x) => x.id === val)
    if (!p || mentions.some((m) => m.id === p.id)) return
    setMentions((prev) => [...prev, { id: p.id, name: p.display_name || 'Officer' }])
    setBody((prev) => (prev + ' @' + (p.display_name || 'Officer') + ' ').trimStart())
  }
  const send = async () => {
    if (!body.trim() || sending) return
    setSending(true)
    const res = await insert('case_messages', { case_id: c.id, body: body.trim(), author_id: profile?.id ?? null, author_name: profile?.display_name ?? null, mentions: mentions.map((m) => m.id) })
    setSending(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    for (const m of mentions) {
      if (m.id !== profile?.id) void notify(m.id, 'chat_mention', { case_id: c.id, case_number: c.case_number, detective: profile?.display_name ?? 'Officer', reason: `${profile?.display_name ?? 'An officer'} mentioned you in the ${c.case_number} channel.` })
    }
    setBody(''); setMentions([]); Drafts.clear(`chat:${c.id}`); void refresh()
  }
  const rowMentions = (m: MessageRow): string[] => parseStringArray(m.mentions)
  return (
    <div className="space-y-3">
      <div className="max-h-[48vh] space-y-3 overflow-y-auto rounded-xl border border-white/10 bg-ink-950/50 p-3">
        {msgs.map((m) => <div key={m.id} className={`rounded-xl p-3 ${m.author_id === profile?.id ? 'ml-auto max-w-[85%] bg-badge-600/20' : 'max-w-[85%] bg-white/5'}`}><p className="text-xs font-bold text-slate-400">{m.author_name || officerName(m.author_id) || 'Officer'} - {timeAgo(m.created_at)}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-100">{chatBody(m.body)}</p>{rowMentions(m).length > 0 && <span className="mt-1 flex flex-wrap gap-1">{rowMentions(m).map((id) => <span key={id} className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-300">@{officerName(id) || 'Officer'}</span>)}</span>}{(m.author_id === profile?.id || isCommand) && <button aria-label="Delete this message" onClick={() => void deleteWithUndo('case_messages', m, { confirmTitle: 'Delete message', confirmMessage: 'Delete this message from the case room? You can undo this for a few seconds.', confirmText: 'Delete message', label: 'message', after: refresh })} className="mt-2 text-xs font-bold text-rose-300 hover:text-rose-200">Delete</button>}</div>)}
        {!msgs.length && <p className="py-8 text-center text-sm text-slate-500">No messages yet.</p>}
      </div>
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {mentions.map((m) => (
            <span key={m.id} className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-300">
              @{m.name}
              <button onClick={() => setMentions((prev) => prev.filter((x) => x.id !== m.id))} aria-label={`Remove mention of ${m.name}`} title="Remove mention" className="text-blue-300/60 hover:text-rose-300">✕</button>
            </span>
          ))}
        </div>
      )}
      <textarea value={body} onChange={(e) => { setBody(e.target.value); if (e.target.value.trim()) Drafts.save(`chat:${c.id}`, e.target.value); else Drafts.clear(`chat:${c.id}`) }} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }} rows={3} className="w-full rounded-xl border border-white/10 bg-ink-950 p-3 text-sm text-white" placeholder="Message the case room..." />
      <div className="flex items-center justify-between gap-2">
        <select value="" onChange={(e) => addMention(e.target.value)} aria-label="Mention an officer" className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-badge-500">
          <option value="">＠ Mention…</option>
          {activeProfiles().map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
        <Button variant="primary" onClick={() => void send()} disabled={sending}>Send</Button>
      </div>
    </div>
  )
}
