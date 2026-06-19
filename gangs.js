/* gangs.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 11A2. GANGS & TURF (Supabase) ============================================================ */
    function gangsNotice(m) { $('#gang-grid').innerHTML = `<div class="xl:col-span-2 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${m}</div>`; }
    function showGangsList() { $('#gang-detail').classList.add('hidden'); $('#gangs-list').classList.remove('hidden'); }
    function onEnterGangs() { showGangsList(); if (dbReady()) fetchGangs(); else gangsNotice('Live gang records require sign-in.'); }
    async function fetchGangs() {
      if (!dbReady()) { gangsNotice('Live gang records require sign-in.'); return; }
      $('#gangs-live').classList.remove('hidden'); $('#gangs-live').classList.add('inline-flex');
      try { GANGS = await DB().list('gangs', { order: 'name', ascending: true }); renderGangs(); }
      catch (e) { gangsNotice('Could not load gangs: ' + escapeHTML(e.message || String(e))); }
    }
    function renderGangs() {
      const grid = $('#gang-grid'); if (!grid) return;
      const q = ($('#gang-search') ? $('#gang-search').value : '').trim().toLowerCase();
      const items = GANGS.filter((g) => !q || JSON.stringify(g).toLowerCase().includes(q));
      const addBtn = $('#add-gang'); if (addBtn) addBtn.classList.toggle('hidden', !(DB() && DB().canEdit()));
      if (!items.length) { gangsNotice(GANGS.length ? 'No gangs match your filter.' : 'No gangs on file.' + (DB() && DB().canEdit() ? ' Use “+ New Gang”.' : '')); return; }
      grid.innerHTML = '';
      items.forEach((g) => {
        const card = el('div', { class: 'cursor-pointer rounded-2xl border border-white/5 bg-ink-900/60 p-6 transition hover:border-blue-500/30 hover:bg-white/5' });
        card.innerHTML = `
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><h4 class="text-lg font-bold text-white">${escapeHTML(g.name)}</h4><p class="mt-0.5 text-xs text-slate-400">Colors: ${escapeHTML(g.colors || '—')}</p></div>
            <div class="flex flex-shrink-0 items-center gap-2">
              <span class="rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase ${threatTint(g.threat_level)}">${escapeHTML(cap(g.threat_level))} Threat</span>
              <button class="g-profile rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-blue-200 transition hover:bg-white/10" title="Unified intel profile">🔎</button>
            </div>
          </div>
          ${g.notes ? `<p class="mt-3 line-clamp-2 text-xs text-slate-400">${escapeHTML(g.notes)}</p>` : ''}
          <p class="mt-3 text-[11px] text-blue-300">View roster &amp; turf →</p>`;
        card.addEventListener('click', () => openGangDetail(g.id));
        const gp = card.querySelector('.g-profile'); if (gp && typeof openIntelProfile === 'function') gp.onclick = (e) => { e.stopPropagation(); openIntelProfile('gang', g.id); };
        grid.appendChild(card);
      });
    }
    function openGangModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const g = record || {};
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Gang</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(g.name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Colors</label><input data-k="colors" value="${escapeHTML(g.colors || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Threat Level</label><select data-k="threat_level" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${['low', 'medium', 'high'].map((t) => `<option value="${t}" ${t === (g.threat_level || 'medium') ? 'selected' : ''}>${cap(t)}</option>`).join('')}</select></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea data-k="notes" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML(g.notes || '')}</textarea></div>
        </div>
        <button id="g-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create gang'}</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#g-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.name) { toast('Gang name is required.', 'warn'); return; }
        const res = record && record.id ? await DB().update('gangs', record.id, payload) : await DB().insert('gangs', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Gang updated' : 'Gang created', 'success'); fetchGangs();
        if (record && record.id) openGangDetail(record.id);
      };
      openModal(node, { wide: true });
    }
    let detailGang = null;
    async function openGangDetail(id) {
      if (!dbReady()) { toast('Sign-in required.', 'warn'); return; }
      try {
        const rows = await DB().list('gangs', { eq: { id: id } });
        detailGang = rows[0]; if (!detailGang) { toast('Gang not found.', 'warn'); return; }
        $('#gangs-list').classList.add('hidden'); $('#gang-detail').classList.remove('hidden');
        await renderGangDetail();
      } catch (e) { toast('Load failed: ' + (e.message || e), 'danger'); }
    }
    async function renderGangDetail() {
      const g = detailGang, canEdit = DB() && DB().canEdit(), canDel = DB() && DB().canDelete();
      let members = [], turf = [], places = [];
      try {
        [members, turf, places] = await Promise.all([
          DB().list('gang_members', { eq: { gang_id: g.id } }),
          DB().list('gang_turf', { eq: { gang_id: g.id } }),
          DB().list('places', { eq: { controlling_gang_id: g.id } })
        ]);
      } catch (e) {}
      const ranks = {}; members.forEach((m) => { const r = m.rank || 'Unranked'; (ranks[r] = ranks[r] || []).push(m); });
      $('#gang-detail').innerHTML = `
        <button id="gang-back" class="mb-4 inline-flex items-center gap-1 text-sm text-slate-300 transition hover:text-white">← All gangs</button>
        <div class="mb-6 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div><h3 class="text-xl font-bold text-white">${escapeHTML(g.name)}</h3><p class="mt-1 text-sm text-slate-400">Colors: ${escapeHTML(g.colors || '—')}</p>${g.notes ? `<p class="mt-1 text-sm text-slate-400">${escapeHTML(g.notes)}</p>` : ''}</div>
            <div class="flex items-center gap-2">
              <span class="rounded-md border px-2.5 py-1 text-[10px] font-semibold uppercase ${threatTint(g.threat_level)}">${escapeHTML(cap(g.threat_level))} Threat</span>
              <button id="gang-profile" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-blue-200 transition hover:bg-white/10">🔎 Intel profile</button>
              ${canEdit ? '<button id="gang-tocase" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-blue-200 transition hover:bg-white/10">📎 Attach to case</button>' : ''}
              ${canEdit ? '<button id="gang-edit" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}
              ${canDel ? '<button id="gang-del" class="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
            </div>
          </div>
        </div>
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div class="lg:col-span-2 rounded-2xl border border-white/5 bg-ink-900/60 p-6">
            <div class="mb-3 flex items-center justify-between"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Roster (${members.length})</h4>${canEdit ? '<button id="member-new" class="rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow-glow transition hover:brightness-110">+ Member</button>' : ''}</div>
            ${members.length ? Object.keys(ranks).map((rk) => `<div class="mb-4"><p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">${escapeHTML(rk)} (${ranks[rk].length})</p><div class="grid grid-cols-1 gap-2 sm:grid-cols-2">${ranks[rk].map(memberCard).join('')}</div></div>`).join('') : '<p class="text-sm text-slate-500">No members yet.</p>'}
          </div>
          <div class="space-y-6">
            <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
              <div class="mb-3 flex items-center justify-between"><h4 class="text-sm font-semibold uppercase tracking-wider text-slate-400">Turf (${turf.length})</h4>${canEdit ? '<button id="turf-new" class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">+ Turf</button>' : ''}</div>
              <div class="space-y-2">${turf.length ? turf.map((t) => `<div class="flex items-center justify-between rounded-lg bg-ink-850 px-3 py-1.5 text-xs"><span class="text-slate-200">${escapeHTML(t.block)}${t.hotspot_area ? ' · ' + escapeHTML(t.hotspot_area) : ''}</span><span class="flex items-center gap-2"><span class="rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${densTint(cap(t.density))}">${escapeHTML(cap(t.density))}</span>${canDel ? `<button class="turf-del text-rose-300" data-id="${t.id}">✕</button>` : ''}</span></div>`).join('') : '<p class="text-xs text-slate-500">No turf logged.</p>'}</div>
            </div>
            <div class="rounded-2xl border border-white/5 bg-ink-900/60 p-6">
              <h4 class="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Linked Properties (${places.length})</h4>
              <div class="space-y-2">${places.length ? places.map((p) => `<div class="rounded-lg bg-ink-850 px-3 py-1.5 text-xs text-slate-200">${escapeHTML(p.name)} <span class="text-slate-500">· ${escapeHTML(p.type)}</span></div>`).join('') : '<p class="text-xs text-slate-500">No linked places. (Set a controlling gang on a Place.)</p>'}</div>
            </div>
          </div>
        </div>`;
      $('#gang-back').onclick = showGangsList;
      const gpf = $('#gang-profile'); if (gpf && typeof openIntelProfile === 'function') gpf.onclick = () => openIntelProfile('gang', g.id);
      const gtc = $('#gang-tocase'); if (gtc && typeof attachIntelToCase === 'function') gtc.onclick = () => attachIntelToCase(`Gang — ${detailGang.name}${detailGang.colors ? ' (' + detailGang.colors + ')' : ''} · ${cap(detailGang.threat_level)} threat`);
      const ge = $('#gang-edit'); if (ge) ge.onclick = () => openGangModal(detailGang);
      const gd = $('#gang-del'); if (gd) gd.onclick = async () => {
        if (!confirm('Delete gang “' + g.name + '”? This removes its members & turf.')) return;
        const r = await DB().remove('gangs', g.id); if (r.error) { toast('Delete failed: ' + r.error.message, 'danger'); return; }
        toast('Gang deleted', 'warn'); showGangsList(); fetchGangs();
      };
      const mn = $('#member-new'); if (mn) mn.onclick = () => openMemberModal(g.id, null);
      const tn = $('#turf-new'); if (tn) tn.onclick = () => openTurfModal(g.id);
      $$('.m-edit', $('#gang-detail')).forEach((b) => b.onclick = () => { const m = members.find((x) => x.id === b.dataset.id); openMemberModal(g.id, m); });
      $$('.turf-del', $('#gang-detail')).forEach((b) => b.onclick = async () => { await DB().remove('gang_turf', b.dataset.id); renderGangDetail(); });
    }
    function memberCard(m) {
      const flag = (m.felony_count || 0) >= 8, canEdit = DB() && DB().canEdit();
      return `<div class="flex items-center gap-3 rounded-lg border border-white/5 bg-ink-850 p-2.5">
        ${m.mugshot_url ? `<img src="${escapeHTML(m.mugshot_url)}" class="h-10 w-10 flex-shrink-0 rounded-md object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="hidden h-10 w-10 flex-shrink-0 place-items-center rounded-md bg-ink-700 text-sm">👤</div>` : `<div class="grid h-10 w-10 flex-shrink-0 place-items-center rounded-md bg-ink-700 text-sm">👤</div>`}
        <div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold text-white">${escapeHTML(m.name)}${flag ? ' 🚨' : ''}</p><p class="text-[11px] text-slate-400">${escapeHTML(m.status || '')} · CCW ${m.ccw ? 'Yes' : 'No'} · VCH ${m.vch || 0}</p></div>
        ${canEdit ? `<button class="m-edit flex-shrink-0 rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/10" data-id="${m.id}">Edit</button>` : ''}
      </div>`;
    }
    function openMemberModal(gangId, member) {
      const m = member || {};
      const node = el('div', { class: 'p-6' });
      const personOpts = ['<option value="">— link person (optional) —</option>'].concat(PERSONS.map((p) => `<option value="${p.id}" ${p.id === m.person_id ? 'selected' : ''}>${escapeHTML(p.name)}</option>`)).join('');
      const caseOpts = ['<option value="">— link case (optional) —</option>'].concat(casesCache.map((c) => `<option value="${c.id}" ${c.id === m.case_id ? 'selected' : ''}>${escapeHTML(c.case_number)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${member ? 'Edit' : 'Add'} Member</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(m.name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Rank</label><input data-k="rank" list="rank-list" value="${escapeHTML(m.rank || 'Soldier')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /><datalist id="rank-list">${RANK_SUGGEST.map((r) => `<option value="${r}">`).join('')}</datalist></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Callsign</label><input data-k="callsign" value="${escapeHTML(m.callsign || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Status</label><input data-k="status" value="${escapeHTML(m.status || 'At Large')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Link Person</label><select data-k="person_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${personOpts}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Link Case</label><select data-k="case_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${caseOpts}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">CCW</label><select data-k="ccw" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="false" ${!m.ccw ? 'selected' : ''}>No</option><option value="true" ${m.ccw ? 'selected' : ''}>Yes</option></select></div>
          <div class="grid grid-cols-2 gap-3"><div><label class="mb-1 block text-xs font-semibold text-slate-400">VCH</label><input type="number" data-k="vch" value="${m.vch || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div><div><label class="mb-1 block text-xs font-semibold text-slate-400">Felonies</label><input type="number" data-k="felony_count" value="${m.felony_count || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Mugshot URL</label><input data-k="mugshot_url" value="${escapeHTML(m.mugshot_url || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
        </div>
        <div class="mt-5 flex gap-2">
          <button id="m-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${member ? 'Save' : 'Add member'}</button>
          ${member && DB().canDelete() ? '<button id="m-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#m-save').onclick = async () => {
        const payload = { gang_id: gangId }; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.name) { toast('Name is required.', 'warn'); return; }
        payload.ccw = payload.ccw === 'true'; payload.vch = Number(payload.vch) || 0; payload.felony_count = Number(payload.felony_count) || 0;
        if (!payload.person_id) payload.person_id = null; if (!payload.case_id) payload.case_id = null;
        const res = member && member.id ? await DB().update('gang_members', member.id, payload) : await DB().insert('gang_members', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Member saved', 'success'); renderGangDetail();
      };
      const md = node.querySelector('#m-del'); if (md) md.onclick = async () => { await DB().remove('gang_members', member.id); closeModal(); toast('Member removed', 'warn'); renderGangDetail(); };
      openModal(node, { wide: true });
    }
    function openTurfModal(gangId) {
      const node = el('div', { class: 'p-6' });
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">Add Turf Block</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Block / Territory *</label><input data-k="block" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Density</label><select data-k="density" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Hotspot Area</label><input data-k="hotspot_area" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
        </div>
        <button id="t-save" class="mt-5 w-full rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">Add Turf</button>`;
      node.querySelector('.close-x').onclick = closeModal;
      node.querySelector('#t-save').onclick = async () => {
        const payload = { gang_id: gangId }; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.block) { toast('Block is required.', 'warn'); return; }
        const res = await DB().insert('gang_turf', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast('Turf added', 'success'); renderGangDetail();
      };
      openModal(node, { wide: false });
    }

