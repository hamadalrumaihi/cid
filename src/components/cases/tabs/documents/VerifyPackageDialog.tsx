'use client'

/** Verify package — drop the files of a downloaded packet (packet.pdf,
 *  manifest.json, manifest.sha256 — or any bundle's members) and get the
 *  five outcomes per file. Bytes stay in the browser: the files are hashed
 *  locally (Web Crypto) and only `[{path,size,sha256}]` goes to
 *  `manifest_verify`. The manifest pair is checked here against the stored
 *  manifest hash, since the manifest is not one of its own entries. */
import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal, ModalHeader } from '@/components/ui/Modal'
import { sha256Hex } from '@/lib/hash'
import {
  VERIFICATION_LABEL, VERIFICATION_TONE, hashFiles, manifestHashMatches, partitionBundleFiles, readSha256File, summarizeVerification,
  verifyManifest, type VerificationFile, type VerificationStatus,
} from '@/lib/manifest'
import { fetchManifest, fmtBytes, packetSiblingUrl, packetTypeLabel, type PacketRow } from '@/lib/packets'
import { toast } from '@/lib/toast'
import { openMinted } from './shared'

interface LocalCheck { label: string; status: VerificationStatus; detail?: string }

export function VerifyPackageDialog({ open, packet, onClose }: { open: boolean; packet: PacketRow | null; onClose: () => void }) {
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<{ overall: VerificationStatus; files: VerificationFile[]; local: LocalCheck[] } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) queueMicrotask(() => { setFiles([]); setResult(null); setBusy(false) }) }, [open])

  const addFiles = (list: FileList | File[] | null) => {
    if (!list) return
    const incoming = Array.from(list)
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name))
      return [...prev, ...incoming.filter((f) => !seen.has(f.name))]
    })
    setResult(null)
  }
  const remove = (name: string) => { setFiles((prev) => prev.filter((f) => f.name !== name)); setResult(null) }

  const verify = async () => {
    if (!packet?.manifest_id || files.length === 0 || busy) return
    setBusy(true)
    try {
      const { members, manifestJson, manifestSha } = partitionBundleFiles(files)
      const hashed = await hashFiles(members)
      // Bundle members → the server's manifest comparison.
      const out = members.length ? await verifyManifest(packet.manifest_id, hashed) : null
      if (out && !out.ok) { toast(out.message ?? 'Verification was refused.', 'danger'); return }
      // The manifest pair → local checks against the stored manifest hash.
      const local: LocalCheck[] = []
      if (manifestJson || manifestSha) {
        const stored = await fetchManifest(packet.manifest_id).catch(() => null)
        const manifestHex = manifestJson ? await sha256Hex(manifestJson) : null
        if (manifestJson) {
          const match = manifestHashMatches(stored?.manifest_sha256, manifestHex)
          local.push({
            label: manifestJson.name,
            status: match === true ? 'verified' : match === false ? 'hash_mismatch' : 'unexpected',
            detail: match === null ? 'The stored manifest could not be read to compare.' : undefined,
          })
        }
        if (manifestSha) {
          const claimed = readSha256File(await manifestSha.text())
          const against = manifestHex ?? stored?.manifest_sha256 ?? null
          const match = manifestHashMatches(against, claimed)
          local.push({
            label: manifestSha.name,
            status: !claimed ? 'unexpected' : match === true ? 'verified' : match === false ? 'hash_mismatch' : 'unexpected',
            detail: !claimed ? 'No SHA-256 digest found in the file.' : match === null ? 'Nothing to compare the digest with.' : undefined,
          })
        }
      }
      const summary = summarizeVerification(out?.result ?? null)
      const worstLocal = local.reduce<VerificationStatus>((w, l) => (SEVERITY[l.status] > SEVERITY[w] ? l.status : w), 'verified')
      const overall: VerificationStatus = members.length === 0
        ? worstLocal
        : SEVERITY[worstLocal] > SEVERITY[summary.status] ? worstLocal : summary.status
      setResult({ overall, files: out?.result?.files ?? [], local })
    } finally {
      setBusy(false)
    }
  }

  const noManifest = !!packet && !packet.manifest_id

  return (
    <Modal open={open} onClose={onClose} dirty={() => files.length > 0 && !result}>
      <div className="p-5">
        <ModalHeader title="Verify package" onClose={onClose} />
        {packet && (
          <p className="mb-3 text-sm text-slate-400">
            {packetTypeLabel(packet.packet_type)} · {packet.page_count ? `${packet.page_count} pages · ` : ''}{fmtBytes(packet.byte_size)}.
            Drop the downloaded <span className="font-mono text-slate-200" translate="no">packet.pdf</span>,{' '}
            <span className="font-mono text-slate-200" translate="no">manifest.json</span> and{' '}
            <span className="font-mono text-slate-200" translate="no">manifest.sha256</span> — or any bundle files. They are hashed here; nothing is uploaded.
          </p>
        )}
        {noManifest && <p className="mb-3 text-sm text-amber-200">This packet has no manifest yet — only a ready packet can be verified.</p>}
        {packet?.storage_path && !noManifest && (
          <p className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            Need the manifest pair?
            <Button size="sm" onAction={() => openMinted(() => packetSiblingUrl(packet, 'manifest.json'))}>manifest.json</Button>
            <Button size="sm" onAction={() => openMinted(() => packetSiblingUrl(packet, 'manifest.sha256'))}>manifest.sha256</Button>
          </p>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
          className={`rounded-lg border border-dashed px-4 py-6 text-center transition ${dragging ? 'border-badge-500 bg-badge-500/10' : 'border-white/15 bg-ink-950/40'}`}
        >
          <p className="text-sm text-slate-300">Drop files here, or</p>
          <label className="mt-2 inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-medium text-slate-200 transition hover:bg-white/10 focus-within:outline focus-within:outline-2 focus-within:outline-badge-500">
            Choose files…
            <input
              ref={inputRef}
              type="file"
              name="bundle_files"
              multiple
              className="sr-only"
              onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
            />
          </label>
        </div>

        {files.length > 0 && (
          <ul className="mt-3 divide-y divide-white/5 rounded-lg border border-white/10" aria-label="Files to verify">
            {files.map((f) => {
              const server = result?.files.find((r) => r.path === f.name)
              const local = result?.local.find((l) => l.label === f.name)
              const status = server?.status ?? local?.status ?? null
              return (
                <li key={f.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span className="min-w-0 flex-1 basis-40 truncate font-mono text-xs text-slate-200" translate="no" title={f.name}>{f.name}</span>
                  <span className="text-xs text-slate-400 tabular-nums">{fmtBytes(f.size)}</span>
                  {status && <Badge tone={VERIFICATION_TONE[status]}>{VERIFICATION_LABEL[status]}</Badge>}
                  {local?.detail && <span className="w-full text-xs text-slate-400">{local.detail}</span>}
                  {!result && (
                    <button type="button" onClick={() => remove(f.name)} aria-label={`Remove ${f.name}`} className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white">×</button>
                  )}
                </li>
              )
            })}
            {result?.files.filter((r) => r.status === 'missing' && !files.some((f) => f.name === r.path)).map((r) => (
              <li key={`missing-${r.path}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 flex-1 basis-40 truncate font-mono text-xs text-slate-400" translate="no" title={r.path}>{r.path}</span>
                <Badge tone={VERIFICATION_TONE.missing}>{VERIFICATION_LABEL.missing}</Badge>
              </li>
            ))}
          </ul>
        )}

        {result && (
          <div aria-live="polite" className={`mt-3 rounded-lg border px-3 py-2 ${result.overall === 'verified' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
            <p className="flex flex-wrap items-center gap-2 text-sm text-white">
              <span className="font-semibold">Result</span>
              <Badge tone={VERIFICATION_TONE[result.overall]}>{VERIFICATION_LABEL[result.overall]}</Badge>
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {result.overall === 'verified'
                ? 'Every file matches the manifest recorded when the packet was built.'
                : 'At least one file does not match the recorded manifest. Do not rely on this copy.'}
            </p>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>Close</Button>
          <Button variant="primary" loading={busy} disabled={noManifest || files.length === 0 || !!result} onClick={() => void verify()}>
            {busy ? 'Hashing…' : 'Verify'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

const SEVERITY: Record<VerificationStatus, number> = { hash_mismatch: 4, modified: 3, missing: 2, unexpected: 1, verified: 0 }
