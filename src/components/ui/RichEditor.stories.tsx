import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { EntitySuggestFn } from '@/components/entity/EntityPicker'
import type { MentionLabels } from '@/lib/mentions'
import { RichEditor } from './RichEditor'

/** Tiptap markdown editor behind the lazy ui/RichEditor wrapper — the story
 *  imports the wrapper (never RichEditorInner directly), so the whole @tiptap
 *  bundle stays in its own chunk here exactly as it does in the app. Value is
 *  initial-only: the editor mounts fresh per edit session, and onChange
 *  emits markdown. */
const meta = {
  title: 'UI/RichEditor',
  component: RichEditor,
} satisfies Meta<typeof RichEditor>

export default meta
// Stories own the value state (value is initial-only), so all are render-only.
type Story = StoryObj

const SAMPLE = `## Initial findings

Surveillance confirmed the **drop location** on Prosperity Street.

- CCTV pulled from the pawn shop
- Complainant interviewed
- Serial trace *pending*

> Note: keep the CI's identity out of this narrative.

1. Canvass the block
2. Cross-reference plate hits
`

function EditorDemo({ initial }: { initial: string }) {
  const [markdown, setMarkdown] = useState(initial)
  return (
    <div className="max-w-2xl space-y-3">
      <RichEditor value={initial} onChange={setMarkdown} />
      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer font-semibold">Markdown output</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-ink-900 p-3 whitespace-pre-wrap">
          {markdown}
        </pre>
      </details>
    </div>
  )
}

export const Default: Story = {
  render: () => <EditorDemo initial={SAMPLE} />,
}

export const EmptyDocument: Story = {
  render: () => <EditorDemo initial="" />,
}

export const CompactHeight: Story = {
  render: () => (
    <div className="max-w-2xl">
      <RichEditor value="Short note." onChange={() => {}} minHeight="8rem" />
    </div>
  ),
}

/** Narrative mentions (P5-05): `[kind:id]` tokens already in the text render
 *  as chips from the labels the caller holds (a token with no label shows
 *  "Restricted record" — the id is never shown); typing `@` at a word start
 *  or the toolbar "@" opens the EntityPicker. The suggest seam replaces
 *  `entity_suggest` so the story never touches the network. */
const P1 = '11111111-2222-4333-8444-555555555555'
const P2 = '22222222-2222-4333-8444-555555555555'
const V1 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const MENTION_SAMPLE = `Met [person:${P1}] near [vehicle:${V1}] at the drop.\n\nSecond subject [person:${P2}] was not identified.`
const fakeSuggest: EntitySuggestFn = async (kind, q) => [
  { id: P1, kind, label: `${q} Doe`, sublabel: 'exact match', score: 1, exact: true },
  { id: P2, kind, label: `${q}son, Ray`, sublabel: null, score: 0.5, exact: false },
]

function MentionDemo() {
  const [markdown, setMarkdown] = useState(MENTION_SAMPLE)
  const [labels, setLabels] = useState<MentionLabels>({ [`person:${P1}`]: 'John Doe', [`vehicle:${V1}`]: 'ABC123', [`person:${P2}`]: null })
  return (
    <div className="max-w-2xl space-y-3">
      <RichEditor
        value={MENTION_SAMPLE}
        onChange={setMarkdown}
        mentions={{ labels, suggest: fakeSuggest, onLabels: (l) => setLabels((prev) => ({ ...prev, ...l })) }}
      />
      <details className="text-xs text-slate-400" open>
        <summary className="cursor-pointer font-semibold">Markdown output (tokens, never labels)</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg border border-white/10 bg-ink-900 p-3 whitespace-pre-wrap">{markdown}</pre>
      </details>
    </div>
  )
}

export const WithMentions: Story = {
  render: () => <MentionDemo />,
}
