'use client'

/** Account Registry (spec D1) — social-media / online accounts as first-class,
 *  person-linked CID intel. Each account carries a platform, a current handle
 *  (with an auto-tracked username history), an optional immutable platform id,
 *  and ownership links to persons on a suspected → probable → confirmed ladder.
 *  Active members read/write; command deletes (RLS-enforced). In-RP platforms
 *  only (Birdy / InstaPic). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Tables } from '@/lib/database.types'
import { insert, list, remove, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { officerName } from '@/lib/profiles'
import { safeUrl } from '@/lib/safeUrl'
import { fmtDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { CardGridSkeleton } from '@/components/ui/Skeleton'

type Account = Tables<'accounts'>
type AccountHandle = Tables<'account_handles'>
type AccountLink = Tables<'account_links'>
type PersonLite = { id: string; name: string }

export const ACCOUNT_PLATFORMS = ['Birdy', 'InstaPic'] as const
const CONFIDENCE = ['suspected', 'probable', 'confirmed'] as const
const CONF_TINT: Record<string, string> = {
  suspected: 'bg-slate-500/15 text-slate-300',
  probable: 'bg-amber-500/15 text-amber-300',
  confirmed: 'bg-emerald-500/15 text-emerald-300',
}
const INPUT = 'min-h-[38px] w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white'

export function AccountsView() {
  const { state, canEdit } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [persons, setPersons] = useState<PersonLite[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const vA = useTableVersion('accounts')
  const vL = useTableVersion('account_links')

  const refresh = useCallback(async () => {
    if (state !== 'in') return
    setLoading(true); setErr(null)
    try {
      const [a, p] = await Promise.all([
        list('accounts', { order: 'updated_at', ascending: false }),
        list('persons', { select: 'id,name', order: 'name' }).then((r) => r as unknown as PersonLite[]).catch(() => [] as PersonLite[]),
      ])
      setAccounts(a); setPersons(p)
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [state])
  useEffect(() => { const t = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(t) }, [refresh, vA, vL])

  const q = query.trim().toLowerCase()
  const items = useMemo(
    () => accounts.filter((a) => !q || [a.handle, a.platform, a.display_name, a.external_id].some((s) => (s || '').toLowerCase().includes(q))),
    [accounts, q],
  )

  return (
    <section className="view-in space-y-4">
      <div className="rounded-2xl border border-white/10 bg-ink-900/60 p-6">
        <PageHeader
          title="Account Registry"
          subtitle="Social-media & online accounts, handle history and person ownership."
          actions={
            <>
              {accounts.length > 0 && (
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter handle, platform…" aria-label="Filter accounts" className="w-56 rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
              )}
              {canEdit && state === 'in' && <Button variant="primary" onClick={() => setCreating(true)}>New account</Button>}
            </>
          }
        />
      </div>

      {state !== 'in' ? (
        <Notice text="Sign in to view the account registry." />
      ) : err ? (
        <ErrorNotice message={err} onRetry={refresh} />
      ) : loading && !accounts.length ? (
        <CardGridSkeleton cols="sm:grid-cols-2 xl:grid-cols-3" />
      ) : !items.length ? (
        <EmptyState title="No accounts" hint={canEdit ? 'Add one with “New account”, or link one from a person’s profile.' : 'None recorded yet.'} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((a) => (
            <AccountCard key={a.id} account={a} persons={persons} canEdit={canEdit} expanded={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} />
          ))}
        </div>
      )}

      {creating && <AccountModal persons={persons} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void refresh() }} />}
    </section>
  )
}

function AccountCard({ account: a, persons, canEdit, expanded, onToggle }: {
  account: Account; persons: PersonLite[]; canEdit: boolean; expanded: boolean; onToggle: () => void
}) {
  const [handles, setHandles] = useState<AccountHandle[] | null>(null)
  const [links, setLinks] = useState<AccountLink[] | null>(null)
  const [linkPerson, setLinkPerson] = useState('')
  const [linkConf, setLinkConf] = useState<'suspected' | 'probable' | 'confirmed'>('suspected')
  const personName = useCallback((id: string) => persons.find((p) => p.id === id)?.name || 'Unknown', [persons])

  const load = useCallback(async () => {
    const [h, l] = await Promise.all([
      list('account_handles', { eq: { account_id: a.id }, order: 'observed_at', ascending: false }).catch(() => [] as AccountHandle[]),
      list('account_links', { eq: { account_id: a.id }, order: 'created_at', ascending: false }).catch(() => [] as AccountLink[]),
    ])
    setHandles(h as AccountHandle[]); setLinks(l as AccountLink[])
  }, [a.id])
  useEffect(() => { if (expanded) queueMicrotask(() => { void load() }) }, [expanded, load])

  const addLink = async () => {
    if (!linkPerson) return
    const res = await insert('account_links', { account_id: a.id, person_id: linkPerson, ownership_confidence: linkConf, source: 'manual' })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Linked.', 'success'); setLinkPerson(''); setLinkConf('suspected'); void load()
  }
  const setConfidence = async (link: AccountLink, confidence: string) => {
    const res = await update('account_links', link.id, { ownership_confidence: confidence })
    if (res.error) { toast(res.error.message, 'danger'); return }
    void load()
  }
  const unlink = async (link: AccountLink) => {
    if (!(await uiConfirm(`Unlink ${personName(link.person_id)} from @${a.handle}?`, { confirmText: 'Unlink' }))) return
    const res = await remove('account_links', link.id)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Unlinked.', 'success'); void load()
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{a.platform}</Badge>
            <span className="font-semibold text-white">@{a.handle}</span>
            {a.restricted && <Badge tint="bg-rose-500/15 text-rose-300">Restricted</Badge>}
          </div>
          {a.display_name && <p className="mt-1 text-sm text-slate-300">{a.display_name}</p>}
          {a.profile_url && safeUrl(a.profile_url) && (
            <a href={safeUrl(a.profile_url)!} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-badge-300 hover:underline">Open profile ↗</a>
          )}
        </div>
        <button onClick={onToggle} className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10">{expanded ? 'Hide' : 'Details'}</button>
      </div>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-white/5 pt-3">
          <div>
            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Handle history</h4>
            {handles === null ? <p className="text-xs text-slate-500">Loading…</p> : (
              <ul className="space-y-1">
                {handles.map((h) => (
                  <li key={h.id} className="flex items-center gap-2 text-sm text-slate-300">
                    <span>@{h.handle}</span>
                    {h.is_current && <Badge tint="bg-emerald-500/15 text-emerald-300">current</Badge>}
                    <span className="ml-auto text-[11px] text-slate-500">{fmtDate(h.observed_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Ownership</h4>
            {links === null ? <p className="text-xs text-slate-500">Loading…</p> : links.length === 0 ? (
              <p className="text-xs text-slate-500">No persons linked.</p>
            ) : (
              <ul className="space-y-1">
                {links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                    <span className="font-medium text-white">{personName(l.person_id)}</span>
                    {canEdit ? (
                      <select value={l.ownership_confidence} onChange={(e) => void setConfidence(l, e.target.value)} className="rounded border border-white/10 bg-ink-950 px-1.5 py-0.5 text-xs text-white" aria-label="Confidence">
                        {CONFIDENCE.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : <Badge tint={CONF_TINT[l.ownership_confidence]}>{l.ownership_confidence}</Badge>}
                    {l.ownership_confidence === 'confirmed' && l.confirmed_by && <span className="text-[11px] text-slate-500">by {officerName(l.confirmed_by)}</span>}
                    {canEdit && <button onClick={() => void unlink(l)} className="ml-auto rounded px-1.5 py-0.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10">Unlink</button>}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select value={linkPerson} onChange={(e) => setLinkPerson(e.target.value)} className="min-h-[34px] flex-1 rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-sm text-white" aria-label="Person to link">
                  <option value="">Link a person…</option>
                  {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select value={linkConf} onChange={(e) => setLinkConf(e.target.value as 'suspected' | 'probable' | 'confirmed')} className="min-h-[34px] rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-sm text-white" aria-label="Confidence">
                  {CONFIDENCE.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <Button disabled={!linkPerson} onClick={() => void addLink()}>Link</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AccountModal({ persons, onClose, onSaved }: { persons: PersonLite[]; onClose: () => void; onSaved: () => void }) {
  const [platform, setPlatform] = useState<string>(ACCOUNT_PLATFORMS[0])
  const [handle, setHandle] = useState('')
  const [externalId, setExternalId] = useState('')
  const [profileUrl, setProfileUrl] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [summary, setSummary] = useState('')
  const [restricted, setRestricted] = useState(false)
  const [ownerPerson, setOwnerPerson] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!handle.trim() || busy) return
    setBusy(true)
    const res = await insert('accounts', {
      platform, handle: handle.trim(),
      external_id: externalId.trim() || null,
      profile_url: profileUrl.trim() || null,
      display_name: displayName.trim() || null,
      summary: summary.trim() || null,
      restricted,
    })
    if (res.error || !res.data?.[0]) { setBusy(false); toast(res.error?.message ?? 'Save failed.', 'danger'); return }
    if (ownerPerson) {
      await insert('account_links', { account_id: res.data[0].id, person_id: ownerPerson, ownership_confidence: 'suspected', source: 'manual' })
    }
    setBusy(false)
    toast('Account created.', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => !!handle.trim()}>
      <div className="p-5">
        <ModalHeader title="New account" onClose={onClose} />
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={INPUT} aria-label="Platform">
            {ACCOUNT_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input className={INPUT} placeholder="Handle / username *" value={handle} onChange={(e) => setHandle(e.target.value)} aria-label="Handle" />
          <input className={INPUT} placeholder="Platform account ID (immutable, if known)" value={externalId} onChange={(e) => setExternalId(e.target.value)} aria-label="External ID" />
          <input className={INPUT} placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-label="Display name" />
          <input className={`${INPUT} sm:col-span-2`} placeholder="Profile URL" value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} aria-label="Profile URL" />
          <textarea className={`${INPUT} sm:col-span-2`} rows={2} placeholder="Summary / notes" value={summary} onChange={(e) => setSummary(e.target.value)} aria-label="Summary" />
          <select value={ownerPerson} onChange={(e) => setOwnerPerson(e.target.value)} className={INPUT} aria-label="Suspected owner">
            <option value="">Suspected owner (optional)…</option>
            {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} /> Restricted content
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !handle.trim()} onClick={() => void save()}>Create</Button>
        </div>
      </div>
    </Modal>
  )
}
