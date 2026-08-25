'use client'

/** The ⓘ peek trigger for relationship rows — opens the lazy RecordPeek
 *  preview without navigating away from the panel. The peek modal itself is
 *  code-split (next/dynamic) so list rows don't pay for it until the first
 *  click. */
import dynamic from 'next/dynamic'
import { useState } from 'react'
import type { PreviewType } from '@/lib/entityPreview'
import { InfoIcon } from '@/components/shell/icons'

const RecordPeek = dynamic(
  () => import('@/components/ui/RecordPeek').then((m) => m.RecordPeek),
  { ssr: false },
)

export function RecordPeekButton({ type, id, label, className = '' }: {
  type: PreviewType
  id: string
  /** Accessible name for the trigger (falls back to the record type). */
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={`Quick preview: ${label ?? type}`}
        title="Quick preview"
        onClick={() => setOpen(true)}
        className={`-my-1 grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-white/5 hover:text-blue-200 ${className}`}
      >
        <InfoIcon size={14} />
      </button>
      {open && <RecordPeek type={type} id={id} onClose={() => setOpen(false)} />}
    </>
  )
}
