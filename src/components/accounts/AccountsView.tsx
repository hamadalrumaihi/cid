'use client'

/** Account Registry (spec D1 + Phase 4a) — social-media / online accounts as
 *  first-class CID intel. Each account carries a platform, a current handle
 *  (with an auto-tracked username history), an optional immutable platform id,
 *  a taxonomy (category), a platform-account state, three independent
 *  descriptor flags (unknown-operator / impersonation / compromised), and
 *  POLYMORPHIC ownership links (person / gang / business / case / vehicle /
 *  place) on a suspected → probable → confirmed ladder. Active members
 *  read/write; only command (Bureau Lead+) may confirm ownership or merge
 *  duplicate accounts (RLS + triggers enforce all of it). Merged accounts are
 *  tombstones (lifecycle='merged') and drop out of the registry. In-RP
 *  platforms only (Birdy / InstaPic). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Tables } from '@/lib/database.types'
import { countRows, ilikeAny, insert, list, remove, rpc, update } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { useTableVersion } from '@/lib/realtime'
import { officerName } from '@/lib/profiles'
import { safeUrl } from '@/lib/safeUrl'
import { fmtDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { uiConfirm } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Select, Textarea } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { PageHeader } from '@/components/ui/PageHeader'
import { EmptyState, ErrorNotice, Notice } from '@/components/ui/Notice'
import { CardGridSkeleton } from '@/components/ui/Skeleton'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'

type Account = Tables<'accounts'>
type AccountHandle = Tables<'account_handles'>
type AccountLink = Tables<'account_links'>
type PersonLite = { id: string; name: string }

export const ACCOUNT_PLATFORMS = ['Birdy', 'InstaPic'] as const
const CONFIDENCE = ['suspected', 'probable', 'confirmed'] as const
// accounts.category CHECK — a person-operated handle by default; the DB does
// NOT accept the link-only kinds (case/vehicle/place) here.
const CATEGORIES = ['person', 'shared', 'gang', 'business'] as const
const STATES = ['active', 'suspended', 'deleted'] as const
// account_links.subject_kind CHECK — the full polymorphic vocabulary.
const SUBJECT_KINDS = [
  { id: 'person', label: 'Person' },
  { id: 'gang', label: 'Gang' },
  { id: 'business', label: 'Business' },
  { id: 'case', label: 'Case' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'place', label: 'Place' },
] as const
type SubjectKind = (typeof SUBJECT_KINDS)[number]['id']

const CONF_TINT: Record<string, string> = {
  suspected: 'bg-slate-500/15 text-slate-300',
  probable: 'bg-amber-500/15 text-amber-300',
  confirmed: 'bg-emerald-500/15 text-emerald-300',
}
// Category chip is surfaced only for the non-default taxonomies (the registry
// is overwhelmingly person-operated handles).
const CATEGORY_TINT: Record<string, string> = {
  shared: 'bg-blue-500/15 text-blue-300',
  gang: 'bg-amber-500/15 text-amber-300',
  business: 'bg-slate-500/15 text-slate-300',
}
// State chip only when the account is NOT plainly active.
const STATE_TINT: Record<string, string> = {
  suspended: 'bg-amber-500/15 text-amber-300',
  deleted: 'bg-rose-500/15 text-rose-300',
}
const INPUT = 'min-h-[38px] w-full rounded-lg border border-white/10 bg-ink-950 px-3 py-2 text-sm text-white'
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Confidence options for a picker — the 'confirmed' rung is command-only
 *  (mirrors the account_link_guard_confirm trigger). A link that is already
 *  confirmed keeps the option so its <select> renders its own value. */
const confidenceOptions = (isCommand: boolean, current?: string): readonly string[] =>
  CONFIDENCE.filter((c) => c !== 'confirmed' || isCommand || current === 'confirmed')

/** Bounded label resolution for a link set — one `in:` lookup per kind, only
 *  the referenced ids (never a whole-registry load). Business + place both
 *  resolve from `places` (a business is a front_business place). A row the
 *  viewer cannot read (RLS) simply keeps its id fallback. */
