import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
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
