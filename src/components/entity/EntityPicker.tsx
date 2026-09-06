'use client'

/** EntityPicker — the one registry picker (plan P2-07). A thin wrapper over
 *  RecordSearchPicker whose loader is `entity_suggest` for the given kind:
 *  bounded, RLS-scoped, exact-normalized hits first. The picker never widens
 *  access (an SIB-hidden or merged record is simply not in the answer) and
 *  never creates anything itself — `onCreateNew` hands the typed text to the
 *  caller (usually EntityCreateSheet).
 *
 *  Rows: label, an "exact" pill when the server says the normalized value
 *  matched exactly, and for kind 'phone' (a search across persons AND phone
 *  indicators — there is no phone entity) a tag naming which table the hit
 *  lives in. */
import { useCallback } from 'react'
import { RecordSearchPicker } from '@/components/shared/RecordSearchPicker'
import { Badge } from '@/components/ui/Badge'
import { KIND_LABEL, suggestEntities, toHit, type SuggestKind, type SuggestRow } from '@/lib/entity'
import type { EntityHit } from '@/lib/entitySearch'
import type { PreviewType } from '@/lib/entityPreview'

/** Kinds RecordPeek can preview; 'phone' and 'indicator' have no peek. */
const PEEK_TYPE: Partial<Record<SuggestKind, PreviewType>> = {
  person: 'person', vehicle: 'vehicle', gang: 'gang', place: 'place',
  narcotic: 'narcotic', case: 'case', account: 'account',
}

/** Story/test seam — the production loader is `suggestEntities`. */
export type EntitySuggestFn = (kind: SuggestKind, q: string) => Promise<SuggestRow[]>

interface BaseProps {
  kind: SuggestKind
  label: string
  required?: boolean
  hint?: string
  placeholder?: string
  disabled?: boolean
  /** Ids to leave out (the record being linked FROM, already-linked rows …). */
  exclude?: ReadonlySet<string>
  /** Adds a final "Create new…" row once the query has ≥ 2 characters. */
  onCreateNew?: (query: string) => void
  createLabel?: (query: string) => string
  /** Minimum characters before the loader fires (default 2 — the RPC's floor). */
  minChars?: number
  /** Quick-preview button on each row (default on for kinds RecordPeek supports). */
  peek?: boolean
  /** Injection seam for stories and tests; never set it in app code. */
  suggest?: EntitySuggestFn
}

interface SingleProps {
  multiple?: false
  value: EntityHit | null
  onChange: (v: EntityHit | null) => void
  values?: never
  onChangeMany?: never
}

interface MultiProps {
  multiple: true
  values: EntityHit[]
  onChangeMany: (v: EntityHit[]) => void
  value?: never
  onChange?: never
}

export type EntityPickerProps = BaseProps & (SingleProps | MultiProps)

export function EntityPicker(props: EntityPickerProps) {
  const {
    kind, label, required, hint, placeholder, disabled, exclude, onCreateNew, createLabel,
    minChars = 2, peek = true, suggest = suggestEntities,
  } = props

  // RecordSearchPicker reads `search` through a ref, so a fresh closure per
  // render is fine; useCallback just keeps the identity stable for callers
  // that memoise on it.
  const search = useCallback(async (q: string): Promise<EntityHit[]> => {
    const rows = await suggest(kind, q)
    const kept = exclude ? rows.filter((r) => !exclude.has(r.id)) : rows
    return kept.map(toHit)
  }, [kind, exclude, suggest])

  const renderRow = (h: EntityHit) => (
    <>
      <span className="min-w-0 flex-1 truncate">{h.label}</span>
      {kind === 'phone' && h.meta?.kind && (
        <Badge tone="neutral" className="flex-shrink-0">{h.meta.kind === 'indicator' ? 'indicator' : 'person'}</Badge>
      )}
      {h.meta?.exact && <Badge tone="good" className="flex-shrink-0">exact</Badge>}
      {h.sublabel && <span className="flex-shrink-0 text-xs text-slate-400">{h.sublabel}</span>}
    </>
  )

  const shared = {
    label, required, hint, disabled, search, renderRow, onCreateNew, createLabel, minChars,
    placeholder: placeholder ?? `Search ${KIND_LABEL[kind].many}…`,
    peekType: peek ? PEEK_TYPE[kind] : undefined,
    getThumb: (h: EntityHit) => h.thumbUrl,
  }

  if (props.multiple) {
    return <RecordSearchPicker<EntityHit> {...shared} multiple values={props.values} onChangeMany={props.onChangeMany} />
  }
  return <RecordSearchPicker<EntityHit> {...shared} value={props.value} onChange={props.onChange} />
}
