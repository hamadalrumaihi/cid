'use client'

/** Request section — the instrument content itself. Creators in an editable
 *  state get the draft form (with the never-lose-work restore banner); every
 *  other viewer sees the exact immutable version reviewers act on
 *  (current_version_id). Below either mode: the full version history with a
 *  per-version document diff so returns and revisions are auditable. */
import { Drafts, type Draft } from '@/lib/drafts'
import { fmtDateTime, timeAgo } from '@/lib/format'
import {
  CLASSIFICATIONS, SOCIAL_PLATFORMS,
  type LegalRequest, type LegalVersion,
} from '@/lib/justice'
import { humanize } from '@/lib/legalWorkflow'
import { parseLegalFormEntries } from '@/lib/schemas'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { VersionViewer, type VersionItem } from '@/components/shared/VersionViewer'
import { DiffView } from '@/components/sops/docDiff'
import { Row, sanitizeStash, type DraftShape } from './dossierShared'

type FieldSpec = { key: string; label: string; req?: boolean; kind?: 'textarea' | 'datetime' }

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
      <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
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
  currentVersion, versions, name, onSaveDraft, onSubmit,
}: {
  r: LegalRequest
  editable: boolean
  busy: boolean
  spec: FieldSpec[]
  draft: DraftShape
  setDraft: React.Dispatch<React.SetStateAction<DraftShape>>
  pendingDraft: Draft<DraftShape> | null
  setPendingDraft: (d: Draft<DraftShape> | null) => void
  currentVersion: LegalVersion | null
  versions: LegalVersion[]
  name: (id: string | null | undefined) => string
  onSaveDraft: () => void
  onSubmit: () => void
}) {
  const formEntries = parseLegalFormEntries(currentVersion?.form_data)
  return (
    <div className="space-y-4">
      {editable ? (
        <Card pad="sm" className="max-w-2xl space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Edit draft</h3>
          {pendingDraft && pendingDraft.at > Date.parse(r.updated_at) && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
              <span className="min-w-0 flex-1">
                An unsaved draft from {timeAgo(pendingDraft.at)} was found on this device (newer than the saved request).
              </span>
              <Button onClick={() => { setDraft(sanitizeStash(pendingDraft.data, r.classification)); setPendingDraft(null) }}>Restore</Button>
              <Button onClick={() => { Drafts.clear(`legal:edit:${r.id}`); setPendingDraft(null) }}>Discard</Button>
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
          <Field label="Description / Justification" required>
            {(id) => <Textarea id={id} rows={5} value={draft.narrative} onChange={(e) => setDraft((d) => ({ ...d, narrative: e.target.value }))} />}
          </Field>
          {spec.map((f) => (
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
            <Button variant="primary" disabled={busy} onClick={onSubmit}>Submit for CID review</Button>
          </div>
        </Card>
      ) : (
        <Card pad="sm" className="max-w-2xl space-y-3">
          <p className="text-xs text-slate-400">
            Immutable submitted version {currentVersion ? `v${currentVersion.version_number}` : '—'} — reviewers act on exactly this content.
          </p>
          <Row label="Title">{r.title}</Row>
          {r.priority && <Row label="Priority">{r.priority}</Row>}
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
      <VersionHistory versions={versions} name={name} />
    </div>
  )
}