async function resolveSubjectNames(links: AccountLink[]): Promise<Record<string, string>> {
  const idsOf = (k: SubjectKind) => [...new Set(links.filter((l) => l.subject_kind === k).map((l) => l.subject_id))]
  const lookup = async (table: 'persons' | 'gangs' | 'places' | 'cases' | 'vehicles', cols: string, ids: string[]) =>
    ids.length ? ((await list(table, { select: cols, in: { id: ids } }).catch(() => [])) as unknown as Array<Record<string, string>>) : []
  const [persons, gangs, places, cases, vehicles] = await Promise.all([
    lookup('persons', 'id,name', idsOf('person')),
    lookup('gangs', 'id,name', idsOf('gang')),
    lookup('places', 'id,name', [...idsOf('business'), ...idsOf('place')]),
    lookup('cases', 'id,case_number', idsOf('case')),
    lookup('vehicles', 'id,plate', idsOf('vehicle')),
  ])
  const out: Record<string, string> = {}
  for (const r of persons) out[r.id] = r.name
  for (const r of gangs) out[r.id] = r.name
  for (const r of places) out[r.id] = r.name
  for (const r of cases) out[r.id] = r.case_number
  for (const r of vehicles) out[r.id] = r.plate
  return out
}

export function AccountsView() {
  const { state, canEdit, isCommand } = useAuth()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [persons, setPersons] = useState<PersonLite[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Account | null>(null)
  const [mergeFor, setMergeFor] = useState<Account | null>(null)
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
      // Merged tombstones drop out of the registry (mirrors persons/narcotics).
      setAccounts((a as Account[]).filter((x) => x.lifecycle !== 'merged'))
      setPersons(p)
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
          subtitle="Social-media & online accounts, handle history and polymorphic ownership."
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
            <AccountCard
              key={a.id}
              account={a}
              canEdit={canEdit}
              isCommand={isCommand}
              expanded={open === a.id}
              onToggle={() => setOpen(open === a.id ? null : a.id)}
              onEdit={() => setEditing(a)}
              onMerge={() => setMergeFor(a)}
            />
          ))}
        </div>
      )}

      {creating && <AccountModal persons={persons} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void refresh() }} />}
      {editing && <AccountModal account={editing} persons={persons} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void refresh() }} />}
      {mergeFor && <AccountMergeModal survivor={mergeFor} pool={accounts} isCommand={isCommand} onClose={() => setMergeFor(null)} onMerged={() => { setMergeFor(null); void refresh() }} />}
    </section>
  )
}

