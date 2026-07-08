'use client'

/** User Guide — the docs/USER-GUIDE.md manual rendered in-app so new members
 *  can find it from the nav (Reference → User Guide). Static content, no data
 *  fetches; rendered through the same safe markdown engine as SOPs. */
import { renderMarkdown } from '@/lib/markdown'
import { USER_GUIDE_MD } from './guideContent'

export function GuideView() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
        <p className="t-readout mb-4 inline-flex items-center gap-2 rounded border border-blue-400/20 bg-blue-500/10 px-2 py-1 text-[10px] uppercase tracking-widest text-blue-200">
          <span className="t-dot t-dot-cyan" /> New member orientation
        </p>
        {renderMarkdown(USER_GUIDE_MD)}
      </div>
    </div>
  )
}
