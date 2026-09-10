'use client'

/** CI Intelligence — the case tab (CI contract §6.4).
 *
 *  Rows come from `ci_case_intel(p_case)`: intelligence on this case from
 *  confidential sources the viewer can access (full CI access or an active
 *  handler) — RLS + the RPC return zero rows to anyone else, and `CaseDetail`
 *  (Cleanup C) mounts this tab ONLY when `useCiCaseCount` is > 0, so an
 *  uninvolved viewer never sees the tab, a lock or a placeholder.
 *
 *  Every row makes the two questions explicit and separate: reliability is
 *  what the SOURCE said and how they have held up; corroboration is what the
 *  INVESTIGATION independently confirmed. Sanitize / Release (full access
 *  only) hands the case a sanitized record — the source row is untouched. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  CI_CORROBORATION, CI_CORROBORATION_EXPLAINER, CI_CORROBORATION_LABEL, ciCaseLink, ciCaseUnlink, ciHref,
  ciInvolved, ciIntelSetCorroboration, ciRefused, fetchCiCaseCounts, fetchCiCaseIntel, fetchCiList,
  useCiContext, type CiCaseIntelRow, type CiCorroboration, type CiListRow,
} from '@/lib/ci'
import { fmtDateTime } from '@/lib/format'
import { useTableVersion } from '@/lib/realtime'
import { toast } from '@/lib/toast'
import { IntelDialog } from '@/components/informants/IntelDialog'
import { SanitizeReleaseDialog } from '@/components/informants/SanitizeReleaseDialog'
import { corroborationLabel, corroborationTint, reliabilityLabel, sensitivityLabel, sensitivityTint } from '@/components/informants/ciShared'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { uiPrompt } from '@/components/ui/dialog'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { HelpTip } from '@/components/ui/HelpTip'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/Notice'
import { SectionHeader } from '@/components/ui/PageHeader'

/* ── The rail count ─────────────────────────────────────────────────────────
 * Cleanup C wires this into CaseDetail's tabDefs: the `ci` tab exists only
 * when the count is > 0. Fetched ONLY for an involved viewer — anyone else
 * gets a constant 0 and no request at all. Null while the first fetch is in
 * flight (the rail treats null like 0). */
export function useCiCaseCount(caseId: string): number | null {
  const { ctx, ready } = useCiContext()
  const involved = ciInvolved(ctx)
  const v = useTableVersion('ci_events')
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (!involved) return
    let live = true
    void (async () => {
      await Promise.resolve()
      const m = await fetchCiCaseCounts([caseId]).catch(() => new Map<string, number>())
      if (live) setCount(m.get(caseId) ?? 0)
    })()
    return () => { live = false }
  }, [involved, caseId, v])

  if (!involved) return ready ? 0 : null
  return count
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

interface Mention { kind: string; target_id: string; note?: string | null }

/** `links` is jsonb — accept only well-formed entries. */
function mentionsOf(links: unknown): Mention[] {
  if (!Array.isArray(links)) return []
  return links.flatMap((l) => {
    if (!l || typeof l !== 'object') return []
    const o = l as Record<string, unknown>
    return typeof o.kind === 'string' && typeof o.target_id === 'string'
      ? [{ kind: o.kind, target_id: o.target_id, note: typeof o.note === 'string' ? o.note : null }]
      : []
  })
}

/** "2 persons · 1 vehicle" — kinds only; the targets themselves are opened
 *  from the source profile, where the links live. */
