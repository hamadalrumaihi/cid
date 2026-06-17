/* fivemanage.js — FiveManage (fivemanage.com) media hosting (#3). Uploads a
   photo/video from the browser to FiveManage and returns the hosted URL, which
   the media vault stores in Supabase (public.media.external_url) alongside its
   case/gang/location/person tags — so references + metadata live together and
   are usable both in-app and in-game.

   Public client config in index.html → window.CID_FIVEMANAGE = { apiKey, baseUrl? }.
   The API token is referrer-bound on FiveManage's side. If absent, the rest of
   the app is unaffected and the vault falls back to pasting a URL.

   API shape (configurable): POST {baseUrl}/api/{image|video|audio}, header
   Authorization: <apiKey>, multipart field named by kind. Adjust baseUrl if your
   FiveManage account uses a different host. Classic script, shared global scope. */
"use strict";

    function fmConfigured() { const c = (typeof window !== 'undefined' && window.CID_FIVEMANAGE) || {}; return !!(c.apiKey && !/PASTE_/.test(c.apiKey)); }
    function fmEndpoint(kind) {
      const c = (window.CID_FIVEMANAGE) || {};
      const base = (c.baseUrl || 'https://api.fivemanage.com').replace(/\/+$/, '');
      return base + '/api/' + (kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'image');
    }
    async function fmUpload(file) {
      if (!fmConfigured()) throw new Error('FiveManage not configured');
      const mime = file.type || '';
      const kind = mime.indexOf('video') === 0 ? 'video' : mime.indexOf('audio') === 0 ? 'audio' : 'image';
      const fd = new FormData();
      fd.append(kind, file);                                  // FiveManage keys the field by media kind
      fd.append('metadata', JSON.stringify({ name: file.name }));
      const res = await fetch(fmEndpoint(kind), { method: 'POST', headers: { 'Authorization': window.CID_FIVEMANAGE.apiKey }, body: fd });
      if (!res.ok) { let msg = 'HTTP ' + res.status; try { const j = await res.json(); msg = j.message || j.error || msg; } catch (e) {} throw new Error(msg); }
      const data = await res.json().catch(() => ({}));
      const url = data.url || data.link || (data.data && data.data.url);
      if (!url) throw new Error('FiveManage returned no URL');
      return { url: url, kind: kind };
    }

    // Injected into the media-vault modal: a file picker that uploads to FiveManage
    // and fills the URL field. Reuses the vault's existing case/gang/tag wiring.
    function fmInjectUploader(node) {
      const srcInput = node.querySelector('#md-src'); if (!srcInput) return;
      const wrap = el('div', {});
      if (!fmConfigured()) {
        wrap.innerHTML = '<p class="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/80">Direct upload not configured — paste a URL below, or set <code>window.CID_FIVEMANAGE.apiKey</code> in <code>index.html</code> to upload files to FiveManage.</p>';
        srcInput.parentNode.insertBefore(wrap, srcInput.parentNode.firstChild);
        return;
      }
      wrap.innerHTML = `<label class="mb-1 block text-xs font-semibold text-slate-400">Upload file → FiveManage</label>
        <div class="flex items-center gap-2"><input id="fm-file" type="file" accept="image/*,video/*,audio/*" class="fm-file flex-1 text-xs text-slate-300" />
        <button type="button" id="fm-up" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110">Upload</button></div>
        <p id="fm-status" class="mt-1 text-[11px] text-slate-500"></p>`;
      srcInput.parentNode.insertBefore(wrap, srcInput.parentNode.firstChild);
      const fileEl = wrap.querySelector('#fm-file'), status = wrap.querySelector('#fm-status');
      wrap.querySelector('#fm-up').onclick = async () => {
        const f = fileEl.files && fileEl.files[0]; if (!f) { toast('Choose a file first.', 'warn'); return; }
        status.textContent = 'Uploading to FiveManage…';
        try {
          const out = await fmUpload(f);
          srcInput.value = out.url;
          const typeSel = node.querySelector('#md-type'); if (typeSel) typeSel.value = out.kind === 'video' ? 'video' : 'image';
          const titleEl = node.querySelector('#md-title'); if (titleEl && !titleEl.value.trim()) titleEl.value = f.name.replace(/\.[^.]+$/, '');
          status.innerHTML = '✅ Uploaded — URL filled below. Add tags and save to the vault.';
          toast('Uploaded to FiveManage', 'success');
        } catch (e) { status.textContent = ''; toast('FiveManage upload failed: ' + (e.message || e), 'danger'); }
      };
    }

    window.CIDApp = window.CIDApp || {};
    window.CIDApp.fmUpload = fmUpload;
