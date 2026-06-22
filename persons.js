/* persons.js — part of the CID Portal SPA. Classic script sharing one global
   lexical scope with the other app *.js files (load order in index.html).
   Split from the original monolith; see AGENTS.md. */
"use strict";

    /* ============================================================ 11. V3 — SHARED STATE ============================================================ */
    const uid = (p) => p + Math.random().toString(36).slice(2, 8);
    const todayISO = () => new Date().toISOString().slice(0, 10);
    const bureauOf = (caseId) => { const m = (caseId || '').match(/^([A-Z]+)-/) || (caseId || '').match(/\[(\w+)\]/); const b = m && Object.values(BUREAUS).find((x) => x.prefix === m[1] || x.name === m[1]); return b ? b.name : (m ? m[1] : '—'); };

    const RANKS = ['Leadership', 'Enforcer', 'Soldier', 'Associate', 'CI'];
    const PROP_TYPES = ['Stash House', 'Front Business', 'Vehicle', 'Safehouse', 'Warehouse'];
    const PLACE_TYPES = ['Drug Lab', 'Stash House', 'Dead Drop', 'Front Business', 'Chop Shop'];
    const RICO_PREDICATES = ['Drug Trafficking', 'Extortion', 'Money Laundering', 'Witness Tampering', 'Murder-for-Hire', 'Illegal Firearms Trafficking', 'Bribery', 'Obstruction of Justice', 'Kidnapping', 'Loan Sharking', 'Robbery'];

    // Gangs are now Supabase-backed; GANGS is a read cache used by gang/place/media/rico pickers.
    let GANGS = [];
    let PERSONS = [];   // Supabase-sourced cache of persons for link pickers

    let PLACES = [];   // Supabase-backed cache (see Places module)

    // Reports are now Supabase-backed (table `reports`); fetched per-case on demand.

    // RICO is now Supabase-backed (rico_cases + predicate_acts); fetched per-case on demand.

    // Official CID report templates — the single source of truth is FORM_SCHEMAS
    // (core.js). The three fillable CID forms ARE the canonical report templates:
    // CID Investigative Report (default initial), Raid Seizure Allocation, and
    // UC Operation Activity Report. Each carries its FORM_SCHEMAS `schema` so the
    // report authoring/preview/export reuse the shared form renderer (drive.js).
    const REPORT_TEMPLATES = (typeof FORM_SCHEMAS !== 'undefined' ? [
      { id:'cid_investigative_report', icon:'📄', default:true },
      { id:'raid_seizure',             icon:'💰' },
      { id:'uc_operation',             icon:'🕶️' },
      { id:'arrest_warrant',           icon:'⚖️' },
      { id:'search_warrant',           icon:'🔍' },
      { id:'wiretap_warrant',          icon:'📡' },
      { id:'subpoena',                 icon:'📜' },
      { id:'surveillance_report',      icon:'🛰️' },
    ].filter((t) => FORM_SCHEMAS[t.id]).map((t) => ({
      id: t.id, icon: t.icon, default: !!t.default,
      name: FORM_SCHEMAS[t.id].title, schema: FORM_SCHEMAS[t.id],
    })) : []);
    const DEFAULT_REPORT_TEMPLATE = (REPORT_TEMPLATES.find((t) => t.default) || REPORT_TEMPLATES[0] || {}).id;
    const tplById = (id) => REPORT_TEMPLATES.find((t) => t.id === id);
    function autoVal(key, caseId) {
      const c = casesCache.find((x) => x.id === caseId);
      if (key === 'caseId') return c ? c.case_number : caseId;
      if (key === 'bureau') return c ? c.bureau : '—';
      if (key === 'detective' || key === 'affiant') { const me = DB() && DB().me; return me ? (me.display_name + (me.badge_number ? ' · ' + me.badge_number : '')) : 'CID Detective'; }
      if (key === 'datetime') return todayISO();
      return '';
    }

    /* ============================================================ 11A. PERSONS (Supabase) ============================================================ */
    const RANK_SUGGEST = ['Leadership', 'Lieutenant', 'Enforcer', 'Soldier', 'Associate', 'CI'];
    const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    const threatTint = (t) => t === 'high' ? 'text-rose-300 bg-rose-500/10 border-rose-500/20' : t === 'medium' ? 'text-amber-300 bg-amber-500/10 border-amber-500/20' : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20';
    const gangNameById = (id) => { const g = GANGS.find((x) => x.id === id); return g ? g.name : null; };

    function personsNotice(m) { $('#persons-grid').innerHTML = `<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center text-sm text-slate-400">${m}</div>`; }
    function onEnterPersons() { if (dbReady()) fetchPersons(); else personsNotice('Live person records require sign-in.'); }
    async function fetchPersons() {
      if (!dbReady()) { personsNotice('Live person records require sign-in.'); return; }
      $('#persons-live').classList.remove('hidden'); $('#persons-live').classList.add('inline-flex');
      try { PERSONS = await DB().list('persons', { order: 'updated_at', ascending: false }); renderPersons(); }
      catch (e) { personsNotice('Could not load persons: ' + escapeHTML(e.message || String(e))); }
    }
    // Bulk multi-select delete (command-gated).
    let personSel = new Set();
    function updatePersonBulkBar() {
      const grid = $('#persons-grid'); if (!grid) return;
      let bar = document.getElementById('person-bulkbar');
      if (!personSel.size) { if (bar) bar.remove(); return; }
      if (!bar) { bar = el('div', { id: 'person-bulkbar', class: 'sm:col-span-2 xl:col-span-3 sticky top-2 z-10 mb-1 flex items-center justify-between rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2 backdrop-blur' }); grid.insertBefore(bar, grid.firstChild); }
      bar.innerHTML = `<span class="text-sm font-semibold text-rose-200">${personSel.size} selected</span><span class="flex gap-2"><button id="psel-del" class="rounded-md bg-rose-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-rose-500">Delete selected</button><button id="psel-clear" class="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Clear</button></span>`;
      bar.querySelector('#psel-del').onclick = deleteSelectedPersons;
      bar.querySelector('#psel-clear').onclick = () => { personSel.clear(); renderPersons(); };
    }
    async function deleteSelectedPersons() {
      const ids = [...personSel]; if (!ids.length) return;
      if (!(await uiConfirm('Delete ' + ids.length + ' selected person' + (ids.length > 1 ? 's' : '') + '? This removes the registry records (not any linked officer accounts).', { confirmText: 'Delete ' + ids.length }))) return;
      const rows = PERSONS.filter((p) => personSel.has(p.id));
      personSel.clear();
      await deleteWithUndo('persons', rows, { label: ids.length + ' person' + (ids.length > 1 ? 's' : ''), after: fetchPersons });
    }
    function renderPersons() {
      const grid = $('#persons-grid'); if (!grid) return;
      { const have = new Set(PERSONS.map((p) => p.id)); [...personSel].forEach((id) => { if (!have.has(id)) personSel.delete(id); }); }
      const raw = ($('#person-search') ? $('#person-search').value : '').trim();
      const q = raw.toLowerCase();
      const items = PERSONS.filter((p) => !q || JSON.stringify(p).toLowerCase().includes(q));
      $('#person-new').classList.toggle('hidden', !(DB() && DB().canEdit()));
      if (!items.length) {
        // QoL: inline create — if a name was typed and isn't on file, offer to add it.
        if (raw && DB() && DB().canEdit()) {
          $('#persons-grid').innerHTML = `<div class="sm:col-span-2 xl:col-span-3 rounded-2xl border border-white/5 bg-ink-900/60 p-8 text-center"><p class="text-sm text-slate-400">No persons match “${escapeHTML(raw)}”.</p><button id="person-quickadd" class="mt-3 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 px-4 py-2 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">➕ Add “${escapeHTML(raw)}” to registry</button></div>`;
          const qa = $('#person-quickadd'); if (qa) qa.onclick = () => openPersonModal(null, { name: raw });
          return;
        }
        personsNotice(PERSONS.length ? 'No persons match your filter.' : 'No persons on file.' + (DB() && DB().canEdit() ? ' Use “+ New Person”.' : '')); return;
      }
      grid.innerHTML = '';
      items.forEach((p) => {
        const flag = (p.felony_count || 0) >= 8;
        const card = el('div', { class: 'rounded-2xl border border-white/5 bg-ink-900/60 p-5' });
        card.innerHTML = `
          <div class="flex items-start gap-3">
            ${p.mugshot_url ? `<img src="${escapeHTML(p.mugshot_url)}" class="h-14 w-14 flex-shrink-0 rounded-lg object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="hidden h-14 w-14 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-xl">👤</div>` : `<div class="grid h-14 w-14 flex-shrink-0 place-items-center rounded-lg bg-ink-700 text-xl">👤</div>`}
            <div class="min-w-0 flex-1"><p class="truncate font-semibold text-white">${escapeHTML(p.name)}${flag ? ' <span title="≥8 violent felonies">🚨</span>' : ''}</p><p class="text-xs text-slate-400">${p.alias ? '“' + escapeHTML(p.alias) + '” · ' : ''}${escapeHTML(p.status || '')}</p>
              <p class="mt-1 text-[11px] text-slate-500">${p.gang_id ? '🚩 ' + escapeHTML(gangNameById(p.gang_id) || 'Gang') + ' · ' : ''}CCW ${p.ccw ? 'Yes' : 'No'} · VCH ${p.vch || 0} · Felonies ${p.felony_count || 0}${(Array.isArray(p.properties) && p.properties.length) ? ' · 🏠 ' + p.properties.length : ''}</p></div>
            <button class="p-profile rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-blue-200 transition hover:bg-white/10" title="Unified intel profile">🔎 Profile</button>
            ${DB() && DB().canEdit() ? '<button class="p-edit rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10">Edit</button>' : ''}
            ${DB() && DB().canDelete() ? `<label class="flex flex-shrink-0 items-center pl-1" title="Select for bulk delete"><input type="checkbox" class="p-check h-4 w-4 accent-rose-500" data-id="${p.id}"${personSel.has(p.id) ? ' checked' : ''}></label>` : ''}
            ${DB() && DB().canDelete() ? '<button class="p-del rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-rose-300 transition hover:bg-rose-500/10" title="Delete person (command only)">Delete</button>' : ''}
          </div>
          ${DB() && DB().canEdit() ? '<button class="p-tocase mt-3 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-blue-200 transition hover:bg-white/10">📎 Attach to case</button>' : ''}
          ${p.notes ? `<p class="mt-3 line-clamp-2 text-xs text-slate-400">${escapeHTML(p.notes)}</p>` : ''}`;
        const eb = card.querySelector('.p-edit'); if (eb) eb.onclick = () => openPersonModal(p);
        const pf = card.querySelector('.p-profile'); if (pf && typeof openIntelProfile === 'function') pf.onclick = () => openIntelProfile('person', p.id);
        const tc = card.querySelector('.p-tocase'); if (tc && typeof attachIntelToCase === 'function') tc.onclick = () => attachIntelToCase(`Person — ${p.name}${p.alias ? ' “' + p.alias + '”' : ''} · ${p.status || 'POI'}${p.felony_count ? ', ' + p.felony_count + ' felonies' : ''}`);
        const pdb = card.querySelector('.p-del'); if (pdb) pdb.onclick = async () => {
          if (!(await uiConfirm('Delete person "' + (p.name || 'record') + '"? This removes the persons-registry record (not any linked officer account).', { confirmText: 'Delete' }))) return;
          await deleteWithUndo('persons', p, { label: 'Person “' + (p.name || 'record') + '”', after: fetchPersons });
        };
        const chk = card.querySelector('.p-check'); if (chk) chk.onchange = () => { if (chk.checked) personSel.add(p.id); else personSel.delete(p.id); updatePersonBulkBar(); };
        grid.appendChild(card);
      });
      updatePersonBulkBar();
    }
    function openPersonModal(record, prefill) {
      if (!(DB() && DB().canEdit())) { toast('Sign-in required.', 'warn'); return; }
      const p = record || prefill || {};
      const node = el('div', { class: 'p-6' });
      const gangOpts = ['<option value="">— no gang —</option>'].concat(GANGS.map((g) => `<option value="${g.id}" ${g.id === p.gang_id ? 'selected' : ''}>${escapeHTML(g.name)}</option>`)).join('');
      node.innerHTML = `
        <div class="mb-5 flex items-center justify-between"><h3 class="text-xl font-bold text-white">${record ? 'Edit' : 'New'} Person</h3><button class="close-x text-slate-400 hover:text-white text-2xl leading-none">&times;</button></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Name *</label><input data-k="name" value="${escapeHTML(p.name || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Alias</label><input data-k="alias" value="${escapeHTML(p.alias || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Gang</label><select data-k="gang_id" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${gangOpts}</select></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">Status</label><input data-k="status" value="${escapeHTML(p.status || 'Person of Interest')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div><label class="mb-1 block text-xs font-semibold text-slate-400">CCW</label><select data-k="ccw" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500"><option value="false" ${!p.ccw ? 'selected' : ''}>No</option><option value="true" ${p.ccw ? 'selected' : ''}>Yes</option></select></div>
          <div class="grid grid-cols-2 gap-3"><div><label class="mb-1 block text-xs font-semibold text-slate-400">VCH</label><input type="number" data-k="vch" value="${p.vch || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div><div><label class="mb-1 block text-xs font-semibold text-slate-400">Felonies</label><input type="number" data-k="felony_count" value="${p.felony_count || 0}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Mugshot URL</label><input data-k="mugshot_url" value="${escapeHTML(p.mugshot_url || '')}" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500" /></div>
          <div class="sm:col-span-2"><label class="mb-1 block text-xs font-semibold text-slate-400">Notes</label><textarea data-k="notes" rows="3" class="w-full rounded-lg border border-white/10 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-badge-500">${escapeHTML(p.notes || '')}</textarea></div>
          <div class="sm:col-span-2"><div class="mb-1 flex items-center justify-between"><label class="block text-xs font-semibold text-slate-400">Known Properties</label><button type="button" id="p-prop-add" class="text-xs font-semibold text-blue-300 transition hover:text-blue-200">+ Add property</button></div><div id="p-props" class="space-y-2"></div></div>
        </div>
        <div class="mt-5 flex gap-2">
          <button id="p-save" class="flex-1 rounded-lg bg-gradient-to-r from-badge-500 to-blue-700 py-3 text-sm font-semibold text-white shadow-glow transition hover:brightness-110">${record ? 'Save changes' : 'Create person'}</button>
          ${record && DB().canDelete() ? '<button id="p-del" class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-rose-300 transition hover:bg-rose-500/10">Delete</button>' : ''}
        </div>`;
      node.querySelector('.close-x').onclick = closeModal;
      // Known-properties editor — repeatable {address,type,notes} rows. Kept off
      // the [data-k] sweep (own classes) so it's collected as a jsonb array.
      const propsWrap = node.querySelector('#p-props');
      const PROPERTY_TYPES = ['Residence', 'Stash House', 'Front Business', 'Safehouse', 'Warehouse', 'Vehicle', 'Other'];
      const addPropRow = (pr) => {
        pr = pr || {};
        const typeOpts = PROPERTY_TYPES.map((t) => `<option${t === (pr.type || 'Residence') ? ' selected' : ''}>${t}</option>`).join('');
        const row = el('div', { class: 'prop-row flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-ink-900 p-2' });
        row.innerHTML = `<input class="prop-addr min-w-[10rem] flex-1 rounded-md border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-white outline-none focus:border-badge-500" placeholder="Address / location" value="${escapeHTML(pr.address || '')}" />
          <select class="prop-type rounded-md border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-white outline-none focus:border-badge-500">${typeOpts}</select>
          <input class="prop-notes min-w-[8rem] flex-1 rounded-md border border-white/10 bg-ink-800 px-2 py-1.5 text-sm text-white outline-none focus:border-badge-500" placeholder="Notes (optional)" value="${escapeHTML(pr.notes || '')}" />
          <button type="button" class="prop-rm rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-rose-300 transition hover:bg-rose-500/10">✕</button>`;
        row.querySelector('.prop-rm').onclick = () => row.remove();
        propsWrap.appendChild(row);
      };
      (Array.isArray(p.properties) ? p.properties : []).forEach(addPropRow);
      node.querySelector('#p-prop-add').onclick = () => addPropRow();
      node.querySelector('#p-save').onclick = async () => {
        const payload = {}; $$('[data-k]', node).forEach((f) => payload[f.dataset.k] = f.value.trim());
        if (!payload.name) { toast('Name is required.', 'warn'); return; }
        payload.ccw = payload.ccw === 'true'; payload.vch = Number(payload.vch) || 0; payload.felony_count = Number(payload.felony_count) || 0;
        if (!payload.gang_id) payload.gang_id = null;
        payload.properties = $$('.prop-row', node).map((r) => ({
          address: r.querySelector('.prop-addr').value.trim(),
          type: r.querySelector('.prop-type').value,
          notes: r.querySelector('.prop-notes').value.trim(),
        })).filter((x) => x.address || x.notes);
        const res = record && record.id ? await DB().update('persons', record.id, payload) : await DB().insert('persons', payload);
        if (res.error) { toast('Save failed: ' + res.error.message, 'danger'); return; }
        closeModal(); toast(record ? 'Person updated' : 'Person created', 'success'); fetchPersons();
      };
      const pd = node.querySelector('#p-del'); if (pd) pd.onclick = async () => {
        if (!(await uiConfirm('Delete person “' + p.name + '”?', { confirmText: 'Delete' }))) return;
        closeModal();
        await deleteWithUndo('persons', p, { label: 'Person “' + p.name + '”', after: fetchPersons });
      };
      openModal(node, { wide: true });
    }