function mentionSummary(ms: Mention[]): string | null {
  if (!ms.length) return null
  const by = new Map<string, number>()
  for (const m of ms) by.set(m.kind, (by.get(m.kind) ?? 0) + 1)
  return [...by.entries()].map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`).join(' · ')
}

const ciLabel = (ci: Pick<CiListRow, 'ci_number' | 'alias'>): string => ci.alias ? `${ci.ci_number} · ${ci.alias}` : ci.ci_number

/* ── The tab ──────────────────────────────────────────────────────────────── */

export function CiIntelligenceTab({ caseId }: { caseId: string }) {
  const { ctx } = useCiContext()
  const involved = ciInvolved(ctx)
  const fullAccess = involved && ctx.full_access
  const v = useTableVersion('ci_events')
  const [rows, setRows] = useState<CiCaseIntelRow[]>([])
  const [linked, setLinked] = useState<CiListRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [corrTarget, setCorrTarget] = useState<CiCaseIntelRow | null>(null)
  const [releaseTarget, setReleaseTarget] = useState<CiCaseIntelRow | null>(null)

  const load = useCallback(async () => {
    const [intel, cis] = await Promise.all([
      fetchCiCaseIntel(caseId).catch(() => [] as CiCaseIntelRow[]),
      fetchCiList({ case_id: caseId }).catch(() => [] as CiListRow[]),
    ])
    setRows(intel)
    setLinked(cis)
    setLoaded(true)
  }, [caseId])

  useEffect(() => {
    // Not involved → no request. Deferred so the effect body never sets
    // state synchronously (the ShiftsView idiom).
    if (!involved) return
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [involved, load, v])

  const unlink = async (ci: CiListRow) => {
    const reason = await uiPrompt(`Unlink ${ci.ci_number} from this case? Its intelligence rows keep their case reference; only the link is ended.`, {
      title: 'Unlink source', placeholder: 'Reason (required)', confirmText: 'Unlink',
    })
    if (reason === null) return
    if (reason.trim().length < 3) { toast('Give a reason for the unlink.', 'warn'); return }
    const r = await ciCaseUnlink(ci.id, caseId, reason.trim())
    if (ciRefused(r)) return
    toast(`${ci.ci_number} unlinked.`, 'success')
    void load()
  }

  if (!involved) return null

  return (
    <div className="space-y-4">
      <SectionHeader
        title="CI Intelligence"
        subtitle="Intelligence attributed to confidential sources linked to this case. Visible only to the sources' handlers and CI command — release a sanitized version for the case team."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setLinkOpen(true)}>Link source</Button>
            <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>Add intelligence</Button>
          </div>
        )}
      />

      {/* Linked sources — CI number (and alias) only, never the person. */}
      {linked.length > 0 && (
        <Card pad="sm">
          <p className="mb-2 text-xs font-semibold text-slate-400">Linked sources</p>
          <div className="flex flex-wrap gap-2">
            {linked.map((ci) => (
              <span key={ci.id} className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm text-slate-200">
                <Link href={ciHref(ci.id, 'cases')} className="truncate font-mono font-medium text-badge-300 hover:underline">{ciLabel(ci)}</Link>
                <button
                  type="button"
                  aria-label={`Unlink ${ci.ci_number} from this case`}
                  onClick={() => void unlink(ci)}
                  className="-my-2 -mr-2 grid h-10 w-10 place-items-center rounded-full text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </Card>
      )}

      {loaded && !rows.length && (
        <EmptyState
          title="No source intelligence on this case"
          hint="Add intelligence from one of your sources — the source is linked to the case as part of the record."
          action={{ label: 'Add intelligence', onClick: () => setAddOpen(true) }}
        />
      )}

      <ul className="space-y-3">
        {rows.map((r) => {
          const mentions = mentionsOf(r.links)
          const followUpOpen = r.follow_up_required && !r.follow_up_done_at
          return (
            <li key={r.id}>
              <Card pad="sm" className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <Link href={ciHref(r.ci_id, 'intelligence')} className="font-mono text-sm font-semibold text-badge-300 hover:underline">{r.ci_number}</Link>
                  {r.handler_name && <span>Handler {r.handler_name}</span>}
                  <span aria-hidden>·</span>
                  <span>Received {fmtDateTime(r.received_at)}</span>
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <Badge tint={sensitivityTint(r.sensitivity)}>{sensitivityLabel(r.sensitivity)}</Badge>
                    {followUpOpen && <Badge tone="warn">Follow-up open</Badge>}
                    {r.release_count > 0 && <Badge tone="good">Released ×{r.release_count}</Badge>}
                  </span>
                </div>

                <p className="text-sm font-semibold text-slate-100">{r.summary}</p>
                {r.body && <p className="whitespace-pre-wrap text-sm text-slate-300">{r.body}</p>}

                {/* The two questions, side by side and named. */}
                <div className="grid gap-2 rounded-lg border border-white/10 bg-ink-950/50 p-3 text-xs sm:grid-cols-2">
                  <div>
                    <p className="font-semibold text-slate-400">Source said · reliability</p>
                    <p className="mt-1 text-slate-200">{reliabilityLabel(r.reliability)}</p>
                  </div>
                  <div>
                    <p className="flex items-center gap-1 font-semibold text-slate-400">
                      Investigation confirmed · corroboration
                      <HelpTip label="About corroboration" align="right">{CI_CORROBORATION_EXPLAINER}</HelpTip>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge tint={corroborationTint(r.corroboration)}>{corroborationLabel(r.corroboration)}</Badge>
                      {r.corroboration_note && <span className="text-slate-300">{r.corroboration_note}</span>}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {mentions.length > 0 && <span className="text-xs text-slate-400">Mentions {mentionSummary(mentions)}</span>}
                  <span className="ml-auto flex flex-wrap gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setCorrTarget(r)}>Set corroboration</Button>
                    {fullAccess && <Button size="sm" onClick={() => setReleaseTarget(r)}>Sanitize / Release</Button>}
                  </span>
                </div>
              </Card>
            </li>
          )
        })}
      </ul>

      {/* One linked source → it is the source; otherwise the dialog offers the
          caller's own sources (ci_intel_create links the case when missing). */}
      {addOpen && (
        <IntelDialog open onClose={() => setAddOpen(false)} ciId={linked.length === 1 ? linked[0].id : null} caseId={caseId} onSaved={() => void load()} />
      )}
      {linkOpen && <LinkSourceDialog caseId={caseId} linked={linked} onClose={() => setLinkOpen(false)} onLinked={() => void load()} />}
      {corrTarget && <CorroborationDialog row={corrTarget} onClose={() => setCorrTarget(null)} onSaved={() => void load()} />}
      {releaseTarget && (
        <SanitizeReleaseDialog
          open
          onClose={() => setReleaseTarget(null)}
          intel={{ id: releaseTarget.id, ci_number: releaseTarget.ci_number, summary: releaseTarget.summary, handler_name: releaseTarget.handler_name }}
          subject={{ alias: linked.find((c) => c.id === releaseTarget.ci_id)?.alias, name: linked.find((c) => c.id === releaseTarget.ci_id)?.person_name }}
          onReleased={() => void load()}
        />
      )}
    </div>
  )
}

/* ── Set corroboration ────────────────────────────────────────────────────── */
function CorroborationDialog({ row, onClose, onSaved }: { row: CiCaseIntelRow; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<CiCorroboration>((CI_CORROBORATION as readonly string[]).includes(row.corroboration) ? row.corroboration as CiCorroboration : 'unverified')
  const [note, setNote] = useState(row.corroboration_note ?? '')
  const [busy, setBusy] = useState(false)
  const dirty = () => value !== row.corroboration || note !== (row.corroboration_note ?? '')

  const save = async () => {
    setBusy(true)
    const r = await ciIntelSetCorroboration(row.id, value, note.trim() || null)
    setBusy(false)
    if (ciRefused(r)) return
    toast('Corroboration recorded.', 'success')
    onSaved()
    onClose()
  }

  return (
    <Modal open onClose={onClose} dirty={dirty}>
      <div className="p-6">
        <ModalHeader title="Set corroboration" onClose={onClose} />
        <div className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-ink-950/50 p-3 text-xs">
            <p className="font-semibold text-slate-400">Source said</p>
            <p className="mt-1 text-sm text-slate-200">{row.summary}</p>
            <p className="mt-1 text-slate-400">Reliability {reliabilityLabel(row.reliability)} — the source&apos;s own grade. It does not change here.</p>
          </div>
          <p className="text-xs text-slate-400">{CI_CORROBORATION_EXPLAINER}</p>
          <Field label="Investigation confirmed" required>
            {(id) => (
              <Select id={id} value={value} onChange={(e) => setValue(e.target.value as CiCorroboration)}>
                {CI_CORROBORATION.map((c) => <option key={c} value={c}>{CI_CORROBORATION_LABEL[c]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="How it was confirmed (or not)" hint="What the investigation did — the record, the witness, the surveillance — not what the source said.">
            {(id) => <Textarea id={id} rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Confirmed by…" />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} loading={busy}>Save</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

/* ── Link a source to this case ───────────────────────────────────────────── */
function LinkSourceDialog({ caseId, linked, onClose, onLinked }: { caseId: string; linked: CiListRow[]; onClose: () => void; onLinked: () => void }) {
  const [options, setOptions] = useState<CiListRow[] | null>(null)
  const [ci, setCi] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const linkedIds = useMemo(() => new Set(linked.map((l) => l.id)), [linked])

  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      // Only the sources the viewer can access come back (RLS) — a handler
      // sees their own, full access the roster.
      const rows = await fetchCiList({}, 200).catch(() => [] as CiListRow[])
      if (live) setOptions(rows.filter((r) => !linkedIds.has(r.id) && !r.deleted_at))
    })()
    return () => { live = false }
  }, [linkedIds])

  const save = async () => {
    if (!ci) return
    setBusy(true)
    const r = await ciCaseLink(ci, caseId, note.trim() || null)
    setBusy(false)
    if (ciRefused(r)) return
    toast('Source linked to the case.', 'success')
    onLinked()
    onClose()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!ci || !!note}>
      <div className="p-6">
        <ModalHeader title="Link a source to this case" onClose={onClose} />
        <div className="space-y-4">
          <Field label="Source" required hint="Only sources you handle (or, with CI command access, the roster) are offered.">
            {(id) => (
              <Select id={id} value={ci} onChange={(e) => setCi(e.target.value)} disabled={options === null}>
                <option value="">{options === null ? 'Loading…' : options.length ? 'Choose a source…' : 'No further sources available'}</option>
                {(options ?? []).map((o) => <option key={o.id} value={o.id}>{ciLabel(o)}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Link note (optional)">
            {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this source matters to the case" />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button variant="primary" onClick={() => void save()} disabled={!ci} loading={busy}>Link source</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
