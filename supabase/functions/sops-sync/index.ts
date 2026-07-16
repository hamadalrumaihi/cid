// sops-sync v2: pulls Google Docs from a shared Drive folder into
// documents(folder='SOPs') under the explicit sync contract added by
// 20260801010000_document_governance:
//   - provenance lives in real columns (source_id, source_modified_at,
//     last_synced_at, sync_status, canonical_source) — the legacy
//     content.sync JSONB mirror is still written for back-compat;
//   - accepted sync updates are VERSIONED (documents_versions row with
//     source_system='google_drive'), which the old function never did;
//   - a portal edit to a Drive-canonical doc (sync_status='portal_newer',
//     stamped by private.guard_document / document_save) is NEVER silently
//     overwritten: when Drive also changed, the Drive copy is stored as a
//     conflict-candidate version (metadata.conflict='true') and the doc is
//     marked sync_status='conflict' for public.resolve_document_sync().
// Config comes from public.app_secrets (service-role-only table; RLS deny-all
// for app users) with env vars as optional overrides — so deploying needs NO
// dashboard secrets. Keys: GOOGLE_SA_EMAIL, GOOGLE_SA_KEY, SYNC_SECRET, and
// optional SOPS_FOLDER_ID (absent = sync every Google Doc shared with the SA).
// Deploy: supabase functions deploy sops-sync --no-verify-jwt
// Runs on a pg_cron schedule via pg_net; idempotent (matches by Drive file id,
// skips files whose modifiedTime is unchanged). Service-role writes are trusted
// server-side code; the client publishable key is never involved.

