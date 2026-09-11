'use client'

/** Adding, captioning, reordering and removing a guide's imagery.
 *
 *  Shown only to the people who may edit guides, and only ever as an addition
 *  to the page — the guide reads exactly the same with this panel closed, with
 *  no images at all, and for every reader who is not an editor. That is the
 *  point: written content and imagery are independent, so removing every image
 *  changes nothing else on the page.
 *
 *  The controls are cosmetic. Every action here calls an RPC that re-checks the
 *  authority server-side, and the bucket refuses an object that no guide_media
 *  row already claims. */
import { useState } from 'react'
import { toast } from '@/lib/toast'
import {
  GUIDE_IMAGE_TYPES, addGuideImage, removeGuideImage, reorderGuideImages, updateGuideImage,
  validateGuideImage, type GuideMediaRow,
} from '@/lib/guides'
import { Button } from '@/components/ui/Button'
import { Collapsible } from '@/components/ui/Collapsible'
import { Field, Input } from '@/components/ui/Field'
import { CHIP, CHIP_NEUTRAL, SLAB } from './guideSurfaces'

export interface GuideMediaSlot {
  /** A section id, or null for the guide's cover. */
  section: string | null
  label: string
}

export interface GuideMediaManagerProps {
  guideId: string
  media: readonly GuideMediaRow[]
  slots: readonly GuideMediaSlot[]
  /** Re-read the guide's imagery after a change. */
  onChanged: () => Promise<void> | void
}

/** One slot's images, with the controls that act on them. */
function SlotRows({
  guideId, section, rows, onChanged,
}: { guideId: string; section: string | null; rows: GuideMediaRow[]; onChanged: () => Promise<void> | void }) {
  const move = async (index: number, by: -1 | 1) => {
    const next = [...rows]
    const to = index + by
    if (to < 0 || to >= next.length) return
    ;[next[index], next[to]] = [next[to], next[index]]
    if (await reorderGuideImages(guideId, next.map((r) => r.id), section)) await onChanged()
    else toast('The images could not be reordered.', 'danger')
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((m, i) => (
        <li key={m.id} className={`${SLAB} flex flex-col gap-2 px-3 py-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm text-slate-200">{m.alt}</span>
            <div className="flex flex-shrink-0 items-center gap-1">
              <Button variant="ghost" size="sm" disabled={i === 0} onAction={() => move(i, -1)} aria-label="Move up">↑</Button>
              <Button variant="ghost" size="sm" disabled={i === rows.length - 1} onAction={() => move(i, 1)} aria-label="Move down">↓</Button>
              <Button
                variant="ghost"
                size="sm"
                onAction={async () => {
                  if (await removeGuideImage(m.id)) await onChanged()
                  else toast('The image could not be removed.', 'danger')
                }}
              >
                Remove
              </Button>
            </div>
          </div>
          <EditCaption row={m} onChanged={onChanged} />
        </li>
      ))}
    </ul>
  )
}

/** Alternative text and caption, edited in place. Alternative text is required
 *  — an image nobody can read is not an improvement to a reference document. */
function EditCaption({ row, onChanged }: { row: GuideMediaRow; onChanged: () => Promise<void> | void }) {
  const [alt, setAlt] = useState(row.alt)
  const [caption, setCaption] = useState(row.caption ?? '')
  const dirty = alt !== row.alt || caption !== (row.caption ?? '')

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[10rem] flex-1">
        <Field label="What the image shows">
          {(id) => <Input id={id} value={alt} onChange={(e) => setAlt(e.target.value)} />}
        </Field>
      </div>
      <div className="min-w-[10rem] flex-1">
        <Field label="Caption (optional)">
          {(id) => <Input id={id} value={caption} onChange={(e) => setCaption(e.target.value)} />}
        </Field>
      </div>
      <Button
        size="sm"
        disabled={!dirty || !alt.trim()}
        onAction={async () => {
          if (await updateGuideImage(row.id, alt.trim(), caption.trim() || null)) await onChanged()
          else toast('The image could not be updated.', 'danger')
        }}
      >
        Save
      </Button>
    </div>
  )
}

export function GuideMediaManager({ guideId, media, slots, onChanged }: GuideMediaManagerProps) {
  const [section, setSection] = useState<string | null>(slots[0]?.section ?? null)
  const [alt, setAlt] = useState('')
  const [caption, setCaption] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  const rowsFor = (s: string | null) =>
    media.filter((m) => m.section === s).sort((a, b) => a.sort_order - b.sort_order)

  const add = async () => {
    if (!file || !alt.trim()) return
    const bad = validateGuideImage(file)
    if (bad) { toast(bad, 'danger'); return }
    setBusy(true)
    const err = await addGuideImage({
      guideId, section, alt: alt.trim(), caption: caption.trim() || undefined, file,
    })
    setBusy(false)
    if (err) { toast(err, 'danger'); return }
    setAlt(''); setCaption(''); setFile(null)
    await onChanged()
    toast('Image added.', 'success')
  }

  return (
    <Collapsible
      title="Guide images"
      hint="Optional. The guide reads exactly the same without them."
      headingLevel={2}
      meta={<span className={`${CHIP} ${CHIP_NEUTRAL}`}>{media.length} image{media.length === 1 ? '' : 's'}</span>}
    >
      <div className="flex flex-col gap-4">
        <div className={`${SLAB} flex flex-col gap-2 p-3`}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[10rem] flex-1">
              <Field label="Where it goes">
                {(id) => (
                  <select
                    id={id}
                    value={section ?? ''}
                    onChange={(e) => setSection(e.target.value || null)}
                    className="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-slate-200"
                  >
                    {slots.map((s) => (
                      <option key={s.section ?? 'cover'} value={s.section ?? ''}>{s.label}</option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <div className="min-w-[10rem] flex-1">
              <Field label="What the image shows" hint="Required — this is what a reader who cannot see it gets.">
                {(id) => <Input id={id} value={alt} onChange={(e) => setAlt(e.target.value)} />}
              </Field>
            </div>
            <div className="min-w-[10rem] flex-1">
              <Field label="Caption (optional)">
                {(id) => <Input id={id} value={caption} onChange={(e) => setCaption(e.target.value)} />}
              </Field>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept={GUIDE_IMAGE_TYPES.join(',')}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-xs text-slate-300 file:mr-3 file:rounded-lg file:border file:border-white/10 file:bg-white/5 file:px-3 file:py-1.5 file:text-xs file:text-slate-200"
            />
            <Button size="sm" loading={busy} disabled={!file || !alt.trim()} onAction={add}>Add image</Button>
          </div>
          <p className="text-[11px] text-slate-500">PNG, JPEG, WebP or GIF, up to 10 MB.</p>
        </div>

        {slots.map((s) => {
          const rows = rowsFor(s.section)
          if (!rows.length) return null
          return (
            <div key={s.section ?? 'cover'} className="flex flex-col gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s.label}</h3>
              <SlotRows guideId={guideId} section={s.section} rows={rows} onChanged={onChanged} />
            </div>
          )
        })}
      </div>
    </Collapsible>
  )
}
