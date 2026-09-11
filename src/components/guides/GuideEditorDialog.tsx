'use client'

/** The guide editor.
 *
 *  Two halves, because a guide has two: its **entry in the library** (title,
 *  address, category, audience, tags, review dates) and, for a guide written
 *  here rather than in the repository, its **sections**.
 *
 *  Three things this deliberately does:
 *
 *   · **Autosave with a visible state.** Saving / Saved / Save failed, said
 *     plainly. A save that fails says so rather than leaving the editor
 *     believing their work is stored.
 *   · **Conflict detection, not last-write-wins.** Every save carries the
 *     `updated_at` the editor last saw. If someone else saved in between, the
 *     server refuses and this shows the conflict — the other person's work is
 *     never silently overwritten.
 *   · **Refuses to publish an empty guide.** An empty guide is worse than no
 *     guide, because it looks like an answer.
 *
 *  Everything here is cosmetic authority: each action calls an RPC that
 *  re-checks server-side. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/toast'
import {
  GUIDE_AUDIENCES, GUIDE_AUDIENCE_LABEL, duplicateGuide, isArchived, isPublished,
  listGuideRevisions, listGuideSections, markGuideReviewed, removeGuideSection,
  reorderGuideSections, restoreGuideRevision, saveGuide, saveGuideSection, setGuidePublished,
  type GuideAudience, type GuideCategoryRow, type GuideRevisionRow, type GuideRow, type GuideSectionRow,
} from '@/lib/guides'
import { Button } from '@/components/ui/Button'
import { Collapsible } from '@/components/ui/Collapsible'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { SaveState } from '@/components/ui/SaveState'
import type { DraftSaveStatus } from '@/lib/userDrafts'
import { CHIP, CHIP_LOCKED, CHIP_NEUTRAL, SLAB, WARN } from './guideSurfaces'

export interface GuideEditorDialogProps {
  /** null creates a new guide. */
  guide: GuideRow | null
  categories: readonly GuideCategoryRow[]
  onClose: () => void
  onSaved: (slug?: string) => void | Promise<void>
  onArchive: (g: GuideRow, reason: string) => Promise<string | null>
}

