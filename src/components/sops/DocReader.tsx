'use client'

/** Document reader workspace — the full-page reading surface for a governed
 *  library document. Loads its own row (plus relations, own reading state,
 *  own acknowledgements, and the active campaign), renders the body through
 *  renderDocumentMarkdown (heading ids + the TOC list from ONE pass), and
 *  wires the governance actions: acknowledge (rpc), bookmark/resume
 *  (document_user_state), and the manager lifecycle modals (DocLifecycle /
 *  DocEditor / DocHistory). Layout: sticky TOC · ~70ch article · metadata
 *  rail at xl; TOC drawer + metadata disclosure + a fixed acknowledge block
 *  on mobile. Authority mirrors (canEditDoc/canApproveDoc) only decide what
 *  to SHOW — RLS and the RPCs re-decide server-side. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Tables, TablesUpdate } from '@/lib/database.types'
import { insert, list, rpc, updateWhere, withRetry } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { renderDocumentMarkdown } from '@/lib/markdown'
import { copyText, fmtDate, fmtDateTime } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { useNow } from '@/lib/useNow'
import { ActionMenu, type ActionItem } from '@/components/ui/ActionMenu'
import { Badge } from '@/components/ui/Badge'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { PageHeader } from '@/components/ui/PageHeader'
import { DetailSkeleton } from '@/components/ui/Skeleton'
import {
  CATEGORY_LABEL, CLASS_LABEL, STATUS_LABEL, STATUS_TONE, SYNC_LABEL, SYNC_TONE, TYPE_LABEL,
  ackState, canApproveDoc, canEditDoc, docCategory, docTitle, reviewState,
  type AckState, type DocRow, type DocViewer, type DocumentClassification, type DocumentStatus,
  type DocumentType, type MyAckVersions, type SyncStatus,
} from './docModel'
import { DocToc, scrollToHeading, useActiveHeading } from './DocToc'
import { DocMetaRail, type CampaignLite, type MyAckLite, type RelationRow, type RelatedDocMeta } from './DocMetaRail'
import { DocEditorModal } from './DocEditor'
import { DocHistoryModal } from './DocHistory'
import {
  DocWorkflowModal, ReadingCampaignModal, RecordReviewModal, ReportIssueModal, ResolveSyncModal,
  type WorkflowAction,
} from './DocLifecycle'

const bodyOf = (d: DocRow): string => {
  const c = d.content
  if (c && typeof c === 'object' && !Array.isArray(c)) {
    const b = (c as Record<string, unknown>).body
    if (typeof b === 'string') return b
  }
  return ''
}

/** Best-effort per-user reading state write (composite key, no upsert helper
 *  in lib/db): update-first, insert when the row doesn't exist yet. Never
 *  throws — personalization must not break reading. */
async function upsertUserState(documentId: string, userId: string, patch: TablesUpdate<'document_user_state'>): Promise<void> {
  try {
    const res = await updateWhere('document_user_state', { eq: { document_id: documentId, user_id: userId } }, patch)
    if (res.error || (res.data?.length ?? 0) > 0) return
    await insert('document_user_state', { document_id: documentId, user_id: userId, ...patch })
  } catch { /* best-effort */ }
}

/** Own-acknowledgement row with the embedded version number. */
interface AckJoinRow {
  id: string
  document_version_id: string
  acknowledged_at: string
  documents_versions: { version_number: number | null } | null
}

interface RelatedState {
  relations: RelationRow[]
  backlinks: RelationRow[]
  relatedMeta: Record<string, RelatedDocMeta>
  stateRow: Tables<'document_user_state'> | null
  acks: AckJoinRow[]
  campaign: CampaignLite | null
}

const EMPTY_RELATED: RelatedState = { relations: [], backlinks: [], relatedMeta: {}, stateRow: null, acks: [], campaign: null }

type LifecycleState =
  | { kind: 'workflow'; action: WorkflowAction }
  | { kind: 'review' }
  | { kind: 'campaign' }
  | { kind: 'sync' }
  | { kind: 'report' }

