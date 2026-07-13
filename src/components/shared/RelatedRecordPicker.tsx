'use client'

/** Shared related-record picker (v1.14) — the DOJ exhibit picker promoted to
 *  a portal-wide component (adoption register: "person/case/evidence/…
 *  selectors"). Callers load their own RLS-scoped options and keep the write
 *  path domain-specific; this component only renders labeled pickers and an
 *  optional external-link entry, so it can never widen anyone's access. */
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'
import { uiPrompt } from '@/components/ui/dialog'

export interface RecordOption { id: string; label: string }
export interface RecordSource {
  /** Domain kind forwarded to onPick (e.g. 'evidence', 'finalized_report'). */
  kind: string
  label: string
  options: RecordOption[]
}

export function RelatedRecordPicker({ sources, onPick, onAddLink, linkLabel = '+ External link' }: {
  sources: RecordSource[]
  onPick: (kind: string, option: RecordOption) => void
  /** When set, renders an external-link button (URL via prompt). */
  onAddLink?: (url: string) => void
  linkLabel?: string
}) {
  const addLink = async () => {
    if (!onAddLink) return
    const url = await uiPrompt('External link URL (approved sources only, http/https).', {
      title: 'Add external link', placeholder: 'https://…',
    })
    const clean = url?.trim() ?? ''
    if (!clean) return
    // Scheme allow-list at the entry point — javascript:/data: links must
    // never become clickable records (the render side safeUrl()s too).
    if (!/^https?:\/\//i.test(clean)) {
      toast('External links must start with http:// or https://', 'warn')
      return
    }
    onAddLink(clean)
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      {sources.filter((s) => s.options.length > 0).map((s) => (
        <label key={s.kind} className="flex items-center gap-2 text-xs text-slate-400">
          {s.label}
          <Select
            value=""
            aria-label={`Add ${s.label.toLowerCase()}`}
            onChange={(e) => {
              const opt = s.options.find((o) => o.id === e.target.value)
              if (opt) onPick(s.kind, opt)
            }}
          >
            <option value="">Choose…</option>
            {s.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
        </label>
      ))}
      {onAddLink && <Button onClick={() => void addLink()}>{linkLabel}</Button>}
    </div>
  )
}
