'use client'

/** Comments thread on a legal request (P4-05, decision L7). Threaded by
 *  parent_id, visible to whoever RLS lets read `legal_request_comments`
 *  (creator, active participants, the approver pool, AG oversight, Owner).
 *  Every write is an RPC: legal_comment / legal_comment_edit /
 *  legal_comment_delete — the rows themselves are immutable to clients, and
 *  a deleted comment keeps its row (body blanked, deleted_at set) so the
 *  thread never silently loses a reply's context. Prior bodies live in
 *  legal_request_comment_versions and open from the "edited" marker.
 *
 *  The composer is gated by the server-first permission answer
 *  (`can_record('comment','legal',id)`); while the catalog row is missing
 *  or the answer is a transport failure, the contract's own audience mirror
 *  decides, and a wrong guess just surfaces the RPC's refusal toast — a
 *  hidden control is never the security boundary. Realtime: the row-scoped
 *  channel (`legal_request_id=eq.<id>`) refetches this request only. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { list, rpc } from '@/lib/db'
import type { Tables } from '@/lib/database.types'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { canRecord } from '@/lib/permissions'
import { useRowScopedVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiConfirm } from '@/components/ui/dialog'
import { Field, Textarea } from '@/components/ui/Field'
import { readJsonRpc } from './rpcJson'

type CommentRow = Tables<'legal_request_comments'>
type VersionRow = Tables<'legal_request_comment_versions'>
type NameFn = (id: string | null | undefined) => string

interface Node { row: CommentRow; children: Node[] }

function buildTree(rows: CommentRow[]): Node[] {
  const byId = new Map<string, Node>()
  for (const row of rows) byId.set(row.id, { row, children: [] })
  const roots: Node[] = []
  for (const node of byId.values()) {
    const parent = node.row.parent_id ? byId.get(node.row.parent_id) : null
    if (parent) parent.children.push(node)
    else roots.push(node) // orphaned reply (parent outside RLS) renders top-level
  }
  return roots
}

/** Prior bodies of one comment — fetched when the marker is opened. */
function EditHistory({ commentId }: { commentId: string }) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open || versions) return
    let cancelled = false
    void list('legal_request_comment_versions', { eq: { comment_id: commentId }, order: 'edited_at' })
      .then((rows) => { if (!cancelled) setVersions(rows) })
      .catch(() => { if (!cancelled) setVersions([]) })
    return () => { cancelled = true }
  }, [open, versions, commentId])
  return (
    <details className="inline-block" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer rounded text-[11px] font-semibold text-slate-400 hover:text-white">(edited)</summary>
      <div role="region" aria-label="Edit history" className="mt-1 max-w-md space-y-1.5 rounded-lg border border-white/10 bg-ink-950/80 p-2">
        {versions === null && <p className="text-xs text-slate-400">Loading history…</p>}
        {versions?.length === 0 && <p className="text-xs text-slate-400">No prior versions are visible.</p>}
        {versions?.map((v) => (
          <div key={v.id} className="text-xs">
            <p className="text-slate-400">Until {fmtDateTime(v.edited_at)}</p>
            <p className="whitespace-pre-wrap text-slate-200">{v.body}</p>
          </div>
        ))}
      </div>
    </details>
  )
}

