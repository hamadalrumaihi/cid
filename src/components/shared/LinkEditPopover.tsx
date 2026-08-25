'use client'

/** LinkEditPopover — the ONE editor for an existing relationship-link row
 *  (person_relationships / person_vehicles / person_places / gang_places /
 *  gang_turf / narcotic_gangs / case_intel_links / account_links). Before
 *  this, links could only be created or deleted even though every link table
 *  carries an UPDATE policy — promoting confidence or marking an ended
 *  association Historical meant delete-and-recreate, losing the audit trail.
 *
 *  Fields render only when the caller passes them (a table without a status
 *  column simply omits `status`), vocabularies come from the callers (they
 *  mirror the CHECK constraints), and the save is a single `update()` — the
 *  server-side audit triggers record the edit; nothing is written client-side
 *  to audit_log. */
import { useState } from 'react'
import { update } from '@/lib/db'
import type { TablesUpdate } from '@/lib/database.types'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import {
  CONFIDENCE_LEVELS, LINK_STATUSES, confidenceLabel, linkStatusLabel,
} from '@/components/persons/personIntel'

export type EditableLinkTable =
  | 'person_relationships' | 'person_vehicles' | 'person_places'
  | 'gang_places' | 'gang_turf' | 'narcotic_gangs'
  | 'case_intel_links' | 'account_links'

/** current / historical / disputed chip — the link-status vocabulary shared by
 *  every relationship table (no lib/status domain exists for it, so the tint
 *  mapping lives here once instead of per-view copies). */
export function LinkStatusBadge({ status, className = '' }: { status?: string | null; className?: string }) {
  const s = status ?? 'current'
  const tint = s === 'current' ? 'bg-emerald-500/15 text-emerald-300'
    : s === 'disputed' ? 'bg-rose-500/15 text-rose-300'
    : 'bg-white/5 text-slate-400'
  return (
    <Badge tint={tint} className={className} title={`Link status: ${linkStatusLabel(s)}`}>
      {linkStatusLabel(s)}
    </Badge>
  )
}

export interface LinkEditPopoverProps {
  /** Modal heading, e.g. "Edit vehicle link". */
  title: string
  table: EditableLinkTable
  id: string
  /** Passing the prop (even null) renders the field; omitting hides it. */
  role?: string | null
  /** person_relationships stores the "role" in `relationship`. */
  roleColumn?: 'role' | 'relationship'
  /** CHECK-constrained vocabulary → a select; absent → free short text. */
  roleOptions?: readonly string[]
  roleLabel?: (v: string) => string
  /** NOT NULL role columns (person_vehicles, narcotic_gangs, relationship). */
  roleRequired?: boolean
  status?: string | null
  statusColumn?: 'link_status' | 'rel_status' | 'status'
  /** Defaults to current/historical/disputed; gang_turf passes its own. */
  statusOptions?: readonly string[]
  statusLabel?: (v: string) => string
  confidence?: string | null
  note?: string | null
  /** gang_turf / narcotic_gangs use `notes`. */
  noteColumn?: 'note' | 'notes'
  onClose: () => void
  onSaved: () => void
}

const humanizeFallback = (v: string) => v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export function LinkEditPopover(props: LinkEditPopoverProps) {
  const {
    title, table, id, onClose, onSaved,
    roleColumn = 'role', roleOptions, roleRequired,
    statusColumn = 'link_status', statusOptions = LINK_STATUSES,
    noteColumn = 'note',
  } = props
  const roleLabel = props.roleLabel ?? humanizeFallback
  const statusLabel = props.statusLabel ?? linkStatusLabel

  const hasRole = props.role !== undefined
  const hasStatus = props.status !== undefined
  const hasConfidence = props.confidence !== undefined
  const hasNote = props.note !== undefined

  const [role, setRole] = useState(props.role ?? '')
  const [status, setStatus] = useState(props.status ?? statusOptions[0] ?? 'current')
  const [confidence, setConfidence] = useState(props.confidence ?? '')
  const [note, setNote] = useState(props.note ?? '')
  const [busy, setBusy] = useState(false)

  const dirty = () =>
    (hasRole && role !== (props.role ?? ''))
    || (hasStatus && status !== (props.status ?? statusOptions[0] ?? 'current'))
    || (hasConfidence && confidence !== (props.confidence ?? ''))
    || (hasNote && note !== (props.note ?? ''))

  const save = async () => {
    if (hasRole && roleRequired && !role.trim()) { toast('A role is required for this link.', 'warn'); return }
    setBusy(true)
    const patch: Record<string, unknown> = {}
    if (hasRole) patch[roleColumn] = role.trim() || null
    if (hasStatus) patch[statusColumn] = status
    if (hasConfidence) patch.confidence = confidence || null
    if (hasNote) patch[noteColumn] = note.trim() || null
    const res = await update(table, id, patch as TablesUpdate<EditableLinkTable>)
    setBusy(false)
    if (res.error) { toast(`Save failed: ${res.error.message}`, 'danger'); return }
    toast('Link updated', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title={title} onClose={onClose} />
        <div className="space-y-3">
          {hasRole && (
            <Field label={roleColumn === 'relationship' ? 'Relationship' : 'Role'} required={roleRequired}>
              {(fid) => roleOptions ? (
                <Select id={fid} value={role} onChange={(e) => setRole(e.target.value)}>
                  {!roleRequired && <option value="">—</option>}
                  {/* Legacy free-text value outside the vocabulary stays selectable. */}
                  {role && !roleOptions.includes(role) && <option value={role}>{roleLabel(role)}</option>}
                  {roleOptions.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                </Select>
              ) : (
                <Input id={fid} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Short role, e.g. Subject" />
              )}
            </Field>
          )}
          {hasStatus && (
            <Field label="Status">
              {(fid) => (
                <Select id={fid} value={status} onChange={(e) => setStatus(e.target.value)}>
                  {status && !statusOptions.includes(status) && <option value={status}>{statusLabel(status)}</option>}
                  {statusOptions.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                </Select>
              )}
            </Field>
          )}
          {hasStatus && status === 'historical' && (
            <p className="rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 text-[11px] text-slate-400">
              Kept for the record — no longer an active association.
            </p>
          )}
          {hasConfidence && (
            <Field label="Confidence">
              {(fid) => (
                <Select id={fid} value={confidence} onChange={(e) => setConfidence(e.target.value)}>
                  <option value="">— Unverified —</option>
                  {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{confidenceLabel(c)}</option>)}
                </Select>
              )}
            </Field>
          )}
          {hasNote && (
            <Field label="Note">
              {(fid) => <Textarea id={fid} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="How is this known?" />}
            </Field>
          )}
          <Button variant="primary" className="w-full" loading={busy} onClick={() => void save()}>Save link</Button>
        </div>
      </div>
    </Modal>
  )
}
