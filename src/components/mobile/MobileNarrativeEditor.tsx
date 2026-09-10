'use client'

/** Mobile narrative editing (P8-07, contract §2.5). One RichEditor per
 *  narrative section of the report's PINNED template (lib/reportNarrative
 *  narrativeSections — `textarea` minus `mediaPick`). Autosave: 1.5 s after
 *  the last keystroke → update('reports', id, { fields }) — the SAME write
 *  ReportsTab makes — with each edited key merged into the CURRENT fields
 *  jsonb (mergeNarrativeFields), so grids, pick-lists and the `_warrant_*`
 *  metadata are never dropped. The fields trigger is the authority: a
 *  submitted / sealed report refuses the write and the refusal is shown.
 *
 *  Failure posture: a failed or offline save keeps the narrative in the
 *  per-user draft layer (userDrafts, key `report:<id>:narrative` — local
 *  mirror first, server when reachable) and retries when the tab becomes
 *  visible, regains focus or the network comes back. A stash newer than the
 *  row is restored and flushed on open. Submit / seal / review are rendered
 *  disabled — those decisions are made from the desktop. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Json } from '@/lib/database.types'
import { update } from '@/lib/db'
import type { FormValues } from '@/lib/forms'
import { parseFormValues } from '@/lib/jsonShapes'
import { mergeNarrativeFields, narrativeSections } from '@/lib/reportNarrative'
import { resolveReportVersion, type TemplateCatalog, type TemplateVersion } from '@/lib/reportTemplates'
import { toast } from '@/lib/toast'
import { clearDraft, loadDraft, saveDraft, type DraftSaveStatus } from '@/lib/userDrafts'
import type { ReportRow } from '@/components/cases/tabs/shared'
import { writeRefusal } from '@/components/cases/sections/sectionShared'
import { ChevronIcon } from '@/components/shell/icons'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field } from '@/components/ui/Field'
import { EmptyState, Notice } from '@/components/ui/Notice'
import { RichEditor } from '@/components/ui/RichEditor'
import { SaveState } from '@/components/ui/SaveState'
import { DetailSkeleton } from '@/components/ui/Skeleton'
import { OpenOnDesktop } from './mobileShared'

const DEBOUNCE_MS = 1500
/** key → markdown, the shape stashed under `report:<id>:narrative`. */
type NarrativeDraft = Record<string, string>

