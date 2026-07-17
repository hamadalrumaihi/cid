'use client'

import type { Tables } from '@/lib/database.types'
import { toast } from '@/lib/toast'

export type CaseRow = Tables<'cases'>
export type TaskRow = Tables<'case_tasks'>
export type MessageRow = Tables<'case_messages'>
export type HistoryRow = Tables<'case_signoff_history'>
export type EvidenceRow = Tables<'evidence'>
export type ReportRow = Tables<'reports'>
export type AssignmentRow = Tables<'case_assignments'>
export type MediaRow = Tables<'media'>
export type RicoRow = Tables<'rico_cases'>
export type PredicateRow = Tables<'predicate_acts'>
export type GangRow = Tables<'gangs'>
export type IntelRow = Tables<'case_intel_links'>
export type PersonRow = Tables<'persons'>
export type PlaceRow = Tables<'places'>

/** One-click row mutations (delete chips, detach) previously discarded the
 *  returned {error}, so an RLS-denied or failed write looked like a silent
 *  no-op. Toast the reason on failure; refresh on success. */
export function mutateThen(p: Promise<{ error: { message: string } | null }>, refresh: () => void): void {
  void p.then((r) => { if (r.error) toast(r.error.message, 'danger'); else refresh() })
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-ink-950/50 p-4"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p><p className="mt-2 text-lg font-bold text-white">{value}</p></div>
}
