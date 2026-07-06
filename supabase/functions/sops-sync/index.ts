// sops-sync: pulls Google Docs from a shared Drive folder into documents(folder='SOPs').
// Secrets required (Dashboard > Edge Functions > sops-sync > Secrets):
//   GOOGLE_SA_EMAIL   service-account email
//   GOOGLE_SA_KEY     service-account private key (PEM; \n-escaped is fine)
//   SOPS_FOLDER_ID    Drive folder id shared read-only with the service account
//   SYNC_SECRET       shared secret; callers must send the x-sync-secret header
// Deploy: supabase functions deploy sops-sync --no-verify-jwt
// Runs on a pg_cron schedule via pg_net; idempotent (upserts by Drive file id,
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

Deno.serve(async (req) => {
  const need = Deno.env.get('SYNC_SECRET');
  if (!need || req.headers.get('x-sync-secret') !== need) return new Response('forbidden', { status: 403 });
  const email = Deno.env.get('GOOGLE_SA_EMAIL'), pem = Deno.env.get('GOOGLE_SA_KEY'), folder = Deno.env.get('SOPS_FOLDER_ID');
  if (!email || !pem || !folder) return Response.json({ error: 'missing GOOGLE_SA_EMAIL / GOOGLE_SA_KEY / SOPS_FOLDER_ID secrets' }, { status: 500 });
  const supaUrl = Deno.env.get('SUPABASE_URL')!, svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sb = (path: string, init: RequestInit = {}) =>
    fetch(`${supaUrl}/rest/v1/${path}`, { ...init, headers: { apikey: svc, authorization: `Bearer ${svc}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers || {}) } });
  try {
    const tok = await googleToken(email, pem);
    const g = (u: string) => fetch(`https://www.googleapis.com/drive/v3/${u}`, { headers: { authorization: `Bearer ${tok}` } });
    const q = encodeURIComponent(`'${folder}' in parents and trashed=false and mimeType='application/vnd.google-apps.document'`);
    const files = (await (await g(`files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=100`)).json()).files || [];
    const existing = await (await sb('documents?select=id,name,content&folder=eq.SOPs')).json();
    const byFileId: Record<string, { id: string; content?: { sync?: { modifiedTime?: string } } }> = {};
    for (const d of existing) { const fid = d.content?.sync?.file_id; if (fid) byFileId[fid] = d; }
    let created = 0, updated = 0, skipped = 0;
    for (const f of files) {
      const prev = byFileId[f.id];
      if (prev && prev.content?.sync?.modifiedTime === f.modifiedTime) { skipped++; continue; }
      const body = await (await g(`files/${f.id}/export?mimeType=text/plain`)).text();
      const row = {
        folder: 'SOPs', kind: 'doc', name: f.name.replace(/\.(docx?|pdf)$/i, ''),
        content: { body, sync: { source: 'gdrive', file_id: f.id, modifiedTime: f.modifiedTime } },
        modified_label: new Date(f.modifiedTime).toLocaleDateString('en-GB'),
      };
      if (prev) { if ((await sb(`documents?id=eq.${prev.id}`, { method: 'PATCH', body: JSON.stringify(row) })).ok) updated++; }
      else if ((await sb('documents', { method: 'POST', body: JSON.stringify(row) })).ok) created++;
    }
    return Response.json({ ok: true, drive_files: files.length, created, updated, skipped });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
});
