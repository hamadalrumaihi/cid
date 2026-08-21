'use client'

/** Ask the library.
 *
 *  Every answer is a real section of a real document, quoted from the database
 *  and cited with its version and effective date. Nothing here writes a
 *  sentence, so nothing here can invent a legal requirement — and no document
 *  text is sent anywhere, because there is nowhere to send it.
 *
 *  Two kinds of result, kept visibly apart: sections that contain everything
 *  asked about, and sections that mention some of it. A tool that presented
 *  both with the same confidence would be worse than no tool, because the
 *  reader would stop checking.
 */

import { useState } from 'react'
import { citation, highlightRuns, type SectionHit } from '@/lib/docSections'
import { NO_ANSWER, askLibrary, noAnswerText, type LibraryAnswer } from '@/lib/docAssistant'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

function Hit({ h, onOpen }: { h: SectionHit; onOpen: (h: SectionHit) => void }) {
  return (
    <li className="rounded-xl border border-white/10 bg-ink-900 p-3">
      <button
        type="button"
        onClick={() => onOpen(h)}
        className="min-h-[44px] w-full rounded text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-badge-500"
      >
        <span className="block text-sm font-semibold text-white">{h.heading}</span>
        {h.headline && (
          <span className="mt-1 block text-xs leading-relaxed text-slate-300">
            {highlightRuns(h.headline).map((part, i) => (
              i % 2 === 1
                ? <mark key={i} className="rounded bg-badge-500/25 px-0.5 text-badge-100">{part}</mark>
                : <span key={i}>{part}</span>
            ))}
          </span>
        )}
        {/* The citation is the point. A quotation with no document, version or
            date behind it is not something anybody can check. */}
        <span className="mt-1.5 block text-[11px] text-slate-500">{citation(h)}</span>
      </button>
    </li>
  )
}

export function AskLibrary({ onOpenSection }: {
  onOpenSection: (documentId: string, anchor: string) => void
}) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<LibraryAnswer | null>(null)
  const [busy, setBusy] = useState(false)

  const ask = async () => {
    if (!question.trim()) return
    setBusy(true)
    setAnswer(await askLibrary(question).catch(() => NO_ANSWER))
    setBusy(false)
  }

  const open = (h: SectionHit) => onOpenSection(h.document_id, h.anchor)

  return (
    <Card>
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
        Ask the library
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Answers are passages from documents you can open, quoted as written and
        cited with their version. It finds where something is written; it does not
        interpret it, and it never writes an answer of its own.
      </p>

      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => { e.preventDefault(); void ask() }}
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What evidence is required for a search warrant?"
          aria-label="Ask the document library a question"
          className="min-w-[14rem] flex-1 rounded-lg border border-white/10 bg-ink-850 px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-badge-500"
        />
        <Button variant="primary" disabled={!question.trim() || busy}>
          {busy ? 'Searching…' : 'Ask'}
        </Button>
      </form>

      {answer && (
        <div className="mt-4 space-y-4">
          {answer.direct.length > 0 && (
            <section>
              <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                In the documents
                <Badge tone="good">{answer.direct.length}</Badge>
              </h4>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Sections containing everything you asked about.
              </p>
              <ul className="mt-2 space-y-2">
                {answer.direct.map((h) => (
                  <Hit key={`${h.document_id}#${h.anchor}`} h={h} onOpen={open} />
                ))}
              </ul>
            </section>
          )}

          {answer.possible.length > 0 && (
            <section>
              <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-300">
                Possibly relevant
                <Badge tone="warn">{answer.possible.length}</Badge>
              </h4>
              <p className="mt-0.5 text-[11px] text-slate-500">
                These mention some of what you asked, not all of it. Read them and
                judge — this is not an answer.
              </p>
              <ul className="mt-2 space-y-2">
                {answer.possible.map((h) => (
                  <Hit key={`${h.document_id}#${h.anchor}`} h={h} onOpen={open} />
                ))}
              </ul>
            </section>
          )}

          {!answer.answered && (
            <div className="rounded-xl border border-white/10 bg-ink-950/50 p-3">
              <p className="text-sm font-semibold text-slate-200">No confirmed answer found</p>
              <p className="mt-1 text-xs text-slate-400">{noAnswerText(answer.terms)}</p>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
