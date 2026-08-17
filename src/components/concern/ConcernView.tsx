'use client'

/** §14 — the CID-facing door into SIU intake.
 *
 *  This screen never says "SIU". That is not decoration, it is the design.
 *  CID's visibility into SIU is nil by rule (docs/AUTHORIZATION.md), and a
 *  button labelled "Refer this to the Special Investigation Unit" would tell
 *  every detective the unit exists, roughly what it does, and — worst — would
 *  tell a subject under investigation that their own report went somewhere with
 *  teeth. So the channel presents as what it is from the reporter's side: a
 *  confidential report that leaves the Division's normal chain.
 *
 *  What the submitter gets back is a RECEIPT and nothing else. `siu_my_referrals()`
 *  strips every review column server-side, so this page cannot show whether a
 *  report was accepted, declined, or turned into an investigation even if it
 *  wanted to. That is deliberate: if the receipt reported outcomes, submitting a
 *  report would become a way to probe what SIU is working on, and a subject
 *  could file one about themselves to find out whether they are being looked at.
 *
 *  Consequently the wording below promises no outcome and no follow-up. Saying
 *  "someone will get back to you" would be a lie the schema cannot support. */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { rpc, withRetry } from '@/lib/db'
import {
  SIU_REFERRAL_CATEGORIES, fetchMySiuReferrals, siuReferralCategoryLabel,
  type SiuMyReferral,
} from '@/lib/siu'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Notice } from '@/components/ui/Notice'
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'

const fmtWhen = (v?: string | null) =>
  v ? new Date(v).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

export function ConcernView() {
  const { state } = useAuth()
  const [mine, setMine] = useState<SiuMyReferral[]>([])
  const [loading, setLoading] = useState(true)

  const [category, setCategory] = useState<string>('misconduct')
  const [summary, setSummary] = useState('')
  const [detail, setDetail] = useState('')
  const [subject, setSubject] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setMine(await withRetry(() => fetchMySiuReferrals())) }
    catch { /* an empty receipt list is the honest fallback — never an error
               state, which would itself be a signal that something exists */ }
    finally { setLoading(false) }
  }, [])

  // Repo rule: no setState synchronously inside an effect.
  useEffect(() => {
    let live = true
    void (async () => {
      await Promise.resolve()
      if (live) await load()
    })()
    return () => { live = false }
  }, [load])

  const submit = async () => {
    if (!summary.trim()) { toast('A short summary is required.', 'warn'); return }
    setBusy(true)
    const res = await rpc('siu_submit_referral', {
      p_category: category,
      p_summary: summary.trim(),
      ...(detail.trim() ? { p_detail: detail.trim() } : {}),
      ...(subject.trim() ? { p_subject_description: subject.trim() } : {}),
    })
    setBusy(false)
    if (res.error) { toast(res.error.message, 'danger'); return }
    setSummary(''); setDetail(''); setSubject('')
    toast('Your report has been recorded.', 'success')
    void load()
  }

  if (state !== 'in') return <Notice text="Sign in to continue." />

  return (
    <div>
      <Card pad="lg" className="mb-5">
        <PageHeader
          eyebrow="Confidential"
          title="Report a Concern"
          subtitle="For matters that should not go through your ordinary chain of command — including ones involving people in it."
        />
        <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-slate-400">
          Reports here are held outside the Division&apos;s normal case system and are not
          visible to your bureau, your supervisor, or command staff. You will receive a
          receipt confirming the report was recorded. You will not be told what, if
          anything, follows from it — including whether it was acted on. That is
          intentional, and it is not a reflection on your report.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <SectionHeader
            title="Make a report"
            subtitle="Give as much as you can. A report with a name and a date is far more useful than one without."
          />
          <div className="mt-3 space-y-3">
            <Field label="Nature of the concern" required>
              {(id) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {SIU_REFERRAL_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{siuReferralCategoryLabel(c)}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Summary" required hint="One or two lines. This is what a reviewer reads first.">
              {(id) => (
                <Input
                  id={id}
                  value={summary}
                  maxLength={200}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="What happened, in short"
                />
              )}
            </Field>
            <Field label="Who this concerns" hint="A name, callsign or description. Leave blank if you would rather not say.">
              {(id) => (
                <Input
                  id={id}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Optional"
                />
              )}
            </Field>
            <Field label="Detail" hint="Dates, locations, case numbers, who else saw it.">
              {(id) => (
                <Textarea
                  id={id}
                  rows={7}
                  value={detail}
                  onChange={(e) => setDetail(e.target.value)}
                  placeholder="Optional, but the more the better"
                />
              )}
            </Field>
            <div className="flex justify-end">
              <Button variant="primary" disabled={busy} onClick={() => void submit()}>
                {busy ? 'Submitting…' : 'Submit report'}
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <SectionHeader
            title="Your reports"
            subtitle="Only you can see this list."
          />
          {loading ? (
            <div className="mt-3"><CardGridSkeleton cols="" /></div>
          ) : !mine.length ? (
            <p className="mt-3 text-xs text-slate-400">You have not submitted any reports.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {mine.map((r) => (
                <li key={r.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{siuReferralCategoryLabel(r.category)}</Badge>
                    {r.acknowledged && (
                      <Badge tint="bg-emerald-500/15 text-emerald-300" title="Someone has opened your report.">
                        Received
                      </Badge>
                    )}
                    <span className="ml-auto text-[11px] text-slate-500">{fmtWhen(r.submitted_at)}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-300">{r.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
