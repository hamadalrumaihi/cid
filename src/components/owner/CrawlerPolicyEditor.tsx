'use client'

/** Owner Console → System Health → Crawler policy (platform upgrade §2.6).
 *  The single `crawler_policy` row: allow / block domain lists as tag inputs
 *  and the numeric limits. Saved as a PATCH of the changed keys through
 *  `crawler_policy_set` (Owner-only, audited CRAWLER_POLICY_SET). The server
 *  applies the policy in `url_static_check` at submit time and in the
 *  runner / worker per hop — this editor never decides a fetch itself. */
import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { list, rpc } from '@/lib/db'
import { useTableVersion } from '@/lib/realtime'
import { humanizeError, toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { ErrorNotice } from '@/components/ui/Notice'
import { Skeleton } from '@/components/ui/Skeleton'
import { XMarkIcon } from '@/components/shell/icons'
import { OwnerPanel } from './OwnerPanel'
import { POLICY_LIMITS, addDomains, clampLimit, policyPatch, type CrawlerPolicyValues } from './systemHealthModel'

type PolicyRow = Tables<'crawler_policy'>

const toValues = (r: PolicyRow): CrawlerPolicyValues => ({
  allow_domains: [...(r.allow_domains ?? [])], block_domains: [...(r.block_domains ?? [])],
  max_pages: r.max_pages, max_depth: r.max_depth, timeout_ms: r.timeout_ms, max_bytes: r.max_bytes, rate_per_min: r.rate_per_min, recheck_hours: r.recheck_hours,
})

function DomainList({ label, hint, values, onChange }: { label: string; hint: string; values: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    if (!draft.trim()) return
    const { list: next, rejected } = addDomains(values, draft)
    if (rejected.length) toast(`Not a domain: ${rejected.join(', ')}`, 'warn')
    onChange(next)
    setDraft('')
  }
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div>
          <div className="flex gap-2">
            <Input
              id={id}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit() } }}
              placeholder="example.org — Enter or comma to add"
              autoComplete="off"
              spellCheck={false}
            />
            <Button variant="secondary" onClick={commit} aria-label={`Add to ${label}`}>Add</Button>
          </div>
          {values.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={label}>
              {values.map((d) => (
                <li key={d} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 pl-2.5 font-mono text-xs text-slate-200">
                  {d}
                  <button
                    type="button"
                    aria-label={`Remove ${d} from ${label}`}
                    onClick={() => onChange(values.filter((x) => x !== d))}
                    className="grid h-11 w-11 place-items-center rounded-full text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-300 lg:h-7 lg:w-7"
                  >
                    <XMarkIcon size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  )
}

export function CrawlerPolicyEditor() {
  const version = useTableVersion('crawler_policy')
  const [orig, setOrig] = useState<CrawlerPolicyValues | null>(null)
  const [values, setValues] = useState<CrawlerPolicyValues | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const rows = await list('crawler_policy', { limit: 1 })
      const v = rows[0] ? toValues(rows[0]) : null
      setOrig(v)
      setValues(v)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])
  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(t)
  }, [load, version])

  const patch = orig && values ? policyPatch(orig, values) : {}
  const dirty = Object.keys(patch).length > 0

  const save = async () => {
    if (!dirty) return
    setBusy(true)
    const res = await rpc('crawler_policy_set', { p_patch: patch })
    setBusy(false)
    if (res.error) { toast(humanizeError(res.error.message), 'danger'); return }
    const d = (res.data ?? null) as { ok?: boolean; message?: string } | null
    if (d && d.ok === false) { toast(d.message || 'The server refused the change.', 'danger'); return }
    toast('Crawler policy saved.', 'success')
    await load()
  }

  return (
    <OwnerPanel
      title="Crawler policy"
      sub="Where external-source fetches may go and how hard they may work. Private, loopback, link-local and metadata addresses are always refused regardless of these lists; an empty allow list means any public host not blocked."
      actions={values && (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setValues(orig)} disabled={!dirty || busy}>Reset</Button>
          <Button size="sm" variant="primary" onClick={() => void save()} disabled={!dirty} loading={busy}>Save changes</Button>
        </div>
      )}
    >
      {error ? <ErrorNotice message={error} onRetry={() => void load()} /> : !values ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-11" />)}</div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DomainList label="Allowed domains" hint="Suffix match (news.example also allows a.news.example). Leave empty to allow any public host." values={values.allow_domains} onChange={(allow_domains) => setValues({ ...values, allow_domains })} />
            <DomainList label="Blocked domains" hint="Suffix match; checked before the allow list." values={values.block_domains} onChange={(block_domains) => setValues({ ...values, block_domains })} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {POLICY_LIMITS.map((lim) => (
              <Field key={lim.key} label={lim.label} hint={`${lim.hint} ${lim.min}–${lim.max}.`}>
                {(id) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    autoComplete="off"
                    min={lim.min}
                    max={lim.max}
                    value={values[lim.key]}
                    onChange={(e) => setValues({ ...values, [lim.key]: e.target.value === '' ? values[lim.key] : Number(e.target.value) })}
                    onBlur={(e) => setValues({ ...values, [lim.key]: clampLimit(lim.key, Number(e.target.value), orig?.[lim.key] ?? values[lim.key]) })}
                  />
                )}
              </Field>
            ))}
          </div>
        </div>
      )}
    </OwnerPanel>
  )
}
