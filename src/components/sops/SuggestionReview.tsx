'use client'

/** Suggestion review workspace — the bureau-lead/command surface for triaging
 *  document suggestions (migration 20260802010000). Card-based throughout: the
 *  five lifecycle groups (New / Under review / Accepted / Implemented / Closed)
 *  render as grouped card sections, and each suggestion opens a slide-over
 *  drawer with its explanation, event timeline, comment thread and the manager
 *  decision controls.
 *
 *  Grouping, vocabulary and the note/decision rules all come from the pure
 *  model (docSuggestions). Authority is server-side (RLS + the definer RPCs);
 *  the `canManage` mirror here only decides which controls to render, and the
 *  list itself is whatever RLS returns. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Database } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { activeProfiles, officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { docTitle } from './docModel'
import {
  DECISION_STATUSES, SUGGESTION_GROUPS, SUGGESTION_GROUP_LABEL,
  SUGGESTION_STATUS_LABEL, SUGGESTION_STATUS_TONE, SUGGESTION_TYPE_LABEL,
  decisionRequiresNote, groupSuggestions, isOpenSuggestion,
  type BadgeTone, type Suggestion, type SuggestionComment, type SuggestionEvent,
  type SuggestionStatus,
} from './docSuggestions'

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'danger'
const BADGE_TONE: Record<BadgeTone, Tone> = {
  neutral: 'neutral', info: 'accent', warn: 'warn', danger: 'danger', success: 'good',
}

const GRID = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'

function statusBadge(status: string) {
  const s = status as SuggestionStatus
  const tone = BADGE_TONE[SUGGESTION_STATUS_TONE[s] ?? 'neutral']
  return <Badge tone={tone}>{SUGGESTION_STATUS_LABEL[s] ?? status}</Badge>
}

/* ── Suggestion card ────────────────────────────────────────────────────────*/
function SuggestionCard({ s, docName, onOpen }: {
  s: Suggestion
  docName: string | null
  onOpen: () => void
}) {
  const target = s.document_id
    ? docName ?? 'Document'
    : s.suggestion_type === 'new_document' ? 'New document proposal' : 'General suggestion'
  return (
    <Card interactive className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onOpen}
        className="min-h-[44px] min-w-0 rounded-lg text-left text-sm font-semibold leading-snug text-white transition hover:text-badge-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
      >
        {s.title}
      </button>
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tone="accent">{SUGGESTION_TYPE_LABEL[s.suggestion_type as keyof typeof SUGGESTION_TYPE_LABEL] ?? s.suggestion_type}</Badge>
        {statusBadge(s.status)}
      </span>
      <p className="min-w-0 truncate text-xs text-slate-400">
        {target}{s.section_title ? ` · ${s.section_title}` : ''}
      </p>
      <p className="mt-auto pt-2 text-[11px] text-slate-400">
        {officerName(s.created_by) ?? 'Officer'} · {timeAgo(s.created_at)}
      </p>
    </Card>
  )
}

/* ── Detail + decision drawer ───────────────────────────────────────────────*/
type DecideArgs = Database['public']['Functions']['decide_document_suggestion']['Args']
type DupArgs = Database['public']['Functions']['mark_document_suggestion_duplicate']['Args']
type LinkArgs = Database['public']['Functions']['link_document_suggestion_implementation']['Args']
interface VersionOption { id: string; version_number: number }

const EVENT_LABEL: Record<string, string> = {
  submitted: 'Submitted', decision: 'Decision recorded', comment: 'Comment',
  duplicate: 'Marked duplicate', implemented: 'Implemented',
}

