/* casefiles.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 14. CASE FILES (Supabase-backed: cases + evidence + custody + timeline) ============================================================ */
    const DB = () => window.CIDDB;
    const dbReady = () => { const d = DB(); return !!(d && d.ready); };
    const caseStatusTint = (s) => s === 'closed' ? 'bg-slate-500/20 text-slate-300' : s === 'cold' ? 'bg-blue-500/15 text-blue-300' : s === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300';
    let casesCache = [];

    function casesNotice(msg) { $('#cases-grid').innerHTML = `<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${msg}</div>`; }

    function showCasesList() { $('#case-detail').classList.add('hidden'); $('#cases-list').classList.remove('hidden'); }
    function onEnterCases() { showCasesList(); if (dbReady()) fetchCases(); else casesNotice('Live case data requires sign-in. Configure Supabase + sign in to load cases.'); }

    /* ============================================================ CASE FILES — DRIVE (per-case Google Drive attachments, #case-files) ============================================================ */
    /* Files live in Google Drive; we store only the link + metadata in the
       case_files table (RLS: read=any member, insert stamps added_by=auth.uid(),
       delete=director/command). The Google libs load lazily on first attach. */
    let CASE_FILES = [];
    let cfTokenClient = null, cfAccessToken = '', cfGoogleReady = false, cfWired = false;
    function cfGoogleConfigured() { const g = (typeof window !== 'undefined' && window.CID_GOOGLE) || {}; return !!(g.clientId && g.apiKey && g.appId && !/PASTE_/.test(g.clientId) && !/PASTE_/.test(g.apiKey)); }
    function cfLoadScript(src) { return new Promise((res, rej) => { if (document.querySelector('script[data-cf="' + src + '"]')) return res(); const s = document.createElement('script'); s.src = src; s.async = true; s.dataset.cf = src; s.onload = () => res(); s.onerror = () => rej(new Error('Failed to load ' + src)); document.head.appendChild(s); }); }
    async function cfEnsureGoogle() {
      if (cfGoogleReady) return;
      await cfLoadScript('https://accounts.google.com/gsi/client');
      await cfLoadScript('https://apis.google.com/js/api.js');
      await new Promise((res) => gapi.load('picker', res));
      cfTokenClient = google.accounts.oauth2.initTokenClient({ client_id: window.CID_GOOGLE.clientId, scope: 'https://www.googleapis.com/auth/drive.file', callback: () => {} });
      cfGoogleReady = true;
    }
    function cfGetToken() {
      return new Promise((resolve, reject) => {
        if (!cfTokenClient) return reject(new Error('Google not initialised'));
        cfTokenClient.callback = (resp) => { if (resp && resp.access_token) { cfAccessToken = resp.access_token; resolve(resp.access_token); } else reject(new Error('Google authorisation cancelled')); };
        try { cfTokenClient.requestAccessToken({ prompt: cfAccessToken ? '' : 'consent' }); } catch (e) { reject(e); }
      });
    }
    async function fetchCaseFiles() {
      if (!dbReady()) { CASE_FILES = []; renderCaseFiles(); return; }
      try { CASE_FILES = await DB().list('case_files', { order: 'case_number' }); } catch (e) { CASE_FILES = []; }
      renderCaseFiles(); cfPopulateCaseList();
    }
    function renderCaseFiles() {
      const grid = $('#cf-grid'); if (!grid || !cfGoogleConfigured()) return;
      const q = ($('#cf-search') ? $('#cf-search').value : '').trim().toLowerCase();
      const rows = CASE_FILES.filter((r) => !q || (r.case_number || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q));
      if (!rows.length) { grid.innerHTML = `<p class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-500">${CASE_FILES.length ? 'No files match your filter.' : 'No case files attached yet. Pick a case number and use “Attach from Drive”.'}</p>`; return; }
      const canDel = DB() && DB().canDelete();
      const byCase = {}; rows.forEach((r) => { (byCase[r.case_number] = byCase[r.case_number] || []).push(r); });
      grid.innerHTML = Object.keys(byCase).sort().map((cn) => `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-5"><div class="mb-3 flex items-center gap-2"><span class="text-lg">🗂️</span><h3 class="font-mono text-sm font-semibold text-blue-300">${esc(cn)}</h3><span class="text-[11px] text-slate-500">${byCase[cn].length} file${byCase[cn].length === 1 ? '' : 's'}</span></div><div class="space-y-2">${byCase[cn].map((f) => `<div class="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900 px-3 py-2"><a href="${esc(f.web_view_link)}" target="_blank" rel="noopener" class="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-200 hover:text-white">${f.icon_url ? `<img src="${esc(f.icon_url)}" alt="" class="h-4 w-4 flex-shrink-0" />` : '📄'}<span class="truncate">${esc(f.name)}</span></a>${canDel ? `<button class="cf-rm flex-shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10" data-id="${f.id}" title="Remove attachment">✕</button>` : ''}</div>`).join('')}</div></div>`).join('');
      grid.querySelectorAll('.cf-rm').forEach((b) => b.onclick = () => cfRemove(b.dataset.id));
    }
    async function cfRemove(id) {
      if (!(DB() && DB().canDelete())) { toast('Only command/director can remove attachments.', 'warn'); return; }
      const res = await DB().remove('case_files', id);
      if (res && res.error) { toast('Remove failed: ' + res.error.message, 'danger'); return; }
      toast('Attachment removed', 'info'); fetchCaseFiles();
    }
    async function cfAttach() {
      if (!dbReady() || !(DB() && DB().me)) { toast('Sign in first.', 'warn'); return; }
      if (!cfGoogleConfigured()) { toast('Google Drive is not configured.', 'warn'); return; }
      const cn = ($('#cf-case') ? $('#cf-case').value : '').trim();
      if (!cn) { toast('Enter or pick a case number first.', 'warn'); return; }
      try {
        await cfEnsureGoogle();
        const token = await cfGetToken();
        const g = window.CID_GOOGLE;
        const view = new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
        new google.picker.PickerBuilder()
          .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
          .setOAuthToken(token).setDeveloperKey(g.apiKey).setAppId(String(g.appId))
          .addView(view)
          .setCallback((data) => cfPickerCallback(data, cn))
          .build().setVisible(true);
      } catch (e) { toast('Drive error: ' + (e.message || e), 'danger'); }
    }
    async function cfPickerCallback(data, cn) {
      if (!data || data[google.picker.Response.ACTION] !== google.picker.Action.PICKED) return;
      const docs = data[google.picker.Response.DOCUMENTS] || [];
      let ok = 0;
      for (const d of docs) {
        const row = { case_number: cn, drive_file_id: d[google.picker.Document.ID], name: d[google.picker.Document.NAME] || 'Untitled', mime_type: d[google.picker.Document.MIME_TYPE] || null, icon_url: d[google.picker.Document.ICON_URL] || null, web_view_link: d[google.picker.Document.URL], added_by: DB().me.id };
        const res = await DB().insert('case_files', row);
        if (res && res.error) toast('Attach failed: ' + res.error.message, 'danger'); else ok++;
      }
      if (ok) { toast(ok + ' file' + (ok === 1 ? '' : 's') + ' attached to ' + cn, 'success'); fetchCaseFiles(); }
    }
    function cfPopulateCaseList() {
      const dl = $('#cf-case-list'); if (!dl) return;
      const nums = new Set();
      if (typeof casesCache !== 'undefined') casesCache.forEach((c) => c.case_number && nums.add(c.case_number));
      CASE_FILES.forEach((r) => r.case_number && nums.add(r.case_number));
      dl.innerHTML = [...nums].sort().map((n) => `<option value="${esc(n)}"></option>`).join('');
    }
    function onEnterCaseFiles() {
      const notice = $('#cf-notice'), toolbar = $('#cf-toolbar'), grid = $('#cf-grid'), auth = $('#cf-auth');
      if (!cfGoogleConfigured()) {
        if (toolbar) toolbar.classList.add('hidden');
        if (auth) auth.innerHTML = '';
        if (grid) grid.innerHTML = '';
        if (notice) { notice.classList.remove('hidden'); notice.innerHTML = 'Google Drive integration is not configured yet — set <code>window.CID_GOOGLE</code> (OAuth client ID &amp; API key) in <code>index.html</code> to attach per-case Drive files here. Case records, evidence and chain-of-custody are managed under <b>Case Files</b> in the left nav.'; }
        return;
      }
      if (!dbReady() || !(DB() && DB().me)) {
        if (toolbar) toolbar.classList.add('hidden');
        if (grid) grid.innerHTML = '';
        if (notice) { notice.classList.remove('hidden'); notice.innerHTML = 'Sign in to view and attach case files.'; }
        return;
      }
      if (notice) { notice.classList.add('hidden'); notice.innerHTML = ''; }
      if (toolbar) { toolbar.classList.remove('hidden'); toolbar.classList.add('flex'); }
      if (auth) auth.innerHTML = '<span class="rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-slate-300">Google Drive connects on first “Attach”.</span>';
      cfPopulateCaseList();
      if (!cfWired) {
        cfWired = true;
        const at = $('#cf-attach'); if (at) at.onclick = cfAttach;
        const se = $('#cf-search'); if (se) se.oninput = (typeof debounce === 'function' ? debounce(renderCaseFiles, 150) : renderCaseFiles);
      }
      fetchCaseFiles();
    }

    async function fetchCases() {
      if (!dbReady()) { casesNotice('Live case data requires sign-in. Configure Supabase + sign in to load cases.'); return; }
      $('#cases-live').classList.remove('hidden'); $('#cases-live').classList.add('inline-flex');
      try {
        casesCache = await DB().list('cases', { order: 'updated_at', ascending: false });
        renderCases();
        if (typeof refreshCaseSelects === 'function') refreshCaseSelects();
      } catch (e) { casesNotice('Could not load cases: ' + escapeHTML(e.message || String(e))); }
    }

    function renderCases() {
      const grid = $('#cases-grid'); if (!grid) return;
      const q = ($('#case-search') ? $('#case-search').value : '').trim().toLowerCase();
      const items = casesCache.filter((c) => !q || JSON.stringify(c).toLowerCase().includes(q));
      $('#case-new').classList.toggle('hidden', !(DB() && DB().canEdit()));
      if (!items.length) { casesNotice(casesCache.length ? 'No cases match your filter.' : 'No case files yet.' + (DB() && DB().canEdit() ? ' Use “+ New Case” to create the first.' : '')); return; }
      grid.innerHTML = '';
      items.forEach((c) => {
        const card = el('div', { class: 'cursor-pointer rounded-2xl border border-white/5 bg-ink-900/60 p-5 transition hover:border-blue-500/30 hover:bg-white/5' });
        card.innerHTML = `
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0"><p class="truncate font-mono text-sm font-semibold text-blue-300">${escapeHTML(c.case_number)}</p><p class="mt-0.5 truncate text-sm text-white">${escapeHTML(c.title || 'Untitled case')}</p></div>
            <span class="flex-shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${caseStatusTint(c.status)}">${escapeHTML(c.status)}</span>
          </div>
          <p class="mt-2 line-clamp-2 text-xs text-slate-400">${escapeHTML(c.summary || 'No summary.')}</p>
          ${c.signoff_status && c.signoff_status !== 'none' ? `<div class="mt-2"><span class="rounded px-2 py-0.5 text-[10px] font-semibold ${signoffTint(c.signoff_status)}">${escapeHTML(signoffLabel(c.signoff_status))}</span></div>` : ''}
          <div class="mt-3 flex items-center justify-between text-[11px] text-slate-500"><span class="rounded bg-white/5 px-2 py-0.5">${escapeHTML(c.bureau)}</span><span>updated ${new Date(c.updated_at).toLocaleDateString('en-US')}</span></div>`;
        card.addEventListener('click', () => openCaseDetail(c.id));
        grid.appendChild(card);
      });
    }

    function openCaseModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required to edit cases.', 'warn'); return; }
      const c = record || {};
      const node = el('div', { class: 'p-6' });
      const sel = (k, opts, v) => `<select data-k="${k}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${opts.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Case</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Case Number *</label><input data-k="case_number" value="${escapeHTML(c.case_number || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-badge-500" placeholder="SAB-900023" /><p class="mt-1 text-[11px] text-slate-500">Format <b>BUREAU-NUMBER</b>. LSB→1xxxxx · BCB→2xxxxx · SAB/JTF→9xxxxx. Must be unique.</p></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Title</label><input data-k="title" value="${escapeHTML(c.title || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Bureau</label>${sel('bureau', ['LSB', 'BCB', 'SAB', 'JTF'], c.bureau || 'JTF')}</div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Status</label>${sel('status', ['open', 'active', 'cold', 'closed'], c.status || 'open')}</div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Area / Region</label><input data-k="area" value="${escapeHTML(c.area || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="e.g. Vinewood, Sandy Shores, Mirror Park" /><p class="mt-1 text-[11px] text-slate-500">Used by the Commander Heatmap to plot case concentration.</p></div>
          ${canReassign() ? `<div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Owner — Lead Detective</label><select data-k="lead_detective_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="">— unassigned —</option>${(typeof PROFILES !== 'undefined' ? PROFILES : []).filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.id === c.lead_detective_id ? 'selected' : ''}>${escapeHTML(p.display_name)} · ${escapeHTML(ROLE_LABEL[p.role] || p.role)}</option>`).join('')}</select><p class="mt-1 text-[11px] text-slate-500">Ownership is separate from the sign-off chain; reassigning does not change sign-off progress.</p></div>` : ''}
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Summary</label><textarea data-k="summary" rows="4" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML(c.summary || '')}</textarea></div>
        </div>
        <button id="case-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create case'}</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#case-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        const cn = payload.case_number;
        if (!cn) { toast('Case Number is required.', 'warn'); return; }
        const m = cn.match(/^(LSB|BCB|SAB|JTF)-(\d+)$/);
        if (!m) { toast('Case number must be BUREAU-NUMBER, e.g. SAB-900023 (bureau code + hyphen + digits).', 'warn'); return; }
        if (m[1] !== payload.bureau) { toast(`Case number prefix “${m[1]}” must match the selected bureau “${payload.bureau}”.`, 'danger'); return; }
        const leadDigit = { LSB: '1', BCB: '2', SAB: '9', JTF: '9' }[m[1]];
        if (m[2][0] !== leadDigit) toast(`Note: ${m[1]} case numbers usually start with ${leadDigit} — saving anyway.`, 'warn');
        if ('lead_detective_id' in payload && !payload.lead_detective_id) payload.lead_detective_id = null;
        if ('area' in payload && !payload.area) payload.area = null;
        const res = record && record.id ? await DB().update('cases', record.id, payload) : await DB().insert('cases', payload);
        if (res.error) {
          const dup = /duplicate|unique|already exists|23505/i.test(res.error.message || '');
          toast(dup ? `Case number ${cn} already exists — choose a unique number.` : 'Save failed: ' + res.error.message, 'danger');
          return;
        }
        closeModal(); toast(record ? 'Case updated' : 'Case created', 'success'); fetchCases();
        if (record && record.id) openCaseDetail(record.id);
      };
      openModal(node, { wide: true });
    }

    /* ---- Case Detail (tabs: Overview / Evidence / Reports / Timeline) ---- */
    let detailCase = null, detailTab = 'overview';
    async function openCaseDetail(id) {
      if (!dbReady()) { toast('Sign-in required.', 'warn'); return; }
      try {
        const rows = await DB().list('cases', { eq: { id: id } });
        detailCase = rows[0]; if (!detailCase) { toast('Case not found.', 'warn'); return; }
        detailTab = 'overview';
        $('#cases-list').classList.add('hidden');
        $('#case-detail').classList.remove('hidden');
        renderCaseDetailShell();
        loadDetailTab();
      } catch (e) { toast('Load failed: ' + (e.message || e), 'danger'); }
    }
    function renderCaseDetailShell() {
      const c = detailCase, canEdit = DB() && DB().canEdit(), canDel = DB() && DB().canDelete();
      const tabs = ['overview', 'evidence', 'reports', 'signoff', 'chat', 'timeline'];
      $('#case-detail').innerHTML = `
        <button id="case-back" class="mb-4 inline-flex items-center gap-1 text-sm text-slate-300 transition hover:text-white">← All cases</button>
        <div class="mb-6 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><p class="font-mono text-sm text-blue-300">${escapeHTML(c.case_number)}</p><h3 class="text-xl font-bold text-white">${escapeHTML(c.title || 'Untitled case')}</h3><p class="mt-1 text-sm text-slate-400">${escapeHTML(c.summary || '')}</p></div>
            <div class="flex items-center gap-2">
              <span class="rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase ${caseStatusTint(c.status)}">${escapeHTML(c.status)}</span>
              ${c.signoff_status && c.signoff_status !== 'none' ? `<span class="rounded-md px-2.5 py-1 text-[10px] font-semibold ${signoffTint(c.signoff_status)}" title="Sign-off status">${escapeHTML(signoffLabel(c.signoff_status))}</span>` : ''}
              <span class="rounded-md bg-white/5 px-2.5 py-1 text-xs text-slate-300">${escapeHTML(c.bureau)}</span>
              <button id="case-packet" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">📦 Packet .docx</button>
              ${canEdit ? '<button id="case-edit" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}
              ${canDel ? '<button id="case-del" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
            </div>
          </div>
          <div class="mt-5 flex gap-1 overflow-x-auto border-b border-white/5" id="detail-tabs">
            ${tabs.map((t) => `<button data-dt="${t}" class="detail-tab flex-shrink-0 border-b-2 px-4 py-2 text-sm font-medium capitalize transition ${t === detailTab ? 'border-badge-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}">${t}</button>`).join('')}
          </div>
        </div>
        <div id="detail-body"><p class="text-sm text-slate-500">Loading…</p></div>`;
      $('#case-back').onclick = showCasesList;
      const pk = $('#case-packet'); if (pk) pk.onclick = () => exportCasePacket(detailCase);
      const eb = $('#case-edit'); if (eb) eb.onclick = () => openCaseModal(detailCase);
      const db = $('#case-del'); if (db) db.onclick = async () => {
        if (!confirm('Delete case ' + detailCase.case_number + '? This cascades to its evidence/reports.')) return;
        const r = await DB().remove('cases', detailCase.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; }
        toast('Case deleted', 'warn'); showCasesList(); fetchCases();
      };
      $$('.detail-tab', $('#case-detail')).forEach((b) => b.onclick = () => { detailTab = b.dataset.dt; renderCaseDetailShell(); loadDetailTab(); });
    }
    async function loadDetailTab() {
      const body = $('#detail-body'); const cid = detailCase.id; const canEdit = DB() && DB().canEdit();
      try {
        if (detailTab === 'overview') {
          const [ev, rep] = await Promise.all([ DB().list('evidence', { eq: { case_id: cid } }), DB().list('reports', { eq: { case_id: cid } }) ]);
          const ownerName = officerName(detailCase.lead_detective_id) || '— unassigned —';
          body.innerHTML = `<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            ${[['Evidence', ev.length], ['Reports', rep.length], ['Lifecycle', detailCase.status], ['Owner (Lead Det.)', ownerName], ['Sign-off', signoffLabel(detailCase.signoff_status || 'none')]].map((k) => `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-5"><p class="text-xs uppercase tracking-wider text-slate-400">${k[0]}</p><p class="mt-1 text-lg font-bold text-white">${escapeHTML(String(k[1]))}</p></div>`).join('')}
          </div>`;
        } else if (detailTab === 'evidence') {
          const ev = await DB().list('evidence', { order: 'created_at', ascending: false, eq: { case_id: cid } });
          body.innerHTML = `
            <div class="mb-3 flex items-center justify-between"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Evidence (${ev.length})</h4>${canEdit ? '<button id="ev-new" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">+ Add Evidence</button>' : ''}</div>
            <div class="space-y-3">${ev.length ? ev.map(evidenceCard).join('') : '<p class="text-sm text-slate-500">No evidence logged.</p>'}</div>`;
          const nb = $('#ev-new'); if (nb) nb.onclick = () => openEvidenceModal(cid);
          $$('.ev-custody', body).forEach((b) => b.onclick = () => openCustody(b.dataset.id));
        } else if (detailTab === 'reports') {
          const rep = await DB().list('reports', { order: 'created_at', ascending: false, eq: { case_id: cid } });
          body.innerHTML = `<div class="space-y-3">${rep.length ? rep.map((r) => `<div class="rounded-xl border border-white/10 bg-ink-900 p-4"><div class="flex items-center justify-between"><span class="text-sm font-semibold text-white">${escapeHTML(r.template)} <span class="text-xs text-slate-400">${escapeHTML(r.kind)}${r.seq ? ' #' + r.seq : ''}</span></span>${r.finalized ? '<span class="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase text-emerald-300">finalized</span>' : '<span class="rounded bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase text-amber-300">draft</span>'}</div><p class="mt-1 text-[11px] text-slate-500">${new Date(r.created_at).toLocaleString('en-US')}</p></div>`).join('') : '<p class="text-sm text-slate-500">No reports linked. (Report authoring migrates in the next module.)</p>'}</div>`;
        } else if (detailTab === 'signoff') {
          await renderSignoffTab(body, detailCase);
        } else if (detailTab === 'chat') {
          await renderChatTab(body, detailCase);
        } else if (detailTab === 'timeline') {
          // Auto-generated timeline merging every case event source (#18).
          const [ev, rep, cust, trk, sho, msg] = await Promise.all([
            DB().list('evidence', { eq: { case_id: cid } }),
            DB().list('reports', { eq: { case_id: cid } }),
            DB().from('custody_chain').select('*, evidence!inner(case_id)').eq('evidence.case_id', cid).then((r) => r.data || []),
            DB().list('trackers', { eq: { case_id: cid } }).catch(() => []),
            DB().list('case_signoff_history', { eq: { case_id: cid } }).catch(() => []),
            DB().list('case_messages', { eq: { case_id: cid } }).catch(() => [])
          ]);
          const events = [];
          ev.forEach((e) => events.push({ t: e.collected_at || e.created_at, label: 'Evidence collected: ' + (e.description || e.item_code || 'item'), dot: 'blue' }));
          rep.forEach((r) => events.push({ t: r.created_at, label: 'Report: ' + r.template + (r.finalized ? ' (finalized)' : ''), dot: 'violet' }));
          cust.forEach((c) => events.push({ t: c.at, label: 'Custody transfer: ' + (c.from_officer || '?') + ' → ' + (c.to_officer || '?'), dot: 'amber' }));
          trk.forEach((t) => { events.push({ t: t.created_at, label: 'Tracker logged: ' + (t.tracker_code || '') + ' → ' + (t.target || ''), dot: 'cyan' }); if (t.authorized_at) events.push({ t: t.authorized_at, label: 'Tracker authorized: ' + (t.tracker_code || ''), dot: 'cyan' }); });
          sho.forEach((h) => { const v = { submitted: 'submitted for sign-off', approved: 'approved', denied: 'denied', changes_requested: 'requested changes', escalated: 'escalated', auto_routed: 'auto-routed', completed: 'marked complete' }[h.action] || h.action; events.push({ t: h.created_at, label: 'Sign-off: ' + (h.actor_name || 'Officer') + ' ' + v + (h.stage ? ' (' + ((typeof SIGNOFF !== 'undefined' && SIGNOFF.label[h.stage]) || h.stage) + ')' : ''), dot: 'emerald' }); });
          msg.forEach((m) => events.push({ t: m.created_at, label: 'Chat: ' + (m.author_name || 'Officer') + ' — ' + String(m.body || '').slice(0, 80) + (String(m.body || '').length > 80 ? '…' : ''), dot: 'slate' }));
          events.push({ t: detailCase.created_at, label: 'Case opened', dot: 'emerald' });
          events.sort((a, b) => new Date(b.t) - new Date(a.t));
          const dot = { blue: 'bg-blue-400', violet: 'bg-violet-400', amber: 'bg-amber-400', emerald: 'bg-emerald-400', cyan: 'bg-cyan-400', slate: 'bg-slate-400' };
          body.innerHTML = `<ul class="space-y-4">${events.map((e) => `<li class="flex gap-3"><span class="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${dot[e.dot] || 'bg-slate-400'}"></span><div><p class="text-sm text-slate-200">${escapeHTML(e.label)}</p><p class="text-[11px] text-slate-500">${e.t ? new Date(e.t).toLocaleString('en-US') : '—'}</p></div></li>`).join('')}</ul>`;
        }
      } catch (e) { body.innerHTML = '<p class="text-sm text-rose-300">Load error: ' + escapeHTML(e.message || String(e)) + '</p>'; }
    }
    function evidenceCard(e) {
      const tint = e.tamper === 'intact' ? 'text-emerald-300' : e.tamper === 'compromised' ? 'text-rose-300' : 'text-amber-300';
      return `<div class="rounded-xl border border-white/10 bg-ink-900 p-4">
        <div class="flex items-start justify-between gap-2"><div><p class="text-sm font-semibold text-white">${escapeHTML(e.description || e.item_code || 'Evidence')}</p><p class="text-[11px] text-slate-400">${escapeHTML(e.type || '—')}${e.item_code ? ' · ' + escapeHTML(e.item_code) : ''} · collected ${e.collected_at ? new Date(e.collected_at).toLocaleDateString('en-US') : '—'}</p></div><span class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${tint}">${escapeHTML(e.tamper)}</span></div>
        <div class="mt-2 flex gap-2"><button class="ev-custody rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10" data-id="${e.id}">Chain of custody</button></div>
      </div>`;
    }
    function openEvidenceModal(caseId) {
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Add Evidence</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Item Code</label><input data-k="item_code" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="EV-001" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Type</label><input data-k="type" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="Firearm / Narcotic / Document" /></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Description *</label><input data-k="description" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Location</label><input data-k="location" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Tamper Status</label><select data-k="tamper" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option>intact</option><option>compromised</option><option>released</option><option>destroyed</option></select></div>
        </div>
        <button id="ev-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Log Evidence</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#ev-save').onclick = async () => {
        const payload = { case_id: caseId }; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim() || null);
        if (!payload.description) { toast('Description is required.', 'warn'); return; }
        const res = await DB().insert('evidence', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Evidence logged', 'success'); loadDetailTab();
      };
      openModal(node, { wide: true });
    }
    async function openCustody(evidenceId) {
      const node = el('div', { class: 'p-6' });
      let chain = [];
      try { chain = await DB().list('custody_chain', { order: 'at', ascending: true, eq: { evidence_id: evidenceId } }); } catch (e) {}
      const canEdit = DB() && DB().canEdit();
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Chain of Custody</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-3 text-xs text-slate-400">Append-only transfer log.</p>
        <div id="custody-list" class="mb-4 space-y-2">${chain.length ? chain.map((c) => `<div class="rounded-lg border border-white/5 bg-ink-900 p-3 text-sm"><p class="text-slate-200">${escapeHTML(c.from_officer || '?')} → ${escapeHTML(c.to_officer || '?')}</p><p class="text-[11px] text-slate-500">${escapeHTML(c.reason || '')} · ${new Date(c.at).toLocaleString('en-US')}</p></div>`).join('') : '<p class="text-sm text-slate-500">No transfers recorded.</p>'}</div>
        ${canEdit ? `<div class="grid grid-cols-1 gap-2 sm:grid-cols-3"><input id="cf" class="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="From officer" /><input id="ct" class="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="To officer" /><input id="cr" class="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="Reason" /></div><button id="cust-add" class="mt-3 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Record Transfer</button>` : ''}`;
      node.querySelector('.close-x').onclick = closeModal;
      const add = node.querySelector('#cust-add');
      if (add) add.onclick = async () => {
        const payload = { evidence_id: evidenceId, from_officer: node.querySelector('#cf').value.trim(), to_officer: node.querySelector('#ct').value.trim(), reason: node.querySelector('#cr').value.trim() };
        if (!payload.to_officer) { toast('“To officer” is required.', 'warn'); return; }
        const res = await DB().insert('custody_chain', payload);
        if (res.error) { toast('Failed: ' + res.error.message, 'danger'); return; }
        toast('Transfer recorded', 'success'); openCustody(evidenceId);
      };
      openModal(node, { wide: true });
    }

    function initCases() {
      $('#case-new').addEventListener('click', () => openCaseModal(null));
      $('#case-refresh').addEventListener('click', fetchCases);
      $('#case-search').addEventListener('input', debounce(renderCases, 180));
    }
    // Re-fetch when auth resolves (called by auth.js) and subscribe to realtime.
    window.CIDApp = window.CIDApp || {};
    window.CIDApp.onAuthed = function () {
      fetchProfiles(); fetchCases(); fetchGangs(); fetchPersons(); fetchDrugs(); fetchPlaces(); fetchBenches(); fetchFootprints(); fetchTrackers(); fetchTickets(); fetchKpis(); fetchActivity(); fetchNotifications();
      fetchCommendations(); fetchMedia(); fetchMoProfiles(); fetchDocuments();
      if (typeof fetchMyGrants === 'function') fetchMyGrants();
      if (typeof fetchAnnouncements === 'function') fetchAnnouncements();
      if (typeof renderOfficerCard === 'function') renderOfficerCard();
      if (typeof cfGoogleConfigured === 'function' && cfGoogleConfigured() && typeof fetchCaseFiles === 'function') fetchCaseFiles();
      if (dbReady()) {
        DB().subscribe('cases', () => { fetchCases(); fetchKpis(); renderBureauLoad(); if (typeof detailCase !== 'undefined' && detailCase && !$('#case-detail').classList.contains('hidden')) { DB().list('cases', { eq: { id: detailCase.id } }).then((r) => { if (r[0]) { detailCase = r[0]; renderCaseDetailShell(); loadDetailTab(); } }).catch(() => {}); } });
        DB().subscribe('profiles', () => { fetchProfiles(); renderRoster(); if (typeof renderOfficerCard === 'function') renderOfficerCard(); });
        DB().subscribe('announcements', () => { if (typeof fetchAnnouncements === 'function') fetchAnnouncements(); });
        DB().subscribe('case_access_grants', () => { if (typeof fetchMyGrants === 'function') fetchMyGrants(); });
        DB().subscribe('case_messages', () => { if (typeof detailCase !== 'undefined' && detailCase && detailTab === 'chat') loadDetailTab(); });
        DB().subscribe('case_access_requests', () => { if (typeof detailCase !== 'undefined' && detailCase && detailTab === 'chat') loadDetailTab(); });
        DB().subscribe('commendations', fetchCommendations);
        DB().subscribe('media', fetchMedia);
        DB().subscribe('mo_profiles', fetchMoProfiles);
        DB().subscribe('documents', fetchDocuments);
        DB().subscribe('gangs', fetchGangs);
        DB().subscribe('persons', () => { fetchPersons(); renderKPIs(); });
        DB().subscribe('narcotics', fetchDrugs);
        DB().subscribe('places', fetchPlaces);
        DB().subscribe('ballistics_benches', fetchBenches);
        DB().subscribe('ballistic_footprints', fetchFootprints);
        DB().subscribe('trackers', fetchTrackers);
        DB().subscribe('tickets', fetchTickets);
        DB().subscribe('audit_log', fetchActivity);
        DB().subscribe('notifications', fetchNotifications);
        DB().subscribe('case_signoff_history', () => { if (typeof detailCase !== 'undefined' && detailCase && detailTab === 'signoff') loadDetailTab(); });
        if (typeof cfGoogleConfigured === 'function' && cfGoogleConfigured()) DB().subscribe('case_files', fetchCaseFiles);
        renderAdmin();
      }
    };

