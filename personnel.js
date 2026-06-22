/* personnel.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 8. PERSONNEL ============================================================ */
    /* ---- Personnel roster (from profiles) ---- */
    function renderRoster() {
      const g = $('#roster-grid'); if (!g) return;
      if (!dbReady()) { g.innerHTML = '<p class="text-sm text-slate-500 sm:col-span-2 xl:col-span-3">Sign in to view the roster.</p>'; return; }
      if (!PROFILES.length) { g.innerHTML = '<p class="text-sm text-slate-500 sm:col-span-2 xl:col-span-3">No officers on the roster yet.</p>'; return; }
      g.innerHTML = '';
      const myId = (DB() && DB().me) ? DB().me.id : null;
      const admin = DB() && DB().isAdmin();
      PROFILES.forEach((p) => {
        const init = (p.display_name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        const isMe = myId && p.id === myId;
        const roleLabel = (typeof ROLE_LABEL !== 'undefined' && ROLE_LABEL[p.role]) || p.role;
        const card = el('div', { class: `rounded-2xl border bg-ink-900/60 p-5 transition hover:border-white/10 ${p.loa ? 'border-amber-500/20' : 'border-white/5'}` }, `
          <div class="flex items-center gap-3"><div class="grid h-12 w-12 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 text-sm font-bold text-white">${esc(init)}</div>
            <div class="min-w-0 flex-1"><p class="truncate font-semibold text-white">${esc(p.display_name)}${p.loa ? ' <span class="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-300">On LOA</span>' : ''}</p><p class="text-xs text-slate-400">${esc(roleLabel)}</p></div>
            <span class="pulse-dot h-2.5 w-2.5 rounded-full ${p.loa ? 'bg-amber-400' : p.active ? 'bg-emerald-400' : 'bg-slate-500'}" title="${p.loa ? 'On LOA' : p.active ? 'Active' : 'Pending'}"></span></div>
          <div class="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div class="rounded-lg bg-ink-850 py-2"><p class="font-mono font-bold text-blue-300">${esc(p.badge_number || '—')}</p><p class="text-[10px] text-slate-500">Badge</p></div>
            <div class="rounded-lg bg-ink-850 py-2"><p class="font-semibold text-slate-200">${esc(p.division)}</p><p class="text-[10px] text-slate-500">Bureau</p></div>
            <div class="rounded-lg bg-ink-850 py-2"><p class="font-semibold ${p.loa ? 'text-amber-300' : 'text-slate-200'}">${p.loa ? 'On LOA' : p.active ? 'Active' : 'Pending'}</p><p class="text-[10px] text-slate-500">Status</p></div>
          </div>
          ${isMe ? `<button class="loa-self mt-3 w-full rounded-lg border px-3 py-2 text-xs font-semibold transition ${p.loa ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300 hover:bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/5 text-amber-200 hover:bg-amber-500/10'}">${p.loa ? 'Clear my LOA — return active' : 'Set myself On LOA'}</button>` : ''}
          ${(admin || isMe) ? `<button class="ros-edit mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/10">✎ Edit ${isMe && !admin ? 'my profile' : 'officer'}</button>` : ''}
          ${(admin && !isMe && p.active) ? `<button class="ros-remove mt-2 w-full rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">Remove from roster</button>` : ''}`);
        const lb = card.querySelector('.loa-self'); if (lb && typeof setMyLoa === 'function') lb.onclick = () => setMyLoa(!p.loa);
        const eb = card.querySelector('.ros-edit');
        if (eb) eb.onclick = () => { if (admin && typeof openAssignModal === 'function') openAssignModal(p); else if (typeof openMyProfile === 'function') openMyProfile(); };
        const rb = card.querySelector('.ros-remove');
        if (rb) rb.onclick = async () => {
          if (!(await uiConfirm('Remove ' + (p.display_name || 'this officer') + ' from the active roster? They keep their account but can’t act until reactivated.', { confirmText: 'Deactivate' }))) return;
          const res = await DB().rpc('assign_member', { target: p.id, new_role: p.role, new_division: p.division || null, set_active: false });
          if (res && res.error) { toast('Remove failed: ' + res.error.message, 'danger'); return; }
          toast((p.display_name || 'Officer') + ' removed from active roster', 'warn');
          if (typeof fetchProfiles === 'function') fetchProfiles().then(() => { renderRoster(); if (typeof renderAdmin === 'function') renderAdmin(); }); else renderRoster();
        };
        g.appendChild(card);
      });
    }

    /* ---- Commendations (Supabase) ---- */
    const COMM_TINTS = { amber: 'from-amber-500/20 to-amber-700/5 border-amber-500/20', blue: 'from-blue-500/20 to-blue-700/5 border-blue-500/20', violet: 'from-violet-500/20 to-violet-700/5 border-violet-500/20', emerald: 'from-emerald-500/20 to-emerald-700/5 border-emerald-500/20' };
    async function fetchCommendations() { if (!dbReady()) { renderCommendations(); return; } try { COMMENDATIONS = await DB().list('commendations', { order: 'created_at', ascending: false }); } catch (e) {} renderCommendations(); }
    function renderCommendations() {
      const g = $('#commend-grid'); if (!g) return;
      const canEdit = DB() && DB().canEdit(), canDel = DB() && DB().canDelete();
      const nb = $('#add-commend'); if (nb) nb.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { g.innerHTML = '<p class="text-sm text-slate-500 sm:col-span-2 lg:col-span-3">Sign in to view commendations.</p>'; return; }
      if (!COMMENDATIONS.length) { g.innerHTML = `<p class="text-sm text-slate-500 sm:col-span-2 lg:col-span-3">No commendations.${canEdit ? ' Use “+ Commendation”.' : ''}</p>`; return; }
      g.innerHTML = '';
      COMMENDATIONS.forEach((c) => {
        const card = el('div', { class: `relative rounded-2xl border bg-gradient-to-br ${COMM_TINTS[c.tint] || COMM_TINTS.amber} p-5` });
        card.innerHTML = `
          <div class="flex items-start gap-3"><span class="text-3xl">${esc(c.icon || '🎖️')}</span><div class="min-w-0 flex-1"><p class="font-semibold text-white">${esc(c.title)}</p><p class="text-xs text-slate-300">${esc(c.recipient_name || officerName(c.recipient_id) || '—')}</p></div>${canEdit ? '<button class="cm-edit text-[11px] text-slate-400 hover:text-white">edit</button>' : ''}</div>
          <p class="mt-3 text-xs text-slate-300">${esc(c.note || '')}</p>`;
        const eb = card.querySelector('.cm-edit'); if (eb) eb.onclick = () => openCommendModal(c);
        g.appendChild(card);
      });
    }
    function openCommendModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const c = record || {};
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Commendation</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Title *</label><input data-k="title" value="${esc(c.title || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Recipient</label><input data-k="recipient_name" value="${esc(c.recipient_name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" placeholder="Officer name" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Icon</label><input data-k="icon" value="${esc(c.icon || '🎖️')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Color</label><select data-k="tint" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${['amber', 'blue', 'violet', 'emerald'].map((t) => `<option ${t === (c.tint || 'amber') ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          </div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Note</label><textarea data-k="note" rows="2" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${esc(c.note || '')}</textarea></div>
        </div>
        <div class="mt-5 flex gap-2"><button id="cm-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save' : 'Award'}</button>${record && DB().canDelete() ? '<button id="cm-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}</div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#cm-save').onclick = async () => {
        const p = {}; $$('[data-k]', node).forEach((f) => p[f.dataset.k] = f.value.trim());
        if (!p.title) { toast('Title required.', 'warn'); return; }
        const res = record && record.id ? await DB().update('commendations', record.id, p) : await DB().insert('commendations', p);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Commendation updated' : 'Commendation awarded', 'success'); fetchCommendations();
      };
      const cd = node.querySelector('#cm-del'); if (cd) cd.onclick = async () => { closeModal(); await deleteWithUndo('commendations', record, { label: 'Commendation', after: fetchCommendations }); };
      openModal(node);
    }

    /* ---- Evidence/media vault (Supabase) ---- */
    const mediaSrc = (m) => m.external_url || m.storage_path || '';
    function mediaThumb(m) {
      const src = mediaSrc(m);
      if (m.type === 'image' && src) return `<img src="${esc(src)}" alt="${esc(m.title)}" class="ev-img h-40 w-full cursor-zoom-in object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="hidden h-40 w-full items-center justify-center bg-ink-800 text-4xl">🖼️</div>`;
      if (m.type === 'video') return `<div class="flex h-40 w-full items-center justify-center bg-ink-800 text-4xl">🎬</div>`;
      return `<div class="flex h-40 w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-ink-800 to-ink-700"><span class="text-3xl">📡</span><span class="font-mono text-[10px] text-slate-400">${esc(src || 'fivemanage')}</span></div>`;
    }
    function mediaTagChips(m) {
      const t = m.tags || {}; const out = [];
      const caseNo = caseNumById(m.case_id); if (caseNo) out.push(`<button class="media-case-link rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-mono text-blue-300 transition hover:bg-blue-500/20 hover:text-white" data-case="${esc(m.case_id)}" title="Open ${esc(caseNo)}">${esc(caseNo)}</button>`);
      const gn = gangNameById(m.gang_id); if (gn) out.push(`<span class="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300">🚩 ${esc(gn)}</span>`);
      if (t.location) out.push(`<span class="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">📍 ${esc(t.location)}</span>`);
      if (t.person) out.push(`<span class="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">👤 ${esc(t.person)}</span>`);
      mediaLabels(m).forEach((l) => out.push(`<span class="rounded bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] text-fuchsia-300">🏷️ ${esc(l)}</span>`));
      return out.join(' ');
    }
    // Free-text media labels (m.tags.labels) — tag mugshots, scenes, weapons, etc.
    const PRESET_MEDIA_TAGS = ['Mugshot', 'Scene', 'Weapon', 'Surveillance', 'Document', 'Vehicle', 'Evidence'];
    const mediaLabels = (m) => { const t = m && m.tags; return Array.isArray(t && t.labels) ? t.labels : []; };
    const parseTags = (str) => [...new Set(String(str || '').split(',').map((s) => s.trim()).filter(Boolean))];
    function mediaTagsFieldHTML(id, labels) {
      return `<div><label class="mb-1 block text-xs font-semibold text-slate-400">Tags</label>
        <input id="${id}" value="${esc((labels || []).join(', '))}" placeholder="Mugshot, Scene, Weapon…" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" />
        <div class="mt-1.5 flex flex-wrap gap-1">${PRESET_MEDIA_TAGS.map((t) => `<button type="button" class="mt-preset rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 transition hover:bg-white/10" data-for="${id}" data-tag="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div></div>`;
    }
    function wireMediaTagsField(node) {
      $$('.mt-preset', node).forEach((b) => b.onclick = () => { const inp = node.querySelector('#' + b.dataset.for); if (!inp) return; const set = parseTags(inp.value); if (!set.some((s) => s.toLowerCase() === b.dataset.tag.toLowerCase())) set.push(b.dataset.tag); inp.value = set.join(', '); });
    }
    function renderMediaFilters() {
      const bar = $('#media-filter'); if (!bar) return;
      const kinds = [['all', 'All'], ['case', 'By Case'], ['gang', 'By Gang']].concat(PRESET_MEDIA_TAGS.map((t) => ['tag:' + t, '🏷️ ' + t]));
      bar.innerHTML = kinds.map(([k, l]) => `<button class="mf-chip rounded-full border px-3 py-1 text-xs font-medium transition ${mediaFilter === k ? 'border-badge-500 bg-blue-500/10 text-white' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}" data-f="${k}">${l}</button>`).join('');
      bar.querySelectorAll('.mf-chip').forEach((b) => b.addEventListener('click', () => { mediaFilter = b.dataset.f; renderMediaFilters(); renderMedia(); }));
    }
    async function fetchMedia() { if (!dbReady()) { renderMedia(); return; } try { MEDIA = await DB().list('media', { order: 'created_at', ascending: false }); } catch (e) {} renderMedia(); }
    // Roster + commendations live under Command; the media vault is its own tab under Intelligence.
    function onEnterPersonnel() { renderRoster(); if (dbReady()) { fetchCommendations(); } else { renderCommendations(); } }
    function onEnterMedia() { renderMediaFilters(); if (dbReady()) { fetchMedia(); } else { renderMedia(); } }
    function mediaMatchesFilter(m) {
      if (mediaFilter === 'all') return true;
      if (mediaFilter === 'case') return !!m.case_id;
      if (mediaFilter === 'gang') return !!m.gang_id;
      if (mediaFilter && mediaFilter.indexOf('tag:') === 0) {
        const want = mediaFilter.slice(4).toLowerCase();
        if (mediaLabels(m).some((l) => l.toLowerCase() === want)) return true;
        if (want === 'mugshot' && m.tags && m.tags.person) return true;   // legacy mugshots
        return false;
      }
      return !!(m.tags && m.tags[mediaFilter]);
    }
    function renderMedia() {
      const g = $('#media-grid'); if (!g) return;
      const canEdit = DB() && DB().canEdit();
      const ab = $('#add-media'); if (ab) ab.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { g.innerHTML = '<p class="text-sm text-slate-500">Sign in to view the evidence vault.</p>'; return; }
      const items = MEDIA.filter(mediaMatchesFilter);
      if (!items.length) { g.innerHTML = `<p class="text-sm text-slate-500">${MEDIA.length ? 'No assets match this filter.' : 'No media yet.' + (canEdit ? ' Use “+ Ingest Media”.' : '')}</p>`; return; }
      g.innerHTML = '';
      items.forEach((m) => {
        const card = el('div', { class: 'overflow-hidden rounded-2xl border border-white/5 bg-ink-900/60' });
        card.innerHTML = `
          ${mediaThumb(m)}
          <div class="p-4"><div class="flex items-center justify-between"><p class="truncate text-sm font-semibold text-white">${esc(m.title)}</p><span class="ml-2 flex-shrink-0 rounded-md bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">${esc(m.kind || m.type)}</span></div>
          <div class="mt-2 flex flex-wrap gap-1">${mediaTagChips(m)}</div>
          ${canEdit ? '<div class="mt-3 flex items-center gap-2"><div class="relative flex-1">' + dropupBtn() + '</div><button class="med-tags rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-fuchsia-200 transition hover:bg-white/10" title="Edit tags">🏷️</button></div>' : ''}</div>`;
        const img = card.querySelector('.ev-img'); if (img) img.addEventListener('click', () => openLightbox(m));
        const cl = card.querySelector('.media-case-link'); if (cl) cl.addEventListener('click', (e) => { e.stopPropagation(); if (typeof navigate === 'function') navigate('cases'); if (typeof openCaseDetail === 'function') openCaseDetail(cl.dataset.case); });
        const dd = card.querySelector('.dropup'); if (dd) wireDropup(dd, m);
        const mt = card.querySelector('.med-tags'); if (mt) mt.addEventListener('click', (e) => { e.stopPropagation(); openMediaTagsEdit(m, fetchMedia); });
        g.appendChild(card);
      });
    }
    function openLightbox(m) {
      const node = el('div', { class: 'p-4' }); const src = mediaSrc(m);
      const isVid = m.type === 'video' || /\.(mp4|webm|mov|m4v)($|\?)/i.test(src || '');
      const isAud = m.type === 'audio' || /\.(mp3|wav|ogg|m4a)($|\?)/i.test(src || '');
      const body = !src ? `<div class="flex h-64 items-center justify-center rounded-lg bg-ink-800 text-5xl">📡</div>`
        : m.type === 'image' ? `<img src="${esc(src)}" alt="${esc(m.title)}" class="max-h-[70vh] w-full rounded-lg object-contain" />`
        : isVid ? `<video src="${esc(src)}" controls autoplay playsinline class="max-h-[70vh] w-full rounded-lg bg-black"></video>`
        : isAud ? `<div class="rounded-lg bg-ink-800 p-6"><audio src="${esc(src)}" controls autoplay class="w-full"></audio></div>`
        : `<iframe src="${esc(src)}" title="${esc(m.title)}" class="h-[70vh] w-full rounded-lg bg-black"></iframe>`;
      node.innerHTML = `<div class="mb-3 flex items-center justify-between"><p class="text-sm font-semibold text-white">${esc(m.title)}</p><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>${body}<div class="mt-3 flex items-center justify-between gap-2"><div class="flex flex-wrap gap-1">${mediaTagChips(m)}</div>${src ? `<a href="${esc(src)}" target="_blank" rel="noopener" class="flex-shrink-0 text-xs text-blue-300 underline">Open ↗</a>` : ''}</div>`;
      node.querySelector('.close-x').onclick = closeModal;
      openModal(node, { wide: true });
    }
    function dropupBtn() { return `<button class="dropup flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-semibold text-white transition hover:bg-white/10" aria-haspopup="true" aria-expanded="false">↗ Forward to Case</button>`; }
    function wireDropup(btn, m) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const existing = btn.parentElement.querySelector('.dropup-menu');
        document.querySelectorAll('.dropup-menu').forEach((x) => x.remove());
        if (existing) { btn.setAttribute('aria-expanded', 'false'); return; }
        const menu = el('div', { class: 'dropup-menu absolute bottom-full left-0 z-20 mb-2 max-h-48 w-full overflow-y-auto rounded-lg border border-white/10 bg-ink-800 shadow-glow' });
        menu.innerHTML = casesCache.length ? casesCache.map((c) => `<button class="case-pick block w-full px-3 py-2 text-left text-xs text-slate-200 transition hover:bg-blue-500/15 hover:text-white" data-id="${c.id}">${esc(c.case_number)}</button>`).join('') : '<p class="px-3 py-2 text-xs text-slate-500">No cases</p>';
        btn.parentElement.appendChild(menu); btn.setAttribute('aria-expanded', 'true');
        menu.querySelectorAll('.case-pick').forEach((p) => p.addEventListener('click', async () => {
          menu.remove(); btn.setAttribute('aria-expanded', 'false');
          const res = await DB().update('media', m.id, { case_id: p.dataset.id });
          if (res.error) { toast('Forward failed: ' + res.error.message, 'danger'); return; }
          toast(`"${m.title}" forwarded → ${caseNumById(p.dataset.id)}`, 'success'); fetchMedia();
        }));
      });
    }
    document.addEventListener('click', () => document.querySelectorAll('.dropup-menu').forEach((m) => { m.remove(); const b = m.parentElement && m.parentElement.querySelector('.dropup'); if (b) b.setAttribute('aria-expanded', 'false'); }));

    // Edit the labels on an existing media asset (vault + case media). Preserves
    // the other tag keys (location/person) and only rewrites `labels`.
    function openMediaTagsEdit(m, onSaved) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-4 flex items-center justify-between"><h3 class="text-lg font-bold text-white">Edit Tags</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <p class="mb-3 truncate text-xs text-slate-400">${esc(m.title || 'Untitled')}</p>
        ${mediaTagsFieldHTML('met-tags', mediaLabels(m))}
        <button id="met-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Save tags</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      wireMediaTagsField(node);
      node.querySelector('#met-save').onclick = async () => {
        const labels = parseTags(node.querySelector('#met-tags').value);
        const tags = Object.assign({}, m.tags || {}, { labels });
        const res = await DB().update('media', m.id, { tags });
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        m.tags = tags;
        closeModal(); toast('Tags updated', 'success');
        if (typeof onSaved === 'function') onSaved();
      };
      openModal(node);
    }
    function openMediaModal() {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const node = el('div', { class: 'p-6' });
      const caseOpts = ['<option value="">— none —</option>'].concat(casesCache.map((c) => `<option value="${c.id}">${esc(c.case_number)}</option>`)).join('');
      const gangOpts = ['<option value="">— none —</option>'].concat(GANGS.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Ingest Media Asset</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Title *</label><input id="md-title" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" placeholder="e.g. Dashcam — Vinewood pursuit" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Source Type</label><select id="md-type" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500"><option value="image">Direct Image URL</option><option value="video">MP4 Video Link</option><option value="fivemanage">FiveManage CDN Embed</option></select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">URL / Embed ID</label><input id="md-src" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 font-mono text-xs text-white outline-none focus:border-badge-500" placeholder="https://… or fm_xxxxx" /></div>
          <p class="pt-1 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">Evidence Tags</p>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Case</label><select id="md-case" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">${caseOpts}</select></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Gang</label><select id="md-gang" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500">${gangOpts}</select></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Location</label><input id="md-loc" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" placeholder="Area / place" /></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Person (mugshot)</label><input id="md-person" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2.5 text-sm text-white outline-none focus:border-badge-500" placeholder="Subject name" /></div>
          </div>
          ${mediaTagsFieldHTML('md-tags', [])}
        </div>
        <button id="md-go" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Add to Vault</button>`;
      if (typeof fmInjectUploader === 'function') fmInjectUploader(node);
      wireMediaTagsField(node);
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#md-go').onclick = async () => {
        const title = node.querySelector('#md-title').value.trim();
        if (!title) { toast('A title is required.', 'warn'); return; }
        const type = node.querySelector('#md-type').value;
        const kind = type === 'image' ? 'Image URL' : type === 'video' ? 'MP4 Video' : 'FiveManage Embed';
        const payload = { title, type, kind, external_url: node.querySelector('#md-src').value.trim() || null, case_id: node.querySelector('#md-case').value || null, gang_id: node.querySelector('#md-gang').value || null, tags: { location: node.querySelector('#md-loc').value.trim(), person: node.querySelector('#md-person').value.trim(), labels: parseTags(node.querySelector('#md-tags').value) } };
        const res = await DB().insert('media', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Media ingested into vault', 'success'); fetchMedia();
      };
      openModal(node);
    }

