'use client'

/** The one renderer every written guide goes through.
 *
 *  Accessibility is solved here rather than per guide: real headings in order,
 *  real tables with scoped headers, list semantics for lists, a visible focus
 *  ring on every control, and status carried by words as well as colour. A
 *  table that would be cramped becomes one card per row below `sm` — the
 *  columns turn into labelled rows, so nothing is clipped and nothing has to
 *  scroll sideways on a phone.
 *
 *  Inline formatting is `**bold**` and `` `code` `` only, parsed here, so a
 *  guide's data never contains markup that could render as anything else. */
import { GuideSection } from './GuideParts'
import type { GuideImageRef } from './GuideParts'
import { GOLD_TEXT, SLAB, WARN } from './guideSurfaces'
import type { GuideBlock, GuideDoc, GuideDocSection } from './guideDoc'

/* ---- inline ------------------------------------------------------------- */

/** `**bold**` and `` `code` ``, and nothing else. Splitting on a single regex
 *  keeps the output a plain array of strings and elements — there is no path
 *  here that can emit raw HTML. */
export function inline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  return parts.filter(Boolean).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <b key={i} className="font-semibold text-slate-100">{p.slice(2, -2)}</b>
    }
    if (p.startsWith('`') && p.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em] text-slate-200">
          {p.slice(1, -1)}
        </code>
      )
    }
    return <span key={i}>{p}</span>
  })
}

/* ---- blocks -------------------------------------------------------------- */

function Table({ block }: { block: Extract<GuideBlock, { kind: 'table' }> }) {
  return (
    <div>
      {/* Wide screens: a real table, scrollable inside its own box rather than
          pushing the page sideways. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-sm">
          {block.caption && <caption className="pb-2 text-left text-xs text-slate-500">{block.caption}</caption>}
          <thead>
            <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wide text-slate-400">
              {block.head.map((h) => (
                <th key={h} scope="col" className="py-2 pr-3 font-semibold last:pr-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r, i) => (
              <tr key={i} className="border-b border-white/5 last:border-0">
                {r.map((cell, j) => (
                  <td key={j} className={`py-2 pr-3 align-top last:pr-0 ${j === 0 ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>
                    {inline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phones: one card per row, every cell labelled by its column. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {block.rows.map((r, i) => (
          <li key={i} className={`${SLAB} px-3 py-2`}>
            <p className="text-sm font-semibold text-slate-100">{inline(r[0] ?? '')}</p>
            <dl className="mt-1 flex flex-col gap-0.5">
              {r.slice(1).map((cell, j) => (
                <div key={j} className="flex flex-wrap gap-x-2 text-[13px]">
                  <dt className="text-slate-500">{block.head[j + 1]}</dt>
                  <dd className="text-slate-300">{inline(cell)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      {block.caption && <p className="mt-1 text-xs text-slate-500 sm:hidden">{block.caption}</p>}
    </div>
  )
}

function Block({ block, onOpen }: { block: GuideBlock; onOpen?: (to: string) => void }) {
  switch (block.kind) {
    case 'p':
      return <p className="text-sm leading-relaxed text-slate-300">{inline(block.text)}</p>
    case 'ul':
      return (
        <ul className="flex flex-col gap-1.5 text-sm leading-relaxed text-slate-300">
          {block.items.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className={`flex-shrink-0 ${GOLD_TEXT}`}>·</span>
              <span>{inline(t)}</span>
            </li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-relaxed text-slate-300 marker:font-semibold marker:text-amber-200/70">
          {block.items.map((t, i) => <li key={i}>{inline(t)}</li>)}
        </ol>
      )
    case 'steps':
      return (
        <ol className="flex flex-col gap-2">
          {block.items.map((s, i) => (
            <li key={i} className={`${SLAB} px-3 py-2`}>
              <p className="text-sm font-semibold text-slate-100">
                <span className={`mr-2 font-mono text-xs ${GOLD_TEXT}`}>{i + 1}</span>
                {inline(s.title)}
              </p>
              <p className="mt-0.5 text-sm leading-relaxed text-slate-300">{inline(s.text)}</p>
            </li>
          ))}
        </ol>
      )
    case 'table':
      return <Table block={block} />
    case 'facts':
      return (
        <dl className="grid gap-2 sm:grid-cols-2">
          {block.rows.map((r) => (
            <div key={r.label} className={`${SLAB} px-3 py-2`}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{r.label}</dt>
              <dd className="mt-0.5 text-sm text-slate-200">{inline(r.value)}</dd>
            </div>
          ))}
        </dl>
      )
    case 'note':
      return block.tone === 'warn'
        ? (
          <p className={`${WARN} px-3 py-2 text-sm leading-relaxed`}>
            <span className="font-semibold">Note — </span>{inline(block.text)}
          </p>
        )
        : (
          <p className={`${SLAB} px-3 py-2 text-sm leading-relaxed text-slate-400`}>{inline(block.text)}</p>
        )
    case 'links':
      return (
        <ul className="flex flex-wrap gap-2">
          {block.items.map((l) => (
            <li key={l.to}>
              <button
                type="button"
                onClick={() => onOpen?.(l.to)}
                className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-1.5 text-left text-xs font-semibold text-amber-100 transition hover:bg-amber-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
              >
                {l.label}
                {l.hint && <span className="ml-1.5 font-normal text-amber-200/70">{l.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )
  }
}

/* ---- the document -------------------------------------------------------- */

export interface GuideDocViewProps {
  doc: GuideDoc
  /** Section anchors the in-guide search currently matches. */
  shown: ReadonlySet<string>
  /** The images an editor attached to one section — usually none. */
  imagesFor: (anchor: string) => GuideImageRef[]
  /** Navigate to a portal screen or another guide (the `links` block). */
  onOpen?: (to: string) => void
  /** Right-aligned content in each section heading — the copy-link control. */
  sectionMeta?: (section: GuideDocSection) => React.ReactNode
}

export function GuideDocView({ doc, shown, imagesFor, onOpen, sectionMeta }: GuideDocViewProps) {
  return (
    <>
      {doc.sections.filter((s) => shown.has(s.anchor)).map((s) => (
        <GuideSection
          key={s.anchor}
          id={s.anchor}
          title={s.heading}
          subtitle={s.blurb}
          meta={sectionMeta?.(s)}
          images={imagesFor(s.anchor)}
        >
          {s.blocks.map((b, i) => <Block key={i} block={b} onOpen={onOpen} />)}
        </GuideSection>
      ))}
    </>
  )
}
