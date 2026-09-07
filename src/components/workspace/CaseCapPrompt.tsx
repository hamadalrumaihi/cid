'use client'

/** The 8-case cap prompt: opening a ninth distinct case asks which open case
 *  to close first (plan §17 — "the 9th prompts to close one"). Tool and
 *  record tabs do not count and are not listed. Cancel leaves everything
 *  as it was. */
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { CaseIcon } from '@/components/shell/icons'
import { CASE_TAB_CAP, type WorkspaceTab } from '@/lib/workspace/model'

export interface CaseCapPromptProps {
  tabs: readonly WorkspaceTab[]
  onPick: (key: string) => void
  onCancel: () => void
}

export function CaseCapPrompt({ tabs, onPick, onCancel }: CaseCapPromptProps) {
  return (
    <Modal open onClose={onCancel}>
      <div className="p-5">
        <ModalHeader title="Too many open cases" onClose={onCancel} />
        <p className="text-sm text-slate-300">
          The workspace keeps up to {CASE_TAB_CAP} cases open at once. Close one to open the new case.
        </p>
        <ul className="mt-3 space-y-1" aria-label="Open cases">
          {tabs.map((t) => (
            <li key={t.key} className="flex items-center gap-2 rounded-lg border border-white/10 bg-ink-950/60 py-1.5 pl-3 pr-1.5">
              <CaseIcon size={14} className="flex-shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs font-semibold text-white">{t.title}</span>
              {t.dirty && <span aria-label="Unsaved changes" className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />}
              <Button size="sm" onClick={() => onPick(t.key)} aria-label={`Close ${t.title} and open the new case`}>
                Close &amp; open
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}
