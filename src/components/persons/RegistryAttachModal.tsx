'use client'

/** Attach a person to a case as a durable `case_intel_links` row (the same
 *  table the case Intel tab and search_persons read) — replacing the old
 *  chat-message-only hack. The chat reference stays as an opt-in courtesy
 *  post so case channels keep their familiar breadcrumb, but the link row is
 *  the record. Cases load on demand (projected id/case_number/title), never
 *  with the registry fetch; RLS (can_access_case) scopes both the picker and
 *  the insert, and a unique-key conflict surfaces as "already linked". */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { insert, list } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { PERSON_CLASSIFICATIONS, classificationLabel } from './personIntel'
import type { RegistryPerson } from './registryFilters'

interface CaseOption { id: string; case_number: string; title: string | null }

export function RegistryAttachModal({ person, onClose }: { person: RegistryPerson; onClose: () => void }) {
  const router = useRouter()
  const { profile } = useAuth()
  const [cases, setCases] = useState<CaseOption[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [caseId, setCaseId] = useState('')
  const [role, setRole] = useState('')
  const [note, setNote] = useState('')
  const [postChat, setPostChat] = useState(true)
  const [linkedCaseId, setLinkedCaseId] = useState<string | null>(null)

  // Lazy, projected case load — only when the modal opens, only 3 columns.
  useEffect(() => {
    let alive = true
    void list('cases', { select: 'id,case_number,title', order: 'updated_at', ascending: false })
      .then((r) => { if (alive) setCases(r as unknown as CaseOption[]) })
      .catch((e) => { if (alive) { setCases([]); setLoadErr(e instanceof Error ? e.message : String(e)) } })
    return () => { alive = false }
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = cases ?? []
    const hits = !q
      ? all
      : all.filter((c) => c.case_number.toLowerCase().includes(q) || (c.title ?? '').toLowerCase().includes(q))
    return hits.slice(0, 30)
  }, [cases, query])

  const label = `${person.name}${person.alias ? ` “${person.alias}”` : ''}`
  const selected = matches.find((c) => c.id === caseId) ?? (cases ?? []).find((c) => c.id === caseId)

  const attach = async () => {
    if (!caseId) { toast('Pick a case first.', 'warn'); return }
    const res = await insert('case_intel_links', {
      case_id: caseId,
      kind: 'person',
      ref_id: person.id,
      role: role || null,
      note: note.trim() || null,
    })
    if (res.error) {
      if (res.error.code === '23505') toast(`${label} is already linked to that case.`, 'warn')
      else if (res.error.code === '42501' || /row-level security|permission denied/i.test(res.error.message)) {
        toast('You don’t have access to that case.', 'danger')
      } else toast(`Attach failed: ${res.error.message}`, 'danger')
      return
    }
    const num = selected?.case_number || 'case'
    toast(`${label} linked to ${num}`, 'success')
    if (postChat) {
      // Courtesy breadcrumb in the case channel (the pre-link behavior).
      const chat = await insert('case_messages', {
        case_id: caseId,
        author_name: profile?.display_name || 'CID',
        body: `🔗 Intel reference — Person: ${label}${role ? ` (${classificationLabel(role)})` : ''}${note.trim() ? ` — ${note.trim()}` : ''}`,
        mentions: [],
        links: [],
      })
      if (chat.error) toast('Linked, but the channel note could not be posted.', 'warn')
    }
    setLinkedCaseId(caseId)
  }

  return (
    <Modal open onClose={onClose} dirty={() => !linkedCaseId && !!(caseId || role || note.trim())}>
      <div className="p-6">
        <ModalHeader title="Attach to case" onClose={onClose} />
        {linkedCaseId ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              <span className="text-white">{label}</span> is now linked to{' '}
              <span className="text-white">{selected?.case_number || 'the case'}</span>. The link shows up on the
              case&rsquo;s intel and in person search.
            </p>
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" onClick={() => router.push(caseLink(linkedCaseId))}>
                Open case
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              Links <span className="text-white">{label}</span> to a case record (visible on the case and in search).
            </p>
            <Field label="Find case" hint={loadErr ? 'Case list could not be loaded — you may not have case access.' : undefined}>
              {(id) => (
                <Input
                  id={id}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Case number or title…"
                />
              )}
            </Field>
            <Field label="Case" required>
              {(id) => (
                <Select id={id} value={caseId} onChange={(e) => setCaseId(e.target.value)}>
                  <option value="">{cases === null ? 'Loading cases…' : matches.length ? '— pick a case —' : 'No cases match'}</option>
                  {matches.map((c) => (
                    <option key={c.id} value={c.id}>{c.case_number}{c.title ? ` · ${c.title}` : ''}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Role in case">
                {(id) => (
                  <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="">— none —</option>
                    {PERSON_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{classificationLabel(c)}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Note">
                {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional context" />}
              </Field>
            </div>
            <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={postChat}
                onChange={(e) => setPostChat(e.target.checked)}
                className="h-3.5 w-3.5 accent-badge-500"
              />
              Also post a reference in the case channel
            </label>
            <Button variant="primary" className="w-full" onAction={attach} disabled={!caseId}>
              Attach to case
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
