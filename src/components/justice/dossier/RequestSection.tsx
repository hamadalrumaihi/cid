'use client'

/** Request section — the instrument content itself. Creators in an editable
 *  state get the draft form (with the never-lose-work restore banner); every
 *  other viewer sees the exact immutable version reviewers act on
 *  (current_version_id). Below either mode: the full version history with a
 *  per-version document diff so returns and revisions are auditable. */
import { clearDraft, type LoadedDraft } from '@/lib/userDrafts'
import { fmtDateTime, timeAgo } from '@/lib/format'
import {
  CLASSIFICATIONS, SOCIAL_PLATFORMS, STANDARDS_OF_PROOF, isEditableDraft,
  type LegalRequest, type LegalVersion,
} from '@/lib/justice'
import type { LegalChargeRow } from '@/lib/legalExport'
import { standardOfProofLabel } from '@/lib/legalExport'
import { humanize } from '@/lib/legalWorkflow'
import { parseLegalFormEntries } from '@/lib/schemas'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { RecordHistory } from '@/components/shared/RecordHistory'
import { VersionViewer, type VersionItem } from '@/components/shared/VersionViewer'
import { DiffView } from '@/components/sops/docDiff'
import { ChargesBlock } from './ChargesBlock'
import { Row, sanitizeStash, type DraftShape } from './dossierShared'

type FieldSpec = { key: string; label: string; req?: boolean; kind?: 'textarea' | 'datetime' }

/** The P4-04 basis keys render as their own labelled rows, not as generic
 *  particulars. */
const BASIS_KEYS = new Set(['standard_of_proof', 'pc_statement'])

/** Canonical text of a version (narrative + labelled form entries) — the diff
 *  input, so a revision reads as one document change, not raw JSON. */
function versionText(v: LegalVersion): string {
  const entries = parseLegalFormEntries(v.form_data)
  return [(v.narrative ?? '').trim(), ...entries.map(([k, val]) => `${humanize(k)}: ${val}`)]
    .filter(Boolean).join('\n')
}

