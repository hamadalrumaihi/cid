'use client'

/** Attach a person to a case as a durable `case_intel_links` row (the same
 *  table the case Intel tab and search_persons read) — replacing the old
 *  chat-message-only hack. The chat reference stays as an opt-in courtesy
 *  post so case channels keep their familiar breadcrumb, but the link row is
 *  the record. The case picker is a bounded, debounced server search (ilikeAny
 *  + limit 20 — never a whole-table load); RLS (can_access_case) scopes both
 *  the picker and the insert, and a unique-key conflict surfaces as "already
 *  linked". */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { insert } from '@/lib/db'
import { useAuth } from '@/lib/auth'
import { caseLink } from '@/lib/caseLinks'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { RecordSearchPicker, type PickedRecord } from '@/components/shared/RecordSearchPicker'
import { searchCaseOptions } from './ProfileRelations'
import { PERSON_CLASSIFICATIONS, classificationLabel } from './personIntel'
import type { RegistryPerson } from './registryFilters'

export function RegistryAttachModal({ person, onClose }: { person: RegistryPerson; onClose: () => void }) {
  const router = useRouter()
  const { profile } = useAuth()
  const [picked, setPicked] = useState<PickedRecord | null>(null)
  const [role, setRole] = useState('')
  const [note, setNote] = useState('')
  const [postChat, setPostChat] = useState(true)
  const [linkedCaseId, setLinkedCaseId] = useState<string | null>(null)

  const label = `${person.name}${person.alias ? ` “${person.alias}”` : ''}`

  const attach = async () => {
    if (!picked) { toast('Pick a case first.', 'warn'); return }
    const caseId = picked.id
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
    const num = picked.label || 'case'
    toast(`${label} linked to ${num}`, 'success')
    if (postChat) {
      // Courtesy breadcrumb in the case channel (the pre-link behavior).
      const chat = await insert('case_messages', {
        case_id: caseId,
        author_name: profile?.display_name || 'CID',
        body: `Intel reference — Person: ${label}${role ? ` (${classificationLabel(role)})` : ''}${note.trim() ? ` — ${note.trim()}` : ''}`,
        mentions: [],
        links: [],
      })
      if (chat.error) toast('Linked, but the channel note could not be posted.', 'warn')
    }
    setLinkedCaseId(caseId)
  }

  return (
    <Modal open onClose={onClose} dirty={() => !linkedCaseId && !!(picked || role || note.trim())}>
      <div className="p-6">
        <ModalHeader title="Attach to case" onClose={onClose} />
        {linkedCaseId ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              <span className="text-white">{label}</span> is now linked to{' '}
              <span className="text-white">{picked?.label || 'the case'}</span>. The link shows up on the
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
            <RecordSearchPicker
              label="Case"
              required
              placeholder="Search case number or title…"
              value={picked}
              onChange={setPicked}
              search={searchCaseOptions}
              emptyState="No cases match — you may not have access to the case you're looking for."
            />
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
            <Button variant="primary" className="w-full" onAction={attach} disabled={!picked}>
              Attach to case
            </Button>
          </div>
        )}
      </div>
    </Modal>
  )
}
