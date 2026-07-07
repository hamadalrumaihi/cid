'use client'

/** Announcements — vanilla collab.js §15. Division-wide notices; posting/
 *  editing/deleting is gated to LEAD_ROLES (bureau lead and above). Dismissal
 *  is per-user and local-only (same `annDismissed`/`annSeen` Store keys as
 *  vanilla, so state carries over); pinned posts sort to the top; audience
 *  scoping is a client convenience on top of what RLS returns. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useProfilesStore } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { deptLabel } from '@/lib/roles'
import { Store } from '@/lib/store'
import { Modal } from '@/components/ui/Modal'
import { AnnouncementModal } from './AnnouncementModal'
import {
  REC_LINK, mentionLabel, parseLinks, parseMentions, visibleAnnouncements,
  type AnnouncementRow,
} from './announceUtils'

interface CaseOption { id: string; case_number: string }

export function AnnounceView() {
  const { profile, state, isCommand } = useAuth()
  const fetchProfiles = useProfilesStore((s) => s.fetch)
  const [rows, setRows] = useState<AnnouncementRow[]>([])
  const [caseOptions, setCaseOptions] = useState<CaseOption[]>([])
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  /** null = closed · 'new' = post · row = edit. */
  const [editing, setEditing] = useState<AnnouncementRow | 'new' | null>(null)
  const [viewing, setViewing] = useState<AnnouncementRow | null>(null)
  const v = useTableVersion('announcements')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    await Promise.resolve()
    void fetchProfiles()
    setDismissed(new Set(Store.get<string[]>('annDismissed', [])))
    try {
      const [anns, cases] = await Promise.all([
        list('announcements', { order: 'created_at', ascending: false }),
        // Recent cases feed the modal's "Link case" picker (vanilla: first 30
        // of the updated_at-desc cases cache), slim projection.
        list('cases', { select: 'id,case_number', order: 'updated_at', ascending: false, limit: 30 })
          .then((r) => r as unknown as CaseOption[])
          .catch(() => [] as CaseOption[]),
      ])
      setRows(anns)
      setCaseOptions(cases)
    } catch { setRows([]) }
  }, [state, fetchProfiles])

  useEffect(() => {
    const id = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(id)
  }, [refresh, v])

  const division = profile?.division ?? null
  const items = useMemo(() => visibleAnnouncements(rows, division, dismissed, false), [rows, division, dismissed])
  const withDismissed = useMemo(() => visibleAnnouncements(rows, division, dismissed, true), [rows, division, dismissed])
  const dismissedCount = withDismissed.length - items.length

  // Mark seen for the unread badge (Notifications cross-cut reads `annSeen`;
  // vanilla stamps the first visible item's created_at — pinned-first quirk kept).
  useEffect(() => {
    const id = window.setTimeout(() => {
      const latest = withDismissed[0]
      if (latest) Store.set('annSeen', latest.created_at)
    }, 0)
    return () => window.clearTimeout(id)
  }, [withDismissed])

  const dismiss = (id: string) => {
    const next = new Set(dismissed)
    next.add(id)
    Store.set('annDismissed', [...next])
    setDismissed(next)
  }
  const restoreAll = () => {
    Store.set('annDismissed', [])
    setDismissed(new Set())
  }

  return (
    <section className="view-in space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <div>
          <h3 className="flex items-center gap-2 text-xl font-bold text-white">📣 Announcements</h3>
          <p className="text-sm text-slate-400">Division-wide notices from CID command staff. Posting is restricted to Bureau Lead and above.</p>
        </div>
        {isCommand && (
          <button onClick={() => setEditing('new')} className="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">
            + New Announcement
          </button>
        )}
      </div>

      <div className="space-y-4">
        {state !== 'in' ? (
          <p className="text-sm text-slate-500">Sign in to view announcements.</p>
        ) : !items.length ? (
          <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-10 text-center">
            <p className="text-3xl" aria-hidden="true">📣</p>
            <p className="mt-2 text-sm text-slate-400">
              {dismissedCount ? 'All announcements dismissed.' : `No announcements yet.${isCommand ? ' Use "+ New Announcement" to post the first.' : ''}`}
            </p>
            {dismissedCount > 0 && (
              <button onClick={restoreAll} className="mt-3 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10">
                Show {dismissedCount} dismissed
              </button>
            )}
          </div>
        ) : (
          <>
            {items.map((a) => (
              <AnnouncementCard key={a.id} a={a} canManage={isCommand} onOpen={() => setViewing(a)} onEdit={() => setEditing(a)} onDismiss={() => dismiss(a.id)} />
            ))}
            {dismissedCount > 0 && (
              <div className="text-center">
                <button onClick={restoreAll} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-400 hover:bg-white/10">
                  Show {dismissedCount} dismissed
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {editing !== null && (
        <AnnouncementModal
          key={editing === 'new' ? 'new' : editing.id}
          record={editing === 'new' ? null : editing}
          caseOptions={caseOptions}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh() }}
        />
      )}
      {viewing && <AnnouncementViewModal a={viewing} onClose={() => setViewing(null)} />}
    </section>
  )
}

function AnnChips({ a }: { a: AnnouncementRow }) {
  const mentions = parseMentions(a.mentions)
  const links = parseLinks(a.links)
  if (!mentions.length && !links.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {mentions.map((m) => (
        <span key={m.target} className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-300">@{m.label || mentionLabel(m.target)}</span>
      ))}
      {links.map((l) => (
        <span key={l.id} className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[11px] text-violet-300">
          {REC_LINK[l.type]?.icon || '🔗'} {l.label || l.id}
        </span>
      ))}
    </div>
  )
}

function AnnouncementCard({ a, canManage, onOpen, onEdit, onDismiss }: {
  a: AnnouncementRow
  canManage: boolean
  onOpen: () => void
  onEdit: () => void
  onDismiss: () => void
}) {
  return (
    <article
      onClick={onOpen}
      className={`cursor-pointer rounded-2xl border p-5 transition hover:border-blue-500/30 ${a.pinned ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-white/5 bg-ink-900/60'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-base font-bold text-white">{a.pinned ? '📌 ' : ''}{a.title}</h4>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {a.author_name || 'Command'} · {new Date(a.created_at).toLocaleString('en-US')}
            {a.audience !== 'all' ? ` · ${deptLabel(a.audience)} only` : ''}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {canManage && (
            <button onClick={(e) => { e.stopPropagation(); onEdit() }} className="text-[11px] text-slate-400 hover:text-white">edit</button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDismiss() }} title="Dismiss (hides for you)" className="text-slate-500 hover:text-white">✕</button>
        </div>
      </div>
      <p className="mt-3 line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{a.body}</p>
      <AnnChips a={a} />
    </article>
  )
}

function AnnouncementViewModal({ a, onClose }: { a: AnnouncementRow; onClose: () => void }) {
  const router = useRouter()
  const mentions = parseMentions(a.mentions)
  const links = parseLinks(a.links)
  const openLink = (l: { type: string; id: string }) => {
    onClose()
    if (l.type === 'case') router.push(`/cases?case=${encodeURIComponent(l.id)}`)
    else router.push(`/${REC_LINK[l.type]?.tab || 'cases'}`)
  }
  return (
    <Modal open wide onClose={onClose}>
      <div className="p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-white">{a.pinned ? '📌 ' : ''}{a.title}</h3>
            <p className="mt-1 text-[11px] text-slate-500">
              {a.author_name || 'Command'} · {new Date(a.created_at).toLocaleString('en-US')}
              {a.audience !== 'all' ? ` · ${deptLabel(a.audience)} only` : ''}
            </p>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-white">&times;</button>
        </div>
        {mentions.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {mentions.map((m) => (
              <span key={m.target} className="rounded bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-300">@{m.label || mentionLabel(m.target)}</span>
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{a.body}</p>
        {links.length > 0 && (
          <div className="mt-4 border-t border-white/5 pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Linked records</p>
            <div className="flex flex-wrap gap-2">
              {links.map((l) => (
                <button key={l.id} onClick={() => openLink(l)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-blue-300 hover:bg-white/10">
                  {REC_LINK[l.type]?.icon || '🔗'} {l.label || l.id}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
