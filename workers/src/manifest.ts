// manifest — Evidence Seal manifest shape (contract §2.5) + canonical JSON.
// Pure TypeScript, import-free. Byte-identical copies:
//   supabase/functions/_shared/manifest.ts  and  workers/src/manifest.ts
// The manifest.json bytes ARE the canonical text: keys sorted recursively,
// 2-space indentation, trailing newline. manifest.sha256 is the hex SHA-256
// of exactly those bytes, which is what scripts/verify-bundle.mjs and
// public.manifest_verify compare against.

export type ManifestSourceKind = 'media' | 'report' | 'packet';

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
  source: { kind: ManifestSourceKind; id: string; evidence_number?: string | null };
}

export interface Manifest {
  manifest_version: 1;
  bundle_id: string;
  kind: 'case_packet' | 'evidence_bundle' | 'disclosure';
  case_id: string | null;
  case_number: string | null;
  generated_at: string;
  generated_by: { id: string | null; name: string | null };
  classification: string | null;
  files: ManifestFile[];
  source_evidence_ids: string[];
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const val = (v as Record<string, unknown>)[k];
      if (val !== undefined) out[k] = sortValue(val);
    }
    return out;
  }
  return v;
}

/** Deterministic JSON text: sorted keys at every level, 2-space indent, trailing newline. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2) + '\n';
}

export function buildManifest(input: Omit<Manifest, 'manifest_version'>): Manifest {
  return {
    manifest_version: 1,
    bundle_id: input.bundle_id,
    kind: input.kind,
    case_id: input.case_id ?? null,
    case_number: input.case_number ?? null,
    generated_at: input.generated_at,
    generated_by: { id: input.generated_by?.id ?? null, name: input.generated_by?.name ?? null },
    classification: input.classification ?? null,
    files: input.files.map((f) => ({
      path: f.path,
      size: f.size,
      sha256: f.sha256.toLowerCase(),
      source: { kind: f.source.kind, id: f.source.id, ...(f.source.evidence_number ? { evidence_number: f.source.evidence_number } : {}) },
    })),
    source_evidence_ids: Array.from(new Set(input.source_evidence_ids)),
  };
}
