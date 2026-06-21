/* casefiles.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 14. CASE FILES (Supabase-backed: cases + evidence + custody + timeline) ============================================================ */
    const DB = () => window.CIDDB;
    const dbReady = () => { const d = DB(); return !!(d && d.ready); };
    const caseStatusTint = (s) => s === 'closed' ? 'bg-slate-500/20 text-slate-300' : s === 'cold' ? 'bg-blue-500/15 text-blue-300' : s === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300';
    let casesCache = [];
    let CASE_TEMPLATES = [];   // command-editable quick-create presets (case_templates)
    async function fetchCaseTemplates() { if (!dbReady()) return; try { CASE_TEMPLATES = await DB().list('case_templates', { order: 'sort_order', ascending: true }); } catch (e) { CASE_TEMPLATES = []; } }
    // QoL: list scope (mine/all) + recently-opened & pinned cases (persisted via Store).
    let casesScope = (typeof Store !== 'undefined') ? Store.get('casesScope', 'mine') : 'all';
    const myId = () => (DB() && DB().me) ? DB().me.id : null;
    const recentCaseIds = () => (typeof Store !== 'undefined' ? Store.get('recentCases', []) : []);
    const pinnedCaseIds = () => (typeof Store !== 'undefined' ? Store.get('pinnedCases', []) : []);
    function pushRecentCase(id) { if (!id || typeof Store === 'undefined') return; const r = recentCaseIds().filter((x) => x !== id); r.unshift(id); Store.set('recentCases', r.slice(0, 8)); }
    function isPinned(id) { return pinnedCaseIds().includes(id); }
    function togglePinCase(id) { if (typeof Store === 'undefined') return; const p = pinnedCaseIds(); const i = p.indexOf(id); if (i >= 0) p.splice(i, 1); else p.unshift(id); Store.set('pinnedCases', p.slice(0, 12)); }
    function renderScopeChips() {
      $$('#case-scope .cs-chip').forEach((b) => {
        const on = b.dataset.scope === casesScope;
        b.classList.toggle('bg-blue-500/15', on); b.classList.toggle('text-white', on); b.classList.toggle('text-slate-400', !on);
        b.onclick = () => { casesScope = b.dataset.scope; if (typeof Store !== 'undefined') Store.set('casesScope', casesScope); renderCases(); };
      });
    }
    // "Jump back in" strip on Command: pinned + recently-opened cases.
    function renderJumpBack() {
      const wrap = $('#jump-back'); if (!wrap) return;
      const pinnedIds = pinnedCaseIds();
      const pinned = pinnedIds.map((id) => casesCache.find((c) => c.id === id)).filter(Boolean);
      const recent = recentCaseIds().map((id) => casesCache.find((c) => c.id === id)).filter(Boolean).filter((c) => !pinnedIds.includes(c.id));
      if (!dbReady() || (!pinned.length && !recent.length)) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
      const chips = (list, icon) => list.map((c) => `<button class="jb-chip inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-ink-900 px-3 py-1.5 text-xs text-slate-200 transition hover:border-blue-500/40 hover:bg-white/5" data-id="${c.id}"><span>${icon}</span><span class="font-mono text-blue-300">${escapeHTML(c.case_number)}</span><span class="max-w-[10rem] truncate text-slate-400">${escapeHTML(c.title || '')}</span></button>`).join('');
      wrap.classList.remove('hidden');
      wrap.innerHTML = `<p class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Jump back in</p><div class="flex flex-wrap gap-2">${chips(pinned, '📌')}${chips(recent, '🕘')}</div>`;
      wrap.querySelectorAll('.jb-chip').forEach((b) => b.onclick = () => { if (typeof navigate === 'function') navigate('cases'); openCaseDetail(b.dataset.id); });
    }

    // QoL: link an intel record (person/gang/place) to a case by posting a reference
    // into that case's channel — keeps the intel on the case record without a schema change.
    function attachIntelToCase(label) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      if (!dbReady() || !casesCache.length) { toast('No cases available to attach to.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      const opts = casesCache.slice().sort((a, b) => (a.case_number || '').localeCompare(b.case_number || '')).map((c) => `<option value="${c.id}">${escapeHTML(c.case_number)} · ${escapeHTML(c.title || '')}</option>`).join('');
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between"><h3 class="text-lg font-bold text-white">Attach to case</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-3 text-sm text-slate-400">Posts a reference to <span class="text-white">${escapeHTML(label)}</span> into the case channel.</p>
        <select id="atc-case" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">${opts}</select>
        <button id="atc-go" class="mt-4 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Attach reference</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#atc-go').onclick = async () => {
        const cid = node.querySelector('#atc-case').value; if (!cid) return;
        const res = await DB().insert('case_messages', { case_id: cid, author_name: (DB().me && DB().me.display_name) || 'CID', body: '🔗 Intel reference — ' + label, mentions: [], links: [] });
        if (res && res.error) { toast('Attach failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Reference posted to ' + ((typeof caseNumById === 'function' && caseNumById(cid)) || 'case') + ' channel', 'success');
        if (typeof detailCase !== 'undefined' && detailCase && detailCase.id === cid && typeof detailTab !== 'undefined' && detailTab === 'chat' && typeof loadDetailTab === 'function') loadDetailTab();
      };
      openModal(node);
    }

    function casesNotice(msg) { $('#cases-grid').innerHTML = `<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${msg}</div>`; }

    function showCasesList() { $('#case-detail').classList.add('hidden'); $('#cases-list').classList.remove('hidden'); }
    function onEnterCases() { showCasesList(); if (dbReady()) fetchCases(); else casesNotice('Live case data requires sign-in. Configure Supabase + sign in to load cases.'); }

    /* ============================================================ CASE FILES — ATTACHMENTS (per-case files via FiveManage + Supabase, #case-files) ============================================================ */
    /* Files are uploaded to FiveManage (window.CID_FIVEMANAGE); their URL +
       metadata are stored in the case_files table (Supabase). RLS: read = case
       bureau, insert stamps added_by = auth.uid(), delete = director/command.
       Bureau-isolated per case. */
    let CASE_FILES = [];
    let cfWired = false;
    async function fetchCaseFiles() {
      if (!dbReady()) { CASE_FILES = []; renderCaseFiles(); return; }
      try { CASE_FILES = await DB().list('case_files', { order: 'case_number' }); } catch (e) { CASE_FILES = []; }
      renderCaseFiles(); cfPopulateCaseList();
    }
    function cfKind(f) { const m = (f.mime_type || '').toLowerCase(); if (m.indexOf('image') === 0) return 'image'; if (m.indexOf('video') === 0) return 'video'; if (m.indexOf('audio') === 0) return 'audio'; if (m.indexOf('pdf') >= 0 || /\.pdf($|\?)/i.test(f.web_view_link || '')) return 'pdf'; return 'file'; }
    const CF_ICON = { image: '🖼️', video: '🎬', audio: '🔊', pdf: '📄', file: '📎' };
    function cfThumb(f) {
      const k = cfKind(f);
      if (k === 'image') return `<img src="${esc(f.web_view_link)}" alt="" loading="lazy" class="h-10 w-10 flex-shrink-0 rounded object-cover" />`;
      return `<span class="grid h-10 w-10 flex-shrink-0 place-items-center rounded bg-ink-800 text-lg">${CF_ICON[k]}</span>`;
    }
    function cfOpenPreview(f) {
      if (!f) return; const url = f.web_view_link, k = cfKind(f);
      const node = el('div', { class: 'p-4' });
      const body = k === 'image' ? `<img src="${esc(url)}" alt="${esc(f.name)}" class="max-h-[72vh] w-full rounded-lg object-contain" />`
        : k === 'video' ? `<video src="${esc(url)}" controls autoplay playsinline class="max-h-[72vh] w-full rounded-lg bg-black"></video>`
        : k === 'audio' ? `<div class="rounded-lg bg-ink-800 p-6"><audio src="${esc(url)}" controls autoplay class="w-full"></audio></div>`
        : k === 'pdf' ? `<iframe src="${esc(url)}" title="${esc(f.name)}" class="h-[72vh] w-full rounded-lg bg-white"></iframe>`
        : `<div class="flex h-48 items-center justify-center rounded-lg bg-ink-800 text-sm text-slate-300">No inline preview for this type.</div>`;
      node.innerHTML = `<div class="mb-3 flex items-center justify-between gap-3"><p class="min-w-0 truncate text-sm font-semibold text-white">${CF_ICON[k]} ${esc(f.name)}</p><button class="close-x flex-shrink-0 text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>${body}<div class="mt-3 text-right"><a href="${esc(url)}" target="_blank" rel="noopener" class="text-xs text-blue-300 underline">Open original ↗</a></div>`;
      node.querySelector('.close-x').onclick = closeModal;
      openModal(node, { wide: true });
    }
    function renderCaseFiles() {
      const grid = $('#cf-grid'); if (!grid) return;
      const q = ($('#cf-search') ? $('#cf-search').value : '').trim().toLowerCase();
      const rows = CASE_FILES.filter((r) => !q || (r.case_number || '').toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q));
      if (!rows.length) { grid.innerHTML = `<p class="rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-500">${CASE_FILES.length ? 'No files match your filter.' : 'No case files attached yet. Pick a case number and use “Attach file”.'}</p>`; return; }
      const canDel = DB() && DB().canDelete();
      const byCase = {}; rows.forEach((r) => { (byCase[r.case_number] = byCase[r.case_number] || []).push(r); });
      grid.innerHTML = Object.keys(byCase).sort().map((cn) => `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-5"><div class="mb-3 flex items-center gap-2"><span class="text-lg">🗂️</span><h3 class="font-mono text-sm font-semibold text-blue-300">${esc(cn)}</h3><span class="text-[11px] text-slate-500">${byCase[cn].length} file${byCase[cn].length === 1 ? '' : 's'}</span></div><div class="grid grid-cols-1 gap-2 sm:grid-cols-2">${byCase[cn].map((f) => `<div class="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900 px-3 py-2"><button class="cf-open flex min-w-0 flex-1 items-center gap-3 text-left text-sm text-slate-200 hover:text-white" data-id="${esc(f.id)}">${cfThumb(f)}<span class="min-w-0"><span class="block truncate">${esc(f.name)}</span><span class="text-[10px] uppercase tracking-wider text-slate-500">${cfKind(f)} · preview</span></span></button>${canDel ? `<button class="cf-rm flex-shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-rose-300 hover:bg-rose-500/10" data-id="${esc(f.id)}" title="Remove attachment">✕</button>` : ''}</div>`).join('')}</div></div>`).join('');
      grid.querySelectorAll('.cf-open').forEach((b) => b.onclick = () => cfOpenPreview(CASE_FILES.find((x) => x.id === b.dataset.id)));
      grid.querySelectorAll('.cf-rm').forEach((b) => b.onclick = () => cfRemove(b.dataset.id));
    }
    async function cfRemove(id) {
      if (!(DB() && DB().canDelete())) { toast('Only command/director can remove attachments.', 'warn'); return; }
      const res = await DB().remove('case_files', id);
      if (res && res.error) { toast('Remove failed: ' + res.error.message, 'danger'); return; }
      toast('Attachment removed', 'info'); fetchCaseFiles();
    }
    // Upload a single File to FiveManage, then record it in case_files (Supabase).
    async function cfAttachFile(file, cn) {
      if (typeof fmUpload !== 'function') throw new Error('FiveManage module unavailable');
      const out = await fmUpload(file);   // → { url, kind }
      const row = { case_number: cn, drive_file_id: null, name: file.name, mime_type: file.type || null, icon_url: null, web_view_link: out.url, added_by: DB().me.id };
      const res = await DB().insert('case_files', row);
      if (res && res.error) throw new Error(res.error.message);
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
      if (!dbReady() || !(DB() && DB().me)) {
        if (toolbar) toolbar.classList.add('hidden');
        if (grid) grid.innerHTML = '';
        if (notice) { notice.classList.remove('hidden'); notice.innerHTML = 'Sign in to view and attach case files.'; }
        return;
      }
      const fmReady = (typeof fmConfigured === 'function' && fmConfigured());
      if (notice) {
        if (!fmReady) { notice.classList.remove('hidden'); notice.innerHTML = 'File upload not configured — set <code>window.CID_FIVEMANAGE.apiKey</code> in <code>index.html</code> to upload files. Existing attachments are still listed below.'; }
        else { notice.classList.add('hidden'); notice.innerHTML = ''; }
      }
      if (toolbar) { toolbar.classList.remove('hidden'); toolbar.classList.add('flex'); }
      const drop = $('#cf-drop'); if (drop) drop.classList.toggle('hidden', !fmReady);
      if (auth) auth.innerHTML = '<span class="rounded-lg bg-white/5 px-2.5 py-1.5 text-[11px] text-slate-300">Files upload to FiveManage; records stored in Supabase.</span>';
      cfPopulateCaseList();
      if (!cfWired) {
        cfWired = true;
        const at = $('#cf-attach'), fileInput = $('#cf-file');
        if (at) at.onclick = () => {
          const cn = ($('#cf-case') ? $('#cf-case').value : '').trim();
          if (!cn) { toast('Enter or pick a case number first.', 'warn'); return; }
          if (!(typeof fmConfigured === 'function' && fmConfigured())) { toast('FiveManage upload is not configured.', 'warn'); return; }
          if (fileInput) fileInput.click();
        };
        if (fileInput) fileInput.onchange = async () => {
          const cn = ($('#cf-case') ? $('#cf-case').value : '').trim();
          const files = Array.prototype.slice.call(fileInput.files || []);
          if (!cn || !files.length) { fileInput.value = ''; return; }
          let ok = 0;
          for (const f of files) { try { await cfAttachFile(f, cn); ok++; } catch (e) { toast('Upload failed: ' + (e.message || e), 'danger'); } }
          fileInput.value = '';
          if (ok) { toast(ok + ' file' + (ok === 1 ? '' : 's') + ' attached to ' + cn, 'success'); fetchCaseFiles(); }
        };
        const se = $('#cf-search'); if (se) se.oninput = (typeof debounce === 'function' ? debounce(renderCaseFiles, 150) : renderCaseFiles);
        // QoL: bulk drag-drop attach to the case number in #cf-case.
        const drop = $('#cf-drop');
        if (drop) {
          const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
          ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { stop(e); drop.classList.add('border-blue-500/50', 'bg-blue-500/5'); }));
          ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { stop(e); drop.classList.remove('border-blue-500/50', 'bg-blue-500/5'); }));
          drop.addEventListener('drop', async (e) => {
            const cn = ($('#cf-case') ? $('#cf-case').value : '').trim();
            if (!cn) { toast('Enter or pick a case number first.', 'warn'); return; }
            if (!(typeof fmConfigured === 'function' && fmConfigured())) { toast('FiveManage upload is not configured.', 'warn'); return; }
            const files = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.files) || []);
            if (!files.length) return;
            let ok = 0; for (const f of files) { try { await cfAttachFile(f, cn); ok++; } catch (err) { toast('Upload failed: ' + (err.message || err), 'danger'); } }
            if (ok) { toast(ok + ' file' + (ok === 1 ? '' : 's') + ' attached to ' + cn, 'success'); fetchCaseFiles(); }
          });
        }
      }
      fetchCaseFiles();
    }

    async function fetchCases() {
      if (!dbReady()) { casesNotice('Live case data requires sign-in. Configure Supabase + sign in to load cases.'); return; }
      $('#cases-live').classList.remove('hidden'); $('#cases-live').classList.add('inline-flex');
      try {
        casesCache = await DB().list('cases', { order: 'updated_at', ascending: false });
        renderCases();
        renderJumpBack();
        if (typeof refreshCaseSelects === 'function') refreshCaseSelects();
      } catch (e) { casesNotice('Could not load cases: ' + escapeHTML(e.message || String(e))); }
    }

    // QoL: days since a case last moved; flag open/active cases gone quiet (≥14d).
    function caseStaleDays(c) { return Math.floor((Date.now() - new Date(c.updated_at).getTime()) / 86400000); }
    function staleBadge(c) {
      if (c.status === 'closed' || c.status === 'cold') return '';
      const d = caseStaleDays(c); if (d < 14) return '';
      return `<span class="flex-shrink-0 rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300" title="No updates in ${d} days">⏳ ${d}d stale</span>`;
    }

    // Wave 1: auto-escalate cases gone quiet ≥14d. Runs once per load. The first
    // authorized viewer to spot a stale case pings its lead detective + bureau
    // command and stamps it (last_stale_notified_at — which does NOT bump
    // updated_at), so nobody else re-fires until it goes stale again ~14d later.
    const STALE_RENOTIFY_MS = 14 * 86400000;
    let _staleEscalated = false;
    async function escalateStaleCases() {
      if (_staleEscalated || !dbReady()) return;
      const m = (typeof meProfile === 'function') ? meProfile() : (DB() && DB().me);
      if (!m || !m.active) return;
      _staleEscalated = true;
      const now = Date.now();
      const stale = (casesCache || []).filter((c) => {
        if (c.status === 'closed' || c.status === 'cold') return false;
        if (caseStaleDays(c) < 14) return false;
        if (!c.last_stale_notified_at) return true;
        return (now - new Date(c.last_stale_notified_at).getTime()) >= STALE_RENOTIFY_MS;
      });
      if (!stale.length) return;
      const profs = (typeof PROFILES !== 'undefined' ? PROFILES : []);
      for (const c of stale) {
        // Stamp first; if another viewer beat us (or RLS blocks the write), skip.
        const res = await DB().update('cases', c.id, { last_stale_notified_at: new Date().toISOString() });
        if (res && res.error) continue;
        c.last_stale_notified_at = new Date().toISOString();
        const reason = 'No activity in ' + caseStaleDays(c) + ' days — needs an update or a status change.';
        const targets = new Set();
        if (c.lead_detective_id) targets.add(c.lead_detective_id);
        profs.filter((p) => p.active && p.role === 'bureau_lead' && p.bureau === c.bureau).forEach((p) => targets.add(p.id));
        // No bureau lead covering this bureau? escalate to the deputy directors.
        if (![...targets].some((id) => id !== c.lead_detective_id)) {
          profs.filter((p) => p.active && p.role === 'deputy_director').forEach((p) => targets.add(p.id));
        }
        for (const uid of targets) { if (typeof notify === 'function') await notify(uid, 'case_stale', { case_id: c.id, case_number: c.case_number, reason }); }
      }
      if (typeof renderCases === 'function') renderCases();
    }
    // QoL: read-only lifecycle strip for the case Overview (advance via Sign-off tab).
    function caseStageStrip(c) {
      const s = c.signoff_status || 'none', closed = c.status === 'closed';
      const inSignoff = ['awaiting_bureau_lead', 'awaiting_deputy', 'approved_deputy', 'awaiting_director', 'changes_requested', 'denied'].includes(s);
      const approved = ['approved_complete'].includes(s);
      const doj = s === 'ready_doj';
      const attn = s === 'changes_requested' || s === 'denied';
      const steps = [
        { label: 'Investigation', done: true, active: !inSignoff && !approved && !doj && !closed },
        { label: 'Sign-off', done: inSignoff || approved || doj || closed, active: inSignoff },
        { label: 'DOJ-Ready', done: doj || closed, active: doj },
        { label: 'Closed', done: closed, active: closed },
      ];
      const pill = (st) => {
        const cls = st.active ? (attn && st.label === 'Sign-off' ? 'border-orange-500/40 bg-orange-500/10 text-orange-200' : 'border-blue-500/40 bg-blue-500/10 text-white') : st.done ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-500';
        return `<span class="flex-shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold ${cls}">${st.done && !st.active ? '✓ ' : ''}${st.label}</span>`;
      };
      return `<div class="mb-6 rounded-2xl border border-white/5 bg-ink-900/60 p-4"><p class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Case lifecycle</p><div class="flex items-center gap-2 overflow-x-auto">${steps.map((st, i) => pill(st) + (i < steps.length - 1 ? '<span class="flex-shrink-0 text-slate-600">→</span>' : '')).join('')}</div><p class="mt-2 text-[11px] text-slate-500">Advance the case through sign-off &amp; DOJ from the <span class="text-slate-300">Sign-off</span> tab.</p></div>`;
    }

    function renderCases() {
      const grid = $('#cases-grid'); if (!grid) return;
      const q = ($('#case-search') ? $('#case-search').value : '').trim().toLowerCase();
      renderScopeChips();
      const mine = myId();
      let items = casesCache.filter((c) => !q || JSON.stringify(c).toLowerCase().includes(q));
      if (casesScope === 'mine' && mine) items = items.filter((c) => c.lead_detective_id === mine);
      $('#case-new').classList.toggle('hidden', !(DB() && DB().canEdit()));
      if (!items.length) {
        const scopedEmpty = casesScope === 'mine' && mine && casesCache.length;
        casesNotice(scopedEmpty ? 'No cases led by you. Switch to “All” to see every case.' : (casesCache.length ? 'No cases match your filter.' : 'No case files yet.' + (DB() && DB().canEdit() ? ' Use “+ New Case” to create the first.' : ''))); return;
      }
      grid.innerHTML = '';
      items.forEach((c) => {
        const card = el('div', { class: 'cursor-pointer rounded-2xl border border-white/5 bg-ink-900/60 p-5 transition hover:border-blue-500/30 hover:bg-white/5' });
        card.innerHTML = `
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0"><p class="truncate font-mono text-sm font-semibold text-blue-300">${escapeHTML(c.case_number)}</p><p class="mt-0.5 truncate text-sm text-white">${escapeHTML(c.title || 'Untitled case')}</p></div>
            <div class="flex flex-shrink-0 items-center gap-1.5">${staleBadge(c)}<span class="rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${caseStatusTint(c.status)}">${escapeHTML(c.status)}</span></div>
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
        ${!record ? `<div class="mb-4 rounded-xl border border-white/5 bg-ink-900/60 p-3">
          <div class="mb-2 flex items-center justify-between"><p class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Quick-create from template</p>${canReassign() ? '<button id="tpl-manage" type="button" class="text-[11px] font-semibold text-blue-300 transition hover:text-blue-200">Manage templates</button>' : ''}</div>
          <div id="tpl-chips" class="flex flex-wrap gap-2"></div>
        </div>` : ''}
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Case Number *</label><div class="flex items-stretch gap-2"><span id="cn-prefix" class="flex items-center rounded-lg bg-ink-800 px-3 font-mono text-sm font-semibold text-blue-300"></span><input data-k="__casenum" inputmode="numeric" value="${escapeHTML((c.case_number || '').replace(/^[A-Za-z]+-/, ''))}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 font-mono text-sm text-white outline-none focus:border-badge-500" placeholder="9000026" /></div><p class="mt-1 text-[11px] text-slate-500">The bureau prefix is added automatically — just type the number. LSB→1xxxxx · BCB→2xxxxx · SAB/JTF→9xxxxx. Must be unique.</p></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Title</label><input data-k="title" value="${escapeHTML(c.title || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Bureau</label>${sel('bureau', ['LSB', 'BCB', 'SAB', 'JTF'], c.bureau || 'JTF')}</div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Status</label>${sel('status', ['open', 'active', 'cold', 'closed'], c.status || 'open')}</div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Area / Region</label><input data-k="area" list="area-list" value="${escapeHTML(c.area || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="e.g. Vinewood, Sandy Shores, Mirror Park" /><p class="mt-1 text-[11px] text-slate-500">Used by the Commander Heatmap to plot case concentration.</p></div>
          ${canReassign() ? `<div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Owner — Lead Detective</label><select data-k="lead_detective_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="">— unassigned —</option>${(typeof PROFILES !== 'undefined' ? PROFILES : []).filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.id === c.lead_detective_id ? 'selected' : ''}>${escapeHTML(p.display_name)} · ${escapeHTML(ROLE_LABEL[p.role] || p.role)}</option>`).join('')}</select><p class="mt-1 text-[11px] text-slate-500">Ownership is separate from the sign-off chain; reassigning does not change sign-off progress.</p></div>` : ''}
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Summary</label><textarea data-k="summary" rows="4" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML(c.summary || '')}</textarea></div>
        </div>
        <button id="case-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create case'}</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      // Bureau prefix is shown as a fixed chip and applied automatically; the field
      // accepts digits only. Combined into BUREAU-NUMBER on save.
      const leadOf = (k) => ({ LSB: '1', BCB: '2', SAB: '9', JTF: '9' }[k] || '9');
      const bureauSel = node.querySelector('[data-k="bureau"]'), cnPre = node.querySelector('#cn-prefix'), cnNum = node.querySelector('[data-k="__casenum"]');
      const syncCn = () => { cnPre.textContent = bureauSel.value + '-'; cnNum.placeholder = leadOf(bureauSel.value) + 'xxxxx'; };
      syncCn(); bureauSel.onchange = syncCn;
      cnNum.oninput = () => { cnNum.value = cnNum.value.replace(/[^0-9]/g, ''); };
      // Quick-create template picker (new cases only): chips prefill the form.
      if (!record) {
        const chips = node.querySelector('#tpl-chips');
        const setV = (k, v) => { const f = node.querySelector(`[data-k="${k}"]`); if (f != null && v != null) f.value = v; };
        const applyTpl = (t) => {
          if (t) { setV('title', t.title || ''); if (t.bureau) bureauSel.value = t.bureau; setV('status', t.status || 'open'); setV('area', t.area || ''); setV('summary', t.summary || ''); syncCn(); }
          else { setV('title', ''); setV('area', ''); setV('summary', ''); }
        };
        const renderChips = () => {
          if (!chips) return;
          chips.innerHTML = `<button type="button" class="tpl-chip rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10" data-tpl="">🗂️ Blank</button>` +
            CASE_TEMPLATES.filter((t) => t.active !== false).map((t) => `<button type="button" class="tpl-chip rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10" data-tpl="${t.id}">${esc(t.icon || '🗂️')} ${escapeHTML(t.name)}</button>`).join('');
          chips.querySelectorAll('.tpl-chip').forEach((b) => b.onclick = () => {
            chips.querySelectorAll('.tpl-chip').forEach((x) => x.classList.remove('ring-1', 'ring-badge-500', 'bg-white/10'));
            b.classList.add('ring-1', 'ring-badge-500', 'bg-white/10');
            applyTpl(CASE_TEMPLATES.find((t) => t.id === b.dataset.tpl) || null);
          });
        };
        renderChips();
        if (!CASE_TEMPLATES.length) fetchCaseTemplates().then(renderChips);
        const mng = node.querySelector('#tpl-manage'); if (mng) mng.onclick = () => openTemplateManager();
      }
      node.querySelector('#case-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        const numv = (payload.__casenum || '').trim(); delete payload.__casenum;   // not a column
        if (!/^\d+$/.test(numv)) { toast('Enter the case number (digits only) — the bureau prefix is added automatically.', 'warn'); return; }
        if (numv[0] !== leadOf(payload.bureau)) toast(`Note: ${payload.bureau} case numbers usually start with ${leadOf(payload.bureau)} — saving anyway.`, 'warn');
        payload.case_number = `${payload.bureau}-${numv}`;
        const cn = payload.case_number;
        if ('lead_detective_id' in payload && !payload.lead_detective_id) payload.lead_detective_id = null;
        if ('area' in payload && !payload.area) payload.area = null;
        const res = record && record.id ? await DB().update('cases', record.id, payload) : await DB().insert('cases', payload);
        if (res.error) {
          const dup = /duplicate|unique|already exists|23505/i.test(res.error.message || '');
          toast(dup ? `Case number ${cn} already exists — choose a unique number.` : 'Save failed: ' + res.error.message, 'danger');
          return;
        }
        // New case → seed it with copies of the Forms templates, filed under its bureau folder.
        if (!record) {
          const newId = res.data && res.data[0] && res.data[0].id;
          if (newId) {
            try {
              const tpls = await DB().list('documents', { eq: { folder: 'Forms' } });
              const fname = (typeof BUREAU_FOLDER !== 'undefined' && BUREAU_FOLDER[payload.bureau]) || 'Archives';
              for (const t of tpls) await DB().insert('documents', { folder: fname, name: t.name, kind: t.kind, content: t.content, case_id: newId, modified_label: new Date().toLocaleDateString('en-GB') });
            } catch (e) {}
            if (typeof fetchDocuments === 'function') fetchDocuments();
          }
        }
        closeModal(); toast(record ? 'Case updated' : 'Case created', 'success'); fetchCases();
        if (record && record.id) openCaseDetail(record.id);
      };
      openModal(node, { wide: true });
    }

    // Command-editable case templates (Wave 1). Bureau Lead+ add / edit / remove.
    async function openTemplateManager() {
      if (!canReassign()) { toast('Command staff only.', 'warn'); return; }
      await fetchCaseTemplates();
      const node = el('div', { class: 'p-6' });
      const inp = 'w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500';
      const opt = (arr, v) => arr.map((o) => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('');
      const blank = () => ({ icon: '🗂️', name: '', bureau: '', title: '', status: 'open', summary: '' });
      const rowHtml = (t) => {
        const isNew = !t.id;
        return `<div class="rounded-xl border ${isNew ? 'border-dashed border-white/15' : 'border-white/10'} bg-ink-900 p-3" data-id="${t.id || ''}">
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-6">
            <input data-tk="icon" value="${escapeHTML(t.icon || '')}" placeholder="🗂️" class="${inp} sm:col-span-1" />
            <input data-tk="name" value="${escapeHTML(t.name || '')}" placeholder="Template name *" class="${inp} sm:col-span-3" />
            <select data-tk="bureau" class="${inp} sm:col-span-1"><option value="">(any)</option>${opt(['LSB', 'BCB', 'SAB', 'JTF'], t.bureau || '')}</select>
            <select data-tk="status" class="${inp} sm:col-span-1">${opt(['open', 'active', 'cold', 'closed'], t.status || 'open')}</select>
            <input data-tk="title" value="${escapeHTML(t.title || '')}" placeholder="Prefilled title (e.g. 'Narcotics raid — ')" class="${inp} sm:col-span-6" />
            <textarea data-tk="summary" rows="2" placeholder="Prefilled summary skeleton" class="${inp} sm:col-span-6">${escapeHTML(t.summary || '')}</textarea>
          </div>
          <div class="mt-2 flex gap-2">
            <button class="tm-save rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110">${isNew ? '+ Add template' : 'Save'}</button>
            ${isNew ? '' : '<button class="tm-del rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>'}
          </div>
        </div>`;
      };
      const collect = (rowEl) => { const o = {}; rowEl.querySelectorAll('[data-tk]').forEach((f) => o[f.dataset.tk] = f.value.trim()); o.bureau = o.bureau || null; return o; };
      const render = () => {
        node.innerHTML = `
          <div class="mb-4 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Case Templates</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
          <p class="mb-3 text-xs text-slate-400">Presets offered when creating a new case. Visible to all detectives; editable by command staff.</p>
          <div class="max-h-[55vh] space-y-3 overflow-y-auto pr-1">${CASE_TEMPLATES.map(rowHtml).join('')}${rowHtml(blank())}</div>`;
        node.querySelector('.close-x').onclick = closeModal;
        node.querySelectorAll('[data-id]').forEach((rowEl) => {
          const id = rowEl.dataset.id;
          const sv = rowEl.querySelector('.tm-save'); if (sv) sv.onclick = async () => {
            const o = collect(rowEl);
            if (!o.name) { toast('Template name is required.', 'warn'); return; }
            const res = id ? await DB().update('case_templates', id, o) : await DB().insert('case_templates', o);
            if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
            toast('Template saved', 'success'); await fetchCaseTemplates(); render();
          };
          const dl = rowEl.querySelector('.tm-del'); if (dl) dl.onclick = async () => {
            if (!(await uiConfirm('Delete this template?', { confirmText: 'Delete' }))) return;
            const res = await DB().remove('case_templates', id);
            if (res.error) { toast('Delete failed: ' + res.error.message, 'danger'); return; }
            toast('Template deleted', 'warn'); await fetchCaseTemplates(); render();
          };
        });
      };
      render();
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
        pushRecentCase(detailCase.id); renderJumpBack();
        $('#cases-list').classList.add('hidden');
        $('#case-detail').classList.remove('hidden');
        renderCaseDetailShell();
        loadDetailTab();
      } catch (e) { toast('Load failed: ' + (e.message || e), 'danger'); }
    }
    function renderCaseDetailShell() {
      const c = detailCase, canEdit = DB() && DB().canEdit(), canDel = DB() && DB().canDelete();
      const tabs = ['overview', 'evidence', 'charges', 'reports', 'signoff', 'chat', 'timeline'];
      $('#case-detail').innerHTML = `
        <button id="case-back" class="mb-4 inline-flex items-center gap-1 text-sm text-slate-300 transition hover:text-white">← All cases</button>
        <div class="mb-6 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><p class="font-mono text-sm text-blue-300">${escapeHTML(c.case_number)}</p><h3 class="text-xl font-bold text-white">${escapeHTML(c.title || 'Untitled case')}</h3><p class="mt-1 text-sm text-slate-400">${escapeHTML(c.summary || '')}</p></div>
            <div class="flex items-center gap-2">
              <span class="rounded-md px-2.5 py-1 text-[10px] font-semibold uppercase ${caseStatusTint(c.status)}">${escapeHTML(c.status)}</span>
              ${c.signoff_status && c.signoff_status !== 'none' ? `<span class="rounded-md px-2.5 py-1 text-[10px] font-semibold ${signoffTint(c.signoff_status)}" title="Sign-off status">${escapeHTML(signoffLabel(c.signoff_status))}</span>` : ''}
              <span class="rounded-md bg-white/5 px-2.5 py-1 text-xs text-slate-300">${escapeHTML(c.bureau)}</span>
              <button id="case-pin" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold transition hover:bg-white/10 ${isPinned(c.id) ? 'text-amber-300' : 'text-slate-200'}" title="Pin to Jump-back">${isPinned(c.id) ? '📌 Pinned' : '📌 Pin'}</button>
              <button id="case-link" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10" title="Copy a deep link to this case">🔗 Link</button>
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
      const pin = $('#case-pin'); if (pin) pin.onclick = () => { togglePinCase(detailCase.id); renderCaseDetailShell(); renderJumpBack(); };
      const lk = $('#case-link'); if (lk) lk.onclick = () => {
        const url = location.origin + location.pathname + '#case=' + detailCase.id;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => toast('Case link copied', 'success'), () => toast(url, 'info'));
        else toast(url, 'info');
      };
      const pk = $('#case-packet'); if (pk) pk.onclick = () => exportCasePacket(detailCase);
      const eb = $('#case-edit'); if (eb) eb.onclick = () => openCaseModal(detailCase);
      const db = $('#case-del'); if (db) db.onclick = async () => {
        if (!(await uiConfirm('Delete case ' + detailCase.case_number + '? This cascades to its evidence/reports.', { confirmText: 'Delete case' }))) return;
        const r = await DB().remove('cases', detailCase.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; }
        toast('Case deleted', 'warn'); showCasesList(); fetchCases();
      };
      $$('.detail-tab', $('#case-detail')).forEach((b) => b.onclick = () => { detailTab = b.dataset.dt; renderCaseDetailShell(); loadDetailTab(); });
    }
    async function loadDetailTab() {
      const body = $('#detail-body'); const cid = detailCase.id; const canEdit = DB() && DB().canEdit();
      try {
        if (detailTab === 'overview') {
          const [ev, rep, asg] = await Promise.all([ DB().list('evidence', { eq: { case_id: cid } }), DB().list('reports', { eq: { case_id: cid } }), DB().list('case_assignments', { eq: { case_id: cid } }).catch(() => []) ]);
          const ownerName = officerName(detailCase.lead_detective_id) || '— unassigned —';
          const canDel = DB() && DB().canDelete();
          const profs = (typeof PROFILES !== 'undefined' ? PROFILES : []);
          const assigned = new Set(asg.map((a) => a.officer_id));
          const chips = asg.length ? asg.map((a) => `<span class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200">👤 ${escapeHTML(officerName(a.officer_id) || 'Officer')}${a.role ? ` · <span class="text-slate-400">${escapeHTML(a.role)}</span>` : ''}${canDel ? ` <button class="asg-rm text-rose-300 hover:text-rose-200" data-id="${a.id}" title="Remove assignee">✕</button>` : ''}</span>`).join('') : '<span class="text-sm text-slate-500">No additional assignees — only the lead detective.</span>';
          const opts = profs.filter((p) => p.active && p.id !== detailCase.lead_detective_id && !assigned.has(p.id)).map((p) => `<option value="${p.id}">${escapeHTML(p.display_name)}</option>`).join('');
          body.innerHTML = `${caseStageStrip(detailCase)}<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
            ${[['Evidence', ev.length], ['Reports', rep.length], ['Lifecycle', detailCase.status], ['Owner (Lead Det.)', ownerName], ['Sign-off', signoffLabel(detailCase.signoff_status || 'none')]].map((k) => `<div class="rounded-2xl border border-white/5 bg-ink-900/60 p-5"><p class="text-xs uppercase tracking-wider text-slate-400">${k[0]}</p><p class="mt-1 text-lg font-bold text-white">${escapeHTML(String(k[1]))}</p></div>`).join('')}
          </div>
          <div class="mt-6 rounded-2xl border border-white/5 bg-ink-900/60 p-5">
            <h4 class="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Assigned Officers</h4>
            <div class="flex flex-wrap gap-2">${chips}</div>
            ${canEdit ? `<div class="mt-4 flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
              <select id="asg-officer" class="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${opts || '<option value="">— no available officers —</option>'}</select>
              <select id="asg-role" class="rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${['Co-investigator', 'Support', 'Analyst', 'Surveillance', 'Forensics'].map((r) => `<option>${r}</option>`).join('')}</select>
              <button id="asg-add" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">+ Assign</button>
            </div>` : ''}
          </div>`;
          const ab = $('#asg-add'); if (ab) ab.onclick = async () => {
            const oid = $('#asg-officer').value; if (!oid) { toast('Pick an officer to assign.', 'warn'); return; }
            const res = await DB().insert('case_assignments', { case_id: cid, officer_id: oid, role: $('#asg-role').value });
            if (res.error) { toast('Assign failed: ' + res.error.message, 'danger'); return; }
            toast('Officer assigned', 'success');
            if (typeof notify === 'function') notify(oid, 'mention', { case_number: detailCase.case_number, reason: 'You were assigned to this case.' });
            loadDetailTab();
          };
          $$('.asg-rm', body).forEach((b) => b.onclick = async () => { const res = await DB().remove('case_assignments', b.dataset.id); if (res && res.error) { toast('Remove failed: ' + res.error.message, 'danger'); return; } toast('Assignee removed', 'info'); loadDetailTab(); });
        } else if (detailTab === 'evidence') {
          const [ev, med] = await Promise.all([
            DB().list('evidence', { order: 'created_at', ascending: false, eq: { case_id: cid } }),
            DB().list('media', { order: 'created_at', ascending: false, eq: { case_id: cid } }).catch(() => []),
          ]);
          const canUpload = canEdit && typeof fmConfigured === 'function' && fmConfigured();
          const mediaActions = canEdit ? `<div class="flex flex-wrap gap-2">
            ${canUpload ? '<button id="cmedia-upload" class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10">⬆ Upload photos</button>' : ''}
            <button id="cmedia-attach" class="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/10">📎 Attach from Vault</button>
            <button id="cmedia-add" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">+ Add link</button>
          </div>` : '';
          body.innerHTML = `
            <div class="mb-3 flex items-center justify-between"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Evidence (${ev.length})</h4>${canEdit ? '<button id="ev-new" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">+ Add Evidence</button>' : ''}</div>
            <div class="space-y-3">${ev.length ? ev.map(evidenceCard).join('') : '<p class="text-sm text-slate-500">No evidence logged.</p>'}</div>
            <div class="mt-8 mb-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-6"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Linked Media (${med.length})</h4>${mediaActions}</div>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">${med.length ? med.map((m) => caseMediaCard(m, canEdit)).join('') : '<p class="text-sm text-slate-500">No media linked to this case. Upload photos, add a link, or attach one from the Media Vault.</p>'}</div>`;
          const nb = $('#ev-new'); if (nb) nb.onclick = () => openEvidenceModal(cid);
          $$('.ev-custody', body).forEach((b) => b.onclick = () => openCustody(b.dataset.id));
          $$('.ev-del', body).forEach((b) => b.onclick = async () => {
            if (!(await uiConfirm('Delete this evidence item? This also removes its chain-of-custody history.', { confirmText: 'Delete' }))) return;
            const res = await DB().remove('evidence', b.dataset.id);
            if (res.error) { toast('Delete failed: ' + res.error.message, 'danger'); return; }
            toast('Evidence deleted', 'warn'); loadDetailTab();
          });
          const ma = $('#cmedia-add'); if (ma) ma.onclick = () => openCaseMediaLink(cid);
          const mt = $('#cmedia-attach'); if (mt) mt.onclick = () => openAttachMedia(cid);
          const mu = $('#cmedia-upload'); if (mu) mu.onclick = () => openCaseMediaUpload(cid);
          $$('.cmedia-detach', body).forEach((b) => b.onclick = async () => {
            if (!(await uiConfirm('Detach this media from the case? It stays in the Media Vault.', { danger: false, confirmText: 'Detach' }))) return;
            const res = await DB().update('media', b.dataset.id, { case_id: null });
            if (res.error) { toast('Detach failed: ' + res.error.message, 'danger'); return; }
            toast('Media detached', 'info'); if (typeof fetchMedia === 'function') fetchMedia(); loadDetailTab();
          });
        } else if (detailTab === 'charges') {
          renderCaseCharges(body);
        } else if (detailTab === 'reports') {
          await renderCaseReports(body, cid);
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
        <div class="mt-2 flex gap-2"><button class="ev-custody rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10" data-id="${e.id}">Chain of custody</button>${(DB() && DB().canDelete()) ? `<button class="ev-del rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10" data-id="${e.id}">Delete</button>` : ''}</div>
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
        <p class="mt-3 text-[11px] text-slate-500">Auto-stamped on log: <span class="text-slate-300">collected by ${escapeHTML((DB() && DB().me && DB().me.display_name) || 'you')}</span> · ${new Date().toLocaleDateString('en-US')}.</p>
        <button id="ev-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Log Evidence</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#ev-save').onclick = async () => {
        const payload = { case_id: caseId }; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim() || null);
        if (!payload.description) { toast('Description is required.', 'warn'); return; }
        if (DB() && DB().me) payload.collected_by = DB().me.id;   // QoL: default collector = you
        const res = await DB().insert('evidence', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Evidence logged', 'success'); loadDetailTab();
      };
      openModal(node, { wide: true });
    }

    /* ---- Case-linked media (Evidence tab) -------------------------------------
     * Media is a one-case-per-asset model (media.case_id). The Evidence tab shows
     * the case's media with thumbnails — an image URL renders as a preview, anything
     * else falls back to a type icon. You can add a link inline or attach an existing
     * vault asset (which moves it onto this case). No schema change. */
    const CASE_MEDIA_ICON = { image: '🖼️', video: '🎞️', fivemanage: '📹', document: '📄', audio: '🎧' };
    function caseMediaCard(m, canEdit) {
      const icon = CASE_MEDIA_ICON[m.type] || '📎';
      const url = m.external_url || '';
      const looksImg = m.type === 'image' || /\.(png|jpe?g|gif|webp|bmp|avif)(\?|#|$)/i.test(url);
      const fallback = `<div class="grid h-32 w-full place-items-center rounded-lg bg-ink-800 text-3xl">${icon}</div>`;
      const thumb = (url && looksImg)
        ? `<img src="${escapeHTML(url)}" alt="" loading="lazy" class="h-32 w-full rounded-lg object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'" /><div class="hidden h-32 w-full place-items-center rounded-lg bg-ink-800 text-3xl">${icon}</div>`
        : fallback;
      return `<div class="overflow-hidden rounded-xl border border-white/10 bg-ink-900">
        ${thumb}
        <div class="p-3">
          <p class="truncate text-sm font-semibold text-white" title="${escapeHTML(m.title || '')}">${escapeHTML(m.title || 'Untitled')}</p>
          <p class="mt-0.5 text-[11px] text-slate-400">${escapeHTML(m.kind || m.type || 'media')}</p>
          <div class="mt-2 flex items-center gap-2">
            ${url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-blue-200 transition hover:bg-white/10">open ↗</a>` : ''}
            ${canEdit ? `<button class="cmedia-detach rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-rose-300 transition hover:bg-rose-500/10" data-id="${m.id}">Detach</button>` : ''}
          </div>
        </div>
      </div>`;
    }
    function openCaseMediaLink(caseId) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Add Media Link</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Title *</label><input id="cm-title" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" placeholder="e.g. Dashcam — Vinewood pursuit" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Type</label><select id="cm-type" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500"><option value="image">Direct Image URL</option><option value="video">MP4 Video Link</option><option value="fivemanage">FiveManage CDN Embed</option></select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">URL / Embed ID</label><input id="cm-url" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 font-mono text-xs text-white outline-none focus:border-badge-500" placeholder="https://… or fm_xxxxx" /></div>
        </div>
        <p class="mt-2 text-[11px] text-slate-500">Linked to this case and added to the Media Vault. An image URL shows a thumbnail.</p>
        <button id="cm-go" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Add media</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#cm-go').onclick = async () => {
        const title = node.querySelector('#cm-title').value.trim();
        if (!title) { toast('A title is required.', 'warn'); return; }
        const type = node.querySelector('#cm-type').value;
        const kind = type === 'image' ? 'Image URL' : type === 'video' ? 'MP4 Video' : 'FiveManage Embed';
        const res = await DB().insert('media', { title, type, kind, external_url: node.querySelector('#cm-url').value.trim() || null, case_id: caseId });
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Media linked to case', 'success'); if (typeof fetchMedia === 'function') fetchMedia(); loadDetailTab();
      };
      openModal(node);
    }
    // Multi-photo upload → FiveManage → one media row per file, linked to the case.
    function openCaseMediaUpload(caseId) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      if (typeof fmConfigured !== 'function' || !fmConfigured()) { toast('Direct upload isn’t configured — use “+ Add link” to paste a URL.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between"><h3 class="text-lg font-bold text-white">Upload Photos / Video</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-3 text-xs text-slate-400">Pick one or more files — each is uploaded to FiveManage and linked to this case. Images show a thumbnail automatically.</p>
        <input id="cmu-files" type="file" accept="image/*,video/*" multiple class="block w-full text-xs text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-white" />
        <div id="cmu-status" class="mt-3 text-xs text-slate-400"></div>
        <button id="cmu-go" class="mt-4 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Upload &amp; link</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#cmu-go').onclick = async () => {
        const files = Array.from((node.querySelector('#cmu-files').files) || []);
        if (!files.length) { toast('Choose at least one file.', 'warn'); return; }
        const status = node.querySelector('#cmu-status'); const goBtn = node.querySelector('#cmu-go'); goBtn.disabled = true;
        let ok = 0, fail = 0;
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          status.textContent = `Uploading ${i + 1}/${files.length}: ${f.name}…`;
          try {
            const out = await fmUpload(f);
            const isVid = out.kind === 'video';
            const res = await DB().insert('media', { title: f.name.replace(/\.[^.]+$/, ''), type: isVid ? 'video' : 'image', kind: isVid ? 'MP4 Video' : 'Image URL', external_url: out.url, case_id: caseId });
            if (res.error) fail++; else ok++;
          } catch (e) { fail++; }
        }
        closeModal();
        toast(`Uploaded ${ok} file${ok === 1 ? '' : 's'}${fail ? ` · ${fail} failed` : ''}`, fail && !ok ? 'danger' : 'success');
        if (typeof fetchMedia === 'function') fetchMedia(); loadDetailTab();
      };
      openModal(node);
    }
    function openAttachMedia(caseId) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const pool = (typeof MEDIA !== 'undefined' ? MEDIA : []).filter((m) => m.case_id !== caseId);
      const node = el('div', { class: 'p-6' });
      const rows = pool.map((m) => {
        const cn = m.case_id && typeof caseNumById === 'function' ? caseNumById(m.case_id) : null;
        const where = cn ? ` <span class="text-[11px] text-amber-300/80">· moves from ${escapeHTML(cn)}</span>` : '';
        return `<div class="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900 px-3 py-2">
          <span class="flex min-w-0 items-center gap-2 text-sm text-slate-200"><span class="text-lg">${CASE_MEDIA_ICON[m.type] || '📎'}</span><span class="truncate">${escapeHTML(m.title || 'Untitled')}${where}</span></span>
          <button class="cm-attach flex-shrink-0 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-blue-200 transition hover:bg-white/10" data-id="${m.id}">Attach</button>
        </div>`;
      }).join('');
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between"><h3 class="text-lg font-bold text-white">Attach Media from Vault</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        ${pool.length ? `<p class="mb-3 text-[11px] text-slate-500">Media belongs to one case — attaching moves it onto this case.</p><div class="max-h-[60vh] space-y-2 overflow-y-auto">${rows}</div>` : '<p class="text-sm text-slate-500">No other media in the vault. Use “+ Add link” to create one.</p>'}`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelectorAll('.cm-attach').forEach((b) => b.onclick = async () => {
        const res = await DB().update('media', b.dataset.id, { case_id: caseId });
        if (res.error) { toast('Attach failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Media attached to case', 'success'); if (typeof fetchMedia === 'function') fetchMedia(); loadDetailTab();
      });
      openModal(node, { wide: true });
    }
    /* ---- Penal-code charges on a case (cases.charges jsonb = [{code,count}]) ---- */
    function caseCharges() { return Array.isArray(detailCase && detailCase.charges) ? detailCase.charges : []; }
    async function saveCaseCharges(list) {
      const res = await DB().update('cases', detailCase.id, { charges: list });
      if (res.error) { toast('Save failed: ' + (res.error.message || res.error), 'danger'); return false; }
      detailCase.charges = list; return true;
    }
    async function addCharge(code) {
      const list = caseCharges().slice(); const ex = list.find((x) => x.code === code); const c = penalByCode(code);
      if (ex) { if (c && c.stack) ex.count = Math.max(1, (ex.count || 1) + 1); else { toast('Charge already attached.', 'info'); return false; } }
      else list.push({ code: code, count: 1 });
      return await saveCaseCharges(list);
    }
    function renderCaseCharges(body) {
      const canEdit = DB() && DB().canEdit();
      const list = caseCharges();
      const t = penalTotals(list);
      const totalCounts = list.reduce((s, x) => s + Math.max(1, x.count || 1), 0);
      const ricoCount = list.reduce((n, x) => { const c = penalByCode(x.code); return n + (c && c.rico ? Math.max(1, x.count || 1) : 0); }, 0);
      const recCodes = canEdit ? penalRecommend([detailCase.title, detailCase.summary].filter(Boolean).join(' '), 8).filter((code) => !list.some((x) => x.code === code)) : [];
      const rows = list.map((x) => {
        const c = penalByCode(x.code); if (!c) return `<div class="rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-sm text-slate-500">Unknown charge ${esc(x.code)}${canEdit ? ` <button class="ch-rm text-rose-300" data-code="${esc(x.code)}">✕</button>` : ''}</div>`;
        const n = Math.max(1, x.count || 1);
        return `<div class="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900 px-3 py-2">
          <div class="min-w-0"><p class="text-sm text-slate-200"><span class="font-mono text-blue-300">${esc(c.code)}</span> ${esc(c.title)}${c.rico ? ' <span class="text-[10px] font-semibold text-fuchsia-300" title="RICO-eligible predicate">RICO</span>' : ''}${c.stack ? ' <span class="text-[10px] text-slate-500" title="Stackable">Ⓢ</span>' : ''}</p>
          <p class="text-[11px] text-slate-500"><span class="rounded border px-1.5 py-0.5 ${PENAL_LEVEL_TINT[c.level] || ''}">${esc(c.level)}</span> · ${penalSentence(c.jail)} · ${c.fine != null ? fmtUSD(c.fine) : '—'} each</p></div>
          <div class="flex flex-shrink-0 items-center gap-2">${canEdit && c.stack ? `<div class="flex items-center gap-1"><button class="ch-dec rounded border border-white/10 bg-white/5 px-2 text-sm text-slate-200" data-code="${esc(c.code)}">−</button><span class="w-6 text-center text-sm text-white">${n}</span><button class="ch-inc rounded border border-white/10 bg-white/5 px-2 text-sm text-slate-200" data-code="${esc(c.code)}">+</button></div>` : (n > 1 ? `<span class="text-xs text-slate-400">×${n}</span>` : '')}${canEdit ? `<button class="ch-rm rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-rose-300 transition hover:bg-rose-500/10" data-code="${esc(c.code)}">✕</button>` : ''}</div>
        </div>`;
      }).join('');
      body.innerHTML = `
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Charges (${list.length})</h4>${canEdit ? '<button id="ch-add" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">+ Add charge</button>' : ''}</div>
        ${list.length ? `<div class="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div class="rounded-lg border border-white/5 bg-ink-900/60 p-3"><p class="text-[10px] uppercase tracking-wider text-slate-500">Counts</p><p class="text-lg font-bold text-white">${totalCounts}</p></div>
          <div class="rounded-lg border border-white/5 bg-ink-900/60 p-3"><p class="text-[10px] uppercase tracking-wider text-slate-500">Max sentence</p><p class="text-lg font-bold text-white">${penalSentence(t.months)}${t.judge ? ' +JUDGE' : ''}</p></div>
          <div class="rounded-lg border border-white/5 bg-ink-900/60 p-3"><p class="text-[10px] uppercase tracking-wider text-slate-500">Max fines</p><p class="text-lg font-bold text-white">${fmtUSD(t.fine)}</p></div>
          <div class="rounded-lg border border-white/5 bg-ink-900/60 p-3"><p class="text-[10px] uppercase tracking-wider text-slate-500">RICO predicates</p><p class="text-lg font-bold ${ricoCount ? 'text-fuchsia-300' : 'text-white'}">${ricoCount}</p></div>
        </div>` : ''}
        <div class="space-y-2">${list.length ? rows : '<p class="text-sm text-slate-500">No charges attached.' + (canEdit ? ' Use “+ Add charge”, or a recommendation below.' : '') + '</p>'}</div>
        ${recCodes.length ? `<div class="mt-5"><p class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-blue-300/70">Recommended (from case text)</p><div class="flex flex-wrap gap-2">${recCodes.map((code) => { const c = penalByCode(code); return `<button class="ch-rec rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10" data-code="${esc(code)}">+ <span class="font-mono text-blue-300">${esc(c.code)}</span> ${esc(c.title)}</button>`; }).join('')}</div></div>` : ''}
        <p class="mt-4 text-[11px] text-slate-500">Sentences/fines are statutory maximums per the San Andreas Penal Code (catalog in penal.js).${ricoCount ? ` ${ricoCount} RICO-eligible predicate(s) — <button id="ch-rico" class="text-fuchsia-300 hover:text-fuchsia-200">open RICO Builder →</button>` : ''}</p>`;
      const add = $('#ch-add', body); if (add) add.onclick = () => openChargePicker();
      $$('.ch-rm', body).forEach((b) => b.onclick = async () => { const next = caseCharges().filter((x) => x.code !== b.dataset.code); if (await saveCaseCharges(next)) renderCaseCharges(body); });
      $$('.ch-inc', body).forEach((b) => b.onclick = async () => { const next = caseCharges().map((x) => x.code === b.dataset.code ? { code: x.code, count: Math.max(1, (x.count || 1) + 1) } : x); if (await saveCaseCharges(next)) renderCaseCharges(body); });
      $$('.ch-dec', body).forEach((b) => b.onclick = async () => { const next = caseCharges().map((x) => x.code === b.dataset.code ? { code: x.code, count: Math.max(1, (x.count || 1) - 1) } : x); if (await saveCaseCharges(next)) renderCaseCharges(body); });
      $$('.ch-rec', body).forEach((b) => b.onclick = async () => { if (await addCharge(b.dataset.code)) renderCaseCharges(body); });
      const rico = $('#ch-rico', body); if (rico) rico.onclick = () => { if (typeof navigate === 'function') navigate('rico'); };
    }
    function openChargePicker() {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between"><h3 class="text-lg font-bold text-white">Add Charge — Penal Code</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <input id="ch-search" type="text" placeholder="Search code, title, level…" class="mb-3 w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" />
        <div id="ch-list" class="max-h-[55vh] space-y-1.5 overflow-y-auto pr-1"></div>`;
      node.querySelector('.close-x').onclick = closeModal;
      const listEl = node.querySelector('#ch-list');
      const draw = (q) => {
        const attached = new Set(caseCharges().map((x) => x.code));
        listEl.innerHTML = penalSearch(q).map((c) => `<button class="ch-pick flex w-full items-center justify-between gap-3 rounded-lg border border-white/5 bg-ink-900 px-3 py-2 text-left transition hover:bg-white/5 ${attached.has(c.code) && !c.stack ? 'opacity-50' : ''}" data-code="${esc(c.code)}">
          <span class="min-w-0"><span class="font-mono text-xs text-blue-300">${esc(c.code)}</span> <span class="text-sm text-slate-200">${esc(c.title)}</span>${c.rico ? ' <span class="text-[10px] text-fuchsia-300">RICO</span>' : ''}<br><span class="text-[11px] text-slate-500">${esc(c.level)} · ${penalSentence(c.jail)} · ${c.fine != null ? fmtUSD(c.fine) : '—'}</span></span>
          <span class="flex-shrink-0 text-xs text-blue-300">${attached.has(c.code) ? (c.stack ? '+1' : 'added') : '+ add'}</span></button>`).join('') || '<p class="text-sm text-slate-500">No matching charge.</p>';
        $$('.ch-pick', listEl).forEach((b) => b.onclick = async () => { if (await addCharge(b.dataset.code)) { toast('Charge added', 'success'); draw(node.querySelector('#ch-search').value); const bd = $('#detail-body'); if (bd) renderCaseCharges(bd); } });
      };
      node.querySelector('#ch-search').oninput = (e) => draw(e.target.value);
      draw('');
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
      fetchCaseTemplates();
      if (typeof fetchMyGrants === 'function') fetchMyGrants();
      if (typeof fetchAnnouncements === 'function') fetchAnnouncements();
      if (typeof renderOfficerCard === 'function') renderOfficerCard();
      if (typeof fetchCaseFiles === 'function') fetchCaseFiles();
      if (typeof fetchShifts === 'function') fetchShifts();
      // Give cases + roster a moment to load, then run the once-per-session
      // stale-case escalation (self-guarded against re-runs).
      if (dbReady()) setTimeout(escalateStaleCases, 6000);
      if (dbReady()) {
        DB().subscribe('cases', () => { fetchCases(); fetchKpis(); renderBureauLoad(); if (typeof renderBureauScorecards === 'function') renderBureauScorecards(); if (typeof detailCase !== 'undefined' && detailCase && !$('#case-detail').classList.contains('hidden')) { DB().list('cases', { eq: { id: detailCase.id } }).then((r) => { if (r[0]) { detailCase = r[0]; renderCaseDetailShell(); loadDetailTab(); } }).catch(() => {}); } });
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
        DB().subscribe('case_templates', fetchCaseTemplates);
        if (typeof fetchCaseFiles === 'function') DB().subscribe('case_files', fetchCaseFiles);
        if (typeof fetchShifts === 'function') DB().subscribe('shift_reports', fetchShifts);
        renderAdmin();
      }
    };

