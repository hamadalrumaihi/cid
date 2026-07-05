/* places.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 11B. CRIMINAL PLACES + PRODUCTION ============================================================ */
    /* ============================================================ 11B. CRIMINAL PLACES (Supabase) ============================================================ */
    const LOC_TYPES = [['drug_lab','Drug Lab'],['stash_house','Stash House'],['dead_drop','Dead Drop'],['front_business','Front Business'],['chop_shop','Chop Shop']];
    const locLabel = (v) => { const t = LOC_TYPES.find((x) => x[0] === v); return t ? t[1] : v; };
    const drugById = (id) => DRUGS.find((x) => x.id === id);
    const caseNumById = (id) => { const c = casesCache.find((x) => x.id === id); return c ? c.case_number : null; };
    function recipeFor(drug) {
      if (!drug) return [];
      return [ `Acquire precursors: ${(drug.precursors || []).map((p) => p.n).join(', ') || 'TBD'}`, `Synthesize / cook ${drug.name} base`, `Cut to street purity grade`, `Package into distribution units`, `Distribute to hotspot: ${drug.hotspots && drug.hotspots[0] ? drug.hotspots[0].area : 'TBD'}` ];
    }
    function placesNotice(m) { $('#place-grid').innerHTML = `<div class="lg:col-span-2 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${m}</div>`; }
    function onEnterPlaces() { if (dbReady()) fetchPlaces(); else placesNotice('Live location records require sign-in.'); }
    async function fetchPlaces() {
      if (!dbReady()) { placesNotice('Live location records require sign-in.'); return; }
      try { PLACES = await DB().list('places', { order: 'updated_at', ascending: false }); renderPlaces(); }
      catch (e) { placesNotice('Could not load locations: ' + escapeHTML(e.message || String(e))); }
    }
    // Bulk multi-select delete (command-gated). Routes through deleteWithUndo
    // with the cascade child (process steps) so an Undo restores them too.
    let placeSel = new Set();
    function updatePlaceBulkBar() {
      const grid = $('#place-grid'); if (!grid) return;
      let bar = document.getElementById('place-bulkbar');
      if (!placeSel.size) { if (bar) bar.remove(); return; }
      if (!bar) { bar = el('div', { id: 'place-bulkbar', class: 'lg:col-span-2 sticky top-2 z-10 mb-1 flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 backdrop-blur' }); grid.insertBefore(bar, grid.firstChild); }
      bar.innerHTML = `<span class="text-sm font-semibold text-rose-200">${placeSel.size} selected</span><span class="flex gap-2"><button id="plsel-del" class="rounded-md bg-rose-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-rose-500">Delete selected</button><button id="plsel-clear" class="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Clear</button></span>`;
      bar.querySelector('#plsel-del').onclick = deleteSelectedPlaces;
      bar.querySelector('#plsel-clear').onclick = () => { placeSel.clear(); renderPlaces(); };
    }
    async function deleteSelectedPlaces() {
      const ids = [...placeSel]; if (!ids.length) return;
      if (!(await uiConfirm('Delete ' + ids.length + ' selected location' + (ids.length > 1 ? 's' : '') + '? Restorable via Undo.', { confirmText: 'Delete ' + ids.length }))) return;
      const rows = PLACES.filter((p) => placeSel.has(p.id));
      placeSel.clear();
      await deleteWithUndo('places', rows, { label: ids.length + ' location' + (ids.length > 1 ? 's' : ''), after: fetchPlaces, children: [{ table: 'place_process_steps', column: 'place_id' }] });
    }
    function renderPlaces() {
      const grid = $('#place-grid'); if (!grid) return;
      { const have = new Set(PLACES.map((p) => p.id)); [...placeSel].forEach((id) => { if (!have.has(id)) placeSel.delete(id); }); }
      const canEdit = DB() && DB().canEdit(), canDel = DB() && DB().canDelete();
      const addBtn = $('#add-place'); if (addBtn) addBtn.classList.toggle('hidden', !canEdit);
      if (!dbReady()) { placesNotice('Live location records require sign-in.'); return; }
      if (!PLACES.length) { placesNotice('No locations logged.' + (canEdit ? ' Use “+ New Location”.' : '')); return; }
      grid.innerHTML = '';
      PLACES.forEach((p) => {
        const gang = GANGS.find((g) => g.id === p.controlling_gang_id);
        const drug = p.narcotic_id ? drugById(p.narcotic_id) : null;
        const caseNo = caseNumById(p.case_id);
        const recipe = p.type === 'drug_lab' && drug ? recipeFor(drug) : [];
        const card = el('div', { class: 'rounded-2xl border border-white/5 bg-ink-900/60 p-6' });
        card.innerHTML = `
          <div class="flex items-start justify-between gap-3">
            <div><h4 class="text-base font-semibold text-white">${escapeHTML(p.name)}</h4><p class="mt-0.5 text-xs text-slate-400">${escapeHTML(locLabel(p.type))} · ${escapeHTML(p.area || '—')}</p></div>
            <div class="flex items-center gap-2">${canEdit ? '<button class="pl-tocase rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-blue-200 transition hover:bg-white/10" title="Attach to case">📎</button>' : ''}${canEdit ? '<button class="pl-edit rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}${canDel ? '<button class="pl-del rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10">✕</button>' : ''}${canDel ? `<label class="flex items-center pl-0.5" title="Select for bulk delete"><input type="checkbox" class="pl-check h-4 w-4 accent-rose-500" data-id="${p.id}"${placeSel.has(p.id) ? ' checked' : ''}></label>` : ''}</div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2 text-[11px]">
            ${gang ? `<span class="rounded-md bg-violet-500/10 px-2 py-1 text-violet-300">🚩 ${escapeHTML(gang.name)}</span>` : ''}
            ${caseNo ? `<span class="rounded-md bg-blue-500/10 px-2 py-1 font-mono text-blue-300">${escapeHTML(caseNo)}</span>` : ''}
            ${drug ? `<span class="rounded-md bg-emerald-500/10 px-2 py-1 text-emerald-300">💊 ${escapeHTML(drug.name)}</span>` : ''}
          </div>
          ${p.notes ? `<p class="mt-3 text-xs text-slate-400">${escapeHTML(p.notes)}</p>` : ''}
          ${recipe.length ? `<div class="mt-4"><p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-blue-300/70">Production Process</p><div class="space-y-1.5">${recipe.map((s, i) => `<div class="flex items-center gap-2 text-xs text-slate-300"><span class="grid h-5 w-5 flex-shrink-0 place-items-center rounded-full bg-blue-500/15 font-mono text-[10px] text-blue-300">${i + 1}</span>${escapeHTML(s)}</div>`).join('')}</div></div>` : ''}`;
        const ptc = card.querySelector('.pl-tocase'); if (ptc && typeof attachIntelToCase === 'function') ptc.addEventListener('click', () => attachIntelToCase(`Place — ${p.name} (${locLabel(p.type)})${p.area ? ' · ' + p.area : ''}`));
        const eb = card.querySelector('.pl-edit'); if (eb) eb.addEventListener('click', () => openPlaceModal(p));
        const db = card.querySelector('.pl-del'); if (db) db.addEventListener('click', async () => { if (!(await uiConfirm(`Delete location "${p.name}"?`, { confirmText: 'Delete' }))) return; await deleteWithUndo('places', p, { label: 'Location “' + p.name + '”', after: fetchPlaces, children: [{ table: 'place_process_steps', column: 'place_id' }] }); });
        const plchk = card.querySelector('.pl-check'); if (plchk) plchk.onchange = () => { if (plchk.checked) placeSel.add(p.id); else placeSel.delete(p.id); updatePlaceBulkBar(); };
        grid.appendChild(card);
      });
      updatePlaceBulkBar();
    }
    function openPlaceModal(record) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const p = record || {};
      const node = el('div', { class: 'p-6' });
      // Preserve each FK even when its cache hasn't loaded / failed / is cross-bureau,
      // so an unrelated edit doesn't silently null the gang / case / narcotic link.
      const keep = (id, label) => id ? [`<option value="${escapeHTML(id)}" selected>${label}</option>`] : [];
      const gangOpts = ['<option value="">— none —</option>']
        .concat(p.controlling_gang_id && !GANGS.some((g) => g.id === p.controlling_gang_id) ? keep(p.controlling_gang_id, '(current gang — loading…)') : [])
        .concat(GANGS.map((g) => `<option value="${g.id}" ${g.id === p.controlling_gang_id ? 'selected' : ''}>${escapeHTML(g.name)}</option>`)).join('');
      const caseOpts = ['<option value="">— none —</option>']
        .concat(p.case_id && !casesCache.some((c) => c.id === p.case_id) ? keep(p.case_id, '(linked case — other bureau)') : [])
        .concat(casesCache.map((c) => `<option value="${c.id}" ${c.id === p.case_id ? 'selected' : ''}>${escapeHTML(c.case_number)}</option>`)).join('');
      const drugOpts = ['<option value="">— none —</option>']
        .concat(p.narcotic_id && !DRUGS.some((d) => d.id === p.narcotic_id) ? keep(p.narcotic_id, '(current narcotic — loading…)') : [])
        .concat(DRUGS.map((d) => `<option value="${d.id}" ${d.id === p.narcotic_id ? 'selected' : ''}>${escapeHTML(d.name)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Location</h3><button aria-label="Close" class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="space-y-3">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" value="${escapeHTML(p.name || '')}" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Type</label><select data-k="type" id="pl-type" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${LOC_TYPES.map((t) => `<option value="${t[0]}" ${t[0] === (p.type || 'drug_lab') ? 'selected' : ''}>${t[1]}</option>`).join('')}</select></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Area</label><input data-k="area" list="area-list" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" value="${escapeHTML(p.area || '')}" /></div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Controlling Gang</label><select data-k="controlling_gang_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${gangOpts}</select></div>
            <div><label class="mb-1 block text-xs font-semibold text-slate-400">Linked Case</label><select data-k="case_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${caseOpts}</select></div>
          </div>
          <div id="pl-drug-wrap"><label class="mb-1 block text-xs font-semibold text-slate-400">Produced Narcotic (labs only)</label><select data-k="narcotic_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${drugOpts}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea data-k="notes" rows="2" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML(p.notes || '')}</textarea></div>
        </div>
        <div class="mt-5 flex gap-2">
          <button id="pl-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create location'}</button>
          ${record && DB().canDelete() ? '<button id="pl-del2" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      const typeSel = node.querySelector('#pl-type'), drugWrap = node.querySelector('#pl-drug-wrap');
      const syncDrug = () => drugWrap.style.display = typeSel.value === 'drug_lab' ? '' : 'none';
      syncDrug(); typeSel.onchange = syncDrug;
      node.querySelector('#pl-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.name) { toast('Location name is required.', 'warn'); return; }
        if (!payload.controlling_gang_id) payload.controlling_gang_id = null;
        if (!payload.case_id) payload.case_id = null;
        if (payload.type !== 'drug_lab' || !payload.narcotic_id) payload.narcotic_id = null;
        const res = record && record.id ? await DB().update('places', record.id, payload) : await DB().insert('places', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Location updated' : 'Location created', 'success'); fetchPlaces();
      };
      const pd = node.querySelector('#pl-del2'); if (pd) pd.onclick = async () => { if (!(await uiConfirm('Delete “' + p.name + '”? Restorable via Undo.', { confirmText: 'Delete' }))) return; closeModal(); await deleteWithUndo('places', record, { label: 'Location “' + p.name + '”', after: fetchPlaces, children: [{ table: 'place_process_steps', column: 'place_id' }] }); };
      openModal(node);
    }

