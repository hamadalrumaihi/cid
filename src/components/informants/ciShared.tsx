'use client'

/** Small shared pieces for the Informants surfaces — tints, the status chip,
 *  the nothing-here surface, the capacity warning, the member / case pickers
 *  and the datetime-local helpers. Everything visual composes the design
 *  system primitives; nothing here fetches CI rows. */
import { useEffect } from 'react'
import { EntityPicker } from '@/components/entity/EntityPicker'
import { SearchIcon } from '@/components/shell/icons'
import { Badge } from '@/components/ui/Badge'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/Notice'
import {
  CI_ASSESSMENT_LABEL, CI_CORROBORATION_LABEL, CI_RELIABILITY_LABEL, CI_RISK_LABEL, CI_SENSITIVITY_LABEL,
  CI_STATUS_LABEL, CONTACT_STATE_LABEL, capacityLabel, type ContactState,
} from '@/lib/ci'
import type { EntityHit } from '@/lib/entitySearch'
import { activeProfiles, useProfilesStore } from '@/lib/profiles'
import { bureauShort, roleLabel } from '@/lib/roles'

/* ── Tints (lib/tint has no CI vocabulary; these stay the standard chip pairs) */

const NEUTRAL = 'bg-white/5 text-slate-300'

export const ciStatusTint = (s?: string | null): string => {
  switch (s) {
    case 'active': return 'bg-emerald-500/15 text-emerald-300'
    case 'candidate': return 'bg-blue-500/15 text-blue-300'
    case 'dormant': return 'bg-slate-500/20 text-slate-300'
    case 'suspended': return 'bg-amber-500/15 text-amber-300'
    case 'compromised': return 'bg-rose-500/15 text-rose-300'
    case 'retired':
    case 'terminated': return 'bg-white/5 text-slate-400'
    default: return NEUTRAL
  }
}

export const ciRiskTint = (r?: string | null): string => {
  switch (r) {
    case 'critical': return 'bg-rose-500/20 text-rose-200'
    case 'high': return 'bg-rose-500/15 text-rose-300'
    case 'medium': return 'bg-amber-500/15 text-amber-300'
    case 'low': return 'bg-emerald-500/15 text-emerald-300'
    default: return NEUTRAL
  }
}

export const ciReliabilityTint = (r?: string | null): string => {
  switch (r) {
    case 'proven': return 'bg-emerald-500/20 text-emerald-200'
    case 'high': return 'bg-emerald-500/15 text-emerald-300'
    case 'moderate': return 'bg-blue-500/15 text-blue-300'
    case 'low': return 'bg-amber-500/15 text-amber-300'
    default: return NEUTRAL
  }
}

export const corroborationTint = (c?: string | null): string => {
  switch (c) {
    case 'corroborated': return 'bg-emerald-500/15 text-emerald-300'
    case 'partially_corroborated': return 'bg-blue-500/15 text-blue-300'
    case 'contradicted': return 'bg-rose-500/15 text-rose-300'
    case 'unable_to_verify': return 'bg-amber-500/15 text-amber-300'
    default: return NEUTRAL
  }
}

export const sensitivityTint = (s?: string | null): string =>
  s === 'highly_sensitive' ? 'bg-rose-500/15 text-rose-300' : s === 'sensitive' ? 'bg-amber-500/15 text-amber-300' : NEUTRAL

export const contactStateTint = (s: ContactState): string =>
  s === 'overdue' ? 'bg-rose-500/15 text-rose-300' : s === 'due_soon' ? 'bg-amber-500/15 text-amber-300' : NEUTRAL