export function MobileNarrativeEditor({ report, title, catalog, onBack }: {
  report: ReportRow
  title: string
  catalog: TemplateCatalog | null
  onBack: () => void
}) {
  const draftKey = `report:${report.id}:narrative`
  const [version, setVersion] = useState<TemplateVersion | null | undefined>(undefined)
  /** Editors mount once the row + any stash have been reconciled (RichEditor's value is initial-only). */
  const [initial, setInitial] = useState<NarrativeDraft | null>(null)
  const [status, setStatus] = useState<DraftSaveStatus>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [refused, setRefused] = useState<string | null>(null)

  // The server's current fields (refreshed from every successful write), the
  // latest text per key, the keys not yet landed, and the debounce timer.
  const baseRef = useRef<FormValues>(parseFormValues(report.fields))
  const latestRef = useRef<NarrativeDraft>({})
  const pendingRef = useRef<Set<string>>(new Set())
  const inFlightRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flushRef = useRef<() => Promise<void>>(async () => {})

  const schedule = useCallback((ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { timerRef.current = null; void flushRef.current() }, ms)
  }, [])

  const flush = useCallback(async () => {
    if (inFlightRef.current || pendingRef.current.size === 0) return
    const keys = [...pendingRef.current]
    const snapshot: NarrativeDraft = {}
    let merged: FormValues = baseRef.current
    for (const k of keys) {
      snapshot[k] = latestRef.current[k] ?? ''
      merged = mergeNarrativeFields(merged, k, snapshot[k])
    }
    inFlightRef.current = true
    setStatus('saving')
    let refusal: string | null = null
    try {
      const res = await update('reports', report.id, { fields: merged as Json })
      refusal = writeRefusal(res)
      if (!refusal) baseRef.current = res.data?.[0] ? parseFormValues(res.data[0].fields) : merged
    } catch (e) {
      refusal = e instanceof Error ? e.message : 'Could not save.'
    }
    inFlightRef.current = false
    if (refusal) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      setStatus(offline ? 'offline' : 'error')
      setRefused(offline ? null : refusal)
      void saveDraft(draftKey, { ...latestRef.current })
      return
    }
    setRefused(null)
    for (const k of keys) if (latestRef.current[k] === snapshot[k]) pendingRef.current.delete(k)
    if (pendingRef.current.size) { schedule(DEBOUNCE_MS); return } // typed meanwhile
    setStatus('saved')
    setLastSavedAt(Date.now())
    void clearDraft(draftKey)
  }, [report.id, draftKey, schedule])
  useEffect(() => { flushRef.current = flush })

  // Resolve the pinned version and reconcile a stashed draft — once per report.
  useEffect(() => {
    let alive = true
    void (async () => {
      const [ver, draft] = await Promise.all([
        resolveReportVersion({ template: report.template, template_version_id: report.template_version_id }, catalog?.templates),
        loadDraft<NarrativeDraft>(draftKey),
      ])
      if (!alive) return
      const keys = narrativeSections(ver?.schema).map((s) => s.key)
      const start: NarrativeDraft = {}
      for (const k of keys) start[k] = String(baseRef.current[k] ?? '')
      // A stash newer than the row is an edit the server never received.
      if (draft && draft.data && typeof draft.data === 'object' && draft.at > Date.parse(report.updated_at)) {
        for (const k of keys) {
          const v = draft.data[k]
          if (typeof v === 'string' && v !== start[k]) { start[k] = v; pendingRef.current.add(k) }
        }
        if (pendingRef.current.size) toast('Unsaved narrative restored — saving it now.', 'info')
      }
      Object.assign(latestRef.current, start) // same object — the unmount cleanup holds a reference to it
      setVersion(ver)
      setInitial(start)
      if (pendingRef.current.size) schedule(0)
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only reconcile (the catalog at mount time is enough: pinned versions resolve by id)
  }, [report.id])

  // Retry on visibility / focus / network return; guard a hard reload while
  // a save is still pending; flush (and stash) on unmount.
  useEffect(() => {
    // Both ref objects are stable for the component's life (mutated, never
    // reassigned), so the cleanup below may hold them directly.
    const pending = pendingRef.current
    const latest = latestRef.current
    const retry = () => { if (document.visibilityState === 'visible' && pending.size) void flushRef.current() }
    const guard = (e: BeforeUnloadEvent) => { if (pending.size) e.preventDefault() }
    document.addEventListener('visibilitychange', retry)
    window.addEventListener('focus', retry)
    window.addEventListener('online', retry)
    window.addEventListener('beforeunload', guard)
    return () => {
      document.removeEventListener('visibilitychange', retry)
      window.removeEventListener('focus', retry)
      window.removeEventListener('online', retry)
      window.removeEventListener('beforeunload', guard)
      if (timerRef.current) clearTimeout(timerRef.current)
      if (pending.size) { void saveDraft(draftKey, { ...latest }); void flushRef.current() }
    }
  }, [draftKey])

  const edit = (key: string, md: string) => {
    if (md === latestRef.current[key]) return
    latestRef.current[key] = md
    pendingRef.current.add(key)
    setStatus('saving')
    schedule(DEBOUNCE_MS)
  }

  if (version === undefined || initial === null) return <DetailSkeleton />
  const sections = narrativeSections(version?.schema)

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="md" onClick={onBack} className="-ml-2 pl-1">
          <ChevronIcon dir="left" /> Reports
        </Button>
        <SaveState status={status} lastSavedAt={lastSavedAt} />
      </div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {refused && <Notice text={refused} className="border-rose-500/20 bg-rose-500/5 text-rose-200" />}
      {!version && <Notice text="This report's template could not be loaded — open it on the desktop." />}
      {sections.length === 0 ? (
        <EmptyState title="No narrative sections" hint="This template has no free-text sections; edit the report on the desktop." />
      ) : (
        sections.map((s) => (
          <Card key={s.key} pad="sm">
            <Field label={s.label} hint="Markdown. Saves by itself a moment after you stop typing.">
              {(id) => <RichEditor id={id} value={initial[s.key] ?? ''} onChange={(md) => edit(s.key, md)} minHeight="12rem" />}
            </Field>
          </Card>
        ))
      )}
      <Card pad="sm" className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="warn" disabled title="Submit from the desktop">Submit for review</Button>
          <Button variant="success" disabled title="Submit from the desktop">Seal</Button>
          <Button variant="secondary" disabled title="Submit from the desktop">Review</Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-400">Submit from the desktop.</p>
          <OpenOnDesktop caseId={report.case_id} section="reports" report={report.id} look="ghost" />
        </div>
      </Card>
    </>
  )
}
