'use client'

/** One header for every document in the library.
 *
 *  An SOP, a procedure, a form and a how-to guide all answer the same
 *  questions about themselves — what am I, what am I about, who may read me,
 *  am I still in force, which version, who issued me, when did it change —
 *  and before this they answered them in different places or not at all. A
 *  reader who has learned to read one document has learned to read all of
 *  them.
 *
 *  ── Rendered from what exists, never from placeholders ───────────────────
 *  A how-to guide has no issuing authority and no version, and a row of empty
 *  labels is worse than no row: it reads as missing data rather than as data
 *  that does not apply. Each field appears only when the document carries it,
 *  and the metadata strip disappears entirely when none of them do.
 *
 *  ── Four badges, four different questions ────────────────────────────────
 *  TYPE (what it is) · CATEGORY (what it is about) · ACCESS (who may read it)
 *  · STATUS (whether it is current). They were one `folder` string in the old
 *  library, which is exactly why a form about undercover work had nowhere to
 *  say it was about undercover work. Keeping them visually distinct is the
 *  point, not decoration. */
import type { ReactNode } from 'react'
import { fmtDate } from '@/lib/format'
import {
  guideAudienceLabel, guideClassification, guideDocFamily, guideDocTypeLabel, guideStatusLabel,
  guideStatusOf, isRestrictedAudience, type GuideRow,
} from '@/lib/guides'
import { ClassificationStrip } from './DocCallout'
import {
  CHIP, CHIP_DONE, CHIP_FORM, CHIP_LOCKED, CHIP_NEUTRAL, CHIP_TYPE, CHIP_WARN, SLAB,
} from './guideSurfaces'

export interface DocumentHeaderProps {
  row: GuideRow
  categoryLabel: string
  /** Breadcrumbs / actions the page wants in the header's top row. */
  actions?: ReactNode
  /** Reading estimate, when the page has computed one. */
  readMinutes?: number | null
}

/** The status chip's tone: current is a quiet confirmation (green — in
 *  force), and every other status is amber, because draft, superseded and
 *  archived all mean the same thing to a reader about to act — this is not
 *  the rule. Red stays with the classification chip: a rose status badge
 *  beside a title is read as "restricted", which is a different claim. */
function statusTone(row: GuideRow): string {
  return guideStatusOf(row) === 'published' ? CHIP_DONE : CHIP_WARN
}

export function DocumentHeader({ row, categoryLabel, actions, readMinutes }: DocumentHeaderProps) {
  const classification = guideClassification(row.audience)
  const restricted = isRestrictedAudience(row.audience) || !!classification
  const hasMeta = !!(row.issuing_authority || row.effective_date || row.version_label || row.updated_at)

  return (
    <header className="flex flex-col gap-4">
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}

      {/* The classification, once, above everything — where a reader starts,
          and before any of the prose they might otherwise quote. */}
      {classification && (
        <ClassificationStrip
          text={classification}
          detail="Do not distribute outside the authorized audience."
        />
      )}

      <div className="flex flex-col gap-2">
        <h1 className="break-words text-2xl font-bold tracking-tight text-white sm:text-3xl">{row.title}</h1>
        {row.summary && (
          <p className="max-w-[60ch] text-sm leading-relaxed text-slate-400">{row.summary}</p>
        )}
      </div>

      {/* Four badges, four questions. Type leads because it is what a reader
          scanning for "the form" is matching on. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`${CHIP} ${guideDocFamily(row.doc_type) === 'form' ? CHIP_FORM : CHIP_TYPE}`}>
          {guideDocTypeLabel(row.doc_type)}
        </span>
        <span className={`${CHIP} ${CHIP_NEUTRAL}`}>{categoryLabel}</span>
        {/* Access is always stated, even when it is "everyone". A badge row
            where the fourth question is sometimes missing teaches a reader
            that its absence means nothing in particular — and then a document
            with no classification and one with an unrendered one look alike. */}
        <span
          className={`${CHIP} ${restricted ? CHIP_LOCKED : CHIP_NEUTRAL}`}
          title={restricted ? 'Restricted distribution — this document does not leave its audience.' : undefined}
        >
          {guideAudienceLabel(row.audience)}
        </span>
        <span className={`${CHIP} ${statusTone(row)}`}>{guideStatusLabel(row)}</span>
        {row.pinned && <span className={`${CHIP} ${CHIP_NEUTRAL}`}>Pinned</span>}
      </div>

      {/* Metadata: present, compact, and out of the way. A document's
          provenance matters when a reader goes looking for it and should not
          cost a screen before the first sentence. */}
      {hasMeta && (
        <dl className={`${SLAB} grid gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-4`}>
          {row.issuing_authority && <Field label="Issuing authority">{row.issuing_authority}</Field>}
          {row.version_label && <Field label="Version">{row.version_label}</Field>}
          {row.effective_date && <Field label="Effective">{fmtDate(row.effective_date)}</Field>}
          <Field label="Last updated">
            {fmtDate(row.updated_at)}
            {readMinutes ? <span className="text-slate-500"> · ~{readMinutes} min read</span> : null}
          </Field>
        </dl>
      )}
    </header>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-slate-200" title={typeof children === 'string' ? children : undefined}>
        {children}
      </dd>
    </div>
  )
}