function AccountCard({ account: a, canEdit, isCommand, expanded, onToggle, onEdit, onMerge }: {
  account: Account; canEdit: boolean; isCommand: boolean; expanded: boolean
  onToggle: () => void; onEdit: () => void; onMerge: () => void
}) {
  const router = useRouter()
  const [handles, setHandles] = useState<AccountHandle[] | null>(null)
  const [links, setLinks] = useState<AccountLink[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [linkKind, setLinkKind] = useState<SubjectKind>('person')
  const [linkSubject, setLinkSubject] = useState<PickedRecord | null>(null)
  const [linkConf, setLinkConf] = useState<'suspected' | 'probable' | 'confirmed'>('suspected')
  const nameOf = useCallback((id: string) => names[id] || 'Unknown', [names])

  const load = useCallback(async () => {
    const [h, l] = await Promise.all([
      list('account_handles', { eq: { account_id: a.id }, order: 'observed_at', ascending: false }).catch(() => [] as AccountHandle[]),
      list('account_links', { eq: { account_id: a.id }, order: 'created_at', ascending: false }).catch(() => [] as AccountLink[]),
    ])
    setHandles(h as AccountHandle[]); setLinks(l as AccountLink[])
    setNames(await resolveSubjectNames(l as AccountLink[]))
  }, [a.id])
  useEffect(() => { if (expanded) queueMicrotask(() => { void load() }) }, [expanded, load])

  // Already-linked subjects stay out of the picker (UNIQUE account+kind+subject).
  const linked = useMemo(() => new Set((links ?? []).map((l) => `${l.subject_kind}:${l.subject_id}`)), [links])

  const kindLabel = SUBJECT_KINDS.find((k) => k.id === linkKind)?.label ?? 'Subject'

  // Bounded, RLS-scoped search per subject kind — reuses the same registry
  // lookups the case-intel picker uses. Business is sourced from front_business
  // places (the app has no separate business registry).
  const searchSubjects = useCallback(async (query: string): Promise<PickedRecord[]> => {
    let rows: PickedRecord[]
    if (linkKind === 'person') {
      const or = ilikeAny(['name', 'alias'], query)
      const r = (await list('persons', { select: 'id,name,alias', order: 'name', limit: 20, ...(or ? { or } : {}) })) as unknown as { id: string; name: string; alias: string | null }[]
      rows = r.map((p) => ({ id: p.id, label: p.name || 'Person', ...(p.alias ? { sublabel: `“${p.alias}”` } : {}) }))
    } else if (linkKind === 'gang') {
      const or = ilikeAny(['name'], query)
      const r = (await list('gangs', { select: 'id,name', order: 'name', limit: 20, ...(or ? { or } : {}) })) as unknown as { id: string; name: string }[]
      rows = r.map((g) => ({ id: g.id, label: g.name }))
    } else if (linkKind === 'business') {
      const or = ilikeAny(['name', 'area'], query)
      const r = (await list('places', { select: 'id,name,area', eq: { type: 'front_business' }, order: 'name', limit: 20, ...(or ? { or } : {}) })) as unknown as { id: string; name: string; area: string | null }[]
      rows = r.map((p) => ({ id: p.id, label: p.name, ...(p.area ? { sublabel: p.area } : {}) }))
    } else if (linkKind === 'case') {
      const or = ilikeAny(['case_number', 'title'], query)
      const r = (await list('cases', { select: 'id,case_number,title', order: 'updated_at', ascending: false, limit: 20, ...(or ? { or } : {}) })) as unknown as { id: string; case_number: string; title: string | null }[]
      rows = r.map((c) => ({ id: c.id, label: c.case_number, ...(c.title ? { sublabel: c.title } : {}) }))
    } else if (linkKind === 'vehicle') {
      const or = ilikeAny(['plate', 'model'], query)
      const r = (await list('vehicles', { select: 'id,plate,model', order: 'plate', limit: 20, ...(or ? { or } : {}) })) as unknown as { id: string; plate: string; model: string | null }[]
      rows = r.map((v) => ({ id: v.id, label: v.plate, ...(v.model ? { sublabel: v.model } : {}) }))
    } else {
      const or = ilikeAny(['name', 'area'], query)
      const r = (await list('places', { select: 'id,name,area', order: 'name', limit: 20, ...(or ? { or } : {}) })) as unknown as { id: string; name: string; area: string | null }[]
      rows = r.map((p) => ({ id: p.id, label: p.name, ...(p.area ? { sublabel: p.area } : {}) }))
    }
    return rows.filter((o) => !linked.has(`${linkKind}:${o.id}`))
  }, [linkKind, linked])

  const addLink = async () => {
    if (!linkSubject) return
    const res = await insert('account_links', {
      account_id: a.id, subject_kind: linkKind, subject_id: linkSubject.id,
      // Mirror rule: person links (and only person links) carry person_id.
      ...(linkKind === 'person' ? { person_id: linkSubject.id } : {}),
      ownership_confidence: linkConf, source: 'manual',
    })
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Linked.', 'success'); setLinkSubject(null); setLinkConf('suspected'); void load()
  }
  const setConfidence = async (link: AccountLink, confidence: string) => {
    const res = await update('account_links', link.id, { ownership_confidence: confidence })
    // Confirm is command-gated server-side — surface the DB message cleanly.
    if (res.error) { toast(res.error.message, 'danger'); return }
    void load()
  }
  const unlink = async (link: AccountLink) => {
    if (!(await uiConfirm(`Unlink ${nameOf(link.subject_id)} from @${a.handle}?`, { confirmText: 'Unlink' }))) return
    const res = await remove('account_links', link.id)
    if (res.error) { toast(res.error.message, 'danger'); return }
    toast('Unlinked.', 'success'); void load()
  }

  const activeFlags: Array<{ label: string; tint: string }> = [
    ...(a.operator_unknown ? [{ label: 'Operator unknown', tint: 'bg-slate-500/15 text-slate-300' }] : []),
    ...(a.is_impersonation ? [{ label: 'Impersonation', tint: 'bg-rose-500/15 text-rose-300' }] : []),
    ...(a.is_compromised ? [{ label: 'Compromised', tint: 'bg-amber-500/15 text-amber-300' }] : []),
  ]

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-900/50 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{a.platform}</Badge>
            <span className="font-semibold text-white">@{a.handle}</span>
            {a.category && a.category !== 'person' && <Badge tint={CATEGORY_TINT[a.category] ?? 'bg-slate-500/15 text-slate-300'}>{cap(a.category)}</Badge>}
            {a.state && a.state !== 'active' && <Badge tint={STATE_TINT[a.state] ?? 'bg-slate-500/15 text-slate-300'}>{cap(a.state)}</Badge>}
            {a.restricted && <Badge tint="bg-rose-500/15 text-rose-300">Restricted</Badge>}
          </div>
          {a.display_name && <p className="mt-1 text-sm text-slate-300">{a.display_name}</p>}
          {activeFlags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {activeFlags.map((f) => <Badge key={f.label} tint={f.tint}>{f.label}</Badge>)}
            </div>
          )}
          {a.profile_url && safeUrl(a.profile_url) && (
            <a href={safeUrl(a.profile_url)!} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-xs text-badge-300 hover:underline">Open profile ↗</a>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {canEdit && <button onClick={onEdit} className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10">Edit</button>}
          {isCommand && <button onClick={onMerge} className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10">Merge</button>}
          <button onClick={onToggle} className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/10">{expanded ? 'Hide' : 'Details'}</button>
        </div>
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
              <p className="text-xs text-slate-500">No subjects linked.</p>
            ) : (
              <ul className="space-y-1">
                {links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
                    <Badge tone="neutral" className="uppercase">{l.subject_kind}</Badge>
                    {l.subject_kind === 'person' ? (
                      <button onClick={() => router.push(`/persons?person=${encodeURIComponent(l.subject_id)}`)} className="font-medium text-badge-300 hover:underline">{nameOf(l.subject_id)}</button>
                    ) : <span className="font-medium text-white">{nameOf(l.subject_id)}</span>}
                    {canEdit ? (
                      <select value={l.ownership_confidence} onChange={(e) => void setConfidence(l, e.target.value)} className="rounded border border-white/10 bg-ink-950 px-1.5 py-0.5 text-xs text-white" aria-label="Confidence">
                        {confidenceOptions(isCommand, l.ownership_confidence).map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : <Badge tint={CONF_TINT[l.ownership_confidence]}>{l.ownership_confidence}</Badge>}
                    {l.ownership_confidence === 'confirmed' && l.confirmed_by && <span className="text-[11px] text-slate-500">by {officerName(l.confirmed_by)}</span>}
                    {canEdit && <button onClick={() => void unlink(l)} className="ml-auto rounded px-1.5 py-0.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10">Unlink</button>}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && (
              <div className="mt-2 space-y-2">
                <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <Field label="Subject type">
                    {(id) => (
                      <Select id={id} value={linkKind} onChange={(e) => { setLinkKind(e.target.value as SubjectKind); setLinkSubject(null) }}>
                        {SUBJECT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                      </Select>
                    )}
                  </Field>
                  <RecordSearchPicker label={kindLabel} value={linkSubject} onChange={setLinkSubject} search={searchSubjects} placeholder={`Search ${kindLabel.toLowerCase()}s…`} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={linkConf} onChange={(e) => setLinkConf(e.target.value as 'suspected' | 'probable' | 'confirmed')} className="min-h-[34px] rounded-lg border border-white/10 bg-ink-950 px-2 py-1 text-sm text-white" aria-label="Confidence">
                    {confidenceOptions(isCommand).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <Button disabled={!linkSubject} onClick={() => void addLink()}>Link</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AccountModal({ account, persons, onClose, onSaved }: { account?: Account; persons: PersonLite[]; onClose: () => void; onSaved: () => void }) {
  const editing = !!account
  const [platform, setPlatform] = useState<string>(account?.platform ?? ACCOUNT_PLATFORMS[0])
  const [handle, setHandle] = useState(account?.handle ?? '')
  const [externalId, setExternalId] = useState(account?.external_id ?? '')
  const [profileUrl, setProfileUrl] = useState(account?.profile_url ?? '')
  const [displayName, setDisplayName] = useState(account?.display_name ?? '')
  const [summary, setSummary] = useState(account?.summary ?? '')
  const [category, setCategory] = useState<string>(account?.category ?? 'person')
  const [accountState, setAccountState] = useState<string>(account?.state ?? 'active')
  const [restricted, setRestricted] = useState(account?.restricted ?? false)
  const [operatorUnknown, setOperatorUnknown] = useState(account?.operator_unknown ?? false)
  const [isImpersonation, setIsImpersonation] = useState(account?.is_impersonation ?? false)
  const [isCompromised, setIsCompromised] = useState(account?.is_compromised ?? false)
  const [ownerPerson, setOwnerPerson] = useState('')
  const [busy, setBusy] = useState(false)
  // external_id is frozen once set (DB trigger) — only editable while still null.
  const idLocked = !!account?.external_id

  const dirty = account
    ? handle !== account.handle || platform !== account.platform || displayName !== (account.display_name ?? '')
      || summary !== (account.summary ?? '') || profileUrl !== (account.profile_url ?? '') || restricted !== account.restricted
      || category !== (account.category ?? 'person') || accountState !== (account.state ?? 'active')
      || operatorUnknown !== account.operator_unknown || isImpersonation !== account.is_impersonation || isCompromised !== account.is_compromised
      || (!account.external_id && !!externalId.trim())
    : !!handle.trim()

  const save = async () => {
    if (!handle.trim() || busy) return
    setBusy(true)
    const fields = {
      platform, handle: handle.trim(),
      profile_url: profileUrl.trim() || null,
      display_name: displayName.trim() || null,
      summary: summary.trim() || null,
      category, state: accountState, restricted,
      operator_unknown: operatorUnknown,
      is_impersonation: isImpersonation,
      is_compromised: isCompromised,
    }
    if (account) {
      // Send external_id ONLY when first assigning it (it is immutable once set;
      // resending would 500 if the DB ever saw it as a change).
      const patch = !account.external_id && externalId.trim() ? { ...fields, external_id: externalId.trim() } : fields
      const res = await update('accounts', account.id, patch)
      if (res.error) { setBusy(false); toast(res.error.message, 'danger'); return }
      setBusy(false); toast('Account updated.', 'success'); onSaved(); return
    }
    const res = await insert('accounts', { ...fields, external_id: externalId.trim() || null })
    if (res.error || !res.data?.[0]) { setBusy(false); toast(res.error?.message ?? 'Save failed.', 'danger'); return }
    if (ownerPerson) {
      await insert('account_links', { account_id: res.data[0].id, subject_kind: 'person', subject_id: ownerPerson, person_id: ownerPerson, ownership_confidence: 'suspected', source: 'manual' })
    }
    setBusy(false)
    toast('Account created.', 'success')
    onSaved()
  }

  return (
    <Modal open onClose={onClose} dirty={() => dirty}>
      <div className="p-5">
        <ModalHeader title={editing ? 'Edit account' : 'New account'} onClose={onClose} />
        <div className="grid gap-2 sm:grid-cols-2">
          <select value={platform} onChange={(e) => setPlatform(e.target.value)} className={INPUT} aria-label="Platform">
            {ACCOUNT_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <input className={INPUT} placeholder="Handle / username *" value={handle} onChange={(e) => setHandle(e.target.value)} aria-label="Handle" />
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT} aria-label="Category">
            {CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
          <select value={accountState} onChange={(e) => setAccountState(e.target.value)} className={INPUT} aria-label="State">
            {STATES.map((s) => <option key={s} value={s}>{cap(s)}</option>)}
          </select>
          {idLocked ? (
            <input className={`${INPUT} cursor-not-allowed text-slate-400`} value={account?.external_id ?? ''} readOnly title="Platform ID is immutable once set" aria-label="Platform account ID (immutable)" />
          ) : (
            <input className={INPUT} placeholder="Platform account ID (immutable, if known)" value={externalId} onChange={(e) => setExternalId(e.target.value)} aria-label="External ID" />
          )}
          <input className={INPUT} placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} aria-label="Display name" />
          <input className={`${INPUT} sm:col-span-2`} placeholder="Profile URL" value={profileUrl} onChange={(e) => setProfileUrl(e.target.value)} aria-label="Profile URL" />
          <textarea className={`${INPUT} sm:col-span-2`} rows={2} placeholder="Summary / notes" value={summary} onChange={(e) => setSummary(e.target.value)} aria-label="Summary" />
          {!editing && (
            <select value={ownerPerson} onChange={(e) => setOwnerPerson(e.target.value)} className={`${INPUT} sm:col-span-2`} aria-label="Suspected owner">
              <option value="">Suspected owner (optional)…</option>
              {persons.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} /> Restricted content
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={operatorUnknown} onChange={(e) => setOperatorUnknown(e.target.checked)} /> Operator unknown
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={isImpersonation} onChange={(e) => setIsImpersonation(e.target.checked)} /> Impersonation
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input type="checkbox" checked={isCompromised} onChange={(e) => setIsCompromised(e.target.checked)} /> Compromised
            </label>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !handle.trim()} onClick={() => void save()}>{editing ? 'Save' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  )
}

/** Merge duplicate accounts (command-only execution) — the account analogue of
 *  PersonDuplicatesModal. There is no auto-detector here, so victims are picked
 *  by searching the registry by handle. The preview mirrors account_merge's
 *  server logic exactly: links + handle history + case links repoint, and the
 *  survivor's own scalars win (empty-only fold; descriptor flags OR). Merging
 *  goes through the server-authoritative RPC (Lead+ gated, tombstones the
 *  victims) — a held linked case aborts it, and that error is surfaced plainly. */
function AccountMergeModal({ survivor, pool, isCommand, onClose, onMerged }: {
  survivor: Account; pool: Account[]; isCommand: boolean; onClose: () => void; onMerged: () => void
}) {
  const [query, setQuery] = useState('')
  const [victimIds, setVictimIds] = useState<ReadonlySet<string>>(new Set())
  const [counts, setCounts] = useState<{ key: string; data: Record<string, { links: number; handles: number; cases: number }> } | null>(null)
  const [reason, setReason] = useState('')
  const [step, setStep] = useState<'review' | 'confirm'>('review')
  const [busy, setBusy] = useState(false)

  const q = query.trim().toLowerCase()
  // Candidate victims: every OTHER live account, filtered by handle/platform/id.
  const candidates = useMemo(
    () => pool.filter((a) => a.id !== survivor.id && (!q || [a.handle, a.platform, a.display_name, a.external_id].some((s) => (s || '').toLowerCase().includes(q)))),
    [pool, survivor.id, q],
  )
  const victims = useMemo(() => pool.filter((a) => victimIds.has(a.id)), [pool, victimIds])

  const toggle = (id: string) => {
    const next = new Set(victimIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setVictimIds(next); setStep('review')
  }

  // Repoint counts per victim — HEAD counts only, keyed by the victim-id set so
  // a stale response never renders (same discipline as PersonDuplicatesModal).
  const victimKey = victims.map((v) => v.id).join(',')
  useEffect(() => {
    if (!victimKey) return
    let live = true
    const c = (p: Promise<number>) => p.catch(() => 0)
    void Promise.all(victimKey.split(',').map(async (id) => {
      const [links, handles, cases] = await Promise.all([
        c(countRows('account_links', { eq: { account_id: id } })),
        c(countRows('account_handles', { eq: { account_id: id } })),
        c(countRows('case_intel_links', { eq: { kind: 'account', ref_id: id } })),
      ])
      return [id, { links, handles, cases }] as const
    })).then((entries) => { if (live) setCounts({ key: victimKey, data: Object.fromEntries(entries) }) })
    return () => { live = false }
  }, [victimKey])
  const countData = counts && counts.key === victimKey ? counts.data : null

  // Scalar fold preview — the survivor keeps its own non-empty values; the RPC
  // only fills a blank from the first victim that has it, and ORs the flags.
  const empty = (s: string | null) => !s || !s.trim()
  const scalarFolds = useMemo(() => {
    const out: string[] = []
    if (empty(survivor.display_name)) { const v = victims.find((x) => !empty(x.display_name)); if (v) out.push(`Display name → “${v.display_name}”`) }
    if (empty(survivor.summary)) { const v = victims.find((x) => !empty(x.summary)); if (v) out.push('Summary → adopted from a victim') }
    if (!survivor.external_id) { const v = victims.find((x) => x.external_id); if (v) out.push(`Platform ID → ${v.external_id}`) }
    if (!survivor.operator_unknown && victims.some((x) => x.operator_unknown)) out.push('Operator unknown → on')
    if (!survivor.is_impersonation && victims.some((x) => x.is_impersonation)) out.push('Impersonation → on')
    if (!survivor.is_compromised && victims.some((x) => x.is_compromised)) out.push('Compromised → on')
    return out
  }, [survivor, victims])

  const totals = useMemo(() => {
    if (!countData) return null
    return victims.reduce((acc, v) => {
      const d = countData[v.id]; if (d) { acc.links += d.links; acc.handles += d.handles; acc.cases += d.cases }
      return acc
    }, { links: 0, handles: 0, cases: 0 })
  }, [countData, victims])

  const merge = async () => {
    if (!victims.length) return
    if (!reason.trim()) { toast('A reason is required to merge account records.', 'warn'); return }
    setBusy(true)
    const res = await rpc('account_merge', { p_survivor: survivor.id, p_victims: victims.map((v) => v.id), p_reason: reason.trim() })
    setBusy(false)
    if (res.error) { toast(`Merge failed: ${res.error.message}`, 'danger'); return }
    toast(`Merged ${victims.length} account${victims.length === 1 ? '' : 's'} into @${survivor.handle}`, 'success')
    onMerged()
  }

  return (
    <Modal open wide onClose={onClose} dirty={() => !!reason.trim() || victims.length > 0}>
      <div className="max-h-[85vh] overflow-y-auto p-6">
        <ModalHeader title="Merge duplicate accounts" onClose={onClose} />

        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-300/80">Survivor (kept)</p>
            <p className="mt-0.5 text-sm text-white">{survivor.platform} · <span className="font-semibold">@{survivor.handle}</span>{survivor.display_name ? <span className="text-slate-400"> — {survivor.display_name}</span> : null}</p>
          </div>

          {!isCommand ? (
            <p className="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-xs text-slate-400">
              Merging is restricted to command (Bureau Lead or higher).
            </p>
          ) : (
            <>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pick the duplicate account(s) to merge in</p>
                <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search handle, platform, display name…" aria-label="Search accounts to merge" className={INPUT} />
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                  {candidates.length === 0 ? (
                    <li className="px-1 py-2 text-xs text-slate-500">{q ? 'No other accounts match.' : 'No other accounts to merge.'}</li>
                  ) : candidates.map((a) => (
                    <li key={a.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm hover:bg-white/5">
                        <input type="checkbox" checked={victimIds.has(a.id)} onChange={() => toggle(a.id)} className="h-4 w-4 accent-rose-500" aria-label={`Merge @${a.handle} into @${survivor.handle}`} />
                        <span className="text-slate-400">{a.platform}</span>
                        <span className="font-semibold text-white">@{a.handle}</span>
                        {a.display_name && <span className="truncate text-slate-400">{a.display_name}</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>

              {victims.length === 0 ? (
                <p className="text-xs text-slate-400">Tick at least one account to merge into the survivor.</p>
              ) : (
                <>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">What will move onto @{survivor.handle}</p>
                    {totals === null ? (
                      <p className="text-xs text-slate-400">Counting linked records…</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone="neutral">Ownership links: {totals.links}</Badge>
                        <Badge tone="neutral">Handle history: {totals.handles}</Badge>
                        <Badge tone="neutral">Case links: {totals.cases}</Badge>
                      </div>
                    )}
                    <p className="mt-1.5 text-[11px] text-slate-500">Victim handles are copied onto the survivor as non-current history. A held linked case will abort the merge.</p>
                  </div>

                  {scalarFolds.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Fields the survivor will adopt (only where its own value is blank)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {scalarFolds.map((f) => <Badge key={f} tone="neutral">{f}</Badge>)}
                      </div>
                    </div>
                  )}

                  <Field label="Reason (required — recorded in the audit trail)" required>
                    {(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="E.g. same account re-registered after a handle change; confirmed by platform ID." />}
                  </Field>

                  {step === 'review' ? (
                    <Button variant="warn" className="w-full" disabled={!reason.trim() || totals === null} onClick={() => setStep('confirm')}>
                      Review merge of {victims.length} account{victims.length === 1 ? '' : 's'}…
                    </Button>
                  ) : (
                    <div className="rounded-lg border border-rose-500/25 bg-rose-500/5 p-3">
                      <p className="text-sm text-slate-200">
                        Merge <span className="font-semibold text-white">{victims.map((v) => `@${v.handle}`).join(', ')}</span> into{' '}
                        <span className="font-semibold text-white">@{survivor.handle}</span>? The merged accounts become read-only tombstones pointing at the survivor — nothing is deleted.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button variant="danger" className="flex-1" loading={busy} onClick={() => void merge()}>
                          Merge {victims.length} account{victims.length === 1 ? '' : 's'}
                        </Button>
                        <Button variant="secondary" disabled={busy} onClick={() => setStep('review')}>Back</Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