function Composer({ label, initial = '', busy, onSubmit, onCancel, submitLabel = 'Post comment' }: {
  label: string
  initial?: string
  busy: boolean
  onSubmit: (body: string) => void
  onCancel?: () => void
  submitLabel?: string
}) {
  const [body, setBody] = useState(initial)
  return (
    <div className="space-y-2">
      <Field label={label}>
        {(id) => <Textarea id={id} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" size="sm" disabled={busy || !body.trim()} onClick={() => onSubmit(body.trim())}>{submitLabel}</Button>
        {onCancel && <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  )
}

export function CommentsThread({ requestId, me, name, mirrorMayComment, mayDeleteAny }: {
  requestId: string
  me: string | null
  name: NameFn
  /** The contract's audience mirror (creator / active participant / assigned
   *  judge / approver pool / AG / Owner) — used when the server-first answer
   *  is unavailable. */
  mirrorMayComment: boolean
  /** AG or Owner may delete anyone's comment (legal_comment_delete). */
  mayDeleteAny: boolean
}) {
  const [rows, setRows] = useState<CommentRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [serverMay, setServerMay] = useState<boolean | null>(null)
  const v = useRowScopedVersion('legal_request_comments', 'legal_request_id', requestId)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    let cancelled = false
    void list('legal_request_comments', { eq: { legal_request_id: requestId }, order: 'created_at' })
      .then((r) => { if (!cancelled) setRows(r) })
      .catch(() => { if (!cancelled) setRows([]) })
    return () => { cancelled = true }
  }, [requestId, v, tick])

  // Server-first per-record answer; a false here means the catalog refused
  // (or is not yet published) — the mirror then decides, and the RPC has the
  // last word either way.
  useEffect(() => {
    if (!me) return // signed out: canCompose already reads false below
    let cancelled = false
    void canRecord('comment', 'legal', requestId).then((ok) => { if (!cancelled) setServerMay(ok) })
    return () => { cancelled = true }
  }, [requestId, me])
  const canCompose = !!me && (serverMay === true || mirrorMayComment)

  const run = async (fn: () => ReturnType<typeof rpc>, okMsg: string): Promise<boolean> => {
    setBusy(true)
    const res = readJsonRpc(await fn() as Parameters<typeof readJsonRpc>[0])
    setBusy(false)
    if (!res.ok) { toast(res.message ?? 'Refused.', 'danger'); return false }
    toast(okMsg, 'success')
    reload()
    return true
  }

  const post = async (body: string, parent: string | null) => {
    const ok = await run(() => rpc('legal_comment', { p_request: requestId, p_body: body, ...(parent ? { p_parent: parent } : {}) }), 'Comment posted.')
    if (ok) setReplyTo(null)
  }
  const edit = async (id: string, body: string) => {
    const ok = await run(() => rpc('legal_comment_edit', { p_comment: id, p_body: body }), 'Comment updated.')
    if (ok) setEditing(null)
  }
  const del = async (id: string) => {
    const ok = await uiConfirm('Delete this comment? The row stays as "Comment deleted" and the prior text is kept in the edit ledger.', { title: 'Delete comment', confirmText: 'Delete' })
    if (!ok) return
    await run(() => rpc('legal_comment_delete', { p_comment: id }), 'Comment deleted.')
  }

  const tree = useMemo(() => buildTree(rows ?? []), [rows])

  const renderNode = (node: Node, depth: number) => {
    const c = node.row
    const deleted = !!c.deleted_at
    const mine = !!me && c.author_id === me
    return (
      <li key={c.id} className={depth > 0 ? 'ml-4 border-l border-white/10 pl-3 sm:ml-6' : ''}>
        <article aria-label={`Comment by ${name(c.author_id)}`} className="py-2">
          <div className="flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="font-semibold text-white">{name(c.author_id)}</span>
            <time dateTime={c.created_at} title={fmtDateTime(c.created_at)} className="text-slate-400">{timeAgo(c.created_at)}</time>
            {!deleted && c.edited_at && <EditHistory commentId={c.id} />}
          </div>
          {editing === c.id ? (
            <div className="mt-1.5">
              <Composer label="Edit comment" initial={c.body} busy={busy} submitLabel="Save" onSubmit={(b) => void edit(c.id, b)} onCancel={() => setEditing(null)} />
            </div>
          ) : (
            <p className={`mt-1 whitespace-pre-wrap text-sm ${deleted ? 'italic text-slate-400' : 'text-slate-200'}`}>
              {deleted ? 'Comment deleted' : c.body}
            </p>
          )}
          {!deleted && editing !== c.id && (
            <div className="mt-1 flex flex-wrap gap-1">
              {canCompose && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReplyTo(replyTo === c.id ? null : c.id)}>Reply</Button>}
              {mine && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(c.id)}>Edit</Button>}
              {(mine || mayDeleteAny) && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void del(c.id)}>Delete</Button>}
            </div>
          )}
          {replyTo === c.id && (
            <div className="mt-2">
              <Composer label={`Reply to ${name(c.author_id)}`} busy={busy} submitLabel="Post reply" onSubmit={(b) => void post(b, c.id)} onCancel={() => setReplyTo(null)} />
            </div>
          )}
        </article>
        {node.children.length > 0 && <ul>{node.children.map((ch) => renderNode(ch, depth + 1))}</ul>}
      </li>
    )
  }

  return (
    <div className="space-y-4">
      <Card pad="sm">
        <h3 className="mb-1 text-[13px] font-semibold text-white">
          Comments
          {rows && rows.length > 0 && (
            <span className="ml-2 rounded-full bg-white/10 px-1.5 text-[10px] font-semibold text-slate-300">{rows.length}</span>
          )}
        </h3>
        <p className="mb-2 text-xs text-slate-400">
          Discussion between the investigator, the reviewers and the bench. Decision notes stay on the timeline; this thread is for questions and clarifications.
        </p>
        {rows === null && <p className="text-sm text-slate-400">Loading comments…</p>}
        {rows?.length === 0 && <p className="text-sm text-slate-400">No comments yet.</p>}
        {tree.length > 0 && <ul className="divide-y divide-white/5">{tree.map((n) => renderNode(n, 0))}</ul>}
      </Card>
      {canCompose ? (
        <Card pad="sm">
          <Composer label="Add a comment" busy={busy} onSubmit={(b) => void post(b, null)} />
        </Card>
      ) : (
        <p className="text-xs text-slate-400">
          Commenting is open to the requesting investigator, the request&rsquo;s participants and its reviewers.
        </p>
      )}
    </div>
  )
}
