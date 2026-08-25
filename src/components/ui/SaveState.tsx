'use client'

/** Compact autosave-state chip — the FieldSubmitForm "Saving… / Draft saved"
 *  text promoted to one shared primitive, fed by lib/userDrafts'
 *  useDraftState(). Text plus a subtle tone dot; no chrome, no motion. The
 *  span stays mounted (empty while idle) so aria-live announces transitions. */
import { timeAgo } from '@/lib/format'
import type { DraftSaveState, DraftSaveStatus } from '@/lib/userDrafts'

const TONES: Record<Exclude<DraftSaveStatus, 'idle'>, string> = {
  saving: 'text-slate-400',
  saved: 'text-emerald-300',
  error: 'text-rose-300',
  offline: 'text-amber-300',
  local: 'text-amber-300',
}

function label(status: DraftSaveStatus, lastSavedAt: number | null | undefined): string {
  switch (status) {
    case 'saving': return 'Saving…'
    case 'saved': return `Saved${lastSavedAt ? ` · ${timeAgo(lastSavedAt)}` : ''}`
    case 'error': return 'Save failed — kept on this device'
    case 'offline': return 'Offline — kept on this device'
    case 'local': return 'Too large to sync — kept on this device'
    default: return ''
  }
}

export interface SaveStateProps extends Pick<DraftSaveState, 'status'> {
  lastSavedAt?: number | null
  className?: string
}

export function SaveState({ status, lastSavedAt, className = '' }: SaveStateProps) {
  const text = label(status, lastSavedAt)
  return (
    <span role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${status === 'idle' ? '' : TONES[status]} ${className}`}>
      {text && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" />}
      {text}
    </span>
  )
}
