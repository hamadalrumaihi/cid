'use client'

/** The library's back room: the feedback queue and the category vocabulary.
 *
 *  Two jobs that belong to whoever keeps the guides, and to nobody else:
 *
 *  · The QUEUE. "Was this guide helpful?", a broken link, an out-of-date note
 *    and a suggestion all land here rather than in anyone's notifications. A
 *    guide's owners work through a list; readers are not pinging people.
 *
 *  · The CATEGORIES. Categories are rows, not a constant in the build, so the
 *    library can be reorganized without a deploy. Retiring one hides it from
 *    the filters and leaves every guide filed under it readable — a category
 *    is a shelf, and taking the shelf away must not take the books.
 *
 *  Both call RPCs that re-check the authority server-side. The panel renders
 *  only for an editor, and that is cosmetic, as always. */
import { useCallback, useEffect, useState } from 'react'
import { fmtDateTime } from '@/lib/format'
import { toast } from '@/lib/toast'
import {
  listGuideCategories, listGuideFeedback, resolveGuideFeedback, saveGuideCategory,
  type GuideCategoryRow, type GuideFeedbackRow, type GuideRow,
} from '@/lib/guides'
import { Button } from '@/components/ui/Button'
import { Collapsible } from '@/components/ui/Collapsible'
import { Field, Input } from '@/components/ui/Field'
import { EmptyState, ErrorNotice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { CHIP, CHIP_DONE, CHIP_LOCKED, CHIP_NEUTRAL, GOLD_TEXT, PANEL, SLAB } from './guideSurfaces'

const KIND_LABEL: Record<string, string> = {
  helpful: 'Was this helpful?',
  broken_link: 'Broken link',
  outdated: 'Out of date',
  suggestion: 'Suggestion',
}

const RATING_LABEL: Record<string, string> = { yes: 'Yes', partly: 'Partly', no: 'No' }

const STATUS_LABEL: Record<string, string> = {
  new: 'New', reviewing: 'Being looked at', resolved: 'Resolved', declined: 'Declined',
}

/** Open work first, then most recent. A settled row stays readable — the queue
 *  is a record of what was raised, not only of what is left. */
const OPEN = new Set(['new', 'reviewing'])

export interface GuideAdminPanelProps {
  /** The guides the caller can see, for naming the guide a row is about. */
  guides: readonly GuideRow[]
  /** Called after a category changes, so the library reloads its filters. */
  onCategoriesChanged: () => void
}

export function GuideAdminPanel({ guides, onCategoriesChanged }: GuideAdminPanelProps) {
  const [feedback, setFeedback] = useState<GuideFeedbackRow[]>([])
  const [cats, setCats] = useState<GuideCategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [newSlug, setNewSlug] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [f, c] = await Promise.all([listGuideFeedback(), listGuideCategories()])
      setFeedback(f)
      setCats(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Deferred past the effect body so the first setState is not synchronous
  // with the render — the usePermissions idiom.
  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  const titleOf = (id: string) => guides.find((g) => g.id === id)?.title ?? 'A guide'

  const settle = async (row: GuideFeedbackRow, status: string) => {
    setBusy(row.id)
    const ok = await resolveGuideFeedback(row.id, status)
    setBusy(null)
    if (!ok) { toast('That could not be saved.', 'danger'); return }
    await load()
  }

  const toggleCategory = async (c: GuideCategoryRow) => {
    setBusy(c.slug)
    const err = await saveGuideCategory({ slug: c.slug, active: !c.active })
    setBusy(null)
    if (err) { toast(`That could not be saved — ${err}`, 'danger'); return }
    await load()
    onCategoriesChanged()
  }

  const addCategory = async () => {
    const slug = newSlug.trim().toLowerCase()
    const label = newLabel.trim()
    if (!slug || !label) return
    setBusy('new')
    const err = await saveGuideCategory({
      slug, label, sortOrder: cats.reduce((n, c) => Math.max(n, c.sort_order + 10), 100),
    })
    setBusy(null)
    if (err) { toast(`That could not be saved — ${err}`, 'danger'); return }
    setNewSlug('')
    setNewLabel('')
    await load()
    onCategoriesChanged()
  }

  const open = feedback.filter((f) => OPEN.has(f.status))
  const settled = feedback.filter((f) => !OPEN.has(f.status))

  const Row = ({ row }: { row: GuideFeedbackRow }) => (
    <li className={`${SLAB} flex flex-col gap-2 px-3 py-2`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`${CHIP} ${CHIP_NEUTRAL}`}>{KIND_LABEL[row.kind] ?? row.kind}</span>
        {row.rating && (
          <span className={`${CHIP} ${row.rating === 'no' ? CHIP_LOCKED : CHIP_NEUTRAL}`}>
            {RATING_LABEL[row.rating] ?? row.rating}
          </span>
        )}
        <span className={`${CHIP} ${OPEN.has(row.status) ? CHIP_NEUTRAL : CHIP_DONE}`}>
          {STATUS_LABEL[row.status] ?? row.status}
        </span>
        <span className={`text-sm font-semibold ${GOLD_TEXT}`}>{titleOf(row.guide_id)}</span>
        {row.anchor && <span className="text-[11px] text-slate-500">#{row.anchor}</span>}
      </div>
      {row.comment && <p className="text-sm text-slate-300">{row.comment}</p>}
      <p className="text-[11px] text-slate-500">
        <time dateTime={row.created_at}>{fmtDateTime(row.created_at)}</time>
      </p>
      {OPEN.has(row.status) && (
        <div className="flex flex-wrap gap-2">
          {row.status === 'new' && (
            <Button variant="ghost" size="sm" loading={busy === row.id} onAction={() => settle(row, 'reviewing')}>
              Looking at it
            </Button>
          )}
          <Button variant="ghost" size="sm" loading={busy === row.id} onAction={() => settle(row, 'resolved')}>
            Resolved
          </Button>
          <Button variant="ghost" size="sm" loading={busy === row.id} onAction={() => settle(row, 'declined')}>
            No change needed
          </Button>
        </div>
      )}
    </li>
  )

  return (
    <section className={`${PANEL} flex flex-col gap-4 p-4 sm:p-6`}>
      <h2 className={`text-sm font-black uppercase tracking-[0.2em] ${GOLD_TEXT}`}>Library administration</h2>

      {loading && <><Skeleton className="h-4 w-40" /><Skeleton className="h-20 w-full" /></>}
      {!loading && error && <ErrorNotice message={error} onRetry={() => { void load() }} />}

      {!loading && !error && (
        <>
          <Collapsible
            title="Reader feedback"
            hint="Answers and reports from the guides themselves"
            meta={`${open.length} open`}
            headingLevel={3}
            defaultOpen={open.length > 0}
          >
            {feedback.length === 0 ? (
              <EmptyState
                title="Nothing has been sent yet"
                hint="Answers to “Was this guide helpful?”, broken links and suggestions arrive here."
              />
            ) : (
              <div className="flex flex-col gap-3">
                <ul className="flex flex-col gap-2">
                  {open.map((row) => <Row key={row.id} row={row} />)}
                </ul>
                {settled.length > 0 && (
                  <Collapsible title="Settled" meta={`${settled.length}`} headingLevel={4}>
                    <ul className="flex flex-col gap-2">
                      {settled.map((row) => <Row key={row.id} row={row} />)}
                    </ul>
                  </Collapsible>
                )}
              </div>
            )}
          </Collapsible>

          <Collapsible
            title="Categories"
            hint="The shelves guides are filed on — edited here, not in the build"
            meta={`${cats.filter((c) => c.active).length} in use`}
            headingLevel={3}
          >
            <div className="flex flex-col gap-3">
              <ul className="flex flex-col gap-2">
                {cats.map((c) => (
                  <li key={c.slug} className={`${SLAB} flex flex-wrap items-center gap-2 px-3 py-2`}>
                    <span className="text-sm text-slate-200">{c.label}</span>
                    <span className="text-[11px] text-slate-500">{c.slug}</span>
                    <span className={`${CHIP} ${c.active ? CHIP_DONE : CHIP_NEUTRAL}`}>
                      {c.active ? 'In use' : 'Retired'}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-[11px] text-slate-500">
                        {guides.filter((g) => g.category === c.slug).length} guides
                      </span>
                      <Button variant="ghost" size="sm" loading={busy === c.slug} onAction={() => toggleCategory(c)}>
                        {c.active ? 'Retire' : 'Put back'}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-slate-500">
                Retiring a category takes it out of the filters. Guides filed under it stay readable
                and keep their category — nothing is moved and nothing is hidden.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[10rem] flex-1">
                  <Field label="New category — address" hint="Lowercase words joined by hyphens">
                    {(id) => (
                      <Input
                        id={id}
                        value={newSlug}
                        onChange={(e) => setNewSlug(e.target.value)}
                        placeholder="field-craft"
                      />
                    )}
                  </Field>
                </div>
                <div className="min-w-[10rem] flex-1">
                  <Field label="Name">
                    {(id) => (
                      <Input
                        id={id}
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="Field Craft"
                      />
                    )}
                  </Field>
                </div>
                <Button
                  size="sm"
                  loading={busy === 'new'}
                  disabled={!newSlug.trim() || !newLabel.trim()}
                  onAction={addCategory}
                >
                  Add category
                </Button>
              </div>
            </div>
          </Collapsible>
        </>
      )}
    </section>
  )
}
