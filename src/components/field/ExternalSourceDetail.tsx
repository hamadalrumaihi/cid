'use client'

/** One external source: header, the UNVERIFIED INTELLIGENCE banner (until
 *  an analyst verifies it), the captured text of the selected version
 *  (always plain text — crawled markdown/HTML is never rendered), the
 *  version history with diff chips, links to records, analyst notes and
 *  classification. Every write is an RPC; the row refreshes on the
 *  `external_sources` realtime channel so a finished crawl appears without
 *  a reload. A source the viewer cannot read (RLS) renders the neutral stub. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import {
  SOURCE_CLASSIFICATIONS, SOURCE_LINK_KIND_LABEL, diffSummaryText, fetchSource, fetchVersionText, isVerified, parseDiffSummary,
  recrawl, reliabilityLabel, reliabilityTone, resolveLinkLabels, sourceStatusLabel, sourceStatusTone, unlinkSource, updateSource,
  verificationLabel, verificationTone, type SourceDetail, type SourceLinkKind, type SourceVersionLite,
} from '@/lib/externalSources'
import { fmtDateTime, timeAgo } from '@/lib/format'
import { officerName } from '@/lib/profiles'
import { useTableVersion } from '@/lib/realtime'
import { safeUrl } from '@/lib/safeUrl'
import { toast } from '@/lib/toast'
import { useNarrow } from '@/lib/useNarrow'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiConfirm } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { DetailSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { LinkSourceDialog } from './LinkSourceDialog'
import { VerifySourceDialog } from './VerifySourceDialog'

export function ExternalSourceDetail({ id, onBack, onChanged }: {
  id: string
  onBack: () => void
  /** The list behind this detail should refetch (counts, badges). */
  onChanged?: () => void
}) {
  const { profile, isCommand } = useAuth()
  const narrow = useNarrow()
  const v = useTableVersion('external_sources')
  const [detail, setDetail] = useState<SourceDetail | null | undefined>(undefined)
  const [error, setError] = useState<unknown>(null)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [notesDirty, setNotesDirty] = useState(false)
  const [dialog, setDialog] = useState<'none' | 'verify' | 'link'>('none')
  const [busy, setBusy] = useState<'recrawl' | 'notes' | 'class' | null>(null)

  const refresh = useCallback(async () => {
    try {
      const d = await fetchSource(id)
      setError(null)
      setDetail(d)
      if (d) {
        setVersionId((cur) => (cur && d.versions.some((x) => x.id === cur) ? cur : d.source.current_version_id ?? d.versions[0]?.id ?? null))
        setNotes((cur) => (notesDirty ? cur : d.source.analyst_notes ?? ''))
        void resolveLinkLabels(d.links).then(setLabels)
      }
    } catch (e) {
      setError(e)
    }
  }, [id, notesDirty])
  useEffect(() => { const t = window.setTimeout(() => { void refresh() }, 0); return () => window.clearTimeout(t) }, [refresh, v])

  // The selected version's text, fetched on demand.
  useEffect(() => {
    let live = true
    const t = window.setTimeout(() => {
      if (!versionId) { setText(''); return }
      setText(null)
      fetchVersionText(versionId).then((body) => { if (live) setText(body) }).catch(() => { if (live) setText('') })
    }, 0)
    return () => { live = false; window.clearTimeout(t) }
  }, [versionId])

  const changed = useCallback(() => { void refresh(); onChanged?.() }, [refresh, onChanged])

  const doRecrawl = async () => {
    if (!detail) return
    setBusy('recrawl')
    const res = await recrawl(detail.source.id)
    setBusy(null)
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast('Recrawl queued — a new version appears only if the page changed.', 'success')
    changed()
  }

  const saveNotes = async () => {
    if (!detail) return
    setBusy('notes')
    const res = await updateSource(detail.source.id, { analyst_notes: notes.trim() || null })
    setBusy(null)
    if (!res.ok) { toast(res.message, 'danger'); return }
    setNotesDirty(false)
    toast('Notes saved.', 'success')
    changed()
  }

  const setClassification = async (value: string) => {
    if (!detail) return
    setBusy('class')
    const res = await updateSource(detail.source.id, { classification: value })
    setBusy(null)
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast('Classification updated.', 'success')
    changed()
  }

  const unlink = async (linkId: string, label: string) => {
    const ok = await uiConfirm(`Remove the link to ${label}? The record itself is untouched.`, { title: 'Unlink source', confirmText: 'Unlink' })
    if (!ok) return
    const res = await unlinkSource(linkId)
    if (!res.ok) { toast(res.message, 'danger'); return }
    toast('Link removed.', 'success')
    changed()
  }

  const selectedVersion = useMemo(() => detail?.versions.find((x) => x.id === versionId) ?? null, [detail, versionId])
  const latestId = detail?.versions[0]?.id ?? null

  if (error) return <ErrorNotice message={error} onRetry={() => void refresh()} />
  if (detail === undefined) return <DetailSkeleton />
  if (detail === null) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back to sources</Button>
        <EmptyState title="Source not available" hint="This source does not exist, was deleted, or belongs to a case you cannot read." />
      </div>
    )
  }

  const s = detail.source
  const href = safeUrl(s.url)
  const mayEdit = !!profile && (s.submitted_by === profile.id || isCommand)
  const verified = isVerified(s.verification_status)

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>← Back to sources</Button>

      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs text-slate-400" translate="no">{s.source_number}</p>
            <h3 className="mt-0.5 break-words text-base font-semibold tracking-tight text-white text-pretty">{s.title || s.domain}</h3>
            <p className="mt-1 break-all text-xs text-slate-400">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="text-badge-300 hover:underline" translate="no">{s.url}</a>
              ) : <span translate="no">{s.url}</span>}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={sourceStatusTone(s.status)}>{sourceStatusLabel(s.status)}</Badge>
              <Badge tone={verificationTone(s.verification_status)}>{verificationLabel(s.verification_status)}</Badge>
              <Badge tone={reliabilityTone(s.reliability)}>{reliabilityLabel(s.reliability)}</Badge>
              {s.classification && s.classification !== 'unclassified' && <Badge tone="warn">{s.classification}</Badge>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size={narrow ? 'md' : 'sm'} variant="primary" onClick={() => setDialog('verify')}>Verify…</Button>
            <Button size={narrow ? 'md' : 'sm'} variant="secondary" onClick={() => void doRecrawl()} loading={busy === 'recrawl'} disabled={s.status === 'fetching'}>Recrawl</Button>
            <Button size={narrow ? 'md' : 'sm'} variant="secondary" onClick={() => setDialog('link')}>Link to record…</Button>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 border-t border-white/5 pt-3 text-xs sm:grid-cols-3 lg:grid-cols-4">
          <Meta label="Domain"><span translate="no">{s.domain}</span></Meta>
          <Meta label="Retrieved">{s.retrieved_at ? fmtDateTime(s.retrieved_at) : 'Not yet'}</Meta>
          <Meta label="Last checked">{s.last_checked_at ? `${fmtDateTime(s.last_checked_at)} (${timeAgo(s.last_checked_at)})` : '—'}</Meta>
          <Meta label="HTTP status">{s.http_status ?? '—'}</Meta>
          <Meta label="Content type">{s.content_type ?? '—'}</Meta>
          <Meta label="Versions"><span className="tabular-nums">{s.version_count}</span></Meta>
          <Meta label="Submitted by">{officerName(s.submitted_by) ?? 'Unknown member'} · {fmtDateTime(s.created_at)}</Meta>
          {s.verified_at && <Meta label="Verified">{officerName(s.verified_by) ?? 'Unknown member'} · {fmtDateTime(s.verified_at)}</Meta>}
          {s.author && <Meta label="Author">{s.author}</Meta>}
          {s.published_at && <Meta label="Published">{fmtDateTime(s.published_at)}</Meta>}
          {s.case_id && (
            <Meta label="Case"><Link href={caseLink(s.case_id)} className="text-badge-300 hover:underline">Open case</Link></Meta>
          )}
        </dl>
      </Card>

      {!verified && (
        <div role="note" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <span className="font-semibold">UNVERIFIED INTELLIGENCE</span> — never treated as fact; nothing here updates registry records automatically.
        </div>
      )}
      {s.status === 'failed' && (
        <div role="status" className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-200">
          The last fetch failed{s.fetch_error ? `: ${s.fetch_error}` : '.'} Recrawl to try again.
        </div>
      )}
      {s.status === 'changed' && (
        <Notice text="SOURCE CHANGED — the page differs from the previous capture. Review the newest version." className="py-3 text-left" />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* Captured text */}
        <Card pad="sm" className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[13px] font-semibold text-white">
              {selectedVersion ? `Captured text — version ${selectedVersion.version_no}` : 'Captured text'}
            </h3>
            {selectedVersion && <span className="text-xs text-slate-400">{fmtDateTime(selectedVersion.retrieved_at)}</span>}
          </div>
          {text === null ? (
            <div role="status" aria-busy="true" className="space-y-2">
              <span className="sr-only">Loading text…</span>
              <Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /><Skeleton className="h-3 w-2/3" />
            </div>
          ) : !detail.versions.length ? (
            <EmptyState title="Nothing captured yet" hint={s.status === 'pending' || s.status === 'fetching' ? 'The crawler has not returned this page yet.' : 'No version has been stored for this source.'} />
          ) : !text.trim() ? (
            <p className="text-sm text-slate-400">No text was captured for this version.</p>
          ) : (
            <pre className="max-h-[32rem] overflow-y-auto overscroll-contain whitespace-pre-wrap break-words rounded-lg border border-white/5 bg-ink-950 p-3 font-mono text-xs leading-relaxed text-slate-200">{text}</pre>
          )}
        </Card>

        <div className="min-w-0 space-y-4">
          {/* Versions */}
          <Card pad="sm">
            <h3 className="mb-2 text-[13px] font-semibold text-white">Versions</h3>
            {detail.versions.length === 0 ? (
              <p className="text-sm text-slate-400">No versions yet.</p>
            ) : (
              <ul className="divide-y divide-white/5 rounded-lg border border-white/5">
                {detail.versions.map((ver) => (
                  <VersionRow key={ver.id} ver={ver} selected={ver.id === versionId} changedMarker={s.status === 'changed' && ver.id === latestId}
                    onSelect={() => setVersionId(ver.id)} narrow={narrow} />
                ))}
              </ul>
            )}
          </Card>

          {/* Links */}
          <Card pad="sm">
            <h3 className="mb-2 text-[13px] font-semibold text-white">Linked records</h3>
            {detail.links.length === 0 ? (
              <p className="text-sm text-slate-400">Not linked to any record yet. Use “Link to record…”.</p>
            ) : (
              <ul className="divide-y divide-white/5 rounded-lg border border-white/5">
                {detail.links.map((l) => {
                  const label = labels[l.ref_id] || 'Restricted record'
                  return (
                    <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <Badge tone="neutral" className="flex-shrink-0">{SOURCE_LINK_KIND_LABEL[l.kind as SourceLinkKind] ?? l.kind}</Badge>
                      <span className="min-w-0 flex-1 truncate text-slate-200" title={label}>{label}</span>
                      {l.note && <span className="hidden max-w-40 truncate text-xs text-slate-400 sm:inline" title={l.note}>{l.note}</span>}
                      <button
                        type="button"
                        aria-label={`Unlink ${label}`}
                        onClick={() => void unlink(l.id, label)}
                        className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg text-lg leading-none text-rose-300 transition hover:bg-white/5 hover:text-rose-200"
                      >
                        ×
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          {/* Notes + classification */}
          <Card pad="sm" className="space-y-3">
            <Field label="Analyst notes" hint={mayEdit ? undefined : 'Only the submitter or command can edit these.'}>
              {(fid) => (
                <Textarea id={fid} name="analyst_notes" rows={4} autoComplete="off" value={notes} disabled={!mayEdit}
                  onChange={(e) => { setNotes(e.target.value); setNotesDirty(true) }} placeholder="What this source tells us, and what it does not…" />
              )}
            </Field>
            {mayEdit && (
              <Button size="sm" variant="secondary" onClick={() => void saveNotes()} loading={busy === 'notes'} disabled={!notesDirty}>Save notes</Button>
            )}
            <Field label="Classification">
              {(fid) => (
                <Select id={fid} name="classification" value={s.classification} disabled={!mayEdit || busy === 'class'} onChange={(e) => void setClassification(e.target.value)}>
                  {SOURCE_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                  {!(SOURCE_CLASSIFICATIONS as readonly string[]).includes(s.classification) && <option value={s.classification}>{s.classification}</option>}
                </Select>
              )}
            </Field>
          </Card>
        </div>
      </div>

      {dialog === 'verify' && (
        <VerifySourceDialog open source={s} onClose={() => setDialog('none')} onVerified={() => { setDialog('none'); changed() }} />
      )}
      {dialog === 'link' && (
        <LinkSourceDialog open source={s} existing={detail.links} onClose={() => setDialog('none')} onLinked={() => { setDialog('none'); changed() }} />
      )}
    </div>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="truncate text-xs text-slate-300">{children}</dd>
    </div>
  )
}

function VersionRow({ ver, selected, changedMarker, onSelect, narrow }: {
  ver: SourceVersionLite
  selected: boolean
  changedMarker: boolean
  onSelect: () => void
  narrow: boolean
}) {
  const diff = parseDiffSummary(ver.diff_summary)
  return (
    <li>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={`flex w-full touch-manipulation flex-wrap items-center gap-x-2 gap-y-1 px-3 text-left text-xs transition hover:bg-white/5 ${narrow ? 'min-h-11 py-2' : 'min-h-9 py-1.5'} ${selected ? 'bg-white/5' : ''}`}
      >
        <span className="font-mono text-slate-200" translate="no">v{ver.version_no}</span>
        <span className="text-slate-400">{fmtDateTime(ver.retrieved_at)}</span>
        {ver.http_status != null && <span className="tabular-nums text-slate-400">HTTP {ver.http_status}</span>}
        {changedMarker && <Badge tone="warn">SOURCE CHANGED</Badge>}
        {diff && (
          <span className="flex flex-wrap gap-1" title={diffSummaryText(diff)}>
            <Badge tone="good">Added {diff.added}</Badge>
            <Badge tone="danger">Removed {diff.removed}</Badge>
            <Badge tone="warn">Modified {diff.modified}</Badge>
          </span>
        )}
        {!diff && ver.version_no === 1 && <Badge tone="neutral">First capture</Badge>}
      </button>
    </li>
  )
}
