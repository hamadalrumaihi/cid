'use client'

/** One source's file (`?ci=<id>`, sections via `?s=`): overview · handlers ·
 *  contacts · intelligence · assessments · payments · cases · audit.
 *
 *  `ci_get` answers null for anyone the compartment does not admit — the
 *  profile then renders the same "Nothing to show here" surface the roster
 *  does, never "restricted". Every list below is an RLS-scoped read of the
 *  child tables; every write is a definer RPC whose refusal is toasted in the
 *  server's words. Visits are not pushed into recents or pins. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import type { Json } from '@/lib/database.types'
import type { EntityHit } from '@/lib/entitySearch'
import { registryHref } from '@/lib/fieldConvert'
import { fmtDate, fmtDateTime, fmtUSD, timeAgo } from '@/lib/format'
import { officerName, useProfilesStore } from '@/lib/profiles'
import { BUREAUS, bureauLabel } from '@/lib/roles'
import { toast } from '@/lib/toast'
import { TRASH_LINK } from '@/lib/deleteRecord'
import {
  CI_CORROBORATION, CI_CORROBORATION_EXPLAINER, CI_CORROBORATION_LABEL, CI_MOTIVES, CI_MOTIVE_LABEL, CI_RELIABILITY,
  CI_RELIABILITY_LABEL, CI_RISK, CI_RISK_LABEL, CI_SECTIONS, ciCaseLink, ciCaseUnlink, ciContactDelete, ciExport,
  ciIntelDelete, ciIntelSetCorroboration, ciPaymentApprove, ciRefused, ciSoftDelete, ciUpdate, contactState, fetchCi,
  fetchCiAssessments, fetchCiAudit, fetchCiContacts, fetchCiIntel, fetchCiIntelLinks, fetchCiPayments, groupHandlers,
  motiveSummary, type CiAssessmentRow, type CiAuditRow, type CiContactRow, type CiContext, type CiDetail,
  type CiIntelLinkRow, type CiIntelRow, type CiPaymentRow, type CiSection, type CiStatsHandler,
} from '@/lib/ci'
import { ActionMenu, type ActionItem } from '@/components/ui/ActionMenu'
import { Badge } from '@/components/ui/Badge'
import { Breadcrumbs } from '@/components/ui/Breadcrumbs'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { MetricStrip } from '@/components/ui/MetricStrip'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/Notice'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { SectionTabs, panelDomId, tabDomId } from '@/components/ui/SectionTabs'
import { DetailSkeleton, ListSkeleton } from '@/components/ui/Skeleton'
import { uiConfirm, uiPrompt } from '@/components/ui/dialog'
import { AssessmentDialog } from './AssessmentDialog'
import { ContactLogDialog } from './ContactLogDialog'
import { IntelDialog, type IntelMention } from './IntelDialog'
import { PaymentDialog } from './PaymentDialog'
import { ReassignHandlerDialog } from './ReassignHandlerDialog'
import { RemoveHandlerDialog } from './RemoveHandlerDialog'
import { StatusDialog } from './StatusDialog'
import {
  CasePicker, CiStatusBadge, NothingHere, ciReliabilityTint, ciRiskTint, contactStateLabel, contactStateTint,
  corroborationLabel, corroborationTint, gradeLabel, reliabilityLabel, riskLabel, sensitivityLabel, sensitivityTint,
  toLocalInput, fromLocalInput,
} from './ciShared'
import { downloadCiJson, downloadCiPdf } from './ciExport'

const SECTION_LABEL: Record<CiSection, string> = {
  overview: 'Overview', handlers: 'Handlers', contacts: 'Contacts', intelligence: 'Intelligence',
  assessments: 'Assessments', payments: 'Payments', cases: 'Cases', audit: 'Audit',
}

const MENTION_KINDS = new Set(['person', 'vehicle', 'gang', 'place', 'narcotic'])

export function CiProfile({ ciId, section, onSection, onBack, ctx, version, handlerStats, onChanged }: {
  ciId: string
  section: CiSection
  onSection: (s: CiSection) => void
  onBack: () => void
  ctx: CiContext
  /** `ci_events` version — refetch when it moves. */
  version: number
  handlerStats?: CiStatsHandler[] | null
  onChanged?: () => void
}) {
  const { profile } = useAuth()
  const uid = profile?.id ?? null
  const full = ctx.full_access
  const [ci, setCi] = useState<CiDetail | null | undefined>(undefined)
  const [contacts, setContacts] = useState<CiContactRow[] | null>(null)
  const [intel, setIntel] = useState<CiIntelRow[] | null>(null)
  const [links, setLinks] = useState<CiIntelLinkRow[]>([])
  const [assessments, setAssessments] = useState<CiAssessmentRow[] | null>(null)
  const [payments, setPayments] = useState<CiPaymentRow[] | null>(null)
  const [audit, setAudit] = useState<CiAuditRow[] | null>(null)
  const [dialog, setDialog] = useState<
    | { kind: 'edit' } | { kind: 'status' } | { kind: 'reassign'; role: 'primary' | 'secondary' } | { kind: 'remove' }
    | { kind: 'contact' } | { kind: 'intel'; row?: CiIntelRow } | { kind: 'corroborate'; row: CiIntelRow }
    | { kind: 'assess' } | { kind: 'payment' } | { kind: 'link_case' } | null
  >(null)
  const loaded = useProfilesStore((s) => s.loaded)
  useEffect(() => { if (!loaded) void useProfilesStore.getState().fetch() }, [loaded])

  const reload = useCallback(async () => {
    const d = await fetchCi(ciId)
    setCi(d)
    if (!d) return
    const [c, i, a, p, au] = await Promise.all([fetchCiContacts(ciId), fetchCiIntel(ciId), fetchCiAssessments(ciId), fetchCiPayments(ciId), fetchCiAudit(ciId)])
    setContacts(c); setIntel(i); setAssessments(a); setPayments(p); setAudit(au)
    setLinks(await fetchCiIntelLinks(i.map((x) => x.id)))
  }, [ciId])

  useEffect(() => {
    const t = window.setTimeout(() => { void reload() }, 0)
    return () => window.clearTimeout(t)
  }, [reload, version])

  const changed = () => { void reload(); onChanged?.() }

  const handlers = useMemo(() => groupHandlers(ci?.handlers ?? []), [ci])

  if (ci === undefined) return <DetailSkeleton />
  if (ci === null) return <NothingHere />

  const st = contactState(ci)
  const tabs = CI_SECTIONS.map((s) => ({
    id: s, label: SECTION_LABEL[s],
    count: s === 'contacts' ? ci.counts.contacts : s === 'intelligence' ? ci.counts.intel : s === 'payments' ? ci.counts.payments
      : s === 'cases' ? ci.cases.length : s === 'handlers' ? (ci.handlers ?? []).filter((h) => !h.ended_at).length : undefined,
    marker: s === 'contacts' && st === 'overdue',
    markerLabel: 'Contact overdue',
  }))

  const exportAs = async (fmt: 'pdf' | 'json') => {
    const r = await ciExport(ci.id, 'profile')
    if (ciRefused(r)) return
    if (fmt === 'json') downloadCiJson(r.doc, 'profile')
    else await downloadCiPdf(r.doc, 'profile', profile?.display_name ?? 'Member')
    toast('Export recorded.', 'success')
  }

  const deleteCi = async () => {
    if (!(await uiConfirm(`Move ${ci.ci_number} to the Trash? Its intelligence, contacts and payments go with it. CI command can restore it.`, { title: 'Delete source record', confirmText: 'Delete' }))) return
    const reason = await uiPrompt(`Reason for deleting ${ci.ci_number}`, { title: 'Reason required', placeholder: 'Why the record is being removed…', confirmText: 'Delete' })
    if (reason === null) return
    if (!reason.trim()) { toast('A reason is required.', 'warn'); return }
    const r = await ciSoftDelete(ci.id, reason.trim())
    if (ciRefused(r)) return
    toast(`${ci.ci_number} moved to the Trash.`, 'success', { link: TRASH_LINK })
    onChanged?.()
    onBack()
  }

  const menu: ActionItem[] = [
    { label: 'Edit details…', onClick: () => setDialog({ kind: 'edit' }) },
    { label: 'Export PDF', onClick: () => { void exportAs('pdf') } },
    { label: 'Export JSON', onClick: () => { void exportAs('json') } },
    ...(full ? [
      { label: 'Change status…', onClick: () => setDialog({ kind: 'status' }), separatorBefore: true },
      { label: 'Delete source record…', danger: true, separatorBefore: true, onClick: () => { void deleteCi() } },
    ] : []),
  ]

  return (
    <section className="view-in space-y-4">
      <Breadcrumbs items={[{ label: 'Confidential Informants', onClick: onBack }, { label: ci.ci_number }]} />
      <PageHeader
        eyebrow={`${bureauLabel(ci.bureau)} · recruited ${ci.recruited_at ? fmtDate(ci.recruited_at) : '—'}`}
        title={ci.alias ? `${ci.ci_number} · “${ci.alias}”` : ci.ci_number}
        subtitle={`Source: ${ci.person_name ?? 'person on file'}`}
        actions={
          <>
            <CiStatusBadge status={ci.status} />
            <Badge tint={ciRiskTint(ci.risk)}>{riskLabel(ci.risk)} risk</Badge>
            <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'contact' })}>Log contact</Button>
            <Button size="sm" onClick={() => setDialog({ kind: 'intel' })}>Add intelligence</Button>
            <ActionMenu items={menu} label={`Actions for ${ci.ci_number}`} />
          </>
        }
      />
      {ci.deleted_at && <p className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-2 text-sm text-rose-200">This record is in the Trash (deleted {fmtDateTime(ci.deleted_at)}).</p>}

      <SectionTabs tabs={tabs} active={section} onChange={onSection} idBase="ci" ariaLabel="Source sections" />

      <div role="tabpanel" id={panelDomId('ci', section)} aria-labelledby={tabDomId('ci', section)}>
        {section === 'overview' && (
          <div className="space-y-4">
            <MetricStrip metrics={[
              { label: 'Status', value: <CiStatusBadge status={ci.status} />, hint: `since ${fmtDate(ci.status_changed_at)}` },
              { label: 'Reliability', value: reliabilityLabel(ci.reliability), tint: ciReliabilityTint(ci.reliability), onClick: () => onSection('assessments') },
              { label: 'Risk', value: riskLabel(ci.risk), tint: ciRiskTint(ci.risk), onClick: () => onSection('assessments') },
              { label: 'Contact', value: contactStateLabel(st), tint: st === 'ok' || st === 'none' ? undefined : contactStateTint(st), hint: ci.next_contact_at ? `next ${fmtDate(ci.next_contact_at)}` : ci.last_contact_at ? `last ${timeAgo(ci.last_contact_at)}` : undefined, onClick: () => onSection('contacts') },
              { label: 'Intelligence', value: ci.counts.intel, onClick: () => onSection('intelligence') },
              { label: 'Cases', value: ci.cases.length, onClick: () => onSection('cases') },
              { label: 'Releases', value: ci.counts.releases, hint: 'sanitized to cases' },
            ]} />
            <div className="grid gap-4 lg:grid-cols-2">
              <Card pad="md" className="space-y-2">
                <SectionHeader title="Identity" />
                <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[9rem_1fr]">
                  <dt className="text-slate-400">Person</dt>
                  <dd><Link href={registryHref('person', ci.person_id)} className="font-medium text-badge-200 hover:text-white">{ci.person_name ?? 'Open record'}</Link></dd>
                  <dt className="text-slate-400">Alias</dt><dd className="text-slate-100">{ci.alias || '—'}</dd>
                  <dt className="text-slate-400">Bureau</dt><dd className="text-slate-100">{bureauLabel(ci.bureau)}</dd>
                  <dt className="text-slate-400">Supervising lead</dt><dd className="text-slate-100">{ci.supervising_lead_name ?? officerName(ci.supervising_lead_id) ?? '—'}</dd>
                  <dt className="text-slate-400">Recruited by</dt><dd className="text-slate-100">{ci.recruited_by_name ?? officerName(ci.recruited_by) ?? '—'}</dd>
                  <dt className="text-slate-400">Status reason</dt><dd className="text-slate-100">{ci.status_reason || '—'}</dd>
                </dl>
              </Card>
              <Card pad="md" className="space-y-2">
                <SectionHeader title="Motive" />
                <p className="text-sm font-medium text-slate-100">{motiveSummary(ci.motive_primary, ci.motive_secondary)}</p>
                <p className="whitespace-pre-wrap text-sm text-slate-300">{ci.motive_explanation || <span className="text-slate-500">No explanation recorded.</span>}</p>
              </Card>
              <Card pad="md" className="space-y-2">
                <SectionHeader title="Handlers" actions={<Button size="sm" onClick={() => onSection('handlers')}>Manage</Button>} />
                <HandlerLine label="Primary" h={handlers.primary} />
                <HandlerLine label="Secondary" h={handlers.secondary} />
              </Card>
              <Card pad="md" className="space-y-2">
                <SectionHeader title="Recruitment notes" />
                <p className="whitespace-pre-wrap text-sm text-slate-300">{ci.recruitment_notes || <span className="text-slate-500">None recorded.</span>}</p>
              </Card>
            </div>
          </div>
        )}

        {section === 'handlers' && (
          <div className="space-y-4">
            <SectionHeader title="Handlers" subtitle="Who may see and work this source. Only CI command changes it."
              actions={full && (
                <>
                  <Button size="sm" onClick={() => setDialog({ kind: 'reassign', role: 'primary' })}>{handlers.primary ? 'Replace primary' : 'Assign primary'}</Button>
                  <Button size="sm" onClick={() => setDialog({ kind: 'reassign', role: 'secondary' })}>{handlers.secondary ? 'Replace secondary' : 'Assign secondary'}</Button>
                  {(handlers.primary || handlers.secondary) && <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'remove' })}>Remove…</Button>}
                </>
              )} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Card pad="md"><HandlerLine label="Primary handler" h={handlers.primary} detailed /></Card>
              <Card pad="md"><HandlerLine label="Secondary handler" h={handlers.secondary} detailed /></Card>
            </div>
            {full && !!ci.handler_history?.length && (
              <Card pad="sm">
                <SectionHeader title="History" className="mb-2" />
                <ul className="divide-y divide-white/5 text-sm">
                  {groupHandlers(ci.handler_history).history.map((h, i) => (
                    <li key={h.id ?? i} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="font-medium text-slate-100">{h.name ?? officerName(h.user_id) ?? 'Member'}</span>
                      <Badge tone="neutral">{h.role}</Badge>
                      <span className="text-xs text-slate-400">{h.assigned_at ? fmtDate(h.assigned_at) : '—'} → {h.ended_at ? fmtDate(h.ended_at) : 'now'}</span>
                      {h.end_reason && <span className="w-full text-xs text-slate-300 sm:w-auto">{h.end_reason}</span>}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        )}

        {section === 'contacts' && (
          <div className="space-y-3">
            <SectionHeader title="Contacts" subtitle={ci.next_contact_at ? `Next contact ${fmtDateTime(ci.next_contact_at)}` : 'No next contact scheduled'}
              actions={<Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'contact' })}>Log contact</Button>} />
            {contacts === null ? <ListSkeleton count={3} /> : !contacts.length ? (
              <EmptyState title="No contacts logged" hint="Log the first meeting to start the cadence." action={{ label: 'Log contact', onClick: () => setDialog({ kind: 'contact' }) }} />
            ) : (
              <ul className="space-y-2">
                {contacts.map((c) => (
                  <li key={c.id}>
                    <Card pad="sm" className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="font-semibold text-slate-200">{fmtDateTime(c.occurred_at)}</span>
                        <Badge tone="neutral">{c.method.replace('_', ' ')}</Badge>
                        <span>{officerName(c.handler_id) ?? 'Handler'}</span>
                        {c.location && <span>· {c.location}</span>}
                        {c.follow_up_required && <Badge tone="warn">Follow-up</Badge>}
                        {c.case_id && <Link href={caseLink(c.case_id)} className="text-badge-200 hover:text-white">Case</Link>}
                        {(full || c.handler_id === uid) && (
                          <span className="ml-auto">
                            <ActionMenu label="Contact actions" items={[{
                              label: 'Delete…', danger: true, onClick: () => { void (async () => {
                                const reason = await uiPrompt('Reason for deleting this contact entry', { title: 'Delete contact', confirmText: 'Delete' })
                                if (reason === null) return
                                const r = await ciContactDelete(c.id, reason.trim() || null)
                                if (ciRefused(r)) return
                                toast('Contact deleted.', 'success', { link: TRASH_LINK }); changed()
                              })() },
                            }]} />
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-200">{c.summary}</p>
                      {c.restricted_notes && <p className="text-xs text-slate-300"><span className="text-slate-400">Restricted:</span> {c.restricted_notes}</p>}
                      {c.next_contact_at && <p className="text-xs text-slate-400">Next: {fmtDateTime(c.next_contact_at)}</p>}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {section === 'intelligence' && (
          <div className="space-y-3">
            <SectionHeader title="Intelligence" subtitle={CI_CORROBORATION_EXPLAINER}
              actions={<Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'intel' })}>Add intelligence</Button>} />
            {intel === null ? <ListSkeleton count={3} /> : !intel.length ? (
              <EmptyState title="No intelligence yet" hint="What the source reports is recorded here and stays inside the compartment until CI command releases a sanitized version to a case." action={{ label: 'Add intelligence', onClick: () => setDialog({ kind: 'intel' }) }} />
            ) : (
              <ul className="space-y-2">
                {intel.map((i) => {
                  const mine = i.handler_id === uid || i.created_by === uid
                  const ls = links.filter((l) => l.intel_id === i.id)
                  return (
                    <li key={i.id}>
                      <Card pad="sm" className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-100">{i.summary}</span>
                          <Badge tint={corroborationTint(i.corroboration)} title={CI_CORROBORATION_EXPLAINER}>{corroborationLabel(i.corroboration)}</Badge>
                          <Badge tint={sensitivityTint(i.sensitivity)}>{sensitivityLabel(i.sensitivity)}</Badge>
                          {i.follow_up_required && <Badge tone={i.follow_up_done_at ? 'neutral' : 'warn'}>{i.follow_up_done_at ? 'Follow-up done' : 'Follow-up'}</Badge>}
                          <span className="ml-auto">
                            <ActionMenu label="Intelligence actions" items={[
                              { label: 'Set corroboration…', onClick: () => setDialog({ kind: 'corroborate', row: i }) },
                              ...(mine || full ? [{ label: 'Edit…', onClick: () => setDialog({ kind: 'intel', row: i }) }] : []),
                              ...(mine || full ? [{
                                label: 'Archive…', danger: true, separatorBefore: true, onClick: () => { void (async () => {
                                  const reason = await uiPrompt('Reason for archiving this intelligence', { title: 'Archive intelligence', confirmText: 'Archive' })
                                  if (reason === null) return
                                  const r = await ciIntelDelete(i.id, reason.trim() || null)
                                  if (ciRefused(r)) return
                                  toast('Intelligence archived.', 'success', { link: TRASH_LINK }); changed()
                                })() },
                              }] : []),
                            ]} />
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">
                          {fmtDateTime(i.received_at)} · {officerName(i.handler_id) ?? 'Handler'} · source reliability {reliabilityLabel(i.reliability).toLowerCase()}
                          {i.case_id && <> · <Link href={caseLink(i.case_id, 'ci')} className="text-badge-200 hover:text-white">Case</Link></>}
                        </p>
                        {i.body && <p className="whitespace-pre-wrap text-sm text-slate-200">{i.body}</p>}
                        {i.corroboration_note && <p className="text-xs text-slate-300"><span className="text-slate-400">Corroboration note:</span> {i.corroboration_note}</p>}
                        {i.handler_notes && <p className="text-xs text-slate-300"><span className="text-slate-400">Handler notes:</span> {i.handler_notes}</p>}
                        {ls.length > 0 && (
                          <p className="text-xs text-slate-400">Mentions: {ls.map((l) => l.kind).join(', ')} ({ls.length})</p>
                        )}
                      </Card>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}

        {section === 'assessments' && (
          <div className="space-y-3">
            <SectionHeader title="Assessments" subtitle="Periodic grading; the latest reliability and risk are copied onto the source."
              actions={<Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'assess' })}>New assessment</Button>} />
            {assessments === null ? <ListSkeleton count={2} /> : !assessments.length ? (
              <EmptyState title="Not yet assessed" hint="Record the first assessment to grade reliability, access and risk." action={{ label: 'Assess', onClick: () => setDialog({ kind: 'assess' }) }} />
            ) : (
              <ul className="space-y-2">
                {assessments.map((a) => (
                  <li key={a.id}>
                    <Card pad="sm" className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span className="font-semibold text-slate-200">{fmtDateTime(a.assessed_at)}</span>
                        <span>{officerName(a.assessed_by) ?? 'Member'}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tint={ciReliabilityTint(a.reliability)}>Reliability {reliabilityLabel(a.reliability)}</Badge>
                        <Badge tint={ciRiskTint(a.risk)}>Risk {riskLabel(a.risk)}</Badge>
                        <Badge tone="neutral">Credibility {gradeLabel(a.credibility)}</Badge>
                        <Badge tone="neutral">Access {gradeLabel(a.access)}</Badge>
                        <Badge tone="neutral">Compromise {gradeLabel(a.compromise_likelihood)}</Badge>
                        <Badge tone="neutral">Usefulness {gradeLabel(a.usefulness)}</Badge>
                      </div>
                      {a.note && <p className="text-sm text-slate-200">{a.note}</p>}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {section === 'payments' && (
          <div className="space-y-3">
            <SectionHeader title="Payments" subtitle="Recordkeeping only. CI command approves entries recorded by a handler."
              actions={<Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'payment' })}>Record payment</Button>} />
            {payments === null ? <ListSkeleton count={2} /> : !payments.length ? (
              <EmptyState title="No payments recorded" />
            ) : (
              <ul className="space-y-2">
                {payments.map((p) => (
                  <li key={p.id}>
                    <Card pad="sm" className="flex flex-wrap items-center gap-3">
                      <span className="text-base font-bold tabular-nums text-white">{fmtUSD(p.amount)}</span>
                      <span className="text-sm text-slate-200">{p.reason}</span>
                      <span className="text-xs text-slate-400">{fmtDate(p.paid_at)} · {officerName(p.handler_id) ?? 'Handler'}</span>
                      {p.approved_by ? <Badge tone="good">Approved</Badge> : <Badge tone="warn">Awaiting approval</Badge>}
                      {p.case_id && <Link href={caseLink(p.case_id)} className="text-xs text-badge-200 hover:text-white">Case</Link>}
                      {full && !p.approved_by && (
                        <Button size="sm" variant="success" className="ml-auto" onAction={async () => {
                          const r = await ciPaymentApprove(p.id)
                          if (ciRefused(r)) return
                          toast('Payment approved.', 'success'); changed()
                        }}>Approve</Button>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {section === 'cases' && (
          <div className="space-y-3">
            <SectionHeader title="Related cases" subtitle="Only cases you can read are listed. Linking does not reveal the source to the case team."
              actions={<Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'link_case' })}>Link case</Button>} />
            {!ci.cases.length ? (
              <EmptyState title="No linked cases" hint="Intelligence recorded against a case links it automatically." />
            ) : (
              <ul className="space-y-2">
                {ci.cases.map((c) => (
                  <li key={c.case_id}>
                    <Card pad="sm" className="flex flex-wrap items-center gap-3">
                      <Link href={caseLink(c.case_id, 'ci')} className="font-mono text-sm font-semibold text-badge-200 hover:text-white">{c.case_number ?? 'Case'}</Link>
                      {c.title && <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{c.title}</span>}
                      {c.linked_at && <span className="text-xs text-slate-400">linked {fmtDate(c.linked_at)}</span>}
                      {c.note && <span className="w-full text-xs text-slate-300 sm:w-auto">{c.note}</span>}
                      <Button size="sm" className="ml-auto" onAction={async () => {
                        const reason = await uiPrompt(`Reason for unlinking ${c.case_number ?? 'this case'} (optional)`, { title: 'Unlink case', confirmText: 'Unlink' })
                        if (reason === null) return
                        const r = await ciCaseUnlink(ci.id, c.case_id, reason.trim() || null)
                        if (ciRefused(r)) return
                        toast('Case unlinked.', 'success'); changed()
                      }}>Unlink</Button>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {section === 'audit' && (
          <div className="space-y-3">
            <SectionHeader title="Audit" subtitle="Every action on this source, kept inside the compartment (never the division audit log)." />
            {audit === null ? <ListSkeleton count={4} /> : !audit.length ? (
              <EmptyState title="No audit entries" />
            ) : (
              <ul className="divide-y divide-white/5 rounded-lg border border-white/5 bg-ink-900/60 text-sm">
                {audit.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2">
                    <span className="font-mono text-xs text-slate-300">{a.action}</span>
                    <span className="text-slate-200">{a.actor_name ?? officerName(a.actor_id) ?? 'System'}</span>
                    <time dateTime={a.created_at} title={fmtDateTime(a.created_at)} className="ml-auto text-xs text-slate-400">{timeAgo(a.created_at)}</time>
                    {a.detail && typeof a.detail === 'object' && !Array.isArray(a.detail) && Object.keys(a.detail).length > 0 && (
                      <span className="w-full truncate text-xs text-slate-400">{summarizeDetail(a.detail as Record<string, Json>)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Dialogs — mounted on demand so each opens with fresh state. */}
      {dialog?.kind === 'edit' && <EditCiDialog ci={ci} full={full} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); changed() }} />}
      {dialog?.kind === 'status' && <StatusDialog open ciId={ci.id} ciNumber={ci.ci_number} current={ci.status} onClose={() => setDialog(null)} onSaved={changed} />}
      {dialog?.kind === 'reassign' && (
        <ReassignHandlerDialog open ciId={ci.id} ciNumber={ci.ci_number} status={ci.status} handlers={ci.handlers} capacity={handlerStats ?? undefined}
          initialRole={dialog.role} onClose={() => setDialog(null)} onSaved={changed} />
      )}
      {dialog?.kind === 'remove' && <RemoveHandlerDialog open ciId={ci.id} ciNumber={ci.ci_number} handlers={ci.handlers} onClose={() => setDialog(null)} onSaved={changed} />}
      {dialog?.kind === 'contact' && <ContactLogDialog open ciId={ci.id} onClose={() => setDialog(null)} onSaved={changed} />}
      {dialog?.kind === 'intel' && (
        <IntelDialog open ciId={ci.id} intel={dialog.row ?? null}
          initialMentions={dialog.row ? links.filter((l) => l.intel_id === dialog.row!.id && MENTION_KINDS.has(l.kind)).map((l): IntelMention => ({ kind: l.kind as IntelMention['kind'], hit: { id: l.target_id, label: `${l.kind} ${l.target_id.slice(0, 8)}` } })) : undefined}
          onClose={() => setDialog(null)} onSaved={changed} />
      )}
      {dialog?.kind === 'corroborate' && <CorroborationDialog row={dialog.row} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); changed() }} />}
      {dialog?.kind === 'assess' && <AssessmentDialog open ciId={ci.id} previous={ci.latest_assessment} onClose={() => setDialog(null)} onSaved={changed} />}
      {dialog?.kind === 'payment' && <PaymentDialog open ciId={ci.id} intelOptions={intel ?? []} onClose={() => setDialog(null)} onSaved={changed} />}
      {dialog?.kind === 'link_case' && <LinkCaseDialog ciId={ci.id} exclude={new Set(ci.cases.map((c) => c.case_id))} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); changed() }} />}
    </section>
  )
}

function HandlerLine({ label, h, detailed }: { label: string; h: { user_id: string; name: string | null; assigned_at?: string | null; reason?: string | null; counts_toward_capacity?: boolean } | null; detailed?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      {h ? (
        <>
          <p className="text-sm font-medium text-slate-100">{h.name ?? officerName(h.user_id) ?? 'Member'}</p>
          {detailed && (
            <p className="text-xs text-slate-400">
              {h.assigned_at ? `since ${fmtDate(h.assigned_at)}` : ''}{h.counts_toward_capacity === false ? ' · does not count toward capacity' : ''}
              {h.reason ? ` · ${h.reason}` : ''}
            </p>
          )}
        </>
      ) : <p className="text-sm text-slate-500">Unassigned</p>}
    </div>
  )
}

function summarizeDetail(d: Record<string, Json>): string {
  return Object.entries(d)
    .filter(([k]) => !/_id$/.test(k) && k !== 'ci_id')
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

/** alias / motives / notes / next contact / grading (+ bureau & lead for full). */
function EditCiDialog({ ci, full, onClose, onSaved }: { ci: CiDetail; full: boolean; onClose: () => void; onSaved: () => void }) {
  const [alias, setAlias] = useState(ci.alias ?? '')
  const [motive, setMotive] = useState(ci.motive_primary ?? '')
  const [secondary, setSecondary] = useState<string[]>(ci.motive_secondary ?? [])
  const [explanation, setExplanation] = useState(ci.motive_explanation ?? '')
  const [notes, setNotes] = useState(ci.recruitment_notes ?? '')
  const [nextAt, setNextAt] = useState(toLocalInput(ci.next_contact_at))
  const [reliability, setReliability] = useState(ci.reliability)
  const [risk, setRisk] = useState(ci.risk)
  const [bureau, setBureau] = useState<string>(ci.bureau)
  const [lead, setLead] = useState(ci.supervising_lead_id ?? '')
  const profiles = useProfilesStore((s) => s.profiles)

  const submit = async () => {
    const patch: Record<string, Json> = {
      alias: alias.trim() || null, motive_primary: motive || null, motive_secondary: secondary.filter((m) => m !== motive),
      motive_explanation: explanation.trim() || null, recruitment_notes: notes.trim() || null,
      next_contact_at: fromLocalInput(nextAt), reliability, risk,
    }
    if (full) { patch.bureau = bureau; patch.supervising_lead_id = lead || null }
    const r = await ciUpdate(ci.id, patch)
    if (ciRefused(r)) return
    toast('Details saved.', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} wide dirty={() => alias !== (ci.alias ?? '') || notes !== (ci.recruitment_notes ?? '') || explanation !== (ci.motive_explanation ?? '')}>
      <div className="p-5">
        <ModalHeader title={`Edit ${ci.ci_number}`} onClose={onClose} />
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Alias / codename">{(id) => <Input id={id} value={alias} onChange={(e) => setAlias(e.target.value)} />}</Field>
            <Field label="Next contact">{(id) => <Input id={id} type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} />}</Field>
            <Field label="Primary motive">
              {(id) => (
                <Select id={id} value={motive} onChange={(e) => setMotive(e.target.value)}>
                  <option value="">Unknown</option>
                  {CI_MOTIVES.map((m) => <option key={m} value={m}>{CI_MOTIVE_LABEL[m]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Secondary motives" hint="Hold Ctrl / Cmd to select several.">
              {(id) => (
                <Select id={id} multiple value={secondary} onChange={(e) => setSecondary(Array.from(e.target.selectedOptions).map((o) => o.value))} className="min-h-24">
                  {CI_MOTIVES.filter((m) => m !== motive).map((m) => <option key={m} value={m}>{CI_MOTIVE_LABEL[m]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Reliability">
              {(id) => (
                <Select id={id} value={reliability} onChange={(e) => setReliability(e.target.value)}>
                  {CI_RELIABILITY.map((v) => <option key={v} value={v}>{CI_RELIABILITY_LABEL[v]}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Risk">
              {(id) => (
                <Select id={id} value={risk} onChange={(e) => setRisk(e.target.value)}>
                  {CI_RISK.map((v) => <option key={v} value={v}>{CI_RISK_LABEL[v]}</option>)}
                </Select>
              )}
            </Field>
            {full && (
              <>
                <Field label="Bureau">
                  {(id) => (
                    <Select id={id} value={bureau} onChange={(e) => setBureau(e.target.value)}>
                      {Object.entries(BUREAUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Supervising lead">
                  {(id) => (
                    <Select id={id} value={lead} onChange={(e) => setLead(e.target.value)}>
                      <option value="">None</option>
                      {profiles.filter((p) => p.active && !p.is_system).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                    </Select>
                  )}
                </Field>
              </>
            )}
          </div>
          <Field label="Motive explanation">{(id) => <Textarea id={id} rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} />}</Field>
          <Field label="Recruitment notes">{(id) => <Textarea id={id} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={submit}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}

function CorroborationDialog({ row, onClose, onSaved }: { row: CiIntelRow; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(row.corroboration)
  const [note, setNote] = useState(row.corroboration_note ?? '')
  const submit = async () => {
    const r = await ciIntelSetCorroboration(row.id, value, note.trim() || null)
    if (ciRefused(r)) return
    toast('Corroboration updated.', 'success')
    onSaved()
  }
  return (
    <Modal open onClose={onClose} dirty={() => note !== (row.corroboration_note ?? '')}>
      <div className="p-5">
        <ModalHeader title="Set corroboration" onClose={onClose} />
        <p className="mb-3 text-sm text-slate-300">{CI_CORROBORATION_EXPLAINER}</p>
        <div className="space-y-3">
          <Field label="Corroboration" required>
            {(id) => (
              <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
                {CI_CORROBORATION.map((c) => <option key={c} value={c}>{CI_CORROBORATION_LABEL[c]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Note" hint="What the investigation did or did not confirm.">
            {(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={submit}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}

function LinkCaseDialog({ ciId, exclude, onClose, onSaved }: { ciId: string; exclude: ReadonlySet<string>; onClose: () => void; onSaved: () => void }) {
  const [hit, setHit] = useState<EntityHit | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | undefined>()
  const submit = async () => {
    if (!hit) { setErr('Choose a case.'); return }
    if (exclude.has(hit.id)) { setErr('Already linked.'); return }
    const r = await ciCaseLink(ciId, hit.id, note.trim() || null)
    if (ciRefused(r)) return
    toast('Case linked.', 'success')
    onSaved()
  }
  return (
    <Modal open onClose={onClose} dirty={() => !!hit || note !== ''}>
      <div className="p-5">
        <ModalHeader title="Link case" onClose={onClose} />
        <div className="space-y-3">
          <CasePicker label="Case" required value={hit} onChange={(h) => { setHit(h); setErr(undefined) }} hint="Only cases you can read are offered." />
          {err && <p className="text-xs font-semibold text-rose-300">{err}</p>}
          <Field label="Note">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this source matters to the case" />}</Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onAction={submit}>Link</Button>
        </div>
      </div>
    </Modal>
  )
}