const enc = new TextEncoder();
const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf instanceof ArrayBuffer ? buf : buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function googleToken(email: string, pem: string): Promise<string> {
  const key = pem.replace(/\\n/g, '\n').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
  const pk = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(enc.encode(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  })));
  const sig = b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pk, enc.encode(head + '.' + claim)));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error('google token: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

interface DocRow {
  id: string; name: string; kind: string;
  content?: { sync?: { file_id?: string; modifiedTime?: string } } | null;
  source_id?: string | null; source_modified_at?: string | null;
  sync_status?: string | null; current_version_number?: number | null;
}

Deno.serve(async (req) => {
  const supaUrl = Deno.env.get('SUPABASE_URL')!, svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = (path: string, init: RequestInit = {}) =>
    fetch(`${supaUrl}/rest/v1/${path}`, { ...init, headers: { apikey: svc, authorization: `Bearer ${svc}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers || {}) } });
  const stored: Record<string, string> = {};
  try { for (const r of await (await sb('app_secrets?select=key,value')).json()) stored[r.key] = r.value; } catch (_e) { /* fall through to env */ }
  const cfg = (k: string) => Deno.env.get(k) || stored[k] || '';
  const need = cfg('SYNC_SECRET');
  if (!need || req.headers.get('x-sync-secret') !== need) return new Response('forbidden', { status: 403 });
  const email = cfg('GOOGLE_SA_EMAIL'), pem = cfg('GOOGLE_SA_KEY'), folder = cfg('SOPS_FOLDER_ID');
  if (!email || !pem) return Response.json({ error: 'missing GOOGLE_SA_EMAIL / GOOGLE_SA_KEY (app_secrets or env)' }, { status: 500 });
  try {
    const tok = await googleToken(email, pem);
    const g = (u: string) => fetch(`https://www.googleapis.com/drive/v3/${u}`, { headers: { authorization: `Bearer ${tok}` } });
    const scope = folder ? `'${folder}' in parents and ` : '';
    const q = encodeURIComponent(`${scope}trashed=false and mimeType='application/vnd.google-apps.document'`);
    const files = (await (await g(`files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=100`)).json()).files || [];
    const existing: DocRow[] = await (await sb(
      'documents?select=id,name,kind,content,source_id,source_modified_at,sync_status,current_version_number&folder=eq.SOPs',
    )).json();
    const byFileId: Record<string, DocRow> = {};
    for (const d of existing) {
      const fid = d.source_id || d.content?.sync?.file_id;
      if (fid) byFileId[fid] = d;
    }
    let created = 0, updated = 0, skipped = 0, conflicts = 0, errors = 0;
    for (const f of files) {
      try {
        const prev = byFileId[f.id];
        const prevTime = prev?.source_modified_at
          ? new Date(prev.source_modified_at).toISOString()
          : prev?.content?.sync?.modifiedTime
            ? new Date(prev.content.sync.modifiedTime).toISOString()
            : null;
        if (prev && prevTime === new Date(f.modifiedTime).toISOString()) { skipped++; continue; }
        const body = await (await g(`files/${f.id}/export?mimeType=text/plain`)).text();
        const name = f.name.replace(/\.(docx?|pdf)$/i, '');
        const label = new Date(f.modifiedTime).toLocaleDateString('en-GB');
        const content = { body, sync: { source: 'gdrive', file_id: f.id, modifiedTime: f.modifiedTime } };

        if (!prev) {
          const ins = await sb('documents', {
            method: 'POST',
            body: JSON.stringify({
              folder: 'SOPs', kind: 'doc', name, content, modified_label: label,
              category: 'sops', document_type: 'sop', status: 'published',
              classification: 'internal',
              source_system: 'google_drive', canonical_source: 'google_drive',
              source_id: f.id, source_modified_at: f.modifiedTime,
              last_synced_at: new Date().toISOString(), sync_status: 'synced',
              current_version_number: 1,
            }),
          });
          if (!ins.ok) { errors++; continue; }
          // Version 1 is materialized by trg_document_initial_version.
          created++; continue;
        }

        if (prev.sync_status === 'portal_newer' || prev.sync_status === 'conflict') {
          // Portal diverged AND Drive changed: never overwrite. Store the
          // Drive copy as a conflict candidate for resolve_document_sync().
          await sb('documents_versions', {
            method: 'POST',
            body: JSON.stringify({
              document_id: prev.id, name, kind: prev.kind, content, modified_label: label,
              change_type: null, change_summary: 'Google Drive copy held for conflict resolution.',
              source_system: 'google_drive', source_revision: f.modifiedTime,
              metadata: { conflict: 'true' },
            }),
          });
          await sb(`documents?id=eq.${prev.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              sync_status: 'conflict', sync_error: null,
              source_modified_at: f.modifiedTime,
            }),
          });
          conflicts++; continue;
        }

        // Clean fast-forward from Drive: version the new state, then update.
        const nextVersion = (prev.current_version_number || 1) + 1;
        const patch = await sb(`documents?id=eq.${prev.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name, content, modified_label: label,
            source_system: 'google_drive', canonical_source: 'google_drive',
            source_id: f.id, source_modified_at: f.modifiedTime,
            last_synced_at: new Date().toISOString(), sync_status: 'synced',
            sync_error: null, current_version_number: nextVersion,
          }),
        });
        if (!patch.ok) { errors++; continue; }
        await sb('documents_versions', {
          method: 'POST',
          body: JSON.stringify({
            document_id: prev.id, name, kind: prev.kind, content, modified_label: label,
            version_number: nextVersion, change_type: 'editorial',
            change_summary: 'Synced from Google Drive.',
            source_system: 'google_drive', source_revision: f.modifiedTime,
          }),
        });
        updated++;
      } catch (fileErr) {
        errors++;
        const prev = byFileId[f.id];
        if (prev) {
          await sb(`documents?id=eq.${prev.id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              sync_status: 'error',
              sync_error: String((fileErr as Error)?.message || fileErr).slice(0, 500),
            }),
          }).catch(() => undefined);
        }
      }
    }
    return Response.json({ ok: true, drive_files: files.length, created, updated, skipped, conflicts, errors });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
});