function SuggestionDrawer({ suggestion, docName, allSuggestions, canManage, onOpenDoc, onClose, onChanged }: {
  suggestion: Suggestion
  docName: string | null
  allSuggestions: Suggestion[]
  canManage: boolean
  onOpenDoc: (id: string) => void
  onClose: () => void
  onChanged: () => void
}) {
  const s = suggestion
  const [events, setEvents] = useState<SuggestionEvent[] | null>(null)
  const [comments, setComments] = useState<SuggestionComment[] | null>(null)
  const [tick, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])

  // Comment box.
  const [comment, setComment] = useState('')

  // Decision controls.
  const [decision, setDecision] = useState<SuggestionStatus | ''>('')
  const [note, setNote] = useState('')
  const [editor, setEditor] = useState('')

  // Duplicate / implementation.
  const [dupOf, setDupOf] = useState('')
  const [dupNote, setDupNote] = useState('')
  const [versions, setVersions] = useState<VersionOption[]>([])
  const [versionId, setVersionId] = useState('')

  useEffect(() => {
    let on = true
    void (async () => {
      const [ev, cm] = await Promise.all([
        list('document_suggestion_events', { eq: { suggestion_id: s.id }, order: 'created_at', ascending: true }).catch(() => []),
        list('document_suggestion_comments', { eq: { suggestion_id: s.id }, order: 'created_at', ascending: true }).catch(() => []),
      ])
      if (!on) return
      setEvents(ev)
      setComments(cm)
    })()
    return () => { on = false }
  }, [s.id, tick])

  // Versions for the "link implementation" picker (accepted items only).
  useEffect(() => {
    if (!s.document_id) return
    let on = true
    void (async () => {
      const rows = await list('documents_versions', {
        select: 'id,version_number', eq: { document_id: s.document_id }, order: 'version_number', ascending: false,
      }).catch(() => [])
      if (on) setVersions(rows as unknown as VersionOption[])
    })()
    return () => { on = false }
  }, [s.document_id])

  const accepted = s.status === 'accepted' || s.status === 'partially_accepted'
  const isEditorPick = decision === 'accepted' || decision === 'partially_accepted'
  const noteRequired = decision !== '' && decisionRequiresNote(decision)
  const decideBlocked = decision === '' || (noteRequired && note.trim() === '')

  const sendComment = async () => {
    const body = comment.trim()
    if (!body) return
    const res = await rpc('comment_on_document_suggestion', { p_suggestion: s.id, p_body: body })
    if (res.error) { toast(res.error.message, 'danger'); return }
    setComment('')
    bump()
  }

  const recordDecision = async () => {
    if (decideBlocked) return
    const args: DecideArgs = { p_suggestion: s.id, p_status: decision }
    if (note.trim()) args.p_note = note.trim()
    if (isEditorPick && editor) args.p_assigned_editor = editor
    const res = await rpc('decide_document_suggestion', args)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(`Decision recorded — ${SUGGESTION_STATUS_LABEL[decision]}.`, 'success')
    setDecision(''); setNote(''); setEditor('')
    onChanged(); bump()
  }

  const markDuplicate = async () => {
    if (!dupOf) return
    const args: DupArgs = { p_suggestion: s.id, p_original: dupOf }
    if (dupNote.trim()) args.p_note = dupNote.trim()
    const res = await rpc('mark_document_suggestion_duplicate', args)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Marked as a duplicate.', 'success')
    setDupOf(''); setDupNote('')
    onChanged(); bump()
  }

  const linkImplementation = async () => {
    if (!versionId) return
    const args: LinkArgs = { p_suggestion: s.id, p_version: versionId }
    const res = await rpc('link_document_suggestion_implementation', args)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Linked the implementing version — marked implemented.', 'success')
    setVersionId('')
    onChanged(); bump()
  }

  const dupCandidates = allSuggestions.filter((x) => x.id !== s.id)

  // Unrecorded review input (comment, decision, duplicate/implementation
  // pickers) gates close with the shared unsaved-changes prompt.
  const dirty = () => !!(comment.trim() || decision || note.trim() || editor || dupOf || dupNote.trim() || versionId)

  return (
    <Modal open slide onClose={onClose} dirty={dirty}>
      <div className="p-5 sm:p-6">
        <ModalHeader title={s.title} onClose={onClose} />

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">{SUGGESTION_TYPE_LABEL[s.suggestion_type as keyof typeof SUGGESTION_TYPE_LABEL] ?? s.suggestion_type}</Badge>
          {statusBadge(s.status)}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {officerName(s.created_by) ?? 'Officer'} · {fmtDateTime(s.created_at)}
        </p>

        {/* Target document */}
        <div className="mt-4 rounded-xl border border-white/10 bg-ink-900/60 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Target</p>
          {s.document_id ? (
            <button
              type="button"
              onClick={() => onOpenDoc(s.document_id!)}
              className="mt-0.5 min-h-[36px] text-left text-sm font-semibold text-white transition hover:text-badge-200"
            >
              {docName ?? 'Document'}{s.section_title ? ` · ${s.section_title}` : ''}
            </button>
          ) : (
            <p className="mt-0.5 text-sm font-semibold text-white">
              {s.suggestion_type === 'new_document' ? 'New document proposal' : 'General suggestion (no document)'}
            </p>
          )}
        </div>

        {/* Explanation + proposed text */}
        <section className="mt-4 space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Explanation</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-200">{s.explanation}</p>
          </div>
          {s.proposed_text && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Proposed text</p>
              <p className="mt-1 whitespace-pre-wrap rounded-lg border border-white/5 bg-ink-900/60 p-3 text-sm leading-6 text-slate-200">{s.proposed_text}</p>
            </div>
          )}
        </section>

        {/* Decision controls (managers only) */}
        {canManage && (
          <section className="mt-5 space-y-4 rounded-xl border border-white/10 bg-ink-900/40 p-4">
            <SectionHeader title="Review decision" className="!mb-0" />
            <p className="text-xs text-slate-400">
              Recording a decision does not edit the SOP. Accepting assigns a responsible editor; the change is made
              separately, then linked below.
            </p>
            <Field label="Set status">
              {(id) => (
                <Select id={id} value={decision} onChange={(e) => setDecision(e.target.value as SuggestionStatus | '')}>
                  <option value="">Choose a decision…</option>
                  {DECISION_STATUSES.map((d) => <option key={d} value={d}>{SUGGESTION_STATUS_LABEL[d]}</option>)}
                </Select>
              )}
            </Field>
            {isEditorPick && (
              <Field label="Assign an editor" hint="Optional — who will make the change.">
                {(id) => (
                  <Select id={id} value={editor} onChange={(e) => setEditor(e.target.value)}>
                    <option value="">Unassigned</option>
                    {activeProfiles().map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </Select>
                )}
              </Field>
            )}
            <Field
              label="Note"
              required={noteRequired}
              hint={noteRequired ? 'Required for this decision.' : 'Optional — context for the submitter.'}
            >
              {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={2} />}
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" disabled={decideBlocked} onAction={recordDecision}>Record decision</Button>
            </div>

            {/* Link implementation — accepted items with a target document. */}
            {accepted && s.document_id && (
              <div className="border-t border-white/5 pt-4">
                <p className="mb-2 text-xs font-semibold text-slate-300">Link the implementing version</p>
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="Document version" className="min-w-[12rem] flex-1">
                    {(id) => (
                      <Select id={id} value={versionId} onChange={(e) => setVersionId(e.target.value)}>
                        <option value="">Choose a version…</option>
                        {versions.map((v) => <option key={v.id} value={v.id}>v{v.version_number}</option>)}
                      </Select>
                    )}
                  </Field>
                  <Button variant="success" disabled={!versionId} onAction={linkImplementation}>Mark implemented</Button>
                </div>
              </div>
            )}

            {/* Mark duplicate — never deletes. */}
            <div className="border-t border-white/5 pt-4">
              <p className="mb-2 text-xs font-semibold text-slate-300">Mark as a duplicate</p>
              <div className="space-y-2">
                <Field label="Original suggestion">
                  {(id) => (
                    <Select id={id} value={dupOf} onChange={(e) => setDupOf(e.target.value)}>
                      <option value="">Choose the original…</option>
                      {dupCandidates.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Note" hint="Optional.">
                  {(id) => <Input id={id} value={dupNote} onChange={(e) => setDupNote(e.target.value)} />}
                </Field>
                <div className="flex justify-end">
                  <Button variant="secondary" disabled={!dupOf} onAction={markDuplicate}>Mark duplicate</Button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Event timeline */}
        <section className="mt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">History</p>
          {events === null ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : events.length === 0 ? (
            <p className="text-xs text-slate-400">No activity yet.</p>
          ) : (
            <ol className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="flex gap-2.5">
                  <span aria-hidden className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-white/25" />
                  <div className="min-w-0">
                    <p className="text-xs text-slate-200">
                      <span className="font-semibold">{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                      {e.to_status && <> — {SUGGESTION_STATUS_LABEL[e.to_status as SuggestionStatus] ?? e.to_status}</>}
                    </p>
                    {e.note && <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-400">{e.note}</p>}
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {officerName(e.actor_id) ?? 'System'} · {timeAgo(e.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Comment thread */}
        <section className="mt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Discussion</p>
          {comments === null ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : comments.length === 0 ? (
            <p className="text-xs text-slate-400">No messages yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {comments.map((c) => (
                <li key={c.id} className="rounded-lg border border-white/5 bg-ink-900/60 p-3">
                  <p className="text-[11px] text-slate-400">{officerName(c.author_id) ?? 'Officer'} · {timeAgo(c.created_at)}</p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{c.body}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 space-y-2">
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              aria-label="Add a comment"
              placeholder="Reply or ask for more information…"
            />
            <div className="flex justify-end">
              <Button variant="secondary" disabled={!comment.trim()} onAction={sendComment}>Post comment</Button>
            </div>
          </div>
        </section>
      </div>
    </Modal>
  )
}

/* ── Workspace ──────────────────────────────────────────────────────────────*/
export function SuggestionReview({ onBack, onOpenDoc, openId }: {
  onBack: () => void
  onOpenDoc: (id: string) => void
  openId?: string | null
}) {
  const { state, isCommand, isOwner } = useAuth()
  const canManage = isCommand || isOwner
  const version = useTableVersion('document_suggestions')

  const [rows, setRows] = useState<Suggestion[] | null>(null)
  const [docNames, setDocNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<unknown>(null)
  const [openSel, setOpenSel] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const openApplied = useRef<string | null>(null)

  const rosterLoaded = useProfilesStore((s) => s.loaded)
  useEffect(() => { if (!rosterLoaded) void useProfilesStore.getState().fetch() }, [rosterLoaded])

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    setError(null)
    try {
      const data = await list('document_suggestions', { order: 'created_at', ascending: false })
      setRows(data)
      const ids = Array.from(new Set(data.map((r) => r.document_id).filter((x): x is string => !!x)))
      if (ids.length) {
        const docs = await list('documents', { select: 'id,name', in: { id: ids } }).catch(() => [])
        const map: Record<string, string> = {}
        for (const d of docs as unknown as { id: string; name: string }[]) map[d.id] = docTitle(d.name)
        setDocNames(map)
      }
    } catch (e) {
      setError(e)
    }
  }, [state])

  useEffect(() => {
    const t = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(t)
  }, [refresh, version, tick])

  // Deep link (?suggestion=) opens the drawer once, after the row is loaded.
  // Deferred out of the effect body so it doesn't cascade a synchronous render.
  useEffect(() => {
    if (!openId || !rows || openApplied.current === openId) return
    if (!rows.some((r) => r.id === openId)) return
    openApplied.current = openId
    const t = window.setTimeout(() => setOpenSel(openId), 0)
    return () => window.clearTimeout(t)
  }, [openId, rows])

  const groups = useMemo(() => (rows ? groupSuggestions(rows) : null), [rows])
  const openCount = useMemo(() => (rows ? rows.filter((r) => isOpenSuggestion(r.status)).length : 0), [rows])
  const selected = useMemo(() => rows?.find((r) => r.id === openSel) ?? null, [rows, openSel])

  if (state !== 'in') return <Notice text="Sign in to review document suggestions." />

  return (
    <section className="space-y-5">
      <header>
        <Breadcrumbs className="mb-2" items={[{ label: 'Back to library', onClick: onBack }, { label: 'Suggestions' }]} />
        <PageHeader
          title="Document suggestions"
          subtitle="Review, decide, and track improvement requests from the division. Deciding never edits an SOP directly."
          actions={<Button onClick={() => setTick((t) => t + 1)}>Refresh</Button>}
        />
        {rows && rows.length > 0 && (
          <p className="mt-2 text-sm text-slate-400" aria-live="polite">
            {rows.length} suggestion{rows.length === 1 ? '' : 's'}
            {openCount > 0 && ` · ${openCount} still open`}
          </p>
        )}
      </header>

      {error && rows === null ? (
        <ErrorNotice message={error} onRetry={() => setTick((t) => t + 1)} />
      ) : rows === null ? (
        <CardGridSkeleton cols="sm:grid-cols-2 xl:grid-cols-3" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="🗂"
          title="No suggestions yet"
          hint="Improvement requests from readers appear here for review."
        />
      ) : (
        <div className="space-y-8">
          {error != null && <ErrorNotice message={error} onRetry={() => setTick((t) => t + 1)} />}
          {groups && SUGGESTION_GROUPS.map((g) => {
            const items = groups[g]
            if (!items.length) return null
            return (
              <section key={g}>
                <SectionHeader title={`${SUGGESTION_GROUP_LABEL[g]} (${items.length})`} className="mb-3" />
                <div className={GRID}>
                  {items.map((s) => (
                    <SuggestionCard
                      key={s.id}
                      s={s}
                      docName={s.document_id ? docNames[s.document_id] ?? null : null}
                      onOpen={() => setOpenSel(s.id)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {selected && (
        <SuggestionDrawer
          suggestion={selected}
          docName={selected.document_id ? docNames[selected.document_id] ?? null : null}
          allSuggestions={rows ?? []}
          canManage={canManage}
          onOpenDoc={onOpenDoc}
          onClose={() => setOpenSel(null)}
          onChanged={() => setTick((t) => t + 1)}
        />
      )}
    </section>
  )
}