const lbl = (map: Record<string, string>, v?: string | null): string => (v && map[v]) || v || '—'
export const statusLabel = (v?: string | null) => lbl(CI_STATUS_LABEL, v)
export const riskLabel = (v?: string | null) => lbl(CI_RISK_LABEL, v)
export const reliabilityLabel = (v?: string | null) => lbl(CI_RELIABILITY_LABEL, v)
export const corroborationLabel = (v?: string | null) => lbl(CI_CORROBORATION_LABEL, v)
export const sensitivityLabel = (v?: string | null) => lbl(CI_SENSITIVITY_LABEL, v)
export const gradeLabel = (v?: string | null) => lbl(CI_ASSESSMENT_LABEL, v)
export const contactStateLabel = (s: ContactState) => CONTACT_STATE_LABEL[s]

export function CiStatusBadge({ status }: { status?: string | null }) {
  return <Badge tint={ciStatusTint(status)}>{statusLabel(status)}</Badge>
}

/* ── The nothing-here surface (identical copy to /siu) ───────────────────── */

/** Rendered for an un-involved account and for a `ci_get` miss. Deliberately
 *  says nothing about informants, restriction or counts. */
export function NothingHere() {
  return (
    <EmptyState
      icon={<SearchIcon className="h-5 w-5" />}
      title="Nothing to show here"
      hint="This section isn't available for your account."
    />
  )
}

/* ── Capacity warning + override reason ──────────────────────────────────── */

export function CapacityWarning({ handlerName, active, capacity, reason, onReason, error }: {
  handlerName: string
  active: number
  capacity: number
  reason: string
  onReason: (v: string) => void
  error?: string
}) {
  return (
    <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="text-sm font-semibold text-amber-200">Capacity warning</p>
      <p className="text-sm text-slate-200">
        {handlerName} currently has <span className="font-semibold tabular-nums">{capacityLabel(active, capacity)}</span> active.
        Assigning this source will exceed their normal capacity.
      </p>
      <Field label="Authorization reason" required error={error} hint="Recorded as CI_CAPACITY_OVERRIDE; the handler's limit is raised to the new count.">
        {(id) => (
          <Textarea id={id} rows={2} value={reason} onChange={(e) => onReason(e.target.value)} invalid={!!error}
            placeholder="Why this handler may exceed the normal capacity…" />
        )}
      </Field>
    </div>
  )
}

/* ── Pickers ─────────────────────────────────────────────────────────────── */

/** Active members as a labelled select — the handler picker for full access.
 *  Loads the shared roster cache on first use. */
export function MemberSelect({ label, value, onChange, exclude, required, hint, disabled }: {
  label: string
  value: string
  onChange: (id: string) => void
  exclude?: ReadonlySet<string>
  required?: boolean
  hint?: string
  disabled?: boolean
}) {
  const loaded = useProfilesStore((s) => s.loaded)
  const profiles = useProfilesStore((s) => s.profiles)
  useEffect(() => { if (!loaded) void useProfilesStore.getState().fetch() }, [loaded])
  const options = activeProfiles().filter((p) => !exclude?.has(p.id))
  return (
    <Field label={label} required={required} hint={hint}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} required={required}>
          <option value="">{profiles.length ? 'Select a member…' : 'Loading members…'}</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>{p.display_name} — {roleLabel(p.role)}, {bureauShort(p.division)}</option>
          ))}
        </Select>
      )}
    </Field>
  )
}

/** A single case the caller can read (`entity_suggest` is RLS-scoped). */
export function CasePicker({ value, onChange, label = 'Case (optional)', hint, required }: {
  value: EntityHit | null
  onChange: (v: EntityHit | null) => void
  label?: string
  hint?: string
  required?: boolean
}) {
  return <EntityPicker kind="case" label={label} hint={hint} required={required} value={value} onChange={onChange} peek={false} />
}

/* ── datetime-local helpers ──────────────────────────────────────────────── */

const pad = (n: number) => String(n).padStart(2, '0')
/** ISO → the `datetime-local` value (local wall time, minutes precision). */
export function toLocalInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** `datetime-local` value → ISO (null when blank / unparsable). */
export function fromLocalInput(v: string): string | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
export const nowLocalInput = (): string => toLocalInput(new Date().toISOString())