function VersionHistory({ versions, name }: { versions: LegalVersion[]; name: (id: string | null | undefined) => string }) {
  if (versions.length === 0) return null
  const items: VersionItem[] = versions.map((v) => ({
    id: v.id, number: v.version_number, at: v.created_at, byName: name(v.created_by),
    label: v.submitted_stage ? humanize(v.submitted_stage) : null,
  }))
  return (
    <Card pad="sm">
      <h3 className="mb-2 text-[13px] font-semibold text-white">
        Version history (immutable)
      </h3>
      <VersionViewer
        versions={items}
        renderContent={(item) => {
          const v = versions.find((x) => x.id === item.id)
          if (!v) return null
          const entries = parseLegalFormEntries(v.form_data)
          const idx = versions.findIndex((x) => x.id === v.id)
          const prev = versions[idx + 1] ?? null // list is newest-first
          return (
            <div className="space-y-2">
              {v.change_summary && (
                <p className="rounded-lg border border-badge-500/20 bg-badge-500/5 px-2.5 py-1.5 text-xs text-slate-200">
                  <span className="font-semibold text-white">What changed: </span>{v.change_summary}
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm text-slate-200">{v.narrative?.trim() || '—'}</p>
              {entries.length > 0 && (
                <div>
                  {entries.map(([k, val]) => <Row key={k} label={humanize(k)}>{String(val ?? '—')}</Row>)}
                </div>
              )}
              {prev && (
                <details className="text-sm">
                  <summary className="cursor-pointer rounded text-xs font-semibold text-badge-200 hover:text-white">
                    Changes from v{prev.version_number}
                  </summary>
                  <DiffView base={versionText(prev)} other={versionText(v)} className="mt-2" />
                </details>
              )}
              <p className="text-[11px] text-slate-400">Frozen {fmtDateTime(v.created_at)} — reviewers act on exactly this content.</p>
            </div>
          )
        }}
      />
    </Card>
  )
}

export function RequestSection({
  r, editable, busy, spec, draft, setDraft, pendingDraft, setPendingDraft,
  currentVersion, versions, name, onSaveDraft, onSubmit, charges, onEditCharges,
}: {
  r: LegalRequest
  editable: boolean
  busy: boolean
  spec: FieldSpec[]
  draft: DraftShape
  setDraft: React.Dispatch<React.SetStateAction<DraftShape>>
  pendingDraft: LoadedDraft<DraftShape> | null
  setPendingDraft: (d: LoadedDraft<DraftShape> | null) => void
  currentVersion: LegalVersion | null
  versions: LegalVersion[]
  name: (id: string | null | undefined) => string
  onSaveDraft: () => void
  onSubmit: () => void
  /** legal_request_charges rows (P4-03) — read-only here; edited in the wizard. */
  charges: LegalChargeRow[]
  onEditCharges?: () => void
}) {
  const formEntries = parseLegalFormEntries(currentVersion?.form_data).filter(([k]) => !BASIS_KEYS.has(k))
  const warrant = r.request_type === 'warrant'
  const versionForm = (currentVersion?.form_data && typeof currentVersion.form_data === 'object' && !Array.isArray(currentVersion.form_data))
    ? (currentVersion.form_data as Record<string, unknown>) : {}
  const setFormKey = (key: string, value: string) => setDraft((d) => ({ ...d, form: { ...d.form, [key]: value } }))
  const resubmitting = r.review_status.startsWith('returned_by')
  return (
    <div className="space-y-4">
      {editable ? (
        <Card pad="sm" className="max-w-2xl space-y-3">
          <h3 className="text-[13px] font-semibold text-white">Edit draft</h3>
          {pendingDraft && pendingDraft.at > Date.parse(r.updated_at) && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              <span className="min-w-0 flex-1">
                An unsaved draft from {timeAgo(pendingDraft.at)} was found{pendingDraft.source === 'local' ? ' on this device' : ' in your drafts'} (newer than the saved request).
              </span>
              <Button onClick={() => { setDraft(sanitizeStash(pendingDraft.data, r.classification)); setPendingDraft(null) }}>Restore</Button>
              <Button onClick={() => { void clearDraft(`legal:edit:${r.id}`); setPendingDraft(null) }}>Discard</Button>
            </div>
          )}
          <Field label={r.request_type === 'warrant' ? 'Warrant Title' : 'Title'} required>
            {(id) => <Input id={id} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />}
          </Field>
          {r.request_type === 'warrant' && (
            <Field label="Priority" required>
              {(id) => (
                <Select id={id} value={draft.priority} onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value }))}>
                  <option value="">Choose…</option>
                  {['Medium', 'High', 'Critical'].map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              )}
            </Field>
          )}
          {warrant && (
            <>
              {/* P4-04: submit_legal_request_to_cid refuses a warrant without
                  both — they live in form_data beside the other fields. */}
              <Field label="Standard of proof" required hint="The standard the request must meet; the probable-cause statement below must support it.">
                {(id) => (
                  <Select id={id} value={draft.form.standard_of_proof ?? ''} onChange={(e) => setFormKey('standard_of_proof', e.target.value)}>
                    <option value="">Choose…</option>
                    {STANDARDS_OF_PROOF.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Probable-cause statement" required hint="The facts, in order, that establish the standard — what was seen, by whom, and how it ties the target to the offence.">
                {(id) => <Textarea id={id} rows={5} value={draft.form.pc_statement ?? ''} onChange={(e) => setFormKey('pc_statement', e.target.value)} />}
              </Field>
            </>
          )}
          <Field label="Description / Justification" required>
            {(id) => <Textarea id={id} rows={5} value={draft.narrative} onChange={(e) => setDraft((d) => ({ ...d, narrative: e.target.value }))} />}
          </Field>
          {spec.filter((f) => !BASIS_KEYS.has(f.key)).map((f) => (
            <Field key={f.key} label={f.label} required={f.req}>
              {(id) => f.key === 'platform' ? (
                <Select id={id} value={draft.form[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, form: { ...d.form, [f.key]: e.target.value } }))}>
                  <option value="">Choose…</option>
                  {SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              ) : f.kind === 'textarea' ? (
                <Textarea id={id} rows={3} value={draft.form[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, form: { ...d.form, [f.key]: e.target.value } }))} />
              ) : (
                <Input id={id} type={f.kind === 'datetime' ? 'datetime-local' : 'text'} value={draft.form[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, form: { ...d.form, [f.key]: e.target.value } }))} />
              )}
            </Field>
          ))}
          <Field label="Classification">
            {(id) => (
              <Select id={id} value={draft.classification} onChange={(e) => setDraft((d) => ({ ...d, classification: e.target.value }))}>
                {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            )}
          </Field>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={onSaveDraft}>Save draft</Button>
            {/* A judge return fast-tracks back to the judicial queue (material
                changes are declared in the preview); every resubmission
                captures a change summary there, so the label stays honest. */}
            <Button variant="primary" disabled={busy} onClick={onSubmit}>
              {resubmitting ? 'Resubmit for review' : 'Submit for bureau review'}
            </Button>
          </div>
        </Card>
      ) : (
        <Card pad="sm" className="max-w-2xl space-y-3">
          <p className="text-xs text-slate-400">
            Immutable submitted version {currentVersion ? `v${currentVersion.version_number}` : '—'} — reviewers act on exactly this content.
          </p>
          <Row label="Title">{r.title}</Row>
          {r.priority && <Row label="Priority">{r.priority}</Row>}
          {warrant && (
            <>
              <Row label="Standard of proof">{standardOfProofLabel(versionForm.standard_of_proof)}</Row>
              <div>
                <p className="text-xs font-semibold text-slate-400">Probable-cause statement</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{typeof versionForm.pc_statement === 'string' && versionForm.pc_statement.trim() ? versionForm.pc_statement : '—'}</p>
              </div>
            </>
          )}
          <div>
            <p className="text-xs font-semibold text-slate-400">Description / Justification</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">{currentVersion?.narrative ?? r.narrative ?? '—'}</p>
          </div>
          {formEntries.length > 0 && (
            <div className="space-y-1">
              {formEntries.map(([k, val]) => (
                <Row key={k} label={humanize(k)}>{String(val ?? '—')}</Row>
              ))}
            </div>
          )}
        </Card>
      )}
      <ChargesBlock charges={charges} editable={editable} onEdit={onEditCharges} className="max-w-2xl" />
      {/* Field-level edits while the request is a draft (record_versions,
          P8-04). Read-only: the server treats legal as display_only for
          restore_version; the frozen submitted versions follow below. */}
      {isEditableDraft(r) && (
        <Card pad="sm" className="max-w-2xl">
          <h3 className="mb-1 text-[13px] font-semibold text-white">Draft history</h3>
          <p className="mb-2 text-xs text-slate-400">Every save to the draft, field by field. Submitted versions are frozen in the history below.</p>
          <RecordHistory kind="legal" id={r.id} canRestore={false} />
        </Card>
      )}
      <VersionHistory versions={versions} name={name} />
    </div>
  )
}
