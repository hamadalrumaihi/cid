'use client'

/** What else a reader needs, at the foot of a document.
 *
 *  Three relationships exist in the data and each answers a different
 *  question, so each gets its own labelled lane rather than one undifferentiated
 *  "you might also like" list:
 *
 *   · FORMS AND TEMPLATES — documents that name this one as the policy
 *     governing them (`related_policy`). A procedure that requires a form
 *     should say which form; before this the link ran only the other way.
 *   · REPLACES — what this document superseded. Kept so "what did the rules
 *     used to say" stays answerable.
 *   · SAME CATEGORY — the weakest relationship, and last, because it is a
 *     suggestion rather than a dependency.
 *
 *  A lane with nothing in it does not render, and the whole section
 *  disappears when no relationship exists. Nothing here invents a
 *  relationship: every row comes from a column somebody filled in.
 *
 *  Every document named here came out of the same RLS-filtered list the
 *  library itself reads, so a document this reader may not open cannot be
 *  named — not as a title, and not as a dead link. */
import { useRouter } from 'next/navigation'
import { guideDocFamily, guideDocTypeLabel, type GuideRow } from '@/lib/guides'
import { CHIP, CHIP_FORM, CHIP_TYPE, GOLD_TEXT, PANEL, SLAB } from './guideSurfaces'

export interface RelatedDocumentsProps {
  /** Documents this one governs (their `related_policy` points here). */
  governs: readonly GuideRow[]
  /** Documents this one replaced (their `superseded_by` points here). */
  supersedes: readonly GuideRow[]
  /** Same category, current, at most four. */
  sameCategory: readonly GuideRow[]
}

export function RelatedDocuments({ governs, supersedes, sameCategory }: RelatedDocumentsProps) {
  const router = useRouter()
  const lanes = [
    { id: 'forms', label: 'Forms and templates', hint: 'Filled in under this document.', rows: governs },
    { id: 'replaces', label: 'Replaces', hint: 'Kept as the record of the earlier rules.', rows: supersedes },
    { id: 'category', label: 'Same category', hint: undefined, rows: sameCategory },
  ].filter((l) => l.rows.length > 0)

  if (!lanes.length) return null

  return (
    <section aria-labelledby="related-docs" className={`${PANEL} flex flex-col gap-5 p-4 sm:p-6`}>
      <h2 id="related-docs" className={`text-sm font-black uppercase tracking-[0.2em] ${GOLD_TEXT}`}>
        Related documents
      </h2>

      {lanes.map((lane) => (
        <div key={lane.id} className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {lane.label}
            {lane.hint && <span className="ml-2 font-normal normal-case tracking-normal">{lane.hint}</span>}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {lane.rows.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/guides/${g.slug}`)}
                  className={`${SLAB} w-full px-3 py-2 text-left transition hover:border-white/20 hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`break-words text-sm font-semibold ${GOLD_TEXT}`}>{g.title}</span>
                    <span className={`${CHIP} ${guideDocFamily(g.doc_type) === 'form' ? CHIP_FORM : CHIP_TYPE}`}>
                      {guideDocTypeLabel(g.doc_type)}
                    </span>
                  </span>
                  {g.summary && <span className="mt-0.5 block text-xs text-slate-400">{g.summary}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
