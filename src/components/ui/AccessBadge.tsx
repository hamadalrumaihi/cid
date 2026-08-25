'use client'

/** The one visibility/access chip — for the three classification vocabularies
 *  that already exist (it invents no states):
 *   - `sib`   — SIB compartmentation (lib/siuVisibility): siu_only / partial /
 *               revealed / unclassified (+ the RPC-only 'cid'). Violet family,
 *               kept — SIB material must never read like an ordinary status.
 *   - `legal` — legal-request classification (lib/justice): standard /
 *               restricted / classified / sealed. Keeps the bordered uppercase
 *               idiom and the 🔒 on sealed.
 *   - `sop`   — library document classification (sops/docModel CLASS_LABEL):
 *               internal / restricted / command / justice / owner.
 *  Every chip carries a title explaining WHO can access — the audience is the
 *  point of a classification, so the tooltip says it out loud. */
import {
  visibilityLabel, visibilityTint, type VisibilityRow,
} from '@/lib/siuVisibility'
import { CLASSIFICATION_STYLE, type Classification } from '@/lib/justice'
import { CLASS_LABEL } from '@/components/sops/docModel'

/** The row slice visibilityLabel reads — pass it when you have one so the
 *  label reflects scope ("2 sections restricted", "Revealed to one case"). */
export type SibVisibilityRow = Pick<VisibilityRow,
  'state' | 'revealed_to_case_id' | 'revealed_to_user_id'> &
  { scope?: string | null; hidden_sections?: string[] | null }

const SIB_STATE_LABEL: Record<string, string> = {
  siu_only: 'SIB only',
  partial: 'Partially revealed to CID',
  revealed: 'Revealed to CID',
  unclassified: 'Origin not established',
  cid: 'Shared with CID',
}
const SIB_TITLE: Record<string, string> = {
  siu_only: 'Only SIB can see this. To a CID viewer it reads as an ordinary not-found.',
  partial: 'CID can see part of this record; the named sections stay with SIB.',
  revealed: 'SIB released this — the stated CID audience can see it.',
  unclassified: 'Origin not established — visible as before until SIB decides.',
  cid: 'Shared — every active CID investigator can see it.',
}

const LEGAL_TITLE: Record<string, string> = {
  standard: 'Standard — visible to everyone the request itself is visible to.',
  restricted: 'Restricted — sensitive-records request; handling is limited to the assigned participants.',
  classified: 'Classified — assigned participants and their supervisors only.',
  sealed: 'Sealed — creator, assigned supervisor, assigned prosecutor/judge and owner oversight only. Its existence is never revealed elsewhere.',
}

const SOP_TITLE: Record<string, string> = {
  internal: 'Internal — every active member can read it.',
  restricted: 'Restricted — limited distribution; managed by command staff.',
  command: 'Command — command staff and the owner only.',
  justice: 'Justice — DOJ leadership (DA/AG) and the owner.',
  owner: 'Owner — the owner only.',
}
const SOP_CLS: Record<string, string> = {
  internal: 'bg-white/5 text-slate-300',
  restricted: 'bg-amber-500/15 text-amber-300',
  command: 'bg-blue-500/15 text-blue-300',
  justice: 'bg-violet-500/15 text-violet-300',
  owner: 'bg-rose-500/15 text-rose-300',
}

export interface AccessBadgeProps {
  kind: 'sib' | 'legal' | 'sop'
  /** The classification / visibility state value. For `sib`, pass `row`
   *  instead (or as well) when you have one — the label gets scope-aware. */
  value?: string
  /** SIB only: the visibility row slice for a scope-aware label. */
  row?: SibVisibilityRow
  /** Optional label override (e.g. a legend chip with fixed wording). */
  label?: string
  className?: string
}

export function AccessBadge({ kind, value, row, label, className = '' }: AccessBadgeProps) {
  if (kind === 'legal') {
    const v = (value ?? 'standard') as Classification
    const cls = CLASSIFICATION_STYLE[v] ?? CLASSIFICATION_STYLE.standard
    return (
      <span
        title={LEGAL_TITLE[v] ?? LEGAL_TITLE.standard}
        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls} ${className}`}
      >
        {v === 'sealed' ? '🔒 ' : ''}{label ?? value ?? 'standard'}
      </span>
    )
  }
  if (kind === 'sop') {
    const v = value ?? 'internal'
    return (
      <span
        title={SOP_TITLE[v]}
        className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${SOP_CLS[v] ?? SOP_CLS.internal} ${className}`}
      >
        {label ?? CLASS_LABEL[v as keyof typeof CLASS_LABEL] ?? v}
      </span>
    )
  }
  // sib
  const state = row?.state ?? value ?? 'unclassified'
  const text = label ?? (row ? visibilityLabel(row) : SIB_STATE_LABEL[state] ?? state)
  return (
    <span
      title={SIB_TITLE[state]}
      className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${visibilityTint(state)} ${className}`}
    >
      {text}
    </span>
  )
}