export function GuideEditorDialog({ guide, categories, onClose, onSaved, onArchive }: GuideEditorDialogProps) {
  const isNew = guide === null
  const [slug, setSlug] = useState(guide?.slug ?? '')
  const [title, setTitle] = useState(guide?.title ?? '')
  const [summary, setSummary] = useState(guide?.summary ?? '')
  const [category, setCategory] = useState(guide?.category ?? categories[0]?.slug ?? 'portal')
  const [audience, setAudience] = useState<GuideAudience>((guide?.audience as GuideAudience) ?? 'all')
  const [tags, setTags] = useState((guide?.tags ?? []).join(', '))
  const [keywords, setKeywords] = useState(guide?.keywords ?? '')
  const [nextReview, setNextReview] = useState(guide?.next_review_at?.slice(0, 10) ?? '')
  const [state, setState] = useState<DraftSaveStatus>('idle')
  const [conflict, setConflict] = useState<string | null>(null)
  const [archiveReason, setArchiveReason] = useState('')

  const [sections, setSections] = useState<GuideSectionRow[]>([])
  const [revisions, setRevisions] = useState<GuideRevisionRow[]>([])
  const writable = !isNew && guide!.body_kind === 'sections'

  /** The version this editor is working from. Every save carries it, and a
   *  successful save advances it. */
  const seen = useRef<string | null>(guide?.updated_at ?? null)

  useEffect(() => {
    if (isNew || !guide) return
    let live = true
    void (async () => {
      const [secs, revs] = await Promise.all([
        listGuideSections(guide.id).catch((): GuideSectionRow[] => []),
        listGuideRevisions(guide.id).catch((): GuideRevisionRow[] => []),
      ])
      if (!live) return
      setSections(secs)
      setRevisions(revs)
    })()
    return () => { live = false }
  }, [isNew, guide])

  const saveMeta = useCallback(async (): Promise<boolean> => {
    setState('saving')
    setConflict(null)
    const res = await saveGuide({
      id: guide?.id ?? null,
      slug: slug.trim().toLowerCase(),
      title: title.trim(),
      summary: summary.trim(),
      category,
      audience,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      keywords: keywords.trim(),
      nextReviewAt: nextReview ? new Date(`${nextReview}T00:00:00Z`).toISOString() : null,
      bodyKind: isNew ? 'sections' : undefined,
      expectedUpdatedAt: seen.current,
    })
    if (res.ok) {
      seen.current = res.updatedAt
      setState('saved')
      return true
    }
    setState('error')
    if (res.code === 'conflict') {
      setConflict('Someone else saved this guide while you were editing. Close and reopen it to pick up their version — your text is still on screen, so copy anything you need first.')
    } else {
      toast(res.message, 'danger')
    }
    return false
  }, [guide, slug, title, summary, category, audience, tags, keywords, nextReview, isNew])

  // Autosave an existing guide a moment after typing stops. A new guide is
  // saved deliberately — an accidental half-typed address would claim a URL.
  useEffect(() => {
    if (isNew) return
    if (state === 'saving') return
    const t = setTimeout(() => { void saveMeta() }, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fields are the trigger; saveMeta closes over them.
  }, [slug, title, summary, category, audience, tags, keywords, nextReview])

  const addSection = async () => {
    if (!guide) return
    const res = await saveGuideSection({ guideId: guide.id, heading: 'New section', body: '' })
    if (!res.ok) { toast(res.message, 'danger'); return }
    setSections(await listGuideSections(guide.id))
  }

  const move = async (index: number, by: -1 | 1) => {
    if (!guide) return
    const next = [...sections]
    const to = index + by
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    setSections(next)
    if (!(await reorderGuideSections(guide.id, next.map((s) => s.id)))) {
      toast('The sections could not be reordered.', 'danger')
      setSections(await listGuideSections(guide.id))
    }
  }

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader title={isNew ? 'New guide' : `Edit — ${guide!.title}`} onClose={onClose} />
      <div className="flex max-h-[75dvh] flex-col gap-4 overflow-y-auto p-4">
        {conflict && <p className={`${WARN} px-3 py-2 text-sm`} role="alert">{conflict}</p>}

        {!isNew && (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${CHIP} ${CHIP_NEUTRAL}`}>{isPublished(guide!) ? 'Published' : 'Draft'}</span>
            {isArchived(guide!) && <span className={`${CHIP} ${CHIP_LOCKED}`}>Archived</span>}
            <span className={`${CHIP} ${CHIP_NEUTRAL}`}>
              {guide!.body_kind === 'module' ? 'Text from the repository' : 'Text written here'}
            </span>
            <SaveState status={state} className="ml-auto" />
          </div>
        )}

        {/* ---- the library entry ---- */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title">
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Address" hint="Lowercase words joined by hyphens. This becomes /guides/…">
            {(id) => <Input id={id} value={slug} onChange={(e) => setSlug(e.target.value)} />}
          </Field>
          <div className="sm:col-span-2">
            <Field label="Summary" hint="One sentence. It is the card’s subtitle and the search result’s.">
              {(id) => <Input id={id} value={summary} onChange={(e) => setSummary(e.target.value)} />}
            </Field>
          </div>
          <Field label="Category">
            {(id) => (
              <select
                id={id}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-200"
              >
                {categories.filter((c) => c.active || c.slug === category).map((c) => (
                  <option key={c.slug} value={c.slug}>{c.label}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Audience" hint="Anything beyond the first two is restricted: it does not appear for anyone else at all.">
            {(id) => (
              <select
                id={id}
                value={audience}
                onChange={(e) => setAudience(e.target.value as GuideAudience)}
                className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-200"
              >
                {GUIDE_AUDIENCES.map((a) => <option key={a} value={a}>{GUIDE_AUDIENCE_LABEL[a]}</option>)}
              </select>
            )}
          </Field>
          <Field label="Tags" hint="Comma separated.">
            {(id) => <Input id={id} value={tags} onChange={(e) => setTags(e.target.value)} />}
          </Field>
          <Field label="Extra search terms" hint="Synonyms and old screen names that are not in the text.">
            {(id) => <Input id={id} value={keywords} onChange={(e) => setKeywords(e.target.value)} />}
          </Field>
          <Field label="Review again by">
            {(id) => <Input id={id} type="date" value={nextReview} onChange={(e) => setNextReview(e.target.value)} />}
          </Field>
        </div>

        {isNew && (
          <div className="flex justify-end">
            <Button
              onAction={async () => { if (await saveMeta()) await onSaved() }}
              disabled={!slug.trim() || !title.trim()}
            >
              Create draft
            </Button>
          </div>
        )}

        {/* ---- the prose ---- */}
        {!isNew && guide!.body_kind === 'module' && (
          <p className={`${SLAB} px-3 py-2 text-sm text-slate-400`}>
            This guide’s text lives in the repository as a code-reviewed module (<code className="font-mono">{guide!.body_key}</code>).
            Change it there, in a pull request, and the diff is visible to reviewers. Everything above is editable here.
          </p>
        )}

        {writable && (
          <Collapsible title="Sections" hint="The guide’s text. Each section keeps a permanent link." headingLevel={3} defaultOpen>
            <div className="flex flex-col gap-2">
              {sections.map((s, i) => (
                <SectionEditor
                  key={s.id}
                  section={s}
                  first={i === 0}
                  last={i === sections.length - 1}
                  onMove={(by) => move(i, by)}
                  onChanged={async () => { if (guide) setSections(await listGuideSections(guide.id)) }}
                />
              ))}
              {!sections.length && (
                <p className={`${SLAB} px-3 py-4 text-center text-sm text-slate-400`}>
                  No sections yet. A guide needs at least one before it can be published.
                </p>
              )}
              <div><Button variant="ghost" size="sm" onAction={addSection}>Add section</Button></div>
            </div>
          </Collapsible>
        )}

        {/* ---- lifecycle ---- */}
        {!isNew && (
          <Collapsible title="Publishing and history" headingLevel={3}>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onAction={async () => {
                    const ok = await setGuidePublished(guide!.id, !isPublished(guide!))
                    if (!ok) toast('That could not be changed — a guide needs at least one section before publishing.', 'danger')
                    else await onSaved()
                  }}
                >
                  {isPublished(guide!) ? 'Unpublish' : 'Publish'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onAction={async () => {
                    const to = `${guide!.slug}-copy`
                    const res = await duplicateGuide(guide!.id, to, `${guide!.title} (copy)`)
                    if (!res.ok) toast(res.message, 'danger')
                    else await onSaved()
                  }}
                >
                  Duplicate as draft
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onAction={async () => {
                    if (await markGuideReviewed(guide!.id)) { toast('Marked as reviewed.', 'success'); await onSaved() }
                  }}
                >
                  Mark reviewed
                </Button>
              </div>

              <div className={`${SLAB} flex flex-wrap items-end gap-2 px-3 py-2`}>
                <div className="min-w-[12rem] flex-1">
                  <Field label={isArchived(guide!) ? 'Restore from the archive' : 'Archive this guide'} hint={isArchived(guide!) ? 'It returns to the library.' : 'It leaves everyone’s library but stays recoverable.'}>
                    {(id) => (
                      <Input
                        id={id}
                        value={archiveReason}
                        onChange={(e) => setArchiveReason(e.target.value)}
                        placeholder={isArchived(guide!) ? 'Optional note' : 'Why is it being archived?'}
                      />
                    )}
                  </Field>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!isArchived(guide!) && !archiveReason.trim()}
                  onAction={async () => {
                    const err = await onArchive(guide!, archiveReason.trim())
                    if (err) toast(err, 'danger')
                  }}
                >
                  {isArchived(guide!) ? 'Restore' : 'Archive'}
                </Button>
              </div>

              {revisions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Revisions</p>
                  <ul className="flex flex-col gap-1">
                    {revisions.slice(0, 10).map((r) => (
                      <li key={r.id} className={`${SLAB} flex flex-wrap items-center justify-between gap-2 px-3 py-2`}>
                        <span className="text-sm text-slate-200">
                          <span className="font-mono text-xs text-slate-500">#{r.revision_no}</span>{' '}
                          {r.summary ?? 'Saved'}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onAction={async () => {
                            if (await restoreGuideRevision(r.id)) { toast('Revision restored.', 'success'); await onSaved() }
                            else toast('That revision could not be restored.', 'danger')
                          }}
                        >
                          Restore
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-slate-500">
                    Restoring saves the current version first, so a restore can itself be undone.
                  </p>
                </div>
              )}
            </div>
          </Collapsible>
        )}
      </div>
    </Modal>
  )
}

/** One section, edited in place with its own save state and conflict check. */
function SectionEditor({
  section, first, last, onMove, onChanged,
}: {
  section: GuideSectionRow
  first: boolean
  last: boolean
  onMove: (by: -1 | 1) => void | Promise<void>
  onChanged: () => void | Promise<void>
}) {
  const [heading, setHeading] = useState(section.heading)
  const [body, setBody] = useState(section.body)
  const [state, setState] = useState<DraftSaveStatus>('idle')
  const seen = useRef(section.updated_at)
  const dirty = heading !== section.heading || body !== section.body

  const save = useCallback(async () => {
    setState('saving')
    const res = await saveGuideSection({
      guideId: section.guide_id,
      id: section.id,
      heading: heading.trim(),
      body,
      expectedUpdatedAt: seen.current,
    })
    if (res.ok) { seen.current = res.updatedAt; setState('saved'); await onChanged() }
    else {
      setState('error')
      toast(res.code === 'conflict'
        ? 'Someone else saved this section while you were editing it.'
        : res.message, 'danger')
    }
  }, [section, heading, body, onChanged])

  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => { void save() }, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- heading/body are the trigger.
  }, [heading, body])

  return (
    <div className={`${SLAB} flex flex-col gap-2 px-3 py-2`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[10rem] flex-1">
          <Field label="Heading">
            {(id) => <Input id={id} value={heading} onChange={(e) => setHeading(e.target.value)} />}
          </Field>
        </div>
        <span className={`${CHIP} ${CHIP_NEUTRAL}`} title="This section’s permanent link">#{section.anchor}</span>
        <Button variant="ghost" size="sm" disabled={first} onAction={() => onMove(-1)} aria-label="Move section up">↑</Button>
        <Button variant="ghost" size="sm" disabled={last} onAction={() => onMove(1)} aria-label="Move section down">↓</Button>
        <Button
          variant="ghost"
          size="sm"
          onAction={async () => {
            if (await removeGuideSection(section.id)) await onChanged()
            else toast('That section could not be removed.', 'danger')
          }}
        >
          Remove
        </Button>
      </div>
      <Field label="Text" hint="Plain text and simple markdown.">
        {(id) => <Textarea id={id} rows={6} value={body} onChange={(e) => setBody(e.target.value)} />}
      </Field>
      <SaveState status={state} className="self-end" />
    </div>
  )
}
