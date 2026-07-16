'use client'

/** Feedback — port of vanilla feedback.js. Any signed-in member submits and
 *  sees/withdraws their own; the app owner triages everything (open/done/
 *  won't-fix). The feedback table's RLS enforces the same split server-side —
 *  the owner check here is UI-matching only. */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { insert, list, remove, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { officerName } from '@/lib/profiles'
import { toast } from '@/lib/toast'
import { fmtDateTime } from '@/lib/format'
import { uiConfirm } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice, EmptyState } from '@/components/ui/Notice'

type FeedbackRow = Tables<'feedback'>

const FB_KIND: Record<string, { icon: string; label: string; tint: string }> = {
  feature: { icon: '💡', label: 'Feature', tint: 'bg-blue-500/15 text-blue-300' },
  bug: { icon: '🐞', label: 'Bug', tint: 'bg-rose-500/15 text-rose-300' },
  document: { icon: '📄', label: 'Document', tint: 'bg-amber-500/15 text-amber-300' },
}
const FB_STATUS: Record<string, { label: string; tint: string }> = {
  open: { label: 'Open', tint: 'bg-amber-500/15 text-amber-300' },
  done: { label: 'Done', tint: 'bg-emerald-500/15 text-emerald-300' },
  wontfix: { label: "Won't fix", tint: 'bg-slate-500/20 text-slate-300' },
}

const inputCls = 'rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500'

export function FeedbackView() {
  const { state, profile, canEdit } = useAuth()
  const [items, setItems] = useState<FeedbackRow[]>([])
  const [kind, setKind] = useState('feature')
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)

  const owner = useAuth().isOwner

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    try { setItems(await list('feedback', { order: 'created_at', ascending: false })) }
    catch { toast('Couldn’t load feedback — check your connection.', 'danger') }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh])

  const submit = async () => {
    const t = title.trim()
    if (!t) { toast('Give it a short title first.', 'warn'); return }
    setBusy(true)
    const res = await insert('feedback', { kind, title: t, details: details.trim() || null })
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    setTitle(''); setDetails('')
    toast(owner ? 'Added to your feedback list' : 'Thanks — your feedback was submitted', 'success')
    void refresh()
  }

  const setStatus = async (f: FeedbackRow, to: string) => {
    const res = await update('feedback', f.id, { status: to, updated_at: new Date().toISOString() })
    if (res.error) { toast(`Update failed: ${res.error.message}`, 'danger'); return }
    void refresh()
  }

  const del = async (f: FeedbackRow) => {
    if (!(await uiConfirm(owner ? 'Delete this item?' : 'Withdraw this submission?', { confirmText: owner ? 'Delete' : 'Withdraw' }))) return
    const res = await remove('feedback', f.id)
    if (res.error) { toast(`Failed: ${res.error.message}`, 'danger'); return }
    toast(owner ? 'Deleted' : 'Withdrawn', 'info')
    void refresh()
  }

  if (state !== 'in') return <Notice text="Sign in to submit feedback." />

  const card = (f: FeedbackRow) => {
    const k = FB_KIND[f.kind] ?? FB_KIND.feature
    const s = FB_STATUS[f.status] ?? FB_STATUS.open
    const who = profile && f.created_by === profile.id ? 'You' : officerName(f.created_by) ?? 'Member'
    const when = fmtDateTime(f.created_at)
    return (
      <div key={f.id} className="rounded-xl border border-white/10 bg-ink-900 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">{k.icon} {f.title}</p>
            {f.details && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-400">{f.details}</p>}
            <p className="mt-1.5 text-[11px] text-slate-400">{owner ? `${who} · ${when}` : when}</p>
          </div>
          <span className="flex flex-shrink-0 items-center gap-1.5">
            <Badge tint={k.tint} className="uppercase">{k.label}</Badge>
            <Badge tint={s.tint} className="uppercase">{s.label}</Badge>
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {owner && (f.status !== 'done' ? (
            <button onClick={() => void setStatus(f, 'done')} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-white/10">✓ Done</button>
          ) : (
            <button onClick={() => void setStatus(f, 'open')} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition hover:bg-white/10">↩ Reopen</button>
          ))}
          {owner && f.status !== 'wontfix' && (
            <button onClick={() => void setStatus(f, 'wontfix')} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10">Won&apos;t fix</button>
          )}
          <button onClick={() => void del(f)} className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/10">
            {owner ? 'Delete' : 'Withdraw'}
          </button>
        </div>
      </div>
    )
  }

  const open = items.filter((f) => f.status === 'open')
  const closed = items.filter((f) => f.status !== 'open')

  return (
    <div>
      <Card pad="lg" className="mb-6">
        <p className="mb-4 text-sm text-slate-400">
          {owner
            ? 'Triage box — every member’s feature requests and bug reports land here. Mark them done, won’t-fix, or reopen.'
            : 'Suggest a feature or report a bug. Your note goes straight to the CID dev team — you’ll see your own submissions and their status below.'}
        </p>
        {canEdit && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Feedback kind" className={inputCls}>
                <option value="feature">💡 Feature idea</option>
                <option value="bug">🐞 Bug report</option>
              </select>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
                placeholder="Short title…"
                className={`min-w-[14rem] flex-1 ${inputCls}`}
              />
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              rows={3}
              placeholder="Details (optional) — steps to reproduce, context, what you'd want…"
              className={`mt-3 w-full ${inputCls}`}
            />
            <Button variant="primary" className="mt-3" disabled={busy} onClick={() => void submit()}>
              Submit
            </Button>
          </>
        )}
      </Card>
      {!items.length ? (
        <EmptyState
          icon="💡"
          title={owner ? 'No submissions yet' : 'Nothing submitted yet'}
          hint={owner ? 'Members’ feature requests and bug reports will land here.' : 'Add a feature idea or a bug above.'}
        />
      ) : owner ? (
        <>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Open ({open.length})</p>
          <div className="space-y-3">{open.length ? open.map(card) : <EmptyState title="No open items — nice." />}</div>
          {closed.length > 0 && (
            <>
              <p className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-slate-400">Closed ({closed.length})</p>
              <div className="space-y-3">{closed.map(card)}</div>
            </>
          )}
        </>
      ) : (
        <>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Your submissions ({items.length})</p>
          <div className="space-y-3">{items.map(card)}</div>
        </>
      )}
    </div>
  )
}