export function DocReader(props: {
  docId: string
  onBack: () => void
  onOpenDoc: (id: string) => void
}): React.ReactElement {
  const { docId, onBack, onOpenDoc } = props
  const { state, profile, isCommand, isOwner, justiceRole } = useAuth()
  const uid = profile?.id ?? null
  const version = useTableVersion('documents')
  const nowMs = useNow()

  const [doc, setDoc] = useState<DocRow | null>(null)
  const [load, setLoad] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading')
  const [loadErr, setLoadErr] = useState<unknown>(null)
  const [rel, setRel] = useState<RelatedState>(EMPTY_RELATED)
  const [bookmarked, setBookmarked] = useState(false)
  const [resumeAnchor, setResumeAnchor] = useState<string | null>(null)
  const [tocOpen, setTocOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [lifecycle, setLifecycle] = useState<LifecycleState | null>(null)
  const [tick, setTick] = useState(0)
  const bump = useCallback(() => setTick((t) => t + 1), [])

  // Roster cache for officerName chips.
  const rosterLoaded = useProfilesStore((s) => s.loaded)
  useEffect(() => { if (!rosterLoaded) void useProfilesStore.getState().fetch() }, [rosterLoaded])

  // ── The document row itself ────────────────────────────────────────────────
  useEffect(() => {
    if (state !== 'in') return
    let on = true
    void (async () => {
      try {
        const rows = await withRetry(() => list('documents', { eq: { id: docId } }))
        if (!on) return
        if (rows.length) { setDoc(rows[0]); setLoad('ready') }
        else { setDoc(null); setLoad('missing') }
      } catch (e) { if (on) { setLoadErr(e); setLoad('error') } }
    })()
    return () => { on = false }
  }, [state, docId, version, tick])

  // ── Related rows — all best-effort (a failed sidecar never blocks reading) ─
  const resumeOffered = useRef<string | null>(null)
  useEffect(() => {
    if (state !== 'in' || !uid) return
    let on = true
    void (async () => {
      const [fwd, rev, states, acks, camps] = await Promise.all([
        list('document_relations', { eq: { document_id: docId } }).catch(() => [] as RelationRow[]),
        list('document_relations', { eq: { target_document_id: docId } }).catch(() => [] as RelationRow[]),
        list('document_user_state', { eq: { document_id: docId, user_id: uid } }).catch(() => [] as Tables<'document_user_state'>[]),
        list('document_acknowledgements', {
          select: 'id,document_version_id,acknowledged_at,documents_versions(version_number)',
          eq: { document_id: docId, user_id: uid },
        }).catch(() => []),
        list('document_reading_campaigns', {
          select: 'id,deadline,reason,audience,created_at',
          eq: { document_id: docId, status: 'active' },
          order: 'created_at', ascending: false,
        }).catch(() => []),
      ])
      if (!on) return
      const ids = Array.from(new Set([
        ...fwd.map((r) => r.target_document_id).filter((x): x is string => !!x),
        ...rev.map((r) => r.document_id),
      ]))
      const metaRows = ids.length
        ? await list('documents', { select: 'id,name,status,document_type', in: { id: ids } }).catch(() => [])
        : []
      if (!on) return
      const relatedMeta: Record<string, RelatedDocMeta> = {}
      for (const m of metaRows as unknown as RelatedDocMeta[]) relatedMeta[m.id] = m
      const stateRow = states[0] ?? null
      setRel({
        relations: fwd,
        backlinks: rev,
        relatedMeta,
        stateRow,
        acks: acks as unknown as AckJoinRow[],
        campaign: (camps as unknown as CampaignLite[])[0] ?? null,
      })
      setBookmarked(!!stateRow?.bookmarked)
      // Offer "Resume reading" once per document, only without a URL hash —
      // never auto-scroll without an explicit user action.
      if (resumeOffered.current !== docId) {
        resumeOffered.current = docId
        if (stateRow?.last_anchor && !window.location.hash) setResumeAnchor(stateRow.last_anchor)
      }
    })()
    return () => { on = false }
  }, [state, docId, uid, version, tick])

  // ── Reading-state writes: viewed stamp, then throttled last-anchor ────────
  useEffect(() => {
    if (state !== 'in' || !uid) return
    void upsertUserState(docId, uid, { last_viewed_at: new Date().toISOString() })
  }, [state, docId, uid])

  const body = doc ? bodyOf(doc) : ''
  const { nodes, headings } = useMemo(() => renderDocumentMarkdown(body), [body])
  const activeId = useActiveHeading(docId, headings)

  const anchorRef = useRef<string | null>(null)
  const writtenAnchor = useRef<string | null>(null)
  useEffect(() => {
    anchorRef.current = activeId
    if (!uid || !activeId || activeId === writtenAnchor.current) return
    // Debounced write — only once the reader rests on a section.
    const t = window.setTimeout(() => {
      writtenAnchor.current = activeId
      void upsertUserState(docId, uid, { last_anchor: activeId })
    }, 4000)
    return () => window.clearTimeout(t)
  }, [docId, uid, activeId])
  useEffect(() => () => {
    // Flush the final position on unmount (best-effort, fire-and-forget).
    const a = anchorRef.current
    if (uid && a && a !== writtenAnchor.current) void upsertUserState(docId, uid, { last_anchor: a })
  }, [docId, uid])

  // Deep link: scroll to the URL hash once the article has rendered.
  useEffect(() => {
    if (load !== 'ready') return
    const h = window.location.hash.slice(1)
    if (!h) return
    const t = window.setTimeout(() => { document.getElementById(h)?.scrollIntoView({ block: 'start' }) }, 60)
    return () => window.clearTimeout(t)
  }, [load, docId])

  // ── Derivations ────────────────────────────────────────────────────────────
  const viewer: DocViewer = useMemo(() => ({
    userId: uid,
    active: !!profile?.active,
    role: profile?.role ?? null,
    isCommand,
    isOwner,
    justiceRole,
  }), [uid, profile, isCommand, isOwner, justiceRole])

  const myAcks: MyAckVersions = useMemo(() => ({
    [docId]: rel.acks
      .map((a) => a.documents_versions?.version_number)
      .filter((n): n is number => typeof n === 'number'),
  }), [docId, rel.acks])

  const myAckLatest: MyAckLite | null = useMemo(() => {
    const sorted = [...rel.acks].sort((a, b) => Date.parse(b.acknowledged_at) - Date.parse(a.acknowledged_at))
    const a = sorted[0]
    return a ? { acknowledged_at: a.acknowledged_at, version_number: a.documents_versions?.version_number ?? null } : null
  }, [rel.acks])

  const ack: AckState = doc ? ackState(doc, myAcks) : 'not_required'
  const ackPending = ack === 'pending' || ack === 'reack_needed'

  const acknowledge = async () => {
    if (!doc) return
    const res = await rpc('acknowledge_document', { p_document: docId })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast(`Reading acknowledged — v${doc.current_version_number} recorded`, 'success')
    bump()
  }

  const toggleBookmark = async () => {
    if (!uid) return
    const next = !bookmarked
    setBookmarked(next)
    await upsertUserState(docId, uid, { bookmarked: next })
  }

  const goToSection = (id: string) => scrollToHeading(id)
  const goFromDrawer = (id: string) => {
    setTocOpen(false)
    window.setTimeout(() => scrollToHeading(id), 60) // after the scroll lock releases
  }

  // ── Gates & load states ────────────────────────────────────────────────────
  if (state !== 'in') return <Notice text="Sign in to read division documents." />
  if (load === 'loading') return <DetailSkeleton blocks={3} />
  if (load === 'error') return <ErrorNotice message={loadErr} onRetry={bump} />
  if (load === 'missing' || !doc) {
    return (
      <EmptyState
        icon="📄"
        title="This document isn’t available"
        hint="It may have been removed, or your role doesn’t have access to it."
        action={{ label: 'Back to library', onClick: onBack }}
      />
    )
  }

  const title = docTitle(doc.name)
  const status = doc.status as DocumentStatus
  const sync = (doc.sync_status ?? 'pending') as SyncStatus
  const drive = doc.source_system === 'google_drive'
  const review = reviewState(doc, nowMs)
  const canEdit = canEditDoc(viewer, doc)
  const canApprove = canApproveDoc(viewer, doc)
  const canManage = isCommand || isOwner
  const deadline = rel.campaign?.deadline ?? doc.acknowledgement_deadline

  const menuItems: ActionItem[] = [
    { label: 'Copy link', onClick: () => copyText(window.location.href, 'Document link') },
    { label: 'Print', onClick: () => window.print() },
    { label: 'Report issue…', onClick: () => setLifecycle({ kind: 'report' }) },
  ]
  if (canEdit) menuItems.push({ label: 'Edit…', separatorBefore: true, onClick: () => setEditorOpen(true) })
  if (canEdit || canApprove) menuItems.push({ label: 'View history', onClick: () => setHistoryOpen(true) })
  if (canEdit && status === 'draft')
    menuItems.push({ label: 'Submit for review…', onClick: () => setLifecycle({ kind: 'workflow', action: 'submit' }) })
  if (canApprove && status === 'in_review') {
    menuItems.push({ label: 'Approve…', onClick: () => setLifecycle({ kind: 'workflow', action: 'approve' }) })
    menuItems.push({ label: 'Reject…', onClick: () => setLifecycle({ kind: 'workflow', action: 'reject' }) })
  }
  if (canApprove && (status === 'draft' || status === 'approved'))
    menuItems.push({ label: 'Publish…', onClick: () => setLifecycle({ kind: 'workflow', action: 'publish' }) })
  if (canApprove && (status === 'published' || status === 'approved'))
    menuItems.push({ label: 'Record review…', onClick: () => setLifecycle({ kind: 'review' }) })
  if (canManage && status === 'published')
    menuItems.push({ label: 'Required reading…', onClick: () => setLifecycle({ kind: 'campaign' }) })
  if (canManage && doc.sync_status === 'conflict')
    menuItems.push({ label: 'Resolve sync conflict…', onClick: () => setLifecycle({ kind: 'sync' }) })
  if (canApprove && status === 'published')
    menuItems.push({ label: 'Supersede…', separatorBefore: true, danger: true, onClick: () => setLifecycle({ kind: 'workflow', action: 'supersede' }) })
  if (canApprove && status !== 'archived')
    menuItems.push({ label: 'Archive…', danger: true, separatorBefore: status !== 'published', onClick: () => setLifecycle({ kind: 'workflow', action: 'archive' }) })

  const showToc = headings.length >= 2
  const gridCols = showToc
    ? 'lg:grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[13rem_minmax(0,1fr)_18rem]'
    : 'xl:grid-cols-[minmax(0,1fr)_18rem]'

  const metaRail = (
    <DocMetaRail
      doc={doc}
      relations={rel.relations}
      backlinks={rel.backlinks}
      relatedMeta={rel.relatedMeta}
      campaign={rel.campaign}
      myAck={myAckLatest}
      ack={ack}
      onOpenDoc={onOpenDoc}
    />
  )

  return (
    <div className={ackPending ? 'pb-28 lg:pb-0' : ''}>
      <Breadcrumbs className="mb-4" items={[{ label: 'Back to library', onClick: onBack }, { label: title }]} />

      <Card pad="lg" className="mb-6">
        <PageHeader
          title={title}
          actions={
            <>
              {ackPending && (
                /* Wrapper owns the responsive display — Button's base display
                 * class outranks a `hidden` on the button itself in the
                 * generated stylesheet order. Mobile uses the fixed bottom
                 * bar instead (caught live: 41px overflow at 390px). */
                <span className="hidden lg:block">
                  <Button variant="primary" onAction={acknowledge}>
                    Acknowledge reading
                  </Button>
                </span>
              )}
              <Button aria-pressed={bookmarked} onAction={toggleBookmark}>
                <span aria-hidden>{bookmarked ? '★' : '☆'}</span> {bookmarked ? 'Bookmarked' : 'Bookmark'}
              </Button>
              <ActionMenu items={menuItems} label="Document actions" buttonClassName="min-h-[40px]" />
            </>
          }
        />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Badge tone="accent">{TYPE_LABEL[doc.document_type as DocumentType] ?? doc.document_type}</Badge>
          <Badge tone="neutral">{CATEGORY_LABEL[docCategory(doc)]}</Badge>
          <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? doc.status}</Badge>
          {doc.classification !== 'internal' && (
            <Badge tone="warn">{CLASS_LABEL[doc.classification as DocumentClassification] ?? doc.classification}</Badge>
          )}
          {doc.mandatory && <Badge tone="warn">Mandatory</Badge>}
          {drive && <Badge tone={SYNC_TONE[sync] ?? 'neutral'}>{SYNC_LABEL[sync] ?? doc.sync_status}</Badge>}
          <span className="font-mono text-xs font-bold text-slate-300">v{doc.current_version_number}</span>
          <span className="text-xs text-slate-400">Owner {officerName(doc.owner_user_id) ?? '—'}</span>
          {doc.approved_by && (
            <span className="text-xs text-slate-400">
              Approved {officerName(doc.approved_by)}{doc.approved_at ? ` · ${fmtDate(doc.approved_at)}` : ''}
            </span>
          )}
          {doc.effective_at && <span className="text-xs text-slate-400">Effective {fmtDate(doc.effective_at)}</span>}
          {review ? (
            <Badge tone={review === 'overdue' ? 'danger' : 'warn'}>
              {review === 'overdue' ? 'Review overdue' : 'Review due'} · {fmtDate(doc.review_due_at)}
            </Badge>
          ) : doc.review_due_at ? (
            <span className="text-xs text-slate-400">Review due {fmtDate(doc.review_due_at)}</span>
          ) : null}
          {doc.expires_at && <span className="text-xs text-slate-400">Expires {fmtDate(doc.expires_at)}</span>}
          <span className="text-xs text-slate-400">Updated {fmtDateTime(doc.updated_at)}</span>
          <span className="text-xs text-slate-400">Source {drive ? 'Google Drive' : 'Portal'}</span>
        </div>
      </Card>

      {ackPending && (
        <div className="mb-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-sm font-semibold text-amber-200">
            {ack === 'reack_needed' ? 'This document changed — please read it again.' : 'Reading acknowledgement required.'}
            {deadline ? ` Due ${fmtDate(deadline)}.` : ''}
          </p>
          {rel.campaign?.reason && <p className="mt-0.5 text-xs text-slate-400">{rel.campaign.reason}</p>}
        </div>
      )}

      {resumeAnchor && headings.some((h) => h.id === resumeAnchor) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => { scrollToHeading(resumeAnchor); setResumeAnchor(null) }}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
          >
            <span aria-hidden>↳</span>
            Resume reading — {headings.find((h) => h.id === resumeAnchor)?.text}
          </button>
          <button
            onClick={() => setResumeAnchor(null)}
            aria-label="Dismiss resume suggestion"
            className="grid h-10 w-10 place-items-center rounded-full text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
      )}

      <div className={`grid grid-cols-1 gap-6 ${gridCols}`}>
        {showToc && (
          <div className="hidden lg:block">
            <div className="sticky top-4">
              <DocToc headings={headings} activeId={activeId} onSelect={goToSection} />
            </div>
          </div>
        )}

        <div className="min-w-0">
          {showToc && (
            <div className="mb-3 lg:hidden">
              <Button onClick={() => setTocOpen(true)} aria-haspopup="dialog" className="min-h-[44px]">
                ☰ Contents
              </Button>
            </div>
          )}
          <details className="mb-4 rounded-2xl border border-white/5 bg-ink-900/60 xl:hidden">
            <summary className="flex min-h-[44px] cursor-pointer select-none items-center px-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Details, source & related
            </summary>
            <div className="px-4 pb-4">{metaRail}</div>
          </details>
          <Card pad="lg">
            <article className="mx-auto w-full max-w-[70ch] text-[15px] leading-7">
              {nodes}
            </article>
          </Card>
        </div>

        <div className="hidden xl:block">
          <div className="sticky top-4">{metaRail}</div>
        </div>
      </div>

      {/* Mobile: acknowledgement stays one thumb away while reading. */}
      {ackPending && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/95 p-3 backdrop-blur lg:hidden">
          {deadline && <p className="mb-1.5 text-center text-xs text-amber-300">Due {fmtDate(deadline)}</p>}
          <Button variant="primary" className="min-h-[48px] w-full" onAction={acknowledge}>
            Acknowledge reading — v{doc.current_version_number}
          </Button>
        </div>
      )}

      {/* Mobile TOC drawer (ui/Modal — focus-trapped). */}
      {tocOpen && (
        <Modal open slide onClose={() => setTocOpen(false)}>
          <div className="p-5">
            <ModalHeader title="Contents" onClose={() => setTocOpen(false)} />
            <DocToc headings={headings} activeId={activeId} onSelect={goFromDrawer} size="sheet" />
          </div>
        </Modal>
      )}

      {editorOpen && (
        <DocEditorModal
          docId={docId}
          onClose={() => setEditorOpen(false)}
          onSaved={() => { setEditorOpen(false); bump() }}
        />
      )}
      {historyOpen && (
        <DocHistoryModal doc={doc} canEdit={canEdit} onClose={() => setHistoryOpen(false)} onChanged={bump} />
      )}
      {lifecycle?.kind === 'workflow' && (
        <DocWorkflowModal
          doc={doc}
          action={lifecycle.action}
          onClose={() => setLifecycle(null)}
          onDone={() => { setLifecycle(null); bump() }}
        />
      )}
      {lifecycle?.kind === 'review' && (
        <RecordReviewModal doc={doc} onClose={() => setLifecycle(null)} onDone={() => { setLifecycle(null); bump() }} />
      )}
      {lifecycle?.kind === 'campaign' && (
        <ReadingCampaignModal
          doc={doc}
          campaign={rel.campaign}
          onClose={() => setLifecycle(null)}
          onDone={() => { setLifecycle(null); bump() }}
        />
      )}
      {lifecycle?.kind === 'sync' && (
        <ResolveSyncModal doc={doc} onClose={() => setLifecycle(null)} onDone={() => { setLifecycle(null); bump() }} />
      )}
      {lifecycle?.kind === 'report' && (
        <ReportIssueModal doc={doc} section={activeId} onClose={() => setLifecycle(null)} />
      )}
    </div>
  )
}
